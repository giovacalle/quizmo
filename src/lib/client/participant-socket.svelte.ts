import { SvelteSet } from 'svelte/reactivity';

import type {
	AnswerCountUpdatedMessage,
	EndedMessage,
	ErrorMessage,
	OutboundMessage,
	ParticipantJoinedMessage,
	ParticipantLeftMessage,
	ParticipantSummary,
	QuestionStartedMessage,
	RevealMessage,
	StateMessage
} from '$lib/server/do/protocol';

/**
 * UI status for the participant view — richer than the server-side SessionStatus
 * because the participant page needs to distinguish "question visible" from
 * "reveal/feedback shown". Map: server `active` → `question`; server `revealing`
 * → `feedback` (after we dispatch `reveal`).
 */
export type ParticipantUiStatus = 'lobby' | 'question' | 'feedback' | 'ended';

export interface CurrentQuestion {
	qIdx: number;
	text: string;
	answers: { idx: number; text: string }[];
	timeLimitSec: number;
	points: number;
	questionStartedAtMs: number;
}

export interface ParticipantIdentity {
	participantId: string;
	participantToken: string;
}

export interface RevealDetails {
	qIdx: number;
	correctIdx: number;
	selfCorrect: boolean;
	selfDelta: number;
	selfPosition: number;
	selfTotal: number;
	leaderboard: ParticipantSummary[];
}

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

function storageKey(sessionId: string): string {
	return `quizmo:session:${sessionId}`;
}

function readIdentity(sessionId: string): ParticipantIdentity | null {
	if (typeof sessionStorage === 'undefined') return null;
	const raw = sessionStorage.getItem(storageKey(sessionId));
	if (!raw) return null;
	const parsed = JSON.parse(raw) as ParticipantIdentity;
	if (!parsed.participantId || !parsed.participantToken) return null;
	return parsed;
}

function writeIdentity(sessionId: string, identity: ParticipantIdentity): void {
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.setItem(storageKey(sessionId), JSON.stringify(identity));
}

function clearIdentity(sessionId: string): void {
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.removeItem(storageKey(sessionId));
}

/**
 * Reactive WebSocket client for the participant view. Owns the socket + derived
 * UI state. On mount we try sessionStorage for a prior identity and send
 * `reconnect` first; otherwise we send `join` with the nickname.
 *
 * Reconnect: 5 attempts with 500ms/1s/2s/4s/8s backoff. Identity is preserved
 * across reconnects via sessionStorage. An UNAUTHENTICATED error from the DO
 * (tampered token) clears sessionStorage and surfaces `authError = true` so the
 * page can route back to /join with a fresh challenge.
 */
export class ParticipantSocket {
	#sessionId: string;
	#nickname: string;
	#ws: WebSocket | null = null;
	#reconnectAttempts = 0;
	#reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	#intentionallyClosed = false;
	#pendingAnswers: SvelteSet<number> = new SvelteSet();

	status = $state<ParticipantUiStatus>('lobby');
	participants = $state<ParticipantSummary[]>([]);
	currentQuestion = $state<CurrentQuestion | null>(null);
	answerCounts = $state<Record<number, number>>({});
	leaderboard = $state<ParticipantSummary[]>([]);
	reveal = $state<RevealDetails | null>(null);
	finalLeaderboard = $state<ParticipantSummary[] | null>(null);
	finalPosition = $state<number | null>(null);
	connectionLost = $state(false);
	authError = $state(false);
	lastError = $state<string | null>(null);
	/** The participant's own id, once the DO has issued it. Null while reconnecting or before join. */
	selfParticipantId = $state<string | null>(null);
	/** Submitted choice for the current question, for UI feedback. */
	submittedChoice = $state<number | null>(null);

	constructor(sessionId: string, nickname: string) {
		this.#sessionId = sessionId;
		this.#nickname = nickname;
	}

	connect() {
		this.#intentionallyClosed = false;
		this.#open();
	}

	close() {
		this.#intentionallyClosed = true;
		if (this.#reconnectTimer !== null) {
			clearTimeout(this.#reconnectTimer);
			this.#reconnectTimer = null;
		}
		this.#ws?.close();
		this.#ws = null;
	}

	/** Submit an answer. Idempotent per-qIdx on the client; DO also ignores re-submissions. */
	submitAnswer(qIdx: number, choice: number) {
		if (this.#pendingAnswers.has(qIdx)) return;
		this.#pendingAnswers.add(qIdx);
		this.submittedChoice = choice;
		this.#send({ type: 'submit-answer', payload: { qIdx, choice } });
	}

	retry() {
		this.#reconnectAttempts = 0;
		this.connectionLost = false;
		this.lastError = null;
		this.#open();
	}

	/** Clear the persisted identity and signal the page to route back to /join. */
	resetIdentity() {
		clearIdentity(this.#sessionId);
		this.selfParticipantId = null;
		this.close();
	}

	#send(message: { type: string; payload?: unknown }) {
		const ws = this.#ws;
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			this.lastError = 'Not connected yet — please wait';
			return;
		}
		ws.send(JSON.stringify(message));
	}

	#open() {
		if (typeof window === 'undefined') return;
		const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
		const url = `${protocol}://${window.location.host}/api/session/${this.#sessionId}/ws`;
		const ws = new WebSocket(url);
		this.#ws = ws;

		ws.addEventListener('open', () => {
			this.connectionLost = false;
			this.#reconnectAttempts = 0;
			// Prefer reconnect if we have a prior identity; otherwise join fresh.
			const identity = readIdentity(this.#sessionId);
			if (identity) {
				this.selfParticipantId = identity.participantId;
				ws.send(JSON.stringify({ type: 'reconnect', payload: identity }));
			} else {
				ws.send(JSON.stringify({ type: 'join', payload: { nickname: this.#nickname } }));
			}
		});

		ws.addEventListener('message', (ev) => {
			let parsed: OutboundMessage;
			try {
				parsed = JSON.parse(ev.data as string) as OutboundMessage;
			} catch {
				return;
			}
			this.#dispatch(parsed);
		});

		ws.addEventListener('close', () => {
			this.#ws = null;
			if (this.#intentionallyClosed) return;
			if (this.status === 'ended') return;
			if (this.authError) return;
			this.#scheduleReconnect();
		});

		ws.addEventListener('error', () => {
			// error is followed by close; close handler owns reconnection.
		});
	}

	#scheduleReconnect() {
		if (this.#reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
			this.connectionLost = true;
			this.lastError = 'Connection lost. Click retry to reconnect.';
			return;
		}
		const delay =
			RECONNECT_DELAYS_MS[this.#reconnectAttempts] ??
			RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1] ??
			8000;
		this.#reconnectAttempts += 1;
		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = null;
			this.#open();
		}, delay);
	}

	#dispatch(msg: OutboundMessage) {
		switch (msg.type) {
			case 'state':
				this.#onState(msg);
				break;
			case 'participant-joined':
				this.#onParticipantJoined(msg);
				break;
			case 'participant-left':
				this.#onParticipantLeft(msg);
				break;
			case 'question-started':
				this.#onQuestionStarted(msg);
				break;
			case 'answer-count-updated':
				this.#onAnswerCountUpdated(msg);
				break;
			case 'reveal':
				this.#onReveal(msg);
				break;
			case 'ended':
				this.#onEnded(msg);
				break;
			case 'error':
				this.#onError(msg);
				break;
		}
	}

	#onState(msg: StateMessage) {
		// Map server status → UI status. We stay on `lobby` for the server's
		// lobby state; `active` becomes `question` once we also have a question;
		// `revealing` stays as `question` for the participant (the transient
		// reveal → feedback happens via the explicit `reveal` message). `ended`
		// is terminal.
		const serverStatus = msg.payload.status;
		if (serverStatus === 'ended') this.status = 'ended';
		else if (serverStatus === 'active' && msg.payload.currentQuestion) this.status = 'question';
		else if (serverStatus === 'lobby') this.status = 'lobby';
		// `revealing`: leave status untouched — if we've already dispatched a
		// reveal we're in `feedback`; otherwise stay in `question` with the
		// revealed answer until the next question-started lands.
		this.participants = msg.payload.participants;
		// If this state carries a new identity (reply to `join`), persist it.
		if (msg.payload.participantId && msg.payload.participantToken) {
			writeIdentity(this.#sessionId, {
				participantId: msg.payload.participantId,
				participantToken: msg.payload.participantToken
			});
			this.selfParticipantId = msg.payload.participantId;
		}
		if (
			msg.payload.currentQuestion &&
			msg.payload.questionStartedAtMs !== null &&
			msg.payload.timeLimitSec !== null
		) {
			this.currentQuestion = {
				qIdx: msg.payload.currentQuestion.qIdx,
				text: msg.payload.currentQuestion.text,
				answers: msg.payload.currentQuestion.answers,
				timeLimitSec: msg.payload.timeLimitSec,
				points: 1000,
				questionStartedAtMs: msg.payload.questionStartedAtMs
			};
		} else {
			this.currentQuestion = null;
		}
		this.#updateLeaderboard(msg.payload.participants);
	}

	#onParticipantJoined(msg: ParticipantJoinedMessage) {
		if (this.participants.some((p) => p.participantId === msg.payload.participantId)) return;
		this.participants = [
			...this.participants,
			{ participantId: msg.payload.participantId, nickname: msg.payload.nickname, score: 0 }
		];
		this.#updateLeaderboard(this.participants);
	}

	#onParticipantLeft(msg: ParticipantLeftMessage) {
		// Soft-leave: identity is preserved for potential reconnect.
		void msg;
	}

	#onQuestionStarted(msg: QuestionStartedMessage) {
		this.status = 'question';
		this.reveal = null;
		this.submittedChoice = null;
		this.#pendingAnswers = new SvelteSet();
		this.answerCounts = { ...this.answerCounts, [msg.payload.qIdx]: 0 };
		this.currentQuestion = {
			qIdx: msg.payload.qIdx,
			text: msg.payload.text,
			answers: msg.payload.answers,
			timeLimitSec: msg.payload.timeLimitSec,
			points: msg.payload.points,
			questionStartedAtMs: msg.payload.questionStartedAtMs
		};
	}

	#onAnswerCountUpdated(msg: AnswerCountUpdatedMessage) {
		this.answerCounts = { ...this.answerCounts, [msg.payload.qIdx]: msg.payload.count };
	}

	#onReveal(msg: RevealMessage) {
		this.status = 'feedback';
		const selfEntry = msg.payload.perParticipantDelta.find(
			(d) => d.participantId === this.selfParticipantId
		);
		const sorted = [...msg.payload.leaderboard].sort((a, b) => b.score - a.score);
		const selfPosition = sorted.findIndex((p) => p.participantId === this.selfParticipantId) + 1;
		this.reveal = {
			qIdx: msg.payload.qIdx,
			correctIdx: msg.payload.correctIdx,
			selfCorrect: selfEntry?.correct ?? false,
			selfDelta: selfEntry?.scoreDelta ?? 0,
			selfPosition: selfPosition > 0 ? selfPosition : sorted.length,
			selfTotal: sorted.length,
			leaderboard: msg.payload.leaderboard
		};
		this.#updateLeaderboard(msg.payload.leaderboard);
	}

	#onEnded(msg: EndedMessage) {
		this.status = 'ended';
		this.finalLeaderboard = msg.payload.finalLeaderboard;
		const sorted = [...msg.payload.finalLeaderboard].sort((a, b) => b.score - a.score);
		const selfIdx = sorted.findIndex((p) => p.participantId === this.selfParticipantId);
		this.finalPosition = selfIdx >= 0 ? selfIdx + 1 : null;
		this.#updateLeaderboard(msg.payload.finalLeaderboard);
	}

	#onError(msg: ErrorMessage) {
		this.lastError = msg.payload.message;
		if (msg.payload.code === 'UNAUTHENTICATED') {
			this.authError = true;
			clearIdentity(this.#sessionId);
			// Prevent automatic reconnect — page owns the redirect.
			this.#intentionallyClosed = true;
		}
	}

	#updateLeaderboard(next: ParticipantSummary[]) {
		this.leaderboard = [...next].sort((a, b) => b.score - a.score);
	}
}
