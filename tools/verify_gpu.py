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
import sys, os, base64, io, time
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


# ═══════════════════════════════════════════════════════════════════
# MESH WARPS, GPU TRANSITIONS, AND THE FALLBACK
#
# Everything above ran a fragment program over a flat quad. Everything
# below runs on a subdivided mesh whose VERTICES move, or on a transition
# that used to be done on the 2D canvas, or on the 2D canvas because the
# GPU has been switched off underneath it.
#
# The ground truth is a straight line. A warp that leaves a straight line
# straight has not warped anything, however different the frame looks —
# and "the frame looks different" is the assertion a static gradient, a
# tint or a dropped alpha channel would all pass. Every geometric check
# below measures how far a line that was straight has stopped being
# straight, in pixels of the rendered frame.
#
#   python3 tools/verify_gpu.py --selftest
#
# re-runs each of them on an input that CANNOT produce the effect — the
# amount at zero, the speed at zero, the progress at zero, the GPU
# switched off — and requires every metric to fall BELOW its threshold.
# A threshold nobody has tried to fail is not a threshold.
# ═══════════════════════════════════════════════════════════════════

SELFTEST = '--selftest' in sys.argv

def restore_gpu():
    try:
        call('set_gpu_stage', {'enabled': True})
    except Exception:
        pass

def gpu(enabled):
    return ok(call('set_gpu_stage', {'enabled': enabled}), 'set_gpu_stage')

def gate(label, value, need, detail, invert=False):
    """`value` must exceed `need` — or, under --selftest, fall below it.

    The direction is printed as well as applied. An inverted row whose
    detail string still reads "need a rise > 6.0px" while the row passes
    on a fall is a PASS line that says the opposite of what was checked,
    which is the kind of thing these suites exist to catch."""
    good = value < need if invert else value > need
    if invert:
        detail = f'{detail}   ·  INVERTED: {value:.4f} must NOT clear {need}'
    print(f"  {'PASS' if good else 'FAIL'}  {label:34s} {detail}")
    return good

# ── ground truth ────────────────────────────────────────────────────
import tempfile
TMP = tempfile.mkdtemp(prefix='kerf-gpu-')

def build_rule_chart(path, w=1920, h=1080, cells=12):
    """A ruled grid over a two-tone checkerboard.

    Ruled, not photographic, and for one reason: after a warp you can say
    exactly where every line went. A photograph warps into another
    plausible photograph and the only thing you can assert about it is
    that it changed, which a tint would also satisfy."""
    img = np.zeros((h, w, 3), np.float64)
    cw = w // cells
    ch = h // max(1, (cells * h) // w)
    yy, xx = np.mgrid[0:h, 0:w]
    dark = (((xx // cw) + (yy // ch)) % 2) == 0
    img[..., 0] = np.where(dark, 30, 190)
    img[..., 1] = np.where(dark, 45, 150)
    img[..., 2] = np.where(dark, 90, 60)
    img[((xx % cw) < 4) | ((yy % ch) < 4)] = 255
    Image.fromarray(img.astype(np.uint8)).save(path)
    return path

CHART = build_rule_chart(os.path.join(TMP, 'gpu_rule_chart.png'))
_chart = None

def chart_asset():
    """Owned by this suite, and re-imported if something empties the pool.

    `verify_project_format` opens files whose mediaPool is `[]`, and
    `projectIO` REPLACES the live pool rather than merging — so a suite
    that borrows a seeded asset is green once and red for the rest of the
    process's life. See NEXT.md on why that cost an hour."""
    global _chart
    if _chart is not None:
        pool = ok(call('list_media_pool', {}), 'pool')['assets']
        if any(a['id'] == _chart for a in pool):
            return _chart
    _chart = ok(call('import_media_from_path',
                     {'path': CHART, 'name': 'gpu_rule_chart.png'}), 'import')['assetId']
    return _chart

def wait_frame(ms):
    """Like `frame`, but waits for the media to decode.

    `get_frame_context` hands back a frame whose media has not finished
    decoding, and the compositor draws a dark gradient for it — which
    reads as a legitimately dark shot. `mediaPending` is what says so."""
    for _ in range(60):
        f = ok(call('get_frame_context', {'atMs': int(ms), 'includeImage': True}), 'frame')['frame']
        if not f.get('mediaPending'):
            break
        time.sleep(0.1)
    b = base64.b64decode(f['imageDataUrl'].split(',', 1)[1])
    return np.array(Image.open(io.BytesIO(b)).convert('RGB')).astype(float)

def reset(bg='#000000'):
    ok(call('reset_project', {'name': 'gpumesh', 'aspectRatio': '16:9', 'fps': 30,
                              'backgroundColor': bg, 'durationMs': 4000}), 'reset')
    return ok(call('add_track', {'type': 'video', 'name': 'M'}), 'track')['trackId']

def full_chart(track):
    c = ok(call('insert_clip', {'assetId': chart_asset(), 'trackId': track,
                                'startTimeMs': 0}), 'insert')['clipId']
    ok(call('patch_clip', {'clipId': c, 'properties': {
        'durationMs': 4000, 'fitMode': 'cover'}}), 'patch')
    return c

def bar(track, sx=4.2, sy=0.10):
    """One straight white bar. The whole geometric argument rests on it."""
    c = ok(call('add_shape_layer', {'kind': 'rectangle', 'trackId': track, 'startTimeMs': 0,
                                    'durationMs': 4000,
                                    'style': {'fill': '#ffffff', 'strokeWidth': 0}}), 'bar')['clipId']
    ok(call('patch_clip', {'clipId': c, 'properties': {
        'transform.scaleX': sx, 'transform.scaleY': sy}}), 'patch')
    return c

def bend(a, floor=40.0):
    """How far a horizontal line has stopped being horizontal, in pixels.

    The ink's centre of mass down each column. A straight bar puts it at
    the same row in every column, so the spread is zero; a wave puts it
    somewhere different in each, and the spread IS the amplitude of the
    warp measured on the rendered frame."""
    lum = a.mean(axis=2)
    w = np.clip(lum - floor, 0, None)
    total = w.sum(axis=0)
    live = total > 1.0
    if live.sum() < 20:
        return 0.0
    rows = np.arange(a.shape[0])[:, None]
    return float(np.std(((w * rows).sum(axis=0)[live]) / total[live]))

def kept(a, ref, axis):
    """What share of `ref`'s detail along one axis survives in `a`."""
    def e(x):
        lum = 0.299*x[:,:,0] + 0.587*x[:,:,1] + 0.114*x[:,:,2]
        return float(np.abs(np.diff(lum, axis=axis)).mean())
    r = e(ref)
    return e(a) / r if r > 1e-6 else 0.0

def rb_split(a):
    """How far red and blue have been pulled apart, per pixel."""
    return float(np.abs(a[:, :, 0] - a[:, :, 2]).mean())

def pure_blue(a):
    """Pixels that are the reverse of the sheet and nothing else.

    The chart has no blue like this in it — its darkest tile is a navy
    with red and green in it — so a count of saturated blue is a count of
    "the back of the page is showing here"."""
    return int(((a[:, :, 2] > 200) & (a[:, :, 0] < 70) & (a[:, :, 1] < 70)).sum())

# ── 5 · a mesh warp bends a straight line, and the bend MOVES ───────
#
# Both halves matter and neither alone is enough. A static distortion
# passes "the line is bent"; a pan or a fade passes "the frame changed
# between two times". Only bending AND moving is a field.
try:
    print("\nmesh warps · a straight white bar, and where it went")

    def wave_run(effect, params, need_bend, need_move):
        t = reset()
        b = bar(t)
        straight = bend(wait_frame(100))
        ok(call('add_effect', {'clipId': b, 'effectType': effect, 'params': params}), effect)
        curved = bend(wait_frame(100))
        results.append(gate(f'{effect} bends the bar', curved - straight, need_bend,
                            f'row spread {straight:.2f}px -> {curved:.2f}px  '
                            f'(need a rise > {need_bend}px)', invert=SELFTEST))
        shots = [wait_frame(ms) for ms in (100, 300, 500, 700)]
        move = min(float(np.abs(shots[i+1] - shots[i]).mean()) for i in range(3))
        results.append(gate(f'{effect} moves', move, need_move,
                            f'smallest frame-to-frame change {move:.3f}  '
                            f'(need > {need_move})', invert=SELFTEST))

    null = {'amount': 0, 'speed': 0} if SELFTEST else {}
    wave_run('flag_wave', {'amount': 55, 'waves': 2.5, 'speed': 55, 'angle': 0, **null}, 6.0, 0.30)
    # The ripple's centre is deliberately NOT on the bar. Put it there and
    # the displacement along the bar is purely horizontal — the ink slides
    # left and right and the row spread stays at 0.95px, which is a real
    # warp reading as no warp. The first version of this row did exactly
    # that and failed; the bug was in the probe, not the shader.
    wave_run('ripple', {'amount': 55, 'rings': 4, 'speed': 60, 'falloff': 12,
                        'centerX': 50, 'centerY': 8, **null}, 6.0, 0.30)

    # ── 6 · page curl: the fold, the reverse, and the reveal ────────
    #
    # A fragment program maps each destination pixel to one source texel.
    # It has no way to show two parts of the same sheet in one place with
    # one of them in front — which is precisely what a fold is, and what
    # the depth buffer in `runShader`'s mesh path is for.
    print("\npage curl · the sheet folds over itself and leaves the frame")
    t = reset()
    ground = ok(call('add_shape_layer', {'kind': 'rectangle', 'trackId': t, 'startTimeMs': 0,
                'durationMs': 4000, 'style': {'fill': '#c81e1e', 'strokeWidth': 0}}), 'g')['clipId']
    ok(call('patch_clip', {'clipId': ground, 'properties': {
        'name': 'Red ground', 'transform.scaleX': 4.2, 'transform.scaleY': 2.4}}), 'p')
    ground_only = wait_frame(100)
    sheet = full_chart(t)
    flat = wait_frame(100)
    red_flat = float(flat[:, :, 0].mean())

    ok(call('add_effect', {'clipId': sheet, 'effectType': 'page_curl',
                           'params': {'progress': 0, 'radius': 12, 'angle': 315,
                                      'backColor': '#0000ff', 'backShow': 0}}), 'curl')
    at0 = wait_frame(100)
    # Progress 0 must be pixel-IDENTICAL, not merely close: a point on the
    # curl line has travelled zero arc length, so there is nothing to
    # round off. This is also the row that would catch the mesh itself
    # being wrong — a grid that does not reproduce the flat quad exactly
    # would show up here and nowhere else.
    same = float(np.abs(at0 - flat).mean())
    results.append(gate('progress 0 changes nothing', 0.5 - same, 0.0,
                        f'mean abs difference from no curl at all {same:.4f}  (need < 0.5)'))

    ok(call('set_effect_param', {'clipId': sheet, 'effect': 'page_curl', 'param': 'progress',
                                 'value': 0 if SELFTEST else 65}), 'p65')
    curled = wait_frame(100)
    results.append(gate('the curl reveals the ground',
                        float(curled[:, :, 0].mean()) - red_flat, 20.0,
                        f'red {red_flat:.1f} -> {float(curled[:,:,0].mean()):.1f}  '
                        f'(need a rise > 20)', invert=SELFTEST))
    results.append(gate('the fold shows the sheet its own back', pure_blue(curled), 12000,
                        f'{pure_blue(curled)} px of the reverse are visible, in a frame whose '
                        f'chart contains {pure_blue(flat)}  (need > 12000)', invert=SELFTEST))

    ok(call('set_effect_param', {'clipId': sheet, 'effect': 'page_curl', 'param': 'progress',
                                 'value': 0 if SELFTEST else 100}), 'p100')
    gone = wait_frame(100)
    left = float(np.abs(gone - ground_only).mean())
    results.append(gate('at progress 100 the sheet has left', 0.5 - left, 0.0,
                        f'frame vs the ground with no sheet at all: {left:.4f}  (need < 0.5)',
                        invert=SELFTEST))

    # ── 7 · shading is separable from geometry ──────────────────────
    #
    # `shadeFor` is normalised so a FLAT surface returns exactly 1.0. If
    # it were not, every warp would darken its own untouched regions the
    # moment shading was switched on, and "the picture changed" would
    # stop distinguishing a displaced pixel from a merely dimmer one.
    print("\nshading · the light comes from the surface, not from a gradient")
    ok(call('set_effect_param', {'clipId': sheet, 'effect': 'page_curl',
                                 'param': 'progress', 'value': 0}), 'p0')
    ok(call('set_effect_param', {'clipId': sheet, 'effect': 'page_curl',
                                 'param': 'shading', 'value': 0}), 'sh0')
    s0 = wait_frame(100)
    ok(call('set_effect_param', {'clipId': sheet, 'effect': 'page_curl',
                                 'param': 'shading', 'value': 100}), 'sh100')
    s1 = wait_frame(100)
    quiet = float(np.abs(s1 - s0).mean())
    results.append(gate('shading leaves a flat sheet alone', 0.5 - quiet, 0.0,
                        f'shading 0 -> 100 with the sheet flat moved it by {quiet:.4f}  '
                        f'(need < 0.5)'))

    ok(call('set_effect_param', {'clipId': sheet, 'effect': 'page_curl', 'param': 'progress',
                                 'value': 0 if SELFTEST else 55}), 'p55')
    ok(call('set_effect_param', {'clipId': sheet, 'effect': 'page_curl',
                                 'param': 'shading', 'value': 0}), 'sh0')
    c0 = wait_frame(100)
    ok(call('set_effect_param', {'clipId': sheet, 'effect': 'page_curl',
                                 'param': 'shading', 'value': 100}), 'sh100')
    c1 = wait_frame(100)
    lit = float(np.abs(c1 - c0).mean())
    results.append(gate('...and lights the curl', lit, 1.5,
                        f'the same change across a curl moved it by {lit:.3f}  (need > 1.5)',
                        invert=SELFTEST))

    # ── 8 · keyframes reach the GPU ─────────────────────────────────
    #
    # They did not. `gpuEffects` read `effect.params` straight off the
    # clip — the raw stored value, keyframes ignored — while the 2D hooks
    # one function away went through `resolveEffectParams`. Every GPU
    # effect was frozen at its first value, with `displace` declaring all
    # four of its parameters animatable, `list_properties` reporting them
    # as animatable, and `animate_effect_param` accepting and storing the
    # keyframes. Same shape as `mask.rotation`.
    print("\nkeyframes on a GPU effect")
    t = reset()
    sheet = full_chart(t)
    ok(call('add_effect', {'clipId': sheet, 'effectType': 'page_curl',
                           'params': {'progress': 0, 'radius': 12}}), 'curl')
    stops = ([{'timeOffsetMs': 0, 'value': 0}, {'timeOffsetMs': 2000, 'value': 0}] if SELFTEST
             else [{'timeOffsetMs': 0, 'value': 0}, {'timeOffsetMs': 2000, 'value': 90}])
    ok(call('animate_effect_param', {'clipId': sheet, 'effect': 'page_curl',
                                     'param': 'progress', 'keyframes': stops}), 'kf')
    walked = float(np.abs(wait_frame(1600) - wait_frame(200)).mean())
    results.append(gate('a keyframed progress animates', walked, 5.0,
                        f'frame at 200ms vs 1600ms differs by {walked:.3f}  (need > 5.0)',
                        invert=SELFTEST))

    # ── 9 · transitions: what the GPU actually bought ───────────────
    #
    # All fourteen already worked, so these are quality claims, and a
    # quality claim has to be falsifiable. Each is measured on the GPU
    # path AND on the 2D path it replaced, and the 2D reading is required
    # to FAIL the same test — otherwise "the GPU does it too" would pass.
    print("\ntransitions · measured against the 2D path they replace")
    t = reset()
    sheet = full_chart(t)
    reference = wait_frame(1000)              # past the transition: unblurred
    ok(call('apply_transition', {'clipId': sheet,
                                 'transitionType': 'none' if SELFTEST else 'whip_pan',
                                 'durationMs': 800, 'position': 'in'}), 'whip')
    ratio = {}
    for on in (True, False):
        gpu(on)
        mid = wait_frame(300)[:, 560:]        # where the panning clip actually is
        ref = reference[:, 560:]
        across = kept(mid, ref, 1)            # detail along x — vertical edges
        along = kept(mid, ref, 0)             # detail along y — horizontal edges
        ratio[on] = along / max(across, 1e-6)
        print(f'      {"GPU" if on else "2D "} whip: kept {along:6.1%} of the detail across the '
              f'pan and {across:6.1%} along it  ->  {ratio[on]:.2f}x')
    gpu(True)
    results.append(gate('whip_pan streaks DIRECTIONALLY', ratio[True], 1.6,
                        f'detail perpendicular to the pan survives {ratio[True]:.2f}x better than '
                        f'detail along it  (need > 1.6)', invert=SELFTEST))
    good = ratio[False] < 1.6
    print(f"  {'PASS' if good else 'FAIL'}  {'...the gaussian does not (control)':34s} "
          f'the 22px blur it replaces manages {ratio[False]:.2f}x  (must stay under 1.6)')
    results.append(good)

    # The 2D glitch's channel split sits inside the `clip.mediaUrl` branch
    # of `renderClipPass`, so a text or a shape clip got a glitch
    # transition with no glitch in it at all. Measured, not asserted.
    t = reset()
    tt = ok(call('add_track', {'type': 'text', 'name': 'T'}), 'track')['trackId']
    tc = ok(call('add_text_layer', {'text': 'KERF', 'trackId': tt, 'startTimeMs': 0,
                                    'durationMs': 4000}), 'text')['clipId']
    ok(call('patch_clip', {'clipId': tc, 'properties': {
        'transform.scaleX': 3, 'transform.scaleY': 3}}), 'p')
    ok(call('apply_transition', {'clipId': tc,
                                 'transitionType': 'none' if SELFTEST else 'glitch',
                                 'durationMs': 800, 'position': 'in'}), 'glitch')
    split = {}
    for on in (True, False):
        gpu(on)
        split[on] = rb_split(wait_frame(250))
    gpu(True)
    results.append(gate('glitch splits channels on TEXT', split[True] - split[False], 0.8,
                        f'red-vs-blue separation  GPU {split[True]:.3f}   2D {split[False]:.3f}  '
                        f'(need the GPU ahead by > 0.8)', invert=SELFTEST))

    # ── 10 · the fallback, constructed rather than asserted ─────────
    #
    # "A machine with no GPU gets a film without a key, not a crash."
    # This IS that machine: `set_gpu_stage {enabled:false}` makes
    # `context()` return null, which is the same return a browser with no
    # WebGL gives, so every caller takes the branch it would take there.
    #
    # And the bar is not "it did not throw". It is that the frame comes
    # back UNWARPED and pixel-identical to the frame with no effect on the
    # clip at all, and still lit — a fallback that renders something else
    # is a second look nobody asked for, and a black frame is a crash that
    # returned 200.
    print("\nno-WebGL fallback · every GPU effect, with the stage switched off")
    for effect, params in (
        ('page_curl', {'progress': 60}),
        ('flag_wave', {'amount': 60, 'waves': 3}),
        ('ripple',    {'amount': 60, 'rings': 4}),
        ('displace',  {'amount': 90, 'scale': 10}),
        ('chroma_key', None),
    ):
        t = reset()
        sheet = full_chart(t)
        clean = wait_frame(150)
        if params is None:
            ok(call('patch_clip', {'clipId': sheet, 'properties': {
                'chromaKey.enabled': True, 'chromaKey.targetColorHex': '#1e2d5a',
                'chromaKey.similarity': 45, 'chromaKey.smoothness': 20,
                'chromaKey.spill': 40}}), 'key')
        else:
            ok(call('add_effect', {'clipId': sheet, 'effectType': effect, 'params': params}), effect)
        gpu(True)
        on = wait_frame(150)
        gpu(False)
        off = wait_frame(150)
        gpu(True)
        with_gpu = float(np.abs(on - clean).mean())
        without = float(np.abs(off - clean).mean())
        lit = float(off.mean())
        good = with_gpu > 3.0 and without < 0.5 and lit > 20.0
        print(f"  {'PASS' if good else 'FAIL'}  {effect + ' falls back to 2D':34s} "
              f'GPU moves the frame {with_gpu:6.2f}; without it moves {without:.4f} '
              f'and the frame is still lit (mean {lit:.1f}, need > 20)')
        results.append(good)

    off_state = ok(call('set_gpu_stage', {'enabled': False}), 'off')
    on_state = ok(call('set_gpu_stage', {'enabled': True}), 'on')
    good = (off_state['enabled'] is False and on_state['enabled'] is True
            # the switch must not pretend the hardware went away
            and off_state['webglAvailable'] is True
            and off_state['gpuTransitions'] == []
            and sorted(on_state['gpuTransitions']) == ['glitch', 'whip_pan']
            and 'page_curl' in on_state['gpuEffects'])
    print(f"  {'PASS' if good else 'FAIL'}  {'the switch reports honestly':34s} "
          f'off: webglAvailable {off_state["webglAvailable"]}, '
          f'gpuTransitions {off_state["gpuTransitions"]}; '
          f'on: {on_state["gpuTransitions"]}, '
          f'{len(on_state["gpuEffects"])} effects')
    results.append(good)

finally:
    restore_gpu()

n = sum(1 for r in results if r)
mode = '  (--selftest: every threshold held BELOW its bar)' if SELFTEST else ''
print(f"\n{n}/{len(results)} GPU-stage checks passed on pixels{mode}")
