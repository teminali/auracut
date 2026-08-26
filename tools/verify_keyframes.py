"""
Every property `list_properties` calls animatable, proved on PIXELS.

    Kerf must be running.  python3 tools/verify_keyframes.py [name-filter]

This exists because `propertyPath.ts` advertised twenty-four properties as
animatable while exactly seven could be keyframed, and nothing in the
codebase could have told you which. Asserting against the store would not
have caught it either — the keyframes were stored correctly and ignored at
render time. So every check here renders two frames and measures the
picture.

For each one: build a scene, keyframe it from A to B, render the first and
last frame through the compositor, and measure something that must change.
A property that reports success and renders two identical frames is the
exact failure this is here to catch.
"""
import sys, base64, io, json, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kerf_rpc import call, ok
import numpy as np
from PIL import Image

DUR = 1000

def frame(ms):
    f = ok(call('get_frame_context', {'atMs': int(ms), 'includeImage': True}), 'frame')['frame']
    b = base64.b64decode(f['imageDataUrl'].split(',', 1)[1])
    return np.array(Image.open(io.BytesIO(b)).convert('RGB')).astype(float)

# ── metrics ─────────────────────────────────────────────────────────
def luma(a):      return (0.299*a[:,:,0] + 0.587*a[:,:,1] + 0.114*a[:,:,2])
def mean_luma(a): return luma(a).mean()
def contrast(a):  return luma(a).std()
def satur(a):     return (a.max(axis=2) - a.min(axis=2)).mean()
def warm(a):      return a[:,:,0].mean() - a[:,:,2].mean()
def green(a):     return a[:,:,1].mean() - (a[:,:,0].mean() + a[:,:,2].mean())/2
def edges(a):
    l = luma(a)
    return float(np.abs(np.diff(l, axis=0)).mean() + np.abs(np.diff(l, axis=1)).mean())
def ink(a, thr=40):
    m = luma(a) > thr
    return float(m.sum())
def ink_bbox(a, thr=40):
    ys, xs = np.nonzero(luma(a) > thr)
    if not len(xs): return (0, 0, 0, 0)
    return (xs.min(), xs.max(), ys.min(), ys.max())
def ink_w(a):
    b = ink_bbox(a); return float(b[1]-b[0])
def ink_h(a):
    b = ink_bbox(a); return float(b[3]-b[2])
def ink_cx(a):
    b = ink_bbox(a); return float((b[0]+b[1])/2)
def ink_cy(a):
    b = ink_bbox(a); return float((b[2]+b[3])/2)
def corner_vs_centre(a):
    l = luma(a); h, w = l.shape
    c = l[h//3:2*h//3, w//3:2*w//3].mean()
    k = np.mean([l[:h//8,:w//8].mean(), l[:h//8,-w//8:].mean(),
                 l[-h//8:,:w//8].mean(), l[-h//8:,-w//8:].mean()])
    return float(c - k)
def hifreq(a):
    l = luma(a)
    return float(np.abs(l[1:-1,1:-1]*4 - l[:-2,1:-1] - l[2:,1:-1] - l[1:-1,:-2] - l[1:-1,2:]).mean())
def hue(a):
    r, g, b = a[:,:,0].mean(), a[:,:,1].mean(), a[:,:,2].mean()
    return float(np.arctan2(np.sqrt(3)*(g-b), 2*r-g-b))

# ── scenes ──────────────────────────────────────────────────────────
def scene_photo():
    """Real photographic content, full frame.

    A flat colour block has no detail, so contrast, sharpen and blur have
    nothing to act on and measure as no-ops even when they work. And a
    small block moves a whole-frame mean by almost nothing whatever you do
    to it — the first version of this harness keyframed a 2%-of-frame
    square and reported ten false failures."""
    ok(call('reset_project', {'name': 'kfprobe', 'aspectRatio': '16:9', 'fps': 30,
                              'backgroundColor': '#000000', 'durationMs': DUR}), 'reset')
    t = ok(call('add_track', {'type': 'video', 'name': 'P'}), 't')['trackId']
    c = ok(call('insert_clip', {'assetId': 'media_cyber_city', 'trackId': t,
                                'startTimeMs': 0}), 'ins')['clipId']
    ok(call('patch_clip', {'clipId': c, 'properties': {
        'durationMs': DUR, 'fitMode': 'cover'}}), 'p')
    return c, [c]

def scene_shape(kind='rectangle', style=None, props=None):
    ok(call('reset_project', {'name': 'kfprobe', 'aspectRatio': '16:9', 'fps': 30,
                              'backgroundColor': '#000000', 'durationMs': DUR}), 'reset')
    t = ok(call('add_track', {'type': 'video', 'name': 'S'}), 't')['trackId']
    st = {'fill': '#ffffff', 'stroke': '#ffffff', 'strokeWidth': 0}
    st.update(style or {})
    c = ok(call('add_shape_layer', {'kind': kind, 'trackId': t, 'startTimeMs': 0,
                                    'durationMs': DUR, 'style': st}), 's')['clipId']
    if props: ok(call('patch_clip', {'clipId': c, 'properties': props}), 'p')
    return c, [c]

def scene_text():
    ok(call('reset_project', {'name': 'kfprobe', 'aspectRatio': '16:9', 'fps': 30,
                              'backgroundColor': '#000000', 'durationMs': DUR}), 'reset')
    t = ok(call('add_track', {'type': 'text', 'name': 'T'}), 't')['trackId']
    c = ok(call('add_text_layer', {'text': 'KERF', 'trackId': t, 'startTimeMs': 0,
                                   'durationMs': DUR}), 'x')['clipId']
    ok(call('patch_clip', {'clipId': c, 'properties': {
        'textStyle.fontFamily': 'Inter', 'textStyle.fontSize': 120,
        'textStyle.fontWeight': 800, 'textStyle.color': '#ffffff',
        'textStyle.strokeWidth': 0, 'textStyle.shadowBlur': 0,
        'textStyle.kineticAnimation': 'none'}}), 'p')
    return c, [c]

# property -> (scene, from, to, metric, min-change)
def scene_masked(mask_type='circle', **over):
    """A white field with a mask on it — so the mask edge IS the ink edge."""
    props = {'transform.scaleX': 3.4, 'transform.scaleY': 2.0,
             'mask.enabled': True, 'mask.type': mask_type,
             'mask.sizeX': 55, 'mask.sizeY': 55, 'mask.offsetX': 0, 'mask.offsetY': 0,
             'mask.rotation': 0, 'mask.roundness': 0, 'mask.featherPx': 0}
    props.update(over)
    return scene_shape('rectangle', {'fill': '#ffffff'}, props)

def scene_line():
    return scene_shape('line', {'fill': '#ffffff', 'stroke': '#ffffff', 'strokeWidth': 10},
                       {'transform.scaleX': 2.2, 'transform.scaleY': 0.1})

def scene_rect_stroked():
    return scene_shape('rectangle',
                       {'fill': 'transparent', 'stroke': '#ffffff', 'strokeWidth': 12,
                        'trimStart': 0, 'trimEnd': 1},
                       {'transform.scaleX': 1.6, 'transform.scaleY': 1.2})

def scene_anchor():
    return scene_shape('rectangle', {'fill': '#ffffff'},
                       {'transform.scaleX': 0.8, 'transform.scaleY': 0.8,
                        'transform.x': 0, 'transform.y': 0})

def feather_edge(a):
    """How many pixels sit between clearly-off and clearly-on — a hard mask
    edge has almost none, a feathered one has many."""
    l = luma(a)
    mid = ((l > 25) & (l < 215)).sum()
    return float(mid)

TESTS = [
    ('filters.brightness',    scene_photo, -60,  60,  mean_luma, 12),
    ('filters.contrast',      scene_photo, -80,  80,  contrast,  6),
    ('filters.saturation',    scene_photo, -100, 150, satur,     12),
    ('filters.exposure',      scene_photo, -70,  70,  mean_luma, 10),
    ('filters.temperature',   scene_photo, -100, 100, warm,      10),
    ('filters.tint',          scene_photo, -100, 100, green,     6),
    ('filters.highlights',    scene_photo, -90,  90,  mean_luma, 2),
    ('filters.shadows',       scene_photo, -90,  90,  mean_luma, 2),
    ('filters.sharpen',       scene_photo, 0,    100, edges,     0.15),
    ('filters.vignette',      scene_photo, 0,    95,  corner_vs_centre, 8),
    ('filters.grain',         scene_photo, 0,    100, hifreq,    0.4),
    ('filters.blur',          scene_photo, 0,    24,  edges,     0.4),
    ('filters.hueRotate',     scene_photo, 0,    150, hue,       0.25),
    ('textStyle.fontSize',    scene_text,  60,   220, ink_h,     30),
    ('textStyle.letterSpacing', scene_text, 0,   90,  ink_w,     40),

    ('mask.sizeX',            lambda: scene_masked(),                20, 95, ink_w,  60),
    ('mask.sizeY',            lambda: scene_masked(),                20, 95, ink_h,  60),
    ('mask.offsetX',          lambda: scene_masked(),               -30, 30, ink_cx, 40),
    ('mask.offsetY',          lambda: scene_masked(),               -30, 30, ink_cy, 25),
    ('mask.rotation',         lambda: scene_masked('rectangle', **{'mask.sizeX': 90, 'mask.sizeY': 22}),
                                                                      0, 90, ink_h,  40),
    ('mask.roundness',        lambda: scene_masked('rectangle', **{'mask.sizeX': 70, 'mask.sizeY': 70}),
                                                                      0, 100, ink,   900),
    ('mask.featherPx',        lambda: scene_masked(),                 0, 90, feather_edge, 900),

    ('shapeStyle.strokeWidth', scene_line,        6,   90,  ink,    9000),
    ('shapeStyle.trimStart',   scene_rect_stroked, 0.0, 0.8, ink,   4000),
    ('shapeStyle.trimEnd',     scene_rect_stroked, 1.0, 0.2, ink,   4000),
    ('shapeStyle.cornerRadius', lambda: scene_shape('rectangle', {'fill': '#ffffff'},
                                {'transform.scaleX': 1.2, 'transform.scaleY': 1.2}),
                                                    0,  240, ink,   2500),

    ('anchorX',                scene_anchor,      0.5, 0.0, ink_cx, 60),
    ('anchorY',                scene_anchor,      0.5, 0.0, ink_cy, 40),
]

def settle(ms, tries=25):
    """Wait for media to finish decoding.

    `get_frame_context` will hand back a frame whose media has not decoded
    yet and say nothing about it — the compositor draws a placeholder and
    the result looks like a legitimately dark frame. Measuring straight
    after an insert reported ten false failures the first time round."""
    import time
    prev = None
    for _ in range(tries):
        cur = float(luma(frame(ms)).mean())
        if prev is not None and abs(cur - prev) < 0.01:
            return
        prev = cur
        time.sleep(0.12)

def run_one(name, scene, a, b, metric, need):
    target, _ = scene() if scene is not scene_shape else scene()
    ok(call('add_keyframes', {'clipId': target, 'property': name, 'keyframes': [
        {'timeOffsetMs': 0, 'value': a, 'easing': 'linear'},
        {'timeOffsetMs': DUR, 'value': b, 'easing': 'linear'}]}), f'kf {name}')
    settle(5)
    f0, f1 = frame(5), frame(DUR - 20)
    m0, m1 = metric(f0), metric(f1)
    delta = abs(m1 - m0)
    good = delta >= need
    print(f"  {'PASS' if good else 'FAIL'}  {name:26s} {m0:10.3f} -> {m1:10.3f}   Δ{delta:8.3f}  (need {need})")
    return good

if __name__ == '__main__':
    only = sys.argv[1] if len(sys.argv) > 1 else None
    print('property                        start        end        change')
    results = []
    for name, scene, a, b, metric, need in TESTS:
        if only and only not in name: continue
        try:
            results.append((name, run_one(name, scene, a, b, metric, need)))
        except Exception as e:
            print(f"  ERROR {name}: {e}")
            results.append((name, False))
    n = sum(1 for _, g in results if g)
    print(f"\n{n}/{len(results)} animatable properties verified on pixels")
    bad = [x for x, g in results if not g]
    if bad: print('failing:', ', '.join(bad))
