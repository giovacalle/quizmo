import { json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

/**
 * Smoke test for type-safe bindings. Removed in a later milestone once real
 * server routes exercise the same bindings. Do not rely on this in production.
 */
export const GET: RequestHandler = async ({ platform }) => {
	const env = platform?.env;
	if (!env) return json({ ok: false, reason: 'no platform.env in this runtime' }, { status: 503 });

	const db: D1Database = env.QUIZMO_DB;
	const authKv: KVNamespace = env.QUIZMO_AUTH_KV;
	const quizKv: KVNamespace = env.QUIZMO_QUIZ_KV;
	const session: DurableObjectNamespace = env.QUIZMO_SESSION;

	return json({
		ok: true,
		bindings: {
			QUIZMO_DB: typeof db,
			QUIZMO_AUTH_KV: typeof authKv,
			QUIZMO_QUIZ_KV: typeof quizKv,
			QUIZMO_SESSION: typeof session
		}
	});
};
