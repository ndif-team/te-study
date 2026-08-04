/**
 * Build-time configuration. All of these are `VITE_`-prefixed and therefore
 * inlined into the public bundle — that is intentional and safe:
 *
 *  - The Supabase anon key is a public key. This project is standalone (it
 *    holds only TE-arm study data), and its RLS grants `authenticated` INSERT
 *    and nothing else, so a leaked key buys an attacker the ability to write
 *    rows nobody will analyse. See supabase/migrations/*_study.sql.
 *  - There is no Prolific completion code in the bundle; Qualtrics issues it.
 *
 * When Supabase vars are absent the telemetry layer no-ops and the app still
 * runs as plain Transformer Explainer. That keeps the fork usable for local
 * poking without a database, and mirrors how Workbench treats an unset
 * PostHog key.
 */

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

// `import.meta.env` is a Vite construct. The test suites import this module
// directly under Node (for MIN_STUDY_WIDTH and the like), where it is
// undefined — so read through a guarded reference rather than crashing.
const viteEnv: Record<string, unknown> =
	(import.meta as unknown as { env?: Record<string, unknown> }).env ?? {};

export const SUPABASE_URL = str(viteEnv.VITE_SUPABASE_URL);
export const SUPABASE_ANON_KEY = str(viteEnv.VITE_SUPABASE_ANON_KEY);

/** Where the participant is sent after the last unit. Qualtrics shows the code. */
export const QUALTRICS_POST_SURVEY_URL = str(viteEnv.VITE_QUALTRICS_POST_SURVEY_URL);

/**
 * Skips the 657 MB ONNX download and leaves the app on TE's built-in
 * cached-example path (`fakeRunWithCachedData`). Used by the E2E suite; must
 * never be set for a real build.
 */
export const MOCK_MODEL = str(viteEnv.VITE_STUDY_MOCK_MODEL) === 'true';

/**
 * Master switch. When false the study wrapper does not mount at all and this is
 * just Transformer Explainer.
 */
export const STUDY_ENABLED = str(viteEnv.VITE_STUDY_ENABLED) !== 'false';

/**
 * Below this width the study is refused. Transformer Explainer sets its own
 * `minScreenWidth = 1300` in +layout.svelte and lays out horizontally below
 * that, so anything narrower is unusable regardless of our panel.
 */
export const MIN_STUDY_WIDTH = 1300;

export const TELEMETRY_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
