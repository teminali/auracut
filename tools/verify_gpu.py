"""
The GPU stage, proved on pixels.

    Kerf must be running.  python3 tools/verify_gpu.py

`shaders.ts` was ninety lines of GLSL that nothing imported, and
`chromaKey` was five properties in the EDL, five rows in
`propertyPath.ts`, and zero references in the compositor. So these checks
are all of the form "put a known colour on screen, turn the feature on,
and confirm the picture changed the way it must" — an assertion against
the store would have passed the whole time.
"""
import sys, os, base64, io
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kerf_rpc import call, ok
import numpy as np
from PIL import Image

DUR = 1000

def frame(ms):
    f = ok(call('get_frame_context', {'atMs': int(ms), 'includeImage': True}), 'frame')['frame']
    b = base64.b64decode(f['imageDataUrl'].split(',', 1)[1])
    return np.array(Image.open(io.BytesIO(b)).convert('RGB')).astype(float)

def scene_greenscreen():
    """A green plate over a red ground — keying the green must reveal red."""
    ok(call('reset_project', {'name': 'gpuprobe', 'aspectRatio': '16:9', 'fps': 30,
                              'backgroundColor': '#000000', 'durationMs': DUR}), 'reset')
    t = ok(call('add_track', {'type': 'video', 'name': 'G'}), 't')['trackId']
    back = ok(call('add_shape_layer', {'kind': 'rectangle', 'trackId': t, 'startTimeMs': 0,
              'durationMs': DUR, 'style': {'fill': '#c81e1e', 'strokeWidth': 0}}), 'b')['clipId']
    ok(call('patch_clip', {'clipId': back, 'properties': {
        'name': 'Red ground', 'transform.scaleX': 4.2, 'transform.scaleY': 2.4}}), 'p')
    # A later clip on the same track paints on top.
    plate = ok(call('add_shape_layer', {'kind': 'rectangle', 'trackId': t, 'startTimeMs': 0,
               'durationMs': DUR, 'style': {'fill': '#00d200', 'strokeWidth': 0}}), 'g')['clipId']
    ok(call('patch_clip', {'clipId': plate, 'properties': {
        'name': 'Green plate', 'transform.scaleX': 2.6, 'transform.scaleY': 1.6}}), 'p')
    return back, plate

def scene_spill():
    """A subject carrying screen bounce, sitting ON the green plate.

    Spill lives in the pixels that SURVIVE the key, so a scene made only
    of pure key colour cannot show it — the first version of this check
    used one and measured a flat zero."""
    back, plate = scene_greenscreen()
    t = ok(call('describe_timeline'), 'd')['tracks'][0]['id']
    subj = ok(call('add_shape_layer', {'kind': 'ellipse', 'trackId': t, 'startTimeMs': 0,
              'durationMs': DUR, 'style': {'fill': '#6ba06b', 'strokeWidth': 0}}), 's')['clipId']
    ok(call('patch_clip', {'clipId': subj, 'properties': {
        'name': 'Subject', 'transform.scaleX': 1.1, 'transform.scaleY': 1.1}}), 'p')
    return back, plate, subj

def channels(a):
    return a[:, :, 0].mean(), a[:, :, 1].mean(), a[:, :, 2].mean()

def check(label, before, after, rule, detail):
    good = rule(before, after)
    print(f"  {'PASS' if good else 'FAIL'}  {label:28s} {detail}")
    return good

results = []

# ── 1 · chroma key removes the keyed colour ────────────────────────
back, plate = scene_greenscreen()
b = frame(50)
ok(call('patch_clip', {'clipId': plate, 'properties': {
    'chromaKey.enabled': True, 'chromaKey.targetColorHex': '#00d200',
    'chromaKey.similarity': 28, 'chromaKey.smoothness': 12, 'chromaKey.spill': 40}}), 'key')
a = frame(50)
rb, gb, bb = channels(b)
ra, ga, ba = channels(a)
print(f"\nchroma key    before  R{rb:6.1f} G{gb:6.1f} B{bb:6.1f}")
print(f"              after   R{ra:6.1f} G{ga:6.1f} B{ba:6.1f}")
results.append(check('chroma_key removes green', b, a,
                     lambda x, y: gb - ga > 30, f"green {gb:.1f} -> {ga:.1f}  (need a drop > 30)"))
results.append(check('chroma_key reveals ground', b, a,
                     lambda x, y: ra - rb > 20, f"red   {rb:.1f} -> {ra:.1f}  (need a rise > 20)"))

# ── 2 · turning it off restores the frame exactly ──────────────────
ok(call('patch_clip', {'clipId': plate, 'properties': {'chromaKey.enabled': False}}), 'off')
c = frame(50)
delta = float(np.abs(c - b).mean())
results.append(check('disabling restores', b, c, lambda x, y: delta < 1.0,
                     f"mean abs difference from the original {delta:.3f}  (need < 1.0)"))

# ── 3 · despill pulls the key channel out of what SURVIVES the key ──
back, plate, subj = scene_spill()
ok(call('patch_clip', {'clipId': subj, 'properties': {
    'chromaKey.enabled': True, 'chromaKey.targetColorHex': '#00d200',
    'chromaKey.similarity': 28, 'chromaKey.smoothness': 12, 'chromaKey.spill': 0}}), 'sp0')
s0 = frame(50)
g0 = channels(s0)[1]
ok(call('patch_clip', {'clipId': subj, 'properties': {'chromaKey.spill': 100}}), 'sp100')
s1 = frame(50)
g1 = channels(s1)[1]
results.append(check('despill acts on the subject', s0, s1, lambda x, y: g0 - g1 > 2.0,
                     f"green {g0:.1f} -> {g1:.1f}  (need a drop > 2.0)"))

# ── 4 · displacement warps the image, and animates ─────────────────
def scene_grid():
    """Straight edges, so a warp is unmistakable."""
    ok(call('reset_project', {'name': 'gpuprobe', 'aspectRatio': '16:9', 'fps': 30,
                              'backgroundColor': '#000000', 'durationMs': DUR}), 'reset')
    t = ok(call('add_track', {'type': 'video', 'name': 'D'}), 't')['trackId']
    ids = []
    for i in range(9):
        c = ok(call('add_shape_layer', {'kind': 'rectangle', 'trackId': t, 'startTimeMs': 0,
               'durationMs': DUR, 'style': {'fill': '#ffffff', 'strokeWidth': 0}}), 'r')['clipId']
        ok(call('patch_clip', {'clipId': c, 'properties': {
            'transform.x': -800 + i * 200, 'transform.y': 0,
            'transform.scaleX': 0.12, 'transform.scaleY': 2.2}}), 'p')
        ids.append(c)
    return ids

def edge_energy(a):
    l = 0.299*a[:,:,0] + 0.587*a[:,:,1] + 0.114*a[:,:,2]
    return float(np.abs(np.diff(l, axis=0)).mean())

ids = scene_grid()
flat = frame(50)
e_before = edge_energy(flat)
ok(call('add_effect', {'clipId': ids[4], 'effectType': 'displace',
                       'params': {'amount': 80, 'scale': 20, 'speed': 60}}), 'displace')
warped = frame(50)
e_after = edge_energy(warped)
results.append(check('displace warps the image', flat, warped,
                     lambda x, y: e_after - e_before > 0.05,
                     f"vertical edge energy {e_before:.3f} -> {e_after:.3f}  (need a rise > 0.05)"))

# it must MOVE, or it is a static distortion pretending to be a field
w1 = frame(700)
moved = float(np.abs(w1 - warped).mean())
results.append(check('displace animates', warped, w1, lambda x, y: moved > 0.3,
                     f"frame-to-frame difference {moved:.3f}  (need > 0.3)"))

n = sum(1 for r in results if r)
print(f"\n{n}/{len(results)} GPU-stage checks passed on pixels")
