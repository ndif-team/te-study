import type { StudyCheck } from './config';

/**
 * What an embedded check records — kept out of the components so the rules are
 * testable without a browser, and so the textbook checks and the (flagged-off)
 * activity rail cannot drift apart on what a check does.
 *
 * NOTHING HERE GRADES AN ANSWER, DELIBERATELY.
 *
 * Checks are engagement probes. The app records what the participant typed and
 * what the model was showing at that moment; whether an answer was right is
 * decided later, in analysis, where a rule that turns out to be wrong can be
 * changed and the whole dataset re-scored.
 *
 * Grading live meant judging free text against a MOVING answer key — the ranked
 * list changes with the participant's own prompt — through a normaliser that had
 * to guess how forgiving to be, and then telling the participant the verdict on
 * screen. Wave 2 showed both halves failing: an answer of 'unset create' against
 * an expected ' create' was marked wrong and the participant was told so, while
 * a punctuation-only expected token would have accepted any punctuation at all.
 * Each fix was small; the class of bug is not, because every one of them
 * misinforms the person being measured and cannot be undone after the fact.
 *
 * Analysis loses nothing: `expectationFor` records what an answer would have
 * been scored against, so correctness is recoverable offline and revisable.
 */

/** Live model state a check is recorded against. */
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
 * documented as sorted, but a check recorded against the wrong token would be
 * invisible in the data, so this asserts the contract instead of assuming it.
 *
 * Rank 0 is deterministic for a given prompt, unlike TE's `predictedToken`,
 * which is sampled. What gets recorded must not vary between runs of the same
 * prompt.
 */
export function tokenAtRank(state: LiveState, rank: number): string {
	return state.probabilities?.find((p) => p.rank === rank)?.token ?? '';
}

/**
 * Whether the thing the question refers to exists yet.
 *
 * Not a grading step — it is what keeps the submit control inert until the model
 * has produced something, so an eager click cannot record an answer with nothing
 * to interpret it against. A `choice` check is answerable immediately.
 */
export function isReady(check: StudyCheck, state: LiveState): boolean {
	if (check.kind === 'choice') return true;
	if (check.kind === 'top-token') return Boolean(tokenAtRank(state, check.rank ?? 0));
	return (state.tokens?.length ?? 0) > 0;
}

/**
 * What the answer would be scored against, recorded alongside it.
 *
 * For the live kinds this is the model state at the moment of submission, which
 * is otherwise unrecoverable — the participant's next keystroke changes it. For
 * `choice` it is the configured correct option, which is stable, but is recorded
 * the same way so that analysis has one rule for every kind and does not need to
 * re-read a config that may since have moved.
 */
export function expectationFor(check: StudyCheck, state: LiveState): string | null {
	if (check.kind === 'choice') return check.options[check.correctIndex] ?? null;
	if (check.kind === 'top-token') return tokenAtRank(state, check.rank ?? 0) || null;
	const count = state.tokens?.length ?? 0;
	return count ? String(count) : null;
}
