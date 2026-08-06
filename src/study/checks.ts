import type { StudyCheck } from './config';

/**
 * Grading for engagement checks, kept out of the components so the rules are
 * testable without a browser and so the textbook checks and the (flagged-off)
 * activity rail cannot drift apart on what "correct" means.
 */

/**
 * Token comparison has to be forgiving about the things a participant cannot
 * reasonably be expected to reproduce: GPT-2 tokens carry a leading space
 * (" Paris", not "Paris"), and nobody types that. Case and surrounding
 * punctuation go the same way — the check is evidence of engagement, not a
 * spelling test.
 */
export const normalise = (s: string) =>
	s
		.trim()
		.toLowerCase()
		.replace(/^[^\w]+|[^\w]+$/g, '');

/** Live model state a check may be graded against. */
export type LiveState = {
	/** `modelData.probabilities`, sorted by logit descending with explicit ranks. */
	probabilities?: { rank: number; token: string }[] | null;
	/** `tokens` — the current tokenisation of the participant's text. */
	tokens?: string[] | null;
};

/**
 * The token at a given rank, or '' when the model has not run yet.
 *
 * Deliberately reads `rank` rather than trusting array order: the store is
 * documented as sorted, but a check that silently grades against the wrong
 * token would be invisible in the data, so this asserts the contract instead of
 * assuming it.
 */
export function tokenAtRank(state: LiveState, rank: number): string {
	return state.probabilities?.find((p) => p.rank === rank)?.token ?? '';
}

export type GradeResult = {
	correct: boolean;
	/** What the answer was graded against, recorded alongside it for analysis. */
	expected: string | null;
};

/**
 * Grade an answer. Returns null when the check cannot be graded yet — for the
 * live kinds that means the model has not produced anything, and the caller
 * should keep the submit control disabled rather than record a spurious wrong.
 */
export function gradeCheck(
	check: StudyCheck,
	answer: { choice?: number | null; text?: string },
	state: LiveState
): GradeResult | null {
	if (check.kind === 'choice') {
		if (answer.choice == null) return null;
		return {
			correct: answer.choice === check.correctIndex,
			expected: check.options[check.correctIndex] ?? null
		};
	}

	const text = (answer.text ?? '').trim();
	if (!text) return null;

	if (check.kind === 'top-token') {
		// Graded against the deterministic ranked list, never against
		// `predictedToken` — TE samples, so what it displays varies run to run.
		const expected = tokenAtRank(state, check.rank ?? 0);
		if (!expected) return null;
		return { correct: normalise(text) === normalise(expected), expected };
	}

	// token-count: graded against the participant's own live tokenisation.
	const count = state.tokens?.length ?? 0;
	if (!count) return null;
	const given = Number(text.replace(/[^0-9]/g, ''));
	return { correct: Number.isFinite(given) && given === count, expected: String(count) };
}
