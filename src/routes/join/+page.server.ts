import { fail, redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { message, setError, superValidate } from 'sveltekit-superforms';
import { valibot } from 'sveltekit-superforms/adapters';

import { bumpRateLimit } from '$lib/server/auth/rate-limit';
import { verifyTurnstile } from '$lib/server/auth/turnstile';
import { db } from '$lib/server/db/client';
import { quizSessions } from '$lib/server/db/schema';
import { httpStatusFor, isAppError, throwAppError, type ErrorCode } from '$lib/server/errors';
import { joinSchema } from '$lib/validators';

/**
 * superforms' `message()` / `setError()` constrains `status` to its internal
 * `NumericRange<400, 599>` union. `httpStatusFor` returns a plain `number`, so
 * we narrow once here instead of sprinkling casts at every call site.
 */
const statusFor = (code: ErrorCode) => httpStatusFor(code) as 400 | 401 | 403 | 404 | 409 | 500;

/**
 * Join route — public, unauthenticated. Participants enter a 6-char join code
 * plus a nickname, solve a Turnstile challenge, and get redirected to
 * /play/[sessionId]. The session id is resolved via KV (read-through cache) and
 * then D1 as the authority; KV is populated with 1h TTL on miss.
 */

export const load: ServerLoad = async ({ platform }) => {
	const env = platform?.env as { TURNSTILE_SITE_KEY?: string } | undefined;
	const form = await superValidate(valibot(joinSchema));
	return { form, turnstileSiteKey: env?.TURNSTILE_SITE_KEY ?? '' };
};

export const actions: Actions = {
	default: async (event) => {
		const form = await superValidate(event, valibot(joinSchema));
		if (!form.valid) return fail(400, { form });

		const { platform, getClientAddress } = event;
		if (!platform)
			return message(form, 'Platform bindings missing', { status: statusFor('INTERNAL_ERROR') });

		const { code, nickname, turnstileToken } = form.data;

		// Turnstile FIRST — so a scripted request with no token never touches KV/D1.
		const turnstileSecret =
			(platform.env as unknown as { TURNSTILE_SECRET_KEY?: string })?.TURNSTILE_SECRET_KEY ?? '';
		const ip = getClientAddress();
		const turnstileResult = await verifyTurnstile(turnstileSecret, turnstileToken, ip);
		if (turnstileResult.isErr()) {
			return setError(form, 'turnstileToken', turnstileResult.error.message, { status: 400 });
		}

		// Per-IP rate limit: 20 joins / hour. Key prefix `rl:ip:join:` — distinct
		// from the auth-side `rl:ip:send` / `rl:ip:verify`.
		try {
			await bumpRateLimit(
				platform.env.QUIZMO_AUTH_KV,
				`rl:ip:join:${ip}`,
				20,
				'Too many join attempts from this connection. Try again in an hour.'
			);

			// Resolve code → sessionId. Try KV first, fall back to D1, then cache.
			const kv = platform.env.QUIZMO_QUIZ_KV;
			const cacheKey = `code:${code}`;
			let sessionId = await kv.get(cacheKey);
			if (!sessionId) {
				const session = await db(platform.env.QUIZMO_DB)
					.select({ id: quizSessions.id, status: quizSessions.status })
					.from(quizSessions)
					.where(eq(quizSessions.code, code))
					.get();
				if (!session || session.status === 'ended' || session.status === 'archived')
					return throwAppError('NOT_FOUND', 'Quiz not found or already ended');
				sessionId = session.id;
				await kv.put(cacheKey, sessionId, { expirationTtl: 3600 });
			} else {
				// KV cache hit — revalidate once to make sure the session isn't ended.
				// This costs one D1 read per cached hit and guarantees we never send a
				// player to /play for a dead session.
				const session = await db(platform.env.QUIZMO_DB)
					.select({ status: quizSessions.status })
					.from(quizSessions)
					.where(eq(quizSessions.id, sessionId))
					.get();
				if (!session || session.status === 'ended' || session.status === 'archived') {
					// Dead cache entry — delete so the next caller re-hits D1 and gets NOT_FOUND.
					await kv.delete(cacheKey);
					throwAppError('NOT_FOUND', 'Quiz not found or already ended');
				}
			}

			// Demo-grade same-browser rejoin guard: if this browser already joined this
			// session, block the submit. Incognito bypasses (cookie store is fresh) —
			// that's accepted scope. Nickname dedup inside the DO catches the other
			// common vector as defense-in-depth.
			const joinCookieName = `quizmo-joined-${sessionId}`;
			if (event.cookies.get(joinCookieName))
				throwAppError('CONFLICT', 'You have already joined this quiz from this browser');

			event.cookies.set(joinCookieName, '1', {
				path: '/',
				httpOnly: true,
				secure: true,
				sameSite: 'strict',
				maxAge: 60 * 60 * 4
			});

			throw redirect(303, `/play/${sessionId}?nick=${encodeURIComponent(nickname)}`);
		} catch (e) {
			if (isAppError(e)) return message(form, e.message, { status: statusFor(e.code) });
			throw e;
		}
	}
};
