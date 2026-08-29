#!/usr/bin/env python3
"""Capture every inspector view reachable from representative real clips."""

import base64
import os
import time

from kerf_rpc import raw


CASES = [
    (0, ['Text', 'Transform', 'VFX', 'Keys']),
    (4, ['Shape']),
    (86, ['Speed', 'Audio']),
]
output_dir = '/tmp/kerf-inspector-tabs'
os.makedirs(output_dir, exist_ok=True)

sequence = 0
for clip_index, labels in CASES:
    raw('debug/eval', {'expression': f"(document.querySelectorAll('.clip-body')[{clip_index}]?.click(), true)"})
    time.sleep(0.15)
    for label in labels:
        sequence += 1
        click = f"[...document.querySelectorAll('[role=tab]')].find(e => e.textContent.trim().startsWith({label!r}))?.click()"
        raw('debug/eval', {'expression': f"(() => {{ {click}; return true; }})()"})
        time.sleep(0.2)
        payload = raw('debug/capture').get('result', {})
        png = payload.get('pngBase64')
        if not png:
            raise RuntimeError(payload.get('note') or f'No capture for {label}')
        path = os.path.join(output_dir, f'{sequence:02d}-{label.lower()}.png')
        with open(path, 'wb') as handle:
            handle.write(base64.b64decode(png))
        print(path)
