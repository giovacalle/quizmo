import { AppError } from '$lib/server/errors';

import { type AuthEnv, type AuthInstance, createAuthConfig } from './config';

/**
 * Entry point used by `hooks.server.ts` and route handlers. Reads platform
 * bindings + secrets, pins them to a fresh better-auth instance per request, and
 * returns it. Bindings are per-invocation in the CF runtime — never cache this
 * instance across requests, tests included.
 *
 * Missing secrets at runtime produce a user-facing AppError rather than a 500
 * crash so the login page can surface a clean "Verification failed" / "Could
 * not send code" message while the runbook is outstanding.
 */
export function createAuth(platformEnv: App.Platform['env']): AuthInstance {
	const env = readAuthEnv(platformEnv);
	return createAuthConfig(env);
}

export function readAuthEnv(platformEnv: App.Platform['env']): AuthEnv {
	// Secrets are not typed on `Cloudflare.Env` (wrangler types only tracks `vars`),
	// so the narrow cast here is load-bearing — the runtime access is still safe.
	const raw = platformEnv as unknown as {
		QUIZMO_DB: D1Database;
		QUIZMO_AUTH_KV: KVNamespace;
		BETTER_AUTH_SECRET?: string;
		RESEND_API_KEY?: string;
		RESEND_FROM_EMAIL?: string;
		APP_URL?: string;
	};

	if (!raw.BETTER_AUTH_SECRET)
		throw new AppError('INTERNAL_ERROR', 'Auth secret is not configured');

	return {
		DB: raw.QUIZMO_DB,
		AUTH_KV: raw.QUIZMO_AUTH_KV,
		BETTER_AUTH_SECRET: raw.BETTER_AUTH_SECRET,
		// Resend is only needed for sendOTP. If absent, the plugin callback throws
		// at send-time — which surfaces as an AppError('INTERNAL_ERROR', 'Could not
		// send code') in the /login action, and is documented in ops-todo.
		RESEND_API_KEY: raw.RESEND_API_KEY ?? '',
		RESEND_FROM_EMAIL: raw.RESEND_FROM_EMAIL ?? '',
		APP_URL: raw.APP_URL ?? 'http://localhost:5173'
	};
}

export type { AuthEnv, AuthInstance };
