import { fail, redirect } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import * as v from 'valibot';

import { db } from '$lib/server/db/client';
import { answers, questions, quizzes } from '$lib/server/db/schema';
import { quizWithQuestionsSchema } from '$lib/server/db/validators';
import { throwAppError } from '$lib/server/errors';

import type { Actions, PageServerLoad } from './$types';

const JOIN_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const JOIN_CODE_LENGTH = 6;
const JOIN_CODE_MAX_RETRIES = 3;

function generateJoinCode(): string {
	const buf = new Uint8Array(JOIN_CODE_LENGTH);
	crypto.getRandomValues(buf);
	let out = '';
	for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
		const byte = buf[i] ?? 0;
		out += JOIN_CODE_CHARS[byte % JOIN_CODE_CHARS.length] ?? 'A';
	}
	return out;
}

export const load: PageServerLoad = async ({ locals, platform, params }) => {
	if (!platform) return throwAppError('INTERNAL_ERROR', 'Platform bindings missing');
	const user = locals.user;
	if (!user) return throwAppError('UNAUTHENTICATED', 'Sign in required');

	const client = db(platform.env.QUIZMO_DB);
	const quiz = await client
		.select()
		.from(quizzes)
		.where(and(eq(quizzes.id, params.id), eq(quizzes.ownerId, user.id)))
		.get();
	if (!quiz) return throwAppError('NOT_FOUND', 'Quiz not found');

	const qs = await client
		.select()
		.from(questions)
		.where(eq(questions.quizId, quiz.id))
		.orderBy(asc(questions.order))
		.all();

	// Load answers per question. Sequential to keep it simple; quiz size is bounded.
	type AnswerRow = typeof answers.$inferSelect;
	const answersByQuestion: Record<string, AnswerRow[]> = {};
	for (const q of qs) {
		const rows = await client
			.select()
			.from(answers)
			.where(eq(answers.questionId, q.id))
			.orderBy(asc(answers.order))
			.all();
		answersByQuestion[q.id] = rows;
	}

	return {
		quiz,
		initial: {
			title: quiz.title,
			description: quiz.description ?? '',
			questions: qs.map((q) => ({
				text: q.text,
				timeLimitSec: q.timeLimitSec,
				points: q.points,
				answers: (answersByQuestion[q.id] ?? []).map((a) => ({
					text: a.text,
					isCorrect: a.isCorrect
				}))
			}))
		}
	};
};

export const actions: Actions = {
	/**
	 * Update an existing quiz. Simplest correct model: delete the question tree
	 * and re-create it. Quizzes are bounded (≤25 questions × ≤6 answers) so the
	 * cost is modest and the shape matches the client's single-payload submit.
	 */
	update: async ({ locals, platform, params, request }) => {
		if (!platform) return fail(500, { message: 'Platform bindings missing' });
		const user = locals.user;
		if (!user) return fail(401, { message: 'Sign in required' });

		const client = db(platform.env.QUIZMO_DB);
		const existing = await client
			.select({ id: quizzes.id, status: quizzes.status })
			.from(quizzes)
			.where(and(eq(quizzes.id, params.id), eq(quizzes.ownerId, user.id)))
			.get();
		if (!existing) return fail(404, { message: 'Quiz not found' });
		if (existing.status === 'archived') return fail(400, { message: 'Unarchive before editing' });

		const form = await request.formData();
		const raw = form.get('payload');
		if (typeof raw !== 'string') return fail(400, { message: 'Missing payload' });

		let parsedJson: unknown;
		try {
			parsedJson = JSON.parse(raw);
		} catch {
			return fail(400, { message: 'Malformed payload' });
		}

		const parse = v.safeParse(quizWithQuestionsSchema, parsedJson);
		if (!parse.success)
			return fail(400, { message: parse.issues[0]?.message ?? 'Invalid quiz data' });

		const payload = parse.output;
		const now = Date.now();

		await client
			.update(quizzes)
			.set({
				title: payload.title,
				description: payload.description ?? null,
				lastActiveAt: now
			})
			.where(eq(quizzes.id, existing.id))
			.run();

		// Re-create the question tree. FK cascade deletes answers automatically.
		await client.delete(questions).where(eq(questions.quizId, existing.id)).run();

		const questionRows = payload.questions.map((q, qi) => ({
			id: crypto.randomUUID(),
			quizId: existing.id,
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

		return { success: true };
	},

	/**
	 * Start a live session: mint a unique 6-char join code (retry up to 3 times on
	 * unique-violation), write `code:{CODE}` into KV as a read-through cache, flip
	 * the quiz to `active`, boot the DO via `/internal/start`, then redirect to
	 * the host view.
	 */
	startSession: async ({ locals, platform, params }) => {
		if (!platform) return fail(500, { message: 'Platform bindings missing' });
		const user = locals.user;
		if (!user) return fail(401, { message: 'Sign in required' });

		const client = db(platform.env.QUIZMO_DB);
		const quiz = await client
			.select({ id: quizzes.id, status: quizzes.status })
			.from(quizzes)
			.where(and(eq(quizzes.id, params.id), eq(quizzes.ownerId, user.id)))
			.get();
		if (!quiz) return fail(404, { message: 'Quiz not found' });
		if (quiz.status === 'archived')
			return fail(400, { message: 'Unarchive the quiz before starting a session' });

		const sessionId = crypto.randomUUID();
		const now = Date.now();

		let attempts = 0;
		let code: string | null = null;
		while (attempts < JOIN_CODE_MAX_RETRIES) {
			attempts += 1;
			const candidate = generateJoinCode();
			const res = await platform.env.QUIZMO_DB.prepare(
				`INSERT INTO quiz_sessions (id, quiz_id, host_id, code, status, created_at)
				 VALUES (?1, ?2, ?3, ?4, 'lobby', ?5)`
			)
				.bind(sessionId, quiz.id, user.id, candidate, now)
				.run()
				.catch(() => null);
			if (res && res.meta.changes) {
				code = candidate;
				break;
			}
			// Fall through and retry with a fresh candidate.
		}

		if (!code)
			return throwAppError('CONFLICT', 'Could not allocate join code — please retry in a moment');

		// KV cache for O(1) `/join` lookup. D1 remains authoritative; cache miss
		// falls back to D1 by code.
		await platform.env.QUIZMO_QUIZ_KV.put(`code:${code}`, sessionId, { expirationTtl: 3600 });

		// Flip the quiz to `active` (counts toward the 3-active cap) and bump
		// last_active_at for archive heuristics.
		await client
			.update(quizzes)
			.set({ status: 'active', lastActiveAt: now })
			.where(eq(quizzes.id, quiz.id))
			.run();

		// Boot the Durable Object. `/internal/start` seeds meta.quizId, snapshots
		// questions into storage, and arms the first alarm.
		const doId = platform.env.QUIZMO_SESSION.idFromName(sessionId);
		const stub = platform.env.QUIZMO_SESSION.get(doId);
		const bootRes = await stub.fetch(
			new Request('https://do/internal/start', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ quizId: quiz.id })
			})
		);
		if (!bootRes.ok) {
			// Roll the cache back so a partially-started session doesn't get joined.
			await platform.env.QUIZMO_QUIZ_KV.delete(`code:${code}`);
			await platform.env.QUIZMO_DB.prepare('DELETE FROM quiz_sessions WHERE id = ?1')
				.bind(sessionId)
				.run();
			return fail(500, { message: 'Could not start session' });
		}

		throw redirect(303, `/host/${sessionId}`);
	}
};
