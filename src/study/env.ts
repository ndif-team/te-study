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
 * Our own 7-unit activity rail. OFF by default, deliberately.
 *
 * Transformer Explainer ships its own 20-page textbook walkthrough, and that is
 * what Cho et al. evaluated. Layering a second tutorial on top would make this
 * arm "TE plus our scaffolding" rather than the published baseline the study is
 * leveraging — and would present participants with two competing tutorials.
 *
 * The rail is kept (built and tested) behind this flag in case the arm-parity
 * argument in prolific-tutorial-design-spec.md §6 wins out later.
 *
 * Overridable per-visit with `?rail=1` / `?rail=0` so the two paths can be
 * piloted and tested against a single build.
 */
const railDefault = str(viteEnv.VITE_STUDY_ACTIVITY_RAIL) === 'true';

export function activityRailEnabled(search?: URLSearchParams): boolean {
	const override = search?.get('rail');
	if (override === '1' || override === 'true') return true;
	if (override === '0' || override === 'false') return false;
	return railDefault;
}

/**
 * Below this width the study is refused.
 *
 * This was 1300, copied from Transformer Explainer's own `minScreenWidth` in
 * +layout.svelte on the assumption that anything narrower was unusable. That
 * assumption was wrong, and it cost us real participants — the pilot turned
 * away viewports of 1241 and 1097, both ordinary laptops.
 *
 * TE's 1300 is a CSS `min-width` on `#app`, not a support floor. A narrower
 * viewport does not break the layout; it scrolls horizontally. Upstream clearly
 * intends that: `+layout.svelte` pins the topbar with
 * `transform: translateX(-scrollLeft)` precisely so the header survives that
 * scroll, and `isMobile` — TE's actual "you cannot use this" signal — is
 * user-agent based and never consults width at all.
 *
 * So the gate should reject phones and slivers, not laptops. 1024 is the
 * conventional tablet-landscape/small-laptop breakpoint and clears the 1097
 * case with room to spare.
 *
 * Note 1100 would NOT have been enough: it still rejects a 1097 viewport by
 * three pixels. Reported window widths are already shy of the nominal screen
 * (scrollbars, OS chrome, zoom), so a threshold set just under an observed
 * value will keep clipping people.
 */
export const MIN_STUDY_WIDTH = 1024;

/**
 * Between MIN_STUDY_WIDTH and TE's own 1300 the tool works but scrolls
 * sideways. Participants get told that once, up front, rather than quietly
 * discovering that part of the visualisation is off-screen.
 */
export const TE_COMFORTABLE_WIDTH = 1300;

export const TELEMETRY_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
