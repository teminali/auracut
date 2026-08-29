#!/usr/bin/env python3
"""Capture every editor activity-rail tab from the live app."""

import base64
import os
import time

from kerf_rpc import raw


TABS = ['Media', 'Audio', 'Text', 'Captions', 'Trans', 'VFX', 'Colour', 'Skills', 'AI']
output_dir = '/tmp/kerf-editor-tabs'
os.makedirs(output_dir, exist_ok=True)

for index, label in enumerate(TABS, start=1):
    expression = f"""
    (() => {{
      const button = [...document.querySelectorAll('.editor-rail button')]
        .find((item) => item.getAttribute('aria-label')?.startsWith({label!r}));
      button?.click();
      return Boolean(button);
    }})()
    """
    raw('debug/eval', {'expression': expression})
    time.sleep(0.25)
    payload = raw('debug/capture').get('result', {})
    png = payload.get('pngBase64')
    if not png:
      raise RuntimeError(payload.get('note') or f'No capture for {label}')
    path = os.path.join(output_dir, f'{index:02d}-{label.lower()}.png')
    with open(path, 'wb') as handle:
      handle.write(base64.b64decode(png))
    print(path)
