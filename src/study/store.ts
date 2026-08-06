import { writable, derived, get } from 'svelte/store';
import { STUDY_UNITS, type StudyUnit } from './config';
import type { ProlificParams } from './prolific';

/**
 * blocked  — viewport/device too small; refused before a Prolific slot is spent
 * intro    — consent recap + what to expect, while the model loads behind it
 * running  — working through the units
 * complete — handoff to the Qualtrics post-survey
 */
export type StudyPhase = 'booting' | 'blocked' | 'intro' | 'running' | 'complete';

export const phase = writable<StudyPhase>('booting');
export const unitIdx = writable(0);
export const prolificParams = writable<ProlificParams | null>(null);
export const telemetryReady = writable(false);

/**
 * Answers given so far, keyed by unit id (activity rail) or by TE textbook page
 * id (default path) — drives the "answered" UI state.
 */
export const checkAnswers = writable<Record<string, { answer: string; correct: boolean }>>({});

/**
 * Pages where the participant has already been nudged to answer before moving
 * on. The nudge fires once per page: the first forward press is intercepted,
 * the second goes through. Answering is therefore encouraged but never
 * required, which is the point — a hard gate on checks drives Prolific dropout
 * (prolific-tutorial-design-spec.md §4.7), and this arm has already lost one
 * pilot to a blocking control.
 */
export const checkNudges = writable<Record<string, boolean>>({});

/**
 * Pages whose check has actually been scrolled into view.
 *
 * TE's textbook card is small and fixed-height, so on most check pages the
 * question sits below the fold with nothing but a thin scrollbar hinting at it.
 * A participant can read the visible prose and press next having never known a
 * question was there — which looks identical in the data to deliberately
 * skipping one. The Workbench arm has no equivalent problem because its layout
 * puts the check in view.
 *
 * So forward navigation waits until the check has been seen. Not answered —
 * seen. Answering stays optional (see [[checkNudges]]).
 */
export const checkSeen = writable<Record<string, boolean>>({});

/**
 * How many times a forward press has been refused because the check was still
 * off-screen. A safety valve, not a metric: see `nudge.ts`.
 */
export const checkScrollBlocks = writable<Record<string, number>>({});

/** Whether our own activity rail is mounted this visit (see env.activityRailEnabled). */
export const railActive = writable(false);

/**
 * Progress through Transformer Explainer's OWN textbook, which is the tutorial
 * the tool was evaluated with and therefore the one participants follow.
 * `furthest` rather than `current` so paging back does not lock the exit again.
 */
export const textbookFurthest = writable(0);
export const textbookTotal = writable(0);

/** The exit unlocks once TE's own walkthrough has been seen to the end. */
export const tutorialComplete = derived(
	[textbookFurthest, textbookTotal],
	([$furthest, $total]) => $total > 0 && $furthest >= $total - 1
);

export const currentUnit = derived(unitIdx, ($i): StudyUnit | null => STUDY_UNITS[$i] ?? null);

/**
 * What an interaction gets attributed to.
 *
 * On the default path there are no units of ours, so the meaningful location is
 * the participant's position in Transformer Explainer's own textbook — that is
 * what makes an interaction funnel readable without a lookup table. The unit id
 * is only correct when our rail is actually mounted.
 */
export function currentStepIdNow(): string | null {
	if (get(railActive)) return get(currentUnit)?.id ?? null;
	return get(textbookStepId);
}

/** Set by StudyShell from TE's own page list. */
export const textbookStepId = writable<string | null>(null);

export const totalUnits = STUDY_UNITS.length;
