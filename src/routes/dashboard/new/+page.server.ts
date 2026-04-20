import { fail, redirect } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms';
import { valibot } from 'sveltekit-superforms/adapters';

import { db } from '$lib/server/db/client';
import { answers, questions } from '$lib/server/db/schema';
import { throwAppError } from '$lib/server/errors';
import { quizWithQuestionsSchema } from '$lib/validators';

import type { Actions, PageServerLoad } from './$types';

/**
 * Seed for a fresh draft: the schema minimums are 3 questions × 2 answers each,
 * so the initial form is structurally valid and the user only has to fill text.
 * Passed to `valibot(..., { defaults })` so `superValidate` returns this shape
 * on first load without emitting minLength errors.
 */
const NEW_QUIZ_DEFAULTS = {
	title: '',
	description: '',
	questions: Array.from({ length: 3 }, () => ({
		text: '',
		timeLimitSec: 20,
		points: 1000,
		answers: [
			{ text: '', isCorrect: true },
			{ text: '', isCorrect: false }
		]
	}))
};

export const load: PageServerLoad = async () => {
	const form = await superValidate(
		valibot(quizWithQuestionsSchema, { defaults: NEW_QUIZ_DEFAULTS })
	);
	return { form };
};

/**
 * Create a quiz with its full question tree. `superValidate` parses the JSON
 * body produced by `dataType: 'json'` on the client and runs the full
 * `quizWithQuestionsSchema` pipe (3-25 questions, 2-6 answers, exactly one
 * correct per question — all business rules).
 *
 * Cap enforcement is TOCTOU-free via a conditional INSERT: we attempt a single
 * `INSERT...SELECT...WHERE (<3 active) AND (<20 non-archived)`, then check
 * `meta.changes` and follow up with COUNTs only on failure to produce the
 * specific AppError message. Archived quizzes don't count against caps.
 */
export const actions: Actions = {
	create: async (event) => {
		const { locals, platform } = event;
		if (!platform) return throwAppError('INTERNAL_ERROR', 'Platform bindings missing');
		const user = locals.user;
		if (!user) return throwAppError('UNAUTHENTICATED', 'Sign in required');

		const form = await superValidate(event, valibot(quizWithQuestionsSchema));
		if (!form.valid) return fail(400, { form });

		const payload = form.data;
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

			const msg =
				(countsRow?.active ?? 0) >= 3
					? 'Active quiz limit reached (3 max)'
					: 'Lifetime quota reached (20 max non-archived)';
			return message(form, msg, { status: 400 });
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
