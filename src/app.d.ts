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
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
	}
}

export {};
