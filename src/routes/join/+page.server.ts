import { fail, redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';

import { bumpRateLimit } from '$lib/server/auth/rate-limit';
import { verifyTurnstile } from '$lib/server/auth/turnstile';
import { db } from '$lib/server/db/client';
import { quizSessions } from '$lib/server/db/schema';
import { joinCodeSchema, nicknameSchema } from '$lib/server/db/validators';
import { isAppError, type ErrorCode } from '$lib/server/errors';

/**
 * Join route — public, unauthenticated. Participants enter a 6-char join code
 * plus a nickname, solve a Turnstile challenge, and get redirected to
 * /play/[sessionId]. The session id is resolved via KV (read-through cache) and
 * then D1 as the authority; KV is populated with 1h TTL on miss.
 */

const joinPayloadSchema = v.object({
	code: joinCodeSchema,
	nickname: nicknameSchema,
	turnstileToken: v.pipe(v.string(), v.minLength(1, 'Please complete the verification'))
});

export const load: ServerLoad = async ({ platform }) => {
	const env = platform?.env as { TURNSTILE_SITE_KEY?: string } | undefined;
	return { turnstileSiteKey: env?.TURNSTILE_SITE_KEY ?? '' };
};

export const actions: Actions = {
	default: async (event) => {
		const { request, platform, getClientAddress } = event;
		const formData = await request.formData();

		const rawCode = asString(formData.get('code')).trim().toUpperCase();
		const rawNickname = asString(formData.get('nickname'));
		const turnstileToken = asString(formData.get('turnstileToken'));

		const parsed = v.safeParse(joinPayloadSchema, {
			code: rawCode,
			nickname: rawNickname,
			turnstileToken
		});
		if (!parsed.success) {
			return fail(400, {
				code: 'INVALID_INPUT' satisfies ErrorCode,
				message: parsed.issues[0]?.message ?? 'Please check the form and try again',
				values: { code: rawCode, nickname: rawNickname }
			});
		}
		const { code, nickname } = parsed.output;

		if (!platform) {
			return fail(500, {
				code: 'INTERNAL_ERROR' satisfies ErrorCode,
				message: 'Platform bindings missing',
				values: { code, nickname }
			});
		}

		// Turnstile FIRST — so a scripted request with no token never touches KV/D1.
		const turnstileSecret =
			(platform.env as unknown as { TURNSTILE_SECRET_KEY?: string })?.TURNSTILE_SECRET_KEY ?? '';
		const ip = getClientAddress();
		const turnstileResult = await verifyTurnstile(turnstileSecret, turnstileToken, ip);
		if (turnstileResult.isErr()) {
			return fail(400, {
				code: turnstileResult.error.code,
				message: turnstileResult.error.message,
				values: { code, nickname }
			});
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
		} catch (e) {
			if (isAppError(e)) {
				return fail(400, {
					code: e.code,
					message: e.message,
					values: { code, nickname }
				});
			}
			throw e;
		}

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
			if (!session || session.status === 'ended' || session.status === 'archived') {
				return fail(404, {
					code: 'NOT_FOUND' satisfies ErrorCode,
					message: 'Quiz not found or already ended',
					values: { code, nickname }
				});
			}
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
				return fail(404, {
					code: 'NOT_FOUND' satisfies ErrorCode,
					message: 'Quiz not found or already ended',
					values: { code, nickname }
				});
			}
		}

		throw redirect(303, `/play/${sessionId}?nick=${encodeURIComponent(nickname)}`);
	}
};

function asString(value: FormDataEntryValue | null): string {
	return typeof value === 'string' ? value : '';
}
