import { throwAppError } from '$lib/server/errors';

/**
 * KV-backed rate limiter for the auth surface. Key prefixes are mandated by
 * `.claude/rules/cf-workers-backend.md`:
 *
 *   rl:email:send:{emailHash}  - 3 per email per hour
 *   rl:ip:send:{ip}            - 20 per IP per hour
 *   rl:ip:verify:{ip}          - 10 per IP per hour
 *
 * The counter pattern (`put(key, n+1, {expirationTtl: 3600})`) accepts ~1 min of
 * race imprecision at hour boundaries, which is fine for anti-abuse. Exceeding a
 * limit throws `AppError('INVALID_INPUT', ...)` — translated to HTTP 400 via the
 * route-level `guardAppError` wrapper.
 */

const WINDOW_SECONDS = 3600;

export type RateLimitKind = 'send-email' | 'send-ip' | 'verify-ip';

const LIMITS: Record<RateLimitKind, number> = {
	'send-email': 3,
	'send-ip': 20,
	'verify-ip': 10
};

const MESSAGES: Record<RateLimitKind, string> = {
	'send-email': 'Too many codes requested for this email. Try again in an hour.',
	'send-ip': 'Too many code requests from this connection. Try again in an hour.',
	'verify-ip': 'Too many verification attempts from this connection. Try again in an hour.'
};

/**
 * Increments the counter at `key` by one. Throws `AppError('INVALID_INPUT', ...)` if
 * the new count would exceed `max`. Writes are TTL-bounded so the window auto-resets.
 * Kept intentionally thin — the caller decides which key to pass.
 */
export async function bumpRateLimit(
	kv: KVNamespace,
	key: string,
	max: number,
	overLimitMessage: string
): Promise<void> {
	const raw = await kv.get(key);
	const next = (raw ? Number(raw) : 0) + 1;
	if (next > max) throwAppError('INVALID_INPUT', overLimitMessage);
	await kv.put(key, String(next), { expirationTtl: WINDOW_SECONDS });
}

/**
 * Convenience wrapper that picks the right key prefix + limit + message for each
 * known auth-action. Example:
 *
 *   await enforceRateLimit(kv, 'send-email', emailHash);
 *   await enforceRateLimit(kv, 'send-ip', ip);
 */
export async function enforceRateLimit(
	kv: KVNamespace,
	kind: RateLimitKind,
	identifier: string
): Promise<void> {
	const keyPrefix =
		kind === 'send-email' ? 'rl:email:send:' : kind === 'send-ip' ? 'rl:ip:send:' : 'rl:ip:verify:';
	await bumpRateLimit(kv, `${keyPrefix}${identifier}`, LIMITS[kind], MESSAGES[kind]);
}

/**
 * Deterministic, non-cryptographic hash used as the email-specific rate-limit key
 * component. SHA-256 (via Web Crypto, available on Workers) keeps raw addresses out
 * of KV key listings — belt-and-suspenders privacy since KV isn't a public surface.
 */
export async function hashEmail(email: string): Promise<string> {
	const data = new TextEncoder().encode(email.trim().toLowerCase());
	const digest = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}
