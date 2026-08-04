import { expect, type Page } from '@playwright/test';
import { STUDY_UNITS } from '../src/study/config';

export { STUDY_UNITS };

/**
 * Reads telemetry back with the service-role key. Participants hold INSERT and
 * nothing else, so assertions have to come in over the privileged path — which
 * is also how the real analysis will read this data.
 */
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:56321';
const SERVICE_KEY = process.env.SERVICE_ROLE_KEY ?? '';
export const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';

if (!SERVICE_KEY) {
	throw new Error('SERVICE_ROLE_KEY is required to run the E2E suite (see .env).');
}

export type TeSession = {
	id: string;
	user_id: string;
	prolific_pid: string | null;
	study_id: string | null;
	session_id: string | null;
	arm: string;
	user_agent: string | null;
	screen_w: number | null;
};

export type TeEvent = {
	id: string;
	te_session_id: string;
	user_id: string;
	step_id: string | null;
	event_type: string;
	payload: Record<string, unknown>;
	created_at: string;
};

async function rest<T>(path: string): Promise<T> {
	const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
		headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
	});
	if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
	return (await res.json()) as T;
}

/** A fresh Prolific PID per test so specs never collide in a shared database. */
export function newPid(label: string): string {
	return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export function studyUrl(pid: string, extra: Record<string, string> = {}): string {
	const params = new URLSearchParams({
		PROLIFIC_PID: pid,
		STUDY_ID: 'study-e2e',
		SESSION_ID: 'sess-e2e',
		...extra
	});
	return `/?${params.toString()}`;
}

/**
 * The default participant path: Transformer Explainer with its own textbook and
 * nothing of ours but the gate, the progress bar and the exit.
 */
export const plainUrl = (pid: string) => studyUrl(pid, { rail: '0' });

/**
 * Our 7-unit activity rail, which is OFF by default — TE ships its own
 * walkthrough and that is what it was evaluated with. Specs that exercise the
 * rail have to opt in, so they keep testing it while it stays behind the flag.
 */
export const railUrl = (pid: string) => studyUrl(pid, { rail: '1' });

export async function getSession(pid: string): Promise<TeSession | undefined> {
	const rows = await rest<TeSession[]>(
		`te_sessions?prolific_pid=eq.${encodeURIComponent(pid)}&select=*`
	);
	return rows[0];
}

export async function getEvents(pid: string): Promise<TeEvent[]> {
	const session = await getSession(pid);
	if (!session) return [];
	return rest<TeEvent[]>(
		`te_events?te_session_id=eq.${session.id}&select=*&order=created_at.asc,id.asc`
	);
}

/**
 * Telemetry is batched with a ~400ms debounce, so every assertion on the event
 * stream has to poll rather than read once.
 */
export async function waitForEvents(
	pid: string,
	predicate: (events: TeEvent[]) => boolean,
	message: string,
	timeout = 20_000
): Promise<TeEvent[]> {
	let events: TeEvent[] = [];
	await expect
		.poll(
			async () => {
				events = await getEvents(pid);
				return predicate(events);
			},
			{ message, timeout, intervals: [250, 500, 1000] }
		)
		.toBe(true);
	return events;
}

export const typesOf = (events: TeEvent[]) => events.map((e) => e.event_type);

/** Enters the study on the rail path (opt-in; see railUrl). */
export async function beginStudy(page: Page): Promise<void> {
	await page.getByTestId('begin-study').click();
	await expect(page.getByTestId('study-panel')).toBeVisible();
}

/** Enters the study on the DEFAULT path: plain TE plus the finish bar. */
export async function beginPlain(page: Page): Promise<void> {
	await page.getByTestId('begin-study').click();
	await expect(page.getByTestId('finish-bar')).toBeVisible();
	await expect(page.getByTestId('study-panel')).toBeHidden();
}

/**
 * Answers the check for unit `idx`, then advances.
 *
 * Choice checks are graded against `config.ts`, so `correct` is honoured
 * exactly. Top-token checks are graded against whatever the model actually
 * predicted, which no test can know in advance — so `correct: true` there means
 * "submit something and let the spec assert the grading was self-consistent"
 * (see checks.spec.ts, which reconciles the answer against the recorded
 * `live_top_token`). Deliberately-wrong answers are exact either way.
 */
export async function answerAndAdvance(page: Page, idx: number, correct = true): Promise<void> {
	const unit = STUDY_UNITS[idx];
	if (!unit) throw new Error(`no unit at index ${idx}`);

	if (unit.check.kind === 'choice') {
		const wrongIndex = unit.check.correctIndex === 0 ? 1 : 0;
		const target = correct ? unit.check.correctIndex : wrongIndex;
		await page.getByTestId('study-check').locator('input[type="radio"]').nth(target).check();
	} else {
		await page
			.getByTestId('check-free-input')
			.fill(correct ? 'unknown-token' : 'definitely-not-the-token');
	}

	await page.getByTestId('submit-check').click();
	await expect(page.getByTestId('check-feedback')).toBeVisible();
	await page.getByTestId('next-unit').click();
}

/** Walks every unit from the intro screen through to the completion screen. */
export async function completeAllUnits(page: Page): Promise<void> {
	await beginStudy(page);
	for (let i = 0; i < STUDY_UNITS.length; i++) {
		await expect(page.getByTestId('study-progress')).toHaveText(
			`Step ${i + 1} of ${STUDY_UNITS.length}`
		);
		await answerAndAdvance(page, i);
	}
	await expect(page.getByTestId('study-complete')).toBeVisible();
}
