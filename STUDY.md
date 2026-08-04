# TE control arm — deployment handover

Fork of [poloclub/transformer-explainer](https://github.com/poloclub/transformer-explainer) (MIT) with a study wrapper, for the **Transformer Explainer baseline arm** of the Prolific study.

Everything below is verified locally. Nothing has been pushed, and no hosted service has been touched.

---

## What's here

| Path                                          | What                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/study/config.ts`                         | **Study content. The only file you need to edit to change what participants see.** |
| `src/study/StudyShell.svelte`                 | Orchestrator: identity, telemetry hooks, phase machine                             |
| `src/study/{Gate,StudyPanel,Complete}.svelte` | Intro/desktop gate, the activity rail, the Qualtrics handoff                       |
| `src/study/telemetry.ts`                      | Anonymous Supabase auth + append-only event queue                                  |
| `src/study/prolific.ts`                       | Port of the Workbench arm's param parser, so both arms parse arrivals identically  |
| `supabase/migrations/`                        | `te_sessions` + `te_events` + RLS                                                  |
| `tests/`                                      | 28 E2E specs (mock model) + 2 real-model specs                                     |
| `scripts/check-external-requests.mjs`         | Fails if the app contacts anyone but us                                            |

Changes to upstream TE are deliberately tiny: `+layout.svelte` (mount wrapper, drop Google Tag Manager), `svelte.config.js` (base path), `+page.svelte` (mock-model mode, vendored runtime/tokenizer), `app.html` + `utils/Katex.svelte` + `article/Article.svelte` (vendoring, see below), and a Linux case-sensitivity fix in three `./popovers/` imports that upstream only gets away with on macOS.

The wrapper does **not** patch TE's components. It proxies `window.dataLayer`, which TE already pushes ~30 interaction events to, so upstream stays rebaseable.

---

## Deploy: five steps

### 1. Create the GitHub repo

`ndif-team` is on the Free plan, so **GitHub Pages requires a public repo**.

```bash
cd /home/jon/work/te-study
gh repo create ndif-team/te-study --public --source=. --remote=origin --push
```

The repo carries ~650 MB of ONNX chunks (inherited from upstream), so the first push is slow.

Then: **Settings → Pages → Source: GitHub Actions**.

### 2. Push the schema to Supabase

You already have a project: **`yegincrzbgewddgshbbd`**.

```bash
supabase link --project-ref yegincrzbgewddgshbbd
supabase db push
```

Then in the dashboard, **Authentication → Sign In / Providers → enable Anonymous sign-ins** (off by default; nothing works without it).

Leave hCaptcha off unless you see abuse — the study URL is the only thing gating entry, and Prolific reconciliation is the real control.

### 3. Set repository variables

**Settings → Secrets and variables → Actions → Variables** (variables, not secrets — these are public by design and end up in the bundle either way; see `src/study/env.ts`):

| Variable                         | Value                                      |
| -------------------------------- | ------------------------------------------ |
| `VITE_SUPABASE_URL`              | `https://yegincrzbgewddgshbbd.supabase.co` |
| `VITE_SUPABASE_ANON_KEY`         | anon key from the dashboard                |
| `VITE_QUALTRICS_POST_SURVEY_URL` | the post-survey link                       |
| `BASE_PATH`                      | `/te-study` (or empty for a custom domain) |

The deploy workflow fails loudly if the Supabase or Qualtrics vars are missing, rather than shipping a study that collects nothing.

### 4. Point Qualtrics and Prolific at it

- Study URL: `https://ndif-team.github.io/te-study/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}`
- The wrapper appends `PROLIFIC_PID` / `STUDY_ID` / `SESSION_ID` to the post-survey URL, so Qualtrics can pick them up as embedded data.
- **The completion code lives in Qualtrics**, per the Jul 21 decision. Nothing in this repo holds one.

### 5. Verify before recruiting

```bash
npm ci --legacy-peer-deps
npm run db:start        # local Supabase
npm test                # 17 unit + 28 E2E
```

Then against the deployed URL: open it on a laptop, walk all 7 units, confirm rows land in Supabase.

---

## Reading the data

Participants hold `INSERT` and nothing else, so read with the service-role key:

```sql
select s.prolific_pid, e.step_id, e.event_type, e.payload, e.created_at
from te_events e
join te_sessions s on s.id = e.te_session_id
order by s.prolific_pid, e.created_at;
```

`event_type` uses the **same verbs as the Workbench arm's `tutorial_events`** (`step_started`, `step_completed`, `check_answered`, `hint_shown`) so the arms union in the analysis, plus TE-specific `landed`, `model_ready`, `prompt_run`, `interaction`, `study_completed`.

Join across arms on `prolific_pid` — that is also the Qualtrics key.

---

## Three findings that affect the study, not just the code

### 1. Transformer Explainer samples. It does not decode greedily.

`predictedToken` is `randomChoice()` over the top-k distribution at temperature 0.8 (`src/utils/data.ts`). **The same prompt shows a different token on each run** — measured: `" Paris"`, `" Berlin"`, `" London"` for the Eiffel prompt.

The tutorial spec's premise that embedded checks are auto-scorable _"because greedy decoding makes answers deterministic"_ (§4.7) holds for Patch Lens but **not** for TE. Grading against what TE displays would mark participants wrong at random.

So `top-token` checks are graded against the **rank-0 (highest-probability)** token, which is deterministic, and their wording asks for the _highest-probability_ token — never "what did the model output". `tests/determinism.spec.ts` enforces this. Both values are recorded (`top_token`, `sampled_token`) so the two can be told apart if a participant answers with what they saw.

**This is worth a sentence in the methods section**, since it is a real difference between the arms' check mechanics.

### 2. Upstream TE sends participants' browsers to five third parties

Loading stock TE causes requests to Google Fonts, jsDelivr (ONNX runtime **and** KaTeX), the Hugging Face CDN (tokenizer), and — via a YouTube embed in the article — `youtube.com`, `googleads.g.doubleclick.net` and `static.doubleclick.net`.

All are now vendored into `static/`, except the YouTube embed which is dropped from study builds. `scripts/check-external-requests.mjs` runs in CI and fails the build if any return, so **"participant data goes to our Supabase project and nowhere else" is an enforced claim**, not an aspiration.

Worth telling Gwen: the IRB AI-Systems form describes the _public poloclub tool_. This is a self-hosted fork writing activity to our own database — a changed data flow. Probably a memo-to-file rather than an amendment, but her call, and the answer is now cleaner than it would have been for the public tool.

### 3. Prompt verification — run it, it's cheap now

```bash
# .env: VITE_STUDY_MOCK_MODEL=false
REAL_MODEL=1 npx playwright test tests/real-model.spec.ts
```

Verified 2026-08-04 against the real GPT-2:

| Unit | Prompt                                            | Rank-0 token                                   |
| ---- | ------------------------------------------------- | ---------------------------------------------- |
| u0   | `The Eiffel Tower is in the city of`              | `" Paris"` ✅                                  |
| u1   | `The best football player of all time is`         | `" a"` — mechanically fine, pedagogically dull |
| u2   | `As we discussed earlier, my favourite colour is` | `" the"`                                       |
| u3   | `Paris is in France. Rome is in`                  | `" Italy"` ✅                                  |

**The June concern about `Rome is in` does not reproduce for the full few-shot form** — prepending `Paris is in France.` is what makes it work, which is exactly what the unit teaches. u1 and u2 work but are weak demonstrations; those are Gwen's calls, flagged inline in `config.ts`.

---

## Still open

- **Content is stubbed.** `config.ts` has a working 7-unit structure adapted from `slides/02b-arm-transformer-explainer.md`, but the wording, callouts and check answers need Gwen's pass. It is the only file to edit; `npm run test:unit` enforces the ≤11-word prompt limit and unit-count parity.
- **Unit 4 is deliberately unmatched.** Workbench's u4 is activation patching; TE has no intervention capability. Faking one would destroy the contrast the study exists to measure, so TE's u4 is its deepest architecture unit instead. Say so in the methods section.
- **657 MB model download per first-time participant.** ~33 GB at N≈50 — inside Pages' 100 GB/month soft limit, but a multi-minute wait on a slow connection. The intro screen deliberately covers it and `model_ready.load_ms` is logged so slow-load dropouts are separable from disengagement. If it bites, move `static/model-v2/` to R2 and repoint the chunk base URL.
- **The rail overlays TE at laptop widths.** TE needs 1300px; the rail is 352px. Below ~1650px it covers TE's bottom navigation, so the rail has a collapse control. Worth watching in the team run-through at 1440px.
- **Content-risk owner** (tutorial spec §6, listed as blocking launch) applies to this arm too in units 5–6, though GPT-2 is far less capable than the Workbench arm's model.
- **`user_metadata` is participant-editable.** `te_sessions` is the authoritative copy (insert-only under RLS); reconcile against Prolific's export before analysis.
