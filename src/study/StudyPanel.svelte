<script lang="ts">
	import { inputText, predictedToken, modelData } from '~/store';
	import { STUDY_UNITS } from './config';
	import { unitIdx, checkAnswers, phase, totalUnits } from './store';
	import { track, saveResume } from './telemetry';

	$: unit = STUDY_UNITS[$unitIdx];
	$: answered = unit ? $checkAnswers[unit.id] : undefined;
	$: isLast = $unitIdx === totalUnits - 1;

	/**
	 * Transformer Explainer lays out horizontally with a 1300px minimum, so a
	 * docked rail would either squash it or force horizontal scrolling. The rail
	 * floats above instead, and collapses so the participant can see the full
	 * width of the visualisation when a task needs it.
	 */
	let collapsed = false;

	let choice: number | null = null;
	let freeAnswer = '';

	// Reset the answer widgets when the unit changes.
	$: if (unit) {
		choice = null;
		freeAnswer = '';
	}

	const usePrompt = () => {
		if (!unit?.prompt) return;
		inputText.set(unit.prompt);
		track('prompt_run', unit.id, { source: 'unit_prompt', prompt: unit.prompt });
	};

	const normalise = (s: string) =>
		s
			.trim()
			.toLowerCase()
			.replace(/^[^\w]+|[^\w]+$/g, '');

	/**
	 * The HIGHEST-PROBABILITY token, which is not the same thing as TE's
	 * `predictedToken`.
	 *
	 * Transformer Explainer samples: `predictedToken` is `randomChoice()` over
	 * the top-k distribution at temperature 0.8 (src/utils/data.ts,
	 * `topKSampling`), so it varies between runs of the same prompt. Grading
	 * against it would mark participants wrong at random — and would break the
	 * study's stated premise that embedded checks are auto-scorable because
	 * decoding is deterministic (prolific-tutorial-design-spec.md §4.7), which is
	 * true of the Workbench arm but not of TE.
	 *
	 * `modelData.probabilities` is sorted by logit descending with `rank: i`, so
	 * rank 0 is deterministic for a given prompt. That is what the question
	 * ("the model's top predicted token") actually asks about.
	 */
	$: topToken = $modelData?.probabilities?.find((p) => p.rank === 0)?.token ?? '';

	const submitCheck = () => {
		if (!unit || answered) return;

		let answer: string;
		let correct: boolean;

		if (unit.check.kind === 'choice') {
			if (choice === null) return;
			answer = unit.check.options[choice];
			correct = choice === unit.check.correctIndex;
		} else {
			if (!freeAnswer.trim()) return;
			answer = freeAnswer;
			// Graded against the deterministic rank-0 token, not the sampled one.
			correct = normalise(answer) === normalise(topToken);
		}

		checkAnswers.update((m) => ({ ...m, [unit.id]: { answer, correct } }));

		// Log-only, never gates progress: gating drives Prolific dropout
		// (prolific-tutorial-design-spec.md §4.7).
		track('check_answered', unit.id, {
			kind: unit.check.kind,
			answer,
			correct,
			// The deterministic rank-0 token the answer was graded against...
			live_top_token: unit.check.kind === 'top-token' ? topToken || null : undefined,
			// ...and the token TE happened to sample and display, kept so the two
			// can be told apart if a participant answers with what they saw
			// animate rather than what topped the chart.
			sampled_token: unit.check.kind === 'top-token' ? ($predictedToken?.token ?? null) : undefined
		});
	};

	const advance = () => {
		if (!unit) return;
		track('step_completed', unit.id, {
			answered_check: Boolean(answered),
			check_correct: answered?.correct ?? null
		});

		if (isLast) {
			track('study_completed', unit.id, {});
			phase.set('complete');
			return;
		}

		const next = $unitIdx + 1;
		unitIdx.set(next);
		saveResume(next);
		track('step_started', STUDY_UNITS[next].id, { index: next });
	};
</script>

{#if unit && collapsed}
	<button class="st-reopen" data-testid="reopen-panel" on:click={() => (collapsed = false)}>
		Step {$unitIdx + 1} of {totalUnits} — show task
	</button>
{/if}

{#if unit && !collapsed}
	<aside class="study-panel" data-testid="study-panel" aria-label="Study activity">
		<header>
			<p class="st-progress" data-testid="study-progress">
				Step {$unitIdx + 1} of {totalUnits}
			</p>
			<h2>{unit.title}</h2>
			{#if unit.optional}<span class="st-optional">Optional</span>{/if}
			<button
				class="st-collapse"
				data-testid="collapse-panel"
				title="Hide this panel"
				on:click={() => (collapsed = true)}>Hide</button
			>
		</header>

		<section class="st-task">
			<p>{unit.task}</p>
			{#if unit.prompt}
				<button class="st-prompt-btn" data-testid="use-prompt" on:click={usePrompt}>
					Use this prompt
					<code>{unit.prompt}</code>
				</button>
			{/if}
		</section>

		<section class="st-callout">
			<p>{unit.callout}</p>
		</section>

		<section class="st-check" data-testid="study-check">
			<p class="st-question">{unit.check.question}</p>

			{#if unit.check.kind === 'choice'}
				<ul>
					{#each unit.check.options as option, i}
						<li>
							<label>
								<input
									type="radio"
									name={`check-${unit.id}`}
									value={i}
									disabled={Boolean(answered)}
									bind:group={choice}
								/>
								<span>{option}</span>
							</label>
						</li>
					{/each}
				</ul>
			{:else}
				<input
					class="st-free"
					type="text"
					data-testid="check-free-input"
					placeholder="Type the token exactly as shown"
					disabled={Boolean(answered)}
					bind:value={freeAnswer}
				/>
			{/if}

			{#if answered}
				<p class="st-feedback" data-testid="check-feedback" class:st-correct={answered.correct}>
					{answered.correct ? 'Correct.' : 'Noted — not quite, but keep going.'}
				</p>
			{:else}
				<button class="st-check-btn" data-testid="submit-check" on:click={submitCheck}
					>Submit</button
				>
			{/if}
		</section>

		<footer>
			<button class="st-next" data-testid="next-unit" on:click={advance}>
				{isLast ? 'Finish' : 'Next step'}
			</button>
		</footer>
	</aside>
{/if}

<style lang="scss">
	.st-reopen {
		position: fixed;
		top: 0.75rem;
		right: 0.75rem;
		// Above TE's own stacking contexts (its top bar sits at $TOP_BAR_INDEX).
		z-index: 9999;
		padding: 0.5rem 0.9rem;
		background: #7c3aed;
		color: #ffffff;
		border: none;
		border-radius: 0.25rem;
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
	}

	.study-panel {
		position: fixed;
		top: 0;
		right: 0;
		// Must beat every TE stacking context or its SVG//article layers paint
		// over the panel and swallow clicks on the controls.
		z-index: 9999;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: 22rem;
		height: 100vh;
		padding: 1.25rem;
		overflow-y: auto;
		background: #ffffff;
		border-left: 1px solid #e5e7eb;
		box-shadow: -2px 0 12px rgba(0, 0, 0, 0.06);
		font-size: 0.875rem;
		line-height: 1.5;
	}

	header {
		position: relative;
		border-bottom: 1px solid #f1f5f9;
		padding-bottom: 0.75rem;
	}

	.st-collapse {
		position: absolute;
		top: 0;
		right: 0;
		padding: 0.15rem 0.45rem;
		font-size: 0.75rem;
		color: #64748b;
		background: transparent;
		border: 1px solid #e2e8f0;
		border-radius: 0.25rem;
		cursor: pointer;
	}

	.st-progress {
		font-size: 0.75rem;
		color: #64748b;
		margin-bottom: 0.25rem;
	}

	h2 {
		font-size: 1.05rem;
		font-weight: 600;
		color: #0f172a;
	}

	.st-optional {
		font-size: 0.7rem;
		color: #64748b;
	}

	.st-task p,
	.st-callout p {
		color: #1e293b;
	}

	.st-callout {
		padding: 0.75rem;
		background: #f8fafc;
		border-left: 3px solid #7c3aed;
		border-radius: 0.25rem;
		color: #334155;
	}

	.st-prompt-btn {
		display: block;
		width: 100%;
		margin-top: 0.6rem;
		padding: 0.5rem 0.6rem;
		text-align: left;
		background: #f1f5f9;
		border: 1px solid #e2e8f0;
		border-radius: 0.25rem;
		cursor: pointer;

		&:hover {
			background: #e2e8f0;
		}

		code {
			display: block;
			margin-top: 0.25rem;
			font-size: 0.8rem;
			color: #7c3aed;
		}
	}

	.st-check {
		border-top: 1px solid #f1f5f9;
		padding-top: 0.75rem;
	}

	.st-question {
		font-weight: 500;
		margin-bottom: 0.5rem;
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-bottom: 0.6rem;
	}

	label {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		cursor: pointer;
	}

	.st-free {
		width: 100%;
		padding: 0.4rem 0.5rem;
		border: 1px solid #cbd5e1;
		border-radius: 0.25rem;
		margin-bottom: 0.6rem;
	}

	.st-feedback {
		font-size: 0.8rem;
		color: #b45309;

		&.st-correct {
			color: #15803d;
		}
	}

	button.check-btn,
	button.next {
		padding: 0.45rem 0.9rem;
		border-radius: 0.25rem;
		cursor: pointer;
		font-weight: 500;
	}

	button.check-btn {
		background: #f1f5f9;
		border: 1px solid #cbd5e1;
	}

	footer {
		margin-top: auto;
		padding-top: 0.75rem;
		border-top: 1px solid #f1f5f9;
	}

	button.next {
		width: 100%;
		background: #7c3aed;
		border: none;
		color: #ffffff;

		&:hover {
			background: #6d28d9;
		}
	}
</style>
