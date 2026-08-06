#!/usr/bin/env bash
# Where did the pilot participants drop out, and how slow was the model load?
#
# Usage:
#   SUPABASE_URL=https://yegincrzbgewddgshbbd.supabase.co \
#   SERVICE_ROLE_KEY=<service role key> \
#   ./scripts/dropout-analysis.sh
#
# Reads only. The service-role key is required because participants hold
# INSERT and nothing else (see supabase/migrations/20260804000002).

set -euo pipefail

: "${SUPABASE_URL:?set SUPABASE_URL}"
: "${SERVICE_ROLE_KEY:?set SERVICE_ROLE_KEY}"

fetch() {
	curl -sS "${SUPABASE_URL}/rest/v1/$1" \
		-H "apikey: ${SERVICE_ROLE_KEY}" \
		-H "Authorization: Bearer ${SERVICE_ROLE_KEY}"
}

echo "== funnel =="
fetch "te_events?select=event_type,payload,te_session_id,created_at&order=created_at" \
	> /tmp/te_events.json
fetch "te_sessions?select=id,prolific_pid,started_at" > /tmp/te_sessions.json

python3 - <<'PY'
import json, statistics as st
from collections import defaultdict

events = json.load(open('/tmp/te_events.json'))
sessions = json.load(open('/tmp/te_sessions.json'))

by_session = defaultdict(set)
load_ms = []
for e in events:
    by_session[e['te_session_id']].add(e['event_type'])
    if e['event_type'] == 'model_ready':
        v = (e.get('payload') or {}).get('load_ms')
        if isinstance(v, (int, float)):
            load_ms.append(v / 1000.0)

n = len(sessions)
def count(ev):
    return sum(1 for s in by_session.values() if ev in s)

print(f"sessions (landed):      {n}")
for ev in ('model_ready', 'step_started', 'prompt_run', 'step_completed', 'study_completed'):
    c = count(ev)
    pct = f"{100*c/n:5.1f}%" if n else "  n/a"
    print(f"  reached {ev:<16} {c:>4}  {pct}")

# The number that decides this: landed but never got the model.
stalled = n - count('model_ready')
print(f"\nnever reached model_ready: {stalled}"
      + (f"  ({100*stalled/n:.1f}% of arrivals)" if n else ""))

if load_ms:
    load_ms.sort()
    def pct(p):
        return load_ms[min(int(len(load_ms)*p), len(load_ms)-1)]
    print(f"\nmodel load seconds (only those who SURVIVED — survivorship-biased,"
          f"\nthe dropouts' loads were by definition slower):")
    print(f"  n={len(load_ms)}  min={load_ms[0]:.1f}  p50={st.median(load_ms):.1f}"
          f"  p90={pct(0.9):.1f}  max={load_ms[-1]:.1f}")
else:
    print("\nno model_ready events with load_ms")
PY
