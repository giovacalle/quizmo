import { describe, expect, it } from 'vitest';

import { AppError } from '$lib/server/errors';

import { extractAppError, fromPromise } from './result';

describe('extractAppError', () => {
	it('preserves AppError verbatim', () => {
		const original = new AppError('NOT_FOUND', 'not here');
		const extracted = extractAppError(original);
		expect(extracted).toBe(original);
	});

	it('wraps plain Error as INTERNAL_ERROR', () => {
		const err = extractAppError(new Error('boom'));
		expect(err.code).toBe('INTERNAL_ERROR');
		expect(err.message).toBe('boom');
	});

	it('wraps non-Error as INTERNAL_ERROR', () => {
		const err1 = extractAppError('string error');
		expect(err1.code).toBe('INTERNAL_ERROR');
		expect(err1.message).toBe('Unknown error');

		const err2 = extractAppError(null);
		expect(err2.code).toBe('INTERNAL_ERROR');
	});
});

describe('fromPromise', () => {
	it('resolves ok for successful promises', async () => {
		const r = await fromPromise(Promise.resolve(42));
		expect(r.isOk()).toBe(true);
		expect(r._unsafeUnwrap()).toBe(42);
	});

	it('converts thrown AppError to Err', async () => {
		const r = await fromPromise(Promise.reject(new AppError('FORBIDDEN', 'nope')));
		expect(r.isErr()).toBe(true);
		if (r.isErr()) {
			expect(r.error.code).toBe('FORBIDDEN');
			expect(r.error.message).toBe('nope');
		}
	});

	it('wraps plain Error as INTERNAL_ERROR', async () => {
		const r = await fromPromise(Promise.reject(new Error('boom')));
		expect(r.isErr()).toBe(true);
		if (r.isErr()) {
			expect(r.error.code).toBe('INTERNAL_ERROR');
			expect(r.error.message).toBe('boom');
		}
	});
});
