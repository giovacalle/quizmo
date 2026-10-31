# Quizmo

> Host live quizzes in seconds. Create a quiz, share the code, play live together.

Kahoot-lite built end-to-end on the Cloudflare Workers suite: D1, KV, Durable Objects (with WebSocket hibernation), Cron Triggers, Turnstile. Edge-native, free-tier-safe, mobile-first for participants.

**Demo**: <https://quizmo.giova.dev>

---

## What it does

- **Hosts** create quizzes (3–25 questions, 2–6 answers each), start a live session, and watch the leaderboard reorder in real time.
- **Participants** join with a 6-character code + nickname, answer on their phones, see their rank after every question.
- **After the session**, the host can consult the full history of past sessions for any quiz, complete with podium + final leaderboard.

Email-only auth (OTP, no passwords). Sessions persist to D1 so results survive closing tabs, Worker restarts, and DO eviction.

## Features

- 6-character alphanumeric join codes
- Live leaderboard with FLIP reordering
- Timer source of truth on the server (clients render locally against `questionStartedAtMs`)
- Time-decay scoring: `basePoints × max(0.5, timeLeft / total)` + first-correct bonus
- Participant reconnect via per-session HMAC token (resume on reload within the same tab)
- Nickname dedup (case-insensitive) + same-browser join guard via signed cookie
- Nightly cron archives quizzes inactive for 30+ days
- Dark mode out of the box, WCAG-AA verified both themes
- No-JS progressive enhancement on auth and join forms
- Anti-abuse: Turnstile on `/login` + `/join`, per-email + per-IP rate limits on OTP send, single-use OTP codes

## Tech stack

| Layer      | Choice                                                                                            | Why                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Runtime    | Cloudflare Workers (`@sveltejs/adapter-cloudflare`) — Workers, not Pages                          | Edge-native, DO support. Workers Paid (required by Email Sending) covers the target scale. |
| Framework  | SvelteKit 2 + Svelte 5 (runes only)                                                               | SSR + SPA hybrid, progressive enhancement, small runtime.                                  |
| State      | Durable Object `QuizSession` with SQLite storage, WebSocket hibernation, alarms                   | Textbook DO fan-out (1 host → N participants). Hibernation keeps idle cost at zero.        |
| Database   | D1 via Drizzle ORM, `drizzle-valibot` for auto-derived schemas + hand-written refinements         | Single source of truth: `schema.ts` → TS types + runtime validators + migrations.          |
| Cache      | Two KV namespaces (`auth` + `quiz`) with mandatory key prefixes, 1-hour TTL on lookups            | Isolates blast radius of auth-side eviction pressure from quiz runtime.                    |
| Auth       | `better-auth` email-OTP plugin + Cloudflare Email Sending for delivery                            | No passwords, no OAuth dependencies, 6-digit code, single-use + invalidate-on-resend.      |
| Validation | Valibot schemas shared server/client                                                              | Smaller bundle than Zod, same ergonomics.                                                  |
| UI         | `shadcn-svelte` namespace primitives, Tailwind v4 via `@tailwindcss/vite`, `@lucide/svelte` icons | Own the code, not the library. Semantic CSS-var tokens — zero hardcoded colors in the app. |
| Forms      | SvelteKit form actions + `use:enhance`                                                            | Progressive enhancement free, server is source of truth.                                   |
| Errors     | `AppError` + `throwAppError` on the server, `neverthrow` `Result<T, AppError>` on the client      | No `try/catch` for flow control. Errors carry typed codes end-to-end.                      |
| Anti-bot   | Cloudflare Turnstile (Managed mode)                                                               | No CAPTCHA wall, invisible most of the time, escalates only when needed.                   |
| Testing    | Vitest + `@cloudflare/vitest-pool-workers` for DO/D1/KV integration tests (58 tests)              | Real Worker runtime, not mocks. DO state machine + storage write-through covered.          |
| Tooling    | `bun` (runtime + package manager), Prettier + `prettier-plugin-sort-imports` + Tailwind plugin    | Fast installs, clean commits.                                                              |

## Architecture highlights

A few details worth flagging for anyone reading the code:

- **Storage write-through in the DO**: in-memory `Map`s are cache-only. Every mutation writes through `ctx.storage` before broadcasting. Alarms that wake a cold instance rehydrate from storage — an alarm firing on an empty in-memory state is treated as normal, not a bug.
- **D1 as join-code authority, KV as read-through cache**: KV is eventually consistent, so the 6-char code uniqueness constraint lives on `quiz_sessions.code UNIQUE` in D1. KV holds `code → sessionId` with 1-hour TTL; miss falls through to D1.
- **TOCTOU-free quota enforcement**: quiz creation uses a conditional `INSERT ... WHERE (SELECT COUNT(*) ...) < N` so two concurrent creates at the cap boundary can't both slip through.
- **WebSocket upgrade forwarding**: the `/api/session/[sessionId]/ws` Worker route takes the raw upgrade `Request` and returns `stub.fetch(request)`. The DO itself calls `ctx.acceptWebSocket(server)` — accepting in the Worker would break hibernation and charge a Worker invocation per message.
- **HMAC reconnect**: the DO generates a per-session HMAC secret on first construction, persisted to storage. On `join`, it signs `participantId` and returns the token; the client stores `{participantId, participantToken}` in `sessionStorage`. Reconnect verifies in constant time via `crypto.subtle.verify`.
- **Cron via `scheduled()`, not HTTP**: the nightly cleanup + session reconciliation is a real Worker `scheduled` export, not a publicly reachable `/api/cron/*` endpoint. No spoofable `cf-worker` header guard.
- **DO + `scheduled` into a single bundle**: `@sveltejs/adapter-cloudflare` emits only `export default { fetch }` on the worker entry — there's no adapter hook to inject additional named exports, and Cloudflare Workers requires both `QuizSession` (the DO class) and `scheduled` (the cron handler) as named exports alongside the default. `scripts/inject-do-exports.mjs` bridges the gap: a post-build step that esbuild-compiles both modules through a single synthetic virtual entry (not two separate passes — that deduplicates shared Drizzle / Valibot symbols so wrangler doesn't reject the deploy with `The symbol 'drizzle' has already been declared`), renames the top-level identifiers to avoid colliding with the re-export names, and appends the bundle + a trailing `export { QuizSession, scheduled }` to `.svelte-kit/cloudflare/_worker.js`. See the header comment in `scripts/inject-do-exports.mjs` for the full rationale.

More detail in the design + implementation rules under [`docs/agents/`](./docs/agents/).

## Project layout

```
src/
├── app.css                      # Tailwind + Quiz Soft tokens
├── app.d.ts
├── app.html
├── hooks.server.ts              # auth init per request, handleError fallback
├── routes/
│   ├── +page.svelte             # landing (product-first copy)
│   ├── +error.svelte
│   ├── +layout.{svelte,server.ts}
│   ├── login/                   # email OTP
│   ├── join/                    # participant entry (code + nickname + Turnstile)
│   ├── play/[sessionId]/        # participant live view
│   ├── host/[sessionId]/        # host live console
│   ├── dashboard/               # quiz CRUD + session history
│   │   ├── new/
│   │   ├── [id]/
│   │   │   └── sessions/
│   │   │       └── [sessionId]/
│   │   └── _components/quiz-form.svelte
│   └── api/
│       └── session/[sessionId]/ws/  # WS → DO forwarder
└── lib/
    ├── components/
    │   ├── ui/                  # shadcn-svelte primitives
    │   ├── leaderboard.svelte
    │   └── mode-toggle.svelte
    ├── server/
    │   ├── auth/                # better-auth config, OTP email, rate limits, Turnstile
    │   ├── cron/                # scheduled() handler + cleanup/reconcile
    │   ├── db/                  # Drizzle schema, client, validators
    │   ├── do/                  # QuizSession DO + WS protocol + scoring
    │   └── errors.ts            # AppError + httpStatusFor + guardAppError
    └── utils/
        └── result.ts            # neverthrow wrappers
```

## Local development

Requires Bun ≥ 1.0, Node ≥ 20, and a Cloudflare account (for remote D1/KV/DO — Quizmo uses `wrangler dev --remote` against production bindings because D1 local dev has limitations).

```bash
bun install
bun run dev           # Vite dev on http://localhost:5173
bun run check         # wrangler types + svelte-check (zero errors gate)
bun run test          # vitest unit + @cloudflare/vitest-pool-workers integration
bun run build         # SvelteKit + adapter-cloudflare + DO/cron bundle injection
bun run lint          # prettier --check + eslint
wrangler deploy --dry-run
wrangler deploy
```

Secrets needed for a full end-to-end run:

- `BETTER_AUTH_SECRET` — session signing (generate once via `openssl rand -base64 32`)
- `TURNSTILE_SECRET_KEY` — server-side Turnstile verification

Plus the public vars in `wrangler.jsonc`: `TURNSTILE_SITE_KEY`, `APP_URL`, `EMAIL_FROM`, and the `EMAIL` send binding (Cloudflare Email Sending, needs Workers Paid and `emails.giova.dev` onboarded as a sending domain).

## Conventions

Agent instructions live in [`AGENTS.md`](./AGENTS.md), which points to the detailed rules in [`docs/agents/`](./docs/agents/):

- [`error-handling.md`](./docs/agents/error-handling.md) — server throws `AppError`, client uses neverthrow, no `try/catch` for flow control
- [`sveltekit-frontend.md`](./docs/agents/sveltekit-frontend.md) — Svelte 5 runes, CF compat, Drizzle inferred types
- [`ui-components.md`](./docs/agents/ui-components.md) + [`ui-checklist.md`](./docs/agents/ui-checklist.md) — shadcn-svelte primitives only, semantic tokens, namespace imports
- [`forms.md`](./docs/agents/forms.md) — SvelteKit actions + `use:enhance` + Valibot
- [`dates.md`](./docs/agents/dates.md) — `@internationalized/date` is the only date library
- [`cf-workers-backend.md`](./docs/agents/cf-workers-backend.md) — bindings map, D1/KV/DO patterns, storage write-through, WS protocol
