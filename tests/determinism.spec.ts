import { test, expect } from '@playwright/test';
import { newPid, getEvents, waitForEvents, beginStudy, STUDY_UNITS } from './helpers';

/**
 * Transformer Explainer samples: `predictedToken` is `randomChoice()` over the
 * top-k distribution at temperature 0.8, so the token it displays changes
 * between runs of the same prompt. A `top-token` check graded against that
 * would mark participants wrong at random.
 *
 * Grading uses the rank-0 token instead, which is deterministic. This test is
 * what keeps that true — it caught a real bug where the same prompt returned
 * " Paris" on one run and " London" on the next.
 *
 * Needs the real model (mock mode replays fixed cached data, which would pass
 * trivially and prove nothing).
 */
const enabled = process.env.REAL_MODEL === '1';

test.describe('prediction determinism', () => {
	test.skip(!enabled, 'set REAL_MODEL=1 to run (needs the real model)');
	test.setTimeout(20 * 60 * 1000);

	test('the graded rank-0 token is stable across repeated runs', async ({ page }) => {
		const pid = newPid('determinism');
		await page.goto(`/?PROLIFIC_PID=${pid}`);
		await expect(page.getByTestId('model-loading')).toBeHidden({ timeout: 12 * 60 * 1000 });
		await beginStudy(page);

		const unit = STUDY_UNITS.find((u) => u.prompt)!;
		const RUNS = 4;

		for (let i = 0; i < RUNS; i++) {
			// A fresh page load per run. Clicking "Use this prompt" twice in a row
			// is a no-op: Svelte's `safe_not_equal` does not notify subscribers when
			// a store is set to the same string, so TE never re-runs. Reloading
			// resumes the same te_session (so events accumulate under one PID) while
			// genuinely re-executing the forward pass.
			if (i > 0) {
				await page.reload();
				await expect(page.getByTestId('model-loading')).toBeHidden({ timeout: 5 * 60 * 1000 });
				await beginStudy(page);
			}

			await page.getByTestId('use-prompt').click();
			await waitForEvents(
				pid,
				(events) =>
					events.filter(
						(e) =>
							e.event_type === 'prompt_run' &&
							e.payload.source === undefined &&
							e.payload.prompt === unit.prompt
					).length >=
					i + 1,
				`expected run ${i + 1} to complete`
			);
		}

		const runs = (await getEvents(pid)).filter(
			(e) =>
				e.event_type === 'prompt_run' &&
				e.payload.source === undefined &&
				e.payload.prompt === unit.prompt
		);
		expect(runs.length).toBeGreaterThanOrEqual(RUNS);

		const topTokens = new Set(runs.map((r) => String(r.payload.top_token)));
		const sampledTokens = new Set(runs.map((r) => String(r.payload.sampled_token)));

		console.log('rank-0 tokens across runs :', [...topTokens]);
		console.log('sampled tokens across runs:', [...sampledTokens]);

		expect(
			topTokens.size,
			`rank-0 token varied across runs (${[...topTokens].join(', ')}) — top-token checks are not gradeable`
		).toBe(1);
	});
});
