import { get } from 'svelte/store';
import { phase, textbookFurthest, textbookTotal } from './store';
import { track, saveResume } from './telemetry';

/**
 * End the study and hand off to the Qualtrics post-survey.
 *
 * Shared by the two places a participant can finish from — the fixed bar at the
 * bottom-left of the screen and the call to action inside TE's textbook card —
 * so they cannot drift on what `study_completed` records. `via` distinguishes
 * which one they actually used, which is worth knowing: if nobody ever presses
 * the in-card button, the bar is doing the work, and vice versa.
 */
export function finishStudy(via: 'finish_bar' | 'textbook_card'): void {
	track('study_completed', null, {
		via: 'textbook_progress',
		surface: via,
		textbook_furthest: get(textbookFurthest),
		textbook_total: get(textbookTotal)
	});
	saveResume(0);
	phase.set('complete');
}
