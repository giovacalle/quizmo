/**
 * Test-only Worker entry for `@cloudflare/vitest-pool-workers`. Re-exports the
 * real `QuizSession` Durable Object (so `runInDurableObject` can locate the
 * class) plus a no-op default handler.
 *
 * NOT bundled into production — only referenced from `vite.config.ts`'s
 * `cloudflareTest({ main: ... })` plugin option.
 */
import { QuizSession } from '$lib/server/do/quiz-session';

export { QuizSession };

export default {
	async fetch(): Promise<Response> {
		return new Response('test-main — use SELF to hit bindings', { status: 404 });
	}
};
