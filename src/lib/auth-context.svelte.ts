import { page } from '$app/state';

/**
 * Client-side auth state. Reads `page.data.user` (populated by
 * `+layout.server.ts`) so every route has the same source of truth without
 * re-fetching.
 *
 * Lifecycle contract
 * ------------------
 * 1. Instantiate once near the client root (typically inside a top-level
 *    `<script>` in `+layout.svelte` or a provider component) using
 *    `new AuthContext()`.
 * 2. Any `$effect` that subscribes to external state is wrapped in
 *    `$effect.root` so its teardown is explicit — the returned cleanup is
 *    captured by the private `#dispose` function, and the public `destroy()`
 *    method runs it.
 * 3. HMR: during a hot reload Svelte re-creates modules but not `$effect`
 *    subscriptions registered outside a component tree. Call `destroy()` on the
 *    old instance before creating a new one if you embed this in a module
 *    singleton — otherwise the root effect leaks.
 * 4. Under SSR `page.data.user` is already populated from the server load, so
 *    `user` is correct on the first render — no hydration flash.
 *
 * `$state`/`$derived` are used instead of runed's `reactive` because the data
 * is already a reactive Svelte value (`page.data`) — wrapping it in a store
 * would double-subscribe without benefit.
 */
export class AuthContext {
	#dispose: (() => void) | null = null;

	constructor() {
		// Placeholder root effect: no external subscriptions yet, but keeping the
		// scaffolding means future `$effect`s (cross-tab logout sync, stale
		// cookie nudges, etc.) can be added without reshuffling the lifecycle
		// contract documented above.
		this.#dispose = $effect.root(() => {
			return () => {
				// Intentional no-op. Future effects register teardown here.
			};
		});
	}

	get user(): App.SessionUser | null {
		return page.data.user ?? null;
	}

	get isAuthed(): boolean {
		return this.user !== null;
	}

	destroy(): void {
		this.#dispose?.();
		this.#dispose = null;
	}
}
