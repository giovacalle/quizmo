import { ResultAsync } from 'neverthrow';

import { AppError } from '$lib/server/errors';

/**
 * Server-side Turnstile verifier. Called before any rate-limit check or Resend call
 * in the `/login` sendOtp action, so a DOM-stripped form submission gets rejected
 * without touching Resend.
 *
 * Returns a `Result<{success: true}, AppError>` — callers use `.match` or `.isErr`
 * to surface the AppError via `guardAppError` / form action failure. See
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 * for the response shape.
 */

const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

type TurnstileResponse = {
	success: boolean;
	'error-codes'?: string[];
	challenge_ts?: string;
	hostname?: string;
	action?: string;
	cdata?: string;
};

export function verifyTurnstile(
	secret: string,
	token: string,
	remoteIp: string | null
): ResultAsync<{ success: true }, AppError> {
	// If the secret is missing (wrangler.jsonc stub empty, or a dev skipping setup),
	// fail closed rather than silently let bots through. This surfaces as an inline
	// AppError so the /login UI shows a clear "Verification failed" message.
	if (!secret) {
		return ResultAsync.fromSafePromise(Promise.resolve(undefined as never)).andThen(() =>
			ResultAsync.fromPromise(
				Promise.reject(new AppError('INVALID_INPUT', 'Verification failed — please try again')),
				(e) => e as AppError
			)
		);
	}

	const body = new URLSearchParams();
	body.set('secret', secret);
	body.set('response', token);
	if (remoteIp) body.set('remoteip', remoteIp);

	return ResultAsync.fromPromise(
		fetch(TURNSTILE_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body
		}).then(async (res) => {
			const payload = (await res.json()) as TurnstileResponse;
			if (!payload.success)
				throw new AppError('INVALID_INPUT', 'Verification failed — please try again');
			return { success: true as const };
		}),
		(e) =>
			e instanceof AppError ? e : new AppError('INTERNAL_ERROR', 'Could not verify Turnstile')
	);
}
