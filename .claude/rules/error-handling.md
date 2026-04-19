# Error Handling Standards

Quizmo uses **two different patterns** depending on where the code runs. Never mix them.

| Location                                               | Pattern               | Library      | Source                  |
| ------------------------------------------------------ | --------------------- | ------------ | ----------------------- |
| Server (`src/lib/server/**`, `+*.server.ts`, DO, cron) | Throw `AppError`      | Native       | `$lib/server/errors.ts` |
| Client (`+page.svelte`, `src/lib/components/**`)       | `Result<T, AppError>` | `neverthrow` | `$lib/utils/result.ts`  |

`try/catch` is reserved for the **edge** (wrapping 3rd-party calls). Never use it for flow control.

---

## Server: `throwAppError`

Canonical throw site for every server-side failure. Defined in `$lib/server/errors.ts`.

```typescript
export type ErrorCode =
	| 'NOT_FOUND'
	| 'UNAUTHENTICATED'
	| 'FORBIDDEN'
	| 'INVALID_INPUT'
	| 'CONFLICT'
	| 'INTERNAL_ERROR';

export class AppError extends Error {
	constructor(
		public readonly code: ErrorCode,
		message: string
	) {
		super(message);
		this.name = 'AppError';
	}
}

export const throwAppError = (code: ErrorCode, message: string): never => {
	throw new AppError(code, message);
};
```

### Usage

```typescript
import { throwAppError } from '$lib/server/errors';

// ✅ GOOD — single-line if + throw (no braces)
const quiz = await db.select().from(quizzes).where(eq(quizzes.id, id)).get();
if (!quiz) throwAppError('NOT_FOUND', 'Quiz not found');

if (quiz.ownerId !== locals.user.id)
	throwAppError('FORBIDDEN', "You don't have permission to edit this quiz");

// ❌ BAD — raw Error, no code
if (!quiz) throw new Error('Quiz not found');
```

### Code → HTTP mapping

Centralized in `httpStatusFor`:

| Code              | HTTP | When                                                    |
| ----------------- | ---- | ------------------------------------------------------- |
| `NOT_FOUND`       | 404  | Resource doesn't exist                                  |
| `UNAUTHENTICATED` | 401  | No / invalid session                                    |
| `FORBIDDEN`       | 403  | Authenticated, not authorized                           |
| `INVALID_INPUT`   | 400  | Validation failed (Valibot `safeParse` error, bad form) |
| `CONFLICT`        | 409  | Unique violation, duplicate resource                    |
| `INTERNAL_ERROR`  | 500  | Unexpected (DB failure, Resend outage, third-party)     |

### `guardAppError` — route-level conversion

SvelteKit catches errors thrown inside `+server.ts` / actions internally, so they never bubble through `hooks.server.ts#handle`. The conversion from `AppError` → SvelteKit's `error(status, body)` must happen at the throw site or via a per-handler wrapper.

```typescript
// +server.ts
import { json, type RequestHandler } from '@sveltejs/kit';

import { guardAppError, throwAppError } from '$lib/server/errors';

export const GET: RequestHandler = async (event) =>
	guardAppError(async () => {
		const quiz = await loadQuiz(event.params.id);
		if (!quiz) throwAppError('NOT_FOUND', 'Quiz not found');
		return json(quiz);
	});
```

`guardAppError` produces the correct HTTP status AND the `App.Error`-shaped `page.error` that `src/routes/+error.svelte` reads (`page.error.message`, `page.error.code`).

### Form actions — inline failures via superforms, not throws

Form actions (in `+page.server.ts`) surface validation / rate-limit errors inline through `sveltekit-superforms`. Only `redirect()` escapes via `throw`. Full pattern in `forms.md`; the short version:

- `superValidate(event, valibot(schema))` → `fail(400, { form })` on `!form.valid`.
- Field-specific error → `setError(form, 'name', msg, { status })`.
- Form-level error (rate-limit, Turnstile denial, NOT_FOUND) → `message(form, payload, { status })`.
- `AppError` thrown from helpers is caught in a local `try/catch` (or `runAuthStep`-style wrapper) and converted to one of the two superforms envelopes above. See `src/routes/login/+page.server.ts` for the canonical `runAuthStep`.

```typescript
const form = await superValidate(event, valibot(schema));
if (!form.valid) return fail(400, { form });

try {
	// ...business logic that may throwAppError
} catch (e) {
	if (isAppError(e)) return message(form, e.message, { status: statusFor(e.code) });
	throw e; // re-throw SvelteKit Redirect / unknowns
}
```

---

## Client: `neverthrow` Result

Use `Result<T, AppError>` for anything that might fail and needs branching. Import from `$lib/utils/result.ts` (thin wrapper around `neverthrow`).

```typescript
import { AppError } from '$lib/server/errors';
import { err, fromPromise, ok, Result } from '$lib/utils/result';

// ✅ GOOD — Result pattern
async function loadLeaderboard(sessionId: string): Promise<Result<Row[], AppError>> {
	const r = await fromPromise(
		fetch(`/api/sessions/${sessionId}/leaderboard`).then((res) => res.json())
	);
	if (r.isErr()) return err(r.error);
	return ok(r.value);
}

// ❌ BAD — try/catch for flow control
async function loadLeaderboard(sessionId: string) {
	try {
		const res = await fetch(`/api/sessions/${sessionId}/leaderboard`);
		return await res.json();
	} catch (e) {
		throw new Error('Failed to load');
	}
}
```

### `fromPromise` + `extractAppError`

`fromPromise` is preconfigured with `extractAppError` as the error mapper, so any thrown value is normalized into `AppError`:

- `AppError` instances pass through verbatim (preserves `code`).
- Any other `Error` → `AppError('INTERNAL_ERROR', err.message)`.
- Everything else → `AppError('INTERNAL_ERROR', 'Unknown error')`.

```typescript
const result = await fromPromise(someApiCall());
if (result.isErr()) {
	switch (result.error.code) {
		case 'NOT_FOUND':
			toast.error('Not found');
			break;
		case 'UNAUTHENTICATED':
			await goto('/login');
			break;
		default:
			toast.error('Something went wrong');
	}
}
```

### Consuming Results

```typescript
const result = await loadLeaderboard(sessionId);

if (result.isErr()) {
	toast.error(result.error.message);
	return;
}

// TS knows result.value is Row[]
renderRows(result.value);
```

### When `try/catch` IS allowed

Only at the edge — wrapping a 3rd-party call that doesn't already throw `AppError`:

```typescript
// ✅ edge: converting a raw library throw into a Result
async function callExternal(url: string): Promise<Result<Data, AppError>> {
	try {
		const data = await externalLib.fetch(url);
		return ok(data);
	} catch (e) {
		return err(
			e instanceof Error
				? new AppError('INTERNAL_ERROR', e.message)
				: new AppError('INTERNAL_ERROR', 'External call failed')
		);
	}
}
```

`fromPromise` already handles this for promise-returning APIs — use the wrapper when you can.

---

## Error UI

Quizmo has **no** `QueryErrorState` component. SvelteKit's native error boundary is the fallback.

### Server-rendered routes → `+error.svelte`

Dashboard pages (`/dashboard`, `/dashboard/new`, `/dashboard/[id]`, etc.) are server-rendered. When a `load` or action throws through `guardAppError`, SvelteKit renders `src/routes/+error.svelte` with `page.status` + `page.error.message`. That component already switches on HTTP status (400/401/403/404/409/500) and renders a friendly title + body + "Back to home" link.

For route-specific fallbacks, add a sibling `+error.svelte` in the route folder — SvelteKit walks up the tree until it finds one.

### Live routes (`/host/[sessionId]`, `/play/[sessionId]`) → inline + toast

Host and participant pages are live WebSocket clients. Errors from the socket (server-side `{ type: 'error', payload }` frames) are handled inline by the page: consume the message, pick a branch (render a recovery UI, `toast.error()` via `svelte-sonner`, or redirect). No shared component for this — it's view-specific.

---

## Summary

- **Server** → `throwAppError(code, msg)` + `guardAppError` wrapper for `+server.ts` / ad-hoc handlers.
- **Form actions** → `superValidate` + `setError` / `message` / `fail(400, { form })` for inline UX, not throws. Full pattern in `forms.md`.
- **Client** → `Result<T, AppError>` via `$lib/utils/result.ts` (`fromPromise`, `extractAppError`).
- **No `try/catch` for flow control** — only at edges wrapping 3rd-party calls.
- **No custom error-display component.** SvelteKit's native `+error.svelte` at `src/routes/+error.svelte` is the fallback for server-rendered routes; live WebSocket routes handle errors inline + via toast.
