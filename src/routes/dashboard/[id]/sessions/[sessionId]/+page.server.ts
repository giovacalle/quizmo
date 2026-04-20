import { throwAppError } from '$lib/server/errors';

import type { PageServerLoad } from './$types';

/**
 * Historical session-detail view. The parent `+layout.server.ts` already gates
 * on `locals.user`, but we re-check here + use `NOT_FOUND` (never `FORBIDDEN`)
 * when the quiz/session doesn't belong to the caller — leaking "session exists
 * but you can't see it" would let an enumerator map someone else's history.
 *
 * The ownership chain is verified in one D1 round-trip: the session must
 * belong to the URL's quiz AND the quiz must belong to the caller. Participant
 * list is fetched in a second query sorted by final leaderboard order (score
 * desc, then earliest join as the stable tiebreak — matches the list page's
 * winner calculation).
 */

interface SessionRow {
	id: string;
	code: string;
	status: 'lobby' | 'active' | 'revealing' | 'ended' | 'archived';
	started_at: number | null;
	ended_at: number | null;
	quiz_id: string;
	quiz_title: string;
	owner_id: string;
}

interface ParticipantRow {
	id: string;
	nickname: string;
	score: number;
	joined_at: number;
}

export const load: PageServerLoad = async ({ locals, platform, params }) => {
	if (!platform) return throwAppError('INTERNAL_ERROR', 'Platform bindings missing');
	const user = locals.user;
	if (!user) return throwAppError('UNAUTHENTICATED', 'Sign in required');

	const row = await platform.env.QUIZMO_DB.prepare(
		`SELECT qs.id, qs.code, qs.status, qs.started_at, qs.ended_at,
		        q.id AS quiz_id, q.title AS quiz_title, q.owner_id
		   FROM quiz_sessions qs
		   JOIN quizzes q ON q.id = qs.quiz_id
		  WHERE qs.id = ?1 AND qs.quiz_id = ?2
		  LIMIT 1`
	)
		.bind(params.sessionId, params.id)
		.first<SessionRow>();

	if (!row || row.owner_id !== user.id) return throwAppError('NOT_FOUND', 'Session not found');

	const participantsRes = await platform.env.QUIZMO_DB.prepare(
		`SELECT id, nickname, score, joined_at
		   FROM participants
		  WHERE session_id = ?1
		  ORDER BY score DESC, joined_at ASC`
	)
		.bind(row.id)
		.all<ParticipantRow>();

	const participants = (participantsRes.results ?? []).map((p) => ({
		id: p.id,
		nickname: p.nickname,
		score: p.score,
		joinedAt: p.joined_at
	}));

	return {
		quiz: { id: row.quiz_id, title: row.quiz_title },
		session: {
			id: row.id,
			code: row.code,
			status: row.status,
			startedAt: row.started_at,
			endedAt: row.ended_at
		},
		participants
	};
};
