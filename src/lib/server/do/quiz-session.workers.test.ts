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

describe('QuizSession DO — nickname dedup on join', () => {
	// Minimal mock WebSocket: captures every `send(...)` so we can assert the
	// outbound `{type:'error'|'state', ...}` messages produced by the DO's
	// `webSocketMessage` handler. `serializeAttachment` / `deserializeAttachment`
	// stash/retrieve the role+participantId the DO uses to tag the socket.
	function makeMockWs() {
		const sent: string[] = [];
		let attachment: unknown = { role: 'participant' };
		const ws = {
			send(text: string) {
				sent.push(text);
			},
			serializeAttachment(value: unknown) {
				attachment = value;
			},
			deserializeAttachment() {
				return attachment;
			},
			close() {
				/* noop */
			}
		};
		return { ws: ws as unknown as WebSocket, sent };
	}

	async function sendJoin(stub: DurableObjectStub, ws: WebSocket, nickname: string) {
		await runInDurableObject(stub, async (instance) => {
			// `webSocketMessage` is declared `?` on `DurableObject` — the subclass
			// overrides it unconditionally, so narrow here.
			if (!instance.webSocketMessage) throw new Error('DO does not implement webSocketMessage');
			await instance.webSocketMessage(
				ws,
				JSON.stringify({ type: 'join', payload: { nickname } })
			);
		});
	}

	function lastMessage(sent: string[]): { type: string; payload: Record<string, unknown> } {
		const last = sent.at(-1);
		if (!last) throw new Error('no messages sent');
		return JSON.parse(last);
	}

	it('rejects duplicate nicknames with CONFLICT (case + whitespace insensitive)', async () => {
		const stub = stubFor(`dedup-${crypto.randomUUID()}`);

		// Warm the DO so meta is seeded before any join.
		await stub.fetch(new Request('https://do.local/internal/state'));

		// 1. "Mario" → success (first to join).
		const first = makeMockWs();
		await sendJoin(stub, first.ws, 'Mario');
		expect(lastMessage(first.sent).type).toBe('state');

		// 2. "mario" (different case) → CONFLICT.
		const second = makeMockWs();
		await sendJoin(stub, second.ws, 'mario');
		const secondMsg = lastMessage(second.sent);
		expect(secondMsg.type).toBe('error');
		expect(secondMsg.payload).toMatchObject({
			code: 'CONFLICT',
			message: 'Nickname already taken'
		});

		// 3. "  Mario  " (padded) → CONFLICT.
		const third = makeMockWs();
		await sendJoin(stub, third.ws, '  Mario  ');
		const thirdMsg = lastMessage(third.sent);
		expect(thirdMsg.type).toBe('error');
		expect(thirdMsg.payload).toMatchObject({ code: 'CONFLICT' });

		// 4. "Luigi" (different nickname) → success.
		const fourth = makeMockWs();
		await sendJoin(stub, fourth.ws, 'Luigi');
		expect(lastMessage(fourth.sent).type).toBe('state');

		// Storage should now hold exactly two participants — one Mario, one Luigi.
		const participantCount = await runInDurableObject(stub, async (_instance, state) => {
			const rows = await state.storage.list({ prefix: 'participant:' });
			return rows.size;
		});
		expect(participantCount).toBe(2);
	});
});
