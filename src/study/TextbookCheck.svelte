<script lang="ts">
	import { onDestroy } from 'svelte';
	import { modelData, tokens, predictedToken, temperature } from '~/store';
	import { TEXTBOOK_CHECKS } from './config';
	import { gradeCheck, tokenAtRank } from './checks';
	import { checkAnswers, checkNudges, checkSeen } from './store';
	import { track } from './telemetry';

	/**
	 * One engagement check, rendered inside Transformer Explainer's own textbook
	 * card beneath the page text.
	 *
	 * It lives *inside* TE's card rather than floating beside it because that card
	 * is draggable AND resizable (TextbookCard.svelte), so there is no stable
	 * region of the screen a separate panel could occupy — and at the 1024-1300px
	 * widths we now admit, the page scrolls horizontally underneath it too.
	 * Mounting inside means position, drag, resize and stacking are inherited for
	 * free, and the question sits with the content it is about.
	 */
	export let pageId: string;

	$: check = TEXTBOOK_CHECKS[pageId];
	$: answered = $checkAnswers[pageId];
	$: nudged = Boolean($checkNudges[pageId]);

	let choice: number | null = null;
	let text = '';

	// Reset the working state when the card switches page, otherwise a half-typed
	// answer bleeds from one check into the next.
	$: if (pageId) {
		choice = null;
		text = '';
	}

	/**
	 * Mark the check "seen" once it is actually within the scrolling viewport of
	 * TE's card, so `nudge.ts` knows whether the participant has had a chance to
	 * notice it. Observed against the scroll container rather than the window,
	 * because the check is almost always inside the browser viewport — it is the
	 * card's own overflow that hides it.
	 */
	let el: HTMLDivElement | undefined;
	let questionEl: HTMLParagraphElement | undefined;
	let observer: IntersectionObserver | undefined;

	$: if (questionEl && check && !$checkSeen[pageId]) {
		observer?.disconnect();
		const root = el?.closest('.textbook-content') as HTMLElement | null;
		observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					const id = pageId;
					checkSeen.update((m) => (m[id] ? m : { ...m, [id]: true }));
					observer?.disconnect();
				}
			},
			/*
			 * Watches the QUESTION TEXT, not the check container, and wants most of
			 * it in view.
			 *
			 * Observing the container at a 1% threshold was tried first and was
			 * useless: the container's top border peeking over the fold counted as
			 * "seen", so the cue never appeared on the very pages that need it. The
			 * meaningful bar is whether the participant could read the question.
			 *
			 * Not 1.0, because a question that wraps to more lines than the card can
			 * show could then never be satisfied. The safety valve in nudge.ts is
			 * the backstop for the rest.
			 */
			{ root, threshold: 0.6 }
		);
		observer.observe(questionEl);
	}

	onDestroy(() => observer?.disconnect());

	$: live = { probabilities: $modelData?.probabilities ?? null, tokens: $tokens ?? null };
	$: gradeable = check ? gradeCheck(check, { choice, text }, live) : null;

	const submit = () => {
		if (!check || answered) return;
		const result = gradeCheck(check, { choice, text }, live);
		if (!result) return;

		const answer = check.kind === 'choice' ? check.options[choice!] : text.trim();
		checkAnswers.update((m) => ({ ...m, [pageId]: { answer, correct: result.correct } }));

		track('check_answered', pageId, {
			surface: 'te_textbook',
			kind: check.kind,
			answer,
			correct: result.correct,
			expected: result.expected,
			// Recorded for the live kinds so an answer can be re-graded later if the
			// grading rule turns out to be wrong — the raw model state is otherwise
			// unrecoverable after the fact.
			live_top_token: check.kind === 'top-token' ? tokenAtRank(live, 0) || null : undefined,
			live_rank: check.kind === 'top-token' ? (check.rank ?? 0) : undefined,
			// TE samples, so what it displayed may differ from what was graded. Kept
			// so a participant answering with what they SAW is distinguishable from
			// one who simply got it wrong.
			sampled_token: check.kind === 'top-token' ? ($predictedToken?.token ?? null) : undefined,
			live_token_count: check.kind === 'token-count' ? ($tokens?.length ?? null) : undefined,
			// The temperature check is a manipulation check: this is how we tell
			// someone who moved the slider from someone who guessed.
			temperature_at_answer: $temperature ?? null
		});
	};
</script>

{#if check}
	<div class="st-check" data-testid="textbook-check" data-page={pageId} bind:this={el}>
		<p class="st-q" bind:this={questionEl}>{check.question}</p>

		{#if check.kind === 'choice'}
			<div class="st-options">
				{#each check.options as option, i}
					<label class="st-option" class:st-picked={choice === i}>
						<input
							type="radio"
							name={`check-${pageId}`}
							value={i}
							checked={choice === i}
							disabled={Boolean(answered)}
							on:change={() => (choice = i)}
						/>
						<span>{option}</span>
					</label>
				{/each}
			</div>
		{:else}
			<input
				class="st-text"
				type="text"
				data-testid="check-input"
				placeholder={check.kind === 'token-count' ? 'a number' : 'type the token'}
				bind:value={text}
				disabled={Boolean(answered)}
			/>
		{/if}

		{#if !answered}
			<button
				class="st-submit"
				data-testid="check-submit"
				disabled={!gradeable}
				on:click={submit}
			>
				Answer
			</button>
			{#if !gradeable && (choice !== null || text.trim())}
				<!-- The live kinds cannot be graded until the model has produced
				     something, so say why the button is inert rather than leaving a
				     dead control. -->
				<span class="st-hint" data-testid="check-not-ready">Run the model first.</span>
			{/if}
		{/if}

		{#if answered}
			<p class="st-feedback" class:st-correct={answered.correct} data-testid="check-feedback">
				{answered.correct ? 'Correct.' : 'Noted — not quite, but keep going.'}
			</p>
		{:else if nudged}
			<p class="st-nudge" data-testid="check-nudge">
				Have a go at this one first — or press the arrow again to skip it.
			</p>
		{/if}
	</div>
{/if}

<style lang="scss">
	.st-check {
		margin-top: 0.9rem;
		padding: 0.75rem;
		border-top: 1px solid #e2e8f0;
		font-size: 0.85rem;
		line-height: 1.45;
		/*
		 * Clearing TE's navigation footer is handled by `.text-carousel`'s
		 * padding-bottom in TextbookCard.svelte, so the whole scroll area stops
		 * above the footer rather than each element having to dodge it. This is
		 * just breathing room at the end of the page.
		 */
		margin-bottom: 0.5rem;
	}

	/*
	 * Adding a question makes a page taller than upstream ever made it, and the
	 * card is resizable down to 250px. Without this the controls simply fall off
	 * the bottom with no way to reach them.
	 */
	:global(.carousel-slide.active .textbook-content) {
		overflow-y: auto;
		max-height: 100%;
	}

	/*
	 * All 20 slides are stacked at the same absolute position and hidden with
	 * `opacity: 0`, which still hit-tests — so the topmost inactive slide's text
	 * sits over the active one and swallows every click. Upstream cannot notice
	 * (its slides hold nothing clickable) but our radio buttons are unusable
	 * without this.
	 */
	:global(.carousel-slide:not(.active)) {
		pointer-events: none;
	}

	.st-q {
		font-weight: 600;
		color: #0f172a;
		margin-bottom: 0.5rem;
	}

	.st-options {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.5rem;
	}

	.st-option {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		cursor: pointer;

		&.st-picked {
			color: #6d28d9;
			font-weight: 500;
		}
	}

	.st-text {
		width: 100%;
		padding: 0.35rem 0.5rem;
		border: 1px solid #cbd5e1;
		border-radius: 0.25rem;
		margin-bottom: 0.5rem;
	}

	.st-submit {
		padding: 0.3rem 0.9rem;
		background: #7c3aed;
		color: #fff;
		border: none;
		border-radius: 0.25rem;
		cursor: pointer;
		font-size: 0.8rem;

		&:disabled {
			background: #c4b5fd;
			cursor: default;
		}
	}

	.st-hint {
		margin-left: 0.5rem;
		color: #64748b;
		font-size: 0.78rem;
	}

	.st-feedback {
		margin-top: 0.4rem;
		color: #b45309;

		&.st-correct {
			color: #15803d;
		}
	}

	.st-nudge {
		margin-top: 0.4rem;
		color: #7c3aed;
	}
</style>
