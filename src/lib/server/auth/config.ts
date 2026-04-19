import { getRequestEvent } from '$app/server';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { drizzle } from 'drizzle-orm/d1';
import { Resend } from 'resend';

import { db } from '$lib/server/db/client';
import { users as domainUsers } from '$lib/server/db/schema';
import { AppError } from '$lib/server/errors';

import { createKVSecondaryStorage } from './kv-storage';
import { authUsers } from './schema';

/**
 * Env shape better-auth needs per request. Resolved via `platform.env` inside each
 * Worker invocation, never cached — bindings are per-invocation in the CF runtime.
 */
export type AuthEnv = {
	DB: D1Database;
	AUTH_KV: KVNamespace;
	BETTER_AUTH_SECRET: string;
	RESEND_API_KEY: string;
	RESEND_FROM_EMAIL: string;
	APP_URL: string;
};

/**
 * Factory that returns a fresh better-auth instance bound to the per-request env.
 * Called from `hooks.server.ts` on every invocation — better-auth's own caching
 * handles repeat work within a single instance, but we never share instances across
 * requests because D1/KV bindings aren't stable across Worker invocations in the
 * edge runtime.
 *
 * Config highlights:
 *   - Drizzle D1 adapter on `auth_users` (mapped via `user.modelName`).
 *   - Secondary storage backed by `QUIZMO_AUTH_KV` — sessions + OTP records live
 *     there instead of D1 (plan mandate, also keeps SQL schema lean).
 *   - Email-OTP plugin: 6-digit, 10min TTL, 5 attempts, rotate-on-resend (invalidates
 *     the prior code when a fresh one ships).
 *   - Strict cookie: secure + httpOnly + sameSite:strict. No OAuth redirect to
 *     worry about — strict closes the CSRF window entirely.
 *   - `databaseHooks.user.create.after` mirrors the better-auth user into Quizmo's
 *     domain `users` table with the SAME id, so FK references (quizzes.owner_id,
 *     quiz_sessions.host_id) keep working without a separate user-sync step.
 */
export function createAuthConfig(env: AuthEnv) {
	// A dedicated drizzle client that only knows about the auth tables. Better-auth's
	// drizzle adapter uses this client directly for its writes, while the `client`
	// factory further down is used inside `databaseHooks.user.create.after` for the
	// domain-users mirror insert.
	const authClient = drizzle(env.DB, { schema: { authUsers } });
	const client = db(env.DB);
	const resend = new Resend(env.RESEND_API_KEY);

	return betterAuth({
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.APP_URL,
		trustedOrigins: [env.APP_URL],
		database: drizzleAdapter(authClient, {
			provider: 'sqlite',
			schema: { user: authUsers }
		}),
		// Sessions + OTPs go in KV. SQL-side session/verification/account tables are
		// not declared — see `schema.ts` for the one SQL table we actually need.
		secondaryStorage: createKVSecondaryStorage(env.AUTH_KV),
		session: {
			// Even with KV secondary storage, we explicitly keep sessions out of SQL.
			// `storeSessionInDatabase: false` is the default in this mode; stated here
			// for readability.
			storeSessionInDatabase: false,
			cookieCache: {
				enabled: true,
				maxAge: 5 * 60
			}
		},
		verification: {
			// OTP verification records live in KV only.
			disableCleanup: true
		},
		advanced: {
			cookies: {
				session_token: {
					attributes: {
						secure: true,
						httpOnly: true,
						sameSite: 'strict'
					}
				}
			}
		},
		emailAndPassword: {
			enabled: false
		},
		rateLimit: {
			// The plugin-level per-IP counters live in KV too (min 60s window per CF limit).
			// Additional email/IP rate-limits live in `rate-limit.ts` — those are invoked
			// from the login action before hitting the better-auth handler.
			enabled: true,
			window: 60,
			max: 100,
			storage: 'secondary-storage'
		},
		databaseHooks: {
			user: {
				create: {
					after: async (user) => {
						// Mirror the fresh auth user into Quizmo's domain users table with
						// the same id. INSERT OR IGNORE so repeat triggers (e.g. race on two
						// concurrent sign-ins with the same email) don't explode. Emails are
						// already lowercased by the emailOTP plugin config + Valibot
						// emailSchema at the action boundary — belt+suspenders here.
						const email = user.email.trim().toLowerCase();
						const now = Date.now();
						await client
							.insert(domainUsers)
							.values({
								id: user.id,
								email,
								name: user.name,
								createdAt: now
							})
							.onConflictDoNothing()
							.execute();
					}
				}
			}
		},
		plugins: [
			emailOTP({
				otpLength: 6,
				expiresIn: 60 * 10, // 10 minutes
				allowedAttempts: 5,
				// Rotate: a fresh code invalidates the prior one. Matches plan's
				// "invalidate-on-resend" requirement.
				resendStrategy: 'rotate',
				// Redundant with our schema-level COLLATE check, but cheap guarantee.
				async sendVerificationOTP({ email, otp, type }) {
					// Only the "sign-in" flow is wired. If a plugin emits a different
					// type (email-verification / forget-password), we still send the
					// code but keep the subject generic.
					const subject =
						type === 'sign-in' ? 'Your Quizmo sign-in code' : 'Your Quizmo verification code';
					const lowered = email.trim().toLowerCase();
					const { error } = await resend.emails.send({
						from: env.RESEND_FROM_EMAIL,
						to: [lowered],
						subject,
						text: renderPlainText(otp),
						html: renderHtml(otp)
					});
					if (error) {
						// Preserve the Resend message in the AppError for ops visibility;
						// the client just sees "Could not send code".
						console.error('[resend-error]', error);
						throw new AppError('INTERNAL_ERROR', 'Could not send code');
					}
				}
			}),
			// Must be last — reads from `$app/server`'s getRequestEvent and attaches
			// Set-Cookie headers from better-auth server actions (sign-in/verify) to
			// the outgoing SvelteKit Response.
			sveltekitCookies(getRequestEvent)
		]
	});
}

export type AuthInstance = ReturnType<typeof createAuthConfig>;

function renderPlainText(otp: string): string {
	return [
		'Your Quizmo sign-in code:',
		'',
		otp,
		'',
		'This code expires in 10 minutes and can only be used once.',
		'If you did not request this code, you can safely ignore this email.'
	].join('\n');
}

function renderHtml(otp: string): string {
	// Inline styles only — email clients strip <style> blocks unpredictably. Tokens
	// kept simple (neutral grays + indigo accent) so it renders across clients.
	return `<!doctype html>
<html>
	<body style="font-family: ui-sans-serif, system-ui, sans-serif; background: #f3f4f6; margin: 0; padding: 24px;">
		<table role="presentation" cellpadding="0" cellspacing="0" style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
			<tr>
				<td>
					<h1 style="margin: 0 0 12px; font-size: 20px; color: #111827;">Your Quizmo sign-in code</h1>
					<p style="margin: 0 0 24px; color: #4b5563; line-height: 1.5;">Paste this code on the sign-in page. It expires in 10 minutes and can only be used once.</p>
					<div style="font-size: 28px; font-weight: 700; letter-spacing: 0.25em; color: #4f46e5; padding: 16px 0; text-align: center; background: #eef2ff; border-radius: 8px;">${otp}</div>
					<p style="margin: 24px 0 0; color: #6b7280; font-size: 12px;">If you did not request this code, you can safely ignore this email.</p>
				</td>
			</tr>
		</table>
	</body>
</html>`;
}
