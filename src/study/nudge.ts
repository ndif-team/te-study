import { get } from 'svelte/store';
import { textbookCurrentPageId } from '~/store';
import { TEXTBOOK_CHECKS } from './config';
import { checkAnswers, checkNudges } from './store';
import { track } from './telemetry';

/**
 * Nudge participants to answer the current page's check before paging forward,
 * without ever actually stopping them.
 *
 * First press of TE's forward arrow on a page with an unanswered check is
 * swallowed and a prompt appears; the second press goes through. So the check
 * is hard to *miss* but trivial to *skip*, which is the balance we want:
 * blocking on checks drives dropout, and silently ignoring them yields no
 * engagement signal at all.
 *
 * WHY A CAPTURE LISTENER RATHER THAN A PATCH TO TE:
 *
 * TE's TextbookNavigation changes page from four different places (forward
 * arrow, back arrow, progress-bar click, progress-bar drag, and the page
 * dropdown), each writing `textbookCurrentPage` directly. Guarding at the store
 * level would mean letting the page change and then putting it back, which
 * visibly bounces the carousel. Intercepting the click in the CAPTURE phase
 * stops TE's own bubble-phase handler from ever running, so nothing moves and
 * nothing needs patching.
 *
 * Only the forward arrow is guarded. Paging back, dragging the progress bar and
 * jumping via the dropdown are all deliberate navigation, and treating them as
 * skips keeps the rule easy to describe: "the arrow asks once".
 */
export function installCheckNudge(): () => void {
	const onClick = (event: MouseEvent) => {
		const target = event.target as HTMLElement | null;
		// `.nav-section.right` is TE's forward-arrow hit area.
		if (!target?.closest?.('.nav-section.right')) return;

		const pageId = get(textbookCurrentPageId);
		if (!pageId) return;

		const check = TEXTBOOK_CHECKS[pageId];
		if (!check) return;
		if (get(checkAnswers)[pageId]) return; // already answered — let them go
		if (get(checkNudges)[pageId]) return; // already nudged once — let them go

		event.preventDefault();
		event.stopPropagation();

		checkNudges.update((m) => ({ ...m, [pageId]: true }));
		track('hint_shown', pageId, { surface: 'te_textbook', reason: 'unanswered_check' });
	};

	// Capture phase, on the document, so it runs before any handler TE attached.
	document.addEventListener('click', onClick, true);
	return () => document.removeEventListener('click', onClick, true);
}
