/**
 * Scoring formula for a single correct answer ( → Scoring formula).
 *
 *   scoreDelta = round(basePoints × max(0.5, timeLeft / totalTime))
 *              + (isFirstCorrect ? 10 : 0)
 *
 * Linear time-decay from 1.0× (answered at t=0) to 0.5× (answered at timer expiry).
 * A flat +10 bonus is awarded to the first participant to submit a correct answer
 * on a given question — tracked per-question via the DO's `firstCorrectAwarded`
 * flag in storage.
 *
 * Wrong answers don't go through this function; callers gate on correctness and
 * only invoke computeScore for matches.
 */
export interface ScoreInput {
	basePoints: number;
	/** Milliseconds remaining when the answer was submitted. Clamped to [0, totalTimeMs]. */
	timeLeftMs: number;
	totalTimeMs: number;
	isFirstCorrect: boolean;
}

export function computeScore({
	basePoints,
	timeLeftMs,
	totalTimeMs,
	isFirstCorrect
}: ScoreInput): number {
	if (totalTimeMs <= 0) return 0;
	const clampedLeft = Math.max(0, Math.min(timeLeftMs, totalTimeMs));
	const factor = Math.max(0.5, clampedLeft / totalTimeMs);
	return Math.round(basePoints * factor) + (isFirstCorrect ? 10 : 0);
}
