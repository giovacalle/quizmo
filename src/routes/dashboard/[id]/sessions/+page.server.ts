import { and, eq } from 'drizzle-orm';

import { db } from '$lib/server/db/client';
import { quizzes } from '$lib/server/db/schema';
import { throwAppError } from '$lib/server/errors';

import type { PageServerLoad } from './$types';

/**
 * Past-sessions list for a quiz. Ownership is re-checked here even though the
 * parent `+layout.server.ts` already gates on `locals.user`, because a signed-in
 * user must still not be able to enumerate sessions of quizzes they don't own.
 * Falling back to `NOT_FOUND` (not `FORBIDDEN`) avoids leaking quiz existence.
 *
 * The session list uses a single D1 round-trip with correlated subqueries for
 * participant_count + winner (highest score, earliest `joined_at` as tiebreak).
 * Drizzle's query builder can express this, but raw `prepare().bind().all()`
 * keeps the SQL obvious and matches the pattern already used by
 * `dashboard/new/+page.server.ts`.
 */

interface SessionRow {
	id: string;
	code: string;
	status: 'lobby' | 'active' | 'revealing' | 'ended' | 'archived';
	started_at: number | null;
	ended_at: number | null;
	participant_count: number;
	winner_nickname: string | null;
	winner_score: number | null;
}

export const load: PageServerLoad = async ({ locals, platform, params }) => {
	if (!platform) return throwAppError('INTERNAL_ERROR', 'Platform bindings missing');
	const user = locals.user;
	if (!user) return throwAppError('UNAUTHENTICATED', 'Sign in required');

	const client = db(platform.env.QUIZMO_DB);
	const quiz = await client
		.select({ id: quizzes.id, title: quizzes.title })
		.from(quizzes)
		.where(and(eq(quizzes.id, params.id), eq(quizzes.ownerId, user.id)))
		.get();
	if (!quiz) return throwAppError('NOT_FOUND', 'Quiz not found');

	const sessionsRes = await platform.env.QUIZMO_DB.prepare(
		`SELECT
		   qs.id,
		   qs.code,
		   qs.status,
		   qs.started_at,
		   qs.ended_at,
		   (SELECT COUNT(*) FROM participants p WHERE p.session_id = qs.id) AS participant_count,
		   (SELECT p.nickname FROM participants p
		      WHERE p.session_id = qs.id
		      ORDER BY p.score DESC, p.joined_at ASC LIMIT 1) AS winner_nickname,
		   (SELECT p.score FROM participants p
		      WHERE p.session_id = qs.id
		      ORDER BY p.score DESC, p.joined_at ASC LIMIT 1) AS winner_score
		 FROM quiz_sessions qs
		 WHERE qs.quiz_id = ?1
		 ORDER BY qs.started_at DESC NULLS LAST, qs.id DESC`
	)
		.bind(quiz.id)
		.all<SessionRow>();

	const sessions = (sessionsRes.results ?? []).map((r) => ({
		id: r.id,
		code: r.code,
		status: r.status,
		startedAt: r.started_at,
		endedAt: r.ended_at,
		participantCount: r.participant_count,
		winnerNickname: r.winner_nickname,
		winnerScore: r.winner_score
	}));

	return {
		quiz: { id: quiz.id, title: quiz.title },
		sessions
	};
};
