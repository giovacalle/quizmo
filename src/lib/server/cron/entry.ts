/**
 * Cron entry module — bundled by `scripts/inject-do-exports.mjs` and appended
 * to `.svelte-kit/cloudflare/_worker.js` as a named `scheduled` export.
 *
 * `@sveltejs/adapter-cloudflare@7.2.x` only emits `default.fetch`; Cloudflare's
 * Cron Triggers invoke `scheduled()` directly (no HTTP route). We need to
 * extend the generated worker with a named `scheduled(event, env, ctx)` export
 * for the wrangler.jsonc `triggers.crons` schedule to reach us.
 */
import { runNightlyCleanup } from './cleanup';

export async function scheduledHandler(
	_event: ScheduledEvent,
	env: Env,
	ctx: ExecutionContext
): Promise<void> {
	// `waitUntil` keeps the handler alive past the synchronous return so D1/KV/DO
	// work that's still in flight completes before the runtime sleeps the worker.
	ctx.waitUntil(runNightlyCleanup(env));
}
