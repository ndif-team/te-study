import { test, expect } from '@playwright/test';
import { newPid, studyUrl, waitForEvents, beginStudy } from './helpers';

/**
 * The wrapper deliberately does not patch Transformer Explainer's components.
 * It proxies `window.dataLayer`, which TE already pushes ~30 distinct
 * interaction events to. That is what keeps the fork rebaseable onto upstream —
 * and it is also silently fragile: if upstream ever stops pushing to
 * `dataLayer`, our interaction stream thins out with no error anywhere.
 *
 * These tests are that canary.
 */
test.describe('dataLayer proxy', () => {
	test("TE's own interaction events are captured into te_events", async ({ page }) => {
		const pid = newPid('interaction');
		await page.goto(studyUrl(pid));
		await beginStudy(page);

		// Push through TE's real channel, exactly as its components do.
		await page.evaluate(() => {
			(window as unknown as { dataLayer: unknown[] }).dataLayer.push({
				event: 'click-attention-matrix',
				block_idx: 3
			});
		});

		const events = await waitForEvents(
			pid,
			(e) => e.some((x) => x.event_type === 'interaction'),
			'expected TE dataLayer pushes to be captured'
		);

		const interaction = events.find((e) => e.event_type === 'interaction')!;
		expect(interaction.payload.te_event).toBe('click-attention-matrix');
		expect(interaction.payload.block_idx).toBe(3);
		// Interactions are attributed to whichever unit was on screen.
		expect(interaction.step_id).toBeTruthy();
	});

	test('the original dataLayer.push still runs, so upstream behaviour is intact', async ({
		page
	}) => {
		await page.goto(studyUrl(newPid('interaction-passthrough')));
		await expect(page.getByTestId('study-intro')).toBeVisible();

		const length = await page.evaluate(() => {
			const dl = (window as unknown as { dataLayer: unknown[] }).dataLayer;
			const before = dl.length;
			dl.push({ event: 'probe' });
			return dl.length - before;
		});
		expect(length).toBe(1);
	});

	test('non-event pushes are ignored rather than logged as noise', async ({ page }) => {
		const pid = newPid('interaction-noise');
		await page.goto(studyUrl(pid));
		await beginStudy(page);

		await page.evaluate(() => {
			const dl = (window as unknown as { dataLayer: unknown[] }).dataLayer;
			dl.push({ notAnEvent: true });
			dl.push('a string');
			dl.push({ event: 'real-one' });
		});

		const events = await waitForEvents(
			pid,
			(e) => e.some((x) => x.payload?.te_event === 'real-one'),
			'expected the real event through'
		);
		const interactions = events.filter((e) => e.event_type === 'interaction');
		expect(interactions.every((e) => typeof e.payload.te_event === 'string')).toBe(true);
		expect(interactions.some((e) => e.payload.te_event === 'real-one')).toBe(true);
	});

	test('real TE components still push to dataLayer (upstream contract)', async ({ page }) => {
		// Guards specifically against an upstream refactor that drops the
		// instrumentation. Drives TE's own UI with real clicks — synthetic events
		// are not enough, e.g. TE's Slider only pushes on mouseup.
		const pid = newPid('interaction-real');
		await page.goto(studyUrl(pid));
		await beginStudy(page);

		// The rail overlays TE's bottom navigation at typical laptop widths, so a
		// participant reaching for the textbook controls collapses it first. Do
		// the same here rather than forcing the click past the overlay.
		await page.getByTestId('collapse-panel').click();

		// TE's textbook page dropdown pushes `open-textbook` on selection.
		const counter = page.locator('.page-counter');
		await expect(counter, 'TE should render its textbook page counter').toBeVisible();
		await counter.click();

		const items = page.locator('.dropdown-item');
		await expect(items.first()).toBeVisible();
		await items.nth(2).click();

		const events = await waitForEvents(
			pid,
			(e) => e.some((x) => x.payload?.te_event === 'open-textbook'),
			'TE stopped pushing to dataLayer from its own UI — the wrapper will silently lose interaction telemetry'
		);

		const opened = events.find((e) => e.payload?.te_event === 'open-textbook')!;
		expect(opened.event_type).toBe('interaction');
		expect(opened.payload.open_via).toBe('dropdown');
		expect(opened.payload.page_id).toBeTruthy();
	});
});
