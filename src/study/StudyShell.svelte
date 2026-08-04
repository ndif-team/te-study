<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { isFetchingModel, modelData, tokens, userId, textbookCurrentPage } from '~/store';
	import { textPages } from '~/utils/textbookPages';
	import Gate from './Gate.svelte';
	import StudyPanel from './StudyPanel.svelte';
	import FinishBar from './FinishBar.svelte';
	import Complete from './Complete.svelte';
	import { MIN_STUDY_WIDTH, MOCK_MODEL, STUDY_ENABLED, activityRailEnabled } from './env';
	import { parseProlificFromUrl } from './prolific';
	import {
		phase,
		unitIdx,
		prolificParams,
		telemetryReady,
		currentStepIdNow,
		railActive,
		textbookFurthest,
		textbookTotal,
		textbookStepId
	} from './store';
	import {
		initSession,
		track,
		flush,
		installDataLayerProxy,
		installUnloadFlush,
		readResumeUnitIdx,
		getTeSessionId
	} from './telemetry';

	let cleanups: Array<() => void> = [];

	/**
	 * Records one `prompt_run` per completed forward pass.
	 *
	 * This is an explicit subscription rather than a reactive `$:` block, and the
	 * pairing rule took several attempts to get right — both are worth keeping:
	 *
	 *  - `isModelRunning` going false is NOT the end of a run. TE flips it inside
	 *    a setTimeout that waits for the flow animation, by which time a second
	 *    run may already have overwritten `tokens`.
	 *  - `inputText` is live and changes before the previous run finishes.
	 *  - `tokens` is set at run START (before `await getData()`), `modelData` at
	 *    run END.
	 *  - A `$:` block re-runs whenever any referenced store changes, which emitted
	 *    the same run twice and made every recorded prompt lag one step behind.
	 *    A store subscription fires exactly once per `set`.
	 *
	 * `modelData.logits` identifies a real forward pass: `runModel` assigns a
	 * fresh logits array each time, while `adjustTemperature` reuses it and only
	 * replaces `probabilities`. So comparing identity fires once per run and
	 * never on a temperature or sampling change.
	 */
	function watchModelRuns(): () => void {
		let lastLogits: unknown = null;

		return modelData.subscribe((md) => {
			if (!md || md.logits === lastLogits) return;

			const isFirst = lastLogits === null;
			lastLogits = md.logits;

			// Skip the store's seed value and TE's own boot run on its default
			// prompt — neither is the participant doing anything.
			const activePhase = get(phase);
			if (isFirst || (activePhase !== 'running' && activePhase !== 'complete')) return;

			const ranPrompt = (get(tokens) ?? []).join('');
			track('prompt_run', currentStepIdNow(), {
				prompt: ranPrompt,
				prompt_words: ranPrompt.trim().split(/\s+/).filter(Boolean).length,
				// Deterministic: rank 0 of the probability distribution.
				top_token: md.probabilities?.find((p) => p.rank === 0)?.token ?? null,
				// What TE actually displayed. It samples (randomChoice over top-k at
				// temperature 0.8), so this varies between runs of the same prompt
				// and must never be used for grading.
				sampled_token: md.sampled?.token ?? null
			});
		});
	}

	/**
	 * Follows the participant through Transformer Explainer's OWN 20-page
	 * textbook — the walkthrough the tool was evaluated with, and the one this
	 * arm relies on instead of adding a second tutorial.
	 *
	 * Reads `textbookCurrentPage` rather than the `open-textbook` dataLayer
	 * pushes: the store is the source of truth (the dataLayer events are a
	 * side-effect of only some navigation paths), and `textPages.length` comes
	 * from upstream so the finish line moves if upstream adds a page.
	 */
	function watchTextbook(): () => void {
		textbookTotal.set(textPages.length);
		let furthest = -1;

		return textbookCurrentPage.subscribe((idx) => {
			if (typeof idx !== 'number') return;
			// Always publish position, even when paging backwards, so interactions
			// are attributed to where the participant actually is.
			textbookStepId.set(textPages[idx]?.id ?? null);

			if (idx <= furthest) return;
			furthest = idx;
			textbookFurthest.set(idx);

			const activePhase = get(phase);
			if (activePhase !== 'running') return;

			track('step_started', textPages[idx]?.id ?? `page-${idx}`, {
				surface: 'te_textbook',
				page_index: idx,
				page_total: textPages.length
			});

			if (idx >= textPages.length - 1) {
				track('step_completed', textPages[idx]?.id ?? `page-${idx}`, {
					surface: 'te_textbook',
					tutorial_complete: true
				});
			}
		});
	}

	onMount(() => {
		if (!STUDY_ENABLED) return;

		let cancelled = false;

		(async () => {
			const search = new URL(window.location.href).searchParams;
			const params = parseProlificFromUrl(search);
			prolificParams.set(params);

			const rail = activityRailEnabled(search);
			railActive.set(rail);

			const ok = await initSession(params);
			if (cancelled) return;
			telemetryReady.set(ok);

			// Set TE's own (otherwise unused) identity store so any future upstream
			// instrumentation is already keyed to our participant.
			const sid = getTeSessionId();
			if (sid) userId.set(sid);

			// Proxy TE's ~30 native dataLayer interaction events into our stream.
			cleanups.push(installDataLayerProxy(() => currentStepIdNow()));
			cleanups.push(installUnloadFlush());
			cleanups.push(watchModelRuns());
			cleanups.push(watchTextbook());

			// Resume mid-study rather than restarting on a refresh.
			const resumedIdx = readResumeUnitIdx();
			unitIdx.set(resumedIdx);

			track('landed', null, {
				resumed: resumedIdx > 0,
				has_prolific: Boolean(params),
				mock_model: MOCK_MODEL,
				activity_rail: rail,
				viewport_w: window.innerWidth,
				referrer: document.referrer || null
			});

			if (window.innerWidth < MIN_STUDY_WIDTH) {
				phase.set('blocked');
				track('step_completed', null, { blocked: 'viewport' });
				await flush();
				return;
			}

			phase.set('intro');
		})();

		return () => {
			cancelled = true;
			cleanups.forEach((fn) => fn());
			cleanups = [];
		};
	});

	// --- store-derived events -------------------------------------------------

	// Model readiness. In mock mode there is no download, so this fires immediately
	// and the duration is meaningless — flagged in the payload so analysis can
	// exclude it.
	let modelReadyLogged = false;
	const bootedAt = Date.now();
	$: if (!modelReadyLogged && $phase !== 'booting' && (MOCK_MODEL || !$isFetchingModel)) {
		modelReadyLogged = true;
		track('model_ready', null, { load_ms: Date.now() - bootedAt, mock: MOCK_MODEL });
	}
</script>

{#if STUDY_ENABLED}
	<Gate />
	{#if $phase === 'running'}
		{#if $railActive}
			<StudyPanel />
		{:else}
			<FinishBar />
		{/if}
	{:else if $phase === 'complete'}
		<Complete />
	{/if}
{/if}
