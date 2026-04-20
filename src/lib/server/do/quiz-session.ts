/**
 * QuizSession Durable Object — per-session state machine + WebSocket fan-out.
 *
 * Responsibilities:
 *   1. Coordinate a single live quiz session's state transitions
 *      (lobby → active → revealing → active → ... → ended).
 *   2. Own the timer via ctx.storage.setAlarm; `alarm()` advances the state on
 *      cold-woken DOs.
 *   3. Accept WebSocket connections via ctx.acceptWebSocket (hibernation pattern)
 *      from both hosts and participants.
 *   4. Persist state changes to ctx.storage BEFORE broadcasting (write-through
 *      discipline — non-negotiable per plan + cf-workers-backend rule).
 *   5. Mirror participant scores to D1 incrementally (after every advance) so a
 *      DO eviction mid-quiz doesn't lose progress. End-of-session flips the
 *      quiz_sessions.status row and rewrites final scores idempotently.
 *
 * Storage layout (locked — do NOT re-shape without propagating changes):
 *   meta            → { sessionId, sessionSecret (hex), status, currentQuestionIdx,
 *                        questionStartedAtMs, totalQuestions, quizId?, firstCorrectAwarded? }
 *   question:{idx}  → { text, timeLimitSec, points, answers: [{text}], correctIdx }
 *   participant:{pid} → { nickname, score, joinedAt, firstCorrectCount }
 *   answer:{qIdx}:{pid} → { choice, answeredAtMs, scoreDelta? }
 *
 * Identity contract:
 *   - DO id is derived via env.QUIZMO_SESSION.idFromName(sessionId). Deterministic.
 *   - sessionSecret is generated once (32 bytes, hex) on first construction and
 *     persisted under `meta`. It never leaves the DO.
 *   - participantId = crypto.randomUUID() on join.
 *   - participantToken = HMAC-SHA256(sessionSecret, participantId), hex.
 *     Reconnect sends both; we recompute HMAC and constant-time compare.
 *
 * Trust model for the WS:
 *   This endpoint is hit by both host and participant. Message types are the
 *   discriminator: `host-*` messages only succeed if the socket is flagged as the
 *   host via the HOST_TOKEN query param (see +server.ts). Participant messages
 *   (join / submit-answer / reconnect) are the default path. A participant socket
 *   sending `host-*` messages receives UNAUTHENTICATED. See for the
 *   hostToken minting flow.
 */
import { DurableObject } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import * as v from 'valibot';

import { db } from '$lib/server/db/client';
import {
	answers as answersTable,
	participants as participantsTable,
	questions as questionsTable,
	quizSessions as quizSessionsTable,
	quizzes as quizzesTable
} from '$lib/server/db/schema';

import {
	inboundMessageSchema,
	type OutboundMessage,
	type ParticipantSummary,
	type SessionStatus,
	type StateMessage
} from './protocol';
import { computeScore } from './scoring';

// ---------------------------------------------------------------------------
// Storage value shapes
// ---------------------------------------------------------------------------

interface Meta {
	sessionId: string;
	sessionSecret: string;
	status: SessionStatus;
	currentQuestionIdx: number;
	questionStartedAtMs: number | null;
	totalQuestions: number;
	quizId: string | null;
	/** Map from question index → true when the first-correct bonus has been awarded. */
	firstCorrectAwarded: Record<string, boolean>;
}

interface StoredQuestion {
	text: string;
	timeLimitSec: number;
	points: number;
	answers: { text: string }[];
	correctIdx: number;
}

interface StoredParticipant {
	nickname: string;
	score: number;
	joinedAt: number;
	firstCorrectCount: number;
}

interface StoredAnswer {
	choice: number;
	answeredAtMs: number;
	scoreDelta?: number;
}

/** Attached to every hibernatable socket so we can identify it after wake. */
interface SocketAttachment {
	role: 'host' | 'participant';
	participantId?: string;
}

// ---------------------------------------------------------------------------
// Module constants
// ---------------------------------------------------------------------------

const REVEAL_ALARM_MS = 5_000;
const ANSWER_COUNT_COALESCE_MS = 500;

const internalStartSchema = v.object({
	quizId: v.pipe(v.string(), v.minLength(1))
});

// ---------------------------------------------------------------------------
// The DO class
// ---------------------------------------------------------------------------

export class QuizSession extends DurableObject<Env> {
	#hmacKey: CryptoKey | null = null;
	#answerCountFlushTimer: ReturnType<typeof setTimeout> | null = null;
	#pendingAnswerCount: { qIdx: number; count: number } | null = null;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		// Seed the sessionSecret on first construction. blockConcurrencyWhile
		// ensures no fetch/alarm can observe the DO mid-seed.
		ctx.blockConcurrencyWhile(async () => {
			const meta = await ctx.storage.get<Meta>('meta');
			if (meta) return;
			const secretBytes = new Uint8Array(32);
			crypto.getRandomValues(secretBytes);
			const sessionSecret = bytesToHex(secretBytes);
			// `id.name` is populated when the DO is retrieved via idFromName; fall
			// back to the stringified id (used for logs, never for crypto).
			const nameFromId = (this.ctx.id as { name?: string }).name ?? null;
			const initialMeta: Meta = {
				sessionId: nameFromId ?? this.ctx.id.toString(),
				sessionSecret,
				status: 'lobby',
				currentQuestionIdx: -1,
				questionStartedAtMs: null,
				totalQuestions: 0,
				quizId: null,
				firstCorrectAwarded: {}
			};
			await ctx.storage.put('meta', initialMeta);
		});
	}

	// -----------------------------------------------------------------------
	// Entry point: the Worker forwards upgrade + internal routes here.
	// -----------------------------------------------------------------------

	override async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		// Internal RPC-ish routes used by the Worker side (session-start, nightly-cleanup
		// reconcile, test harnesses). Prefixed with /internal/ so they can't
		// collide with WS upgrade paths.
		if (url.pathname === '/internal/start' && request.method === 'POST') {
			const body = await request.json().catch(() => null);
			const parsed = v.safeParse(internalStartSchema, body);
			if (!parsed.success) return this.#jsonError(400, 'INVALID_INPUT', 'quizId required');
			await this.#start(parsed.output.quizId);
			return new Response(JSON.stringify({ ok: true }), {
				headers: { 'content-type': 'application/json' }
			});
		}

		if (url.pathname === '/internal/end' && request.method === 'POST') {
			await this.#end();
			return new Response(JSON.stringify({ ok: true }), {
				headers: { 'content-type': 'application/json' }
			});
		}

		if (url.pathname === '/internal/reconcile' && request.method === 'POST') {
			// Used by nightly cron. If the DO was evicted between reveal and end, flush
			// final state to D1. Idempotent — calling twice is fine.
			await this.#persistFinalToD1();
			return new Response(JSON.stringify({ ok: true }), {
				headers: { 'content-type': 'application/json' }
			});
		}

		if (url.pathname === '/internal/state' && request.method === 'GET') {
			const state = await this.#buildStateMessage();
			return new Response(JSON.stringify(state), {
				headers: { 'content-type': 'application/json' }
			});
		}

		// WebSocket upgrade path: `/ws` from the +server.ts route. Everything else
		// is a client bug.
		const upgrade = request.headers.get('upgrade');
		if (upgrade?.toLowerCase() !== 'websocket') {
			return new Response('Expected WebSocket upgrade', { status: 426 });
		}

		const role: 'host' | 'participant' =
			url.searchParams.get('role') === 'host' ? 'host' : 'participant';

		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];

		// Accept with hibernation semantics. Attach the role so we remember it
		// after a wake without relying on in-memory Maps.
		this.ctx.acceptWebSocket(server);
		const attachment: SocketAttachment = { role };
		server.serializeAttachment(attachment);

		return new Response(null, { status: 101, webSocket: client });
	}

	// -----------------------------------------------------------------------
	// Hibernation callbacks
	// -----------------------------------------------------------------------

	override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
		const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
		let parsedJson: unknown;
		try {
			parsedJson = JSON.parse(text);
		} catch {
			this.#sendTo(ws, {
				type: 'error',
				payload: { code: 'INVALID_INPUT', message: 'Malformed JSON' }
			});
			return;
		}

		const parsed = v.safeParse(inboundMessageSchema, parsedJson);
		if (!parsed.success) {
			this.#sendTo(ws, {
				type: 'error',
				payload: { code: 'INVALID_INPUT', message: 'Unknown message shape' }
			});
			return;
		}

		const attachment = (ws.deserializeAttachment() as SocketAttachment | null) ?? {
			role: 'participant'
		};
		const msg = parsed.output;

		try {
			switch (msg.type) {
				case 'join':
					await this.#handleJoin(ws, msg.payload.nickname);
					break;
				case 'reconnect':
					await this.#handleReconnect(ws, msg.payload.participantId, msg.payload.participantToken);
					break;
				case 'submit-answer':
					await this.#handleSubmitAnswer(ws, msg.payload.qIdx, msg.payload.choice);
					break;
				case 'host-start':
					this.#requireHost(attachment);
					await this.#start();
					break;
				case 'host-advance':
					this.#requireHost(attachment);
					await this.#advance();
					break;
				case 'host-reveal':
					this.#requireHost(attachment);
					await this.#reveal();
					break;
				case 'host-end':
					this.#requireHost(attachment);
					await this.#end();
					break;
			}
		} catch (err) {
			const code =
				err && typeof err === 'object' && 'code' in err
					? String((err as { code: unknown }).code)
					: 'INTERNAL_ERROR';
			const message = err instanceof Error ? err.message : 'Unexpected error';
			this.#sendTo(ws, { type: 'error', payload: { code, message } });
		}
	}

	override async webSocketClose(ws: WebSocket): Promise<void> {
		const attachment = ws.deserializeAttachment() as SocketAttachment | null;
		if (attachment?.role === 'participant' && attachment.participantId) {
			// Don't delete the participant — they may reconnect. Just broadcast that
			// the socket closed so the host UI can dim them.
			this.#broadcast({
				type: 'participant-left',
				payload: { participantId: attachment.participantId }
			});
		}
	}

	override async alarm(): Promise<void> {
		// An alarm can fire on a cold DO: always rehydrate from storage first.
		const meta = await this.#loadMeta();
		console.log(
			`[QuizSession ${meta.sessionId}] alarm fired at status=${meta.status} qIdx=${meta.currentQuestionIdx}`
		);
		if (meta.status === 'active') {
			await this.#reveal();
		} else if (meta.status === 'revealing') {
			await this.#advance();
		}
		// Else: lobby / ended / unknown — no-op. This shouldn't happen under normal
		// flow; logged above so wrangler tail shows it.
	}

	// -----------------------------------------------------------------------
	// State transitions
	// -----------------------------------------------------------------------

	/**
	 * Starts (or restarts) the quiz. Loads the quiz snapshot from D1, flips to
	 * `active`, arms the first alarm, broadcasts `question-started`.
	 *
	 * Parameter is optional for the host WS path (`host-start`) — if absent we
	 * reuse the stored quizId. session-start seeds meta.quizId via /internal/start before
	 * the host socket connects.
	 */
	async #start(quizIdArg?: string): Promise<void> {
		const meta = await this.#loadMeta();
		if (meta.status !== 'lobby') {
			throw Object.assign(new Error('Session has already started'), { code: 'INVALID_INPUT' });
		}
		const quizId = quizIdArg ?? meta.quizId;
		if (!quizId)
			throw Object.assign(new Error('Session has no quizId attached'), { code: 'INVALID_INPUT' });

		const client = db(this.env.QUIZMO_DB);
		// Resolve quiz + questions + answers in one pass. Ordering is explicit
		// because D1 doesn't guarantee insertion order across joins.
		const quiz = await client.select().from(quizzesTable).where(eq(quizzesTable.id, quizId)).get();
		if (!quiz) throw Object.assign(new Error('Quiz not found'), { code: 'NOT_FOUND' });

		const qs = await client
			.select()
			.from(questionsTable)
			.where(eq(questionsTable.quizId, quizId))
			.all();
		qs.sort((a, b) => a.order - b.order);

		const snapshot: StoredQuestion[] = [];
		for (const q of qs) {
			const ans = await client
				.select()
				.from(answersTable)
				.where(eq(answersTable.questionId, q.id))
				.all();
			ans.sort((a, b) => a.order - b.order);
			const correctIdx = ans.findIndex((a) => a.isCorrect);
			if (correctIdx < 0)
				throw Object.assign(new Error(`Question ${q.id} has no correct answer`), {
					code: 'INVALID_INPUT'
				});
			snapshot.push({
				text: q.text,
				timeLimitSec: q.timeLimitSec,
				points: q.points,
				answers: ans.map((a) => ({ text: a.text })),
				correctIdx
			});
		}

		if (snapshot.length === 0)
			throw Object.assign(new Error('Quiz has no questions'), { code: 'INVALID_INPUT' });

		// Persist the question snapshot + transition meta atomically (single put
		// call under the hood via put with an object — CF Storage batches these).
		const entries: Record<string, unknown> = {};
		snapshot.forEach((q, idx) => {
			entries[`question:${idx}`] = q;
		});

		const now = Date.now();
		const first = snapshot[0];
		if (!first) throw Object.assign(new Error('Quiz has no questions'), { code: 'INVALID_INPUT' });
		const nextMeta: Meta = {
			...meta,
			quizId,
			status: 'active',
			currentQuestionIdx: 0,
			questionStartedAtMs: now,
			totalQuestions: snapshot.length,
			firstCorrectAwarded: {}
		};
		entries['meta'] = nextMeta;
		await this.ctx.storage.put(entries);
		// Also flip the D1 session row to active + stamp started_at so the dashboard
		// quota queries reflect reality.
		await client
			.update(quizSessionsTable)
			.set({ status: 'active', startedAt: now })
			.where(eq(quizSessionsTable.id, nextMeta.sessionId))
			.run()
			.catch((err) => {
				// Don't fail the start — D1 can be reconciled by  Log for tail.
				console.error(`[QuizSession ${nextMeta.sessionId}] D1 status update failed`, err);
			});

		await this.ctx.storage.setAlarm(now + first.timeLimitSec * 1000);

		this.#broadcast({
			type: 'question-started',
			payload: {
				qIdx: 0,
				text: first.text,
				answers: first.answers.map((a, idx) => ({ idx, text: a.text })),
				timeLimitSec: first.timeLimitSec,
				points: first.points,
				questionStartedAtMs: now
			}
		});
	}

	/**
	 * Moves from `active` → `revealing`: scores every correct answer, broadcasts
	 * leaderboard + per-participant deltas, arms the auto-advance alarm.
	 */
	async #reveal(): Promise<void> {
		const meta = await this.#loadMeta();
		if (meta.status !== 'active')
			throw Object.assign(new Error('Cannot reveal outside active state'), {
				code: 'INVALID_INPUT'
			});

		const qIdx = meta.currentQuestionIdx;
		const question = await this.ctx.storage.get<StoredQuestion>(`question:${qIdx}`);
		if (!question)
			throw Object.assign(new Error(`Missing question snapshot for qIdx=${qIdx}`), {
				code: 'INTERNAL_ERROR'
			});

		const totalTimeMs = question.timeLimitSec * 1000;
		const startedAt = meta.questionStartedAtMs ?? Date.now();
		const answersForQ = await this.ctx.storage.list<StoredAnswer>({ prefix: `answer:${qIdx}:` });
		const participants = await this.#loadAllParticipants();

		// Resolve first-correct by earliest answeredAtMs among correct submissions.
		const correctEntries = [...answersForQ.entries()]
			.filter(([, a]) => a.choice === question.correctIdx)
			.sort(([, a], [, b]) => a.answeredAtMs - b.answeredAtMs);
		const firstCorrectPid = correctEntries.length > 0 ? keyPid(correctEntries[0]?.[0] ?? '') : null;

		const deltas: { participantId: string; scoreDelta: number; correct: boolean }[] = [];
		const participantUpdates = new Map<string, StoredParticipant>();

		for (const [key, answer] of answersForQ.entries()) {
			const pid = keyPid(key);
			if (!pid) continue;
			const participant = participants.get(pid);
			if (!participant) continue;
			const correct = answer.choice === question.correctIdx;
			if (!correct) {
				deltas.push({ participantId: pid, scoreDelta: 0, correct: false });
				continue;
			}
			const elapsed = answer.answeredAtMs - startedAt;
			const timeLeftMs = totalTimeMs - elapsed;
			const isFirstCorrect = pid === firstCorrectPid && !meta.firstCorrectAwarded[String(qIdx)];
			const scoreDelta = computeScore({
				basePoints: question.points,
				timeLeftMs,
				totalTimeMs,
				isFirstCorrect
			});
			deltas.push({ participantId: pid, scoreDelta, correct: true });

			const next: StoredParticipant = {
				...participant,
				score: participant.score + scoreDelta,
				firstCorrectCount: participant.firstCorrectCount + (isFirstCorrect ? 1 : 0)
			};
			participantUpdates.set(pid, next);

			// Also stamp the scoreDelta back into the stored answer for debuggability.
			await this.ctx.storage.put(`answer:${qIdx}:${pid}`, { ...answer, scoreDelta });
		}

		// Write through.
		const storageWrites: Record<string, unknown> = {};
		for (const [pid, next] of participantUpdates) {
			storageWrites[`participant:${pid}`] = next;
			participants.set(pid, next);
		}
		const nextMeta: Meta = {
			...meta,
			status: 'revealing',
			firstCorrectAwarded: firstCorrectPid
				? { ...meta.firstCorrectAwarded, [String(qIdx)]: true }
				: meta.firstCorrectAwarded
		};
		storageWrites['meta'] = nextMeta;
		await this.ctx.storage.put(storageWrites);

		await this.ctx.storage.setAlarm(Date.now() + REVEAL_ALARM_MS);

		this.#broadcast({
			type: 'reveal',
			payload: {
				qIdx,
				correctIdx: question.correctIdx,
				perParticipantDelta: deltas,
				leaderboard: this.#buildLeaderboard(participants)
			}
		});
	}

	/**
	 * Advances to the next question or calls `end()` when the quiz is exhausted.
	 * Also fires the incremental D1 persistence pass so an eviction at this point
	 * leaves participants scored in D1.
	 */
	async #advance(): Promise<void> {
		const meta = await this.#loadMeta();
		if (meta.status !== 'revealing')
			throw Object.assign(new Error('Cannot advance outside revealing state'), {
				code: 'INVALID_INPUT'
			});

		// Incremental D1 persistence — keeps the dashboard's mid-quiz view warm
		// and hedges against DO eviction mid-flow.
		await this.#persistParticipantsToD1().catch((err) => {
			console.error(`[QuizSession ${meta.sessionId}] incremental D1 write failed`, err);
		});

		const nextIdx = meta.currentQuestionIdx + 1;
		if (nextIdx >= meta.totalQuestions) {
			await this.#end();
			return;
		}

		const nextQuestion = await this.ctx.storage.get<StoredQuestion>(`question:${nextIdx}`);
		if (!nextQuestion)
			throw Object.assign(new Error(`Missing question snapshot for qIdx=${nextIdx}`), {
				code: 'INTERNAL_ERROR'
			});

		const now = Date.now();
		const nextMeta: Meta = {
			...meta,
			status: 'active',
			currentQuestionIdx: nextIdx,
			questionStartedAtMs: now
		};
		await this.ctx.storage.put('meta', nextMeta);
		await this.ctx.storage.setAlarm(now + nextQuestion.timeLimitSec * 1000);

		this.#broadcast({
			type: 'question-started',
			payload: {
				qIdx: nextIdx,
				text: nextQuestion.text,
				answers: nextQuestion.answers.map((a, idx) => ({ idx, text: a.text })),
				timeLimitSec: nextQuestion.timeLimitSec,
				points: nextQuestion.points,
				questionStartedAtMs: now
			}
		});
	}

	/**
	 * Terminal transition. Broadcasts `ended`, flips quiz_sessions.status to
	 * 'ended' in D1 atomically (along with rewriting participant scores). Safe to
	 * call twice — D1 writes use INSERT OR REPLACE / UPDATE and don't double-write.
	 */
	async #end(): Promise<void> {
		const meta = await this.#loadMeta();
		if (meta.status === 'ended') return; // Idempotent.

		const participants = await this.#loadAllParticipants();
		const nextMeta: Meta = {
			...meta,
			status: 'ended',
			questionStartedAtMs: null
		};
		await this.ctx.storage.put('meta', nextMeta);
		// Cancel any pending alarm — we're done.
		await this.ctx.storage.deleteAlarm().catch(() => {});

		this.#broadcast({
			type: 'ended',
			payload: { finalLeaderboard: this.#buildLeaderboard(participants) }
		});

		await this.#persistFinalToD1().catch((err) => {
			// Don't throw — status='ended' in DO storage is the authoritative
			// signal; the nightly reconcile cron  retries via
			// /internal/reconcile.
			console.error(`[QuizSession ${meta.sessionId}] final D1 persistence failed`, err);
		});
	}

	// -----------------------------------------------------------------------
	// Message handlers
	// -----------------------------------------------------------------------

	async #handleJoin(ws: WebSocket, nickname: string): Promise<void> {
		const meta = await this.#loadMeta();
		if (meta.status === 'ended')
			throw Object.assign(new Error('Session has ended'), { code: 'INVALID_INPUT' });

		// Reject duplicate nicknames (case-insensitive, whitespace-insensitive). Raw
		// nickname is kept for display; only normalized form is compared.
		const normalized = normalizeNickname(nickname);
		const existing = await this.ctx.storage.list<StoredParticipant>({ prefix: 'participant:' });
		for (const participant of existing.values()) {
			if (normalizeNickname(participant.nickname) === normalized)
				throw Object.assign(new Error('Nickname already taken'), { code: 'CONFLICT' });
		}

		const participantId = crypto.randomUUID();
		const participantToken = await this.#signToken(meta.sessionSecret, participantId);
		const participant: StoredParticipant = {
			nickname,
			score: 0,
			joinedAt: Date.now(),
			firstCorrectCount: 0
		};
		await this.ctx.storage.put(`participant:${participantId}`, participant);

		// Tag the socket so subsequent messages (submit-answer, reconnect-after-hibernate)
		// know who they're from without a lookup.
		ws.serializeAttachment({ role: 'participant', participantId } satisfies SocketAttachment);

		const state = await this.#buildStateMessage();
		state.payload.participantId = participantId;
		state.payload.participantToken = participantToken;
		this.#sendTo(ws, state);

		// Tell other sockets someone new joined (but not the joiner themselves).
		this.#broadcastExcept(ws, {
			type: 'participant-joined',
			payload: { participantId, nickname }
		});
	}

	async #handleReconnect(ws: WebSocket, participantId: string, token: string): Promise<void> {
		const meta = await this.#loadMeta();
		const valid = await this.#verifyToken(meta.sessionSecret, participantId, token);
		if (!valid) {
			this.#sendTo(ws, {
				type: 'error',
				payload: { code: 'UNAUTHENTICATED', message: 'Invalid participant token' }
			});
			ws.close(1008, 'Invalid token');
			return;
		}
		const participant = await this.ctx.storage.get<StoredParticipant>(
			`participant:${participantId}`
		);
		if (!participant) {
			this.#sendTo(ws, {
				type: 'error',
				payload: { code: 'NOT_FOUND', message: 'Participant no longer in session' }
			});
			ws.close(1008, 'Unknown participant');
			return;
		}
		ws.serializeAttachment({ role: 'participant', participantId } satisfies SocketAttachment);
		const state = await this.#buildStateMessage();
		// Mirror the tokens back so the client can re-store them (defensive —
		// sessionStorage survives reload but not cross-origin navigation).
		state.payload.participantId = participantId;
		state.payload.participantToken = token;
		this.#sendTo(ws, state);
	}

	async #handleSubmitAnswer(ws: WebSocket, qIdx: number, choice: number): Promise<void> {
		const attachment = ws.deserializeAttachment() as SocketAttachment | null;
		if (!attachment?.participantId)
			throw Object.assign(new Error('Socket has no participant identity — join first'), {
				code: 'UNAUTHENTICATED'
			});
		const meta = await this.#loadMeta();
		if (meta.status !== 'active')
			throw Object.assign(new Error('Answers only accepted while question is active'), {
				code: 'INVALID_INPUT'
			});
		if (qIdx !== meta.currentQuestionIdx)
			throw Object.assign(new Error('Answer targets a stale question'), { code: 'INVALID_INPUT' });

		const question = await this.ctx.storage.get<StoredQuestion>(`question:${qIdx}`);
		if (!question)
			throw Object.assign(new Error('Question snapshot missing'), { code: 'INTERNAL_ERROR' });
		if (choice < 0 || choice >= question.answers.length)
			throw Object.assign(new Error('Answer choice out of range'), { code: 'INVALID_INPUT' });

		const pid = attachment.participantId;
		const key = `answer:${qIdx}:${pid}`;
		// Ignore re-submissions — first answer wins (aligns with the "answered at"
		// timestamp being authoritative for first-correct).
		const existing = await this.ctx.storage.get<StoredAnswer>(key);
		if (existing) return;

		const payload: StoredAnswer = { choice, answeredAtMs: Date.now() };
		await this.ctx.storage.put(key, payload);

		// Coalesce answer-count broadcasts for the host dashboard.
		const count = await this.#countAnswersForQuestion(qIdx);
		this.#scheduleAnswerCountBroadcast(qIdx, count);
	}

	#requireHost(attachment: SocketAttachment): void {
		if (attachment.role !== 'host')
			throw Object.assign(new Error('Host-only message received from participant socket'), {
				code: 'FORBIDDEN'
			});
	}

	// -----------------------------------------------------------------------
	// Persistence helpers
	// -----------------------------------------------------------------------

	async #persistParticipantsToD1(): Promise<void> {
		const meta = await this.#loadMeta();
		const participants = await this.#loadAllParticipants();
		if (participants.size === 0) return;
		const client = db(this.env.QUIZMO_DB);
		for (const [pid, p] of participants) {
			await client
				.insert(participantsTable)
				.values({
					id: `${meta.sessionId}:${pid}`,
					sessionId: meta.sessionId,
					nickname: p.nickname,
					score: p.score,
					joinedAt: p.joinedAt
				})
				.onConflictDoUpdate({
					target: participantsTable.id,
					set: { nickname: p.nickname, score: p.score }
				})
				.run();
		}
	}

	async #persistFinalToD1(): Promise<void> {
		const meta = await this.#loadMeta();
		const client = db(this.env.QUIZMO_DB);
		await this.#persistParticipantsToD1();
		await client
			.update(quizSessionsTable)
			.set({ status: 'ended', endedAt: Date.now() })
			.where(and(eq(quizSessionsTable.id, meta.sessionId)))
			.run();
	}

	async #countAnswersForQuestion(qIdx: number): Promise<number> {
		const rows = await this.ctx.storage.list({ prefix: `answer:${qIdx}:` });
		return rows.size;
	}

	async #loadAllParticipants(): Promise<Map<string, StoredParticipant>> {
		const rows = await this.ctx.storage.list<StoredParticipant>({ prefix: 'participant:' });
		const out = new Map<string, StoredParticipant>();
		for (const [key, value] of rows) {
			const pid = key.slice('participant:'.length);
			out.set(pid, value);
		}
		return out;
	}

	async #loadMeta(): Promise<Meta> {
		const meta = await this.ctx.storage.get<Meta>('meta');
		if (!meta) {
			// Constructor guarantees meta; this branch only triggers if storage was
			// wiped externally. Rehydrate to a safe default so we still respond.
			throw new Error('meta missing from storage — DO was never constructed correctly');
		}
		return meta;
	}

	async #buildStateMessage(): Promise<StateMessage> {
		const meta = await this.#loadMeta();
		const participants = await this.#loadAllParticipants();
		let currentQuestion: StateMessage['payload']['currentQuestion'];
		let timeLimitSec: number | null = null;
		if (meta.currentQuestionIdx >= 0 && meta.status !== 'lobby' && meta.status !== 'ended') {
			const q = await this.ctx.storage.get<StoredQuestion>(`question:${meta.currentQuestionIdx}`);
			if (q) {
				currentQuestion = {
					qIdx: meta.currentQuestionIdx,
					text: q.text,
					answers: q.answers.map((a, idx) => ({ idx, text: a.text }))
				};
				timeLimitSec = q.timeLimitSec;
			}
		}
		return {
			type: 'state',
			payload: {
				status: meta.status,
				currentQuestionIdx: meta.currentQuestionIdx,
				totalQuestions: meta.totalQuestions,
				questionStartedAtMs: meta.questionStartedAtMs,
				timeLimitSec,
				participants: this.#buildLeaderboard(participants),
				currentQuestion
			}
		};
	}

	#buildLeaderboard(participants: Map<string, StoredParticipant>): ParticipantSummary[] {
		return [...participants.entries()]
			.map(([participantId, p]) => ({ participantId, nickname: p.nickname, score: p.score }))
			.sort((a, b) => b.score - a.score);
	}

	// -----------------------------------------------------------------------
	// HMAC helpers
	// -----------------------------------------------------------------------

	async #getHmacKey(sessionSecret: string): Promise<CryptoKey> {
		if (this.#hmacKey) return this.#hmacKey;
		const keyMaterial = hexToBytes(sessionSecret);
		this.#hmacKey = await crypto.subtle.importKey(
			'raw',
			toArrayBuffer(keyMaterial),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign', 'verify']
		);
		return this.#hmacKey;
	}

	async #signToken(sessionSecret: string, participantId: string): Promise<string> {
		const key = await this.#getHmacKey(sessionSecret);
		const sig = await crypto.subtle.sign(
			'HMAC',
			key,
			toArrayBuffer(new TextEncoder().encode(participantId))
		);
		return bytesToHex(new Uint8Array(sig));
	}

	async #verifyToken(
		sessionSecret: string,
		participantId: string,
		tokenHex: string
	): Promise<boolean> {
		let sigBytes: Uint8Array;
		try {
			sigBytes = hexToBytes(tokenHex);
		} catch {
			return false;
		}
		const key = await this.#getHmacKey(sessionSecret);
		return crypto.subtle.verify(
			'HMAC',
			key,
			toArrayBuffer(sigBytes),
			toArrayBuffer(new TextEncoder().encode(participantId))
		);
	}

	// -----------------------------------------------------------------------
	// Broadcast plumbing
	// -----------------------------------------------------------------------

	#broadcast(msg: OutboundMessage): void {
		const text = JSON.stringify(msg);
		for (const ws of this.ctx.getWebSockets()) {
			try {
				ws.send(text);
			} catch {
				// A dead socket shouldn't take down the broadcast loop.
			}
		}
	}

	#broadcastExcept(except: WebSocket, msg: OutboundMessage): void {
		const text = JSON.stringify(msg);
		for (const ws of this.ctx.getWebSockets()) {
			if (ws === except) continue;
			try {
				ws.send(text);
			} catch {
				// ignore
			}
		}
	}

	#sendTo(ws: WebSocket, msg: OutboundMessage): void {
		try {
			ws.send(JSON.stringify(msg));
		} catch {
			// ignore
		}
	}

	/**
	 * Coalesces answer-count broadcasts on a trailing ≥500ms edge so the host UI
	 * doesn't drown in per-answer updates from a 50-participant session.
	 */
	#scheduleAnswerCountBroadcast(qIdx: number, count: number): void {
		this.#pendingAnswerCount = { qIdx, count };
		if (this.#answerCountFlushTimer !== null) return;
		this.#answerCountFlushTimer = setTimeout(() => {
			this.#answerCountFlushTimer = null;
			const pending = this.#pendingAnswerCount;
			if (!pending) return;
			this.#pendingAnswerCount = null;
			this.#broadcast({
				type: 'answer-count-updated',
				payload: pending
			});
		}, ANSWER_COUNT_COALESCE_MS);
	}

	#jsonError(status: number, code: string, message: string): Response {
		return new Response(JSON.stringify({ code, message }), {
			status,
			headers: { 'content-type': 'application/json' }
		});
	}
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function bytesToHex(bytes: Uint8Array): string {
	let hex = '';
	for (const b of bytes) {
		hex += b.toString(16).padStart(2, '0');
	}
	return hex;
}

function hexToBytes(hex: string): Uint8Array {
	if (hex.length % 2 !== 0) throw new Error('Invalid hex string');
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

function keyPid(key: string): string | null {
	// key format: `answer:{qIdx}:{pid}`
	const parts = key.split(':');
	if (parts.length < 3) return null;
	return parts.slice(2).join(':');
}

/**
 * Canonical form used for nickname uniqueness checks. The raw string is kept on
 * the stored participant for display; dedup only cares about visual collisions,
 * so casing and surrounding whitespace are collapsed.
 */
function normalizeNickname(raw: string): string {
	return raw.trim().toLowerCase();
}

/**
 * Copy a (possibly SharedArrayBuffer-backed) Uint8Array into a fresh ArrayBuffer.
 * The WebCrypto API's type definitions require `BufferSource` with
 * `ArrayBuffer` (not `ArrayBufferLike`), which trips under strict TS. Runtime
 * behavior is identical.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(copy).set(bytes);
	return copy;
}
