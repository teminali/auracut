#!/usr/bin/env python3
"""Capture the live Kerf BrowserWindow to a PNG for visual QA."""

import base64
import sys

from kerf_rpc import raw


output = sys.argv[1] if len(sys.argv) > 1 else '/tmp/kerf-live.png'
payload = raw('debug/capture').get('result', {})
png = payload.get('pngBase64')
if not png:
    raise SystemExit(payload.get('note') or 'No PNG returned')
with open(output, 'wb') as handle:
    handle.write(base64.b64decode(png))
print(output)
print(f"visibility={payload.get('visibility')} stale={payload.get('stale')}")
