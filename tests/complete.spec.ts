import { test, expect } from '@playwright/test';
import { newPid, studyUrl, waitForEvents, typesOf, completeAllUnits } from './helpers';

test.describe('completion and handoff', () => {
	test('finishing the last unit logs study_completed and offers the post-survey', async ({
		page
	}) => {
		const pid = newPid('complete');
		await page.goto(studyUrl(pid));
		await completeAllUnits(page);

		await waitForEvents(
			pid,
			(e) => typesOf(e).includes('study_completed'),
			'expected a study_completed event'
		);

		await expect(page.getByTestId('study-complete')).toBeVisible();
		await expect(page.getByTestId('flush-state')).toHaveText(/saved/i);
	});

	test('the handoff URL carries the Prolific identifiers to Qualtrics', async ({ page }) => {
		const pid = newPid('handoff');
		await page.goto(studyUrl(pid));
		await completeAllUnits(page);

		const href = await page.getByTestId('post-survey-link').getAttribute('href');
		expect(href).toBeTruthy();

		const url = new URL(href!);
		expect(url.searchParams.get('PROLIFIC_PID')).toBe(pid);
		expect(url.searchParams.get('STUDY_ID')).toBe('study-e2e');
		expect(url.searchParams.get('SESSION_ID')).toBe('sess-e2e');

		// The completion code is Qualtrics' job (Jul 21 decision). Nothing that
		// looks like one should be reachable from the built client.
		const body = await page.content();
		expect(body).not.toMatch(/completion\s*code\s*[:=]\s*\w{6,}/i);
	});
});
