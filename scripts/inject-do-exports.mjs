#!/usr/bin/env bun
/**
 * Post-build step: compile `src/lib/server/do/quiz-session.ts` (+ its deps) and
 * append a named `export { QuizSession }` to the adapter-cloudflare generated
 * worker entry. The adapter emits only `export default` — wrangler requires
 * DO classes as named exports alongside it.
 *
 * Why the extra hoop (still, as of @sveltejs/adapter-cloudflare 7.2.x):
 *   The adapter's `files/worker.js` template ends in
 *     `export { worker_default as default };`
 *   and offers no hook for named-export extension. The project has no separate
 *   "Worker for DOs" script ( → single-worker deployment), so
 *   we inline the compiled DO bundle into the same `_worker.js`.
 *
 * Design:
 *   1. Use esbuild (transitive dep of the adapter) to bundle the DO entry in
 *      ESM format, externalizing CF runtime-provided specifiers
 *      (`cloudflare:workers`) and any $lib aliases we resolve locally via
 *      plugins. The output is self-contained JS.
 *   2. Strip the bundled module's `export` markers and rename its exported
 *      identifier to a unique name (`__QuizSession_injected`) so the default
 *      adapter output's top-level bindings don't collide.
 *   3. Append the stripped module + a `export { __QuizSession_injected as
 *      QuizSession };` trailer to `_worker.js`, guarded by a sentinel comment
 *      so reruns are idempotent.
 *
 * Safety gate:
 *   Refuses to run if `src/lib/server/do/quiz-session.ts` still carries the
 *   original scaffold placeholder marker. (In a later build that marker is removed — the
 *   build must compile real code; there's no "shim" fallback anymore.)
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
const placeholderMarker = 'DO placeholder — real class pending.';
const classPresenceMarker = 'class QuizSession';
const sentinel = '/* __quizmo:injected-do-exports__ */';

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

/**
 * Resolves SvelteKit-style $lib aliases so esbuild can follow them into
 * src/lib/... without ever touching the generated .svelte-kit runtime.
 */
const aliasPlugin = {
	name: 'quizmo-alias',
	setup(build) {
		build.onResolve({ filter: /^\$lib\// }, (args) => {
			const rest = args.path.slice('$lib/'.length);
			// Try common extensions.
			for (const ext of ['', '.ts', '.js', '/index.ts', '/index.js']) {
				const candidate = resolve(root, 'src/lib', `${rest}${ext}`);
				if (existsSync(candidate)) return { path: candidate };
			}
			return { errors: [{ text: `Could not resolve $lib alias: ${args.path}` }] };
		});
	}
};

const result = await esbuild.build({
	entryPoints: [doSourcePath],
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
// So we leave them as-is. The only collision we actually have to solve is the
// top-level `QuizSession` identifier, which clashes with the re-export name.
// Rename the declaration (and its single local `export { QuizSession }`) to
// an internal unique name, then export that under the public `QuizSession`
// symbol.
const internalName = '__quizmoQuizSessionImpl';
// The TS-compiled class is typically emitted as `var QuizSession = class extends DurableObject { ... };`
// or `class QuizSession { ... }`. Rename both forms, plus the export list.
bundled = bundled
	.replace(/\bvar\s+QuizSession\s*=/, `var ${internalName} =`)
	.replace(/\bclass\s+QuizSession\b/g, `class ${internalName}`)
	.replace(/export\s*\{\s*([^}]*?)\s*\};?\s*$/, (_match, names) => {
		const renamed = names
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
			.map((n) => (n === 'QuizSession' ? internalName : n))
			.join(', ');
		// Keep this as a local statement so the symbols are in scope for the
		// trailer. We don't re-emit `export { ... }` here because the top-level
		// named-export happens in the trailer itself.
		return `/* renamed to internal: ${renamed} */`;
	});

const trailer = `\n\n${sentinel}\n` + bundled + `\nexport { ${internalName} as QuizSession };\n`;

copyFileSync(workerPath, `${workerPath}.pre-inject.bak`);
writeFileSync(workerPath, workerSource + trailer);

console.log(
	`[inject-do-exports] appended compiled QuizSession (${bundled.length} bytes) to ${workerPath}`
);
