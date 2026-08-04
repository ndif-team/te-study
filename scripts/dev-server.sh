#!/usr/bin/env bash
# Start/stop the Vite dev server on a fixed port for local runs and the E2E
# suite. Playwright can also manage this itself via `webServer` in
# playwright.config.ts; this script is for driving it by hand.
#
#   scripts/dev-server.sh start|stop|status
set -euo pipefail

PORT="${STUDY_DEV_PORT:-5199}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDFILE="$ROOT/.dev-server.pid"
LOGFILE="$ROOT/.dev-server.log"

start() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "already running (pid $(cat "$PIDFILE")) on :$PORT"; return 0
  fi
  cd "$ROOT"
  nohup npx vite dev --port "$PORT" --strictPort >"$LOGFILE" 2>&1 &
  echo $! >"$PIDFILE"
  for _ in $(seq 1 90); do
    if curl -sf -o /dev/null "http://127.0.0.1:$PORT/"; then
      echo "dev server up on http://127.0.0.1:$PORT"; return 0
    fi
    sleep 2
  done
  echo "dev server failed to come up; last log lines:" >&2
  tail -30 "$LOGFILE" >&2
  return 1
}

stop() {
  if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
    rm -f "$PIDFILE"
    echo "stopped"
  else
    echo "not running"
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status)
    curl -s -o /dev/null -w "HTTP %{http_code}\n" "http://127.0.0.1:$PORT/" || echo "down" ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
