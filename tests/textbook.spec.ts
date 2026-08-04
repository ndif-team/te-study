import { test, expect, type Page } from '@playwright/test';
import { newPid, plainUrl, waitForEvents, beginPlain } from './helpers';

/**
 * The DEFAULT participant path.
 *
 * Transformer Explainer ships its own textbook walkthrough, and that is the
 * tutorial Cho et al. evaluated. This arm leaves it alone rather than layering a
 * second tutorial on top, so progression through TE's textbook is both the
 * participant's guide and our engagement measure.
 *
 * The page count is read from TE's own UI rather than imported from
 * `textbookPages.ts` — that module pulls in `~/store`, which only resolves
 * through Vite's alias config and blows up under Playwright's transpiler.
 * Reading it from the rendered counter also means the test follows upstream if
 * a page is ever added.
 */

/** TE renders "3 / 20" in its page counter. */
async function pageTotal(page: Page): Promise<number> {
	const text = await page.locator('.page-counter').innerText();
	const total = Number(text.split('/')[1]?.trim());
	expect(total, `could not read TE's page count from "${text}"`).toBeGreaterThan(1);
	return total;
}

/** Jumps TE's textbook to a page via its own dropdown, as a participant would. */
async function gotoTextbookPage(page: Page, index: number): Promise<void> {
	await page.locator('.page-counter').click();
	await page.locator('.dropdown-item').nth(index).click();
}

test.describe('TE textbook drives the study', () => {
	test('the rail is absent by default — participants get TE as it was evaluated', async ({
		page
	}) => {
		await page.goto(plainUrl(newPid('plain-default')));
		await beginPlain(page);

		// No second tutorial competing with TE's own.
		await expect(page.getByTestId('study-panel')).toBeHidden();
		await expect(page.getByTestId('use-prompt')).toBeHidden();
		await expect(page.getByTestId('study-check')).toBeHidden();

		// TE's own walkthrough is present and is what the progress refers to.
		await expect(page.locator('.page-counter')).toBeVisible();
		const total = await pageTotal(page);
		await expect(page.getByTestId('tutorial-progress')).toContainText(`of ${total}`);
	});

	test('the exit stays locked until TE’s last page is reached', async ({ page }) => {
		await page.goto(plainUrl(newPid('plain-lock')));
		await beginPlain(page);
		const total = await pageTotal(page);

		await expect(page.getByTestId('finish-hint')).toBeVisible();
		await expect(page.getByTestId('finish-study')).toBeHidden();

		// Partway through is still not done.
		await gotoTextbookPage(page, Math.floor(total / 2));
		await expect(page.getByTestId('finish-study')).toBeHidden();

		await gotoTextbookPage(page, total - 1);
		await expect(page.getByTestId('finish-study')).toBeVisible();
		await expect(page.getByTestId('finish-hint')).toBeHidden();
	});

	test('textbook progression is recorded as step events', async ({ page }) => {
		const pid = newPid('plain-progress');
		await page.goto(plainUrl(pid));
		await beginPlain(page);
		const total = await pageTotal(page);

		await gotoTextbookPage(page, 3);
		await gotoTextbookPage(page, total - 1);

		const events = await waitForEvents(
			pid,
			(e) =>
				e.some((x) => x.event_type === 'step_completed' && x.payload.tutorial_complete === true),
			'expected the last textbook page to be recorded as completing the walkthrough'
		);

		const steps = events.filter(
			(e) => e.event_type === 'step_started' && e.payload.surface === 'te_textbook'
		);
		expect(steps.length).toBeGreaterThanOrEqual(2);
		// step_id is TE's own page id (a slug), so the funnel reads without a lookup.
		expect(
			steps.every((s) => typeof s.step_id === 'string' && /^[a-z0-9-]+$/.test(s.step_id!))
		).toBe(true);
		expect(steps.every((s) => s.payload.page_total === total)).toBe(true);
		// Indices are recorded so ordering survives a page rename upstream.
		expect(steps.map((s) => s.payload.page_index)).toContain(total - 1);
	});

	test('paging backwards does not re-lock the exit', async ({ page }) => {
		// `furthest`, not `current` — a participant who scrolls back to re-read
		// something must not lose their way out.
		await page.goto(plainUrl(newPid('plain-back')));
		await beginPlain(page);
		const total = await pageTotal(page);

		await gotoTextbookPage(page, total - 1);
		await expect(page.getByTestId('finish-study')).toBeVisible();

		await gotoTextbookPage(page, 1);
		await expect(page.getByTestId('finish-study')).toBeVisible();
	});

	test('finishing hands off to Qualtrics with the Prolific ids', async ({ page }) => {
		const pid = newPid('plain-finish');
		await page.goto(plainUrl(pid));
		await beginPlain(page);
		const total = await pageTotal(page);

		await gotoTextbookPage(page, total - 1);
		await page.getByTestId('finish-study').click();

		await expect(page.getByTestId('study-complete')).toBeVisible();

		const events = await waitForEvents(
			pid,
			(e) => e.some((x) => x.event_type === 'study_completed'),
			'expected a study_completed event'
		);
		const done = events.find((e) => e.event_type === 'study_completed')!;
		expect(done.payload.via).toBe('textbook_progress');
		expect(done.payload.textbook_total).toBe(total);

		const href = await page.getByTestId('post-survey-link').getAttribute('href');
		const url = new URL(href!);
		expect(url.searchParams.get('PROLIFIC_PID')).toBe(pid);
		expect(url.searchParams.get('STUDY_ID')).toBe('study-e2e');
	});

	test('the landing event records which surface the participant got', async ({ page }) => {
		const pid = newPid('plain-surface');
		await page.goto(plainUrl(pid));
		const events = await waitForEvents(
			pid,
			(e) => e.some((x) => x.event_type === 'landed'),
			'expected a landed event'
		);
		expect(events.find((e) => e.event_type === 'landed')!.payload.activity_rail).toBe(false);

		// A fresh participant, not a resume: without clearing storage the app
		// correctly reuses the existing anonymous identity and session row, and
		// the second PID would never get one.
		await page.evaluate(() => localStorage.clear());
		const withRail = newPid('rail-surface');
		await page.goto(`/?PROLIFIC_PID=${withRail}&rail=1`);
		const railEvents = await waitForEvents(
			withRail,
			(e) => e.some((x) => x.event_type === 'landed'),
			'expected a landed event'
		);
		expect(railEvents.find((e) => e.event_type === 'landed')!.payload.activity_rail).toBe(true);
	});
});
