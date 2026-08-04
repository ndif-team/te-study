import { test, expect } from '@playwright/test';
import { newPid, studyUrl, waitForEvents, typesOf } from './helpers';
import { MIN_STUDY_WIDTH } from '../src/study/env';

test.describe('desktop-only gate', () => {
	test.use({ viewport: { width: 800, height: 900 } });

	test('a narrow viewport is refused before the study starts', async ({ page }) => {
		const pid = newPid('gate');
		await page.goto(studyUrl(pid));

		await expect(page.getByTestId('study-blocked')).toBeVisible();
		await expect(page.getByTestId('study-panel')).toBeHidden();
		await expect(page.getByTestId('begin-study')).toBeHidden();

		// Participants are told to return the study rather than burn a slot.
		await expect(page.getByTestId('study-blocked')).toContainText(/return the study/i);
	});

	test('the refusal is still recorded, so screened-out arrivals are countable', async ({
		page
	}) => {
		const pid = newPid('gate-log');
		await page.goto(studyUrl(pid));
		await expect(page.getByTestId('study-blocked')).toBeVisible();

		const events = await waitForEvents(
			pid,
			(e) => typesOf(e).includes('landed'),
			'expected the blocked arrival to still be logged'
		);
		const landed = events.find((e) => e.event_type === 'landed')!;
		expect(landed.payload.viewport_w).toBeLessThan(MIN_STUDY_WIDTH);

		const blocked = events.find((e) => e.payload?.blocked === 'viewport');
		expect(blocked, 'expected an explicit viewport-blocked event').toBeDefined();
	});
});

test.describe('wide viewport', () => {
	test.use({ viewport: { width: 1440, height: 900 } });

	test('a desktop viewport reaches the intro', async ({ page }) => {
		await page.goto(studyUrl(newPid('gate-ok')));
		await expect(page.getByTestId('study-intro')).toBeVisible();
		await expect(page.getByTestId('study-blocked')).toBeHidden();
	});
});
