<script lang="ts">
	import { textbookCurrentPageId } from '~/store';
	import { TEXTBOOK_CHECKS } from './config';
	import { checkSeen } from './store';
	import { scrollCheckIntoView } from './nudge';

	/**
	 * "Scroll down here to continue" — shown when the current page has a check
	 * that is still below the fold.
	 *
	 * TE's card is a small fixed-height box, so on most check pages the question
	 * is off-screen and the only hint is a thin scrollbar. Without this a
	 * participant reads the visible prose, presses next, and never learns there
	 * was a question — which is indistinguishable in the data from choosing to
	 * skip it.
	 *
	 * Anchored to the card rather than the scrolling content, so it stays put
	 * instead of scrolling away with the thing it is pointing at.
	 */
	$: pageId = $textbookCurrentPageId;
	$: show = Boolean(pageId && TEXTBOOK_CHECKS[pageId] && !$checkSeen[pageId]);
</script>

{#if show}
	<button
		class="st-cue"
		data-testid="scroll-cue"
		on:click|stopPropagation={() => scrollCheckIntoView()}
	>
		<span class="st-arrow" aria-hidden="true">▼</span>
		<span>Scroll down here to continue</span>
	</button>
{/if}

<style lang="scss">
	.st-cue {
		position: absolute;
		left: 0;
		right: 0;
		// Directly above TE's navigation footer, so it does not cover the paging
		// controls it is telling them not to press yet.
		bottom: 3.5rem;
		/*
		 * Below `.navigation-footer` (z-index 10), not above it.
		 *
		 * TE's page dropdown opens UPWARDS from the page counter into exactly this
		 * band. It lives inside the footer, and the footer's own z-index creates a
		 * stacking context the dropdown cannot escape — so raising the dropdown
		 * does nothing and anything above 10 here silently swallows every click on
		 * TE's own page list. The two never overlap vertically, so painting under
		 * the footer costs nothing.
		 */
		z-index: 5;

		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.45rem 0.75rem;
		border: none;
		border-top: 1px solid #fcd34d;

		background: #fffbeb;
		color: #92400e;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		width: 100%;

		&:hover {
			background: #fef3c7;
		}
	}

	.st-arrow {
		display: inline-block;
		font-size: 1rem;
		line-height: 1;
		animation: st-bounce 1.1s ease-in-out infinite;
	}

	@keyframes st-bounce {
		0%,
		100% {
			transform: translateY(-2px);
		}
		50% {
			transform: translateY(3px);
		}
	}

	// Respect a stated preference for less motion: the cue still reads clearly
	// without the animation, and a bouncing arrow is exactly the kind of thing
	// that provokes discomfort for some participants.
	@media (prefers-reduced-motion: reduce) {
		.st-arrow {
			animation: none;
		}
	}
</style>
