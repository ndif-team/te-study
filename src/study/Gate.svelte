<script lang="ts">
	import { isFetchingModel } from '~/store';
	import { MOCK_MODEL, MIN_STUDY_WIDTH } from './env';
	import { phase, unitIdx, telemetryReady } from './store';
	import { STUDY_UNITS, STUDY_ARM } from './config';
	import { track } from './telemetry';

	/**
	 * The model download is ~657 MB and starts immediately on mount, so this
	 * screen exists as much to give it cover as to inform: the participant reads
	 * while the weights stream in. `model_ready` duration is logged so a slow-load
	 * dropout is identifiable in the analysis rather than looking like disengagement.
	 */
	$: modelLoading = MOCK_MODEL ? false : $isFetchingModel;

	const begin = () => {
		phase.set('running');
		const first = STUDY_UNITS[$unitIdx];
		if (first) track('step_started', first.id, { index: $unitIdx, resumed: $unitIdx > 0 });
	};
</script>

{#if $phase === 'blocked'}
	<div class="st-overlay" data-testid="study-blocked">
		<div class="st-card">
			<h1>This study needs a larger screen</h1>
			<p>
				The visualisation you will be working with does not fit on a phone, tablet or narrow window.
				Please reopen this link on a desktop or laptop, in a window at least
				{MIN_STUDY_WIDTH}px wide.
			</p>
			<p class="st-muted">
				Please return the study on Prolific so your place can be offered to someone else — you will
				not be penalised.
			</p>
		</div>
	</div>
{:else if $phase === 'intro'}
	<div class="st-overlay" data-testid="study-intro">
		<div class="st-card">
			<h1>Watching a language model run</h1>
			<p>
				You will work through {STUDY_UNITS.length} short steps with a live GPT-2 model running entirely
				in your browser. Each step gives you something to do, a short explanation, and one question.
			</p>
			<p>
				The questions are there so we know the tool was used — they are not a test, and getting one
				wrong will not stop you moving on or affect your payment.
			</p>
			<p class="st-muted">
				This is GPT-2, a small model from 2019 that was never trained to chat. It is far weaker than
				ChatGPT, and it can produce text that is wrong or odd. That is expected — you are here to
				watch the mechanism, not to judge the answers.
			</p>

			{#if modelLoading}
				<p class="st-loading" data-testid="model-loading">
					Loading the model into your browser… this can take a minute or two on a slower connection.
					You can start reading — the button will enable when it is ready.
				</p>
			{/if}

			<button data-testid="begin-study" disabled={modelLoading} on:click={begin}>
				{modelLoading ? 'Loading…' : 'Begin'}
			</button>

			{#if !$telemetryReady}
				<p class="st-warn" data-testid="telemetry-warning">
					Your progress is not being recorded. Please check your connection and reload before
					continuing, or your submission may not be approved.
				</p>
			{/if}
		</div>
	</div>
{/if}

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
		max-width: 34rem;
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
		font-size: 1.35rem;
		font-weight: 600;
		color: #0f172a;
	}

	.st-muted {
		font-size: 0.85rem;
		color: #64748b;
	}

	.st-loading {
		font-size: 0.85rem;
		color: #7c3aed;
	}

	.st-warn {
		font-size: 0.85rem;
		color: #b91c1c;
	}

	button {
		align-self: flex-start;
		margin-top: 0.4rem;
		padding: 0.6rem 1.4rem;
		background: #7c3aed;
		color: #ffffff;
		border: none;
		border-radius: 0.25rem;
		font-weight: 500;
		cursor: pointer;

		&:disabled {
			background: #c4b5fd;
			cursor: default;
		}
	}
</style>
