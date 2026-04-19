import { describe, expect, it } from 'vitest';

import { computeScore } from './scoring';

/**
 * The 5 canonical cases from the manual sanity check. These pin down the
 * locked scoring formula: linear decay clamped to 0.5× floor, plus a +10 flat
 * bonus for the first-correct participant per question.
 */
describe('computeScore', () => {
	it('instant correct, first', () => {
		expect(
			computeScore({
				basePoints: 1000,
				timeLeftMs: 20_000,
				totalTimeMs: 20_000,
				isFirstCorrect: true
			})
		).toBe(1010);
	});

	it('50% timeLeft, first', () => {
		expect(
			computeScore({
				basePoints: 1000,
				timeLeftMs: 10_000,
				totalTimeMs: 20_000,
				isFirstCorrect: true
			})
		).toBe(510);
	});

	it('75% timeLeft, first', () => {
		expect(
			computeScore({
				basePoints: 1000,
				timeLeftMs: 15_000,
				totalTimeMs: 20_000,
				isFirstCorrect: true
			})
		).toBe(760);
	});

	it('expired correct, not first → floors at 0.5×', () => {
		expect(
			computeScore({
				basePoints: 1000,
				timeLeftMs: 0,
				totalTimeMs: 20_000,
				isFirstCorrect: false
			})
		).toBe(500);
	});

	it('base 800, 50% timeLeft, not first', () => {
		expect(
			computeScore({
				basePoints: 800,
				timeLeftMs: 10_000,
				totalTimeMs: 20_000,
				isFirstCorrect: false
			})
		).toBe(400);
	});

	it('negative timeLeft clamps to 0 then floors', () => {
		expect(
			computeScore({
				basePoints: 1000,
				timeLeftMs: -5_000,
				totalTimeMs: 20_000,
				isFirstCorrect: false
			})
		).toBe(500);
	});

	it('returns 0 for zero/negative totalTime', () => {
		expect(
			computeScore({ basePoints: 1000, timeLeftMs: 0, totalTimeMs: 0, isFirstCorrect: false })
		).toBe(0);
	});
});
