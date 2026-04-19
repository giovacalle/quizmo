import { drizzle } from 'drizzle-orm/d1';

import * as schema from './schema';

/**
 * Drizzle D1 client factory. Takes the binding explicitly (rather than reading
 * `platform.env` internally) so callers pass an already-resolved D1Database — which
 * keeps this factory testable from a Workers pool mock without a SvelteKit `platform`.
 *
 * Usage:
 *   import { db } from '$lib/server/db/client';
 *   const client = db(platform!.env.QUIZMO_DB);
 *   await client.select().from(schema.quizzes);
 */
export const db = (d1: D1Database) => drizzle(d1, { schema });

export type Db = ReturnType<typeof db>;

export { schema };
