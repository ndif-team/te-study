import { test, expect } from '@playwright/test';
import {
	STUDY_UNITS,
	newPid,
	railUrl,
	getEvents,
	waitForEvents,
	answerAndAdvance
} from './helpers';

/**
 * Runs the core-path prompts through the REAL GPT-2 and reports what it
 * actually predicts.
 *
 * The workshop deck has carried "live-verify every prompt in the actual tool the
 * week before — GPT-2 in Transformer Explainer is brittle" as an open item since
 * June, when `Rome is in` turned out not to predict " Italy". Every
 * `expectedTopToken` in config.ts is a guess until this run says otherwise.
 *
 * The top token is read back out of our own telemetry rather than scraped from
 * the page: TE renders the prediction into d3-managed SVG with no stable hook,
 * whereas `prompt_run.payload.top_token` is written from the `predictedToken`
 * store by the same code path that grades a participant's answer. Reading the
 * same value the grader uses is what makes this verification meaningful.
 *
 * Excluded from the default suite because it downloads ~650 MB. Run it against
 * a real-model dev server or build:
 *
 *   # .env: VITE_STUDY_MOCK_MODEL=false
 *   REAL_MODEL=1 npx playwright test tests/real-model.spec.ts
 */
const enabled = process.env.REAL_MODEL === '1';

test.describe('real GPT-2 prompt verification', () => {
	test.skip(!enabled, 'set REAL_MODEL=1 to run (downloads ~650 MB)');
	test.setTimeout(20 * 60 * 1000);

	test('reports the actual top token for every core-path prompt', async ({ page }) => {
		const prompts = STUDY_UNITS.map((u, i) => ({ unit: u, index: i })).filter(
			({ unit }) => unit.prompt
		);
		const rows: Array<Record<string, string>> = [];

		/*
		 * One prompt per fresh page load, rather than walking all seven units in a
		 * single session.
		 *
		 * Transformer Explainer has no guard against concurrent forward passes:
		 * `runModel` awaits tokenization and then inference, and a second run
		 * started in between simply loses. A script clicking through units is fast
		 * enough to trigger that (the second prompt's run vanished entirely and the
		 * first was recorded twice); a participant reading the task text never is.
		 * Reloading between prompts sidesteps it without pretending the product has
		 * a bug it does not have in real use.
		 */
		for (const { unit, index } of prompts) {
			const pid = newPid(`real-model-u${index}`);
			await page.goto(railUrl(pid));
			await page.evaluate(() => localStorage.clear());
			await page.goto(railUrl(pid));

			await expect(page.getByTestId('model-loading')).toBeHidden({ timeout: 12 * 60 * 1000 });
			await page.getByTestId('begin-study').click();
			await expect(page.getByTestId('study-panel')).toBeVisible();

			// Advance to the target unit WITHOUT running any prompt, so the only
			// forward pass in this session is the one we are measuring.
			for (let i = 0; i < index; i++) {
				await answerAndAdvance(page, i);
			}

			await page.getByTestId('use-prompt').click();
			await waitForEvents(
				pid,
				(events) =>
					events.some(
						(e) =>
							e.event_type === 'prompt_run' &&
							e.payload.source === undefined &&
							e.payload.prompt === unit.prompt
					),
				`expected a completed run for "${unit.prompt}"`,
				120_000
			);

			const run = (await getEvents(pid))
				.filter(
					(e) =>
						e.event_type === 'prompt_run' &&
						e.payload.source === undefined &&
						e.payload.prompt === unit.prompt
				)
				.pop();

			rows.push({
				unit: unit.id,
				words: String(unit.prompt!.trim().split(/\s+/).length),
				prompt: unit.prompt!,
				expected:
					unit.check.kind === 'top-token' ? (unit.check.expectedTopToken ?? '(unset)') : '—',
				actual: JSON.stringify(run?.payload.top_token ?? null),
				sampled: JSON.stringify(run?.payload.sampled_token ?? null)
			});
		}

		console.log('\n=== Real GPT-2 prompt verification — review with Gwen ===');
		console.table(rows);

		// Every prompt must have actually produced a prediction, or the run told
		// us nothing.
		for (const r of rows) {
			expect(r.actual, `"${r.unit}" produced no prediction`).not.toBe('null');
			expect(
				Number(r.words),
				`"${r.unit}" prompt is ${r.words} words; TE blocks at 12`
			).toBeLessThanOrEqual(11);
		}

		const mismatches = rows.filter(
			(r) => r.expected !== '—' && JSON.stringify(r.expected) !== r.actual
		);
		if (mismatches.length) {
			console.warn(
				'\nPrompts whose real top token differs from config.ts expectedTopToken:\n' +
					mismatches.map((m) => `  ${m.unit}: expected ${m.expected}, got ${m.actual}`).join('\n') +
					'\nThese are content decisions for Gwen, not test failures.'
			);
		}
	});
});
