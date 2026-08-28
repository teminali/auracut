"""
The verification test that makes the skill builder a skill.

    KERF_RPC_PORT=<port> python3 skills/skill-builder/verify.py

WHAT THIS CAN AND CANNOT CHECK
------------------------------
It checks the one property that makes the output a skill rather than a
saved project: that a manifest with no slots is REFUSED, that a manifest
with slots is written where the app can read it back, and that a declared
asset which is not on disk is reported missing rather than passing
quietly.

It cannot check that the slots are the RIGHT ones. Nothing can. That is
the author's judgement, and it is why this skill is an interrogation
rather than a converter — see GUIDE.md.

Every check measures an artifact: a folder on disk, or what `list_skills`
reads back out of it. A tool's own report is not evidence, which is the
rule the whole `tools/` suite is written on.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'tools'))
from kerf_rpc import call, ok  # noqa: E402

results = []
PROBE_ID = 'verify-probe-skill'


def check(label, good, detail):
    print(f"  {'PASS' if good else 'FAIL'}  {label:56s} {detail}")
    results.append({'label': label, 'pass': bool(good)})


def refused(name, args):
    """Call a tool that is expected to throw, and hand back the message."""
    payload = call(name, args)['result']
    if payload.get('success'):
        return None
    return payload.get('error', '')


def cleanup():
    call('delete_skill', {'id': PROBE_ID})   # may not exist; ignore


# ── 1. A skill with no slots is refused ─────────────────────────────
#
# The single most important check here. A manifest with no slots can only
# rebuild the project it came from, and accepting one would make every
# other guarantee in this skill cosmetic.
error = refused('create_skill', {
    'id': PROBE_ID,
    'name': 'Probe',
    'summary': 'Rebuilds exactly one video, which is the mistake.',
    'slots': [],
    'recipe': [{'tool': 'describe_timeline', 'args': {}}],
})
check('a skill with no slots is refused',
      error is not None and 'slot' in error.lower(),
      (error or 'IT WAS ACCEPTED').strip().split('\n')[-1][:90])

# ── 2. An enum slot with no options is refused ──────────────────────
error = refused('create_skill', {
    'id': PROBE_ID,
    'name': 'Probe',
    'summary': 'An enum with no vocabulary.',
    'slots': [{'id': 'look', 'kind': 'enum', 'description': 'Which look.'}],
    'recipe': [{'tool': 'describe_timeline', 'args': {}}],
})
check('an enum slot with no options is refused',
      error is not None and 'option' in error.lower(),
      (error or 'IT WAS ACCEPTED').strip().split('\n')[-1][:90])

# ── 3. A real skill is written, and read back off disk ──────────────
made = ok(call('create_skill', {
    'id': PROBE_ID,
    'name': 'Probe skill',
    'summary': 'A probe, with slots, so it can build something other than itself.',
    'slots': [
        {'id': 'footage', 'kind': 'folder', 'required': True,
         'description': 'The take to build from.'},
        {'id': 'look', 'kind': 'enum', 'options': ['warm', 'cool'],
         'description': 'Which grade.'},
    ],
    'recipe': [{'tool': 'describe_timeline', 'args': {}}],
    'assets': [{'id': 'bed', 'file': 'assets/bed.wav', 'kind': 'audio',
                'description': 'Declared but not yet copied in.'}],
    'guide': '# Probe\n\nWritten by verify.py.\n',
}), 'create')

folder = made['folder']
check('the skill is a real folder on disk',
      os.path.isdir(folder) and os.path.isfile(os.path.join(folder, 'skill.json')),
      folder)

on_disk = {}
if os.path.isfile(os.path.join(folder, 'skill.json')):
    with open(os.path.join(folder, 'skill.json')) as f:
        on_disk = json.load(f)
check('and the manifest on disk holds the slots that were asked for',
      len(on_disk.get('slots', [])) == 2
      and {s['id'] for s in on_disk.get('slots', [])} == {'footage', 'look'},
      f"{len(on_disk.get('slots', []))} slots: "
      f"{', '.join(s['id'] for s in on_disk.get('slots', []))}")

check('the guide is written beside it, for the agent to read',
      os.path.isfile(os.path.join(folder, 'GUIDE.md')),
      'GUIDE.md')

# ── 4. A declared asset that is not there is reported missing ───────
#
# Not a formality. A skill whose material is absent fails at RUN time,
# which is the worst moment to find out; this is what makes a half-built
# skill visible while it is still being built.
listed = ok(call('list_skills', {}), 'list')
mine = next((s for s in listed['built'] if s['id'] == PROBE_ID), None)
check('a declared asset that is not on disk is reported missing',
      mine is not None and 'assets/bed.wav' in (mine or {}).get('assetsMissing', []),
      f"missing: {(mine or {}).get('assetsMissing')}")

# ── 5. Adding the asset copies it in, and clears the report ─────────
with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
    # A real RIFF header, so this is a file and not just bytes.
    tmp.write(b'RIFF$\x00\x00\x00WAVEfmt ' + b'\x00' * 24)
    source = tmp.name

added = ok(call('add_skill_asset', {'skillId': PROBE_ID, 'source': source, 'as': 'bed.wav'}), 'asset')
check('adding an asset copies the file into the skill itself',
      os.path.isfile(os.path.join(folder, 'assets', 'bed.wav')),
      f"{added.get('file')} ({added.get('bytes')} bytes) — copied, not referenced")

listed = ok(call('list_skills', {}), 'list')
mine = next((s for s in listed['built'] if s['id'] == PROBE_ID), None)
check('and the skill then reports nothing missing',
      mine is not None and not mine.get('assetsMissing'),
      f"missing: {(mine or {}).get('assetsMissing')}")

os.unlink(source)

# ── 6. The project can be read the way an author needs it ───────────
seen = ok(call('inspect_project_for_skill', {}), 'inspect')
check('a project can be read as structure and content',
      'assets' in seen and 'tracks' in seen and 'authoringNote' in seen,
      f"{len(seen.get('tracks', []))} tracks, {len(seen.get('assets', []))} assets, "
      f"roles marked: {sum(1 for a in seen.get('assets', []) if a.get('likelyRole'))}")

# ── 7. It says what Kerf cannot do yet, rather than implying it can ──
check('the skill list says there is no runner, rather than implying one',
      'runner' in listed.get('note', '').lower(),
      listed.get('note', 'nothing said')[:80])

cleanup()

passed = sum(1 for r in results if r['pass'])
print(f'\n{passed}/{len(results)} skill-builder checks passed')
if passed != len(results):
    print('failing: ' + ', '.join(r['label'] for r in results if not r['pass']))
    sys.exit(1)
