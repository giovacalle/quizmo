# SvelteKit Frontend Standards

Quizmo is a **single SvelteKit 2 app** on Cloudflare Workers. No monorepo, no `apps/web` split — all frontend code lives under `src/`.

## Svelte 5 runes only

Always use runes syntax. Legacy `$:` reactive statements are forbidden.

```svelte
<script lang="ts">
	// ✅ GOOD — runes
	let count = $state(0);
	const doubled = $derived(count * 2);

	$effect(() => {
		console.log('Count changed:', count);
	});

	// ❌ BAD — legacy
	let count = 0;
	$: doubled = count * 2;
</script>
```

## `runed` — Svelte 5 utility library

**Before writing any custom hook, check [runed](https://runed.dev) first.** Already installed.

Common utilities:

| Need                  | Use                    |
| --------------------- | ---------------------- |
| Debounced value       | `Debounced`            |
| Throttled value       | `Throttled`            |
| Previous value        | `Previous`             |
| Element size          | `ElementSize`          |
| Media queries         | `MediaQuery`           |
| Local/Session storage | `PersistedState`       |
| Clipboard             | `Clipboard`            |
| Intersection observer | `IntersectionObserver` |
| Active element        | `ActiveElement`        |
| Document visibility   | `DocumentVisibility`   |
| Async resource        | `resource`             |

```typescript
import { Debounced, MediaQuery, PersistedState } from 'runed';

let search = $state('');
const debouncedSearch = new Debounced(() => search, 300);

const isMobile = new MediaQuery('(max-width: 768px)');
const theme = new PersistedState('theme', 'light');
```

**Rule:** no custom hooks for behavior `runed` already covers.

## Cloudflare Workers compatibility

The app runs on **Cloudflare Workers** via `@sveltejs/adapter-cloudflare`. No Node.js primitives on any code path that runs server-side:

- ❌ `fs`, `path`, `child_process`
- ❌ `node:crypto` (use `crypto.subtle` / `crypto.getRandomValues`)
- ❌ `process.env` — use `platform.env` in SvelteKit contexts, `env` inside DOs / `scheduled()`
- ❌ Node streams, long-lived timers that outlive a request

Bindings (typed by `wrangler types` → `worker-configuration.d.ts`):

```typescript
// +page.server.ts
export const load = async ({ platform }) => {
	const db = platform!.env.QUIZMO_DB; // D1
	const authKv = platform!.env.QUIZMO_AUTH_KV; // KV
	const quizKv = platform!.env.QUIZMO_QUIZ_KV; // KV
	const sessionNs = platform!.env.QUIZMO_SESSION; // Durable Object namespace
};
```

Never hand-write the `Env` interface — it drifts. Always re-run `wrangler types` (or `bun run check`, which does it first) after editing `wrangler.jsonc`.

## Data loading — `+page.server.ts` → `+page.svelte`

The dashboard + auth routes are **server-rendered**. Data fetching happens in `load` functions and arrives in the page as the `data` prop.

```typescript
// +page.server.ts
import type { PageServerLoad } from './$types';

import { throwAppError } from '$lib/server/errors';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.user) throwAppError('UNAUTHENTICATED', 'Sign in required');

	const db = platform!.env.QUIZMO_DB;
	// ...drizzle query, return a plain object
	return {
		rows: [...],
		activeCount: 1,
		nonArchivedCount: 5
	};
};
```

```svelte
<!-- +page.svelte -->
<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

{#each data.rows as quiz (quiz.id)}
	<!-- ... -->
{/each}
```

**Mutations** go through SvelteKit form actions (see `forms.md`), not client-side hooks.

### What about client-only pages?

Only `/host/[sessionId]` (host live console) and `/play/[sessionId]` (participant live screen) are client-heavy — they're WebSocket clients talking to the `QuizSession` Durable Object. Even those have a `+page.server.ts` that loads the session metadata + the participant/host token; the real-time part takes over after hydration via `_lib/host-socket.svelte.ts` (for host) or an equivalent for the player.

**There is no "SPA mode" layout group.** Every route is server-rendered on first load.

## Types from Drizzle

When you need a row type, use Drizzle's inferred types — don't redefine.

```typescript
// ✅ GOOD
import { quizzes } from '$lib/server/db/schema';

type Quiz = typeof quizzes.$inferSelect;
type QuizInsert = typeof quizzes.$inferInsert;

interface Props {
	quiz: Quiz;
	title: Quiz['title'];
}

// ❌ BAD — re-declaring DB columns
interface Props {
	quiz: { id: string; title: string; ownerId: string; ... };
}
```

Shared input schemas (`QuizInsert`, `QuestionWithAnswers`, etc.) live in `src/lib/server/db/validators.ts` — import `InferOutput` types from there when client code needs them:

```typescript
import type { QuizWithQuestions } from '$lib/server/db/validators';
```

## Component architecture

```
src/
├── lib/
│   ├── components/
│   │   ├── ui/                  # shadcn-svelte primitives
│   │   ├── leaderboard.svelte   # reusable composite
│   │   └── mode-toggle.svelte   # reusable composite
│   ├── server/                  # runs on the Worker only (auth, db, DO, cron, errors)
│   ├── utils/                   # isomorphic helpers (result.ts)
│   └── utils.js                 # cn() helper for shadcn
└── routes/
    ├── dashboard/
    │   ├── +page.server.ts
    │   ├── +page.svelte
    │   ├── _components/         # page-private
    │   │   └── quiz-form.svelte
    │   └── new/+page.svelte
    └── ...
```

| Component type               | Location                           |
| ---------------------------- | ---------------------------------- |
| shadcn-svelte primitive      | `src/lib/components/ui/<name>/`    |
| Reusable composite (2+ uses) | `src/lib/components/<name>.svelte` |
| Page-private composite       | `src/routes/<path>/_components/`   |

## Import patterns

```typescript
// Icons — one per lucide path (small bundle)
import Loader2Icon from '@lucide/svelte/icons/loader-2';
import PlusIcon from '@lucide/svelte/icons/plus';

// UI primitives — named export for single-component primitives
import { Badge } from '$lib/components/ui/badge';
// UI primitives — namespace barrel for compound APIs
import * as Button from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';
// Server-only — never import from a .svelte file
import { throwAppError } from '$lib/server/errors';
import { cn } from '$lib/utils.js';
// Utilities
import { fromPromise } from '$lib/utils/result';
```

## File naming

- Components: `kebab-case.svelte` (e.g., `mode-toggle.svelte`, `quiz-form.svelte`).
- Routes follow SvelteKit conventions (`+page.svelte`, `+page.server.ts`, `+error.svelte`, `+layout.*`).
- Page-private components: under `_components/` (underscore prefix keeps them out of routing).

## Error handling

Full rules in `error-handling.md`. TL;DR:

- **Server**: `throwAppError(code, message)` from `$lib/server/errors.ts`. Wrap `+server.ts` handlers with `guardAppError`. In form actions, use `fail(...)` instead of throws.
- **Client**: `Result<T, AppError>` via `$lib/utils/result.ts` (`fromPromise`, `extractAppError`).
- **No `try/catch` for flow control**, only at the edge.
- **No `QueryErrorState`, no `AppError`** — Quizmo uses SvelteKit's native `+error.svelte` at `src/routes/+error.svelte`.

## Page layout conventions

Each page starts with `<svelte:head>` for the title, wraps in `<main class="mx-auto max-w-Nxl px-4 py-10 sm:py-16">`, then:

1. Optional back button (for create/edit / detail pages).
2. `<header>` with `h1` + muted `p` description.
3. Content.

The root layout (`src/routes/+layout.svelte`) owns theme + toast provider only — it does NOT render a per-page title bar. Each page owns its own header.

See `src/routes/dashboard/+page.svelte` and `src/routes/dashboard/new/+page.svelte` for the canonical shape.

## Create / edit pattern

For entities with both create and edit flows (quizzes are the main example), share a form component across the two routes:

```
src/routes/dashboard/
├── _components/
│   └── quiz-form.svelte     # shared form, takes `initial?` + `action` + `submitLabel`
├── new/
│   └── +page.svelte         # uses quiz-form with action="?/create"
└── [id]/
    └── +page.svelte         # uses quiz-form with initial={data.quiz} + action="?/update"
```

Principles:

- **Back button above the form** via `<Button.Root href="/dashboard" variant="ghost" size="sm">` — no cancel button inside.
- **No `Card` wrapper around the whole form** — let Cards scope logical sections (e.g. "Basics", "Questions").
- **Single source of truth**: one form component, two entry points. Differ by `initial` prop.
- **Submit label as prop** (`submitLabel="Create quiz"` vs `"Save changes"`).
- **`<svelte:head>`** in each page sets the title.

## `as any` is forbidden

TS strict mode with `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess` is on. `as any` bypasses the whole contract:

```typescript
// ❌ BAD
const quizId = params.id as any;

// ✅ GOOD — either the type matches, or refine / validate at the boundary
const quizId = params.id; // already string per route types
```

Narrow edge-case exceptions are documented inline with `// eslint-disable-next-line @typescript-eslint/no-explicit-any` + a short comment (see `button.svelte`'s `resolve(rawHref as any)` cast, which is genuinely necessary because `resolve()` has a narrow union that can't represent external URLs).

## Svelte 5 props + state — `state_referenced_locally`

This warning fires when you capture a prop's value directly inside `$state()`. That snapshots the initial value and never updates.

### Wrong

```svelte
<script>
	let { initialData } = $props();
	let name = $state(initialData?.name ?? ''); // ⚠️ state_referenced_locally
</script>
```

### Right — pick based on what you need

**Read-only, should reflect prop changes:**

```svelte
<script>
	let { data } = $props();
	const name = $derived(data?.name ?? '');
</script>
```

**Mutable local state seeded by the prop (editable form field):**

```svelte
<script>
	let { initialData } = $props();
	let name = $state('');

	$effect(() => {
		name = initialData?.name ?? '';
	});
</script>
```

**Deeply nested seed (e.g., quiz editor):**

See `src/routes/dashboard/_components/quiz-form.svelte` — uses `$derived.by(() => initial)` + `$effect` to re-seed all local `$state` on prop change.

### Decision table

| Need                          | Use                                                         |
| ----------------------------- | ----------------------------------------------------------- |
| Read-only derived display     | `const x = $derived(prop.value)`                            |
| Editable field seeded by prop | `let x = $state(''); $effect(() => { x = prop.value })`     |
| Deep nested seed              | `$derived.by(() => prop)` + `$effect` to copy into `$state` |

## Import hygiene — MANDATORY

After **every** file edit, scan the imports block and remove anything no longer used. This catches:

- Icons you swapped.
- Primitives you replaced or removed.
- Utils you refactored away.
- Types that no longer appear in the script.

TypeScript strict mode flags unused locals, but unused imports can still slip past under certain conditions — don't rely on the compiler, scan visually.

```bash
bun run check   # wrangler types + svelte-check; catches most unused-import cases
```

## Code comments

- **English only.**
- Comments explain **why**, not what. If the name + type convey the meaning, drop the comment.
- Zero tolerance for auto-generated JSDoc on obvious props. See `src/lib/server/errors.ts` for examples of comments that genuinely add value (they explain architecture decisions that the code alone doesn't).

```typescript
// ❌ BAD — restates the code
// Set the name
user.name = value;

// ✅ GOOD — explains a non-obvious decision
// `reset: false` preserves the email input value — otherwise update() wipes
// the form fields and bind:value={email} syncs empty back into state before
// step advances to 'verify', breaking the hidden `email` input on step 2.
```

## Best practices

1. **Check `src/lib/components/ui/` before creating any primitive.** Reach for `bunx shadcn-svelte@latest add …` if missing.
2. **Semantic tokens only.** No hardcoded colors.
3. **Type everything.** Drizzle `$inferSelect` / `$inferInsert` for rows. Valibot `InferOutput` for form payloads.
4. **Loading / empty / error states** for every list + every async call.
5. **Runed before custom.** Before writing a reactive utility, check runed.
6. **No `as any`.** Narrow types properly.
7. **Server rules live in `$lib/server/`** — no `.svelte` file imports from there.
8. **Clean imports** after every edit.
9. **English copy** everywhere — no i18n layer exists.
