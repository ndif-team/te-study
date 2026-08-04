import { test, expect } from '@playwright/test';
import {
	newPid,
	studyUrl,
	waitForEvents,
	typesOf,
	beginStudy,
	answerAndAdvance,
	completeAllUnits,
	STUDY_UNITS
} from './helpers';

test.describe('unit progression', () => {
	test('emits step_started/step_completed for every unit, in order', async ({ page }) => {
		const pid = newPid('units');
		await page.goto(studyUrl(pid));
		await completeAllUnits(page);

		const events = await waitForEvents(
			pid,
			(e) => typesOf(e).includes('study_completed'),
			'expected the study to complete'
		);

		const started = events.filter((e) => e.event_type === 'step_started').map((e) => e.step_id);
		const completed = events.filter((e) => e.event_type === 'step_completed').map((e) => e.step_id);
		const ids = STUDY_UNITS.map((u) => u.id);

		expect(started).toEqual(ids);
		expect(completed).toEqual(ids);
	});

	test('the panel shows progress and advances one unit at a time', async ({ page }) => {
		const pid = newPid('units-ui');
		await page.goto(studyUrl(pid));
		await beginStudy(page);

		await expect(page.getByTestId('study-progress')).toHaveText(`Step 1 of ${STUDY_UNITS.length}`);
		await expect(page.getByRole('heading', { name: STUDY_UNITS[0].title })).toBeVisible();

		await answerAndAdvance(page, 0);

		await expect(page.getByTestId('study-progress')).toHaveText(`Step 2 of ${STUDY_UNITS.length}`);
		await expect(page.getByRole('heading', { name: STUDY_UNITS[1].title })).toBeVisible();
	});

	test('the rail can be collapsed to uncover the full visualisation', async ({ page }) => {
		// TE lays out horizontally with a 1300px minimum, so the rail floats above
		// it. Participants need a way to see what it covers.
		await page.goto(studyUrl(newPid('units-collapse')));
		await beginStudy(page);

		await page.getByTestId('collapse-panel').click();
		await expect(page.getByTestId('study-panel')).toBeHidden();
		await expect(page.getByTestId('reopen-panel')).toBeVisible();

		await page.getByTestId('reopen-panel').click();
		await expect(page.getByTestId('study-panel')).toBeVisible();
		// Position is preserved across a collapse.
		await expect(page.getByTestId('study-progress')).toHaveText(`Step 1 of ${STUDY_UNITS.length}`);
	});

	test('"Use this prompt" loads the unit prompt into the tool and logs it', async ({ page }) => {
		const pid = newPid('units-prompt');
		await page.goto(studyUrl(pid));
		await beginStudy(page);

		const unit = STUDY_UNITS[0];
		expect(unit.prompt, 'unit 0 is expected to carry a prompt').toBeTruthy();

		await page.getByTestId('use-prompt').click();

		const events = await waitForEvents(
			pid,
			(e) => e.some((x) => x.event_type === 'prompt_run' && x.payload.source === 'unit_prompt'),
			'expected a prompt_run event from the unit prompt button'
		);
		const run = events.find((e) => e.payload.source === 'unit_prompt')!;
		expect(run.step_id).toBe(unit.id);
		expect(run.payload.prompt).toBe(unit.prompt);
	});
});
