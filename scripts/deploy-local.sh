#!/usr/bin/env bash
#
# Deploy the study to Cloudflare Pages from this machine, doing exactly what
# .github/workflows/deploy-cloudflare.yml does — for when GitHub Actions is
# down or you need a build live now.
#
#   ./scripts/deploy-local.sh              # build, verify, deploy
#   ./scripts/deploy-local.sh --build-only # build and verify, don't upload
#
# Requires:
#   * `gh` logged in (reads the public VITE_* repository *variables*)
#   * Cloudflare auth, either:
#       npx wrangler@3 login
#     or:
#       export CLOUDFLARE_API_TOKEN=...  CLOUDFLARE_ACCOUNT_ID=...
#
# Note this deploys to Cloudflare only. GitHub Pages publishes from an Actions
# artifact and cannot be driven from here, so the standby will fall behind until
# Actions recovers.

set -euo pipefail
cd "$(dirname "$0")/.."

REPO=ndif-team/te-study
PROJECT=te-study
BUILD_ONLY=0
[ "${1:-}" = "--build-only" ] && BUILD_ONLY=1

# --- 1. production config, from the repo variables -------------------------
# These are variables rather than secrets on purpose: they are public by design
# and end up in the bundle either way (see src/study/env.ts).
getvar() { gh api "repos/$REPO/actions/variables/$1" --jq .value; }

echo "==> reading build configuration from $REPO"
VITE_SUPABASE_URL="$(getvar VITE_SUPABASE_URL)"
VITE_SUPABASE_ANON_KEY="$(getvar VITE_SUPABASE_ANON_KEY)"
VITE_QUALTRICS_POST_SURVEY_URL="$(getvar VITE_QUALTRICS_POST_SURVEY_URL)"
export VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY VITE_QUALTRICS_POST_SURVEY_URL
export VITE_STUDY_MOCK_MODEL=false
export VITE_STUDY_ENABLED=true
# Empty: Cloudflare serves at the domain root, unlike the /te-study subpath on
# GitHub Pages. Getting this wrong yields a page that loads and then fails to
# fetch a single model chunk.
export BASE_PATH=''

for v in VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY VITE_QUALTRICS_POST_SURVEY_URL; do
	[ -n "${!v}" ] || { echo "ERROR: $v is empty — the study would collect nothing"; exit 1; }
done
echo "    supabase: $VITE_SUPABASE_URL"

# --- 2. build --------------------------------------------------------------
# .env is moved aside for the build. It points at the LOCAL Supabase stack, and
# a build that silently baked in 127.0.0.1 would look completely normal while
# recording nothing. The trap puts it back even if the build fails.
if [ -f .env ]; then
	trap 'if [ -f .env.deploybak ]; then mv -f .env.deploybak .env; echo "    (.env restored)"; fi' EXIT
	mv .env .env.deploybak
fi

echo "==> building"
rm -rf build
npm run build >/dev/null
echo "    built $(du -sh build | cut -f1) in $(find build -type f | wc -l) files"

# --- 3. the same guards CI runs, plus a localhost check --------------------
echo "==> verifying the bundle"
fail=0
note() { printf '    %-46s %s\n' "$1" "$2"; }

grep -rqF 'VITE_STUDY_MOCK_MODEL:"true"' build/_app \
	&& { note "mock model disabled" "FAIL"; fail=1; } || note "mock model disabled" "ok"
grep -rqF 'VITE_STUDY_MOCK_MODEL:"false"' build/_app \
	|| { note "mock-model flag confirmed present" "FAIL"; fail=1; }

# Matches a local SUPABASE API URL (host:5xxxx) specifically, not any mention of
# localhost. supabase-js embeds `http://localhost:9999` as a gotrue default and
# pushes "localhost"/"127.0.0.1" into a hostname allowlist, so a looser pattern
# fails on every correct build — which is worse than no check, because a guard
# that always cries wolf gets ignored.
grep -rqE '(127\.0\.0\.1|localhost):5[0-9]{4}' build/_app \
	&& { note "no local Supabase baked in" "FAIL"; fail=1; } || note "no local Supabase baked in" "ok"

grep -rqF "$(printf '%s' "$VITE_SUPABASE_URL" | sed 's|https://||')" build/_app \
	&& note "hosted Supabase present" "ok" || { note "hosted Supabase present" "FAIL"; fail=1; }

grep -rqF 'qualtrics.com' build/_app \
	&& note "Qualtrics handoff present" "ok" || { note "Qualtrics handoff present" "FAIL"; fail=1; }

grep -qE '(href|src)="/te-study/' build/index.html \
	&& { note "base path is domain root" "FAIL (built for /te-study)"; fail=1; } \
	|| note "base path is domain root" "ok"

BIG=$(find build -type f -size +25M | head -3)
[ -n "$BIG" ] && { note "no file over Cloudflare's 25 MiB" "FAIL"; echo "$BIG"; fail=1; } \
	|| note "no file over Cloudflare's 25 MiB" "ok"

COUNT=$(find build -type f | wc -l)
[ "$COUNT" -lt 20000 ] && note "under Cloudflare's 20,000 files" "ok ($COUNT)" \
	|| { note "under Cloudflare's 20,000 files" "FAIL ($COUNT)"; fail=1; }

if [ "$fail" -ne 0 ]; then
	echo "==> GUARDS FAILED — not deploying"
	exit 1
fi
echo "==> all guards passed"

if [ "$BUILD_ONLY" -eq 1 ]; then
	echo "==> --build-only: stopping before upload. Output is in build/"
	exit 0
fi

# --- 4. upload -------------------------------------------------------------
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && ! npx --yes wrangler@3 whoami >/dev/null 2>&1; then
	cat <<'MSG'
==> Cloudflare auth missing.

    Either log in interactively:
        npx wrangler@3 login

    or export a token (the same one held as the CLOUDFLARE_API_TOKEN secret,
    scope "Account : Cloudflare Pages : Edit"):
        export CLOUDFLARE_API_TOKEN=...
        export CLOUDFLARE_ACCOUNT_ID=...

    then re-run this script. The build in build/ is already verified, so the
    re-run only repeats the upload.
MSG
	exit 1
fi

echo "==> uploading to Cloudflare Pages ($PROJECT)"
npx --yes wrangler@3 pages deploy build \
	--project-name="$PROJECT" \
	--branch=main \
	--commit-dirty=true

cat <<'MSG'

==> done. Verify before sending anyone at it:

      curl -sS -o /dev/null -w '%{http_code}\n' https://te-study.pages.dev/

    Then open it in a fresh incognito window (the model chunks cache, so a
    normal reload will not show you the first-load experience).
MSG
