/**
 * Study telemetry: anonymous Supabase identity + an append-only event stream.
 *
 * Shape deliberately mirrors the Workbench arm's `tutorial_events`
 * (prolific-tutorial-design-spec.md §5) so the two arms union in the analysis:
 * the verbs `step_started` / `step_completed` / `hint_shown` / `check_answered`
 * mean the same thing on both sides.
 *
 * Delivery notes:
 *  - Events are queued and flushed in batches. Every insert is retried, because
 *    a dropped engagement event is a hole in the primary measure.
 *  - Nothing here blocks the UI. If Supabase is unreachable the participant
 *    still completes the study; we lose telemetry, not the session.
 */

import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, TELEMETRY_CONFIGURED } from './env';
import { STUDY_ARM } from './config';
import type { ProlificParams } from './prolific';

export type StudyEventType =
	// shared vocabulary with the Workbench arm's tutorial_events
	| 'step_started'
	| 'step_completed'
	| 'check_answered'
	| 'hint_shown'
	// TE-arm additions
	| 'landed'
	| 'study_begun'
	| 'model_ready'
	| 'prompt_run'
	| 'interaction'
	| 'study_completed';

type QueuedEvent = {
	te_session_id: string;
	user_id: string;
	step_id: string | null;
	event_type: StudyEventType;
	payload: Record<string, unknown>;
	created_at: string;
};

const RESUME_KEY = 'te-study:session:v1';

let client: SupabaseClient | null = null;
let teSessionId: string | null = null;
let userId: string | null = null;

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

export function getTeSessionId(): string | null {
	return teSessionId;
}

function getClient(): SupabaseClient | null {
	if (!TELEMETRY_CONFIGURED) return null;
	if (!client) {
		client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
			auth: { persistSession: true, autoRefreshToken: true, storageKey: 'te-study:auth:v1' }
		});
	}
	return client;
}

/** Survives a refresh so a reload resumes rather than starting a second session. */
function readResume(): { teSessionId: string; unitIdx: number } | null {
	try {
		const raw = localStorage.getItem(RESUME_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (typeof parsed?.teSessionId !== 'string') return null;
		return { teSessionId: parsed.teSessionId, unitIdx: Number(parsed.unitIdx) || 0 };
	} catch {
		return null;
	}
}

export function saveResume(unitIdx: number): void {
	if (!teSessionId) return;
	try {
		localStorage.setItem(RESUME_KEY, JSON.stringify({ teSessionId, unitIdx }));
	} catch {
		/* private mode — resume is best-effort */
	}
}

export function readResumeUnitIdx(): number {
	return readResume()?.unitIdx ?? 0;
}

/**
 * Mints (or restores) the anonymous participant and ensures a `te_sessions`
 * row exists. Mirrors the Workbench arm's join: anonymous Supabase user,
 * Prolific ids attached to the user record and to the row.
 *
 * Unlike Workbench we cannot stamp `app_metadata` — that needs the service-role
 * key, which a static site must never hold — so the ids go in `user_metadata`
 * and `te_sessions` is the authoritative copy.
 *
 * Returns false when telemetry is unconfigured; callers should carry on.
 */
export async function initSession(prolific: ProlificParams | null): Promise<boolean> {
	const sb = getClient();
	if (!sb) return false;

	const metadata = {
		prolific_pid: prolific?.prolificPid ?? null,
		study_id: prolific?.studyId ?? null,
		session_id: prolific?.sessionId ?? null,
		arm: STUDY_ARM
	};

	let session: Session | null = (await sb.auth.getSession()).data.session;
	const resumed = readResume();

	if (!session) {
		const { data, error } = await sb.auth.signInAnonymously({ options: { data: metadata } });
		if (error || !data.session) {
			console.warn('[study] anonymous sign-in failed', error);
			return false;
		}
		session = data.session;
	}

	userId = session.user.id;

	// A restored auth session with a known te_sessions row means this is a
	// refresh, not a new arrival — reuse the row rather than inserting a second.
	if (resumed) {
		teSessionId = resumed.teSessionId;
		return true;
	}

	const id = crypto.randomUUID();
	const { error } = await sb.from('te_sessions').insert({
		id,
		user_id: userId,
		prolific_pid: prolific?.prolificPid ?? null,
		study_id: prolific?.studyId ?? null,
		session_id: prolific?.sessionId ?? null,
		arm: STUDY_ARM,
		user_agent: navigator.userAgent,
		screen_w: window.screen?.width ?? null,
		screen_h: window.screen?.height ?? null
	});

	if (error) {
		// Unique violation on user_id: this user already has a session row from a
		// previous visit whose resume record we lost. Nothing to recover client
		// side (we hold no SELECT grant), so start a fresh identity rather than
		// silently dropping every subsequent event on the floor.
		if (error.code === '23505') {
			await sb.auth.signOut();
			const { data, error: retryErr } = await sb.auth.signInAnonymously({
				options: { data: metadata }
			});
			if (retryErr || !data.session) return false;
			userId = data.session.user.id;
			const retryId = crypto.randomUUID();
			const { error: insertErr } = await sb.from('te_sessions').insert({
				id: retryId,
				user_id: userId,
				prolific_pid: prolific?.prolificPid ?? null,
				study_id: prolific?.studyId ?? null,
				session_id: prolific?.sessionId ?? null,
				arm: STUDY_ARM,
				user_agent: navigator.userAgent,
				screen_w: window.screen?.width ?? null,
				screen_h: window.screen?.height ?? null
			});
			if (insertErr) return false;
			teSessionId = retryId;
			saveResume(0);
			return true;
		}
		console.warn('[study] session insert failed', error);
		return false;
	}

	teSessionId = id;
	saveResume(0);
	return true;
}

export function track(
	eventType: StudyEventType,
	stepId: string | null = null,
	payload: Record<string, unknown> = {}
): void {
	if (!teSessionId || !userId) return;
	queue.push({
		te_session_id: teSessionId,
		user_id: userId,
		step_id: stepId,
		event_type: eventType,
		payload,
		// Stamped client-side so ordering survives batching; the column default
		// would otherwise record flush time, not event time.
		created_at: new Date().toISOString()
	});
	scheduleFlush();
}

function scheduleFlush(): void {
	if (flushTimer) return;
	flushTimer = setTimeout(() => {
		flushTimer = null;
		void flush();
	}, 400);
}

export async function flush(): Promise<void> {
	const sb = getClient();
	if (!sb || flushing || queue.length === 0) return;

	flushing = true;
	const batch = queue;
	queue = [];

	try {
		const { error } = await sb.from('te_events').insert(batch);
		if (error) {
			// Put it back at the front so ordering is preserved, and try again.
			queue = [...batch, ...queue];
			scheduleFlush();
		}
	} catch {
		queue = [...batch, ...queue];
		scheduleFlush();
	} finally {
		flushing = false;
	}
}

/**
 * Best-effort flush when the tab goes away. `visibilitychange` is the reliable
 * signal; `beforeunload` is not fired on mobile and is unreliable elsewhere.
 */
export function installUnloadFlush(): () => void {
	const onHide = () => {
		if (document.visibilityState === 'hidden') void flush();
	};
	document.addEventListener('visibilitychange', onHide);
	return () => document.removeEventListener('visibilitychange', onHide);
}

/**
 * Intercepts Transformer Explainer's own analytics stream.
 *
 * TE already pushes ~30 distinct interaction events to `window.dataLayer`
 * (attention matrix, block transitions, embeddings, softmax, weight popovers,
 * sampling, sliders, textbook navigation). Proxying the array's `push` gives us
 * all of them without touching a single TE component, which is what keeps this
 * fork rebaseable onto upstream.
 *
 * The original `push` is still called, so if a GTM id is ever configured
 * upstream behaviour is unchanged.
 */
export function installDataLayerProxy(getStepId: () => string | null): () => void {
	const w = window as unknown as { dataLayer?: unknown[] };
	const dl = (w.dataLayer = w.dataLayer || []);
	const originalPush = dl.push.bind(dl);

	dl.push = function (...args: unknown[]) {
		for (const arg of args) {
			if (arg && typeof arg === 'object' && 'event' in (arg as Record<string, unknown>)) {
				const { event, ...rest } = arg as Record<string, unknown>;
				if (typeof event === 'string') {
					track('interaction', getStepId(), { te_event: event, ...rest });
				}
			}
		}
		return originalPush(...args);
	} as typeof dl.push;

	return () => {
		dl.push = originalPush;
	};
}

/** Test seam: lets specs assert on a clean queue. */
export function __resetForTests(): void {
	queue = [];
	teSessionId = null;
	userId = null;
	client = null;
}
