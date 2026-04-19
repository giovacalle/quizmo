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

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

export const httpStatusFor = (code: ErrorCode): number =>
	({
		NOT_FOUND: 404,
		UNAUTHENTICATED: 401,
		FORBIDDEN: 403,
		INVALID_INPUT: 400,
		CONFLICT: 409,
		INTERNAL_ERROR: 500
	})[code];

/**
 * Route-level guard: runs a server handler, and if it throws `AppError` re-emits
 * it as SvelteKit's native `error(status, { message, code })`. That produces the
 * correct HTTP status AND the `App.Error`-shaped `page.error` on the client —
 * which `+error.svelte` reads via `page.error.message`.
 *
 * Why this isn't inside `hooks.server.ts#handle`: SvelteKit's endpoint runtime
 * catches errors thrown inside `+server.ts`/actions internally, so they never
 * bubble through `resolve(event)` as rejections. The conversion MUST happen at
 * the throw site or in a per-handler wrapper.
 *
 * Usage:
 *   import { guardAppError } from '$lib/server/errors';
 *
 *   export const GET: RequestHandler = async (event) =>
 *     guardAppError(async () => {
 *       const quiz = await loadQuiz(event.params.id);
 *       if (!quiz) throwAppError('NOT_FOUND', 'Quiz not found');
 *       return json(quiz);
 *     });
 */
export const guardAppError = async <T>(fn: () => Promise<T>): Promise<T> => {
	// Lazy-import so this module stays usable from DO/cron contexts that don't
	// link `@sveltejs/kit`. Top-level import would break those bundles.
	try {
		return await fn();
	} catch (e) {
		if (!isAppError(e)) throw e;
		const { error: kitError } = await import('@sveltejs/kit');
		// `kitError` is `(status, body) => never`; TS sometimes loses that through
		// the dynamic import, so we assert the type locally.
		return (kitError as (status: number, body: { message: string; code: ErrorCode }) => never)(
			httpStatusFor(e.code),
			{ message: e.message, code: e.code }
		);
	}
};
