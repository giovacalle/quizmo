import { describe, expect, it } from 'vitest';

import { AppError, httpStatusFor, isAppError, throwAppError } from './errors';

describe('AppError', () => {
	it('carries code + message', () => {
		const e = new AppError('NOT_FOUND', 'not here');
		expect(e.code).toBe('NOT_FOUND');
		expect(e.message).toBe('not here');
		expect(e.name).toBe('AppError');
	});

	it('is an Error instance', () => {
		expect(new AppError('INTERNAL_ERROR', 'x')).toBeInstanceOf(Error);
	});
});

describe('throwAppError', () => {
	it('throws an AppError', () => {
		expect(() => throwAppError('FORBIDDEN', 'nope')).toThrow(AppError);
	});

	it('preserves code on the thrown error', () => {
		try {
			throwAppError('CONFLICT', 'dup');
		} catch (e) {
			expect(isAppError(e) && e.code).toBe('CONFLICT');
			expect(isAppError(e) && e.message).toBe('dup');
			return;
		}
		throw new Error('should have thrown');
	});
});

describe('isAppError', () => {
	it('returns true for AppError', () => {
		expect(isAppError(new AppError('NOT_FOUND', 'x'))).toBe(true);
	});

	it('returns false for plain Error', () => {
		expect(isAppError(new Error('x'))).toBe(false);
	});

	it('returns false for null / string / undefined', () => {
		expect(isAppError(null)).toBe(false);
		expect(isAppError(undefined)).toBe(false);
		expect(isAppError('oops')).toBe(false);
		expect(isAppError({ code: 'NOT_FOUND', message: 'x' })).toBe(false);
	});
});

describe('httpStatusFor', () => {
	it('maps every ErrorCode', () => {
		expect(httpStatusFor('NOT_FOUND')).toBe(404);
		expect(httpStatusFor('UNAUTHENTICATED')).toBe(401);
		expect(httpStatusFor('FORBIDDEN')).toBe(403);
		expect(httpStatusFor('INVALID_INPUT')).toBe(400);
		expect(httpStatusFor('CONFLICT')).toBe(409);
		expect(httpStatusFor('INTERNAL_ERROR')).toBe(500);
	});
});
