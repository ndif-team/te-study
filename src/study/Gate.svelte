<script lang="ts">
	import { isFetchingModel } from '~/store';
	import { MOCK_MODEL, MIN_STUDY_WIDTH, TE_COMFORTABLE_WIDTH } from './env';
	import { phase, unitIdx, telemetryReady, railActive, textbookTotal } from './store';
	import { STUDY_UNITS } from './config';
	import { track } from './telemetry';

	/**
	 * The model download is ~627 MB and starts immediately on mount, so this
	 * screen exists as much to give it cover as to inform: the participant reads
	 * while the weights stream in. `model_ready` duration is logged so a slow-load
	 * dropout is identifiable in the analysis rather than looking like disengagement.
	 *
	 * Begin is deliberately NOT disabled while the model loads. It used to be, and
	 * that was the single biggest source of pilot dropout: most participants left
	 * before `model_ready` ever fired, sitting on a dead button.
	 *
	 * Upstream TE is built for exactly this wait and we were suppressing all of it:
	 *
	 *   - `runModelOrCache` renders full, real visualisations from five bundled
	 *     examples (`ex0`-`ex4`) while the weights stream.
	 *   - `InputForm` already disables only the *custom text* input during the
	 *     fetch, keeps the example selector live, and captions it "Try the
	 *     examples while GPT-2 model is being downloaded (600MB)".
	 *   - Textbook page 2 says "If the model isn't ready yet, try another Example"
	 *     and points its cursor at the example selector rather than Generate.
	 *   - Picking an example during the fetch completes that textbook page, so
	 *     study progress genuinely advances before the download finishes.
	 *
	 * So the custom-prompt hazard (typing your own prompt during the fetch would
	 * show a *different* prompt's data, because `fakeRunWithCachedData` overwrites
	 * `tokens`) is already handled upstream — the input is disabled, and only the
	 * curated examples, whose cached data matches, are reachable.
	 */
	$: modelLoading = MOCK_MODEL ? false : $isFetchingModel;

	// Usable but narrower than TE's 1300px layout, so the page will scroll
	// sideways. Say so once here rather than let them find it mid-task.
	let narrowViewport = false;
	if (typeof window !== 'undefined') {
		narrowViewport =
			window.innerWidth >= MIN_STUDY_WIDTH && window.innerWidth < TE_COMFORTABLE_WIDTH;
	}

	const begin = () => {
		// Whether participants actually start before the weights land is the
		// measure of whether removing the gate worked. Pair with `model_ready`.
		track('study_begun', null, { model_loading: modelLoading });
		phase.set('running');
		// Only our own rail emits unit-level step events. With the rail off,
		// progress is tracked through TE's textbook in StudyShell instead.
		if ($railActive) {
			const first = STUDY_UNITS[$unitIdx];
			if (first) track('step_started', first.id, { index: $unitIdx, resumed: $unitIdx > 0 });
		}
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
			{#if $railActive}
				<p>
					You will work through {STUDY_UNITS.length} short steps with a live GPT-2 model running entirely
					in your browser. Each step gives you something to do, a short explanation, and one question.
				</p>
				<p>
					The questions are there so we know the tool was used — they are not a test, and getting
					one wrong will not stop you moving on or affect your payment.
				</p>
			{:else}
				<p>
					You will explore a live GPT-2 model running entirely in your browser, guided by the tool's
					own walkthrough — the panel on screen takes you through it {$textbookTotal
						? `in ${$textbookTotal} steps`
						: 'step by step'}.
				</p>
				<p>
					Follow it at your own pace and try things out as you go. When you reach the last step, a
					button will appear to take you to a short questionnaire.
				</p>
			{/if}
			<p class="st-muted">
				This is GPT-2, a small model from 2019 that was never trained to chat. It is far weaker than
				ChatGPT, and it can produce text that is wrong or odd. That is expected — you are here to
				watch the mechanism, not to judge the answers.
			</p>

			{#if narrowViewport}
				<p class="st-muted" data-testid="narrow-viewport">
					Your window is a little narrower than the visualisation, so you may need to scroll
					sideways to see all of it. Maximising the window, or hiding your browser's bookmarks
					bar, will help.
				</p>
			{/if}

			{#if modelLoading}
				<p class="st-loading" data-testid="model-loading">
					GPT-2 is downloading in the background (about 600 MB). <strong
						>You do not need to wait for it.</strong
					> Begin now — the walkthrough starts with built-in example prompts that work straight away.
					The box for typing your own prompts switches on by itself when the download finishes.
				</p>
			{/if}

			<button data-testid="begin-study" on:click={begin}>Begin</button>

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
