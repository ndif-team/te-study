import { test, expect, type Page } from '@playwright/test';
import { newPid, plainUrl, waitForEvents, beginPlain } from './helpers';

/**
 * Engagement checks attached to TE's own textbook pages.
 *
 * Page indices are hard-coded because `textbookPages.ts` cannot be imported
 * here (it pulls in `~/store`, which only resolves through Vite's aliases). The
 * unit test `textbook-checks.test.ts` is what guarantees every configured key
 * matches a real page, so a reordering upstream fails there with a clear
 * message rather than mystifying these.
 */
const PAGE_WITHOUT_CHECK = 0; // what-is-transformer
const PAGE_WITH_CHOICE = 6; // blocks — "how many Transformer blocks?", answer 12

async function gotoTextbookPage(page: Page, index: number): Promise<void> {
	await page.locator('.page-counter').click();
	await page.locator('.dropdown-item').nth(index).click();
}

const forwardArrow = (page: Page) => page.locator('.nav-section.right');
const currentPageNumber = async (page: Page): Promise<number> =>
	Number((await page.locator('.page-counter').innerText()).split('/')[0].trim());

test.describe('textbook engagement checks', () => {
	test('a check appears only on the pages configured to have one', async ({ page }) => {
		await page.goto(plainUrl(newPid('chk-presence')));
		await beginPlain(page);

		await gotoTextbookPage(page, PAGE_WITHOUT_CHECK);
		await expect(page.getByTestId('textbook-check')).toBeHidden();

		await gotoTextbookPage(page, PAGE_WITH_CHOICE);
		await expect(page.getByTestId('textbook-check')).toBeVisible();
	});

	test('answering a choice check records the answer and grades it', async ({ page }) => {
		const pid = newPid('chk-answer');
		await page.goto(plainUrl(pid));
		await beginPlain(page);
		await gotoTextbookPage(page, PAGE_WITH_CHOICE);

		// "12" is the second option and the correct one.
		await page.getByTestId('textbook-check').locator('input[type=radio]').nth(1).check();
		await page.getByTestId('check-submit').click();

		await expect(page.getByTestId('check-feedback')).toContainText(/correct/i);

		const events = await waitForEvents(
			pid,
			(e) => e.some((x) => x.event_type === 'check_answered'),
			'expected a check_answered event from the textbook'
		);
		const answered = events.find((e) => e.event_type === 'check_answered')!;
		expect(answered.step_id).toBe('blocks');
		expect(answered.payload.correct).toBe(true);
		expect(answered.payload.surface).toBe('te_textbook');
	});

	test('a wrong answer is recorded but never blocks', async ({ page }) => {
		const pid = newPid('chk-wrong');
		await page.goto(plainUrl(pid));
		await beginPlain(page);
		await gotoTextbookPage(page, PAGE_WITH_CHOICE);

		await page.getByTestId('textbook-check').locator('input[type=radio]').first().check();
		await page.getByTestId('check-submit').click();
		await expect(page.getByTestId('check-feedback')).toContainText(/not quite/i);

		// Answered, so the arrow goes through first time.
		const before = await currentPageNumber(page);
		await forwardArrow(page).click();
		await expect
			.poll(() => currentPageNumber(page), { message: 'a wrong answer must not block' })
			.toBe(before + 1);
	});

	test('the forward arrow nudges once on an unanswered check, then lets them past', async ({
		page
	}) => {
		const pid = newPid('chk-nudge');
		await page.goto(plainUrl(pid));
		await beginPlain(page);
		await gotoTextbookPage(page, PAGE_WITH_CHOICE);

		const startPage = await currentPageNumber(page);
		await expect(page.getByTestId('check-nudge')).toBeHidden();

		// First press: intercepted. The page must NOT move.
		await forwardArrow(page).click();
		await expect(page.getByTestId('check-nudge')).toBeVisible();
		expect(await currentPageNumber(page)).toBe(startPage);

		// Second press: goes through. Answering is encouraged, never required —
		// a hard gate here is what drives Prolific dropout.
		await forwardArrow(page).click();
		await expect
			.poll(() => currentPageNumber(page), { message: 'the second press must be allowed' })
			.toBe(startPage + 1);

		const events = await waitForEvents(
			pid,
			(e) => e.some((x) => x.event_type === 'hint_shown'),
			'expected the nudge to be recorded'
		);
		const hint = events.find((e) => e.event_type === 'hint_shown')!;
		expect(hint.step_id).toBe('blocks');
		expect(hint.payload.reason).toBe('unanswered_check');
	});

	test('leaving a check page records whether it was answered or skipped', async ({ page }) => {
		const pid = newPid('chk-skip');
		await page.goto(plainUrl(pid));
		await beginPlain(page);
		await gotoTextbookPage(page, PAGE_WITH_CHOICE);

		// Skip it: nudge, then push past without answering.
		await forwardArrow(page).click();
		await forwardArrow(page).click();

		const events = await waitForEvents(
			pid,
			(e) => e.some((x) => x.event_type === 'step_completed' && x.step_id === 'blocks'),
			'expected the skipped check page to be closed out'
		);
		const done = events.find(
			(e) => e.event_type === 'step_completed' && e.step_id === 'blocks'
		)!;
		expect(done.payload.answered_check).toBe(false);
		expect(done.payload.nudged).toBe(true);
		expect(done.payload.check_correct).toBeNull();
	});

	test('the check area never sits underneath TE’s nav footer', async ({ page }) => {
		/*
		 * The bug this pins: `.text-carousel` reserved 2rem of bottom padding while
		 * `.navigation-footer` is absolutely positioned over the card at ~51px with
		 * z-index 10. The last ~17px of scrollable content therefore sat UNDER the
		 * footer, and the Answer button falls in the footer's LEFT half — so
		 * pressing it fired `navigatePage('prev')`, jumping back a page and
		 * silently discarding the answer.
		 *
		 * Asserted geometrically rather than by clicking, because the click path
		 * depends on scroll position: Playwright's auto-scroll happened to place
		 * the button clear of the footer, which is exactly why the other tests in
		 * this file passed while the bug was live.
		 */
		await page.goto(plainUrl(newPid('chk-geometry')));
		await beginPlain(page);
		await gotoTextbookPage(page, PAGE_WITH_CHOICE);

		const box = await page.evaluate(() => {
			const content = document.querySelector(
				'.carousel-slide.active .textbook-content'
			) as HTMLElement;
			const footer = document.querySelector('.navigation-footer') as HTMLElement;
			return {
				contentBottom: content.getBoundingClientRect().bottom,
				footerTop: footer.getBoundingClientRect().top
			};
		});

		expect(
			box.contentBottom,
			`scrollable content ends at ${box.contentBottom} but the nav footer starts at ` +
				`${box.footerTop} — content under the footer is unclickable and pages backwards`
		).toBeLessThanOrEqual(box.footerTop);
	});

	test('pressing Answer submits rather than paging backwards', async ({ page }) => {
		// The functional half of the above: scroll the check fully into reach, as a
		// participant would, then press Answer and confirm the page held still.
		await page.goto(plainUrl(newPid('chk-noback')));
		await beginPlain(page);
		await gotoTextbookPage(page, PAGE_WITH_CHOICE);

		await page.getByTestId('textbook-check').locator('input[type=radio]').first().check();
		await page.evaluate(() => {
			const content = document.querySelector(
				'.carousel-slide.active .textbook-content'
			) as HTMLElement;
			content.scrollTop = content.scrollHeight;
		});

		const before = await currentPageNumber(page);
		await page.getByTestId('check-submit').click();

		await expect(page.getByTestId('check-feedback')).toBeVisible();
		expect(await currentPageNumber(page), 'answering moved the textbook page').toBe(before);
	});

	test('pages without a check are not closed out, so counts stay meaningful', async ({ page }) => {
		const pid = newPid('chk-nocount');
		await page.goto(plainUrl(pid));
		await beginPlain(page);

		// Walk the first few pages, which include check-less ones.
		await gotoTextbookPage(page, 0);
		await gotoTextbookPage(page, 1);
		await gotoTextbookPage(page, 2);
		await gotoTextbookPage(page, 3);

		const events = await waitForEvents(
			pid,
			(e) => e.some((x) => x.event_type === 'step_started' && x.step_id === 'embedding'),
			'expected to reach the embedding page'
		);
		// `what-is-transformer` and `transformer-architecture` carry no check, so
		// they must not emit step_completed — otherwise it just duplicates
		// step_started and the "completed" count stops meaning anything.
		const spurious = events.filter(
			(e) =>
				e.event_type === 'step_completed' &&
				['what-is-transformer', 'transformer-architecture'].includes(String(e.step_id))
		);
		expect(spurious, 'check-less pages should not emit step_completed').toHaveLength(0);
	});
});
