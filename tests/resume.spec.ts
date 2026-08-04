import { test, expect } from '@playwright/test';
import {
	newPid,
	railUrl,
	getSession,
	getEvents,
	waitForEvents,
	beginStudy,
	answerAndAdvance,
	STUDY_UNITS
} from './helpers';

test.describe('resume', () => {
	test('a mid-study reload resumes the same session at the same unit', async ({ page }) => {
		const pid = newPid('resume');
		await page.goto(railUrl(pid));
		await beginStudy(page);

		await answerAndAdvance(page, 0);
		await answerAndAdvance(page, 1);
		await expect(page.getByTestId('study-progress')).toHaveText(`Step 3 of ${STUDY_UNITS.length}`);

		await waitForEvents(
			pid,
			(e) => e.filter((x) => x.event_type === 'step_started').length === 3,
			'expected three step_started events before reload'
		);
		const before = await getSession(pid);

		await page.reload();

		// Straight back to the intro gate, but resuming — not restarting.
		await expect(page.getByTestId('study-intro')).toBeVisible();
		await page.getByTestId('begin-study').click();
		await expect(page.getByTestId('study-progress')).toHaveText(`Step 3 of ${STUDY_UNITS.length}`);

		// Same te_sessions row: no duplicate participant.
		const after = await getSession(pid);
		expect(after!.id).toBe(before!.id);
		expect(after!.user_id).toBe(before!.user_id);

		const events = await getEvents(pid);
		const sessionIds = new Set(events.map((e) => e.te_session_id));
		expect(sessionIds.size).toBe(1);

		// The resumed landing is marked, so analysis can tell a reload from an arrival.
		const landings = events.filter((e) => e.event_type === 'landed');
		expect(landings.length).toBe(2);
		expect(landings[0].payload.resumed).toBe(false);
		expect(landings[1].payload.resumed).toBe(true);
	});

	test('resuming does not duplicate step_started for units already begun', async ({ page }) => {
		const pid = newPid('resume-dup');
		await page.goto(railUrl(pid));
		await beginStudy(page);
		await answerAndAdvance(page, 0);

		await waitForEvents(
			pid,
			(e) => e.filter((x) => x.event_type === 'step_started').length === 2,
			'expected two step_started events'
		);

		await page.reload();
		await page.getByTestId('begin-study').click();
		await expect(page.getByTestId('study-progress')).toHaveText(`Step 2 of ${STUDY_UNITS.length}`);

		const events = await getEvents(pid);
		const startedForUnit0 = events.filter(
			(e) => e.event_type === 'step_started' && e.step_id === STUDY_UNITS[0].id
		);
		// Unit 0 was started once and is not restarted by the resume.
		expect(startedForUnit0.length).toBe(1);
	});
});
