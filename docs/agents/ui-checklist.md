# UI Component Pre-Creation Checklist

Run this **before** writing any UI markup. Stop at the first matching row.

## Decision flow

### 1. Is it a primitive? (button, input, label, card, dialog, badge, etc.)

| Need                       | Use                                            |
| -------------------------- | ---------------------------------------------- |
| `<button>`                 | `Button.Root` from `$lib/components/ui/button` |
| `<input>`                  | `Input.Root` from `$lib/components/ui/input`   |
| Label                      | `Label.Root` from `$lib/components/ui/label`   |
| Radio group                | `RadioGroup.Root` + `RadioGroup.Item`          |
| Card container             | `Card.Root` from `$lib/components/ui/card`     |
| Pill / status tag          | `Badge` from `$lib/components/ui/badge`        |
| Confirm dialog             | `AlertDialog.Root`                             |
| Generic modal              | `Dialog.Root`                                  |
| Dropdown menu              | `DropdownMenu.Root`                            |
| Progress bar               | `Progress.Root`                                |
| Loading placeholder        | `Skeleton`                                     |
| Form field + label + error | `Form.Field` (formsnap wrapper)                |
| Divider                    | `Separator.Root`                               |

**Never** hand-roll `<button>`, `<input>`, `<div class="rounded border">`, or `<span class="rounded-full bg-...">` when a primitive exists.

### 2. Is the primitive already installed?

Quizmo currently ships these primitives at `src/lib/components/ui/`:

```
alert-dialog/    button/    dialog/    form/     label/    radio-group/   skeleton/
badge/           card/      dropdown-menu/  input/   progress/   separator/
```

Check the directory before assuming it's missing:

```bash
ls src/lib/components/ui/
```

If yes → import and use.

### 3. Not installed? Add via shadcn-svelte CLI

```bash
bunx shadcn-svelte@latest add <component>
```

Common additions you might need next:

| Category         | Components                                                                |
| ---------------- | ------------------------------------------------------------------------- |
| **Layout**       | Accordion, AspectRatio, Collapsible, Resizable, ScrollArea, Tabs          |
| **Navigation**   | Breadcrumb, ContextMenu, Menubar, Pagination                              |
| **Forms**        | Checkbox, InputOTP, Select, Slider, Switch, Textarea, Toggle, ToggleGroup |
| **Feedback**     | Alert, Drawer, HoverCard, Popover, Sheet, Tooltip                         |
| **Data display** | Avatar, Calendar, Carousel, Table                                         |
| **Overlay**      | Command, DatePicker                                                       |

After adding, verify the emitted files use semantic tokens (the CLI does this by default).

Toasts come from `svelte-sonner` — already installed. Use `toast.success(...)` / `toast.error(...)` directly.

### 4. Is it a reusable composite used in multiple routes?

Put it at `src/lib/components/<name>.svelte` (flat — no `features/` subfolder, single-app project). Requirements:

- Use primitives from `src/lib/components/ui/*` inside. Never raw HTML primitives.
- Use semantic color tokens only (no `bg-blue-500`, no `text-gray-700`).
- kebab-case filename.
- Hardcoded English strings.

### 5. Is it specific to one route tree?

Put it at `src/routes/<path>/_components/<name>.svelte`. Example: `src/routes/dashboard/_components/quiz-form.svelte`.

### 6. Does the primitive just need a new variant?

Edit the primitive's `tv(...)` config directly — e.g., `src/lib/components/ui/badge/badge.svelte` where we added the `success` variant. Don't fork the component.

## Import patterns

- **Namespace barrel** (compound primitives): `import * as Button from '$lib/components/ui/button'` → `<Button.Root>`.
- **Named export** (single-component primitives like Badge): `import { Badge } from '$lib/components/ui/badge'`.
- Check the primitive's `index.ts` if unsure.

## Pre-commit verification

- [ ] No raw HTML primitives (`<button>`, `<input>`, `<textarea>`, bespoke card divs).
- [ ] No hardcoded colors (`bg-blue-500`, `text-slate-700`, etc.) — only semantic tokens.
- [ ] No unused imports (TypeScript strict mode catches this via `noUnusedLocals`).
- [ ] kebab-case file naming.
- [ ] Loading / empty / error states covered for any list or async UI.
- [ ] Destructive actions guarded by `AlertDialog`.
- [ ] Submit buttons preserve original label + spinner, use `aria-disabled`.

## Common mistakes to avoid

| ❌ Don't                                | ✅ Do                                                             |
| --------------------------------------- | ----------------------------------------------------------------- |
| Create `<button>` element               | `<Button.Root>`                                                   |
| Create `<input>` element                | `<Input.Root>`                                                    |
| Hand-author a shadcn primitive          | `bunx shadcn-svelte@latest add <name>`                            |
| Fork a primitive for one variant        | Add the variant to the primitive's `tv(...)` config               |
| Hardcode colors                         | Use `bg-primary`, `text-foreground`, etc.                         |
| Manual absolute-positioned icon + input | Use the appropriate primitive (or install `InputGroup` if needed) |
| `className` string concat               | `cn('base', cond && 'extra', className)` from `$lib/utils.js`     |
