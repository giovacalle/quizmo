# Quizmo

Live Kahoot-lite: hosts create a quiz, share a 6-char code, players join live on their phones and race through questions against a global timer and leaderboard. Built end-to-end on the Cloudflare Workers suite (D1 + KV + Durable Objects + Cron Triggers + Turnstile).

## Stack

- **Runtime**: Cloudflare Workers, SvelteKit 2 + Svelte 5 (runes only), `@sveltejs/adapter-cloudflare`
- **DB / state**: D1 (`quizmo-db`) via Drizzle ORM; two KV namespaces (`quizmo-kv-auth`, `quizmo-kv-quiz`); one Durable Object class (`QuizSession`) for live session coordination with WebSocket hibernation
- **Auth**: `better-auth` email-OTP plugin (6-digit code, ~10 min TTL) delivered via Resend. Hosts only; participants gated by Cloudflare Turnstile + nickname
- **Validation**: Valibot + `drizzle-valibot` (schema is the single source of truth) — forms go through SvelteKit actions + `use:enhance`
- **UI**: `shadcn-svelte` namespace primitives (`Button.Root`, `Input.Root`), Tailwind v4 via `@tailwindcss/vite`, `@lucide/svelte`, `mode-watcher`, `svelte-sonner`
- **Errors**: `neverthrow` `Result<T, E>` on the client; `AppError` + `throwAppError(code, msg)` on the server. No try/catch for flow control
- **Tooling**: `bun` package manager + runtime, Prettier (+ sort-imports, + tailwindcss plugins), ESLint, TypeScript strict with `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`
- **Tests**: Vitest + `@cloudflare/vitest-pool-workers` for DO / D1 tests; optional Playwright happy-path e2e

## Bindings

| Binding          | Type           | Resource            | Purpose                                                                                   |
| ---------------- | -------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| `QUIZMO_DB`      | D1             | `quizmo-db`         | Users, quizzes, questions, answers, quiz_sessions, participants                           |
| `QUIZMO_AUTH_KV` | KV             | `quizmo-kv-auth`    | Auth sessions, OTP codes, rate-limit counters (`session:`, `otp:`, `rl:email:`, `rl:ip:`) |
| `QUIZMO_QUIZ_KV` | KV             | `quizmo-kv-quiz`    | Join-code cache (`code:{CODE}` → sessionId); D1 is authority                              |
| `QUIZMO_SESSION` | Durable Object | class `QuizSession` | Per-session state machine + WebSocket fan-out                                             |

Secrets (set via `wrangler secret put`): `RESEND_API_KEY`, `BETTER_AUTH_SECRET`, `TURNSTILE_SECRET_KEY`.

## Commands

```bash
bun install                          # install deps (one-time / after clone)
bun run dev                          # local Vite dev on http://localhost:5173
bun run check                        # wrangler types + svelte-check (zero errors gate)
bun run build                        # SvelteKit build for Cloudflare target
bun run preview                      # run the built worker locally
bun run lint                         # prettier --check + eslint
bun run format                       # prettier --write
bun run test                         # vitest (unit + integration) + playwright

wrangler types                       # regenerate worker-configuration.d.ts after wrangler.jsonc edits
wrangler d1 execute quizmo-db --remote --command "<SQL>"   # one-off SQL
wrangler secret put <NAME>           # set a secret (interactive)
wrangler secret list                 # list configured secrets
wrangler deploy                      # deploy to CF (production)
wrangler deploy --dry-run            # validate config without deploying
wrangler tail                        # live logs from production

bunx drizzle-kit generate            # create new migration from schema.ts
bunx drizzle-kit migrate             # (avoid — use wrangler d1 migrations apply --remote for D1)
```

## Project conventions

Detailed rules auto-load from `.claude/rules/`:

- `error-handling.md` — neverthrow on client, `throwAppError` on server; never try/catch for flow control
- `sveltekit-frontend.md` — Svelte 5 runes, runed utilities, SPA routes, naming, import hygiene
- `ui-components.md` + `ui-checklist.md` — shadcn-svelte namespace primitives; NO raw `<button>`/`<input>`; semantic color tokens only
- `forms.md` — SvelteKit form actions + `use:enhance` + Valibot, submit-button pattern (original text + spinner, never "Loading…")
- `dates.md` — `@internationalized/date` sole library; no date-fns / dayjs / moment
- `cf-workers-backend.md` — bindings map, D1/KV/DO patterns, `AppError` taxonomy, migration safety, DO storage write-through, WebSocket protocol

## What this project is NOT

- No i18n (EN only)
- No shared dev/prod split — single D1 `quizmo-db`, demo context
- No "Built with…" tech badges in user-facing copy (see `feedback_landing_copy_product_first` memory)
