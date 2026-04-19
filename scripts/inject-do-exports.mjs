#!/usr/bin/env bun
/**
 * Post-build step: append Durable Object class re-exports to the adapter-cloudflare
 * generated worker entry so wrangler sees `QuizSession` exported.
 *
 * Why this exists: `@sveltejs/adapter-cloudflare` emits a worker module with only
 * `default.fetch`. Cloudflare requires DO classes be named exports on the same
 * Worker entrypoint. Until the adapter supports this natively (or we split DOs into
 * a separate Worker), we patch the built file.
 *
 * Run automatically as part of `bun run build` (see package.json).
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workerPath = resolve(process.cwd(), '.svelte-kit/cloudflare/_worker.js');
const doSourcePath = resolve(process.cwd(), 'src/lib/server/do/quiz-session.ts');

if (!existsSync(workerPath)) {
	console.error(`[inject-do-exports] ${workerPath} not found — did the adapter build run?`);
	process.exit(1);
}

const current = readFileSync(workerPath, 'utf8');
const sentinel = '/* __quizmo:injected-do-exports__ */';

if (current.includes(sentinel)) {
	console.log('[inject-do-exports] already injected, skipping');
	process.exit(0);
}

/**
 * Read the DO class source and inline it.
 * We inline (vs. import) because the adapter output uses the bundler's relative
 * imports and we don't want to chase path rewrites through generated code.
 * The class is a placeholder at this point (a later step will replace it); keeping the
 * transform dumb makes it robust to refactors.
 */
// For the placeholder stub we can just emit a hand-written JS shim — simpler and
// robust to TS syntax that doesn't survive a naïve strip pass. a later step replaces this
// with the real class, at which point we switch to a proper TS → JS compile
// step (esbuild transform) if the class grows beyond trivial.
const placeholderMarker = 'DO placeholder — real class pending.';
const realClassPath = doSourcePath;
const realClass = readFileSync(realClassPath, 'utf8');
const isStillPlaceholder = realClass.includes(placeholderMarker);

const classSource = isStillPlaceholder
	? `class QuizSession {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(_request) {
    return new Response('QuizSession DO — not yet implemented ', { status: 501 });
  }
}`
	: (() => {
			throw new Error(
				'[inject-do-exports] DO class is no longer the scaffold placeholder. ' +
					'Update this script to compile src/lib/server/do/quiz-session.ts to JS ' +
					'(e.g. via esbuild transform) before patching the worker bundle. ' +
					'See the roadmap for the follow-up.'
			);
		})();

const injected = `${current}\n\n${sentinel}\n${classSource}\nexport { QuizSession };\n`;

// Keep a backup for debugging
copyFileSync(workerPath, `${workerPath}.pre-inject.bak`);
writeFileSync(workerPath, injected);

console.log('[inject-do-exports] appended QuizSession export to', workerPath);
