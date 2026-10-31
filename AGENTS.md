# Quizmo

Live Kahoot-lite: hosts create a quiz and share a 6-char code; players join on their phones and race through questions against a global timer and leaderboard. A single SvelteKit 2 + Svelte 5 (runes only) app on Cloudflare Workers: D1 via Drizzle, two KV namespaces, the `QuizSession` Durable Object with WebSocket hibernation, Cron Triggers, Turnstile, and `better-auth` email-OTP delivered through the Cloudflare Email Sending binding (`EMAIL`).

## Tooling

- `bun` is the package manager and runtime; never npm/pnpm/yarn.
- Gates before any commit: `bun run lint`, `bun run check`, `bun run test`, `bun run build`.
- `bun run build` runs `scripts/inject-do-exports.mjs` after the SvelteKit build to append the `QuizSession` and `scheduled` exports to the worker; the adapter cannot emit them.
- Run `wrangler types` after every `wrangler.jsonc` edit. Never hand-write `Env`.
- D1 migrations: generate with `bunx drizzle-kit generate`, apply with `wrangler d1 migrations apply quizmo-db --remote`; never `drizzle-kit migrate`.
- Single D1 database, no dev/prod split. Deploys are manual (`wrangler deploy`); there is no CI.

## Rules

- No Node.js primitives on Worker code paths (`fs`, `path`, `node:crypto`, `process.env`). Use `platform.env` or the DO/cron `env`; `crypto.subtle` / `crypto.getRandomValues` for hashing and randomness.
- Server errors via `throwAppError(code, msg)`, never raw `new Error(...)`; the client uses `neverthrow` `Result`. No try/catch for flow control.
- Durable Object in-memory state is cache only: `await ctx.storage.put(...)` before broadcasting or returning.
- Accept WebSockets with `ctx.acceptWebSocket()`, never `server.accept()`.
- Bind form fields through `$formData.x.y`, never through a local alias.
- `@internationalized/date` is the only date library (months are 1-based).
- `as any` is forbidden; TS strict with `noUnusedLocals` and `noUncheckedIndexedAccess`.
- English only, no i18n. No "Built with…" tech badges in user-facing copy.

## Detailed rules

Read the matching doc before working in its area:

- [docs/agents/cf-workers-backend.md](docs/agents/cf-workers-backend.md) — server code: bindings, D1/KV/DO patterns, `AppError` taxonomy, migrations, WebSocket protocol.
- [docs/agents/error-handling.md](docs/agents/error-handling.md) — any code that throws or handles errors.
- [docs/agents/sveltekit-frontend.md](docs/agents/sveltekit-frontend.md) — routes and Svelte components.
- [docs/agents/ui-components.md](docs/agents/ui-components.md) and [docs/agents/ui-checklist.md](docs/agents/ui-checklist.md) — before writing any UI markup.
- [docs/agents/forms.md](docs/agents/forms.md) — forms, superforms, Valibot schemas.
- [docs/agents/dates.md](docs/agents/dates.md) — anything touching dates or times.
