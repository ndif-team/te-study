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

/**
 * Comparison key for an answer or an expected token.
 *
 * `normalise` collapses a punctuation-only token to the empty string, which made
 * every punctuation-only ANSWER equal to it. Wave 2 really produced a rank-1
 * expected token of ',' -- against which typing '?' scored correct. So when
 * stripping would leave nothing, fall back to the trimmed, lower-cased text:
 * ',' stays ',' and only a comma matches it.
 */
export const answerKey = (s: string) => normalise(s) || s.trim().toLowerCase();

/**
 * The last whitespace-separated word of an answer.
 *
 * Wave 2 produced two answers prefixed 'unset ' -- 'unset 6' and 'unset create'
 * -- from something outside the app (autofill or an IME; nothing in this
 * codebase writes that string). `token-count` happened to survive it by
 * stripping non-digits, while `top-token` marked a substantively correct
 * 'create' wrong. Grading the last word as a FALLBACK removes that asymmetry.
 *
 * Deliberately the last word and not any word: 'create or make' must not earn
 * credit for containing the right token among guesses. The accepted cost is that
 * 'not Paris' would grade as 'Paris' -- judged the lesser risk in a field
 * labelled "type the token", against a prefix artefact we have observed twice.
 */
const lastWord = (s: string) => s.trim().split(/\s+/).pop() ?? '';

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
		const want = answerKey(expected);
		const correct = answerKey(text) === want || answerKey(lastWord(text)) === want;
		return { correct, expected };
	}

	// token-count: graded against the participant's own live tokenisation.
	const count = state.tokens?.length ?? 0;
	if (!count) return null;
	// Digits from the last word, falling back to the whole field. Reading every
	// digit in the string was what let 'unset 6' through, but it also turned
	// '1st guess 6' into 16.
	const digits = (s: string) => s.replace(/[^0-9]/g, '');
	const given = Number(digits(lastWord(text)) || digits(text));
	return { correct: Number.isFinite(given) && given === count, expected: String(count) };
}
