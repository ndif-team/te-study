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

/**
 * Satisfy the scroll gate: most checks start below the fold in TE's small card,
 * and forward navigation is refused until the question has actually been in
 * view. Tests about answering should not have to re-litigate that each time.
 */
async function seeTheCheck(page: Page): Promise<void> {
	const cue = page.getByTestId('scroll-cue');
	if (await cue.isVisible()) {
		await cue.click();
		await expect(cue).toBeHidden();
	}
}

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
		await seeTheCheck(page);

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
		await seeTheCheck(page);

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

		// Get past the scroll gate first: the check starts below the fold, so the
		// first press is spent bringing it into view.
		await seeTheCheck(page);

		// First press after that: intercepted by the nudge. The page must NOT move.
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

		// Skip it: clear the scroll gate, take the nudge, then push past without
		// answering. Three presses rather than two now that the question has to be
		// seen before it can be knowingly declined.
		await seeTheCheck(page);
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

test.describe('finishing from inside the textbook card', () => {
	test('the exit appears in the card on the last page, and not before', async ({ page }) => {
		await page.goto(plainUrl(newPid('fin-show')));
		await beginPlain(page);

		await gotoTextbookPage(page, PAGE_WITH_CHOICE);
		await expect(page.getByTestId('textbook-finish')).toBeHidden();

		const total = Number((await page.locator('.page-counter').innerText()).split('/')[1].trim());
		await gotoTextbookPage(page, total - 1);
		await expect(page.getByTestId('textbook-finish')).toBeVisible();
	});

	test('the forward arrow on the last page does NOT wrap back to page 1', async ({ page }) => {
		/*
		 * TE's navigatePage('next') sets the index to 0 at the end rather than
		 * stopping, so pressing next once more silently restarted the walkthrough.
		 * Because progress is tracked as `furthest`, the exit stayed unlocked — so
		 * the participant was returned to page 1 of a tutorial they had finished,
		 * with no explanation.
		 */
		await page.goto(plainUrl(newPid('fin-nowrap')));
		await beginPlain(page);

		const total = Number((await page.locator('.page-counter').innerText()).split('/')[1].trim());
		await gotoTextbookPage(page, total - 1);
		expect(await currentPageNumber(page)).toBe(total);

		await forwardArrow(page).click();
		await forwardArrow(page).click();

		expect(await currentPageNumber(page), 'the forward arrow wrapped to the start').toBe(total);
		await expect(page.getByTestId('textbook-finish')).toBeVisible();
	});

	test('the in-card exit hands off to Qualtrics and records which surface was used', async ({
		page
	}) => {
		const pid = newPid('fin-handoff');
		await page.goto(plainUrl(pid));
		await beginPlain(page);

		const total = Number((await page.locator('.page-counter').innerText()).split('/')[1].trim());
		await gotoTextbookPage(page, total - 1);
		await page.getByTestId('textbook-finish-button').click();

		const events = await waitForEvents(
			pid,
			(e) => e.some((x) => x.event_type === 'study_completed'),
			'expected study_completed from the in-card exit'
		);
		const done = events.find((e) => e.event_type === 'study_completed')!;
		expect(done.payload.surface).toBe('textbook_card');
		expect(done.payload.via).toBe('textbook_progress');
	});
});

test.describe('scroll cue for a check below the fold', () => {
	test('the cue appears when the check is off-screen and clears once it is seen', async ({
		page
	}) => {
		await page.goto(plainUrl(newPid('cue-show')));
		await beginPlain(page);
		await gotoTextbookPage(page, PAGE_WITH_CHOICE);

		// The card is short enough that the check starts below the fold.
		await expect(page.getByTestId('scroll-cue')).toBeVisible();

		// Pressing the cue scrolls the question into view, which marks it seen.
		await page.getByTestId('scroll-cue').click();
		await expect(page.getByTestId('scroll-cue')).toBeHidden();
	});

	test('the forward arrow is refused until the check has been seen', async ({ page }) => {
		const pid = newPid('cue-gate');
		await page.goto(plainUrl(pid));
		await beginPlain(page);
		await gotoTextbookPage(page, PAGE_WITH_CHOICE);

		const start = await currentPageNumber(page);
		await expect(page.getByTestId('scroll-cue')).toBeVisible();

		// Refused — but the check is scrolled into view rather than just blocked,
		// so the participant is shown the question instead of being stonewalled.
		await forwardArrow(page).click();
		expect(await currentPageNumber(page), 'moved on before the check was seen').toBe(start);
		await expect(page.getByTestId('scroll-cue')).toBeHidden();

		const events = await waitForEvents(
			pid,
			(e) => e.some((x) => x.payload?.reason === 'check_offscreen'),
			'expected the off-screen refusal to be recorded'
		);
		expect(events.find((e) => e.payload?.reason === 'check_offscreen')!.step_id).toBe('blocks');

		// Now seen: the normal nudge-once-then-allow behaviour resumes.
		await forwardArrow(page).click();
		await expect(page.getByTestId('check-nudge')).toBeVisible();
		expect(await currentPageNumber(page)).toBe(start);

		await forwardArrow(page).click();
		await expect.poll(() => currentPageNumber(page)).toBe(start + 1);
	});

	test('a check already in view imposes no gate at all', async ({ page }) => {
		// Enlarging the card brings the whole page into view, so there is nothing
		// to scroll to and nothing should be blocked.
		await page.goto(plainUrl(newPid('cue-tall')));
		await beginPlain(page);
		await gotoTextbookPage(page, PAGE_WITH_CHOICE);

		await page.evaluate(() => {
			// Move the card up as well as growing it. TE docks it near the bottom of
			// the window, so height alone pushes its own navigation footer off-screen
			// and nothing in it can be clicked.
			const container = document.querySelector('.floating-container') as HTMLElement;
			const card = document.querySelector('.text-card') as HTMLElement;
			container.style.top = '80px';
			card.style.height = '700px';
		});

		await expect(page.getByTestId('scroll-cue')).toBeHidden();

		const start = await currentPageNumber(page);
		await forwardArrow(page).click();
		await expect(page.getByTestId('check-nudge')).toBeVisible();
		expect(await currentPageNumber(page)).toBe(start);
		await forwardArrow(page).click();
		await expect.poll(() => currentPageNumber(page)).toBe(start + 1);
	});

	test('the gate yields rather than trapping anyone if "seen" never registers', async ({
		page
	}) => {
		/*
		 * The gate depends on an IntersectionObserver firing against a scroll
		 * container inside a draggable, resizable card. If that ever fails, a
		 * participant would be stuck on one page with no way forward and no
		 * explanation — a far worse outcome than an unseen question, and this arm
		 * has already lost a pilot to a control that would not let people proceed.
		 * Simulated by pinning `seen` to永 false via a broken observer.
		 */
		const pid = newPid('cue-valve');
		await page.addInitScript(() => {
			// Neuter IntersectionObserver so nothing is ever marked seen.
			// @ts-expect-error deliberately replacing the global
			window.IntersectionObserver = class {
				observe() {}
				unobserve() {}
				disconnect() {}
			};
		});
		await page.goto(plainUrl(pid));
		await beginPlain(page);
		await gotoTextbookPage(page, PAGE_WITH_CHOICE);

		const start = await currentPageNumber(page);
		await forwardArrow(page).click();
		expect(await currentPageNumber(page)).toBe(start);
		await forwardArrow(page).click();
		expect(await currentPageNumber(page)).toBe(start);

		// Third press: the valve opens rather than leaving them stranded.
		await forwardArrow(page).click();
		await expect
			.poll(() => currentPageNumber(page), { message: 'participant was trapped on the page' })
			.toBe(start + 1);

		const events = await waitForEvents(
			pid,
			(e) => e.some((x) => x.payload?.reason === 'check_offscreen_override'),
			'the override must be recorded — it means the cue is not working'
		);
		expect(events.some((e) => e.payload?.reason === 'check_offscreen_override')).toBe(true);
	});
});
