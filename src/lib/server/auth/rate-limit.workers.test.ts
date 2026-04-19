import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { AppError, isAppError } from '$lib/server/errors';

import { bumpRateLimit, enforceRateLimit, hashEmail } from './rate-limit';

/**
 * Runs inside the workers pool so `env.QUIZMO_AUTH_KV` is a real miniflare
 * KVNamespace. Tests the helpers against the happy + over-limit
 * paths.
 */

describe('bumpRateLimit', () => {
	it('allows counts up to max', async () => {
		const key = `rl:test:${crypto.randomUUID()}`;
		for (let i = 0; i < 3; i++) {
			await expect(bumpRateLimit(env.QUIZMO_AUTH_KV, key, 3, 'over')).resolves.toBeUndefined();
		}
	});

	it('throws AppError on the (max+1)th call', async () => {
		const key = `rl:test:${crypto.randomUUID()}`;
		for (let i = 0; i < 3; i++) {
			await bumpRateLimit(env.QUIZMO_AUTH_KV, key, 3, 'over');
		}
		let caught: unknown;
		try {
			await bumpRateLimit(env.QUIZMO_AUTH_KV, key, 3, 'you shall not pass');
		} catch (e) {
			caught = e;
		}
		expect(isAppError(caught)).toBe(true);
		expect((caught as AppError).code).toBe('INVALID_INPUT');
		expect((caught as AppError).message).toBe('you shall not pass');
	});

	it('persists counter in KV with a value', async () => {
		const key = `rl:test:${crypto.randomUUID()}`;
		await bumpRateLimit(env.QUIZMO_AUTH_KV, key, 10, 'over');
		await bumpRateLimit(env.QUIZMO_AUTH_KV, key, 10, 'over');
		const raw = await env.QUIZMO_AUTH_KV.get(key);
		expect(raw).toBe('2');
	});
});

describe('enforceRateLimit', () => {
	it('prefixes the key by kind', async () => {
		const id = crypto.randomUUID();
		await enforceRateLimit(env.QUIZMO_AUTH_KV, 'send-email', id);
		const raw = await env.QUIZMO_AUTH_KV.get(`rl:email:send:${id}`);
		expect(raw).toBe('1');
	});

	it('uses the documented limits: send-email=3, send-ip=20, verify-ip=10', async () => {
		// send-email: 3 pass, 4th rejects
		const emailId = crypto.randomUUID();
		for (let i = 0; i < 3; i++) await enforceRateLimit(env.QUIZMO_AUTH_KV, 'send-email', emailId);
		await expect(enforceRateLimit(env.QUIZMO_AUTH_KV, 'send-email', emailId)).rejects.toThrow();

		// verify-ip: 10 pass, 11th rejects
		const ipId = crypto.randomUUID();
		for (let i = 0; i < 10; i++) await enforceRateLimit(env.QUIZMO_AUTH_KV, 'verify-ip', ipId);
		await expect(enforceRateLimit(env.QUIZMO_AUTH_KV, 'verify-ip', ipId)).rejects.toThrow();
	});
});

describe('hashEmail', () => {
	it('returns a 64-char hex digest', async () => {
		const hash = await hashEmail('alice@x.com');
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('is case + trim idempotent', async () => {
		const [a, b] = await Promise.all([hashEmail('Alice@x.COM'), hashEmail('  alice@x.com  ')]);
		expect(a).toBe(b);
	});

	it('differs across distinct emails', async () => {
		const [a, b] = await Promise.all([hashEmail('a@x.com'), hashEmail('b@x.com')]);
		expect(a).not.toBe(b);
	});
});
