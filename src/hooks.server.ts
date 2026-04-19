import type { HandleServerError } from '@sveltejs/kit';

import { isAppError } from '$lib/server/errors';

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
