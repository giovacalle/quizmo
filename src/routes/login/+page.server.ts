import { fail, redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import * as v from 'valibot';

import { enforceRateLimit, hashEmail } from '$lib/server/auth/rate-limit';
import { verifyTurnstile } from '$lib/server/auth/turnstile';
import { emailSchema, otpCodeSchema } from '$lib/server/db/validators';
import { type ErrorCode, isAppError } from '$lib/server/errors';

/**
 * Login route server file. Two actions mirror the two-step UI:
 *   sendOtp - validate email + Turnstile, rate-limit, trigger better-auth to
 *             generate + email the 6-digit code.
 *   verifyOtp - validate code, rate-limit per IP, verify via better-auth. On
 *               success, better-auth sets the session cookie (via
 *               `sveltekitCookies`) and we redirect to /dashboard.
 *
 * All errors surface inline via SvelteKit's `fail(status, body)`, shaped like
 * `{ code, message, email? }`. This matches the App.Error envelope the client
 * consumes — no raw throws inside the actions (except the `redirect(303)` on
 * success, which SvelteKit explicitly treats as a control-flow signal).
 */

const sendOtpSchema = v.object({
	email: emailSchema,
	turnstileToken: v.pipe(v.string(), v.minLength(1, 'Please complete the verification'))
});

const verifyOtpSchema = v.object({
	email: emailSchema,
	otp: otpCodeSchema
});

/**
 * Authenticated users shouldn't see the login page — skip straight to dashboard.
 * (Dashboard doesn't exist yet; it. The redirect path is stable.)
 */
export const load: ServerLoad = async ({ locals }) => {
	if (locals.user) throw redirect(303, '/dashboard');
	return {};
};

export const actions: Actions = {
	sendOtp: async (event) => {
		const { request, locals, platform, getClientAddress } = event;
		const formData = await request.formData();

		const parsed = v.safeParse(sendOtpSchema, {
			email: formData.get('email'),
			turnstileToken: formData.get('turnstileToken')
		});
		if (!parsed.success) {
			return fail(400, {
				step: 'send' as const,
				code: 'INVALID_INPUT' satisfies ErrorCode,
				message: parsed.issues[0]?.message ?? 'Please check the form and try again',
				email: asString(formData.get('email'))
			});
		}

		const { email, turnstileToken } = parsed.output;

		// Turnstile FIRST — so a scripted request without a token never touches
		// Resend or the rate-limit counters.
		const turnstileSecret =
			(platform?.env as unknown as { TURNSTILE_SECRET_KEY?: string })?.TURNSTILE_SECRET_KEY ?? '';
		const ip = getClientAddress();
		const turnstileResult = await verifyTurnstile(turnstileSecret, turnstileToken, ip);
		if (turnstileResult.isErr()) {
			return fail(400, {
				step: 'send' as const,
				code: turnstileResult.error.code,
				message: turnstileResult.error.message,
				email
			});
		}

		// Rate limits: email-bound (3/hr) + IP-bound (20/hr). `enforceRateLimit`
		// throws `AppError('INVALID_INPUT', ...)` when exceeded — we catch and
		// convert to a `fail()` so the message lands inline in the form.
		const kv = platform!.env.QUIZMO_AUTH_KV;
		const appErrFail = await runAuthStep('send', email, async () => {
			const emailKey = await hashEmail(email);
			await enforceRateLimit(kv, 'send-email', emailKey);
			await enforceRateLimit(kv, 'send-ip', ip);
			// better-auth's API takes the headers object — we synthesize a minimal
			// Headers to keep the plugin happy. The plugin emits the email via Resend
			// inside `sendVerificationOTP` (see config.ts).
			await locals.auth.api.sendVerificationOTP({
				body: { email, type: 'sign-in' },
				headers: request.headers
			});
		});
		if (appErrFail) return appErrFail;

		return { step: 'verify' as const, email };
	},

	verifyOtp: async (event) => {
		const { request, locals, platform, getClientAddress } = event;
		const formData = await request.formData();

		const parsed = v.safeParse(verifyOtpSchema, {
			email: formData.get('email'),
			otp: formData.get('otp')
		});
		if (!parsed.success) {
			return fail(400, {
				step: 'verify' as const,
				code: 'INVALID_INPUT' satisfies ErrorCode,
				message: parsed.issues[0]?.message ?? 'Please enter a valid code',
				email: asString(formData.get('email'))
			});
		}

		const { email, otp } = parsed.output;
		const ip = getClientAddress();
		const kv = platform!.env.QUIZMO_AUTH_KV;

		const failResult = await runAuthStep('verify', email, async () => {
			await enforceRateLimit(kv, 'verify-ip', ip);
			await locals.auth.api.signInEmailOTP({
				body: { email, otp },
				headers: request.headers
			});
		});
		if (failResult) return failResult;

		// Success — better-auth attached the session cookie to the outgoing
		// response via `sveltekitCookies`. Redirect to dashboard.
		throw redirect(303, '/dashboard');
	}
};

/**
 * Runs the auth-side effect and converts any thrown `AppError` / unexpected
 * error into the action-failure envelope. Better-auth's own errors (bad code,
 * expired code, etc.) come through as either `APIError` with a `.status` or a
 * generic Error — we surface their message inline.
 */
async function runAuthStep(
	step: 'send' | 'verify',
	email: string,
	fn: () => Promise<void>
): Promise<ReturnType<typeof fail> | null> {
	try {
		await fn();
		return null;
	} catch (e) {
		if (isAppError(e)) {
			return fail(e.code === 'INTERNAL_ERROR' ? 500 : 400, {
				step,
				code: e.code,
				message: e.message,
				email
			});
		}
		// Better-auth's APIError exposes `{message, status}` on thrown errors.
		const maybe = e as { message?: string; status?: number; statusCode?: number };
		const msg = maybe?.message ?? 'Something went wrong. Please try again.';
		const status = maybe?.status ?? maybe?.statusCode ?? 400;
		return fail(status, {
			step,
			code: 'INVALID_INPUT' satisfies ErrorCode,
			message: msg,
			email
		});
	}
}

function asString(value: FormDataEntryValue | null): string {
	return typeof value === 'string' ? value : '';
}
