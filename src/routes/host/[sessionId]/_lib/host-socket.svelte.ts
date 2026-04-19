import type {
	AnswerCountUpdatedMessage,
	EndedMessage,
	OutboundMessage,
	ParticipantJoinedMessage,
	ParticipantLeftMessage,
	ParticipantSummary,
	QuestionStartedMessage,
	RevealMessage,
	SessionStatus,
	StateMessage
} from '$lib/server/do/protocol';

export interface CurrentQuestion {
	qIdx: number;
	text: string;
	answers: { idx: number; text: string }[];
	timeLimitSec: number;
	points: number;
	questionStartedAtMs: number;
}

export interface RevealDetails {
	qIdx: number;
	correctIdx: number;
	leaderboard: ParticipantSummary[];
}

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000];

/**
 * Reactive WebSocket client for the host view. Owns a single socket + the
 * derived state the 3-column layout reads. Host-origin control messages
 * (`host-reveal`, `host-advance`, `host-end`) are sent as outbound JSON —
 * the DO enforces host role based on the socket's attachment, set on upgrade.
 *
 * Reconnection: on unexpected close during active/revealing we retry with a
 * capped exponential backoff. After the max, we surface a UI-facing flag the
 * caller can display with a manual-retry button.
 */
export class HostSocket {
	#sessionId: string;
	#ws: WebSocket | null = null;
	#reconnectAttempts = 0;
	#reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	#intentionallyClosed = false;

	status = $state<SessionStatus>('lobby');
	participants = $state<ParticipantSummary[]>([]);
	currentQuestion = $state<CurrentQuestion | null>(null);
	answerCounts = $state<Record<number, number>>({});
	leaderboard = $state<ParticipantSummary[]>([]);
	reveal = $state<RevealDetails | null>(null);
	finalLeaderboard = $state<ParticipantSummary[] | null>(null);
	connectionLost = $state(false);
	lastError = $state<string | null>(null);

	/** Track previous positions so the leaderboard can render move indicators. */
	#prevPositions = new Map<string, number>();

	constructor(sessionId: string) {
		this.#sessionId = sessionId;
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

	send(message: { type: string; payload?: unknown }) {
		const ws = this.#ws;
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			this.lastError = 'Not connected yet — please wait';
			return;
		}
		ws.send(JSON.stringify(message));
	}

	reveal_() {
		this.send({ type: 'host-reveal' });
	}
	advance() {
		this.send({ type: 'host-advance' });
	}
	end() {
		this.send({ type: 'host-end' });
	}

	/** Produce leaderboard entries tagged with previous positions for FLIP arrows. */
	leaderboardEntries() {
		return this.leaderboard.map((p) => ({
			id: p.participantId,
			nickname: p.nickname,
			score: p.score,
			prevPosition: this.#prevPositions.get(p.participantId)
		}));
	}

	retry() {
		this.#reconnectAttempts = 0;
		this.connectionLost = false;
		this.lastError = null;
		this.#open();
	}

	#open() {
		if (typeof window === 'undefined') return;
		const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
		const url = `${protocol}://${window.location.host}/api/session/${this.#sessionId}/ws?role=host`;
		const ws = new WebSocket(url);
		this.#ws = ws;

		ws.addEventListener('open', () => {
			this.connectionLost = false;
			this.#reconnectAttempts = 0;
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
			this.#scheduleReconnect();
		});

		ws.addEventListener('error', () => {
			// Error events are followed by close; let the close handler own reconnection.
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
			4000;
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
				this.lastError = msg.payload.message;
				break;
		}
	}

	#onState(msg: StateMessage) {
		this.status = msg.payload.status;
		this.participants = msg.payload.participants;
		// Seed leaderboard from participants on initial state — DO doesn't send a
		// separate scoreboard message until the first reveal.
		this.#updateLeaderboard(msg.payload.participants);
		if (msg.payload.currentQuestion && msg.payload.questionStartedAtMs && msg.payload.timeLimitSec) {
			this.currentQuestion = {
				qIdx: msg.payload.currentQuestion.qIdx,
				text: msg.payload.currentQuestion.text,
				answers: msg.payload.currentQuestion.answers,
				timeLimitSec: msg.payload.timeLimitSec,
				points: 1000,
				questionStartedAtMs: msg.payload.questionStartedAtMs
			};
		}
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
		// Don't drop from list — reconnects preserve identity. Future: render dimmed.
		void msg;
	}

	#onQuestionStarted(msg: QuestionStartedMessage) {
		this.status = 'active';
		this.reveal = null;
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
		this.status = 'revealing';
		this.reveal = {
			qIdx: msg.payload.qIdx,
			correctIdx: msg.payload.correctIdx,
			leaderboard: msg.payload.leaderboard
		};
		this.#updateLeaderboard(msg.payload.leaderboard);
	}

	#onEnded(msg: EndedMessage) {
		this.status = 'ended';
		this.finalLeaderboard = msg.payload.finalLeaderboard;
		this.#updateLeaderboard(msg.payload.finalLeaderboard);
	}

	#updateLeaderboard(next: ParticipantSummary[]) {
		const sorted = [...next].sort((a, b) => b.score - a.score);
		const nextPositions = new Map<string, number>();
		sorted.forEach((p, i) => nextPositions.set(p.participantId, i + 1));
		// Save the CURRENT positions as prev BEFORE we overwrite `leaderboard`.
		this.#prevPositions = new Map(
			[...this.leaderboard].map((p, i) => [p.participantId, i + 1] as [string, number])
		);
		this.leaderboard = sorted;
		// If first render (no prev), seed prev to current so arrows don't show spuriously.
		if (this.#prevPositions.size === 0) this.#prevPositions = nextPositions;
	}
}
