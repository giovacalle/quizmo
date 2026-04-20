import { redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { fail, message, setError, superValidate, type SuperValidated } from 'sveltekit-superforms';
import { valibot } from 'sveltekit-superforms/adapters';

import { enforceRateLimit, hashEmail } from '$lib/server/auth/rate-limit';
import { verifyTurnstile } from '$lib/server/auth/turnstile';
import { httpStatusFor, isAppError, type ErrorCode } from '$lib/server/errors';
import { loginWizardSchema, type LoginWizardOutput } from '$lib/validators';

/**
 * Login route. A single form backed by `loginWizardSchema` (a `v.variant('step', …)`
 * discriminated union) drives a two-step UX:
 *   step=send   — validate email + Turnstile, rate-limit, trigger better-auth to
 *                 generate + email the 6-digit code; on success flip `form.data.step`
 *                 to 'verify' so the client re-renders as step 2.
 *   step=verify — validate the 6-digit code, rate-limit per IP, verify via
 *                 better-auth; on success the auth plugin attaches the session
 *                 cookie and we redirect to /dashboard.
 *
 * All user-fixable failures come back inline via superforms (`setError` for field
 * errors, `message(form, …, { status })` for toast-level rate-limit / Turnstile
 * denials). Only the `redirect(303)` on full success escapes via `throw`.
 */

export type LoginMessage =
	| { kind: 'advanced'; text: string }
	| { kind: 'error'; text: string; code?: ErrorCode };

type LoginForm = SuperValidated<LoginWizardOutput, LoginMessage>;

export const load: ServerLoad = async ({ locals }) => {
	if (locals.user) throw redirect(303, '/dashboard');
	// Variant schemas can't auto-derive a single default branch — seed the 'send'
	// shape explicitly so the client mounts in step 1.
	const form = await superValidate<LoginWizardOutput, LoginMessage>(valibot(loginWizardSchema), {
		defaults: { step: 'send', email: '', turnstileToken: '' }
	});
	return { form };
};

export const actions: Actions = {
	default: async (event) => {
		const form = await superValidate<LoginWizardOutput, LoginMessage>(
			event,
			valibot(loginWizardSchema)
		);
		// Valibot's variant discriminator rejects malformed branches (wrong shape
		// per step) before we get here; also covers bad email / empty Turnstile /
		// bad OTP shape.
		if (!form.valid) return fail(400, { form });

		const { request, locals, platform, getClientAddress } = event;
		const ip = getClientAddress();
		const kv = platform!.env.QUIZMO_AUTH_KV;

		if (form.data.step === 'send') {
			const { email, turnstileToken } = form.data;

			// Turnstile FIRST — so a scripted request without a token never touches
			// Resend or the rate-limit counters. Rate-limit is a fallback layer.
			const turnstileSecret =
				(platform?.env as unknown as { TURNSTILE_SECRET_KEY?: string })?.TURNSTILE_SECRET_KEY ?? '';
			const turnstileResult = await verifyTurnstile(turnstileSecret, turnstileToken, ip);
			if (turnstileResult.isErr())
				return setError(form, 'turnstileToken', turnstileResult.error.message, { status: 400 });

			// Rate limits: email-bound (3/hr) + IP-bound (20/hr). `enforceRateLimit`
			// throws `AppError('INVALID_INPUT', …)` when exceeded; `runAuthStep`
			// converts it to the right superforms envelope.
			const stepFail = await runAuthStep(form, 'send', async () => {
				const emailKey = await hashEmail(email);
				await enforceRateLimit(kv, 'send-email', emailKey);
				await enforceRateLimit(kv, 'send-ip', ip);
				// better-auth's API takes the raw Headers — the plugin emits the email
				// via Resend inside `sendVerificationOTP` (see auth/config.ts).
				await locals.auth.api.sendVerificationOTP({
					body: { email, type: 'sign-in' },
					headers: request.headers
				});
			});
			if (stepFail) return stepFail;

			// Advance the step in-place; superforms ships `form.data` back so the
			// client sees `$formData.step === 'verify'` in its `onUpdated` callback
			// and re-renders the code input.
			form.data = { step: 'verify', email, code: '' };
			return message(form, { kind: 'advanced', text: 'Code sent. Check your email.' });
		}

		// step === 'verify'
		const { email, code } = form.data;
		const stepFail = await runAuthStep(form, 'verify', async () => {
			await enforceRateLimit(kv, 'verify-ip', ip);
			await locals.auth.api.signInEmailOTP({
				body: { email, otp: code },
				headers: request.headers
			});
		});
		if (stepFail) return stepFail;

		// Better-auth attached the session cookie to the outgoing response via
		// `sveltekitCookies`. Redirect to dashboard — superforms' own enhance
		// handles the redirect client-side.
		throw redirect(303, '/dashboard');
	}
};

/**
 * Runs an auth side-effect and converts any thrown `AppError` / unexpected error
 * into the right superforms envelope:
 *   - AppError from rate-limit / Turnstile → toast-level `message(…, { status })`.
 *   - Better-auth APIError on bad OTP → inline `setError(form, 'code', …)` for
 *     step 2, inline `setError(form, 'email', …)` for step 1 (email shape issues
 *     the schema didn't catch, like an unknown account, fall on the email field).
 * Returns the action-failure envelope on error, `null` on success.
 */
async function runAuthStep(
	form: LoginForm,
	step: 'send' | 'verify',
	fn: () => Promise<void>
): Promise<ReturnType<typeof message> | ReturnType<typeof setError> | null> {
	try {
		await fn();
		return null;
	} catch (e) {
		if (isAppError(e)) {
			const status = httpStatusFor(e.code);
			// message()'s ErrorStatus must be 400-599 — clamp to 400 if the caller
			// handed us anything lighter (shouldn't happen with AppError today).
			const errorStatus = status >= 400 ? status : 400;
			return message(
				form,
				{ kind: 'error', text: e.message, code: e.code },
				{ status: errorStatus as 400 | 401 | 403 | 404 | 409 | 500 }
			);
		}
		// Better-auth's APIError exposes `{message, status}` on thrown errors —
		// surface inline on the relevant field so the user sees it next to the
		// input that failed.
		const maybe = e as { message?: string };
		const msg = maybe?.message ?? 'Something went wrong. Please try again.';
		if (step === 'verify') return setError(form, 'code', msg, { status: 400 });
		return setError(form, 'email', msg, { status: 400 });
	}
}
