/**
 * Cloudflare KV adapter for better-auth's `secondaryStorage` interface.
 *
 * Better-auth writes session rows and verification records (email-OTP codes) here,
 * plus its own rate-limit counters. All keys live under `QUIZMO_AUTH_KV` with the
 * project-mandated prefixes documented in `.claude/rules/cf-workers-backend.md`:
 *
 *   session:{token}   - better-auth session payload
 *   otp:{identifier}  - email-OTP verification record
 *
 * Cloudflare KV enforces a minimum TTL of 60 seconds for `expirationTtl`. Values
 * below that get clamped to 60 so the put() call doesn't reject — the ~60s imprecision
 * is acceptable for session eviction semantics. Persistent entries are stored without
 * a TTL.
 */

const MIN_TTL_SECONDS = 60;

export type SecondaryStorage = {
	get: (key: string) => Promise<string | null>;
	set: (key: string, value: string, ttl?: number) => Promise<void>;
	delete: (key: string) => Promise<void>;
};

export function createKVSecondaryStorage(kv: KVNamespace): SecondaryStorage {
	return {
		async get(key) {
			return await kv.get(key);
		},
		async set(key, value, ttl) {
			if (ttl && ttl > 0) {
				const clamped = Math.max(ttl, MIN_TTL_SECONDS);
				await kv.put(key, value, { expirationTtl: clamped });
				return;
			}
			await kv.put(key, value);
		},
		async delete(key) {
			await kv.delete(key);
		}
	};
}
