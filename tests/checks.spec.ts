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
	test('a correct choice answer is recorded as correct', async ({ page }) => {
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
		expect(answered.payload.correct).toBe(true);
		expect(answered.payload.kind).toBe('choice');
	});

	test('a wrong answer is recorded but does NOT block progress', async ({ page }) => {
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
		expect(answered.payload.correct).toBe(false);

		const completed = events.find(
			(e) => e.event_type === 'step_completed' && e.step_id === unit.id
		)!;
		expect(completed.payload.check_correct).toBe(false);
	});

	test('a top-token check is graded against the live prediction', async ({ page }) => {
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
		// The grading is auto-scored from the model, so we assert the recorded
		// verdict is self-consistent with the prediction it was scored against
		// rather than hardcoding a token GPT-2 may or may not produce.
		const normalise = (s: string) =>
			String(s ?? '')
				.trim()
				.toLowerCase()
				.replace(/^[^\w]+|[^\w]+$/g, '');
		const expected =
			normalise(answered.payload.answer as string) ===
			normalise(answered.payload.live_top_token as string);
		expect(answered.payload.correct).toBe(expected);
	});
});
