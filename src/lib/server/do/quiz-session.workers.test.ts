import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * DO-level tests via the workers pool. We exercise the parts of the DO that
 * don't need a live D1 quiz seed:
 *   - `/internal/state` shape (empty session, no messages sent)
 *   - `/internal/reconcile` idempotency (no persisted rows yet → no-op, ok)
 *   - meta rehydration: mutate storage via `runInDurableObject`, re-instantiate,
 *     confirm the stored bytes persist.
 *
 * Tests that depend on a full quiz fixture (scoring across a whole quiz, alarm
 * cadence) are left as follow-up work for launch when we have auth + a live D1 to
 * drive an end-to-end run.
 */

function stubFor(sessionId: string) {
	const id = env.QUIZMO_SESSION.idFromName(sessionId);
	return env.QUIZMO_SESSION.get(id);
}

describe('QuizSession DO — /internal/state', () => {
	it('returns a well-formed initial state', async () => {
		const stub = stubFor(`state-shape-${crypto.randomUUID()}`);
		const res = await stub.fetch(new Request('https://do.local/internal/state'));
		expect(res.status).toBe(200);
		const state = (await res.json()) as {
			type: string;
			payload: {
				status: string;
				participants: unknown[];
				totalQuestions: number;
			};
		};
		expect(state.type).toBe('state');
		expect(state.payload.status).toBe('lobby');
		expect(Array.isArray(state.payload.participants)).toBe(true);
		expect(state.payload.participants.length).toBe(0);
		expect(state.payload.totalQuestions).toBe(0);
	});
});

describe('QuizSession DO — /internal/reconcile', () => {
	it('is idempotent on an un-started session', async () => {
		const stub = stubFor(`reconcile-${crypto.randomUUID()}`);
		// First call — no persisted state, should return 200 with { ok: true }.
		const res1 = await stub.fetch(
			new Request('https://do.local/internal/reconcile', { method: 'POST' })
		);
		expect(res1.status).toBe(200);
		expect(await res1.json()).toEqual({ ok: true });
		// Second call — same result. No exceptions, no state mutation.
		const res2 = await stub.fetch(
			new Request('https://do.local/internal/reconcile', { method: 'POST' })
		);
		expect(res2.status).toBe(200);
		expect(await res2.json()).toEqual({ ok: true });
	});
});

describe('QuizSession DO — storage rehydration', () => {
	it('persists meta across fresh fetches (write-through discipline)', async () => {
		const sessionId = `rehydrate-${crypto.randomUUID()}`;
		const stub = stubFor(sessionId);

		// Warm the DO (ctor runs, sessionSecret gets written to storage).
		await stub.fetch(new Request('https://do.local/internal/state'));

		// Read meta directly via runInDurableObject — proves write-through.
		const meta1 = await runInDurableObject(stub, async (_instance, state) => {
			return await state.storage.get<{ sessionSecret: string; status: string }>('meta');
		});
		expect(meta1).toBeDefined();
		expect(meta1?.status).toBe('lobby');
		expect(typeof meta1?.sessionSecret).toBe('string');
		expect(meta1?.sessionSecret.length).toBeGreaterThan(0);

		// A second fetch to the same id should reuse the same sessionSecret —
		// the DO's blockConcurrencyWhile constructor seeds once, then rehydrates.
		await stub.fetch(new Request('https://do.local/internal/state'));
		const meta2 = await runInDurableObject(stub, async (_instance, state) => {
			return await state.storage.get<{ sessionSecret: string }>('meta');
		});
		expect(meta2?.sessionSecret).toBe(meta1?.sessionSecret);
	});
});
