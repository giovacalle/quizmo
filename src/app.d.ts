// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}

		interface Error {
			message: string;
			code?: import('$lib/server/errors').ErrorCode;
		}

		interface Locals {
			auth: import('$lib/server/auth').AuthInstance;
			user: SessionUser | null;
		}

		type SessionUser = {
			id: string;
			email: string;
			name: string | null;
		};

		interface PageData {
			user?: SessionUser | null;
		}
		// interface PageState {}
	}
}

// `Env` secrets: wrangler types only picks up `vars`, so secret-backed bindings
// are augmented here so `platform.env.X` is typed at route/handler boundaries.
declare global {
	interface Env {
		BETTER_AUTH_SECRET?: string;
		TURNSTILE_SECRET_KEY?: string;
	}
}

export {};
