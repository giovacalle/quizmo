import { and, eq, inArray, lt, ne } from 'drizzle-orm';

import { db } from '$lib/server/db/client';
import { quizSessions, quizzes } from '$lib/server/db/schema';

/**
 * Nightly cleanup run from the Worker's `scheduled()` export.
 *
 * Three responsibilities, each independent and idempotent:
 *
 *  1. Archive quizzes whose `last_active_at` is older than 30 days. Archived
 *     quizzes are excluded from both the 3-active and 20-lifetime caps at
 *     dashboard load, so this is the pressure-release for long-dormant rows.
 *
 *  2. Reconcile stuck sessions. A `QuizSession` DO that was live when the
 *     worker got evicted might have missed the final D1 flush. We look for
 *     `quiz_sessions.status IN ('active','revealing')` older than 2 hours,
 *     fan out `/internal/reconcile` to each DO with a 10s timeout. If the DO
 *     doesn't respond, we fall back to a direct D1 update so the row stops
 *     blocking cap math. Best-effort — no thrown errors escape per-session.
 *
 *  3. Clear `QUIZMO_QUIZ_KV` entries (prefix `code:`) for sessions that are
 *     ended/archived. Cache hygiene only — correctness is handled by
 *     /join's read-through validation.
 */

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const RECONCILE_TIMEOUT_MS = 10_000;

export async function runNightlyCleanup(env: Env): Promise<void> {
	const now = Date.now();
	await archiveStaleQuizzes(env, now);
	await reconcileStuckSessions(env, now);
	await pruneKvCodeCache(env);
}

async function archiveStaleQuizzes(env: Env, now: number): Promise<void> {
	const cutoff = now - THIRTY_DAYS_MS;
	const result = await db(env.QUIZMO_DB)
		.update(quizzes)
		.set({ status: 'archived' })
		.where(and(ne(quizzes.status, 'archived'), lt(quizzes.lastActiveAt, cutoff)))
		.run();
	const changed = result.meta?.changes ?? 0;
	console.log(`[cron.cleanup] archived ${changed} stale quizzes (last_active < ${cutoff})`);
}

async function reconcileStuckSessions(env: Env, now: number): Promise<void> {
	const cutoff = now - TWO_HOURS_MS;
	const stuck = await db(env.QUIZMO_DB)
		.select({ id: quizSessions.id })
		.from(quizSessions)
		.where(
			and(inArray(quizSessions.status, ['active', 'revealing']), lt(quizSessions.createdAt, cutoff))
		)
		.all();

	if (stuck.length === 0) {
		console.log('[cron.cleanup] no stuck sessions');
		return;
	}

	console.log(`[cron.cleanup] reconciling ${stuck.length} stuck session(s)`);
	for (const row of stuck) {
		await reconcileOne(env, row.id, now);
	}
}

async function reconcileOne(env: Env, sessionId: string, now: number): Promise<void> {
	const id = env.QUIZMO_SESSION.idFromName(sessionId);
	const stub = env.QUIZMO_SESSION.get(id);
	const req = new Request('https://do.local/internal/reconcile', {
		method: 'POST',
		signal: AbortSignal.timeout(RECONCILE_TIMEOUT_MS)
	});
	let doOk = false;
	try {
		const res = await stub.fetch(req);
		doOk = res.ok;
		console.log(`[cron.cleanup] reconcile ${sessionId} → DO ${res.status}`);
	} catch (e) {
		// Timeout or DO error — fall through to direct D1 update below.
		console.log(`[cron.cleanup] reconcile ${sessionId} → DO failed: ${stringifyError(e)}`);
	}

	if (!doOk) {
		await db(env.QUIZMO_DB)
			.update(quizSessions)
			.set({ status: 'ended', endedAt: now })
			.where(eq(quizSessions.id, sessionId))
			.run();
		console.log(`[cron.cleanup] reconcile ${sessionId} → forced status=ended via direct D1`);
	}
}

async function pruneKvCodeCache(env: Env): Promise<void> {
	const kv = env.QUIZMO_QUIZ_KV;
	let cursor: string | undefined;
	let deleted = 0;
	let scanned = 0;
	// KV `list` returns up to 1000 keys per call; we paginate with the cursor.
	do {
		const page = await kv.list({ prefix: 'code:', cursor });
		scanned += page.keys.length;
		for (const key of page.keys) {
			const sessionId = await kv.get(key.name);
			if (!sessionId) {
				await kv.delete(key.name);
				deleted += 1;
				continue;
			}
			const row = await db(env.QUIZMO_DB)
				.select({ status: quizSessions.status })
				.from(quizSessions)
				.where(eq(quizSessions.id, sessionId))
				.get();
			if (!row || row.status === 'ended' || row.status === 'archived') {
				await kv.delete(key.name);
				deleted += 1;
			}
		}
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);
	console.log(`[cron.cleanup] pruned ${deleted}/${scanned} code:* KV entries`);
}

function stringifyError(e: unknown): string {
	if (e instanceof Error) return `${e.name}: ${e.message}`;
	return String(e);
}
