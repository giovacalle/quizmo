import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { drizzle } from 'drizzle-orm/d1';

import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db/client';
import { users as domainUsers } from '$lib/server/db/schema';

import { createKVSecondaryStorage } from './kv-storage';
import { sendOtpEmail } from './otp-email';
import { authUsers } from './schema';

/**
 * Env shape better-auth needs per request. Resolved via `platform.env` inside each
 * Worker invocation, never cached — bindings are per-invocation in the CF runtime.
 */
export type AuthEnv = {
	DB: D1Database;
	AUTH_KV: KVNamespace;
	BETTER_AUTH_SECRET: string;
	EMAIL: SendEmail;
	EMAIL_FROM: string;
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
				async sendVerificationOTP(payload) {
					await sendOtpEmail(env.EMAIL, env.EMAIL_FROM, payload);
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
