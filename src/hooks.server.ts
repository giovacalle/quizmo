import { building } from '$app/environment';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { svelteKitHandler } from 'better-auth/svelte-kit';

import { createAuth } from '$lib/server/auth';
import { isAppError } from '$lib/server/errors';

/**
 * `handle` wires better-auth into every request:
 *   1. Mount a per-request auth instance on `event.locals.auth` — bindings come
 *      from `platform.env`, so the instance MUST be fresh per invocation.
 *   2. Resolve the current session + user via `auth.api.getSession` and expose
 *      `event.locals.user` to load/action functions + `+layout.server.ts` so the
 *      authenticated user id is available everywhere without re-parsing cookies.
 *   3. Hand off to `svelteKitHandler`, which forwards any `/api/auth/*` request
 *      to better-auth's own router AND attaches any Set-Cookie headers emitted
 *      by server actions (sign-in, verify-OTP, sign-out) to the outgoing
 *      Response.
 *
 * During `vite build` the module is evaluated without a real `platform`. The
 * `building` guard short-circuits so static-analysis passes without a binding
 * crash — runtime always has `event.platform` populated.
 */
export const handle: Handle = async ({ event, resolve }) => {
	if (building || !event.platform) {
		return resolve(event);
	}

	const auth = createAuth(event.platform.env);
	event.locals.auth = auth;

	const session = await auth.api.getSession({ headers: event.request.headers });
	event.locals.user = session?.user
		? {
				id: session.user.id,
				email: session.user.email,
				name: session.user.name ?? null
			}
		: null;

	return svelteKitHandler({ event, resolve, auth, building });
};

/**
 * `handleError` runs for unexpected errors during load/endpoint/rendering.
 *
 * By convention, server code throws `AppError('CODE', 'msg')` and route handlers
 * wrap their body in `guardAppError(...)` (from `$lib/server/errors`), which
 * converts to SvelteKit's native `error(status, ...)` BEFORE the framework sees
 * the throw. So in the expected path, `AppError` never reaches this hook —
 * SvelteKit emits the correct HTTP status on its own.
 *
 * What DOES reach this hook:
 *   1. AppError thrown from a path that forgot to use `guardAppError` (a bug).
 *      We log it at info level (console.log) — expected user-facing errors are
 *      not bugs even when surfaced here, and we don't want noisy Sentry-style
 *      alerts in `wrangler tail`.
 *   2. Genuinely unexpected errors (uncaught third-party, DB down, typo). Log
 *      with `console.error` so they show up at the right severity.
 *
 * In both cases return a sanitized `App.Error` for the client so we never leak
 * stack traces or internal messages.
 */
export const handleError: HandleServerError = ({ error: err, event, status, message }) => {
	const where = `${event.request.method} ${event.url.pathname}`;

	if (isAppError(err)) {
		console.log(`[AppError ${err.code}] ${where} :: ${err.message}`);
		return { message: err.message, code: err.code };
	}

	console.error(`[server-error ${status}] ${where} :: ${message}`, err);
	return { message: 'An unexpected error occurred' };
};
