import { redirect } from '@sveltejs/kit';
import * as v from 'valibot';

import { db } from '$lib/server/db/client';
import { answers, questions } from '$lib/server/db/schema';
import { quizWithQuestionsSchema } from '$lib/server/db/validators';
import { throwAppError } from '$lib/server/errors';

import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return {};
};

/**
 * Create a quiz with its full question tree. The body is JSON-stringified in the
 * client under a single `payload` field so we can decode it straight into the
 * existing `quizWithQuestionsSchema` (which covers 3–25 questions, 2–6 answers,
 * exactly-one-correct-per-question — all business rules).
 *
 * Cap enforcement is TOCTOU-free via a conditional INSERT: we attempt a single
 * INSERT...SELECT...WHERE (<3 active) AND (<20 non-archived), then check
 * `meta.changes` and follow up with COUNTs only on failure to produce the
 * specific AppError message.
 */
export const actions: Actions = {
	create: async ({ locals, platform, request }) => {
		if (!platform) return throwAppError('INTERNAL_ERROR', 'Platform bindings missing');
		const user = locals.user;
		if (!user) return throwAppError('UNAUTHENTICATED', 'Sign in required');

		const form = await request.formData();
		const raw = form.get('payload');
		if (typeof raw !== 'string') return throwAppError('INVALID_INPUT', 'Missing payload');

		let parsedJson: unknown;
		try {
			parsedJson = JSON.parse(raw);
		} catch {
			return throwAppError('INVALID_INPUT', 'Malformed payload');
		}

		const parse = v.safeParse(quizWithQuestionsSchema, parsedJson);
		if (!parse.success) {
			const firstMsg = parse.issues[0]?.message ?? 'Invalid quiz data';
			return throwAppError('INVALID_INPUT', firstMsg);
		}

		const payload = parse.output;
		const now = Date.now();
		const quizId = crypto.randomUUID();
		const d1 = platform.env.QUIZMO_DB;

		// Conditional INSERT — race-safe cap check. `INSERT ... SELECT ... WHERE`
		// evaluates both subqueries against the same transaction snapshot; two
		// concurrent requests at the boundary can never both insert.
		const insertRes = await d1
			.prepare(
				`INSERT INTO quizzes (id, owner_id, title, description, status, created_at, last_active_at)
				 SELECT ?1, ?2, ?3, ?4, 'draft', ?5, ?5
				 WHERE (SELECT COUNT(*) FROM quizzes WHERE owner_id = ?2 AND status = 'active') < 3
				   AND (SELECT COUNT(*) FROM quizzes WHERE owner_id = ?2 AND status != 'archived') < 20`
			)
			.bind(quizId, user.id, payload.title, payload.description ?? null, now)
			.run();

		if (!insertRes.meta.changes) {
			// One of the caps failed. Emit a specific error so the user sees why.
			const countsRow = await d1
				.prepare(
					`SELECT
					   (SELECT COUNT(*) FROM quizzes WHERE owner_id = ?1 AND status = 'active') AS active,
					   (SELECT COUNT(*) FROM quizzes WHERE owner_id = ?1 AND status != 'archived') AS nonArchived`
				)
				.bind(user.id)
				.first<{ active: number; nonArchived: number }>();

			if ((countsRow?.active ?? 0) >= 3)
				return throwAppError('INVALID_INPUT', 'Active quiz limit reached (3 max)');
			return throwAppError('INVALID_INPUT', 'Lifetime quota reached (20 max non-archived)');
		}

		// Persist questions + answers. D1 supports Drizzle's batch API for
		// single-round-trip multi-statement writes.
		const client = db(d1);
		const questionRows = payload.questions.map((q, qi) => ({
			id: crypto.randomUUID(),
			quizId,
			order: qi,
			text: q.text,
			timeLimitSec: q.timeLimitSec,
			points: q.points,
			createdAt: now
		}));

		const answerRows = payload.questions.flatMap((q, qi) =>
			q.answers.map((a, ai) => ({
				id: crypto.randomUUID(),
				questionId: questionRows[qi]!.id,
				order: ai,
				text: a.text,
				isCorrect: a.isCorrect
			}))
		);

		await client.insert(questions).values(questionRows).run();
		await client.insert(answers).values(answerRows).run();

		// Bump the lifetime counter for analytics + nightly archive heuristics.
		await d1
			.prepare('UPDATE users SET quiz_count_lifetime = quiz_count_lifetime + 1 WHERE id = ?1')
			.bind(user.id)
			.run();

		throw redirect(303, `/dashboard/${quizId}`);
	}
};
