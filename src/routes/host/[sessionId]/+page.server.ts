import { eq } from 'drizzle-orm';

import { db } from '$lib/server/db/client';
import { quizSessions } from '$lib/server/db/schema';
import { throwAppError } from '$lib/server/errors';

import type { PageServerLoad } from './$types';

/**
 * Host view guard + bootstrap. We verify host ownership server-side so a share
 * of the URL to a non-host user returns 403 on SSR. The page then opens a
 * WebSocket to the DO with `?role=host`, which the `/api/session/:id/ws` route
 * independently re-validates against the same ownership check (belt+suspenders).
 */
export const load: PageServerLoad = async ({ locals, platform, params }) => {
	if (!platform) return throwAppError('INTERNAL_ERROR', 'Platform bindings missing');
	const user = locals.user;
	if (!user) return throwAppError('UNAUTHENTICATED', 'Sign in required');

	const session = await db(platform.env.QUIZMO_DB)
		.select()
		.from(quizSessions)
		.where(eq(quizSessions.id, params.sessionId))
		.get();
	if (!session) return throwAppError('NOT_FOUND', 'Session not found');
	if (session.hostId !== user.id)
		return throwAppError('FORBIDDEN', 'Only the host can open this view');

	return {
		sessionId: session.id,
		joinCode: session.code,
		quizId: session.quizId,
		initialStatus: session.status
	};
};
