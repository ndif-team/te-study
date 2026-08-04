/**
 * Prolific study identifiers, appended to the study link as query params when a
 * participant arrives from Prolific — e.g.
 * `/?PROLIFIC_PID=…&STUDY_ID=…&SESSION_ID=…`. Captured onto the participant's
 * `te_sessions` row so their activity can be matched back to the study for
 * later analysis. Every field is optional: we retain whatever Prolific sends
 * and store nothing when it sends none.
 *
 * Ported verbatim in behaviour from the Workbench arm's
 * `workbench/_web/src/lib/prolific.ts` so both arms parse arrivals identically.
 * The only change is the input type: Workbench receives Next.js `searchParams`,
 * this app reads a `URLSearchParams` off `window.location`.
 */
export type ProlificParams = {
	prolificPid?: string;
	studyId?: string;
	sessionId?: string;
};

// Each key is absent, a single value, or repeated.
type RawSearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined => {
	const v = Array.isArray(value) ? value[0] : value;
	const trimmed = v?.trim();
	return trimmed ? trimmed : undefined;
};

/**
 * Pulls Prolific identifiers out of a page's query params. Prolific sends the
 * canonical UPPER_CASE keys; we accept lower_case defensively. Returns null
 * when none are present so callers store nothing rather than an empty object.
 */
export function parseProlificParams(searchParams: RawSearchParams): ProlificParams | null {
	const prolificPid = first(searchParams.PROLIFIC_PID ?? searchParams.prolific_pid);
	const studyId = first(searchParams.STUDY_ID ?? searchParams.study_id);
	const sessionId = first(searchParams.SESSION_ID ?? searchParams.session_id);

	const params: ProlificParams = {};
	if (prolificPid) params.prolificPid = prolificPid;
	if (studyId) params.studyId = studyId;
	if (sessionId) params.sessionId = sessionId;

	return Object.keys(params).length > 0 ? params : null;
}

/**
 * `URLSearchParams` adapter. Collapses repeated keys to an array so the
 * first-value-wins rule above applies unchanged.
 */
export function parseProlificFromUrl(search: URLSearchParams): ProlificParams | null {
	const raw: RawSearchParams = {};
	for (const key of new Set(search.keys())) {
		const all = search.getAll(key);
		raw[key] = all.length > 1 ? all : all[0];
	}
	return parseProlificParams(raw);
}

/**
 * Builds the post-survey handoff URL. The completion code lives in Qualtrics
 * (Jul 21 decision — moved out of the tool), so the tool's only job at the exit
 * is to carry the participant's identifiers across.
 */
export function buildHandoffUrl(base: string, prolific: ProlificParams | null): string {
	if (!base) return '';
	const url = new URL(base);
	if (prolific?.prolificPid) url.searchParams.set('PROLIFIC_PID', prolific.prolificPid);
	if (prolific?.studyId) url.searchParams.set('STUDY_ID', prolific.studyId);
	if (prolific?.sessionId) url.searchParams.set('SESSION_ID', prolific.sessionId);
	return url.toString();
}
