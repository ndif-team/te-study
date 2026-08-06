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

/**
 * The pilot turned away viewports of 1097 and 1241 — both ordinary laptops —
 * because MIN_STUDY_WIDTH was copied from TE's CSS `min-width` rather than from
 * any real support floor. These pin the boundary to the widths we actually
 * observed, so a future tightening has to fail a named case rather than
 * silently shrink the eligible pool.
 */
for (const width of [1097, 1241]) {
	test.describe(`observed pilot viewport ${width}`, () => {
		test.use({ viewport: { width, height: 800 } });

		test('is admitted rather than screened out', async ({ page }) => {
			await page.goto(studyUrl(newPid(`gate-${width}`)));
			await expect(page.getByTestId('study-intro')).toBeVisible();
			await expect(page.getByTestId('study-blocked')).toBeHidden();
		});

		test('is warned that the layout will scroll sideways', async ({ page }) => {
			await page.goto(studyUrl(newPid(`gate-narrow-${width}`)));
			await expect(page.getByTestId('narrow-viewport')).toBeVisible();
		});
	});
}

test.describe('a phone-width viewport is still refused', () => {
	test.use({ viewport: { width: 420, height: 900 } });

	test('stays blocked', async ({ page }) => {
		await page.goto(studyUrl(newPid('gate-phone')));
		await expect(page.getByTestId('study-blocked')).toBeVisible();
	});
});

test.describe('a comfortably wide viewport gets no scroll warning', () => {
	test.use({ viewport: { width: 1600, height: 900 } });

	test('shows the intro without the narrow-viewport note', async ({ page }) => {
		await page.goto(studyUrl(newPid('gate-wide')));
		await expect(page.getByTestId('study-intro')).toBeVisible();
		await expect(page.getByTestId('narrow-viewport')).toBeHidden();
	});
});
