import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll } from 'vitest';

/**
 * Applied once per worker pool before any test runs. `TEST_MIGRATIONS` is
 * seeded from `vite.config.ts` via `readD1Migrations(...)` + the miniflare
 * `bindings` config. `applyD1Migrations` is idempotent — it tracks which
 * migrations have run via an internal `d1_migrations` table.
 */
beforeAll(async () => {
	await applyD1Migrations(
		env.QUIZMO_DB,
		// Injected at vitest bootstrap via miniflare.bindings.TEST_MIGRATIONS in
		// `vite.config.ts`. Not part of the production binding set so not in
		// `worker-configuration.d.ts` — narrow access through the generic env.
		(env as unknown as { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }).TEST_MIGRATIONS
	);
});
