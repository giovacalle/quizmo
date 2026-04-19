import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Better-auth's required user table. Kept separate from the domain `users` table in
 * `src/lib/server/db/schema.ts` so domain user schema stays untouched. The ID
 * is mirrored into the domain `users` row via a `databaseHooks.user.create.after`
 * callback, so `quizzes.owner_id` and `quiz_sessions.host_id` (which FK to `users`)
 * both keep working with the same id better-auth issues.
 *
 * Sessions, OTP codes, and rate-limit counters live in KV (`QUIZMO_AUTH_KV`) via
 * better-auth's `secondaryStorage`, so this file only declares the one SQL table
 * the adapter actually needs.
 *
 * Column shape is NOT negotiable — it matches what better-auth's drizzle adapter
 * expects for the default `user` model. Deviations cause adapter read/write errors.
 */
export const authUsers = sqliteTable('auth_users', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
	image: text('image'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
});
