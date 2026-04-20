/**
 * WebSocket message protocol for the QuizSession Durable Object.
 *
 * Wire format: JSON `{type, payload}`. Every message is validated with Valibot on
 * arrival so malformed/attacker payloads never flow into state mutations. The
 * discriminated-union types below double as documentation for the host and
 * participant clients.
 *
 * Direction matrix:
 *   Server → Client: state, participant-joined, participant-left, question-started,
 *                    answer-count-updated, reveal, ended, error
 *   Client → Server: join, submit-answer, reconnect (participant-origin)
 *                    host-start, host-advance, host-reveal, host-end (host-origin)
 */
import * as v from 'valibot';

import { nicknameSchema } from '$lib/validators';

// ---------------------------------------------------------------------------
// Inbound (client → DO) — Valibot schemas + inferred TS unions
// ---------------------------------------------------------------------------

const joinSchema = v.object({
	type: v.literal('join'),
	payload: v.object({ nickname: nicknameSchema })
});

const submitAnswerSchema = v.object({
	type: v.literal('submit-answer'),
	payload: v.object({
		qIdx: v.pipe(v.number(), v.integer(), v.minValue(0)),
		choice: v.pipe(v.number(), v.integer(), v.minValue(0))
	})
});

const reconnectSchema = v.object({
	type: v.literal('reconnect'),
	payload: v.object({
		participantId: v.pipe(v.string(), v.minLength(1)),
		participantToken: v.pipe(v.string(), v.regex(/^[0-9a-f]+$/i))
	})
});

const hostStartSchema = v.object({
	type: v.literal('host-start'),
	payload: v.optional(v.object({}))
});

const hostAdvanceSchema = v.object({
	type: v.literal('host-advance'),
	payload: v.optional(v.object({}))
});

const hostRevealSchema = v.object({
	type: v.literal('host-reveal'),
	payload: v.optional(v.object({}))
});

const hostEndSchema = v.object({
	type: v.literal('host-end'),
	payload: v.optional(v.object({}))
});

/**
 * Variant union accepted on the socket. `safeParse` at the call site — any parse
 * failure is reported back to the sender as `{type:'error', code:'INVALID_INPUT'}`
 * without advancing DO state.
 */
export const inboundMessageSchema = v.variant('type', [
	joinSchema,
	submitAnswerSchema,
	reconnectSchema,
	hostStartSchema,
	hostAdvanceSchema,
	hostRevealSchema,
	hostEndSchema
]);

export type InboundMessage = v.InferOutput<typeof inboundMessageSchema>;
export type JoinMessage = v.InferOutput<typeof joinSchema>;
export type SubmitAnswerMessage = v.InferOutput<typeof submitAnswerSchema>;
export type ReconnectMessage = v.InferOutput<typeof reconnectSchema>;

// ---------------------------------------------------------------------------
// Outbound (DO → client) — TS types only (no validation needed server-side)
// ---------------------------------------------------------------------------

export type SessionStatus = 'lobby' | 'active' | 'revealing' | 'ended';

/** Lightweight participant summary shared across broadcasts. */
export interface ParticipantSummary {
	participantId: string;
	nickname: string;
	score: number;
}

/** Full state snapshot used for initial sync on join + reconnect. */
export interface StateMessage {
	type: 'state';
	payload: {
		status: SessionStatus;
		currentQuestionIdx: number;
		totalQuestions: number;
		questionStartedAtMs: number | null;
		timeLimitSec: number | null;
		participants: ParticipantSummary[];
		/** Only present on the initial `join` reply to the newly joined socket. */
		participantId?: string;
		participantToken?: string;
		/** Only present on `active` / `revealing`; mirrors `question:{idx}` minus correctIdx. */
		currentQuestion?: {
			qIdx: number;
			text: string;
			answers: { idx: number; text: string }[];
		};
	};
}

export interface ParticipantJoinedMessage {
	type: 'participant-joined';
	payload: { participantId: string; nickname: string };
}

export interface ParticipantLeftMessage {
	type: 'participant-left';
	payload: { participantId: string };
}

export interface QuestionStartedMessage {
	type: 'question-started';
	payload: {
		qIdx: number;
		text: string;
		answers: { idx: number; text: string }[];
		timeLimitSec: number;
		points: number;
		questionStartedAtMs: number;
	};
}

export interface AnswerCountUpdatedMessage {
	type: 'answer-count-updated';
	payload: { qIdx: number; count: number };
}

export interface RevealMessage {
	type: 'reveal';
	payload: {
		qIdx: number;
		correctIdx: number;
		perParticipantDelta: { participantId: string; scoreDelta: number; correct: boolean }[];
		leaderboard: ParticipantSummary[];
	};
}

export interface EndedMessage {
	type: 'ended';
	payload: { finalLeaderboard: ParticipantSummary[] };
}

export interface ErrorMessage {
	type: 'error';
	payload: { code: string; message: string };
}

export type OutboundMessage =
	| StateMessage
	| ParticipantJoinedMessage
	| ParticipantLeftMessage
	| QuestionStartedMessage
	| AnswerCountUpdatedMessage
	| RevealMessage
	| EndedMessage
	| ErrorMessage;
