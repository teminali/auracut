"""
Project format versioning, exercised through the running app.

    Kerf must be running.  python3 tools/verify_project_format.py

`version` was written into every project file and read by NOTHING. Two
failures hid behind that, and only one of them is obvious:

  - an old file loaded as though it were current, which mostly worked
    because `createClip` backfills added fields — but that covers new
    fields, not changed meanings;
  - a file from a NEWER Kerf also loaded, silently, was interpreted by
    older code, and would be saved back with whatever it did not
    understand dropped.

The interesting cases cannot be produced by this build, so they are
constructed on disk and opened with `open_project`.
"""
import json, os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kerf_rpc import call

TMP = tempfile.mkdtemp(prefix='kerf-fmt-')

BASE = {
    'format': 'kerf.project',
    'savedAt': 0,
    'project': {'id': 't', 'name': 'Format probe', 'aspectRatio': '16:9',
                'width': 1920, 'height': 1080, 'fps': 30, 'durationMs': 4000,
                'backgroundColor': '#101010', 'createdAt': 0, 'updatedAt': 0},
    'tracks': [{'id': 'tr1', 'name': 'V1', 'type': 'video', 'index': 0, 'clips': [],
                'muted': False, 'locked': False, 'solo': False, 'volume': 1,
                'heightPx': 72, 'collapsed': False}],
    'markers': [],
    'mediaPool': [],
}

def write(name, obj):
    p = os.path.join(TMP, f'{name}.json')
    open(p, 'w').write(json.dumps(obj))
    return p

CASES = [
    ('current format 2',   {**BASE, 'version': 2},                          'open',    None),
    ('legacy format 1',    {**BASE, 'version': 1},                          'migrate', 1),
    ('no version field',   dict(BASE),                                      'migrate', 1),
    ('from the future',    {**BASE, 'version': 99},                         'refuse',  None),
    ('not a Kerf file',    {**BASE, 'format': 'other.thing', 'version': 2},  'refuse',  None),
    ('missing tracks',     {k: v for k, v in {**BASE, 'version': 2}.items() if k != 'tracks'},
                                                                            'refuse',  None),
]

results = []
for label, obj, expect, from_v in CASES:
    path = write(label.replace(' ', '_'), obj)
    r = call('open_project', {'path': path})['result']
    if expect == 'refuse':
        good = not r.get('success')
        detail = (r.get('error') or '')[:78]
    else:
        good = bool(r.get('success'))
        data = r.get('data', {}) if good else {}
        got = data.get('migratedFromFormat')
        if expect == 'migrate':
            good = good and got == from_v
            detail = f"opened, migratedFromFormat={got} (want {from_v})"
        else:
            good = good and got is None
            detail = f"opened, no migration (migratedFromFormat={got})"
    print(f"  {'PASS' if good else 'FAIL'}  {label:20s} {detail}")
    results.append(good)

print(f"\n{sum(results)}/{len(results)} project-format checks passed")
