# TE control arm — deployment handover

Fork of [poloclub/transformer-explainer](https://github.com/poloclub/transformer-explainer) (MIT) with a study wrapper, for the **Transformer Explainer baseline arm** of the Prolific study.

Everything below is verified locally. Nothing has been pushed, and no hosted service has been touched.

---

## What's here

| Path                                          | What                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/study/config.ts`                         | **Study content. The only file you need to edit to change what participants see.** |
| `src/study/TextbookCheck.svelte`              | The check UI, rendered inside TE's own textbook card                               |
| `src/study/checks.ts`                         | Grading rules (rank-0/rank-N tokens, token counts), unit-tested without a browser  |
| `src/study/nudge.ts`                          | Nudge-once-then-allow guard on TE's forward arrow                                  |
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

Cloudflare additionally needs two real **secrets** (not variables — the token can
create and overwrite Pages projects on the account), plus a variable to turn the
workflow on:

```bash
gh secret set CLOUDFLARE_API_TOKEN  --repo ndif-team/te-study   # scope: Account : Cloudflare Pages : Edit
gh secret set CLOUDFLARE_ACCOUNT_ID --repo ndif-team/te-study
gh variable set CLOUDFLARE_ENABLED  --repo ndif-team/te-study --body true
```

You do **not** need to create the Pages project by hand — the workflow creates
`te-study` if it is missing and skips if it is not. The two secrets are the only
manual step.

### 4. Point Qualtrics and Prolific at it

- Study URL: `https://te-study.pages.dev/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}`
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

## Hosting: two independent copies

Both deploy from `main` on every push, from the same build definition.

| | URL | Base path | Role |
|---|---|---|---|
| **Cloudflare Pages** | `https://te-study.pages.dev/` | `''` (domain root) | **Primary — this is the URL in Prolific** |
| **GitHub Pages** | `https://ndif-team.github.io/te-study/` | `/te-study` | Warm standby |

Cloudflare is primary because GitHub Pages has a 100 GB/month soft bandwidth
limit and each first-time participant pulls ~657 MB of model weights. At N≈50
that is ~33 GB — fine in isolation, but a pilot plus a re-run plus curious
colleagues eats the margin, and "GitHub throttled us" is a bad thing to discover
halfway through recruitment. Cloudflare does not meter static bandwidth.

Cloudflare deploys by **direct upload** (`wrangler pages deploy`), not the Git
integration, which would clone ~600 MB of model chunks on every build.

**Check the standby is current before you rely on it.** `actions/deploy-pages`
has a hard 10-minute ceiling that cannot be raised (larger values are silently
clamped), and the ~688 MB artifact sometimes exceeds it — twice on 2026-08-06,
having built and uploaded cleanly, after publishing fine the day before. On
timeout the action *cancels* the deployment, so Pages silently keeps serving the
**previous** build. A green Cloudflare run therefore does not imply the standby
matches it. `gh run list --workflow=deploy-pages.yml` is the check.

### Switching to the standby

Change the URL in the Prolific study. Nothing else moves — both hosts talk to
the same Supabase project and the same Qualtrics survey.

**One caveat, and it matters mid-study:** resume state (`localStorage`) and the
anonymous Supabase session are both scoped per origin. A participant who has
already started on `te-study.pages.dev` and is then sent to
`ndif-team.github.io` will get a **fresh anonymous user and a second
`te_sessions` row**, and will restart the walkthrough. So switch between waves,
not during one — and if you must switch mid-wave, expect duplicate sessions for
the same `prolific_pid` and take the earliest per participant in analysis.

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

## Engagement checks on TE's textbook

Nine of TE's twenty pages carry a question, defined in `TEXTBOOK_CHECKS` in
`config.ts` (**stub wording — needs Gwen's pass**, like `STUDY_UNITS`). They are
the TE-arm counterpart to Patch Lens's per-block checks.

| Page | Asks | Graded against |
|---|---|---|
| `how-transformers-work` | most likely next token | live rank 0 |
| `embedding` | how many tokens their text is | live `tokens.length` |
| `blocks` | how many blocks | fixed (12) |
| `multi-head` | how many heads | fixed (12) |
| `masked-self-attention` | can the first token see the last | fixed (no) |
| `output-logit` | what a higher logit means | fixed |
| `output-probabilities` | **second** most likely token | live rank 1 |
| `temperature` | effect of lowering it | fixed, + records live `temperature` |
| `sampling` | is top-k=1 repeatable | fixed (yes) |

Three are graded against live model state, so they cannot be answered from the
page text — those are the real engagement evidence. The `temperature` one is a
manipulation check: the live slider value is recorded with the answer, so
someone who moved it is distinguishable from someone who guessed.

**Answering is nudged, never required.** The first press of TE's forward arrow
on an unanswered check is swallowed and a prompt appears; the second press goes
through. Gating on checks is what drives Prolific dropout, and this arm has
already lost one pilot to a blocking control.

**Analysis:** `check_answered` carries `correct`, `expected`, and for the live
kinds the raw model state it was graded against, so answers can be re-graded if
a grading rule turns out to be wrong. `step_completed` is emitted **only for the
nine pages with checks**, carrying `answered_check` / `check_correct` / `nudged`
— nudged-but-never-answered is a deliberate skip. The other eleven pages emit
`step_started` only, so a "completed" count means something.

**The determinism rule is enforced, not just documented.** A unit test rejects
question wording that asks what the model "said" or "output" — TE samples, so
that has no stable answer and would mark participants wrong at random. Ask what
it *ranks most likely* instead.

### Two upstream latent bugs this surfaced

Both were harmless until a textbook page contained something clickable:

- **Inactive slides intercept clicks.** All 20 slides sit at the same absolute
  position, hidden with `opacity: 0` — which still hit-tests. The topmost
  inactive slide's text swallowed every click meant for the active one. Fixed
  with `pointer-events: none` on inactive slides.
- **The nav footer overlays the card.** It is `position: absolute; bottom: 0` at
  3rem, while `.text-carousel` reserves only 2rem of padding. Upstream's pages
  end in prose so the 1rem overlap never mattered; ours end in a button.

Checks are also rendered only for the active slide, for the same stacking
reason. If you add a check to a page, none of this needs redoing.

---

## Pilot post-mortem: two self-inflicted screens (fixed 2026-08-06)

The first pilot lost a large share of arrivals before `model_ready` ever fired. Both causes were in the wrapper, not in TE.

**1. Begin was disabled until all 627 MB arrived.** Participants sat on a dead button for minutes. Upstream TE is built for exactly this wait and we were suppressing all of it: `runModelOrCache` renders full, real visualisations from five bundled examples while weights stream; `InputForm` disables only the *custom text* box and captions it "Try the examples while GPT-2 model is being downloaded (600MB)"; textbook page 2 says "If the model isn't ready yet, try another Example" and points at the example selector; and choosing an example during the fetch *completes that textbook page*, so study progress genuinely advances mid-download.

Begin is now always enabled. The custom-prompt hazard this originally guarded against — typing your own prompt during the fetch would display a *different* prompt's data, because `fakeRunWithCachedData` overwrites `tokens` — is already handled upstream, since the text input is disabled and only the curated examples (whose cached data matches) are reachable.

**2. `MIN_STUDY_WIDTH` was 1300, and rejected real laptops.** The pilot turned away viewports of 1097 and 1241. TE's 1300 is a CSS `min-width` on `#app`, not a support floor — narrower windows scroll horizontally rather than break, and upstream pins the topbar with `translateX(-scrollLeft)` precisely to support that. TE's actual "you cannot use this" signal, `isMobile`, is user-agent based and never consults width.

Now 1024, with a one-line heads-up about sideways scrolling shown between 1024 and 1300. `tests/gate.spec.ts` pins both observed pilot widths as must-admit cases. Note 1100 would *not* have been sufficient — it still rejects 1097 by three pixels.

**Both bear on the writeup:** that pilot dropout is an artefact of this wrapper, not a property of Transformer Explainer, and must not be reported as an arm difference. `scripts/dropout-analysis.sh` prints the funnel and the load-time distribution; run it again after the next wave to confirm the fix. `study_begun.model_loading` is the direct measure — it records whether each participant started before the weights landed.

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
- **627 MB model download per first-time participant.** ~31 GB at N≈50 — inside Pages' 100 GB/month soft limit, but a multi-minute wait on a slow connection. Participants are no longer held behind it (see below); `model_ready.load_ms` and `study_begun.model_loading` are logged so slow loads stay separable from disengagement. If it still bites, the next levers are a bounded-concurrency streaming rewrite of `fetchChunks` (see below), then fp16 weights, then moving `static/model-v2/` to R2.
- **The rail overlays TE at laptop widths.** TE needs 1300px; the rail is 352px. Below ~1650px it covers TE's bottom navigation, so the rail has a collapse control. The rail is off by default, so this only matters if `?rail=1` is used. Worth watching in the team run-through at 1440px.
- **`fetchChunks` has no progress data and fetches all 63 chunks at once.** `isFetchingModel` is a boolean, and `Promise.all` + `response.arrayBuffer()` means there is no byte-level progress; per-chunk completions also cluster at the end, so a naive n/63 bar would sit near zero and then jump. A real progress bar needs `response.body.getReader()` with concurrency capped around 6 — which would likely shorten the download too, since 63 parallel streams mostly compete with each other. Not done.
- **Content-risk owner** (tutorial spec §6, listed as blocking launch) applies to this arm too in units 5–6, though GPT-2 is far less capable than the Workbench arm's model.
- **`user_metadata` is participant-editable.** `te_sessions` is the authoritative copy (insert-only under RLS); reconcile against Prolific's export before analysis.
