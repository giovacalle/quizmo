import { fail } from '@sveltejs/kit';
import { and, desc, eq, ne } from 'drizzle-orm';

import { db } from '$lib/server/db/client';
import { quizzes } from '$lib/server/db/schema';
import { throwAppError } from '$lib/server/errors';

import type { Actions, PageServerLoad } from './$types';

/**
 * Load the signed-in host's non-archived quizzes. The dashboard surfaces both the
 * active-quiz cap (≤3) and the non-archived cap (≤20) so the user never hits a
 * hidden TOCTOU rejection from the create flow.
 */
export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!platform) return throwAppError('INTERNAL_ERROR', 'Platform bindings missing');
	const user = locals.user;
	if (!user) return throwAppError('UNAUTHENTICATED', 'Sign in required');

	const rows = await db(platform.env.QUIZMO_DB)
		.select()
		.from(quizzes)
		.where(and(eq(quizzes.ownerId, user.id), ne(quizzes.status, 'archived')))
		.orderBy(desc(quizzes.lastActiveAt))
		.all();

	const activeCount = rows.filter((r) => r.status === 'active').length;
	const nonArchivedCount = rows.length;

	return { rows, activeCount, nonArchivedCount };
};

/**
 * Delete a quiz owned by the current host. FK cascades in the schema drop the
 * child questions + answers + any session history in one DB round-trip.
 */
export const actions: Actions = {
	deleteQuiz: async ({ locals, platform, request }) => {
		if (!platform) return fail(500, { message: 'Platform bindings missing' });
		const user = locals.user;
		if (!user) return fail(401, { message: 'Sign in required' });

		const form = await request.formData();
		const quizId = form.get('quizId');
		if (typeof quizId !== 'string' || quizId.length === 0)
			return fail(400, { message: 'Missing quiz id' });

		await db(platform.env.QUIZMO_DB)
			.delete(quizzes)
			.where(and(eq(quizzes.id, quizId), eq(quizzes.ownerId, user.id)))
			.run();

		return { success: true };
	}
};
