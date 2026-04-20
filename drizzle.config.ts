import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit config for Quizmo's D1 database (`quizmo-db`).
 *
 * Migrations are emitted into `drizzle/migrations/`, which `wrangler.jsonc` points at
 * via `d1_databases[0].migrations_dir`. That way `bunx drizzle-kit generate` produces
 * files that `wrangler d1 migrations apply quizmo-db --remote` picks up directly.
 *
 * The `d1-http` driver credentials (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_DATABASE_ID /
 * CLOUDFLARE_D1_TOKEN) are only required for `drizzle-kit push` / `pull` / `migrate`.
 * We intentionally use wrangler for `apply` (not drizzle-kit migrate) so those env
 * vars remain optional for the normal generate-only workflow. If they're absent,
 * `drizzle-kit generate` still works; push/pull would error, which is fine since we
 * don't use them.
 */
export default defineConfig({
	dialect: 'sqlite',
	driver: 'd1-http',
	// Two schema files live alongside each other:
	//   - db/schema.ts     — Quizmo domain (users, quizzes, questions, ...)
	//   - auth/schema.ts   — better-auth's auth_users table
	// drizzle-kit generate walks both and produces a single migration per change set.
	schema: ['./src/lib/server/db/schema.ts', './src/lib/server/auth/schema.ts'],
	out: './drizzle/migrations',
	dbCredentials: {
		accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
		databaseId: process.env.CLOUDFLARE_DATABASE_ID ?? '',
		token: process.env.CLOUDFLARE_D1_TOKEN ?? ''
	}
});
