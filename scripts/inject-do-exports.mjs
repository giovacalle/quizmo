#!/usr/bin/env bun
/**
 * inject-do-exports — post-build step that appends named exports (QuizSession
 * Durable Object + scheduled cron handler) to the worker bundle emitted by
 * @sveltejs/adapter-cloudflare.
 *
 * Why this exists
 * ---------------
 * Cloudflare Workers requires:
 *   - DO classes to be named exports on the entry module (QuizSession).
 *   - scheduled(event, env, ctx) to be a named export for Cron Triggers.
 *
 * @sveltejs/adapter-cloudflare (7.2.x) only emits `export default { fetch }`
 * on .svelte-kit/cloudflare/_worker.js (see the adapter's `files/worker.js`
 * template — it ends in `export { worker_default as default };` with no
 * extension hook). Without this script:
 *   - wrangler deploy rejects the worker (the `QuizSession` binding declared
 *     in wrangler.jsonc resolves to an undefined class).
 *   - Cron Triggers fire against the Worker and no `scheduled` export means
 *     they're silent no-ops.
 *
 * How it works
 * ------------
 * esbuild compiles src/lib/server/do/quiz-session.ts and
 * src/lib/server/cron/entry.ts through a synthetic virtual entry
 * (.svelte-kit/__quizmo-worker-extras-entry.ts) that imports + re-exports
 * both modules. The resulting ESM bundle is appended to _worker.js with an
 * `export { QuizSession, scheduled }` trailer.
 *
 * Single-bundle design (deliberate)
 * ---------------------------------
 * Two separate esbuild passes would duplicate shared deps (Drizzle, Valibot,
 * Neverthrow) at the top level of _worker.js and break deploy-dry-run with
 *   "The symbol 'drizzle' has already been declared"
 * One bundle = one set of top-level symbol declarations. esbuild dedupes the
 * shared dep graph across the two entries.
 *
 * Identifier renaming
 * -------------------
 * Both `QuizSession` and `scheduledHandler` get renamed to internal symbols
 * (`__quizmoQuizSessionImpl`, `__quizmoScheduledImpl`) before the bundle is
 * appended — otherwise the final re-export `export { QuizSession, scheduled }`
 * would collide with the bundle's own top-level declarations.
 *
 * Safety gates
 * ------------
 *   - Refuses to run if src/lib/server/do/quiz-session.ts still carries the
 *     original scaffold placeholder marker.
 *   - Refuses to run if `class QuizSession` isn't present in the DO source.
 *   - Sentinel-guarded: if the output already contains the injection marker,
 *     this is a rerun; skip rather than double-append.
 *   - Saves _worker.js to _worker.js.pre-inject.bak before mutating in place.
 *
 * When this can go away
 * ---------------------
 * If/when @sveltejs/adapter-cloudflare lands first-class support for named
 * exports alongside the default handler, delete this script and configure
 * the adapter directly. Until then, this is the pragmatic path.
 *
 * Run automatically as part of `bun run build` (see package.json).
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const workerPath = resolve(root, '.svelte-kit/cloudflare/_worker.js');
const doSourcePath = resolve(root, 'src/lib/server/do/quiz-session.ts');
const cronSourcePath = resolve(root, 'src/lib/server/cron/entry.ts');
const placeholderMarker = 'DO placeholder — real class pending.';
const classPresenceMarker = 'class QuizSession';
const sentinel = '/* __quizmo:injected-worker-extras__ */';

if (!existsSync(workerPath)) {
	console.error(`[inject-do-exports] ${workerPath} not found — did the adapter build run?`);
	process.exit(1);
}

const workerSource = readFileSync(workerPath, 'utf8');
if (workerSource.includes(sentinel)) {
	console.log('[inject-do-exports] already injected, skipping');
	process.exit(0);
}

const doSource = readFileSync(doSourcePath, 'utf8');
if (doSource.includes(placeholderMarker)) {
	throw new Error(
		'[inject-do-exports] Refusing to inject the scaffold placeholder. ' +
			'Write the real DO class in src/lib/server/do/quiz-session.ts first.'
	);
}
if (!doSource.includes(classPresenceMarker)) {
	throw new Error(
		`[inject-do-exports] Expected to find '${classPresenceMarker}' in ${doSourcePath}. ` +
			'Ensure the class is named QuizSession and is defined at the top level.'
	);
}

if (!existsSync(cronSourcePath)) {
	throw new Error(
		`[inject-do-exports] Expected cron entry at ${cronSourcePath}. ` +
			'Create `src/lib/server/cron/entry.ts` exporting `scheduledHandler`.'
	);
}

/**
 * Resolves SvelteKit-style $lib aliases so esbuild can follow them into
 * src/lib/... without ever touching the generated .svelte-kit runtime.
 */
const aliasPlugin = {
	name: 'quizmo-alias',
	setup(build) {
		build.onResolve({ filter: /^\$lib\// }, (args) => {
			const rest = args.path.slice('$lib/'.length);
			for (const ext of ['', '.ts', '.js', '/index.ts', '/index.js']) {
				const candidate = resolve(root, 'src/lib', `${rest}${ext}`);
				if (existsSync(candidate)) return { path: candidate };
			}
			return { errors: [{ text: `Could not resolve $lib alias: ${args.path}` }] };
		});
	}
};

/**
 * Virtual entry that ties both real entry modules into one bundle so esbuild
 * dedupes their shared dependency graph (Drizzle / Valibot / Neverthrow / etc).
 */
const virtualEntryPath = resolve(root, '.svelte-kit/__quizmo-worker-extras-entry.ts');
const virtualEntrySource =
	`import { QuizSession } from ${JSON.stringify(doSourcePath)};\n` +
	`import { scheduledHandler } from ${JSON.stringify(cronSourcePath)};\n` +
	`export { QuizSession, scheduledHandler };\n`;
writeFileSync(virtualEntryPath, virtualEntrySource);

const result = await esbuild.build({
	entryPoints: [virtualEntryPath],
	bundle: true,
	format: 'esm',
	platform: 'neutral',
	target: 'es2022',
	write: false,
	// cloudflare:workers provides DurableObject at runtime; never resolve it.
	external: ['cloudflare:workers'],
	conditions: ['workerd', 'worker', 'import'],
	mainFields: ['module', 'main'],
	plugins: [aliasPlugin],
	logLevel: 'warning'
});

const outFile = result.outputFiles[0];
if (!outFile) throw new Error('[inject-do-exports] esbuild produced no output');
let bundled = outFile.text;

// ESM imports (e.g. `import { DurableObject } from "cloudflare:workers"`) MUST
// stay at the top level — they can't live inside an IIFE or function scope.
// The only collisions we have to solve are the top-level `QuizSession` and
// `scheduledHandler` identifiers, which clash with the final re-export names
// and would also collide if anything else in the generated adapter output uses
// the same symbol. Rename both + rewrite the bundle's tail `export { ... }`.
const doInternalName = '__quizmoQuizSessionImpl';
const cronInternalName = '__quizmoScheduledImpl';

bundled = bundled
	.replace(/\bvar\s+QuizSession\s*=/, `var ${doInternalName} =`)
	.replace(/\bclass\s+QuizSession\b/g, `class ${doInternalName}`)
	.replace(/\basync\s+function\s+scheduledHandler\b/, `async function ${cronInternalName}`)
	.replace(/\bfunction\s+scheduledHandler\b/, `function ${cronInternalName}`)
	.replace(/export\s*\{\s*([^}]*?)\s*\};?\s*$/, (_match, names) => {
		const renamed = names
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
			.map((n) => {
				if (n === 'QuizSession') return doInternalName;
				if (n === 'scheduledHandler') return cronInternalName;
				return n;
			})
			.join(', ');
		return `/* renamed to internal: ${renamed} */`;
	});

const trailer =
	`\n\n${sentinel}\n` +
	bundled +
	`\nexport { ${doInternalName} as QuizSession, ${cronInternalName} as scheduled };\n`;

copyFileSync(workerPath, `${workerPath}.pre-inject.bak`);
writeFileSync(workerPath, workerSource + trailer);

console.log(
	`[inject-do-exports] appended compiled QuizSession + scheduled (${bundled.length} bytes) to ${workerPath}`
);
