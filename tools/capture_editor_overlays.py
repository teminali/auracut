#!/usr/bin/env python3
"""Capture the editor's principal overlays from the live app."""

import base64
import os
import time

from kerf_rpc import raw


CASES = [
    ('commands', "[...document.querySelectorAll('button')].find(b => b.textContent.includes('Commands'))?.click()"),
    ('shortcuts', "[...document.querySelectorAll('button')].find(b => b.title.startsWith('Keyboard shortcuts'))?.click()"),
    ('mcp', "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'MCP')?.click()"),
    ('export', "[...document.querySelectorAll('button')].find(b => b.textContent.includes('Export'))?.click()"),
    ('recorder', "[...document.querySelectorAll('button')].find(b => b.title === 'Record the screen')?.click()"),
    ('player', "[...document.querySelectorAll('button')].find(b => b.title === 'Play fullscreen')?.click()"),
]

output_dir = '/tmp/kerf-editor-overlays'
os.makedirs(output_dir, exist_ok=True)

for index, (name, action) in enumerate(CASES, start=1):
    raw('debug/eval', {'expression': f"(() => {{ {action}; return true; }})()"})
    time.sleep(0.4)
    payload = raw('debug/capture').get('result', {})
    png = payload.get('pngBase64')
    if not png:
        raise RuntimeError(payload.get('note') or f'No capture for {name}')
    path = os.path.join(output_dir, f'{index:02d}-{name}.png')
    with open(path, 'wb') as handle:
        handle.write(base64.b64decode(png))
    print(path)
    raw('debug/eval', {'expression': "(() => { document.querySelector('.scrim')?.click(); document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); return true; })()"})
    time.sleep(0.25)
