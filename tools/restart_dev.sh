#!/usr/bin/env bash
# Restart the Vite dev server and reload the live Kerf window.
#
# Editing `tailwind.config.js` does NOT reach the running app: a
# long-lived dev server caches the resolved config, so measurements
# taken after a config change describe the OLD theme while looking
# entirely healthy. Worse, the renderer can come back blank and blame a
# React hook order, which is not the cause. Restarting is the only fix,
# and it has to wait for the port to be genuinely free -- a killed
# server's children hold it briefly, and the relaunch then loses the
# race and the app talks to a corpse.
#
#   tools/restart_dev.sh [vite-port] [rpc-port]
set -euo pipefail

PORT="${1:-5173}"
RPC="${2:-${KERF_RPC_PORT:-3939}}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

pid="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
[ -n "$pid" ] && { echo "stopping dev server $pid on $PORT"; kill $pid 2>/dev/null || true; }

for _ in $(seq 1 60); do
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break
  python3 -c 'import time; time.sleep(0.25)'
done
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT still held; refusing to launch a second server" >&2
  exit 1
fi

nohup npm run dev -- --port "$PORT" --strictPort > "/tmp/kerf-vite-$PORT.log" 2>&1 &
for _ in $(seq 1 80); do
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && break
  python3 -c 'import time; time.sleep(0.25)'
done
lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || { echo "dev server never came up; see /tmp/kerf-vite-$PORT.log" >&2; exit 1; }
echo "dev server listening on $PORT"

KERF_RPC_PORT="$RPC" python3 - <<'PY'
import sys, time
sys.path.insert(0, 'tools')
from kerf_rpc import raw
raw('debug/eval', {'expression': '(location.reload(), true)'})
for _ in range(30):
    time.sleep(0.5)
    try:
        n = raw('debug/eval', {'expression': "document.querySelector('#root')?.children.length || 0"}).get('result')
    except Exception:
        continue
    if n:
        print('renderer back up')
        break
else:
    raise SystemExit('renderer did not come back; check for a blank root')
PY
