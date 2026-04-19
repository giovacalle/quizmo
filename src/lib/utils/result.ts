import { ResultAsync } from 'neverthrow';

import { AppError, isAppError } from '$lib/server/errors';

/**
 * Normalize any thrown / rejected value into an `AppError`. Pass this as the
 * second argument to `ResultAsync.fromPromise` (or any neverthrow `.mapErr`).
 *
 *   const r = await fromPromise(someApiCall(), extractAppError);
 *   if (r.isErr()) {
 *     switch (r.error.code) { case 'NOT_FOUND': ... }
 *   }
 *
 * Preserves `AppError`s thrown from server code verbatim; wraps everything else
 * into `INTERNAL_ERROR` so callers always get a discriminated union with `code`.
 */
export const extractAppError = (e: unknown): AppError => {
	if (isAppError(e)) return e;
	if (e instanceof Error) return new AppError('INTERNAL_ERROR', e.message);
	return new AppError('INTERNAL_ERROR', 'Unknown error');
};

/**
 * Thin wrapper around `ResultAsync.fromPromise` that defaults the error mapper
 * to `extractAppError`. Use in `load`, actions, and client calls:
 *
 *   const r = await fromPromise(db.query.users.findFirst({ ... }));
 *   if (r.isErr()) throwAppError(r.error.code, r.error.message);
 */
export const fromPromise = <T>(promise: Promise<T>): ResultAsync<T, AppError> =>
	ResultAsync.fromPromise(promise, extractAppError);

export { ResultAsync };
export { err, ok, Result } from 'neverthrow';
