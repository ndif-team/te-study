<script lang="ts">
	import { textbookCurrentPage } from '~/store';
	import { textbookTotal, tutorialComplete } from './store';
	import { finishStudy } from './finish';

	/**
	 * The way out, shown inside Transformer Explainer's own textbook card once the
	 * participant reaches the final page.
	 *
	 * There is already a finish button in the fixed bar at the bottom-left of the
	 * screen, but that is a long way from where the participant is looking at the
	 * end of a 20-page walkthrough, and the card is draggable so the distance is
	 * unpredictable. Worse, TE's forward arrow WRAPS: `navigatePage('next')` on
	 * the last page sets the index to 0, so pressing it silently restarts the
	 * walkthrough at page 1 rather than doing nothing. Someone who finished and
	 * kept pressing next would quietly find themselves back at the beginning.
	 *
	 * So this sits directly above TE's navigation footer — visible exactly where
	 * they just pressed "next" — and `nudge.ts` stops the wrap.
	 */
	$: onLastPage = $textbookTotal > 0 && $textbookCurrentPage >= $textbookTotal - 1;
	$: show = onLastPage && $tutorialComplete;
</script>

{#if show}
	<div class="st-finish-cta" data-testid="textbook-finish">
		<span class="st-done">That's the end of the walkthrough.</span>
		<button
			class="st-go"
			data-testid="textbook-finish-button"
			on:click={() => finishStudy('textbook_card')}
		>
			Continue to the questionnaire
		</button>
	</div>
{/if}

<style lang="scss">
	.st-finish-cta {
		position: absolute;
		left: 0;
		right: 0;
		// Directly above `.navigation-footer` (3.5rem), so the card's own paging
		// controls stay reachable rather than being covered by this.
		bottom: 3.5rem;
		z-index: 20;

		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;

		background: #f5f3ff;
		border-top: 1px solid #ddd6fe;
		font-size: 0.85rem;
	}

	.st-done {
		color: #5b21b6;
		font-weight: 500;
	}

	.st-go {
		flex: none;
		padding: 0.4rem 0.9rem;
		background: #7c3aed;
		color: #ffffff;
		border: none;
		border-radius: 0.25rem;
		font-weight: 500;
		font-size: 0.82rem;
		cursor: pointer;

		&:hover {
			background: #6d28d9;
		}
	}
</style>
