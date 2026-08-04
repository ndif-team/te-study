<script lang="ts">
	import { onMount } from 'svelte';
	import { QUALTRICS_POST_SURVEY_URL } from './env';
	import { prolificParams } from './store';
	import { buildHandoffUrl } from './prolific';
	import { flush } from './telemetry';

	/**
	 * The Prolific completion code lives in Qualtrics, not here (Jul 21 decision
	 * to move it out of the tool). This screen's only job is to flush telemetry
	 * and carry the participant's identifiers across to the post-survey.
	 */
	$: handoff = buildHandoffUrl(QUALTRICS_POST_SURVEY_URL, $prolificParams);

	let flushed = false;

	onMount(async () => {
		await flush();
		flushed = true;
	});
</script>

<div class="st-overlay" data-testid="study-complete">
	<div class="st-card">
		<h1>That's the last step — thank you</h1>
		<p>
			One short questionnaire remains. Your completion code is on the final page of that
			questionnaire, so you must finish it to be paid.
		</p>

		{#if handoff}
			<a class="st-cta" data-testid="post-survey-link" href={handoff}
				>Continue to the questionnaire</a
			>
		{:else}
			<p class="st-warn" data-testid="handoff-missing">
				The questionnaire link is not configured. Please contact the researchers before closing this
				window.
			</p>
		{/if}

		<p class="st-muted" data-testid="flush-state">
			{flushed ? 'Your responses have been saved.' : 'Saving your responses…'}
		</p>
	</div>
</div>

<style lang="scss">
	.st-overlay {
		position: fixed;
		inset: 0;
		z-index: 10000;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(15, 23, 42, 0.75);
		padding: 2rem;
	}

	.st-card {
		max-width: 32rem;
		background: #ffffff;
		border-radius: 0.5rem;
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		font-size: 0.95rem;
		line-height: 1.55;
		color: #1e293b;
	}

	h1 {
		font-size: 1.3rem;
		font-weight: 600;
		color: #0f172a;
	}

	.st-cta {
		align-self: flex-start;
		margin-top: 0.4rem;
		padding: 0.6rem 1.4rem;
		background: #7c3aed;
		color: #ffffff;
		border-radius: 0.25rem;
		font-weight: 500;
		text-decoration: none;
	}

	.st-muted {
		font-size: 0.85rem;
		color: #64748b;
	}

	.st-warn {
		font-size: 0.85rem;
		color: #b91c1c;
	}
</style>
