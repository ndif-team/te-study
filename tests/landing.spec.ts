import { test, expect } from '@playwright/test';
import { newPid, studyUrl, getSession, waitForEvents, typesOf } from './helpers';

test.describe('landing', () => {
	test('captures Prolific params onto the session row and the anonymous user', async ({ page }) => {
		const pid = newPid('landing');
		await page.goto(studyUrl(pid));
		await expect(page.getByTestId('study-intro')).toBeVisible();

		await waitForEvents(pid, (e) => typesOf(e).includes('landed'), 'expected a landed event');

		const session = await getSession(pid);
		expect(session).toBeDefined();
		expect(session!.prolific_pid).toBe(pid);
		expect(session!.study_id).toBe('study-e2e');
		expect(session!.session_id).toBe('sess-e2e');
		expect(session!.arm).toBe('transformer_explainer');
		expect(session!.user_agent).toBeTruthy();
		expect(session!.screen_w).toBeGreaterThan(0);

		// Mirrors the Workbench arm's dual storage: ids live on the session row
		// AND on the anonymous user. Workbench uses app_metadata (service-role);
		// a static site can only reach user_metadata.
		const admin = await fetch(
			`${process.env.VITE_SUPABASE_URL}/auth/v1/admin/users/${session!.user_id}`,
			{
				headers: {
					apikey: process.env.SERVICE_ROLE_KEY!,
					Authorization: `Bearer ${process.env.SERVICE_ROLE_KEY}`
				}
			}
		).then((r) => r.json());

		expect(admin.is_anonymous).toBe(true);
		expect(admin.user_metadata.prolific_pid).toBe(pid);
		expect(admin.user_metadata.study_id).toBe('study-e2e');
		expect(admin.user_metadata.session_id).toBe('sess-e2e');
	});

	test('lowercase param names are accepted defensively', async ({ page }) => {
		const pid = newPid('landing-lc');
		await page.goto(`/?prolific_pid=${pid}&study_id=lc-study`);
		await waitForEvents(pid, (e) => typesOf(e).includes('landed'), 'expected a landed event');

		const session = await getSession(pid);
		expect(session!.prolific_pid).toBe(pid);
		expect(session!.study_id).toBe('lc-study');
	});

	test('a direct visit with no Prolific params still works', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByTestId('study-intro')).toBeVisible();

		// The session row is created regardless — the study is usable for a pilot
		// run-through without a Prolific link; prolific_pid is simply null.
		const orphans = await fetch(
			`${process.env.VITE_SUPABASE_URL}/rest/v1/te_sessions?prolific_pid=is.null&select=id,arm`,
			{
				headers: {
					apikey: process.env.SERVICE_ROLE_KEY!,
					Authorization: `Bearer ${process.env.SERVICE_ROLE_KEY}`
				}
			}
		).then((r) => r.json());
		expect(orphans.length).toBeGreaterThan(0);

		// And nothing crashed: the tool itself is still interactive.
		await expect(page.getByTestId('begin-study')).toBeEnabled();
	});

	test('records model readiness so slow loads are separable from disengagement', async ({
		page
	}) => {
		const pid = newPid('landing-model');
		await page.goto(studyUrl(pid));

		const events = await waitForEvents(
			pid,
			(e) => typesOf(e).includes('model_ready'),
			'expected a model_ready event'
		);
		const ready = events.find((e) => e.event_type === 'model_ready')!;
		expect(ready.payload.mock).toBe(true);
		expect(typeof ready.payload.load_ms).toBe('number');
	});
});
