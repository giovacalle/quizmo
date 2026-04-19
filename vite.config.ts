import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const libPath = fileURLToPath(new URL('./src/lib', import.meta.url));
const migrationsPath = fileURLToPath(new URL('./drizzle/migrations', import.meta.url));
const migrations = await readD1Migrations(migrationsPath);

/**
 * Two-project setup (Vitest 4 API):
 *   - `server`  : pure-node tests (validators, errors, result, scoring) — the
 *                 bulk of our coverage. No runtime bindings needed.
 *   - `workers` : runs inside miniflare via `@cloudflare/vitest-pool-workers`'s
 *                 `cloudflareTest()` plugin for tests that touch real KV / D1
 *                 / DO bindings. Tests in this pool import from
 *                 `cloudflare:test` for `env`, `SELF`, and `runInDurableObject`.
 */
export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: [
						'src/**/*.svelte.{test,spec}.{js,ts}',
						'src/**/*.workers.{test,spec}.{js,ts}'
					]
				}
			},
			{
				// `cloudflareTest()` as a vite PLUGIN (not a pool option) is the
				// Vitest 4 API — vitest-pool-workers 0.14.x registers the pool
				// wiring itself when this plugin is in the plugins array.
				plugins: [
					cloudflareTest({
						main: './src/lib/test/workers-test-main.ts',
						wrangler: { configPath: './wrangler.jsonc' },
						miniflare: {
							// Surface the D1 migrations to the worker pool under a
							// predictable binding name; applyD1Migrations() consumes it
							// from a setup file.
							bindings: { TEST_MIGRATIONS: migrations }
						}
					})
				],
				resolve: {
					alias: {
						$lib: libPath
					}
				},
				test: {
					name: 'workers',
					include: ['src/**/*.workers.{test,spec}.{js,ts}'],
					setupFiles: ['./src/lib/test/apply-migrations.ts']
				}
			}
		]
	}
});
