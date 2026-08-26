"""
The tools the audit never got back to, checked against what they claim.

    Kerf must be running.  python3 tools/verify_tools.py

These seven are listed in HANDOVER §3 as "not yet re-verified". Every
previous audit pass found working-looking code that did nothing, so each
check here confirms the OUTCOME — pixels moved, a stack was copied, a
depth of history was undone — rather than that the call returned success.
"""
import sys, os, base64, io
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kerf_rpc import call, ok
import numpy as np
from PIL import Image

DUR = 1200
results = []

def check(label, good, detail):
    print(f"  {'PASS' if good else 'FAIL'}  {label:34s} {detail}")
    results.append(good)

def frame(ms):
    f = ok(call('get_frame_context', {'atMs': int(ms), 'includeImage': True}), 'f')['frame']
    return np.array(Image.open(io.BytesIO(
        base64.b64decode(f['imageDataUrl'].split(',', 1)[1]))).convert('RGB')).astype(float)

def ink_centre(a, thr=40):
    l = 0.299*a[:,:,0] + 0.587*a[:,:,1] + 0.114*a[:,:,2]
    ys, xs = np.nonzero(l > thr)
    if not len(xs): return None
    return float(xs.mean()), float(ys.mean())

def edges(a):
    l = 0.299*a[:,:,0] + 0.587*a[:,:,1] + 0.114*a[:,:,2]
    return float(np.abs(np.diff(l, axis=1)).mean())

def fresh(n=1, kind='rectangle'):
    ok(call('reset_project', {'name': 'toolprobe', 'aspectRatio': '16:9', 'fps': 30,
                              'backgroundColor': '#000000', 'durationMs': DUR}), 'r')
    t = ok(call('add_track', {'type': 'video', 'name': 'T'}), 't')['trackId']
    ids = []
    for i in range(n):
        c = ok(call('add_shape_layer', {'kind': kind, 'trackId': t, 'startTimeMs': 0,
               'durationMs': DUR, 'style': {'fill': '#ffffff', 'strokeWidth': 0}}), 's')['clipId']
        ok(call('patch_clip', {'clipId': c, 'properties': {
            'name': f'Shape {i+1}', 'transform.x': -500 + i * 500, 'transform.y': 0,
            'transform.scaleX': 0.5, 'transform.scaleY': 0.5}}), 'p')
        ids.append(c)
    return t, ids

# ── resolve_target ─────────────────────────────────────────────────
t, ids = fresh(2)
ok(call('select_clips', {'clipIds': [ids[1]]}), 'sel')
r = ok(call('resolve_target', {}), 'resolve_target')
picked = r.get('clipId') or (r.get('primaryTarget') or {}).get('clipId')
check('resolve_target follows selection', picked == ids[1], f'selected {ids[1][-6:]}, resolved {str(picked)[-6:]}')

# ── describe_layer_at_point ────────────────────────────────────────
# Shape 1 sits at x=-500, Shape 2 at x=+500. Canvas centre is (960,540).
hit = ok(call('describe_layer_at_point', {'x': 960 - 500, 'y': 540}), 'hit')
names = [l['name'] for l in hit.get('layers', [])]
check('describe_layer_at_point hits', names[:1] == ['Shape 1'],
      f"point (460,540) -> {hit.get('hits')} hit(s) {names}")
miss = ok(call('describe_layer_at_point', {'x': 40, 'y': 60}), 'miss')
check('describe_layer_at_point misses', miss.get('hits') == 0,
      f"point (40,60) -> {miss.get('hits')} hit(s)")

# ── copy_effects ───────────────────────────────────────────────────
t, ids = fresh(2)
ok(call('add_effect', {'clipId': ids[0], 'effectType': 'glow', 'params': {'radius': 60}}), 'fx')
ok(call('add_effect', {'clipId': ids[0], 'effectType': 'vignette'}), 'fx2')
before = frame(50)
ok(call('copy_effects', {'sourceClipId': ids[0], 'targetClipIds': [ids[1]]}), 'copy')
d = ok(call('describe_timeline'), 'd')
clips = {c['id']: c for tr in d['tracks'] for c in tr['clips']}
n_src = len(clips[ids[0]].get('effects', []))
n_dst = len(clips[ids[1]].get('effects', []))
after = frame(50)
moved = float(np.abs(after - before).mean())
check('copy_effects copies the stack', n_dst == n_src == 2, f'source {n_src} effects -> target {n_dst}')
check('copy_effects changes the picture', moved > 0.2, f'mean abs frame difference {moved:.3f}')

# ── set_motion_path ────────────────────────────────────────────────
t, ids = fresh(1)
# Motion path points are ABSOLUTE canvas coordinates — unlike transform.x/y,
# which are offsets from the centre. The tool says so; it is still the kind
# of difference that costs an afternoon.
ok(call('set_motion_path', {'clipId': ids[0],
                            'points': [{'x': 300, 'y': 180}, {'x': 1600, 'y': 900}]}), 'path')
p0 = ink_centre(frame(30))
p1 = ink_centre(frame(DUR - 60))
ok_move = p0 and p1 and (p1[0] - p0[0] > 150) and (p1[1] - p0[1] > 60)
check('set_motion_path moves the layer', bool(ok_move),
      f'centre {None if not p0 else (round(p0[0]),round(p0[1]))} -> {None if not p1 else (round(p1[0]),round(p1[1]))}')

# ── set_motion_blur ────────────────────────────────────────────────
t, ids = fresh(1)
ok(call('add_keyframes', {'clipId': ids[0], 'property': 'positionX', 'keyframes': [
    {'timeOffsetMs': 0, 'value': -700, 'easing': 'linear'},
    {'timeOffsetMs': DUR, 'value': 700, 'easing': 'linear'}]}), 'kf')
sharp = frame(DUR // 2)
e_sharp = edges(sharp)
ok(call('set_motion_blur', {'clipId': ids[0], 'enabled': True,
                            'samples': 12, 'shutterAngle': 340}), 'mb')
blurred = frame(DUR // 2)
e_blur = edges(blurred)
check('set_motion_blur softens motion', e_blur < e_sharp * 0.85,
      f'horizontal edge energy {e_sharp:.3f} -> {e_blur:.3f}')

# ── undo depth ─────────────────────────────────────────────────────
t, ids = fresh(1)
for x in (100, 200, 300, 400):
    ok(call('patch_clip', {'clipId': ids[0], 'properties': {'transform.x': x}}), 'p')
ok(call('undo', {'steps': 3}), 'undo')
d = ok(call('describe_timeline'), 'd')
clips = {c['id']: c for tr in d['tracks'] for c in tr['clips']}
still_there = ids[0] in clips
check('undo depth 3 leaves the clip', still_there, 'clip survives a 3-step undo')

# ── snapCutsToBeats ────────────────────────────────────────────────
ok(call('reset_project', {'name': 'snapprobe', 'aspectRatio': '16:9', 'fps': 30,
                          'backgroundColor': '#000000', 'durationMs': 12000}), 'r')
bed = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'src', 'assets', 'kerf_film_bed.wav')
a = ok(call('import_media_from_path', {'path': bed, 'name': 'bed'}), 'imp')['assetId']
ta = ok(call('add_track', {'type': 'audio', 'name': 'A'}), 't')['trackId']
music = ok(call('insert_clip', {'assetId': a, 'trackId': ta, 'startTimeMs': 0}), 'i')['clipId']
tv = ok(call('add_track', {'type': 'video', 'name': 'V'}), 't')['trackId']
offsets = [4210, 5310, 6120, 7240]          # deliberately off the beat
made = []
for i, start in enumerate(offsets):
    c = ok(call('add_shape_layer', {'kind': 'rectangle', 'trackId': tv, 'startTimeMs': start,
           'durationMs': 400, 'style': {'fill': '#ffffff', 'strokeWidth': 0}}), 's')['clipId']
    made.append(c)
res = ok(call('detect_beats', {'clipId': music, 'snapCuts': True}), 'snap')
d = ok(call('describe_timeline'), 'd')
beats = sorted(m['timeMs'] if isinstance(m, dict) else m for m in d.get('markers', []))
clips = {c['id']: c for tr in d['tracks'] for c in tr['clips']}
starts = [clips[c]['startMs'] for c in made if c in clips]
dist_before = [min(abs(np.array(beats) - s)) for s in offsets]
dist_after = [min(abs(np.array(beats) - s)) for s in starts]
check('snapCutsToBeats reports snapping', res.get('cutsSnapped', 0) > 0,
      f"cutsSnapped={res.get('cutsSnapped')}")
check('snapCutsToBeats moves the cuts', max(dist_after) < max(dist_before),
      f'worst distance to a beat {max(dist_before)}ms -> {max(dist_after)}ms')

print(f"\n{sum(results)}/{len(results)} previously-unaudited tool checks passed")
