import * as v from 'valibot';
import { describe, expect, it } from 'vitest';

import {
	emailSchema,
	joinCodeSchema,
	nicknameSchema,
	otpCodeSchema,
	questionWithAnswersSchema,
	quizWithQuestionsSchema
} from './validators';

/**
 * Pure-logic coverage for the valibot refinements. These are load-bearing
 * for every user-input path (login, join, quiz editor) so drift in any of
 * these asserts is a real bug.
 */

function validQuestion(opts: { answers?: number; correct?: number } = {}) {
	const answers = opts.answers ?? 4;
	const correct = opts.correct ?? 1;
	return {
		text: 'Sample question?',
		timeLimitSec: 20,
		points: 1000,
		answers: Array.from({ length: answers }, (_, i) => ({
			text: `Answer ${i + 1}`,
			isCorrect: i < correct
		}))
	};
}

function validQuestionSet(count: number) {
	return Array.from({ length: count }, () => validQuestion());
}

describe('emailSchema', () => {
	it('trims + lowercases valid emails', () => {
		expect(v.parse(emailSchema, '  Alice@X.COM  ')).toBe('alice@x.com');
		expect(v.parse(emailSchema, 'BOB@x.io')).toBe('bob@x.io');
	});

	it('rejects malformed inputs', () => {
		expect(() => v.parse(emailSchema, 'not-an-email')).toThrow();
		expect(() => v.parse(emailSchema, '')).toThrow();
		expect(() => v.parse(emailSchema, '@example.com')).toThrow();
	});
});

describe('nicknameSchema', () => {
	it('trims whitespace', () => {
		expect(v.parse(nicknameSchema, '  hi  ')).toBe('hi');
	});

	it('rejects empty / whitespace-only', () => {
		expect(() => v.parse(nicknameSchema, '')).toThrow();
		expect(() => v.parse(nicknameSchema, '   ')).toThrow();
	});

	it('accepts 20 chars', () => {
		expect(v.parse(nicknameSchema, 'a'.repeat(20))).toBe('a'.repeat(20));
	});

	it('rejects 21 chars', () => {
		expect(() => v.parse(nicknameSchema, 'a'.repeat(21))).toThrow();
	});
});

describe('joinCodeSchema', () => {
	it('accepts 6 uppercase alnum', () => {
		expect(v.parse(joinCodeSchema, 'ABC123')).toBe('ABC123');
		expect(v.parse(joinCodeSchema, 'ZZZZZZ')).toBe('ZZZZZZ');
		expect(v.parse(joinCodeSchema, '999999')).toBe('999999');
	});

	it('rejects lowercase', () => {
		expect(() => v.parse(joinCodeSchema, 'abc123')).toThrow();
	});

	it('rejects non-6 length', () => {
		expect(() => v.parse(joinCodeSchema, 'ABCD1')).toThrow();
		expect(() => v.parse(joinCodeSchema, 'ABCDEFG')).toThrow();
	});

	it('rejects special chars', () => {
		expect(() => v.parse(joinCodeSchema, 'ABC-12')).toThrow();
	});
});

describe('otpCodeSchema', () => {
	it('accepts 6 digits', () => {
		expect(v.parse(otpCodeSchema, '123456')).toBe('123456');
	});

	it('rejects non-digits', () => {
		expect(() => v.parse(otpCodeSchema, '12345a')).toThrow();
		expect(() => v.parse(otpCodeSchema, 'abcdef')).toThrow();
	});

	it('rejects wrong length', () => {
		expect(() => v.parse(otpCodeSchema, '12345')).toThrow();
		expect(() => v.parse(otpCodeSchema, '1234567')).toThrow();
	});

	it('trims', () => {
		expect(v.parse(otpCodeSchema, ' 123456 ')).toBe('123456');
	});
});

describe('questionWithAnswersSchema (answer count)', () => {
	it('rejects 1 answer', () => {
		expect(() => v.parse(questionWithAnswersSchema, validQuestion({ answers: 1 }))).toThrow();
	});

	it('accepts 2 answers', () => {
		expect(() => v.parse(questionWithAnswersSchema, validQuestion({ answers: 2 }))).not.toThrow();
	});

	it('accepts 6 answers', () => {
		expect(() => v.parse(questionWithAnswersSchema, validQuestion({ answers: 6 }))).not.toThrow();
	});

	it('rejects 7 answers', () => {
		expect(() => v.parse(questionWithAnswersSchema, validQuestion({ answers: 7 }))).toThrow();
	});
});

describe('questionWithAnswersSchema (exactly-one-correct)', () => {
	it('rejects 0 correct', () => {
		expect(() => v.parse(questionWithAnswersSchema, validQuestion({ correct: 0 }))).toThrow();
	});

	it('accepts 1 correct', () => {
		expect(() => v.parse(questionWithAnswersSchema, validQuestion({ correct: 1 }))).not.toThrow();
	});

	it('rejects 2 correct', () => {
		expect(() => v.parse(questionWithAnswersSchema, validQuestion({ correct: 2 }))).toThrow();
	});
});

describe('quizWithQuestionsSchema (count)', () => {
	const base = { title: 'Test', description: '' };

	it('rejects 2 questions', () => {
		expect(() =>
			v.parse(quizWithQuestionsSchema, { ...base, questions: validQuestionSet(2) })
		).toThrow();
	});

	it('accepts 3 questions', () => {
		expect(() =>
			v.parse(quizWithQuestionsSchema, { ...base, questions: validQuestionSet(3) })
		).not.toThrow();
	});

	it('accepts 25 questions', () => {
		expect(() =>
			v.parse(quizWithQuestionsSchema, { ...base, questions: validQuestionSet(25) })
		).not.toThrow();
	});

	it('rejects 26 questions', () => {
		expect(() =>
			v.parse(quizWithQuestionsSchema, { ...base, questions: validQuestionSet(26) })
		).toThrow();
	});
});
