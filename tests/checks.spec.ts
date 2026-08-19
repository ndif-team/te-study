import { test, expect } from '@playwright/test';
import {
	newPid,
	railUrl,
	waitForEvents,
	beginStudy,
	answerAndAdvance,
	STUDY_UNITS
} from './helpers';

const firstChoiceIdx = STUDY_UNITS.findIndex((u) => u.check.kind === 'choice');
const firstTopTokenIdx = STUDY_UNITS.findIndex((u) => u.check.kind === 'top-token');

test.describe('embedded checks', () => {
	test('a choice answer is recorded with the key it will be scored against', async ({ page }) => {
		expect(firstChoiceIdx, 'config must contain at least one choice check').toBeGreaterThan(-1);

		const pid = newPid('check-right');
		await page.goto(railUrl(pid));
		await beginStudy(page);
		for (let i = 0; i < firstChoiceIdx; i++) await answerAndAdvance(page, i);

		const unit = STUDY_UNITS[firstChoiceIdx];
		await answerAndAdvance(page, firstChoiceIdx, true);

		const events = await waitForEvents(
			pid,
			(e) => e.some((x) => x.event_type === 'check_answered' && x.step_id === unit.id),
			'expected a check_answered event'
		);
		const answered = events.find(
			(e) => e.event_type === 'check_answered' && e.step_id === unit.id
		)!;
		// The app forms no verdict. It records what was chosen and what analysis
		// will score it against, and nothing else.
		expect(answered.payload.correct).toBeUndefined();
		expect(answered.payload.kind).toBe('choice');
		expect(answered.payload.answer).toBe(unit.check.options[unit.check.correctIndex]);
		expect(answered.payload.expected).toBe(unit.check.options[unit.check.correctIndex]);
	});

	test('an off-key answer is recorded but does NOT block progress', async ({ page }) => {
		// Gating on checks drives Prolific dropout — the tutorial spec (§4.7)
		// requires these to be log-only. This is the test that keeps that true.
		expect(firstChoiceIdx).toBeGreaterThan(-1);

		const pid = newPid('check-wrong');
		await page.goto(railUrl(pid));
		await beginStudy(page);
		for (let i = 0; i < firstChoiceIdx; i++) await answerAndAdvance(page, i);

		const unit = STUDY_UNITS[firstChoiceIdx];
		await answerAndAdvance(page, firstChoiceIdx, false);

		// We advanced despite being wrong.
		await expect(page.getByTestId('study-progress')).toHaveText(
			`Step ${firstChoiceIdx + 2} of ${STUDY_UNITS.length}`
		);

		// Wait for BOTH events, not just check_answered. Telemetry flushes on a
		// 400ms debounce, and the gap between answering and advancing is wide
		// enough on a slow runner for the flush to fire in between — so the two
		// events land in different batches. Polling for one and then asserting on
		// the other passed locally and failed on CI, which is the signature of a
		// wait condition that does not cover the assertion.
		const events = await waitForEvents(
			pid,
			(e) =>
				e.some((x) => x.event_type === 'check_answered' && x.step_id === unit.id) &&
				e.some((x) => x.event_type === 'step_completed' && x.step_id === unit.id),
			'expected both check_answered and step_completed for this unit'
		);

		const answered = events.find(
			(e) => e.event_type === 'check_answered' && e.step_id === unit.id
		)!;
		// Recorded verbatim, and diverging from the key, but never judged here.
		expect(answered.payload.answer).not.toBe(answered.payload.expected);
		expect(answered.payload.correct).toBeUndefined();

		const completed = events.find(
			(e) => e.event_type === 'step_completed' && e.step_id === unit.id
		)!;
		expect(completed.payload.answered_check).toBe(true);
		expect(completed.payload.check_correct).toBeUndefined();
	});

	test('a top-token check records the live prediction, and no verdict', async ({ page }) => {
		expect(firstTopTokenIdx, 'config must contain at least one top-token check').toBeGreaterThan(
			-1
		);

		const pid = newPid('check-token');
		await page.goto(railUrl(pid));
		await beginStudy(page);
		for (let i = 0; i < firstTopTokenIdx; i++) await answerAndAdvance(page, i);

		const unit = STUDY_UNITS[firstTopTokenIdx];
		await answerAndAdvance(page, firstTopTokenIdx, true);

		const events = await waitForEvents(
			pid,
			(e) => e.some((x) => x.event_type === 'check_answered' && x.step_id === unit.id),
			'expected a check_answered event'
		);
		const answered = events.find(
			(e) => e.event_type === 'check_answered' && e.step_id === unit.id
		)!;

		expect(answered.payload.kind).toBe('top-token');
		expect(answered.payload.correct).toBeUndefined();
		// What analysis needs to score this later: the deterministic rank-0 token,
		// not the sampled one TE happened to animate. Asserted as a non-empty
		// recording rather than a specific token, which GPT-2 may or may not
		// produce on any given run.
		expect(answered.payload.expected).toBeTruthy();
		expect(answered.payload.expected).toBe(answered.payload.live_top_token);
		expect(answered.payload).toHaveProperty('sampled_token');
	});
});
