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

/** Answers given so far, keyed by unit id — drives the "answered" UI state. */
export const checkAnswers = writable<Record<string, { answer: string; correct: boolean }>>({});

export const currentUnit = derived(unitIdx, ($i): StudyUnit | null => STUDY_UNITS[$i] ?? null);

export const currentStepId = derived(currentUnit, ($u) => $u?.id ?? null);

export function currentStepIdNow(): string | null {
	return get(currentUnit)?.id ?? null;
}

export const totalUnits = STUDY_UNITS.length;
