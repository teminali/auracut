#!/usr/bin/env python3
"""List the real inspector tab set reached by each visible clip."""

import time

from kerf_rpc import raw


count = raw('debug/eval', {'expression': "document.querySelectorAll('.clip-body').length"}).get('result', 0)
seen = set()
for index in range(count):
    raw('debug/eval', {'expression': f"(document.querySelectorAll('.clip-body')[{index}]?.click(), true)"})
    time.sleep(0.04)
    tabs = raw('debug/eval', {'expression': "[...document.querySelectorAll('[role=tab]')].map(e=>e.textContent.trim().replace(/\\d+$/, ''))"}).get('result', [])
    signature = tuple(tabs)
    if signature and signature not in seen:
        seen.add(signature)
        print(index, ' | '.join(tabs))
