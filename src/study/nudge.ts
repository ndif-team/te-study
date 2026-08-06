import { get } from 'svelte/store';
import { textbookCurrentPage, textbookCurrentPageId } from '~/store';
import { TEXTBOOK_CHECKS } from './config';
import {
	checkAnswers,
	checkNudges,
	checkScrollBlocks,
	checkSeen,
	textbookTotal
} from './store';
import { track } from './telemetry';

/**
 * Bring the current page's check into view inside TE's card. Used both by the
 * scroll cue when pressed and by the forward-arrow guard, so that a participant
 * who presses next instead of scrolling is still shown the question rather than
 * simply refused.
 */
export function scrollCheckIntoView(): void {
	const el = document.querySelector(
		'.carousel-slide.active [data-testid="textbook-check"]'
	) as HTMLElement | null;
	el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * After this many refused presses, let them through regardless.
 *
 * The gate is on having SEEN the check, which is normally satisfied the instant
 * the auto-scroll above runs. But it depends on IntersectionObserver firing
 * against a scroll container inside a draggable, resizable card, and if that
 * ever fails to fire the participant is stuck on one page with no way forward
 * and no idea why. This arm has already lost a pilot to a control that would
 * not let people proceed; a stuck participant is a far worse outcome than an
 * unseen question, so the gate yields rather than trapping anyone.
 */
const MAX_SCROLL_BLOCKS = 2;

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

		// TE's forward arrow WRAPS: navigatePage('next') on the last page sets the
		// index to 0, silently restarting the walkthrough at page 1. A participant
		// who finished and pressed next once more would find themselves back at the
		// beginning with no idea why, and `textbookFurthest` means the exit stays
		// unlocked — so they would be lost in a tutorial they had already completed.
		// Swallow it; TextbookFinish is showing the way out right above the arrow.
		const total = get(textbookTotal);
		if (total > 0 && get(textbookCurrentPage) >= total - 1) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}

		const pageId = get(textbookCurrentPageId);
		if (!pageId) return;

		const check = TEXTBOOK_CHECKS[pageId];
		if (!check) return;
		if (get(checkAnswers)[pageId]) return; // already answered — let them go

		// First gate: has the question even been on screen? The card is small
		// enough that most checks start below the fold, so someone can read the
		// visible prose and page on without ever knowing a question existed.
		// Scroll it into view for them rather than just refusing.
		if (!get(checkSeen)[pageId]) {
			const blocks = (get(checkScrollBlocks)[pageId] ?? 0) + 1;
			checkScrollBlocks.update((m) => ({ ...m, [pageId]: blocks }));

			if (blocks <= MAX_SCROLL_BLOCKS) {
				event.preventDefault();
				event.stopPropagation();
				scrollCheckIntoView();
				if (blocks === 1) {
					track('hint_shown', pageId, { surface: 'te_textbook', reason: 'check_offscreen' });
				}
				return;
			}

			// Safety valve tripped. Recorded, because a participant reaching this
			// means the observer never fired and the cue is not doing its job.
			track('hint_shown', pageId, {
				surface: 'te_textbook',
				reason: 'check_offscreen_override',
				blocks
			});
			return;
		}

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
