"""
The three altitude tools, proved on RENDERED PIXELS.

    Kerf must be running.  python3 tools/verify_altitude.py [name-filter]
                           python3 tools/verify_altitude.py --selftest

`apply_look_preset`, `batch_apply` and `create_picture_in_picture` sit on
exactly the machinery that has failed silently in this codebase before:
`transform.scaleX` was settable, keyframeable, listed by
`list_properties`, reported back correctly on read — and rendered NOTHING
for text; `chromaKey` had five properties and zero references in the
compositor. A grade that reports thirteen filters written, or a PiP that
reports a 384x864 box, proves nothing at all. So every check here renders
a frame and measures it.

Three kinds of ground truth, all CONSTRUCTED here rather than borrowed:

  · a probe chart whose colour, tonal range, edge content and texture are
    chosen so every filter a look preset uses has something to bite on,
    and so the direction each grade must move a metric is predictable;
  · flat, saturated, KNOWN-SIZE plates for the picture-in-picture checks
    — a 400x900 portrait and a 1200x400 landscape over a dark red ground,
    so the inset's bounding box can be read straight out of the frame and
    compared against the geometry the tool reported;
  · a timeline built with a locked clip, a text clip and clips inside and
    outside a time window, so `batch_apply`'s skip report can be checked
    against a project whose right answer is known before the call.

`--selftest` re-runs the look-preset rows at strength 0 — the grade held
STILL — and requires every metric to move LESS than its threshold. A
threshold nobody has tried to fail is not a threshold; this is what says
the numbers these rows key on are driven by the grade and not by JPEG
noise or frame timing. The PiP rows carry their own negative control in
the main run: the same measured box is compared against the geometry for
a DIFFERENT corner and must be rejected.
"""
import sys, os, base64, io, json, time, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kerf_rpc import call, ok
import numpy as np
from PIL import Image

DUR = 4000
PROJ_W, PROJ_H = 1920, 1080

results = []


def check(label, good, detail):
    results.append((label, bool(good)))
    print(f"  {'PASS' if good else 'FAIL'}  {label:38s} {detail}")
    return bool(good)


# ── frame access ────────────────────────────────────────────────────
def raw_frame(ms=None):
    args = {'includeImage': True}
    if ms is not None:
        args['atMs'] = int(ms)
    return ok(call('get_frame_context', args), 'frame')['frame']


def frame(ms=None):
    f = raw_frame(ms)
    b = base64.b64decode(f['imageDataUrl'].split(',', 1)[1])
    return np.array(Image.open(io.BytesIO(b)).convert('RGB')).astype(float)


def settle(ms=None, tries=80):
    """Wait on `mediaPending`, not on the picture holding still.

    The compositor draws a dark gradient for undecoded media and that
    reads as a legitimately dark shot; every look-preset row here would
    measure the placeholder instead of the chart. `verify_frame_context`
    is what says this number is real."""
    for _ in range(tries):
        if raw_frame(ms).get('mediaPending', 0) == 0:
            return True
        time.sleep(0.08)
    raise RuntimeError('media never finished decoding')


# ── metrics · names match LookMetric in src/engine/lookPresets.ts ───
def luma(a):
    return 0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]


def hifreq(a):
    l = luma(a)
    return float(np.abs(l[1:-1, 1:-1] * 4 - l[:-2, 1:-1] - l[2:, 1:-1]
                        - l[1:-1, :-2] - l[1:-1, 2:]).mean())


def corner_vs_centre(a):
    l = luma(a)
    h, w = l.shape
    c = l[h // 3:2 * h // 3, w // 3:2 * w // 3].mean()
    k = np.mean([l[:h // 8, :w // 8].mean(), l[:h // 8, -w // 8:].mean(),
                 l[-h // 8:, :w // 8].mean(), l[-h // 8:, -w // 8:].mean()])
    return float(c - k)


METRICS = {
    'warmth':       lambda a: float(a[:, :, 0].mean() - a[:, :, 2].mean()),
    'greenMagenta': lambda a: float(a[:, :, 1].mean() - (a[:, :, 0].mean() + a[:, :, 2].mean()) / 2),
    'saturation':   lambda a: float((a.max(axis=2) - a.min(axis=2)).mean()),
    'contrast':     lambda a: float(luma(a).std()),
    'meanLuma':     lambda a: float(luma(a).mean()),
    'blackLevel':   lambda a: float(np.percentile(luma(a), 2)),
    'edges':        lambda a: float(np.abs(np.diff(luma(a), axis=0)).mean()
                                    + np.abs(np.diff(luma(a), axis=1)).mean()),
    'hueAngle':     lambda a: float(np.arctan2(np.sqrt(3) * (a[:, :, 1].mean() - a[:, :, 2].mean()),
                                               2 * a[:, :, 0].mean() - a[:, :, 1].mean() - a[:, :, 2].mean())),
}

# ── fixtures ────────────────────────────────────────────────────────
TMP = tempfile.mkdtemp(prefix='kerf-alt-')


def build_probe_chart(path, w=1920, h=1080, seed=19):
    """The still every look preset is measured against — built, not fetched.

    A grade with nothing to act on measures as a no-op even when it works,
    so this supplies, deliberately:

      · a smooth colour field well off neutral, so `warmth`, `hueAngle`
        and `greenMagenta` have a stable starting angle to move from;
      · blocks at three scales from near-black to near-white, so
        `contrast`, `blackLevel`, `highlights` and `shadows` have real
        ends to pull on and `brightness` has room before it clips;
      · saturated colour across the wheel, so `saturation` can move in
        both directions rather than only up;
      · hard block edges everywhere, for `sharpen` to enhance;
      · content into all four corners, since a vignette cannot darken a
        corner that is already black;
      · only light fine texture, so the grade is what the metrics see.

    Fixed seed: every threshold below is calibrated against this exact
    image and `--selftest` re-checks that they still separate a real grade
    from a neutral one.
    """
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    u, v = xx / w, yy / h

    r = 126 + 62 * np.sin(2.3 * np.pi * u + 0.4) + 30 * np.cos(1.1 * np.pi * v)
    g = 118 + 48 * np.sin(1.5 * np.pi * v + 2.1) + 28 * np.sin(3.1 * np.pi * u * v + 0.7)
    b = 122 + 58 * np.cos(1.7 * np.pi * v + 0.9) - 34 * np.sin(2.1 * np.pi * u)
    img = np.stack([r, g, b], axis=2)

    for scale, n in ((6, 16), (14, 44), (34, 96)):
        bh, bw = h // scale, w // scale
        for _ in range(n):
            y0 = int(rng.integers(0, h - bh))
            x0 = int(rng.integers(0, w - bw))
            img[y0:y0 + bh, x0:x0 + bw] += rng.uniform(-95, 100) + rng.uniform(-50, 50, 3)

    img += rng.normal(0, 2.0, (h, w, 3))
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(path)
    return path


def solid(path, w, h, rgb):
    Image.new('RGB', (w, h), rgb).save(path)
    return path


CHART = build_probe_chart(os.path.join(TMP, 'alt_probe_chart.png'))
#   dark red ground, bright green PORTRAIT plate, blue LANDSCAPE plate.
#   Flat and saturated so the inset's bounding box is unambiguous in the
#   rendered frame, and three different aspect ratios so a squashed inset
#   cannot pass as a correct one.
GROUND = solid(os.path.join(TMP, 'alt_ground.png'), 1920, 1080, (96, 0, 0))
PORTRAIT = solid(os.path.join(TMP, 'alt_portrait.png'), 400, 900, (0, 224, 0))
LANDSCAPE = solid(os.path.join(TMP, 'alt_landscape.png'), 1200, 400, (0, 96, 255))

_assets = {}


def asset(path, name):
    """Import once, and re-import if another suite empties the pool.

    `verify_project_format` opens constructed files whose `mediaPool` is
    `[]`, and `projectIO` REPLACES the pool rather than merging — so an
    asset imported at module load is gone for the life of the app after
    that suite runs, and every check here would report a red that says
    nothing about the code. Owning the asset and re-checking removes the
    ordering coupling."""
    got = _assets.get(name)
    if got is not None:
        pool = ok(call('list_media_pool', {}), 'pool')['assets']
        if any(a['id'] == got for a in pool):
            return got
    got = ok(call('import_media_from_path', {'path': path, 'name': name}), 'import')['assetId']
    _assets[name] = got
    return got


def reset(name='altitude'):
    ok(call('reset_project', {'name': name, 'aspectRatio': '16:9', 'fps': 30,
                              'backgroundColor': '#000000', 'durationMs': DUR}), 'reset')


def add_image(asset_id, track_id, start=0, props=None):
    cid = ok(call('insert_clip', {'assetId': asset_id, 'trackId': track_id,
                                  'startTimeMs': start}), 'insert')['clipId']
    patch = {'durationMs': DUR, 'fitMode': 'cover'}
    patch.update(props or {})
    ok(call('patch_clip', {'clipId': cid, 'properties': patch}), 'patch')
    return cid


# ══════════════════════════════════════════════════════════════════
#  A · apply_look_preset — every preset's own claim, on the frame
# ══════════════════════════════════════════════════════════════════
def scene_chart():
    reset('lookprobe')
    t = ok(call('add_track', {'type': 'video', 'name': 'Grade'}), 'track')['trackId']
    cid = add_image(asset(CHART, 'alt_probe_chart.png'), t)
    settle(100)
    return cid


def section_looks(selftest, only):
    print('\napply_look_preset · each preset states what must change, and it is measured')
    if selftest:
        print('  (selftest: the same grades at strength 0 — every row must now move LESS)')

    cid = scene_chart()
    catalogue = CATALOGUE

    # A stability floor: two identical frames, no edit between them. Every
    # threshold used below must be comfortably above this.
    settle(100)
    n0, n1 = frame(100), frame(100)
    drift = max(abs(METRICS[m](n1) - METRICS[m](n0)) for m in METRICS if m != 'hueAngle')
    hue_drift = abs(METRICS['hueAngle'](n1) - METRICS['hueAngle'](n0))
    check('frame metrics are stable', drift < 0.05 and hue_drift < 0.01,
          f'largest drift between two identical frames {drift:.4f} (hue {hue_drift:.5f}) — need < 0.05')

    for pid in catalogue:
        if only and only not in pid:
            continue
        # Neutral first, so each preset is measured against the same start.
        ok(call('apply_look_preset', {'preset': pid, 'clipIds': [cid], 'strength': 0}), 'neutral')
        settle(100)
        before = frame(100)

        res = ok(call('apply_look_preset',
                      {'preset': pid, 'clipIds': [cid],
                       'strength': 0 if selftest else 1}), f'look {pid}')
        settle(100)
        after = frame(100)

        if not selftest:
            check(f'{pid} · reports one clip', res['appliedTo'] == 1,
                  f"appliedTo={res['appliedTo']}, changed "
                  f"{len(res['clips'][0]['changed'])} of 13 filter paths")

        for exp in res['expect']:
            metric = METRICS[exp['metric']]
            m0, m1 = metric(before), metric(after)
            delta = m1 - m0
            need = exp['minChange']
            if selftest:
                good = abs(delta) < need
                want = f'want |Δ| < {need}'
            else:
                good = (delta >= need) if exp['direction'] == 'up' else (-delta >= need)
                want = f"need {exp['direction']} by {need}"
            check(f"{pid} · {exp['metric']} {exp['direction']}", good,
                  f'{m0:9.3f} -> {m1:9.3f}  Δ{delta:+8.3f}  ({want})')


def section_look_components():
    """Isolate the properties a whole-frame metric could otherwise hide.

    `punchy`'s edge-energy row is satisfied by any grade that raises
    contrast, so on its own it does not prove `sharpen` renders — and
    `sharpen` is one of the three properties this repo found rendering
    NOTHING while three built-in presets set it. Same for `grain` and
    `vignette`, which are drawn as overlay passes rather than through the
    filter string. So: apply the whole look, then zero exactly one
    property and require the metric that property owns to fall back.
    """
    print('\napply_look_preset · one property at a time, so no metric can cover for another')
    cid = scene_chart()

    for pid, path, metric, name, need in (
        ('punchy', 'filters.sharpen', METRICS['edges'], 'edge energy', 0.30),
        ('warm_filmic', 'filters.grain', hifreq, 'high-frequency energy', 0.40),
        ('high_contrast_mono', 'filters.vignette', corner_vs_centre, 'centre − corner luma', 8.0),
    ):
        ok(call('apply_look_preset', {'preset': pid, 'clipIds': [cid], 'strength': 0}), 'neutral')
        ok(call('apply_look_preset', {'preset': pid, 'clipIds': [cid]}), f'look {pid}')
        settle(100)
        withit = metric(frame(100))
        ok(call('patch_clip', {'clipId': cid, 'properties': {path: 0}}), 'zero')
        settle(100)
        without = metric(frame(100))
        check(f'{pid} · {path} is the thing moving {name}', withit - without >= need,
              f'{name} {without:.3f} without -> {withit:.3f} with  '
              f'Δ{withit - without:+.3f}  (need {need}, everything else in the grade held)')


CATALOGUE = ['warm_filmic', 'cold_teal', 'high_contrast_mono',
             'faded_lift', 'punchy', 'neon_shift']


def section_look_discrimination():
    """Does each expectation separate its OWN preset from the others?

    Holding the grade still and watching the metric not move (the phase
    above) only proves the number is not drifting on its own. It would
    still pass if every preset in the catalogue moved every metric the
    same way — which is a catalogue with one entry in it.

    So: render all six looks against the same start frame, then for each
    expectation row count how many of the OTHER five fail it. A row that
    nothing fails is a row that says nothing about which preset ran.
    """
    print('\n  (selftest phase 2: each row must REJECT at least one other preset)')
    cid = scene_chart()
    ok(call('apply_look_preset', {'preset': 'warm_filmic', 'clipIds': [cid], 'strength': 0}), 'neutral')
    settle(100)
    base = frame(100)

    frames, expects = {}, {}
    for pid in CATALOGUE:
        ok(call('apply_look_preset', {'preset': pid, 'clipIds': [cid], 'strength': 0}), 'neutral')
        res = ok(call('apply_look_preset', {'preset': pid, 'clipIds': [cid]}), f'look {pid}')
        settle(100)
        frames[pid] = frame(100)
        expects[pid] = res['expect']

    for pid, rows in expects.items():
        for exp in rows:
            metric = METRICS[exp['metric']]
            m0 = metric(base)
            rejected = []
            for other in CATALOGUE:
                if other == pid:
                    continue
                d = metric(frames[other]) - m0
                passes = (d >= exp['minChange']) if exp['direction'] == 'up' else (-d >= exp['minChange'])
                if not passes:
                    rejected.append(other)
            check(f"{pid} · {exp['metric']} discriminates", len(rejected) >= 1,
                  f"rejects {len(rejected)}/5 other preset(s): {', '.join(rejected) or 'NONE'}")


# ══════════════════════════════════════════════════════════════════
#  B · a look reaches every clip it says it did — measured per clip
# ══════════════════════════════════════════════════════════════════
def section_look_batch():
    print('\napply_look_preset · one call, three clips, each region measured separately')
    reset('lookbatch')
    a = asset(CHART, 'alt_probe_chart.png')
    ids = []
    for i, x in enumerate((-600, 0, 600)):
        t = ok(call('add_track', {'type': 'video', 'name': f'G{i}'}), 'track')['trackId']
        ids.append(add_image(a, t, props={'transform.scaleX': 0.3, 'transform.scaleY': 0.3,
                                          'transform.x': x, 'transform.y': 0,
                                          'name': f'shot {i + 1}'}))
    settle(100)
    before = frame(100)

    res = ok(call('apply_look_preset', {'preset': 'warm_filmic'}), 'look')
    settle(100)
    after = frame(100)

    check('3 clips in one call', res['appliedTo'] == 3,
          f"appliedTo={res['appliedTo']}, skipped={len(res['skipped'])}, "
          f"rejected={res['rejectedByPredicate']}")

    # Frame is half project size; each inset box is 576x324 project px.
    for i, cx in enumerate((180, 480, 780)):
        reg = (slice(230, 310), slice(cx - 120, cx + 120))
        w0 = METRICS['warmth'](before[reg])
        w1 = METRICS['warmth'](after[reg])
        check(f'clip {i + 1} region warmed', w1 - w0 >= 8,
              f'warmth {w0:7.2f} -> {w1:7.2f}  Δ{w1 - w0:+7.2f}  (need up by 8)')


# ══════════════════════════════════════════════════════════════════
#  C · the skip report is honest, and the "inert" claim is true
# ══════════════════════════════════════════════════════════════════
def section_look_skips():
    print('\napply_look_preset · skipped clips are named, and the reason is verified on pixels')
    reset('lookskip')
    a = asset(CHART, 'alt_probe_chart.png')
    tv = ok(call('add_track', {'type': 'video', 'name': 'V'}), 'track')['trackId']
    open_clip = add_image(a, tv, props={'name': 'open shot'})
    locked = add_image(a, tv, start=DUR, props={'name': 'locked shot', 'locked': True})
    tt = ok(call('add_track', {'type': 'text', 'name': 'T'}), 'track')['trackId']
    text = ok(call('add_text_layer', {'text': 'TITLE', 'trackId': tt,
                                      'startTimeMs': 0, 'durationMs': DUR}), 'text')['clipId']
    settle(100)

    res = ok(call('apply_look_preset', {'preset': 'cold_teal'}), 'look')
    ids_applied = {c['clipId'] for c in res['clips']}
    ids_skipped = {s['clipId']: s['reason'] for s in res['skipped']}

    check('open clip graded', open_clip in ids_applied, f'{len(ids_applied)} clip(s) graded')
    check('locked clip skipped, named', locked in ids_skipped and 'locked' in ids_skipped[locked],
          ids_skipped.get(locked, 'NOT REPORTED'))
    check('text clip skipped, reason names what it cannot draw',
          text in ids_skipped and 'text clips are not graded' in ids_skipped[text],
          ids_skipped.get(text, 'NOT REPORTED'))
    check('every clip accounted for',
          res['appliedTo'] + len(res['skipped']) + res['rejectedByPredicate'] == res['examined'],
          f"{res['appliedTo']} applied + {len(res['skipped'])} skipped + "
          f"{res['rejectedByPredicate']} rejected == {res['examined']} examined")

    # The catalogue claims temperature/tint/vignette/grain do not render on
    # a text clip. Force the grade onto the text clip and check BOTH halves
    # of that claim on the picture: the CSS-filter half must show, the
    # overlay half must not.
    reset('textinert')
    tt = ok(call('add_track', {'type': 'text', 'name': 'T'}), 'track')['trackId']
    text = ok(call('add_text_layer', {'text': 'INERT', 'trackId': tt,
                                      'startTimeMs': 0, 'durationMs': DUR}), 'text')['clipId']
    ok(call('patch_clip', {'clipId': text, 'properties': {
        'textStyle.fontSize': 220, 'textStyle.color': '#c08040',
        'textStyle.strokeWidth': 0, 'textStyle.shadowBlur': 0,
        'textStyle.kineticAnimation': 'none'}}), 'style')
    settle(100)
    t0 = frame(100)
    r = ok(call('apply_look_preset', {'preset': 'warm_filmic', 'clipIds': [text],
                                      'clipTypes': ['text']}), 'text look')
    settle(100)
    t1 = frame(100)

    inert = set(r['clips'][0].get('inertProperties', []))
    check('text clip: inert properties declared',
          {'filters.temperature', 'filters.grain', 'filters.vignette'} <= inert,
          f'declared inert: {sorted(inert)}')

    warm0, warm1 = METRICS['warmth'](t0), METRICS['warmth'](t1)
    # +34 temperature would paint a strong amber wash over the whole box.
    # The rest of warm_filmic (saturation, contrast, tone) acts only on the
    # glyphs, which are a small part of the frame, so the frame-wide warmth
    # barely moves. Anything under the look's own threshold of 8 is proof
    # the wash did not happen.
    check('text clip: temperature wash really renders nothing',
          abs(warm1 - warm0) < 4.0,
          f'frame warmth {warm0:.3f} -> {warm1:.3f}  Δ{warm1 - warm0:+.3f}  (need |Δ| < 4)')

    # …and the same look on an IMAGE clip moves it far past that, so the
    # threshold above is measuring the clip type and not a dead metric.
    reset('textinert2')
    tv = ok(call('add_track', {'type': 'video', 'name': 'V'}), 'track')['trackId']
    cid = add_image(asset(CHART, 'alt_probe_chart.png'), tv)
    settle(100)
    i0 = frame(100)
    ok(call('apply_look_preset', {'preset': 'warm_filmic', 'clipIds': [cid]}), 'img look')
    settle(100)
    i1 = frame(100)
    check('same look on an image clip does render it',
          METRICS['warmth'](i1) - METRICS['warmth'](i0) > 8,
          f"frame warmth {METRICS['warmth'](i0):.3f} -> {METRICS['warmth'](i1):.3f} "
          f"(need up by 8 — the control for the row above)")


# ══════════════════════════════════════════════════════════════════
#  D · create_picture_in_picture — geometry read off the frame
# ══════════════════════════════════════════════════════════════════
TOL = 4.0  # frame px; the frame is half project size, so 8 project px


def pip_scene():
    reset('pip')
    t = ok(call('add_track', {'type': 'video', 'name': 'BG'}), 'track')['trackId']
    bg = add_image(asset(GROUND, 'alt_ground.png'), t, props={'name': 'ground'})
    settle(100)
    return bg


def measure_box(img, mask):
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    return {'x0': float(xs.min()), 'x1': float(xs.max()), 'y0': float(ys.min()), 'y1': float(ys.max()),
            'w': float(xs.max() - xs.min() + 1), 'h': float(ys.max() - ys.min() + 1),
            'cx': float((xs.min() + xs.max()) / 2), 'cy': float((ys.min() + ys.max()) / 2)}


def green_mask(a):
    return (a[:, :, 1] > 130) & (a[:, :, 0] < 110) & (a[:, :, 2] < 110)


def blue_mask(a):
    return (a[:, :, 2] > 150) & (a[:, :, 0] < 110)


def expected_box(res, scale):
    b = res['box']
    return {'x0': b['leftPx'] * scale, 'y0': b['topPx'] * scale,
            'w': b['widthPx'] * scale, 'h': b['heightPx'] * scale,
            'cx': b['centerXPx'] * scale, 'cy': b['centerYPx'] * scale}


def box_error(measured, expected):
    return max(abs(measured['x0'] - expected['x0']), abs(measured['y0'] - expected['y0']),
               abs(measured['w'] - expected['w']), abs(measured['h'] - expected['h']))


def section_pip():
    print('\ncreate_picture_in_picture · the inset box measured in the rendered frame')

    # ── 1 · a PORTRAIT source in a LANDSCAPE frame keeps its aspect ──
    pip_scene()
    res = ok(call('create_picture_in_picture',
                  {'insetAssetId': asset(PORTRAIT, 'alt_portrait.png'), 'corner': 'top-right',
                   'sizePct': 20, 'maxHeightPct': 60}), 'pip portrait')
    settle(100)
    f = frame(100)
    scale = f.shape[1] / PROJ_W
    m = measure_box(f, green_mask(f))
    e = expected_box(res, scale)
    check('portrait inset is where it says', m is not None and box_error(m, e) <= TOL,
          f"measured {m['w']:.0f}x{m['h']:.0f} at ({m['x0']:.0f},{m['y0']:.0f}) · "
          f"reported {e['w']:.0f}x{e['h']:.0f} at ({e['x0']:.0f},{e['y0']:.0f}) · "
          f"max error {box_error(m, e):.1f}px (tol {TOL})")

    src_aspect = 400 / 900
    got = m['w'] / m['h']
    check('portrait inset is NOT squashed', abs(got - src_aspect) < 0.02,
          f'rendered {got:.4f}:1, source {src_aspect:.4f}:1, canvas '
          f'{PROJ_W / PROJ_H:.4f}:1 (a squash to the frame would read 1.78)')
    check('tool reports uniform scale', res['transform']['scaleX'] == res['transform']['scaleY']
          and res['aspect']['knownFrom'] == 'decoded',
          f"scaleX={res['transform']['scaleX']} scaleY={res['transform']['scaleY']} "
          f"aspect from {res['aspect']['knownFrom']}")

    # The tolerance has to be able to reject a wrong answer. The SAME
    # measurement against the opposite corner's geometry must fail it.
    res_bl = ok(call('create_picture_in_picture',
                     {'insetClipId': res['clipId'], 'corner': 'bottom-left',
                      'sizePct': 20, 'maxHeightPct': 60}), 'pip bl')
    e_bl = expected_box(res_bl, scale)
    check('tolerance rejects the wrong corner', box_error(m, e_bl) > TOL * 4,
          f'the top-right measurement is {box_error(m, e_bl):.0f}px from the bottom-left '
          f'geometry (tol {TOL})')

    settle(100)
    f = frame(100)
    m_bl = measure_box(f, green_mask(f))
    check('bottom-left corner lands bottom-left', box_error(m_bl, e_bl) <= TOL,
          f"measured ({m_bl['x0']:.0f},{m_bl['y0']:.0f}) · reported "
          f"({e_bl['x0']:.0f},{e_bl['y0']:.0f}) · error {box_error(m_bl, e_bl):.1f}px")

    # ── 2 · a LANDSCAPE source, same call, different aspect ─────────
    pip_scene()
    res = ok(call('create_picture_in_picture',
                  {'insetAssetId': asset(LANDSCAPE, 'alt_landscape.png'), 'corner': 'center', 'sizePct': 40}),
             'pip landscape')
    settle(100)
    f = frame(100)
    m = measure_box(f, blue_mask(f))
    e = expected_box(res, scale)
    check('landscape inset is where it says', box_error(m, e) <= TOL,
          f"measured {m['w']:.0f}x{m['h']:.0f} at ({m['x0']:.0f},{m['y0']:.0f}) · "
          f"error {box_error(m, e):.1f}px")
    check('landscape inset keeps 3.00:1', abs(m['w'] / m['h'] - 3.0) < 0.06,
          f"rendered {m['w'] / m['h']:.4f}:1, source 3.0000:1")
    check('sizePct means fraction of frame WIDTH',
          abs(m['w'] / f.shape[1] - 0.40) < 0.01,
          f"inset is {100 * m['w'] / f.shape[1]:.1f}% of the frame width (asked 40%)")
    check('inset paints ON TOP of the background',
          bool(blue_mask(f)[int(m['cy']), int(m['cx'])]),
          f"the pixel at the inset centre is {f[int(m['cy']), int(m['cx'])].astype(int).tolist()}, "
          f"the ground is [96,0,1]")

    # ── 3 · the height ceiling wins over sizePct, and says so ───────
    pip_scene()
    res = ok(call('create_picture_in_picture',
                  {'insetAssetId': asset(PORTRAIT, 'alt_portrait.png'), 'corner': 'center',
                   'sizePct': 60, 'maxHeightPct': 50}), 'pip capped')
    settle(100)
    f = frame(100)
    m = measure_box(f, green_mask(f))
    check('height ceiling is enforced on the frame',
          abs(m['h'] / f.shape[0] - 0.50) < 0.01 and res.get('constrainedBy') == 'maxHeight',
          f"inset is {100 * m['h'] / f.shape[0]:.1f}% of frame height (ceiling 50%), "
          f"tool reported constrainedBy={res.get('constrainedBy')}")
    check('a capped inset is still not squashed', abs(m['w'] / m['h'] - 400 / 900) < 0.02,
          f"rendered {m['w'] / m['h']:.4f}:1, source {400 / 900:.4f}:1")

    # ── 4 · explicit position ───────────────────────────────────────
    pip_scene()
    res = ok(call('create_picture_in_picture',
                  {'insetAssetId': asset(LANDSCAPE, 'alt_landscape.png'), 'positionPct': {'x': 25, 'y': 75},
                   'sizePct': 30}), 'pip explicit')
    settle(100)
    f = frame(100)
    m = measure_box(f, blue_mask(f))
    check('positionPct centres the inset there',
          abs(m['cx'] - 0.25 * f.shape[1]) <= TOL and abs(m['cy'] - 0.75 * f.shape[0]) <= TOL,
          f"centre measured ({m['cx']:.0f},{m['cy']:.0f}) · asked "
          f"({0.25 * f.shape[1]:.0f},{0.75 * f.shape[0]:.0f})")

    # ── 5 · border, radius and shadow, each on the picture ──────────
    pip_scene()
    res = ok(call('create_picture_in_picture',
                  {'insetAssetId': asset(LANDSCAPE, 'alt_landscape.png'), 'corner': 'center', 'sizePct': 40,
                   'border': {'widthPx': 12, 'color': '#ffffff'}}), 'pip border')
    settle(100)
    f = frame(100)
    white = (f[:, :, 0] > 200) & (f[:, :, 1] > 200) & (f[:, :, 2] > 200)
    wb = measure_box(f, white)
    bb = measure_box(f, blue_mask(f))
    e = expected_box(res, scale)
    check('border renders at the inset edge',
          wb is not None and box_error(wb, e) <= TOL and int(white.sum()) > 1000,
          f"{int(white.sum())} white px, ring box {wb['w']:.0f}x{wb['h']:.0f} vs inset "
          f"{e['w']:.0f}x{e['h']:.0f}")
    check('border is inside the box, not outside',
          bb['x0'] - wb['x0'] >= 3 and bb['x0'] - wb['x0'] <= 10,
          f"blue starts {bb['x0'] - wb['x0']:.0f} frame px inside the white edge "
          f"(12 project px = 6 frame px)")

    pip_scene()
    res = ok(call('create_picture_in_picture',
                  {'insetAssetId': asset(LANDSCAPE, 'alt_landscape.png'), 'corner': 'center', 'sizePct': 40,
                   'cornerRadiusPx': 90}), 'pip radius')
    settle(100)
    f = frame(100)
    m = measure_box(f, blue_mask(f))
    corner = f[int(m['y0']) + 2, int(m['x0']) + 2]
    centre = f[int(m['cy']), int(m['cx'])]
    # `mask.rotation` was in ANIMATABLE_PROPERTIES and drawn by
    # `traceMaskPath`, but had no row in PROPERTY_SCHEMA — so patch_clip
    # answered `Unknown property path "mask.rotation"` and the PiP mask
    # patch came back carrying that warning while looking successful.
    check('the rounded-corner mask patch is clean',
          not any('mask.rotation' in w for w in res.get('warnings', [])),
          f"warnings: {res.get('warnings', []) or 'none'}")
    check('cornerRadiusPx rounds the corner off',
          not blue_mask(f)[int(m['y0']) + 2, int(m['x0']) + 2] and blue_mask(f)[int(m['cy']), int(m['cx'])],
          f'top-left corner pixel {corner.astype(int).tolist()} (the ground), '
          f'centre {centre.astype(int).tolist()} (the inset)')

    pip_scene()
    res = ok(call('create_picture_in_picture',
                  {'insetAssetId': asset(LANDSCAPE, 'alt_landscape.png'), 'corner': 'center', 'sizePct': 40}),
             'pip square')
    settle(100)
    f = frame(100)
    m = measure_box(f, blue_mask(f))
    check('radius 0 leaves the corner square',
          bool(blue_mask(f)[int(m['y0']) + 2, int(m['x0']) + 2]),
          f'top-left corner pixel {f[int(m["y0"]) + 2, int(m["x0"]) + 2].astype(int).tolist()} '
          f'— the control for the row above')

    pip_scene()
    res = ok(call('create_picture_in_picture',
                  {'insetAssetId': asset(LANDSCAPE, 'alt_landscape.png'), 'corner': 'center', 'sizePct': 40,
                   'shadow': {'blurPx': 40, 'opacity': 90, 'offsetY': 24}}), 'pip shadow')
    settle(100)
    f = frame(100)
    m = measure_box(f, blue_mask(f))
    band = f[int(m['y1']) + 6:int(m['y1']) + 24, int(m['x0']) + 20:int(m['x1']) - 20]
    far = f[8:40, 20:200]
    shadow_band = float(band.mean())
    check('drop shadow darkens the ground below the inset',
          'drop_shadow' in res['effects'] and shadow_band < far.mean() - 12,
          f'ground under the inset {shadow_band:.1f} vs away from it {far.mean():.1f}')

    res = ok(call('create_picture_in_picture',
                  {'insetClipId': res['clipId'], 'corner': 'center', 'sizePct': 40,
                   'cornerRadiusPx': 90, 'shadow': {'blurPx': 40, 'opacity': 90}}),
             'pip shadow+radius')
    check('shadow + radius is refused, not silently dropped',
          'drop_shadow' not in res['effects']
          and any('clips the drop shadow away' in w for w in res.get('warnings', [])),
          f"effects={res['effects']}, warned: "
          f"{'yes' if res.get('warnings') else 'NO'}")
    settle(100)
    f = frame(100)
    m = measure_box(f, blue_mask(f))
    band = f[int(m['y1']) + 6:int(m['y1']) + 24, int(m['x0']) + 20:int(m['x1']) - 20]
    check('…and the frame agrees there is no shadow',
          band.mean() > far.mean() - 6,
          f'ground under the inset {band.mean():.1f} vs away from it {far.mean():.1f} '
          f'— the same band read {shadow_band:.1f} when the shadow WAS added')

    # ── 6 · re-running does not stack effects ───────────────────────
    again = ok(call('create_picture_in_picture',
                    {'insetClipId': res['clipId'], 'corner': 'top-left', 'sizePct': 25,
                     'border': {'widthPx': 8, 'color': '#ffff00'}}), 'pip again')
    props = ok(call('list_properties', {'clipId': res['clipId']}), 'props')
    outlines = [p for p in props['properties'] if p['path'] == 'effects.outline.width']
    check('re-running replaces the border rather than stacking one',
          len(outlines) == 1 and again['effects'] == ['outline'],
          f"{len(outlines)} outline effect(s) on the clip, this call added {again['effects']}")


# ══════════════════════════════════════════════════════════════════
#  E · batch_apply — the report, checked against a known timeline
# ══════════════════════════════════════════════════════════════════
def batch_scene():
    """Eleven clips whose right answer is known before the call.

    V1: three chart clips at 0 / 4s / 8s, one of them LOCKED.
    V2: two chart clips named so a regex can pick one.
    T1: one text clip — a type the image predicates must reject.
    """
    reset('batch')
    a = asset(CHART, 'alt_probe_chart.png')
    t1 = ok(call('add_track', {'type': 'video', 'name': 'V1 · Main'}), 'track')['trackId']
    t2 = ok(call('add_track', {'type': 'video', 'name': 'V2 · Inserts'}), 'track')['trackId']
    tt = ok(call('add_track', {'type': 'text', 'name': 'T1 · Titles'}), 'track')['trackId']

    ids = {}
    ids['early'] = add_image(a, t1, 0, {'name': 'A early shot', 'transform.scaleX': 0.3,
                                        'transform.scaleY': 0.3, 'transform.x': -600})
    ids['mid'] = add_image(a, t1, 4000, {'name': 'B mid shot', 'transform.scaleX': 0.3,
                                         'transform.scaleY': 0.3, 'transform.x': 0})
    ids['late'] = add_image(a, t1, 8000, {'name': 'C late shot', 'transform.scaleX': 0.3,
                                          'transform.scaleY': 0.3, 'transform.x': 600})
    ids['insert1'] = add_image(a, t2, 0, {'name': 'INSERT one', 'transform.scaleX': 0.22,
                                          'transform.scaleY': 0.22, 'transform.x': -600,
                                          'transform.y': 330})
    ids['insert2'] = add_image(a, t2, 0, {'name': 'INSERT two', 'transform.scaleX': 0.22,
                                          'transform.scaleY': 0.22, 'transform.x': 600,
                                          'transform.y': 330})
    ids['title'] = ok(call('add_text_layer', {'text': 'TITLE', 'trackId': tt,
                                              'startTimeMs': 0, 'durationMs': DUR}),
                      'text')['clipId']
    ok(call('patch_clip', {'clipId': ids['insert2'], 'properties': {'locked': True}}), 'lock')
    settle(100)
    return ids


def region(a, cx, cy, half=90):
    return a[int(cy - half // 2):int(cy + half // 2), int(cx - half):int(cx + half)]


def section_batch():
    print('\nbatch_apply · the skip report checked against a timeline whose answer is known')
    ids = batch_scene()
    by_id = {v: k for k, v in ids.items()}

    before = frame(100)
    res = ok(call('batch_apply', {'clipTypes': ['image'],
                                  'properties': {'filters.saturation': -100}}), 'batch')
    settle(100)
    after = frame(100)

    applied = {c['clipId'] for c in res['clips']}
    skipped = {s['clipId']: s['reason'] for s in res['skippedClips']}
    rejected = {r['clipId']: r['reason'] for r in res['rejectedClips']}

    check('applied names exactly the unlocked image clips',
          applied == {ids['early'], ids['mid'], ids['late'], ids['insert1']},
          f'applied to {sorted(by_id[i] for i in applied)}')
    check('the locked clip is skipped WITH a reason',
          ids['insert2'] in skipped and 'locked' in skipped[ids['insert2']],
          skipped.get(ids['insert2'], 'NOT REPORTED'))
    check('the text clip is rejected, naming the predicate',
          ids['title'] in rejected and 'clipTypes' in
          [p['predicate'] for p in res['predicates']],
          rejected.get(ids['title'], 'NOT REPORTED'))
    check('no clip is unaccounted for',
          res['applied'] + res['skipped'] + res['rejected'] == res['totalClips'] == 6,
          f"{res['applied']} applied + {res['skipped']} skipped + {res['rejected']} rejected "
          f"== {res['totalClips']} total")

    # The report is only worth what the picture says. INSERT one is at
    # x=-600,y=330 -> frame (180, 435); INSERT two at (780, 435).
    s_ok0 = METRICS['saturation'](region(before, 180, 435, 60))
    s_ok1 = METRICS['saturation'](region(after, 180, 435, 60))
    s_lk0 = METRICS['saturation'](region(before, 780, 435, 60))
    s_lk1 = METRICS['saturation'](region(after, 780, 435, 60))
    check('the applied clip really desaturated', s_ok0 - s_ok1 > 15,
          f'saturation {s_ok0:.2f} -> {s_ok1:.2f}  Δ{s_ok1 - s_ok0:+.2f}  (need down by 15)')
    check('the locked clip really did NOT', abs(s_lk1 - s_lk0) < 1.0,
          f'saturation {s_lk0:.2f} -> {s_lk1:.2f}  Δ{s_lk1 - s_lk0:+.2f}  (need |Δ| < 1)')

    res = ok(call('batch_apply', {'clipIds': [ids['insert2']], 'includeLocked': True,
                                  'properties': {'filters.saturation': -100}}), 'batch locked')
    settle(100)
    after2 = frame(100)
    s_lk2 = METRICS['saturation'](region(after2, 780, 435, 60))
    check('includeLocked reaches it, and the frame agrees',
          res['applied'] == 1 and s_lk0 - s_lk2 > 15,
          f'saturation {s_lk0:.2f} -> {s_lk2:.2f}  Δ{s_lk2 - s_lk0:+.2f}  (need down by 15)')

    # ── dryRun writes nothing ───────────────────────────────────────
    ids = batch_scene(); by_id = {v: k for k, v in ids.items()}
    before = frame(100)
    res = ok(call('batch_apply', {'clipTypes': ['image'], 'dryRun': True,
                                  'properties': {'filters.brightness': -80}}), 'dry')
    settle(100)
    after = frame(100)
    delta = float(np.abs(after - before).mean())
    check('dryRun changes no pixels', delta < 0.5 and res['dryRun'] is True,
          f'mean abs frame difference {delta:.4f} (need < 0.5), '
          f"and it still planned {res['applied']} clip(s)")
    check('dryRun still reports the before/after it would write',
          all(c['changed'] and c['changed'][0]['to'] == -80 for c in res['clips']),
          f"{sum(len(c['changed']) for c in res['clips'])} planned change(s), "
          f"first: {res['clips'][0]['changed'][0]}")
    # A dry run must answer with what the REAL run would do. Asking for a
    # text-only property on image clips must come back refused, not
    # planned — a preview that over-promises is worse than no preview.
    dry = ok(call('batch_apply', {'clipTypes': ['image'], 'dryRun': True,
                                  'properties': {'filters.contrast': 20,
                                                 'textStyle.fontSize': 40}}), 'dry mixed')
    wet = ok(call('batch_apply', {'clipTypes': ['image'],
                                  'properties': {'filters.contrast': 20,
                                                 'textStyle.fontSize': 40}}), 'wet mixed')
    dry_paths = sorted({c['path'] for cl in dry['clips'] for c in cl['changed']})
    wet_paths = sorted({c['path'] for cl in wet['clips'] for c in cl['changed']})
    check('dryRun plans exactly what the real run writes',
          dry_paths == wet_paths == ['filters.contrast']
          and all('textStyle.fontSize' in ' '.join(cl.get('failed', [])) for cl in dry['clips']),
          f'dry planned {dry_paths}, real wrote {wet_paths}; '
          f"dry refused: {dry['clips'][0].get('failed', ['NOTHING'])[0][:60]}")

    # …and the same call for real does move it, so the row above is not
    # measuring a patch that could never have worked.
    ok(call('batch_apply', {'clipTypes': ['image'],
                            'properties': {'filters.brightness': -80}}), 'wet')
    settle(100)
    wet = frame(100)
    check('the same patch NOT in dryRun does change pixels',
          float(np.abs(wet - before).mean()) > 3,
          f'mean abs frame difference {float(np.abs(wet - before).mean()):.3f} (need > 3)')

    # ── time range ──────────────────────────────────────────────────
    ids = batch_scene(); by_id = {v: k for k, v in ids.items()}
    res = ok(call('batch_apply', {'startMs': 0, 'endMs': 3000, 'clipTypes': ['image'],
                                  'properties': {'filters.saturation': -100}}), 'range')
    applied = {c['clipId'] for c in res['clips']}
    rejected = {r['clipId']: r['reason'] for r in res['rejectedClips']}
    check('time range picks only the overlapping clips',
          applied == {ids['early'], ids['insert1']},
          f'applied to {sorted(by_id[i] for i in applied)} (early + insert1 span 0–4000ms)')
    check('out-of-range clips say WHY they were excluded',
          ids['late'] in rejected and 'does not overlap' in rejected[ids['late']],
          rejected.get(ids['late'], 'NOT REPORTED'))

    settle(100)
    at_early = frame(100)
    at_late = frame(9000)
    check('the range really graded the early clip and not the late one',
          METRICS['saturation'](region(at_early, 180, 270)) < 12
          and METRICS['saturation'](region(at_late, 780, 270)) > 25,
          f"saturation at 0.1s {METRICS['saturation'](region(at_early, 180, 270)):.2f} "
          f"(graded), at 9s {METRICS['saturation'](region(at_late, 780, 270)):.2f} (not)")

    # ── name match ──────────────────────────────────────────────────
    ids = batch_scene(); by_id = {v: k for k, v in ids.items()}
    res = ok(call('batch_apply', {'nameMatch': '/^INSERT/', 'properties': {'transform.opacity': 0.5}}),
             'name')
    applied = {c['clipId'] for c in res['clips']}
    check('a /regex/ nameMatch selects by name',
          applied == {ids['insert1']} and any(
              r['clipId'] == ids['early'] and 'does not match' in r['reason']
              for r in res['rejectedClips']),
          f"applied to {sorted(by_id[i] for i in applied)}; INSERT two is locked and skipped")

    # ── relative ────────────────────────────────────────────────────
    ids = batch_scene(); by_id = {v: k for k, v in ids.items()}
    ok(call('patch_clip', {'clipId': ids['early'], 'properties': {'filters.contrast': 10}}), 'seed')
    ok(call('patch_clip', {'clipId': ids['mid'], 'properties': {'filters.contrast': 40}}), 'seed')
    res = ok(call('batch_apply', {'clipIds': [ids['early'], ids['mid']], 'relative': True,
                                  'properties': {'filters.contrast': 15}}), 'relative')
    moves = {c['clipId']: c['changed'][0] for c in res['clips']}
    check('relative adds per clip instead of flattening them',
          moves[ids['early']]['to'] == 25 and moves[ids['mid']]['to'] == 55,
          f"10 -> {moves[ids['early']]['to']}, 40 -> {moves[ids['mid']]['to']}")

    # ── bad input is loud ───────────────────────────────────────────
    r = call('batch_apply', {'clipTypes': ['image'], 'properties': {'filters.nonsense': 5}})
    check('a wholly unknown property is an error, not a silent no-op',
          r['result']['success'] is False and 'filters.nonsense' in r['result']['error'],
          r['result'].get('error', json.dumps(r))[:90])

    res = ok(call('batch_apply', {'clipTypes': ['image'],
                                  'properties': {'filters.contrast': 30, 'filters.nonsense': 5}}),
             'mixed')
    check('a mix reports the bad path and still applies the good one',
          res.get('unknownProperties') and res['applied'] > 0
          and all(any(c['path'] == 'filters.contrast' for c in cl['changed']) for cl in res['clips']),
          f"unknownProperties={[u['path'] for u in res['unknownProperties']]}, "
          f"applied to {res['applied']} clip(s)")

    r = call('batch_apply', {'nameMatch': 'nothing-is-called-this', 'properties': {'filters.contrast': 5}})
    check('an empty match is an error carrying the arithmetic',
          r['result']['success'] is False and 'examined' in r['result']['error'],
          r['result'].get('error', '')[:100])

    # ── limit ───────────────────────────────────────────────────────
    ids = batch_scene(); by_id = {v: k for k, v in ids.items()}
    res = ok(call('batch_apply', {'clipTypes': ['image'], 'limit': 2,
                                  'properties': {'filters.contrast': 30}}), 'limit')
    check('limit reports the untouched remainder as skipped',
          res['applied'] == 2 and any('limit of 2' in s['reason'] for s in res['skippedClips']),
          f"{res['applied']} applied, {res['skipped']} skipped: "
          f"{[s['reason'][:24] for s in res['skippedClips']]}")


# ══════════════════════════════════════════════════════════════════
if __name__ == '__main__':
    argv = [x for x in sys.argv[1:] if not x.startswith('--')]
    selftest = '--selftest' in sys.argv
    only = argv[0] if argv else None

    if selftest:
        print('holding each grade at strength 0 — every row must now move LESS than its threshold')
        section_looks(True, only)
        if not only:
            section_look_discrimination()
    else:
        section_looks(False, only)
        if not only:
            section_look_components()
            section_look_batch()
            section_look_skips()
            section_pip()
            section_batch()

    n = sum(1 for _, g in results if g)
    if selftest:
        print(f'\n{n}/{len(results)} thresholds discriminate — a neutral grade stays under them')
    else:
        print(f'\n{n}/{len(results)} altitude checks passed on pixels')
    bad = [x for x, g in results if not g]
    if bad:
        print('failing:', ', '.join(bad))
    sys.exit(0 if n == len(results) and results else 1)
