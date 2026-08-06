<script lang="ts">
	import { textbookFurthest, textbookTotal, tutorialComplete } from './store';
	import { finishStudy } from './finish';

	/**
	 * The default study surface: a slim bar over an otherwise untouched
	 * Transformer Explainer.
	 *
	 * TE ships its own 20-page textbook walkthrough, and that is the tutorial it
	 * was evaluated with, so participants follow it rather than anything of ours.
	 * All this adds is a sense of how far through they are and a way out at the
	 * end — the exit unlocks once they have reached TE's final page.
	 */
	$: page = Math.min($textbookFurthest + 1, $textbookTotal || 1);

	const finish = () => finishStudy('finish_bar');
</script>

<div class="st-finishbar" data-testid="finish-bar">
	<span class="st-progress" data-testid="tutorial-progress">
		Walkthrough: step {page} of {$textbookTotal || '…'}
	</span>

	{#if $tutorialComplete}
		<button class="st-finish" data-testid="finish-study" on:click={finish}>
			Continue to the questionnaire
		</button>
	{:else}
		<span class="st-hint" data-testid="finish-hint">
			Work through the walkthrough panel; this unlocks at the last step.
		</span>
	{/if}
</div>

<style lang="scss">
	.st-finishbar {
		position: fixed;
		// Bottom-LEFT, not right: Transformer Explainer docks its own textbook
		// navigation bottom-right (measured at x 1045-1551, y 909-960 on a 1600px
		// viewport), and a bar there covers the page controls the participant
		// needs to advance the walkthrough. tests/textbook.spec.ts drives TE's
		// page counter, so a regression here fails the suite.
		left: 0.75rem;
		bottom: 0.75rem;
		max-width: 40vw;
		// Must beat every TE stacking context or its SVG layers swallow the click.
		z-index: 9999;
		display: flex;
		align-items: center;
		gap: 0.85rem;
		padding: 0.55rem 0.85rem;
		background: #ffffff;
		border: 1px solid #e2e8f0;
		border-radius: 0.375rem;
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
		font-size: 0.82rem;
		color: #1e293b;
	}

	.st-progress {
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}

	.st-hint {
		color: #64748b;
	}

	.st-finish {
		padding: 0.4rem 0.9rem;
		background: #7c3aed;
		color: #ffffff;
		border: none;
		border-radius: 0.25rem;
		font-weight: 500;
		cursor: pointer;

		&:hover {
			background: #6d28d9;
		}
	}
</style>
