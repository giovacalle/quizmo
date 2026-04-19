import { redirect, type ServerLoad } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';

import { db } from '$lib/server/db/client';
import { quizSessions } from '$lib/server/db/schema';
import { guardAppError, throwAppError } from '$lib/server/errors';

/**
 * Play route load — verifies the session exists and is live. Participant
 * identity is entirely client-side (HMAC token in sessionStorage); this load
 * only exists to 404 fast for a bogus / ended sessionId. The nickname flows in
 * through the `?nick=` query param (server-signed via /join + Turnstile).
 */
export const load: ServerLoad = async (event) =>
	guardAppError(async () => {
		const { params, platform, url } = event;
		const sessionId = params.sessionId;
		if (!sessionId) throwAppError('INVALID_INPUT', 'Missing session id');
		if (!platform) throwAppError('INTERNAL_ERROR', 'Platform bindings missing');

		const session = await db(platform!.env.QUIZMO_DB)
			.select({ id: quizSessions.id, status: quizSessions.status })
			.from(quizSessions)
			.where(eq(quizSessions.id, sessionId!))
			.get();
		if (!session || session.status === 'ended' || session.status === 'archived') {
			throwAppError('NOT_FOUND', 'Quiz not found or already ended');
		}

		const nick = url.searchParams.get('nick')?.trim() ?? '';
		if (!nick) {
			// Route through /join so they solve Turnstile + pick a nickname.
			throw redirect(303, '/join');
		}

		return {
			sessionId: sessionId!,
			nickname: nick
		};
	});
