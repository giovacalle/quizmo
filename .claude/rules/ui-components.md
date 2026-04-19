# UI Components Standards

Quizmo is a **single app** (no monorepo). All UI lives under `src/lib/components/` and `src/routes/**/_components/`.

## Design Principles

Every screen must clear a high UX bar:

- **Balance & Hierarchy** — proper visual weight distribution.
- **Accessible Contrast** — WCAG AA minimum, tested in both themes.
- **Delightful Interactions** — subtle transitions, no abrupt state changes.
- **No redundant descriptions** — if a subtitle merely restates the title, drop it.
- **EN only** — all copy is hardcoded English. No i18n layer exists.

## Where components live

```
src/lib/components/
├── ui/                              # shadcn-svelte primitives (do not hand-author)
│   ├── alert-dialog/
│   ├── badge/
│   ├── button/
│   ├── card/
│   ├── dialog/
│   ├── dropdown-menu/
│   ├── form/
│   ├── input/
│   ├── label/
│   ├── progress/
│   ├── radio-group/
│   ├── separator/
│   └── skeleton/
├── leaderboard.svelte               # reusable app-level composite
└── mode-toggle.svelte               # reusable app-level composite

src/routes/<path>/_components/       # page-private composites (e.g. dashboard/_components/quiz-form.svelte)
```

| Component type                                           | Location                           |
| -------------------------------------------------------- | ---------------------------------- |
| shadcn-svelte primitive (Button, Input, Dialog, …)       | `src/lib/components/ui/<name>/`    |
| Reusable app-level composite (used across 2+ routes)     | `src/lib/components/<name>.svelte` |
| Page-private composite (used only inside one route tree) | `src/routes/<path>/_components/`   |

File names are **kebab-case** always: `mode-toggle.svelte`, not `ModeToggle.svelte`.

## Importing primitives — two styles

shadcn-svelte primitives with compound APIs (Button, Card, Input, Label, Dialog, etc.) are exported as a **namespace barrel** — import them with `* as` and use `.Root` / `.Content` etc:

```svelte
<script lang="ts">
	import * as Button from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Input from '$lib/components/ui/input';
	import * as Label from '$lib/components/ui/label';
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Title</Card.Title>
	</Card.Header>
	<Card.Content>
		<Label.Root for="email">Email</Label.Root>
		<Input.Root id="email" name="email" type="email" />
		<Button.Root type="submit">Submit</Button.Root>
	</Card.Content>
</Card.Root>
```

Single-component primitives (Badge) use a **named export**:

```svelte
<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
</script>

<Badge variant="success">Active</Badge>
```

**Check the primitive's `index.ts` to see which style it uses** before importing.

## Variant catalogs

### `Button` (`src/lib/components/ui/button/button.svelte`)

| Prop      | Values                                                                      |
| --------- | --------------------------------------------------------------------------- |
| `variant` | `default` · `outline` · `secondary` · `ghost` · `destructive` · `link`      |
| `size`    | `default` · `xs` · `sm` · `lg` · `icon` · `icon-xs` · `icon-sm` · `icon-lg` |

Defaults: `variant="default"`, `size="default"`. The component auto-switches between `<a>` (when `href` is set) and `<button>`, resolves the href via `$app/paths`, and honors `aria-disabled` on the link branch. `cursor-pointer` is baked into the base class.

### `Badge` (`src/lib/components/ui/badge/badge.svelte`)

| Prop      | Values                                                                             |
| --------- | ---------------------------------------------------------------------------------- |
| `variant` | `default` · `secondary` · `destructive` · `success` · `outline` · `ghost` · `link` |

Note: `success` was added locally (it's not in the stock shadcn-svelte Badge). Use it for "Active session", "Published", etc. — any positive status.

## Semantic color tokens (MANDATORY)

Colors are CSS variables defined in `src/app.css` (light + dark, Quiz Soft palette). **NEVER hardcode colors.**

| Use case                     | Token                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| Page background              | `bg-background`                                                                      |
| Card background              | `bg-card` + `text-card-foreground`                                                   |
| Popover / dialog background  | `bg-popover` + `text-popover-foreground`                                             |
| Muted background             | `bg-muted`                                                                           |
| Muted accent tint            | `bg-accent` + `text-accent-foreground`                                               |
| Primary action               | `bg-primary` + `text-primary-foreground`                                             |
| Secondary action             | `bg-secondary` + `text-secondary-foreground`                                         |
| Main text                    | `text-foreground`                                                                    |
| Muted text                   | `text-muted-foreground`                                                              |
| Borders                      | `border-border`                                                                      |
| Input borders / subtle fills | `border-input` / `bg-input`                                                          |
| Focus rings                  | `ring-ring`                                                                          |
| Success icon / border        | `text-success` / `border-success` (use `/10`, `/15`, `/20` tints for bg)             |
| Destructive                  | `text-destructive` (use `bg-destructive/10` + `hover:bg-destructive/20` for buttons) |

```svelte
<!-- ❌ BAD -->
<div class="bg-blue-500 text-white">

<!-- ✅ GOOD -->
<div class="bg-primary text-primary-foreground">
```

## Forbidden primitives

| ❌ Never use                          | ✅ Use instead                         |
| ------------------------------------- | -------------------------------------- |
| `<button>`                            | `<Button.Root>`                        |
| `<input>` (text, checkbox, radio etc) | `<Input.Root>` / `<RadioGroup.Item>`   |
| `<div class="rounded border p-4">`    | `<Card.Root>` + `<Card.Content>`       |
| `<span class="rounded-full bg-...">`  | `<Badge>`                              |
| Hand-rolled dialog backdrop           | `<Dialog.Root>` / `<AlertDialog.Root>` |
| Hand-rolled dropdown                  | `<DropdownMenu.Root>`                  |

Exception: Turnstile's widget mount div, native form elements Svelte requires (e.g. the hidden `<input type="hidden">` carrying a Turnstile token or JSON payload) — these are wiring, not UI.

## Icons

Use `@lucide/svelte` exclusively, one icon per import path:

```svelte
<script lang="ts">
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import PlusIcon from '@lucide/svelte/icons/plus';
</script>

<PlusIcon class="size-4" />
<Loader2Icon class="size-4 animate-spin" />
```

Per-icon imports keep the Worker bundle small.

## Destructive actions → `AlertDialog`

Any delete / archive / irreversible action **must** be guarded by an `AlertDialog`:

```svelte
<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as Button from '$lib/components/ui/button';

	let open = $state(false);
</script>

<Button.Root variant="destructive" onclick={() => (open = true)}>Delete quiz</Button.Root>

<AlertDialog.Root bind:open>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete this quiz?</AlertDialog.Title>
			<AlertDialog.Description>
				This cannot be undone. All sessions and participants tied to this quiz will also be removed.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={handleDelete}>Delete</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
```

## Dropdown menus

Use `DropdownMenu` for any triggered-action menu (row overflow, user menu, settings). Stop propagation on the trigger if clicking the parent would also navigate:

```svelte
<DropdownMenu.Root>
	<DropdownMenu.Trigger onclick={(e) => e.stopPropagation()}>
		<Button.Root variant="ghost" size="icon-sm">
			<MoreHorizontalIcon class="size-4" />
		</Button.Root>
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end">
		<DropdownMenu.Item onclick={onEdit}>Edit</DropdownMenu.Item>
		<DropdownMenu.Item onclick={onDelete} class="text-destructive">Delete</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
```

## Table row actions (for later)

Quizmo's dashboard uses card lists, not data tables. When a future feature introduces a real `<Table>` with per-row actions, wrap each `<Table.Row>` in `ContextMenu.Root` + `ContextMenu.Trigger` and mirror the same items in a `DropdownMenu` triggered by a 3-dot button in the last cell. Both menus must contain identical items in identical order.

## Class merging

Use `cn()` from `$lib/utils.js` for any conditional class:

```svelte
<script lang="ts">
	import { cn } from '$lib/utils.js';
</script>

<div class={cn('base', condition && 'extra', className)}></div>
```

## Loading buttons — submit pattern

Every async action that uses a button must preserve the original label and show a spinner alongside it (not replace the text). Use `aria-disabled`, not `disabled`, so the button stays in the focus order for screen readers — and gate clicks manually:

```svelte
<Button.Root
	type="submit"
	aria-disabled={submitting || !canSubmit}
	onclick={(e) => {
		if (submitting || !canSubmit) e.preventDefault();
	}}
>
	{#if submitting}
		<Loader2Icon class="mr-2 size-4 animate-spin" aria-hidden="true" />
	{/if}
	Create quiz
</Button.Root>
```

**Never** replace the label with "Loading…" — the user must always see which action they kicked off. More detail in `forms.md`.

## Adding a new shadcn-svelte primitive

Do **not** hand-author primitives. Use the CLI:

```bash
bunx shadcn-svelte@latest add <name>
```

This emits files into `src/lib/components/ui/<name>/` with the right Tailwind tokens + bits-ui wiring. If you need a variant that doesn't exist (e.g., we added `success` to Badge), edit the primitive's `tv(...)` config directly — don't fork.

## Best practices

1. **Check `src/lib/components/ui/` first** — don't duplicate primitives.
2. **Use semantic tokens** — never hardcode `bg-blue-500`, `text-gray-700`, etc.
3. **Type everything** — TS strict mode is on with `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`.
4. **Loading + empty + error states** — design all three for every list / query.
5. **Clean imports after every edit** — remove unused imports before moving on.
6. **Kebab-case** for every `.svelte` file.
7. **No hardcoded colors, no `as any`, no raw HTML primitives.**
