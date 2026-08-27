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

Two sections:

  · 34 property rows on PIXELS — every entry in `ANIMATABLE_PROPERTIES`
    except `volume`, which is audible rather than visible. The file used
    to say "every property" and cover 28; the six it silently skipped
    were positionX, positionY, opacity, scaleX, scaleY and rotation,
    which is to say the six an editor uses most.

  · `volume`, on the EXPORTED WAVEFORM. It was the one animatable
    property with no proof anywhere, and when someone finally measured
    it, it was the eighteenth property to say it was animatable and not
    be: `interpolateKeyframes` is consumed by `compositor.ts` and the
    inspector, and neither `audioEngine` nor `exportPipeline` ever
    mentioned keyframes. `add_keyframes` returned two ids and the
    exported envelope came back byte-identical.

  · 52 rows on the tools that EDIT an animation once it exists —
    remove, move, re-ease, clear, upsert, and the motion-path points.
    Placing keyframes was a one-way door until those existed.
"""
import sys, base64, io, json, os, tempfile, subprocess, wave
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kerf_rpc import call, ok
import numpy as np
from PIL import Image

DUR = 1000

def raw_frame(ms):
    return ok(call('get_frame_context', {'atMs': int(ms), 'includeImage': True}), 'frame')['frame']

def frame(ms):
    f = raw_frame(ms)
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

# ── the probe chart ─────────────────────────────────────────────────
TMP = tempfile.mkdtemp(prefix='kerf-kf-')

def build_probe_chart(path, w=1920, h=1080, seed=7):
    """The still the filter checks run against — built here, not fetched.

    It is a chart rather than a photograph, and every part of it is load
    bearing. A filter that has nothing to act on measures as a no-op even
    when it works, so the image has to supply, deliberately:

      · a smooth low-frequency colour field, so the frame MEAN is well off
        neutral — `hue` takes an angle from the three channel means, and a
        frame that averages to grey has no stable angle to move;
      · hard block edges at three scales, for `sharpen` to enhance and
        `blur` to destroy;
      · blocks from near-black to near-white, so `contrast`, `highlights`
        and `shadows` have real ends to pull on, and `brightness` and
        `exposure` have room to move without clipping;
      · saturated colour across the wheel, so `saturation` can go both up
        and down, and `temperature` and `tint` have red, green and blue
        to push against;
      · content all the way into the corners, since `vignette` is measured
        as corner-versus-centre and unlit corners cannot darken;
      · only light fine texture, so added `grain` is what the high-
        frequency metric sees.

    Fixed seed: the thresholds below are calibrated against this exact
    image, and `--selftest` re-checks that they still separate a real
    change from a no-op.
    """
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    u, v = xx / w, yy / h

    r = 120 + 70*np.sin(2.1*np.pi*u + 0.6) + 35*np.cos(1.3*np.pi*v)
    g = 105 + 45*np.sin(1.7*np.pi*v + 1.9) + 30*np.sin(2.9*np.pi*u*v + 0.3)
    b = 135 + 65*np.cos(1.9*np.pi*v + 0.2) - 40*np.sin(2.3*np.pi*u)
    img = np.stack([r, g, b], axis=2)

    for scale, n in ((6, 14), (14, 40), (34, 90)):
        bh, bw = h // scale, w // scale
        for _ in range(n):
            y0 = int(rng.integers(0, h - bh)); x0 = int(rng.integers(0, w - bw))
            img[y0:y0+bh, x0:x0+bw] += rng.uniform(-90, 95) + rng.uniform(-45, 45, 3)

    img += rng.normal(0, 2.2, (h, w, 3))
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(path)
    return path

CHART = build_probe_chart(os.path.join(TMP, 'kf_probe_chart.png'))
_chart_asset = None

def chart_asset():
    """Import the chart, and re-import it if the media pool has been emptied.

    This used to insert `media_cyber_city`, one of the app's seeded sample
    assets, and that was wrong twice over. It is an Unsplash URL, so the
    suite quietly needed the network; and it is ambient state that another
    suite destroys. `verify_project_format` opens files whose `mediaPool`
    is `[]`, and `projectIO` replaces the pool wholesale rather than
    merging, so the pool stays empty for the life of the app — after which
    all thirteen filter checks here reported ERROR, on a build where every
    one of them actually worked.

    That made the six suites order-dependent and non-idempotent: green in
    the documented order on a freshly launched Kerf, thirteen red the
    second time round. Owning the asset removes the coupling; re-importing
    when it goes missing means nothing else can reintroduce it.
    """
    global _chart_asset
    if _chart_asset is not None:
        pool = ok(call('list_media_pool', {}), 'pool')['assets']
        if any(a['id'] == _chart_asset for a in pool):
            return _chart_asset
    _chart_asset = ok(call('import_media_from_path',
                           {'path': CHART, 'name': 'kf_probe_chart.png'}), 'imp')['assetId']
    return _chart_asset

# ── scenes ──────────────────────────────────────────────────────────
def scene_photo():
    """The probe chart, full frame — see `build_probe_chart`.

    A flat colour block has no detail, so contrast, sharpen and blur have
    nothing to act on and measure as no-ops even when they work. And a
    small block moves a whole-frame mean by almost nothing whatever you do
    to it — the first version of this harness keyframed a 2%-of-frame
    square and reported ten false failures. Hence full frame, `fitMode`
    cover, and an image built to give every filter something to bite on."""
    ok(call('reset_project', {'name': 'kfprobe', 'aspectRatio': '16:9', 'fps': 30,
                              'backgroundColor': '#000000', 'durationMs': DUR}), 'reset')
    t = ok(call('add_track', {'type': 'video', 'name': 'P'}), 't')['trackId']
    c = ok(call('insert_clip', {'assetId': chart_asset(), 'trackId': t,
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
    # The transform group. This file said "every property list_properties
    # calls animatable" and covered 28 of the 35 — the seven it left out
    # were the oldest and most-used ones, positionX through volume, which
    # is exactly the set nobody thinks to check. Six of them are pictures
    # and are here. `volume` is the seventh and is not measurable on
    # pixels; no suite in tools/ keyframes it, so it remains the one
    # animatable property with no proof anywhere.
    ('positionX', lambda: scene_shape('rectangle', {'fill': '#ffffff'},
                            {'transform.scaleX': 0.5, 'transform.scaleY': 0.5}),
                                                       -600, 600, ink_cx,    400),
    ('positionY', lambda: scene_shape('rectangle', {'fill': '#ffffff'},
                            {'transform.scaleX': 0.5, 'transform.scaleY': 0.5}),
                                                       -350, 350, ink_cy,    250),
    ('opacity',   lambda: scene_shape('rectangle', {'fill': '#ffffff'},
                            {'transform.scaleX': 4.5, 'transform.scaleY': 2.5}),
                                                        1.0, 0.2, mean_luma, 120),
    ('scaleX',    lambda: scene_shape('rectangle', {'fill': '#ffffff'},
                            {'transform.scaleX': 0.3, 'transform.scaleY': 0.5}),
                                                        0.3, 1.5, ink_w,     180),
    ('scaleY',    lambda: scene_shape('rectangle', {'fill': '#ffffff'},
                            {'transform.scaleX': 0.5, 'transform.scaleY': 0.3}),
                                                        0.3, 1.0, ink_h,     100),
    ('rotation',  lambda: scene_shape('rectangle', {'fill': '#ffffff'},
                            {'transform.scaleX': 2.2, 'transform.scaleY': 0.2}),
                                                          0,  45, ink_h,     150),

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

def settle(ms, tries=40):
    """Wait for media to finish decoding — on the frame's own word.

    `get_frame_context` used to hand back a frame whose media had not
    decoded and say nothing about it: the compositor draws a placeholder,
    which reads as a legitimately dark frame. Measuring straight after an
    insert reported ten false failures the first time round.

    This waited for the PICTURE to stop changing instead, which is a guess
    in the caller about something only the renderer knows — and it is
    wrong in both directions. It gives up early on a frame that happens to
    hold still for one poll, and it waits out the full 3 seconds on every
    scene made of shapes and text, where nothing was ever decoding.

    The frame now reports `mediaPending`, so this waits on a fact.
    `verify_frame_context.py` is what says that number is real."""
    import time
    for _ in range(tries):
        if raw_frame(ms).get('mediaPending', 0) == 0:
            return
        time.sleep(0.08)

def run_one(name, scene, a, b, metric, need, selftest=False):
    """Keyframe a -> b and measure. With selftest, keyframe a -> a instead.

    A threshold nobody has tried to fail is not a threshold. `--selftest`
    reruns every row holding the property STILL, and demands the same
    metric now move by LESS than `need` — so a row only counts as evidence
    if the number it keys on is actually driven by the property, and not
    by frame timing, encode noise or a scene that drifts on its own."""
    target, _ = scene() if scene is not scene_shape else scene()
    end = a if selftest else b
    ok(call('add_keyframes', {'clipId': target, 'property': name, 'keyframes': [
        {'timeOffsetMs': 0, 'value': a, 'easing': 'linear'},
        {'timeOffsetMs': DUR, 'value': end, 'easing': 'linear'}]}), f'kf {name}')
    settle(5)
    f0, f1 = frame(5), frame(DUR - 20)
    m0, m1 = metric(f0), metric(f1)
    delta = abs(m1 - m0)
    good = delta < need if selftest else delta >= need
    want = f'want <{need}' if selftest else f'need {need}'
    print(f"  {'PASS' if good else 'FAIL'}  {name:26s} {m0:10.3f} -> {m1:10.3f}   Δ{delta:8.3f}  ({want})")
    return good


# ══════════════════════════════════════════════════════════════════
# EDITING the keyframes, not just placing them
#
# The rows above prove a property ANIMATES. These prove you can change
# your mind afterwards: remove a key, move it, re-ease it, clear one
# property's keys and not another's. Until `remove_keyframe` and the rest
# existed, `add_keyframes` was a one-way door — the only way to alter an
# animation was to throw the clip's keyframes away and rebuild them.
#
# Same rule as above: measure the PICTURE. A store that holds the right
# keyframes and a compositor that ignores them is exactly the failure this
# file was written for, and `mask.rotation` (settable, keyframeable,
# listed, rendering nothing until last night) is why nobody here is
# allowed to assert on `describe_timeline` and call it evidence.
#
# `--selftest` for these rows means the same thing it means above, applied
# to the EDIT rather than the property: run the identical measurement with
# the edit under test not performed — or performed with the value it
# already has — and require the metric to move LESS than its bar. A row
# that still "passes" when nothing was edited is measuring frame timing.
# ══════════════════════════════════════════════════════════════════

STILL = False           # set by --selftest; assertion rows only run when False
tool_results = []


def check(label, good, detail):
    """An assertion row: a fact that is true or is not, with no threshold.

    Skipped under --selftest, which is about whether a THRESHOLD
    discriminates. Counting rows that cannot fail differently there would
    pad the selftest score with rows that are not evidence for it.
    """
    if STILL:
        return
    print(f"  {'PASS' if good else 'FAIL'}  {label:44s} {detail}")
    tool_results.append((label, good))


def threshold(label, delta, need, detail):
    """A measured row. Normally the metric must move by at least `need`, in
    the SIGNED direction the edit implies — a change in the wrong direction
    is not a pass. Under --selftest the edit is skipped or neutered and the
    same metric must move less than `need` in either direction."""
    good = abs(delta) < need if STILL else delta >= need
    want = f'want <{need}' if STILL else f'need {need}'
    print(f"  {'PASS' if good else 'FAIL'}  {label:44s} Δ{delta:9.3f} ({want})  {detail}")
    tool_results.append((label, good))


def refuses(label, name, args):
    """A tool that cannot do what was asked must THROW, not report success.

    This is the failure this repo has found six times: the store bails
    silently on an unknown id, the tool returns {success: true}, and the
    agent tells the user it removed a keyframe that is still there.
    """
    payload = call(name, args).get('result', {})
    if payload.get('success'):
        check(label, False, f'reported SUCCESS: {json.dumps(payload.get("data"))[:70]}')
    else:
        check(label, True, str(payload.get('error'))[:74])


def dist(p, q):
    if p is None or q is None:
        raise AssertionError('nothing rendered — no lit pixels to locate')
    return float(np.hypot(p[0] - q[0], p[1] - q[1]))


def ink_centre(a, thr=40):
    """Centroid of the lit pixels — the same measurement `verify_tools.py`
    uses on `set_motion_path`, so the point-level tools are held to the
    number the whole-path tool is already held to."""
    l = luma(a)
    ys, xs = np.nonzero(l > thr)
    if not len(xs):
        return None
    return float(xs.mean()), float(ys.mean())


# The rendered frame comes back at half canvas size, and motion-path points
# are ABSOLUTE canvas coordinates, so everything measured in image pixels
# has to be halved to be compared with a point.
def canvas_to_image(x, y):
    return x / 2.0, y / 2.0


CENTRE = canvas_to_image(1920 / 2, 1080 / 2)


def scene_cover():
    """A white rectangle over the WHOLE frame: mean luma is opacity × 255.

    A shape layer's base is 480×480, so an unscaled rectangle covers 11% of
    a 16:9 frame and a full-opacity swing moves the frame mean by 28 — too
    small to separate an easing curve's midpoint from its endpoints. Scaled
    to cover, the same swing moves it by 255."""
    return scene_shape('rectangle', {'fill': '#ffffff'},
                       {'transform.scaleX': 4.5, 'transform.scaleY': 2.5})[0]


def scene_block(scale=0.5):
    """A small white block on black, so its position IS a measurable centroid."""
    return scene_shape('rectangle', {'fill': '#ffffff'},
                       {'transform.scaleX': scale, 'transform.scaleY': scale,
                        'transform.x': 0, 'transform.y': 0})[0]


def animate(clip, prop, stops):
    """add_keyframes, returning the ids — which it did not use to."""
    r = ok(call('add_keyframes', {'clipId': clip, 'property': prop, 'keyframes': [
        {'timeOffsetMs': t, 'value': v, 'easing': 'linear'} for t, v in stops]}), f'kf {prop}')
    return r


# ── remove_keyframe ────────────────────────────────────────────────
def check_remove_keyframe():
    """Animate 1 → 0 → 1, then take the dip out. The midpoint must lift."""
    c = scene_cover()
    r = animate(c, 'opacity', [(0, 1.0), (DUR // 2, 0.0), (DUR, 1.0)])
    ids = r.get('keyframeIds') or []
    check('add_keyframes hands back the ids it minted', len(ids) == 3,
          f'{len(ids)} of 3 ids returned')

    listed = ok(call('list_keyframes', {'clipId': c}), 'list')
    check('list_keyframes reports those same ids',
          sorted(k['id'] for k in listed['keyframes']) == sorted(ids),
          f"{listed['count']} keyframes, {len(listed['keyframes'])} with ids")

    # Sampled AT the keyframe, not near it: at 5ms the 1.0 -> 0.0 ramp has
    # already given up 1% of its opacity, so a 5ms "endpoint" moves by 3
    # luma on its own and the row would fail on the harness, not the tool.
    start_before = mean_luma(frame(0))
    mid_before = mean_luma(frame(DUR // 2))
    if not STILL:
        ok(call('remove_keyframe', {'clipId': c, 'keyframeId': ids[1]}), 'remove_keyframe')
    mid_after = mean_luma(frame(DUR // 2))
    threshold('remove_keyframe lifts the dip it removed', mid_after - mid_before, 100,
              f'midpoint luma {mid_before:.1f} -> {mid_after:.1f}')
    start_after = mean_luma(frame(0))
    check('remove_keyframe leaves the endpoints alone',
          abs(start_after - start_before) < 2.0,
          f'first frame {start_before:.1f} -> {start_after:.1f}')

    refuses('remove_keyframe refuses an unknown keyframe id', 'remove_keyframe',
            {'clipId': c, 'keyframeId': 'kf_not_a_real_id'})
    refuses('remove_keyframe refuses an unknown clip', 'remove_keyframe',
            {'clipId': 'no_such_clip_here', 'keyframeId': ids[0]})


# ── move_keyframe: the TIME arm ────────────────────────────────────
def check_move_keyframe_time():
    """Where the animation peaks is a fact about the picture, not the store."""
    c = scene_cover()
    ids = animate(c, 'opacity', [(0, 0.0), (DUR // 4, 1.0), (DUR, 0.0)])['keyframeIds']
    grid = [round(DUR * i / 8) for i in range(9)]

    def peak_ms():
        return max((mean_luma(frame(t)), t) for t in grid)[1]

    before = peak_ms()
    if not STILL:
        ok(call('move_keyframe', {'clipId': c, 'keyframeId': ids[1],
                                  'timeOffsetMs': DUR * 3 // 4}), 'move_keyframe')
    after = peak_ms()
    threshold('move_keyframe moves where the value peaks', after - before, DUR * 0.3,
              f'brightest sampled frame {before}ms -> {after}ms')


# ── move_keyframe: the VALUE arm ───────────────────────────────────
def check_move_keyframe_value():
    """`value` is optional in the signature, and an optional argument that is
    quietly dropped is the classic version of this bug. Under --selftest the
    call is still made — with the value the keyframe already has — so this
    row only passes there if the metric responds to the VALUE and not to
    the fact that a tool was called."""
    c = scene_cover()
    ids = animate(c, 'opacity', [(0, 1.0), (DUR, 1.0)])['keyframeIds']
    at = DUR - 20
    before = mean_luma(frame(at))
    ok(call('move_keyframe', {'clipId': c, 'keyframeId': ids[1], 'timeOffsetMs': DUR,
                              'value': 1.0 if STILL else 0.3}), 'move_keyframe value')
    after = mean_luma(frame(at))
    threshold('move_keyframe applies the optional value', before - after, 100,
              f'luma at {at}ms {before:.1f} -> {after:.1f}')

    stored = [k for k in ok(call('list_keyframes', {'clipId': c}), 'l')['keyframes']
              if k['id'] == ids[1]]
    check('move_keyframe stores the value it applied',
          bool(stored) and abs(stored[0]['value'] - 0.3) < 1e-6,
          f"stored value {stored[0]['value'] if stored else 'gone'}")

    ok(call('move_keyframe', {'clipId': c, 'keyframeId': ids[1],
                              'timeOffsetMs': DUR * 3 // 4}), 'move time only')
    kept = [k for k in ok(call('list_keyframes', {'clipId': c}), 'l')['keyframes']
            if k['id'] == ids[1]][0]
    check('move_keyframe with no value keeps the value',
          abs(kept['value'] - 0.3) < 1e-6 and kept['timeOffsetMs'] == DUR * 3 // 4,
          f"now {kept['value']} @{kept['timeOffsetMs']}ms")

    # moveKeyframe is the one store action here that does NOT commit — the
    # UI drives it from a drag and owns the transaction — so the tool wraps
    # it in asOneEdit. If that wrapper were missing the edit would be
    # invisible to undo and this row would walk back the move BEFORE it.
    if not STILL:
        ok(call('undo', {'steps': 1}), 'undo')
        back = [k for k in ok(call('list_keyframes', {'clipId': c}), 'l')['keyframes']
                if k['id'] == ids[1]][0]
        check('move_keyframe is exactly one undo step',
              back['timeOffsetMs'] == DUR and abs(back['value'] - 0.3) < 1e-6,
              f"one undo -> {back['value']} @{back['timeOffsetMs']}ms")

    refuses('move_keyframe refuses an unknown keyframe id', 'move_keyframe',
            {'clipId': c, 'keyframeId': 'kf_nope', 'timeOffsetMs': 100})


# ── set_keyframe_easing ────────────────────────────────────────────
def check_keyframe_easing():
    """The one row that cannot be faked.

    A ramp from 0 to 1 has the same two endpoints whatever its easing, so a
    `set_keyframe_easing` that stored the name and changed nothing would
    still render the right first and last frame. Only the MIDDLE separates
    them: linear passes 0.5 at half time, easeIn (t²) passes 0.25. If the
    midpoints were equal the tool would be decorative."""
    c = scene_cover()
    ids = animate(c, 'opacity', [(0, 0.0), (DUR, 1.0)])['keyframeIds']
    # AT the two keyframes, not near them. 20ms short of the end the two
    # curves are legitimately 5 luma apart (0.98 against 0.9604), so a
    # sloppy "endpoint" would fail this row on arithmetic, not on easing.
    ends_before = (mean_luma(frame(0)), mean_luma(frame(DUR - 1)))
    mid_before = mean_luma(frame(DUR // 2))

    ok(call('set_keyframe_easing', {'clipId': c, 'keyframeId': ids[0],
                                    'easing': 'linear' if STILL else 'easeIn'}), 'easing')
    mid_after = mean_luma(frame(DUR // 2))
    ends_after = (mean_luma(frame(0)), mean_luma(frame(DUR - 1)))
    threshold('easeIn and linear differ at the MIDPOINT', mid_before - mid_after, 40,
              f'midpoint luma {mid_before:.1f} -> {mid_after:.1f}')
    check('easeIn and linear agree at the ENDPOINTS',
          abs(ends_after[0] - ends_before[0]) < 2 and abs(ends_after[1] - ends_before[1]) < 2,
          f'{ends_before[0]:.1f}/{ends_before[1]:.1f} -> {ends_after[0]:.1f}/{ends_after[1]:.1f}')

    last = ok(call('set_keyframe_easing', {'clipId': c, 'keyframeId': ids[1],
                                           'easing': 'easeOut'}), 'last easing')
    check('easing on the last keyframe says it governs nothing',
          last.get('governsSegmentToMs') is None and 'note' in last,
          str(last.get('note'))[:66])

    refuses('bezier points on a non-bezier easing refused', 'set_keyframe_easing',
            {'clipId': c, 'keyframeId': ids[0], 'easing': 'linear', 'bezier': [0.4, 0, 0.2, 1]})
    refuses('set_keyframe_easing refuses an unknown easing', 'set_keyframe_easing',
            {'clipId': c, 'keyframeId': ids[0], 'easing': 'squelch'})


def check_keyframe_easing_curves():
    """`hold` and the bezier control points are the two easing arguments
    most easily stored and never read.

    `hold` is not a curve at all — it is a step, so its midpoint is the
    START value rather than anything between. And the control points are an
    optional array on an optional easing: under --selftest they are passed
    again as the documented default [0.25, 0.1, 0.25, 1], so the row can
    only pass there if the picture follows the POINTS and not the call.
    """
    c = scene_cover()
    ids = animate(c, 'opacity', [(0, 0.0), (DUR, 1.0)])['keyframeIds']
    lin = mean_luma(frame(DUR // 2))

    ok(call('set_keyframe_easing', {'clipId': c, 'keyframeId': ids[0],
                                    'easing': 'linear' if STILL else 'hold'}), 'hold')
    held = mean_luma(frame(DUR // 2))
    threshold('hold steps instead of ramping', lin - held, 40,
              f'midpoint luma {lin:.1f} -> {held:.1f}')
    if not STILL:
        check('hold holds right up to the next key', mean_luma(frame(DUR - 1)) < 2,
              f'luma 1ms before the next key {mean_luma(frame(DUR - 1)):.1f}')

    ok(call('set_keyframe_easing', {'clipId': c, 'keyframeId': ids[0], 'easing': 'bezier'}), 'bezier')
    default_mid = mean_luma(frame(DUR // 2))
    ok(call('set_keyframe_easing', {
        'clipId': c, 'keyframeId': ids[0], 'easing': 'bezier',
        'bezier': [0.25, 0.1, 0.25, 1.0] if STILL else [0.95, 0.0, 1.0, 1.0]}), 'bezier pts')
    custom_mid = mean_luma(frame(DUR // 2))
    threshold('bezier control points reach the picture', default_mid - custom_mid, 60,
              f'midpoint luma {default_mid:.1f} -> {custom_mid:.1f}')


# ── clear_keyframes, scoped and unscoped ───────────────────────────
def check_clear_keyframes():
    """Two properties animating at once, so `property` has something to be
    wrong about. If the scoped form cleared everything the second row here
    would fail, and if it cleared nothing the first would."""
    c = scene_block(0.5)
    animate(c, 'positionX', [(0, -600), (DUR, 600)])
    animate(c, 'positionY', [(0, -350), (DUR, 350)])

    def travel():
        f0, f1 = frame(5), frame(DUR - 20)
        return abs(ink_cx(f1) - ink_cx(f0)), abs(ink_cy(f1) - ink_cy(f0))

    tx0, ty0 = travel()
    if not STILL:
        ok(call('clear_keyframes', {'clipId': c, 'property': 'positionX'}), 'clear x')
    tx1, ty1 = travel()
    threshold('clear_keyframes(property) stops that property', tx0 - tx1, 400,
              f'x travel {tx0:.0f}px -> {tx1:.0f}px')
    check('clear_keyframes(property) leaves the others animating',
          ty1 > 200 and abs(ty1 - ty0) < 20, f'y travel {ty0:.0f}px -> {ty1:.0f}px')

    if not STILL:
        ok(call('clear_keyframes', {'clipId': c}), 'clear all')
    _, ty2 = travel()
    threshold('clear_keyframes(clip) stops the rest', ty1 - ty2, 200,
              f'y travel {ty1:.0f}px -> {ty2:.0f}px')

    refuses('clear_keyframes refuses a clip with none', 'clear_keyframes', {'clipId': c})
    animate(c, 'positionY', [(0, -350), (DUR, 350)])
    refuses('clear_keyframes refuses a property with none', 'clear_keyframes',
            {'clipId': c, 'property': 'rotation'})


# ── upsert_keyframe, both arms ─────────────────────────────────────
def check_upsert_keyframe():
    """INSERT where there is no key, UPDATE where there is one, and no
    duplicate at the same time — which is the whole reason this exists
    alongside `add_keyframes`, which appends and stacks."""
    c = scene_cover()
    animate(c, 'opacity', [(0, 1.0), (DUR, 1.0)])
    mid_before = mean_luma(frame(DUR // 2))

    first = None
    if not STILL:
        first = ok(call('upsert_keyframe', {'clipId': c, 'property': 'opacity',
                                            'timeOffsetMs': DUR // 2, 'value': 0.0}), 'insert')
        check('upsert_keyframe INSERTS where there is no key',
              first['created'] is True and first['action'] == 'inserted',
              f"action {first['action']}, {first['keyframesOnProperty']} keys on opacity")
    mid_inserted = mean_luma(frame(DUR // 2))
    threshold('the inserted key darkens the midpoint', mid_before - mid_inserted, 100,
              f'midpoint luma {mid_before:.1f} -> {mid_inserted:.1f}')

    n_inserted = ok(call('list_keyframes', {'clipId': c, 'property': 'opacity'}), 'l')['count']
    if not STILL:
        again = ok(call('upsert_keyframe', {'clipId': c, 'property': 'opacity',
                                            'timeOffsetMs': DUR // 2, 'value': 1.0}), 'update')
        check('upsert_keyframe UPDATES the key already there',
              again['created'] is False and again['keyframeId'] == first['keyframeId'],
              f"action {again['action']}, same id {again['keyframeId'] == first['keyframeId']}")
    mid_updated = mean_luma(frame(DUR // 2))
    threshold('the update restores the midpoint', mid_updated - mid_inserted, 100,
              f'midpoint luma {mid_inserted:.1f} -> {mid_updated:.1f}')

    n_updated = ok(call('list_keyframes', {'clipId': c, 'property': 'opacity'}), 'l')['count']
    check('upsert_keyframe stacks no duplicate at the same time',
          n_inserted == 3 and n_updated == 3, f'{n_inserted} keys after insert, {n_updated} after update')

    refuses('upsert_keyframe refuses a property that is not animatable',
            'upsert_keyframe', {'clipId': c, 'property': 'blendMode', 'timeOffsetMs': 0, 'value': 1})
    refuses('upsert_keyframe refuses an unknown clip', 'upsert_keyframe',
            {'clipId': 'no_such_clip_here', 'property': 'opacity', 'timeOffsetMs': 0, 'value': 1})


# ── remove_effect_keyframe ─────────────────────────────────────────
def check_remove_effect_keyframe():
    """Measured on the picture, not the effect stack: an animated blur that
    stops animating leaves the last frame as sharp as the first."""
    c = scene_block(0.5)
    ok(call('add_effect', {'clipId': c, 'effectType': 'gaussian_blur',
                           'params': {'radius': 0}}), 'add_effect')
    ok(call('animate_effect_param', {'clipId': c, 'effect': 'gaussian_blur', 'param': 'radius',
                                     'keyframes': [{'timeOffsetMs': 0, 'value': 0},
                                                   {'timeOffsetMs': DUR, 'value': 70}]}), 'animate')
    ek = ok(call('list_keyframes', {'clipId': c}), 'list')['effectKeyframes']
    check('list_keyframes reports effect-parameter ids too',
          len(ek) == 2 and all(k.get('id') and k.get('param') == 'radius' for k in ek),
          f'{len(ek)} effect keyframes, ids present')

    def spread():
        """Sharp start minus soft end — zero once the parameter holds still."""
        return hifreq(frame(5)) - hifreq(frame(DUR - 20))

    s0 = spread()
    if not STILL:
        last = max(ek, key=lambda k: k['timeOffsetMs'])
        ok(call('remove_effect_keyframe', {'clipId': c, 'effect': 'gaussian_blur',
                                           'keyframeId': last['id']}), 'remove')
    s1 = spread()
    threshold('remove_effect_keyframe stops the animation', s0 - s1, 0.05,
              f'start-to-end detail loss {s0:.3f} -> {s1:.3f}')
    check('the end frame is sharp again', abs(s1) < 0.02, f'residual spread {s1:.3f}')

    refuses('remove_effect_keyframe refuses an unknown keyframe', 'remove_effect_keyframe',
            {'clipId': c, 'effect': 'gaussian_blur', 'keyframeId': 'efk_nope'})
    refuses('remove_effect_keyframe refuses an unknown effect', 'remove_effect_keyframe',
            {'clipId': c, 'effect': 'kaleidoscope', 'keyframeId': 'efk_nope'})


# ── easing on an EFFECT keyframe ───────────────────────────────────
def check_effect_keyframe_easing():
    """Effect keyframes could carry no easing at all.

    `addEffectKeyframe` hardcoded `easeInOut` and `animate_effect_param`
    had no easing field, so every effect animation in the app ran on one
    curve. `EffectKeyframe` also had no `bezierPoints`, and
    `resolveEffectParams` called `applyEasing(t, a.easing)` with no
    curve — so asking for `bezier` silently used the default control
    points. `KeyframePoint` has had that field since beziers existed.

    Measured at the MIDPOINT, which is the only place a curve is
    visible: every easing agrees at both ends by definition, so a row
    that sampled the ends would pass on a build where easing did
    nothing at all.

    The blur tops out at 14, not 70. At 70 the midpoints of two
    different curves are both blurred to mush and `hifreq` saturates —
    the metric stops responding exactly where the row needs it to.
    """
    def mid_for(easing, bezier=None):
        c = scene_block(0.5)
        # No kinetic entrance: a text layer's default `pop_in` moves the
        # metric at the start of the clip and would be read as the
        # effect's doing.
        ok(call('add_effect', {'clipId': c, 'effectType': 'gaussian_blur',
                               'params': {'radius': 0}}), 'add_effect')
        stop = {'timeOffsetMs': 0, 'value': 0, 'easing': easing}
        if bezier:
            stop['bezierPoints'] = bezier
        ok(call('animate_effect_param', {
            'clipId': c, 'effect': 'gaussian_blur', 'param': 'radius',
            'keyframes': [stop, {'timeOffsetMs': DUR, 'value': 14}]}), 'animate')
        return hifreq(frame(DUR // 2)), hifreq(frame(DUR - 20))

    # Under --selftest every pair is rendered with the SAME curve, so
    # the identical machinery runs and the difference must collapse. A
    # row that still separated two identical eases would be reading
    # render noise rather than the curve.
    lin_mid, lin_end = mid_for('linear')
    in_mid, in_end = mid_for('linear' if STILL else 'easeIn')
    out_mid, _ = mid_for('linear' if STILL else 'easeOut')

    threshold('easing reaches an effect keyframe at all', abs(in_mid - lin_mid), 0.03,
              f'midpoint linear {lin_mid:.3f} vs {"linear" if STILL else "easeIn"} {in_mid:.3f}')
    threshold('easeIn and easeOut bend opposite ways', abs(in_mid - out_mid), 0.03,
              f'midpoint {in_mid:.3f} vs {out_mid:.3f}')

    slow = [0.9, 0.0, 1.0, 0.2]
    fast = slow if STILL else [0.0, 0.9, 0.2, 1.0]
    slow_mid, slow_end = mid_for('bezier', slow)
    fast_mid, _ = mid_for('bezier', fast)
    threshold('two custom beziers render differently', abs(slow_mid - fast_mid), 0.03,
              f'midpoint slow-start {slow_mid:.3f} vs {"the same curve" if STILL else "fast-start"} {fast_mid:.3f}')

    # The control on all of the above: whatever the curve, the ENDS are
    # the same. A row that moved the endpoints would be measuring the
    # value, not the easing.
    check('every curve still agrees at the end', abs(lin_end - in_end) < 0.05,
          f'end frame linear {lin_end:.3f} vs easeIn {in_end:.3f}')

    refuses('bezierPoints are refused on a non-bezier easing', 'animate_effect_param',
            {'clipId': scene_block(0.5), 'effect': 'gaussian_blur', 'param': 'radius',
             'keyframes': [{'timeOffsetMs': 0, 'value': 0, 'easing': 'linear',
                            'bezierPoints': [0.1, 0.2, 0.3, 0.4]}]})


# ── motion path, point by point ────────────────────────────────────
def check_motion_path_points():
    """Bend a straight two-point path into a corner, move the corner, take it
    out again — measured as where the layer actually IS at half time."""
    c = scene_block(0.5)
    ok(call('set_motion_path', {'clipId': c, 'easing': 'linear',
                                'points': [{'x': 300, 'y': 180}, {'x': 1600, 'y': 900}]}), 'path')
    mid = DUR // 2
    straight = canvas_to_image((300 + 1600) / 2, (180 + 900) / 2)

    p0 = ink_centre(frame(mid))
    check('a two-point path puts the layer on the straight line',
          dist(p0, straight) < 25, f'centre {p0[0]:.0f},{p0[1]:.0f} vs line {straight[0]:.0f},{straight[1]:.0f}')

    if not STILL:
        ins = ok(call('add_motion_path_point', {'clipId': c, 'x': 300, 'y': 900, 'index': 1}), 'add pt')
        check('add_motion_path_point reports where it landed',
              ins['index'] == 1 and ins['pointCount'] == 3, f"index {ins['index']}, {ins['pointCount']} points")
    p1 = ink_centre(frame(mid))
    threshold('add_motion_path_point bends the path', dist(p0, p1), 150,
              f'centre {p0[0]:.0f},{p0[1]:.0f} -> {p1[0]:.0f},{p1[1]:.0f}')

    if not STILL:
        ok(call('update_motion_path_point', {'clipId': c, 'index': 1, 'x': 1600, 'y': 180}), 'upd pt')
    p2 = ink_centre(frame(mid))
    threshold('update_motion_path_point moves the corner', dist(p1, p2), 150,
              f'centre {p1[0]:.0f},{p1[1]:.0f} -> {p2[0]:.0f},{p2[1]:.0f}')

    if not STILL:
        ok(call('remove_motion_path_point', {'clipId': c, 'index': 1}), 'rm pt')
    p3 = ink_centre(frame(mid))
    threshold('remove_motion_path_point takes the corner out', dist(p2, p3), 150,
              f'centre {p2[0]:.0f},{p2[1]:.0f} -> {p3[0]:.0f},{p3[1]:.0f}')
    check('and the layer is back on the straight line', dist(p3, straight) < 25,
          f'centre {p3[0]:.0f},{p3[1]:.0f} vs line {straight[0]:.0f},{straight[1]:.0f}')

    if not STILL:
        ok(call('update_motion_path_point', {'clipId': c, 'index': 0, 'x': 1500, 'y': 900}), 'move end')
        pulled = ink_centre(frame(mid))
        ok(call('undo', {'steps': 1}), 'undo')
        check('update_motion_path_point is exactly one undo step',
              dist(pulled, p3) > 100 and dist(ink_centre(frame(mid)), p3) < 25,
              f'moved {dist(pulled, p3):.0f}px, one undo put it back')

    refuses('add_motion_path_point refuses an index past the end', 'add_motion_path_point',
            {'clipId': c, 'x': 10, 'y': 10, 'index': 9})
    refuses('update_motion_path_point refuses a bad index', 'update_motion_path_point',
            {'clipId': c, 'index': 9, 'x': 10, 'y': 10})
    refuses('remove_motion_path_point refuses a bad index', 'remove_motion_path_point',
            {'clipId': c, 'index': 9})


def check_motion_path_from_nothing():
    """The point tools have to be able to BUILD a path, not only edit one
    `set_motion_path` made — and a path of one point must drive nothing,
    which is what the tool's own reply claims."""
    c = scene_block(0.5)
    if not STILL:
        ok(call('add_motion_path_point', {'clipId': c, 'x': 200, 'y': 160}), 'pt1')
        two = ok(call('add_motion_path_point', {'clipId': c, 'x': 1700, 'y': 950}), 'pt2')
        check('add_motion_path_point builds a path from nothing',
              two['pointCount'] == 2 and two['pathDrivesLayer'] is True,
              f"{two['pointCount']} points, drives the layer")
    travel = dist(ink_centre(frame(30)), ink_centre(frame(DUR - 60)))
    threshold('a path built point by point moves the layer', travel, 200,
              f'centroid travels {travel:.0f}px')

    if not STILL:
        gone = ok(call('remove_motion_path_point', {'clipId': c, 'index': 1}), 'back to one')
        check('one point is not a path, and it says so',
              gone['pointCount'] == 1 and gone['pathDrivesLayer'] is False,
              str(gone.get('note'))[:64])
        back = ink_centre(frame(DUR // 2))
        check('with one point the layer sits at transform.x/y again',
              dist(back, CENTRE) < 20, f'centre {back[0]:.0f},{back[1]:.0f} vs {CENTRE[0]:.0f},{CENTRE[1]:.0f}')

    refuses('update_motion_path_point refuses a clip with no path',
            'update_motion_path_point', {'clipId': scene_block(0.5), 'index': 0, 'x': 5, 'y': 5})


TOOL_CHECKS = [
    ('remove_keyframe', check_remove_keyframe),
    ('move_keyframe time', check_move_keyframe_time),
    ('move_keyframe value', check_move_keyframe_value),
    ('set_keyframe_easing', check_keyframe_easing),
    ('set_keyframe_easing curves', check_keyframe_easing_curves),
    ('clear_keyframes', check_clear_keyframes),
    ('upsert_keyframe', check_upsert_keyframe),
    ('remove_effect_keyframe', check_remove_effect_keyframe),
    ('effect keyframe easing', check_effect_keyframe_easing),
    ('motion path points', check_motion_path_points),
    ('motion path from nothing', check_motion_path_from_nothing),
]


# ══════════════════════════════════════════════════════════════════
# volume, measured on the exported mix
# ══════════════════════════════════════════════════════════════════

def _tone(path, hz=1500, seconds=1.0):
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi',
                    '-i', f'sine=frequency={hz}:duration={seconds}',
                    '-c:a', 'aac', path], check=True)
    return path


def _buckets(mp4, n=8):
    """RMS of the exported mix in n equal slices.

    Sliced over the WAV's own length, not the project's: the mix is as
    long as the audio in it, and reading the buckets as if they spanned
    the whole timeline puts the middle of a ramp where its end should be
    — which is how this check first read as a failure when it was right.
    """
    wav = mp4 + '.wav'
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', mp4, '-vn', '-ac', '1',
                    '-ar', '48000', wav], capture_output=True, check=True)
    with wave.open(wav) as w:
        a = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(float) / 32768
    k = len(a) // n
    return [float(np.sqrt((a[i * k:(i + 1) * k] ** 2).mean())) for i in range(n)]


def _volume_scene():
    ok(call('reset_project', {'name': 'volkf', 'aspectRatio': '16:9', 'fps': 30,
                              'backgroundColor': '#000000', 'durationMs': 2000}), 'r')
    vt = ok(call('add_track', {'type': 'video', 'name': 'V'}), 't')['trackId']
    at = ok(call('add_track', {'type': 'audio', 'name': 'A'}), 't')['trackId']
    ok(call('add_shape_layer', {'kind': 'rectangle', 'trackId': vt,
                                'startTimeMs': 0, 'durationMs': 2000}), 's')
    tone = _tone(os.path.join(TMP, 'tone.m4a'))
    a = ok(call('import_media_from_path', {'path': tone, 'name': 'tone'}), 'i')['assetId']
    return ok(call('insert_clip', {'trackId': at, 'assetId': a, 'startTimeMs': 0}), 'ins')['clipId']


def _volume_render(tag, kfs=None):
    c = _volume_scene()
    # STILL holds the property flat: both keyframes at the same value, so
    # the machinery runs and the envelope must NOT move.
    #
    # At the LOUDEST of the two, not the first. Holding the 0.0 -> 1.0
    # row at its first value made the clip silent, and a silent clip
    # cannot move — the row passed for want of any signal rather than
    # because the envelope was flat, which is the thing a selftest is
    # supposed to rule out.
    if kfs:
        if STILL:
            loudest = max(k['value'] for k in kfs)
            kfs = [dict(k, value=loudest) for k in kfs]
        ok(call('add_keyframes', {'clipId': c, 'property': 'volume', 'keyframes': kfs}), 'kf')
    out = os.path.join(TMP, f'vol_{tag}.mp4')
    ok(call('render_export', {'outputPath': out, 'resolution': '720p'}), 'export')
    return _buckets(out)


def check_volume_keyframes():
    flat = _volume_render('flat')
    down = _volume_render('down', [{'timeOffsetMs': 0, 'value': 1.0},
                                   {'timeOffsetMs': 1000, 'value': 0.0}])
    up = _volume_render('up', [{'timeOffsetMs': 0, 'value': 0.0},
                               {'timeOffsetMs': 1000, 'value': 1.0}])

    # `threshold`, not `check`: these are measured rows, so they have to
    # face --selftest. Under it both keyframes carry the SAME value, the
    # export runs identically, and the envelope must then stay flat — a
    # ramp row that still passes with a flat envelope is measuring
    # encode noise, not the envelope.
    spread = max(flat) - min(flat)
    check('volume · an unkeyframed clip is flat', spread < 0.006,
          f'unkeyframed spread {spread:.4f} across the mix')

    threshold('volume · 1.0 -> 0.0 falls in the exported mix',
              down[0] - down[-1], 0.03,
              f'{down[0]:.4f} -> {down[-1]:.4f}')
    threshold('volume · 0.0 -> 1.0 rises in the exported mix',
              up[-1] - up[0], 0.03,
              f'{up[0]:.4f} -> {up[-1]:.4f}')

    # Separates "an envelope was applied" from "the RIGHT envelope was
    # applied": a ramp down and a ramp up must be each other's
    # reflection, not merely two different shapes. Under --selftest both
    # are flat, so the reflection is trivially true and this row is not
    # evidence there — hence `check`, which stands down.
    mirrored = abs(down[0] - up[-1]) < 0.01 and abs(down[-1] - up[0]) < 0.01
    check('volume · the two ramps mirror each other', mirrored,
          f'down ends {down[0]:.4f}/{down[-1]:.4f} vs up ends {up[0]:.4f}/{up[-1]:.4f}')


AUDIO_CHECKS = [('volume keyframes', check_volume_keyframes)]


if __name__ == '__main__':
    argv = [x for x in sys.argv[1:] if x != '--selftest']
    selftest = '--selftest' in sys.argv
    STILL = selftest
    only = argv[0] if argv else None
    if selftest:
        print('holding each property STILL and leaving each edit UNMADE — '
              'every row must now move LESS than its threshold')
    print('property                        start        end        change')
    results = []
    for name, scene, a, b, metric, need in TESTS:
        if only and only not in name: continue
        try:
            results.append((name, run_one(name, scene, a, b, metric, need, selftest)))
        except Exception as e:
            print(f"  ERROR {name}: {e}")
            results.append((name, False))

    print('\nvolume — the one that is audible rather than visible')
    for label, fn in AUDIO_CHECKS:
        if only and only not in label: continue
        try:
            fn()
        except Exception as e:
            print(f"  ERROR {label}: {e}")
            tool_results.append((label, False))

    print('\nediting an animation that is already there')
    for label, fn in TOOL_CHECKS:
        if only and only not in label: continue
        try:
            fn()
        except Exception as e:
            print(f"  ERROR {label}: {e}")
            tool_results.append((label, False))
    n_props = len(results)
    results += tool_results

    n = sum(1 for _, g in results if g)
    if selftest:
        print(f"\n{n}/{len(results)} thresholds discriminate — a still property and an unmade edit stay under them")
        bad = [x for x, g in results if not g]
        if bad: print('threshold does NOT discriminate:', ', '.join(bad))
    else:
        print(f"\n{n}/{len(results)} keyframe checks passed on pixels "
              f"({n_props} animatable properties, {len(tool_results)} on the editing tools)")
        bad = [x for x, g in results if not g]
        if bad: print('failing:', ', '.join(bad))
