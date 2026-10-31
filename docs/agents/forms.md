# Form Handling Standards

Quizmo builds all forms on **`sveltekit-superforms` v2** + **`formsnap` v2** with the **Valibot adapter**. The server is the canonical validation boundary; progressive enhancement comes for free via superforms' own `enhance`.

## Stack

| Piece                       | Source                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------- |
| Form orchestration (client) | `superForm` from `sveltekit-superforms`                                            |
| Form validation (server)    | `superValidate` from `sveltekit-superforms`                                        |
| Schema adapter              | `valibot` (server) / `valibotClient` (client) from `sveltekit-superforms/adapters` |
| Field wrappers              | `$lib/components/ui/form/*` — formsnap-backed, namespace-imported as `* as Form`   |
| UI primitives               | `$lib/components/ui/*` (`Input.Root`, `RadioGroup.Root`, `Button.Root`, …)         |
| Shared schemas              | `$lib/server/db/validators.ts`                                                     |
| Field-level failures        | `setError(form, 'name', msg, { status })`                                          |
| Form-level failures         | `message(form, payload, { status })`                                               |
| Validation-short-circuit    | `return fail(400, { form })` after `!form.valid`                                   |
| Error taxonomy              | `ErrorCode` + `httpStatusFor` from `$lib/server/errors.ts`                         |
| Toasts                      | `svelte-sonner` — `toast.success(...)`, `toast.error(...)`                         |

Three canonical references shipped in the repo, each demonstrating a different pattern:

- Simple form (Pattern A): `src/routes/join/+page.{svelte,server.ts}`
- 2-step wizard (Pattern B): `src/routes/login/+page.{svelte,server.ts}`
- Complex nested (Pattern C): `src/routes/dashboard/_components/quiz-form.svelte` + `src/routes/dashboard/{new,[id]}/+page.server.ts`

Read these first before writing a new form — the shipped code is the spec.

## Mandatory contract

Every form MUST:

1. Define its Valibot schema in `$lib/server/db/validators.ts` (or import an existing one).
2. Call `superValidate(event, valibot(schema))` server-side; bail out with `fail(400, { form })` on `!form.valid`.
3. Use `superForm(data.form, { validators: valibotClient(schema) })` client-side and wrap the `<form>` in `use:enhance` from the destructured returns.
4. Render visible fields through `<Form.Field>` + `<Form.Control>` + `<Form.Label>` + `<Form.FieldErrors />`. No bare `<Input.Root>` without a parent `Form.Field`.
5. Surface form-level failures via `$message` (from superforms' stores) and/or `toast.error(...)` in `onUpdated`.
6. Follow the submit-button pattern (original text + spinner, `aria-disabled` + `onclick` guard — see "Submit button" below).
7. Hardcode English copy (no i18n layer exists).

---

## Pattern A — Simple form (`/join`)

Single action, Turnstile token as a hidden schema field, field-level errors inline, form-level via `$message`.

### Server

```typescript
// src/routes/join/+page.server.ts
import { fail, redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms';
import { valibot } from 'sveltekit-superforms/adapters';

import { joinSchema } from '$lib/server/db/validators';
import { httpStatusFor, isAppError, throwAppError, type ErrorCode } from '$lib/server/errors';

const statusFor = (code: ErrorCode) => httpStatusFor(code) as 400 | 401 | 403 | 404 | 409 | 500;

export const load: ServerLoad = async () => {
	const form = await superValidate(valibot(joinSchema));
	return { form /* + any route-specific data */ };
};

export const actions: Actions = {
	default: async (event) => {
		const form = await superValidate(event, valibot(joinSchema));
		if (!form.valid) return fail(400, { form });

		// Turnstile BEFORE rate-limit: field-level error lands on the widget.
		const ts = await verifyTurnstile(...);
		if (ts.isErr()) return setError(form, 'turnstileToken', ts.error.message, { status: 400 });

		try {
			// ...rate-limit / DB / business logic that may throwAppError
			throw redirect(303, '/next');
		} catch (e) {
			if (isAppError(e)) return message(form, e.message, { status: statusFor(e.code) });
			throw e; // re-throw SvelteKit Redirect / unknowns
		}
	}
};
```

### Client

```svelte
<script lang="ts">
	import { superForm } from 'sveltekit-superforms';
	import { valibotClient } from 'sveltekit-superforms/adapters';

	import * as Form from '$lib/components/ui/form';
	import * as Input from '$lib/components/ui/input';
	import { joinSchema } from '$lib/server/db/validators';

	let { data } = $props();

	// svelte-ignore state_referenced_locally
	const superform = superForm(data.form, {
		validators: valibotClient(joinSchema),
		resetForm: false,
		onUpdated({ form }) {
			if (form.message && !form.valid) toast.error(form.message);
		}
	});
	const { form: formData, errors, enhance, submitting, message } = superform;
</script>

<form method="POST" use:enhance>
	<Form.Field form={superform} name="nickname">
		<Form.Control>
			{#snippet children({ props })}
				<Form.Label>Nickname</Form.Label>
				<Input.Root {...props} bind:value={$formData.nickname} />
			{/snippet}
		</Form.Control>
		<Form.FieldErrors />
	</Form.Field>

	{#if $message}
		<p class="text-destructive text-sm" role="alert">{$message}</p>
	{/if}
</form>
```

---

## Pattern B — 2-step wizard (`/login`)

Single `<form>`, single `superForm` instance, `v.variant(discriminator, branches)` schema, server branches on `form.data.step` and flips `form.data` to advance the client.

### Schema (discriminated union)

```typescript
// src/lib/server/db/validators.ts
export const loginWizardSchema = v.variant('step', [
	v.object({
		step: v.literal('send'),
		email: emailSchema,
		turnstileToken: v.pipe(v.string(), v.minLength(1, 'Please complete the verification'))
	}),
	v.object({
		step: v.literal('verify'),
		email: emailSchema,
		code: otpCodeSchema
	})
]);
```

### Server — single action branching on step

```typescript
export const load: ServerLoad = async () => {
	// Variant schemas can't auto-pick a default branch — seed the initial step.
	const form = await superValidate<LoginWizardOutput, LoginMessage>(valibot(loginWizardSchema), {
		defaults: { step: 'send', email: '', turnstileToken: '' }
	});
	return { form };
};

export const actions: Actions = {
	default: async (event) => {
		const form = await superValidate<LoginWizardOutput, LoginMessage>(
			event,
			valibot(loginWizardSchema)
		);
		if (!form.valid) return fail(400, { form });

		if (form.data.step === 'send') {
			// ...Turnstile / rate-limit / side-effect via runAuthStep
			// Flip the in-memory data and tell the client we've advanced.
			form.data = { step: 'verify', email: form.data.email, code: '' };
			return message(form, { kind: 'advanced', text: 'Code sent. Check your email.' });
		}

		// step === 'verify' — verify OTP, throw redirect on success.
		throw redirect(303, '/dashboard');
	}
};
```

### Client — conditional render on `$formData.step`

```svelte
<form method="POST" use:enhance>
	<!-- Discriminant rides as a form field so the server parser picks the branch. -->
	<input type="hidden" name="step" value={$formData.step} />

	{#if $formData.step === 'send'}
		<Form.Field form={superform} name="email">...</Form.Field>
		<!-- Turnstile widget + hidden turnstileToken input -->
	{:else}
		<input type="hidden" name="email" value={$formData.email} />
		<Form.Field form={superform} name="code">...</Form.Field>
	{/if}
</form>
```

Key details:

- `$formData` reactive access does NOT narrow across `{#if}` branches — each `$` deref is a fresh `get()`. For bindings that target a branch-only field (e.g. `code` lives only on the `verify` variant), use `fieldProxy(superform, 'code')` to get a plain `Writable<string>`.
- Resetting the form data back to step 1 (resend / "Use a different email") uses **whole-object assignment**: `$formData = { step: 'send', email: ..., turnstileToken: '' }`. This widens the union to the correct branch and lets TS narrow branch-specific fields.
- UI-only timer state (resend cooldown, Turnstile widget lifecycle) stays as normal `$state` — it's NOT form state.

### Typed `$message` for wizard flows

Define a tagged union for the route and cast in `onUpdated`:

```typescript
export type LoginMessage =
	| { kind: 'advanced'; text: string }
	| { kind: 'error'; text: string; code?: ErrorCode };
```

`App.Superforms.Message` augmentation in `app.d.ts` would give global typing but we scope it per route instead.

---

## Pattern C — Complex nested (`/dashboard` quiz editor)

Deeply nested arrays (`questions[] → answers[]`) with a cross-field refinement ("exactly one correct answer per question"). Uses `dataType: 'json'` so FormData encoding doesn't flatten the nesting, `arrayProxy` for the top-level array, and direct `$formData.questions[qIdx]!.*` binds under `noUncheckedIndexedAccess`.

```svelte
<script lang="ts">
	import { arrayProxy, superForm, type SuperValidated } from 'sveltekit-superforms';
	import { valibotClient } from 'sveltekit-superforms/adapters';

	import { quizWithQuestionsSchema, type QuizWithQuestions } from '$lib/server/db/validators';

	let { form: initialForm, action, submitLabel }: Props = $props();

	// svelte-ignore state_referenced_locally
	const superform = superForm(initialForm, {
		dataType: 'json',
		validators: valibotClient(quizWithQuestionsSchema),
		resetForm: false
	});
	const { form: formData, errors, enhance, submitting, message } = superform;

	// arrayProxy for top-level questions — mutating $questions triggers re-validation.
	const { values: questions, errors: questionsErrors } = arrayProxy(superform, 'questions');
</script>

{#each $questions as _q, qIdx (qIdx)}
	{@const question = $formData.questions[qIdx]}
	{#if question}
		{@const correctIdx = question.answers.findIndex((a) => a.isCorrect)}
		{@const crossFieldErrors = Array.isArray($errors.questions?.[qIdx])
			? $errors.questions[qIdx]
			: null}

		<Form.Field form={superform} name={`questions[${qIdx}].text`}>
			<Form.Control>
				{#snippet children({ props })}
					<Input.Root {...props} bind:value={$formData.questions[qIdx]!.text} />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<RadioGroup.Root
			value={String(correctIdx >= 0 ? correctIdx : 0)}
			onValueChange={(val) => setCorrect(qIdx, Number(val))}
		>
			{#each question.answers as _a, aIdx (aIdx)}
				<Form.Field form={superform} name={`questions[${qIdx}].answers[${aIdx}].text`}>
					<!-- bind through $formData.questions[qIdx]!.answers[aIdx]!.text -->
				</Form.Field>
			{/each}
		</RadioGroup.Root>

		{#if crossFieldErrors}
			{#each crossFieldErrors as err (err)}
				<p class="text-destructive text-sm font-medium" role="alert">{err}</p>
			{/each}
		{/if}
	{/if}
{/each}
```

### Nested-array idioms — non-obvious rules

1. **Bind through `$formData.`, always.** `bind:value={$formData.questions[qIdx]!.text}` works because the Svelte compiler emits `store_mutate` on assignments whose target starts with `$formData.`. Mutating a local alias (`const q = $formData.questions[qIdx]; q.text = ...`) silently skips the store contract — no re-validation, no reactive update.
2. **`noUncheckedIndexedAccess` + non-null assertions.** Strict TS types `$formData.questions[qIdx]` as `T | undefined`. Guard with `{#if question}` where `question = $formData.questions[qIdx]` narrows the LOCAL, then use `!` on the store path (the assertion is safe inside the guard).
3. **Whole-array rebuilds for deep mutations.** To flip `isCorrect` on one answer, rebuild `$formData.questions` with `.map`, producing a new question object with a new answers array. Don't splice in place. See `replaceQuestionAnswers` in `quiz-form.svelte`.
4. **Cross-field error paths.** Valibot's `v.check` at the question-object level (`questionWithAnswersSchema`'s "exactly one correct") routes to `$errors.questions[qIdx]` as a **`string[]`** — NOT `$errors.questions[qIdx]._errors`, because the last path segment is numeric (the index) so superforms slots it directly into the array.
5. **`RadioGroup` + derived `correctIdx`.** The DB shape is per-answer `isCorrect` booleans; the UI invariant is per-question. Derive `correctIdx = question.answers.findIndex((a) => a.isCorrect)` inside the `{#each}`, bind `RadioGroup.Root value={String(correctIdx)}` + `onValueChange={(val) => setCorrect(qIdx, Number(val))}`. `setCorrect` rebuilds the answers array with only index `aIdx` having `isCorrect: true`.

### Server — edit preload via `superValidate(initial, valibot(schema))`

```typescript
// src/routes/dashboard/[id]/+page.server.ts
export const load: PageServerLoad = async ({ params, locals, platform }) => {
	// ...fetch the quiz tree from D1
	const initial: QuizWithQuestions = {
		title: quiz.title,
		description: quiz.description ?? '',
		questions: hydratedQuestions
	};
	const form = await superValidate(initial, valibot(quizWithQuestionsSchema));
	return { form };
};
```

---

## Server conversion — `AppError` → superforms envelope

Project helpers (`enforceRateLimit`, `verifyTurnstile`, DB wrappers) throw `AppError` on business-rule failures. The canonical envelope shape:

- **Field-specific** error (bad OTP, wrong email, Turnstile denial): `setError(form, 'fieldName', msg, { status })`.
- **Form-level** error (rate-limit exceeded, NOT_FOUND, CONFLICT, INTERNAL_ERROR): `message(form, payload, { status })`.

### `statusFor` helper

`message()` / `setError()` constrain `status` to superforms' internal `NumericRange<400, 599>`. `httpStatusFor(code)` returns a plain `number`. Narrow once per route instead of casting at every call site:

```typescript
const statusFor = (code: ErrorCode) => httpStatusFor(code) as 400 | 401 | 403 | 404 | 409 | 500;
```

### `runAuthStep` — AppError envelope for side-effects

```typescript
async function runAuthStep(form: LoginForm, step: 'send' | 'verify', fn: () => Promise<void>) {
	try {
		await fn();
		return null;
	} catch (e) {
		if (isAppError(e)) {
			return message(
				form,
				{ kind: 'error', text: e.message, code: e.code },
				{ status: statusFor(e.code) }
			);
		}
		// 3rd-party (better-auth APIError etc.) — surface inline on the relevant field.
		const msg = (e as { message?: string })?.message ?? 'Something went wrong.';
		return step === 'verify'
			? setError(form, 'code', msg, { status: 400 })
			: setError(form, 'email', msg, { status: 400 });
	}
}
```

Callers do `const stepFail = await runAuthStep(...); if (stepFail) return stepFail;`.

### Redirect discipline

`throw redirect(303, '/...')` on full success. Inside a try/catch that also catches AppError, test `isAppError(e)` BEFORE re-throwing — the SvelteKit `Redirect` object is NOT an `AppError`, so `isAppError(e)` returns `false` and the `throw e` propagates correctly.

---

## Submit button — MANDATORY pattern

```svelte
<Form.Button
	aria-disabled={$submitting || !canSubmit}
	onclick={(e) => {
		if ($submitting || !canSubmit) e.preventDefault();
	}}
>
	{#if $submitting}
		<Loader2Icon class="mr-2 size-4 animate-spin" aria-hidden="true" />
	{/if}
	Create quiz
</Form.Button>
```

Rules:

1. **Keep the original action text.** Never replace with "Loading…" — the user must always see which action they triggered.
2. **`aria-disabled`, NOT `disabled`.** `disabled` removes the button from the tab order; `aria-disabled` keeps it focusable so screen readers still announce it.
3. **Gate clicks with `onclick` + `preventDefault()`** — since `disabled` isn't in play, short-circuit yourself.
4. **`$submitting` store** from superforms is the source of truth for in-flight state. Don't maintain a parallel `submitting` local.
5. **`canSubmit` is UX sugar only** — server validation is authoritative. Derive from simple client predicates (field length, Turnstile token presence).

---

## Turnstile integration

Turnstile lives OUTSIDE superforms' form API but its token IS a schema field. Schema declares:

```typescript
turnstileToken: v.pipe(v.string(), v.minLength(1, 'Please complete the verification'));
```

Widget lifecycle (see `/join` + `/login` for canonical wiring):

1. Lazy-load `https://challenges.cloudflare.com/turnstile/v0/api.js` on mount if absent.
2. Call `turnstile.render(el, { sitekey, callback })` once `turnstileEl` is bound.
3. `callback(token)` writes into `$formData.turnstileToken` (Pattern A) OR into a local `$state` that a separate `$effect` mirrors into `$formData` (Pattern B — branch narrowing forces this).
4. On form reset / step transition, call `turnstile.reset(widgetId)` OR clear `turnstileWidgetId = null` and blank `turnstileEl.innerHTML` so the next `$effect` run mounts a fresh widget.
5. On unmount, `turnstile.remove(widgetId)` in the cleanup function.

Hidden input mirrors the token into the submitted FormData:

```svelte
<input type="hidden" name="turnstileToken" value={$formData.turnstileToken} />
```

Server-side ordering: **Turnstile FIRST, rate-limit SECOND, business logic THIRD.** Scripted requests with no token are rejected by the schema (`minLength(1)`); the Turnstile verify call is an additional check that the token is real and not replayed.

---

## Formsnap wrappers — `$lib/components/ui/form/*`

Eight exports, accessed via `import * as Form from '$lib/components/ui/form'`:

| Export             | When to use                                                              |
| ------------------ | ------------------------------------------------------------------------ |
| `Form.Field`       | Wraps a single field. Requires `form={superform}` + `name="path"`.       |
| `Form.Fieldset`    | Groups related fields (e.g. all answer-text inputs for one question).    |
| `Form.Legend`      | Caption for a `Form.Fieldset`.                                           |
| `Form.Control`     | Snippet render prop that exposes `{ props }` — spread onto `Input.Root`. |
| `Form.Label`       | Label paired with the control inside a `Form.Field`.                     |
| `Form.Description` | Inline help text.                                                        |
| `Form.FieldErrors` | Renders Valibot errors for this field. Place inside `Form.Field`.        |
| `Form.Button`      | Submit button primitive (preserves disabled-state semantics).            |

Canonical field shape:

```svelte
<Form.Field form={superform} name="email">
	<Form.Control>
		{#snippet children({ props })}
			<Form.Label>Email</Form.Label>
			<Input.Root {...props} bind:value={$formData.email} />
		{/snippet}
	</Form.Control>
	<Form.FieldErrors />
</Form.Field>
```

`Form.Control`'s `{ props }` includes `id`, `aria-invalid`, `aria-describedby` — don't hand-roll these.

---

## Known pitfalls

| Pitfall                                                             | Fix                                                                                                                                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state_referenced_locally` warning on `superForm(data.form, ...)`   | Intentional — `superForm` captures the initial snapshot once. Suppress locally with `// svelte-ignore state_referenced_locally` + comment.                                                        |
| `noUncheckedIndexedAccess` breaks nested binds                      | Use `{@const question = $formData.questions[qIdx]}` + `{#if question}`, then `bind:value={$formData.questions[qIdx]!.text}` on the store path.                                                    |
| Mutating nested via local alias doesn't re-validate                 | Always assign through `$formData.foo = ...`. Rebuild arrays with `.map` instead of in-place mutations.                                                                                            |
| Variant schema (`v.variant`) has no single default                  | `load()` passes `defaults: { step: 'send', ... }` to `superValidate(valibot(schema), { defaults })`.                                                                                              |
| `$formData` doesn't narrow across `{#if}` branches                  | Use `fieldProxy(superform, 'branchField')` for branch-only fields, or assign whole-object `$formData = { step: '...', ... }` to widen.                                                            |
| `App.Superforms.Message` typing                                     | Project doesn't augment `app.d.ts`. Define a per-route tagged union (`LoginMessage`, etc.) and cast `form.message as LoginMessage` in `onUpdated`.                                                |
| `message()` / `setError()` reject `httpStatusFor(code)` with TS2322 | Add `statusFor` helper that narrows to the `NumericRange` union.                                                                                                                                  |
| Nested array error routing                                          | `v.check` on an array-element object lands in `$errors.arr[idx]` as `string[]` (not `_errors`) because the last path segment is numeric.                                                          |
| `resetForm` / `taintedMessage`                                      | v2 defaults are production-friendly (`resetForm: true` on success, `taintedMessage: undefined`). We set `resetForm: false` on flows where the user should see their inputs after a failed submit. |
| Redirect inside try/catch                                           | `if (isAppError(e)) return ...` BEFORE `throw e` — the SvelteKit Redirect isn't an AppError and must propagate.                                                                                   |

---

## Shared validators live in `$lib/server/db/validators.ts`

Current exports:

| Schema                                                | Shape                                           | Used by                    |
| ----------------------------------------------------- | ----------------------------------------------- | -------------------------- |
| `emailSchema`                                         | trim + email + lowercase transform              | every email field          |
| `nicknameSchema`                                      | trim + 1–20 chars                               | `joinSchema`               |
| `joinCodeSchema`                                      | 6 uppercase alphanumerics                       | `joinSchema`               |
| `otpCodeSchema`                                       | 6 digits                                        | `loginWizardSchema` verify |
| `joinSchema`                                          | `{ code, nickname, turnstileToken }`            | `/join`                    |
| `loginWizardSchema`                                   | `v.variant('step', [send, verify])`             | `/login`                   |
| `questionWithAnswersSchema`                           | per-question refinement (exactly-one-correct)   | quiz editor                |
| `quizWithQuestionsSchema`                             | full quiz: title + description + 3–25 questions | quiz editor                |
| `createInsertSchema` / `createSelectSchema` per table | drizzle-valibot base schemas                    | DB ops                     |

Schema is the single source of truth. Refinements (`v.pipe`, `v.check`, cross-field) layer on top of the drizzle-derived base.

---

## Forbidden patterns

| ❌ Never                                                     | ✅ Instead                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `v.safeParse(schema, await request.formData())` in an action | `superValidate(event, valibot(schema))`                                         |
| Plain `use:enhance` from `$app/forms`                        | `enhance` destructured from `superForm(...)`                                    |
| `applyAction(result)` manual calls                           | Superforms v2 handles redirects + form prop updates automatically               |
| Hidden `<input name="payload" value={JSON.stringify(...)}>`  | `superForm({ dataType: 'json' })` — serialization is built-in                   |
| Two separate `<form>` elements for a wizard                  | Single `<form>` + `v.variant` schema + server branch on `form.data.step`        |
| `disabled={$submitting}` on submit buttons                   | `aria-disabled={$submitting}` + `onclick` preventDefault guard                  |
| Replacing button label with "Loading…"                       | Keep label, show `Loader2Icon` alongside                                        |
| `zod`                                                        | Valibot (`import * as v from 'valibot'`) + `valibot` / `valibotClient` adapters |
| Raw `throw` for validation failures                          | `fail(400, { form })` / `setError` / `message` — only `redirect()` throws       |
| Mutating nested arrays in place (`q.answers.splice(...)`)    | Rebuild through `$formData.questions = $formData.questions.map(...)`            |
| Hardcoded error strings in rendered UI                       | Error message lives in the schema (`v.pipe(..., v.minLength(1, '...'))`)        |
| i18n keys (`m['...']`)                                       | Hardcoded English — no i18n layer exists                                        |

---

## Best practices

1. Schema in `$lib/server/db/validators.ts` is the spec; refinements carry user-facing copy.
2. Server action short-circuits on `!form.valid` with `fail(400, { form })`. Every business-rule error goes through the `statusFor(code)` narrowing.
3. Turnstile BEFORE rate-limit BEFORE business logic — so scripted requests never touch side-effect paths.
4. Toasts for background failures (rate-limit, 3rd-party outages). Inline errors via `Form.FieldErrors` for validation. `$message` renders both inline and as a toast in `onUpdated`.
5. Clean imports after every edit. Unused `applyAction`, `fail`, icons, etc. are bugs.
6. English copy everywhere, hardcoded.
