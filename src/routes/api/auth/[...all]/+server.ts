import type { RequestHandler } from '@sveltejs/kit';

import { guardAppError } from '$lib/server/errors';

/**
 * Catch-all route that forwards `/api/auth/*` to better-auth's internal router.
 * Better-auth ships its handler via `auth.handler(request)` — that takes the raw
 * `Request` object and returns a `Response`. We delegate both GET and POST so
 * every plugin route (sign-in/email-otp, email-otp/send-verification-otp, etc.)
 * is reachable.
 *
 * Wrapped in `guardAppError` because a misconfigured env (missing
 * BETTER_AUTH_SECRET) throws `AppError('INTERNAL_ERROR', ...)` synchronously
 * during `createAuth` — `guardAppError` converts it into the correct HTTP
 * status instead of a raw 500.
 */
const forward = (event: Parameters<RequestHandler>[0]) =>
	guardAppError(async () => {
		return event.locals.auth.handler(event.request);
	});

export const GET: RequestHandler = (event) => forward(event);
export const POST: RequestHandler = (event) => forward(event);
export const PUT: RequestHandler = (event) => forward(event);
export const PATCH: RequestHandler = (event) => forward(event);
export const DELETE: RequestHandler = (event) => forward(event);
