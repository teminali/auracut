"""
Clip ops, the effect stack, markers and in/out — checked on the artifact.

    Kerf must be running.  python3 tools/verify_clip_ops.py [--selftest]

Seventeen store actions had no tool, and every one of them returned
`void`: `duplicateClip`, `renameClip`, `deleteSelected`, `moveClips`,
`splitAtPlayhead`, `closeGapsOnTrack`, `detachAudio`, `reverseClip`,
`clearEffects`, `toggleEffect`, `reorderEffect`, `removeMarker`,
`updateMarker`, `clearMarkers`, `setInPoint`, `setOutPoint`,
`clearInOut`. A wrapper around a void action reports success for an
unknown id, a locked clip, a playhead over nothing and an index already
at the end of the stack, which is the bug this repository has now found
seven times. So nothing here asserts on the store: every check measures
rendered pixels, an exported waveform, or a save/open round trip.

Three of these were the ones most likely to be decorative, and each got
the check that would have caught it:

  · `reorderEffect` — the compositor runs the effect stack in array
    order, so a black letterbox bar painted BEFORE a 'lighter' glow is
    lifted by it and the same bar painted AFTER is pure black. Same two
    effects, same parameters, only the order different. If that had
    rendered the same picture, either the reorder did nothing or the
    renderer applies effects in a fixed order, and both are findings.
  · reversed SOUND — a 300Hz-to-3000Hz sweep, because a constant tone
    sounds identical backwards and is the one input that cannot tell
    you whether reversal happened. It did not, for a long time; the
    rows now assert that it does, that the two ends MIRROR rather than
    merely differ, and that `describe_audio_preview` still admits
    playback cannot do it.
  · `reverseClip` — sampled on the EXPORTED FILE, because
    `get_frame_context` does not await a video seek and `render_export`
    does. A constructed clip whose picture moves left to right; reversed
    it must move right to left. `speed.reversed === true` proves nothing.
  · in and out points — measured against what `render_export` actually
    writes. This suite once asserted that they were PREVIEW ONLY, which
    was the honest thing to record at the time: `ExportConfig` had no
    in/out field, `runHardwareExport` always rendered frame 0 to
    `durationMs`, and the ExportModal's "range only" checkbox fed a
    label and nothing else. That is fixed, so the rows below assert the
    opposite — and they assert it on CONTENT, not on a frame count. A
    range export that writes 30 frames of the WRONG second has exactly
    the frame count the fix is supposed to produce.

`--selftest` re-runs every pixel and waveform row with the scene held
STILL — the same machinery exercised, the same metric read, and a
compensating edit so nothing should move — and demands each one now
move LESS than its bar. A threshold nobody has tried to fail is not a
threshold.
"""
import sys, os, io, base64, wave, time, subprocess, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kerf_rpc import call, ok
import numpy as np
from PIL import Image

TMP = tempfile.mkdtemp(prefix='kerf-clipops-')
SR = 48000
SELFTEST = '--selftest' in sys.argv

results = []


def check(label, good, detail):
    print(f"  {'PASS' if good else 'FAIL'}  {label:44s} {detail}")
    results.append(good)


def refuses(label, name, args, want=None):
    """A tool that declined must THROW, not report success."""
    r = call(name, args).get('result', {})
    if r.get('success'):
        check(label, False, f'{name} REPORTED SUCCESS on a call that must refuse')
        return
    err = str(r.get('error', ''))
    good = want is None or want.lower() in err.lower()
    check(label, good, f'refused: {err[:88]}')


# ── media the checks are built from ─────────────────────────────────

def build_chart(path, w=1920, h=1080, seed=7):
    """A still with real content at every scale, so a filter has something
    to act on. A frame that averages to grey measures as a no-op even
    when the effect works."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    u, v = xx / w, yy / h
    r = 120 + 70 * np.sin(2.1 * np.pi * u + 0.6) + 35 * np.cos(1.3 * np.pi * v)
    g = 105 + 45 * np.sin(1.7 * np.pi * v + 1.9) + 30 * np.sin(2.9 * np.pi * u * v + 0.3)
    b = 135 + 65 * np.cos(1.9 * np.pi * v + 0.2) - 40 * np.sin(2.3 * np.pi * u)
    img = np.stack([r, g, b], axis=2)
    for scale, n in ((6, 14), (14, 40), (34, 90)):
        bh, bw = h // scale, w // scale
        for _ in range(n):
            y0 = int(rng.integers(0, h - bh)); x0 = int(rng.integers(0, w - bw))
            img[y0:y0 + bh, x0:x0 + bw] += rng.uniform(-90, 95) + rng.uniform(-45, 45, 3)
    img += rng.normal(0, 2.2, (h, w, 3))
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(path)
    return path


RAMP_MS = 2000


def build_ramp(path, w=640, h=360, fps=30, block=120):
    """A clip whose picture CHANGES OVER TIME, built here so the mirror is
    known: a white block crossing the frame left to right in two seconds,
    over a 440Hz tone. `reverseClip` is checked against this.

    The frames are drawn here rather than with ffmpeg's `drawbox`, whose
    x expression is evaluated ONCE at filter-configure time in ffmpeg 8 —
    `t` is undefined there, so the box silently never renders. That
    produced a source with no block in it and a reverse check that could
    only ever have compared two empty frames. Drawing the pixels here
    means the ground truth is not something that can quietly stop being
    true."""
    frames = os.path.join(TMP, 'ramp-frames')
    os.makedirs(frames, exist_ok=True)
    n = int(RAMP_MS / 1000 * fps)
    for i in range(n):
        img = np.zeros((h, w, 3), np.uint8)
        x0 = int(round((i / (n - 1)) * (w - block)))
        img[h // 2 - block // 2:h // 2 + block // 2, x0:x0 + block] = 255
        Image.fromarray(img).save(os.path.join(frames, f'f{i:04d}.png'))
    subprocess.run([
        'ffmpeg', '-y', '-v', 'error',
        '-framerate', str(fps), '-i', os.path.join(frames, 'f%04d.png'),
        '-f', 'lavfi', '-i', f'sine=frequency=440:sample_rate={SR}:duration={RAMP_MS / 1000}',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-crf', '16',
        '-c:a', 'aac', '-b:a', '128k', '-shortest', path,
    ], check=True)

    # The check is only as good as the file it reads, so prove the block
    # is really in the source and really moves before trusting it.
    left = ink_cx(export_frame(path, 0.10))
    right = ink_cx(export_frame(path, RAMP_MS / 1000 - 0.10))
    if not (left >= 0 and right - left > 200):
        raise SystemExit(
            f'ERROR: the probe clip does not move (block centre-x {left} -> {right}); '
            'the reverse check would be meaningless.')
    return path


# ── reading the picture ─────────────────────────────────────────────

def raw_frame(ms):
    return ok(call('get_frame_context', {'atMs': int(ms), 'includeImage': True}), 'frame')['frame']


def frame(ms, tries=60):
    """The composited frame, once nothing in it is still a placeholder.

    The compositor draws a dark gradient for undecoded media, which reads
    as a legitimately dark shot — measuring it measures nothing."""
    f = raw_frame(ms)
    for _ in range(tries):
        if f.get('mediaPending', 0) == 0:
            break
        time.sleep(0.08)
        f = raw_frame(ms)
    return np.array(Image.open(io.BytesIO(
        base64.b64decode(f['imageDataUrl'].split(',', 1)[1]))).convert('RGB')).astype(float)


def luma(a):
    return 0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]


def mean_luma(a):
    return float(luma(a).mean())


def top_band(a, rows=60):
    """Mean luma of the letterbox bar. The whole reorder check lives here:
    bar-then-glow lifts it, glow-then-bar leaves it at zero."""
    return float(luma(a)[:rows, :].mean())


def ink(a, thr=40):
    return float((luma(a) > thr).sum())


def ink_left(a, thr=40):
    return float((luma(a[:, :a.shape[1] // 2]) > thr).sum())


def ink_centre(a, thr=40):
    ys, xs = np.nonzero(luma(a) > thr)
    if not len(xs):
        return None
    return float(xs.mean()), float(ys.mean())


def ink_cx(a, thr=128):
    ys, xs = np.nonzero(luma(a) > thr)
    return float(xs.mean()) if len(xs) else -1.0


def edges(a):
    return float(np.abs(np.diff(luma(a), axis=1)).mean())


def diff(a, b):
    return float(np.abs(a - b).mean())


# ── reading the exported file ───────────────────────────────────────

def render(name, dur_ms=RAMP_MS, resolution='720p'):
    out = os.path.join(TMP, f'{name}.mp4')
    data = ok(call('render_export', {'resolution': resolution, 'durationMs': dur_ms,
                                     'outputPath': out}), f'render {name}')
    return out, data


def has_audio_stream(path):
    p = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a',
                        '-show_entries', 'stream=index', '-of', 'csv=p=0', path],
                       capture_output=True, text=True)
    return bool(p.stdout.strip())


def export_rms(path):
    """RMS of the exported mix. Zero when nothing reached it."""
    if not has_audio_stream(path):
        return 0.0
    wav = path + '.wav'
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', path, '-vn', '-ac', '1',
                    '-ar', str(SR), '-c:a', 'pcm_s16le', wav], check=True)
    with wave.open(wav) as w:
        n = w.getnframes()
        if n == 0:
            return 0.0
        x = np.frombuffer(w.readframes(n), dtype='<i2').astype(float) / 32768
    return float(np.sqrt((x ** 2).mean()))


def export_frame(path, seconds):
    png = os.path.join(TMP, f'{os.path.basename(path)}-{seconds:.2f}.png')
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', path, '-ss', str(seconds),
                    '-frames:v', '1', png], check=True)
    return np.array(Image.open(png).convert('RGB')).astype(float)


def build_sweep(path, w=320, h=180, fps=30):
    """A clip whose SOUND changes over time — 300Hz rising to 3000Hz.

    A constant tone cannot tell you which way it is playing, which is
    exactly how "reversed" could look done for audio while doing nothing.
    """
    dur = RAMP_MS / 1000
    subprocess.run([
        'ffmpeg', '-y', '-v', 'error',
        '-f', 'lavfi', '-i', f'color=c=gray:s={w}x{h}:r={fps}:d={dur}',
        '-f', 'lavfi', '-i',
        f"aevalsrc='0.5*sin(2*PI*(300*t + 2700*t*t/(2*{dur})))':s={SR}:d={dur}",
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
        '-c:a', 'aac', '-b:a', '128k', '-shortest', path,
    ], check=True)
    return path


def dominant_hz(x):
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    return float(np.fft.rfftfreq(len(x), 1 / SR)[int(np.argmax(spec))])


def export_pcm(path):
    wav = path + '.pcm.wav'
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', path, '-vn', '-ac', '1',
                    '-ar', str(SR), '-c:a', 'pcm_s16le', wav], check=True)
    with wave.open(wav) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(float) / 32768


CHART = build_chart(os.path.join(TMP, 'chart.png'))
RAMP = build_ramp(os.path.join(TMP, 'ramp.mp4'))
SWEEP = build_sweep(os.path.join(TMP, 'sweep.mp4'))


# ── scenes ──────────────────────────────────────────────────────────

def fresh(duration_ms=4000, name='clipops'):
    ok(call('reset_project', {'name': name, 'aspectRatio': '16:9', 'fps': 30,
                              'backgroundColor': '#000000', 'durationMs': duration_ms}), 'reset')
    return ok(call('add_track', {'type': 'video', 'name': 'V'}), 'track')['trackId']


def shape(track, start, dur, x=0, label='Shape'):
    c = ok(call('add_shape_layer', {'kind': 'rectangle', 'trackId': track,
                                    'startTimeMs': start, 'durationMs': dur,
                                    'style': {'fill': '#ffffff', 'strokeWidth': 0}}), 'shape')['clipId']
    ok(call('patch_clip', {'clipId': c, 'properties': {
        'name': label, 'transform.x': x, 'transform.y': 0,
        'transform.scaleX': 0.4, 'transform.scaleY': 0.4}}), 'style')
    return c


def chart_scene(duration_ms=4000):
    """One full-frame still, so an effect acts on the whole canvas."""
    t = fresh(duration_ms, 'chartscene')
    a = ok(call('import_media_from_path', {'path': CHART, 'name': 'chart'}), 'import')['assetId']
    c = ok(call('insert_clip', {'assetId': a, 'trackId': t, 'startTimeMs': 0}), 'insert')['clipId']
    ok(call('patch_clip', {'clipId': c, 'properties': {
        'durationMs': duration_ms, 'fitMode': 'cover',
        'transform.scaleX': 1, 'transform.scaleY': 1}}), 'fill')
    return t, c


def ramp_scene():
    t = fresh(RAMP_MS, 'rampscene')
    a = ok(call('import_media_from_path', {'path': RAMP, 'name': 'ramp'}), 'import')['assetId']
    c = ok(call('insert_clip', {'assetId': a, 'trackId': t, 'startTimeMs': 0}), 'insert')['clipId']
    ok(call('patch_clip', {'clipId': c, 'properties': {
        'fitMode': 'cover', 'transform.scaleX': 1, 'transform.scaleY': 1}}), 'fill')
    return t, c


def clips_by_id():
    d = ok(call('describe_timeline'), 'describe')
    return {c['id']: c for tr in d['tracks'] for c in tr['clips']}, d


# ═══════════════════════════════════════════════════════════════════
#  METRIC ROWS — each runs twice: for real, and held still
# ═══════════════════════════════════════════════════════════════════

def m_reorder_effect(still):
    """Two effects whose composition does not commute. `letterbox` paints
    opaque black bars with source-over; `glow` adds light with 'lighter'.
    Bar-then-glow lifts the bar; glow-then-bar buries the glow under it."""
    _, c = chart_scene()
    ok(call('add_effect', {'clipId': c, 'effectType': 'letterbox',
                           'params': {'ratio': 2.39, 'color': '#000000', 'softness': 0}}), 'letterbox')
    ok(call('add_effect', {'clipId': c, 'effectType': 'glow',
                           'params': {'radius': 120, 'threshold': 100,
                                      'tint': '#ffffff', 'streak': 1}}), 'glow')
    m0 = top_band(frame(500))
    ok(call('reorder_effect', {'clipId': c, 'effect': 'glow', 'direction': 'earlier'}), 'reorder')
    if still:
        # Put it straight back: same machinery twice, net zero.
        ok(call('reorder_effect', {'clipId': c, 'effect': 'glow', 'direction': 'later'}), 'reorder back')
    return m0, top_band(frame(500)), 'letterbox bar luma'


def m_toggle_effect(still):
    _, c = chart_scene()
    ok(call('add_effect', {'clipId': c, 'effectType': 'glow',
                           'params': {'radius': 120, 'threshold': 100,
                                      'tint': '#ffffff', 'streak': 1}}), 'glow')
    m0 = mean_luma(frame(500))
    ok(call('toggle_effect', {'clipId': c, 'effect': 'glow'}), 'toggle off')
    if still:
        ok(call('toggle_effect', {'clipId': c, 'effect': 'glow'}), 'toggle on')
    return m0, mean_luma(frame(500)), 'frame luma with glow on/off'


def m_clear_effects(still):
    t, c = chart_scene()
    decoy = shape(t, 3000, 900, x=0, label='Decoy')          # no effects on it
    ok(call('add_effect', {'clipId': c, 'effectType': 'glow',
                           'params': {'radius': 120, 'threshold': 100,
                                      'tint': '#ffffff', 'streak': 1}}), 'glow')
    m0 = mean_luma(frame(500))
    # Still: clear a clip that has nothing on it — the real no-op path.
    ok(call('clear_effects', {'clipId': decoy if still else c}), 'clear')
    return m0, mean_luma(frame(500)), 'frame luma before/after clearing'


def m_duplicate_clip(still):
    """The copy must RENDER. It lands immediately after the original, so
    a frame taken inside the copy's span was black and must not be."""
    t = fresh(6000)
    a = shape(t, 0, 1000, x=0, label='Original')
    m0 = ink(frame(1500))
    args = {'clipId': a}
    if still:
        args['startTimeMs'] = 4000                            # lands outside the sample
    ok(call('duplicate_clip', args), 'duplicate')
    return m0, ink(frame(1500)), 'lit pixels at 1500ms'


def m_close_gaps(still):
    t = fresh(6000)
    shape(t, 0, 1000, x=-500, label='A')
    shape(t, 2000, 1000, x=500, label='B')
    gapless = ok(call('add_track', {'type': 'video', 'name': 'Gapless'}), 'track')['trackId']
    shape(gapless, 4000, 500, x=0, label='C')
    m0 = ink(frame(1500))
    ok(call('close_gaps_on_track', {'trackId': gapless if still else t}), 'close gaps')
    return m0, ink(frame(1500)), 'lit pixels in the gap at 1500ms'


def m_move_clips(still):
    t = fresh(6000)
    a = shape(t, 0, 800, x=-600, label='A')
    b = shape(t, 900, 800, x=0, label='B')
    c = shape(t, 1800, 800, x=600, label='C')
    m0 = ink(frame(3200))
    if still:
        # Same batch call, every clip moved to where it already is.
        moves = [{'clipId': a, 'startTimeMs': 0}, {'clipId': b, 'startTimeMs': 900},
                 {'clipId': c, 'startTimeMs': 1800}]
    else:
        moves = [{'clipId': a, 'startTimeMs': 3000}, {'clipId': b, 'startTimeMs': 3000},
                 {'clipId': c, 'startTimeMs': 3000}]
    ok(call('move_clips', {'moves': moves}), 'move_clips')
    return m0, ink(frame(3200)), 'lit pixels at 3200ms'


def m_delete_selected(still):
    t = fresh(4000)
    a = shape(t, 0, 1000, x=-600, label='Left')
    shape(t, 0, 1000, x=600, label='Right')
    elsewhere = shape(t, 2000, 1000, x=-600, label='Elsewhere')
    m0 = ink_left(frame(500))
    ok(call('select_clips', {'clipIds': [elsewhere if still else a]}), 'select')
    ok(call('delete_selected', {}), 'delete_selected')
    return m0, ink_left(frame(500)), 'lit pixels in the left half at 500ms'


def m_reverse_clip(still):
    """Sampled on the EXPORT, because that is the only path that awaits a
    video seek. The block crosses left to right in two seconds; reversed
    it must cross right to left, so a frame near the START mirrors."""
    _, c = ramp_scene()
    forward, _ = render('rev-forward')
    m0 = ink_cx(export_frame(forward, 0.20))
    ok(call('reverse_clip', {'clipId': c}), 'reverse')
    if still:
        ok(call('reverse_clip', {'clipId': c}), 'reverse back')
    back, _ = render('rev-after')
    return m0, ink_cx(export_frame(back, 0.20)), 'block centre-x 0.20s into the export'


def m_detach_audio(still):
    """The audio must actually LEAVE the video clip. Detach, delete the
    clip it landed on, and the exported mix must fall silent."""
    _, c = ramp_scene()
    before, _ = render('det-before')
    m0 = export_rms(before)
    d = ok(call('detach_audio', {'clipId': c}), 'detach')
    ok(call('delete_clip', {'clipId': d['audioClipId']}), 'drop the detached clip')
    if still:
        # Give the video clip its sound back — the same edits, undone.
        ok(call('patch_clip', {'clipId': c, 'properties': {'audio.volume': 1}}), 'reattach')
    after, _ = render('det-after')
    return m0, export_rms(after), 'exported mix RMS'


METRICS = [
    ('reorder_effect changes the picture', m_reorder_effect, 10.0),
    ('toggle_effect changes the picture',  m_toggle_effect,  10.0),
    ('clear_effects changes the picture',  m_clear_effects,  10.0),
    ('duplicate_clip renders the copy',    m_duplicate_clip, 2000.0),
    ('close_gaps_on_track fills the gap',  m_close_gaps,     2000.0),
    ('move_clips moves the batch',         m_move_clips,     2000.0),
    ('delete_selected removes the ink',    m_delete_selected, 2000.0),
    ('reverse_clip mirrors the export',    m_reverse_clip,   150.0),
    ('detach_audio empties the video clip', m_detach_audio,  0.05),
]


def run_metrics():
    print('what was measured                              before        after       change')
    for label, fn, bar in METRICS:
        try:
            m0, m1, what = fn(SELFTEST)
            delta = abs(m1 - m0)
            good = delta < bar if SELFTEST else delta >= bar
            want = f'want <{bar:g}' if SELFTEST else f'need {bar:g}'
            print(f"  {'PASS' if good else 'FAIL'}  {label:44s} "
                  f"{m0:10.3f} -> {m1:10.3f}  Δ{delta:9.3f}  ({want})  {what}")
            results.append(good)
        except Exception as e:
            print(f"  ERROR {label}: {e}")
            results.append(False)


# ═══════════════════════════════════════════════════════════════════
#  STRUCTURAL AND ROUND-TRIP CHECKS
# ═══════════════════════════════════════════════════════════════════

def structural():
    # ── split_at_playhead ───────────────────────────────────────────
    # A shape animated across the frame, so the split has something to
    # get wrong: keyframes rebase onto the new second clip, and a join
    # that shifts the picture is a bug the boundary alone would not show.
    t = fresh(4000)
    c = shape(t, 0, 4000, x=0, label='Sweep')
    ok(call('add_keyframes', {'clipId': c, 'property': 'positionX', 'keyframes': [
        {'timeOffsetMs': 0, 'value': -700, 'easing': 'linear'},
        {'timeOffsetMs': 4000, 'value': 700, 'easing': 'linear'}]}), 'keyframes')
    joins = [1200, 1900, 2100, 2800]
    before = [ink_centre(frame(ms)) for ms in joins]

    ok(call('seek', {'timeMs': 2000}), 'seek')
    ok(call('select_clips', {'clipIds': []}), 'clear selection')
    r = ok(call('split_at_playhead', {}), 'split_at_playhead')
    cl, _ = clips_by_id()
    spans = sorted((v['startMs'], v['endMs']) for v in cl.values())
    check('split_at_playhead reports the real count', r['cut'] == 1 and r['attempted'] == 1,
          f"attempted={r['attempted']} cut={r['cut']} newClipIds={len(r['newClipIds'])}")
    check('split_at_playhead cuts at the boundary', spans == [(0, 2000), (2000, 4000)],
          f'clips now {spans}')

    after = [ink_centre(frame(ms)) for ms in joins]
    worst = max(abs(a[0] - b[0]) + abs(a[1] - b[1])
                for a, b in zip(before, after) if a and b)
    check('split_at_playhead keeps the picture', worst < 2.0,
          f'largest centre shift across the join {worst:.3f}px at {joins}')

    # Now park the playhead where no clip is, and it must refuse rather
    # than report a razor it never made.
    tail = [k for k, v in cl.items() if v['startMs'] == 2000][0]
    ok(call('delete_clip', {'clipId': tail}), 'clear the tail')
    ok(call('select_clips', {'clipIds': []}), 'clear selection')
    ok(call('seek', {'timeMs': 3500}), 'seek past the content')
    refuses('split_at_playhead refuses an empty playhead', 'split_at_playhead', {},
            'not inside any unlocked clip')

    # ── delete_selected ─────────────────────────────────────────────
    t = fresh(4000)
    a = shape(t, 0, 900, x=-600, label='A')
    b = shape(t, 1000, 900, x=0, label='B')
    locked = shape(t, 2000, 900, x=600, label='Locked')
    ok(call('patch_clip', {'clipId': locked, 'properties': {'locked': True}}), 'lock')

    ok(call('select_clips', {'clipIds': []}), 'clear selection')
    refuses('delete_selected refuses an empty selection', 'delete_selected', {},
            'nothing is selected')

    ok(call('select_clips', {'clipIds': [a, b, locked]}), 'select three')
    r = ok(call('delete_selected', {}), 'delete_selected')
    cl, _ = clips_by_id()
    check('delete_selected names what it refused',
          r['deleted'] == 2 and len(r['refused']) == 1 and locked in cl,
          f"deleted {r['deleted']}, refused {[x['reason'] for x in r['refused']]}")

    ok(call('select_clips', {'clipIds': [locked]}), 'select the locked one')
    refuses('delete_selected refuses an all-locked selection', 'delete_selected', {}, 'locked')

    # ── move_clips ──────────────────────────────────────────────────
    t = fresh(8000)
    a = shape(t, 0, 500, x=-600, label='A')
    b = shape(t, 1000, 500, x=0, label='B')
    c = shape(t, 2000, 500, x=600, label='C')
    r = ok(call('move_clips', {'moves': [
        {'clipId': a, 'startTimeMs': 5000},
        {'clipId': b, 'startTimeMs': 6000},
        {'clipId': c, 'startTimeMs': 7000}]}), 'move_clips')
    cl, _ = clips_by_id()
    landed = [cl[a]['startMs'], cl[b]['startMs'], cl[c]['startMs']]
    check('move_clips lands every clip in the batch', landed == [5000, 6000, 7000],
          f'moved {r["moved"]}/{r["requested"]} -> starts {landed}')

    ok(call('patch_clip', {'clipId': b, 'properties': {'locked': True}}), 'lock B')
    refuses('move_clips refuses a partial batch', 'move_clips', {'moves': [
        {'clipId': a, 'startTimeMs': 100},
        {'clipId': b, 'startTimeMs': 200},
        {'clipId': c, 'startTimeMs': 300}]}, 'rolled back')
    cl, _ = clips_by_id()
    check('move_clips rolls the whole batch back',
          [cl[a]['startMs'], cl[b]['startMs'], cl[c]['startMs']] == [5000, 6000, 7000],
          f'starts unchanged at {[cl[a]["startMs"], cl[b]["startMs"], cl[c]["startMs"]]}')

    r = ok(call('move_clips', {'allowPartial': True, 'moves': [
        {'clipId': a, 'startTimeMs': 100},
        {'clipId': b, 'startTimeMs': 200},
        {'clipId': c, 'startTimeMs': 300}]}), 'move_clips partial')
    cl, _ = clips_by_id()
    check('move_clips reports the dropped move',
          r['moved'] == 2 and len(r['refused']) == 1 and cl[b]['startMs'] == 6000,
          f"moved {r['moved']}/{r['requested']}, refused {[x['reason'] for x in r['refused']]}")
    refuses('move_clips refuses an unknown id', 'move_clips',
            {'moves': [{'clipId': 'clip_not_real', 'startTimeMs': 0}]}, 'no clip matching')

    # ── close_gaps_on_track ─────────────────────────────────────────
    t = fresh(8000)
    a = shape(t, 0, 1000, x=-600, label='A')
    b = shape(t, 2000, 1000, x=0, label='B')
    c = shape(t, 5000, 1000, x=600, label='C')
    r = ok(call('close_gaps_on_track', {'trackId': t}), 'close gaps')
    cl, _ = clips_by_id()
    spans = sorted((cl[x]['startMs'], cl[x]['endMs']) for x in (a, b, c))
    check('close_gaps_on_track butt-joins the clips',
          spans == [(0, 1000), (1000, 2000), (2000, 3000)], f'clips now {spans}')
    check('close_gaps_on_track counts the gaps it closed',
          r['gapsClosed'] == 2 and r['clipsMoved'] == 2 and r['totalShiftMs'] == 1000 + 3000,
          f"gapsClosed={r['gapsClosed']} clipsMoved={r['clipsMoved']} totalShiftMs={r['totalShiftMs']}")
    r = ok(call('close_gaps_on_track', {'trackId': t}), 'close gaps again')
    check('close_gaps_on_track admits a no-op', r['changed'] is False and r['gapsClosed'] == 0,
          f"changed={r['changed']} — {r.get('note', '')[:56]}")
    refuses('close_gaps_on_track refuses an unknown track', 'close_gaps_on_track',
            {'trackId': 'track_not_real'}, 'no track matching')

    # ── duplicate_clip independence ─────────────────────────────────
    t = fresh(6000)
    a = shape(t, 0, 1000, x=0, label='Original')
    ok(call('add_effect', {'clipId': a, 'effectType': 'glow'}), 'glow')
    r = ok(call('duplicate_clip', {'clipId': a, 'name': 'Copy'}), 'duplicate')
    copy = r['clipId']
    cl, _ = clips_by_id()
    check('duplicate_clip copies the whole clip',
          copy != a and len(cl[copy]['effects']) == len(cl[a]['effects']) == 1
          and cl[copy]['startMs'] == 1000,
          f"copy at {cl[copy]['startMs']}–{cl[copy]['endMs']}ms with "
          f"{len(cl[copy]['effects'])} effect(s)")

    before_original = frame(500)
    ok(call('patch_clip', {'clipId': copy, 'properties': {'transform.x': 700,
                                                          'transform.scaleX': 0.9}}), 'patch copy')
    ok(call('clear_effects', {'clipId': copy}), 'strip the copy')
    cl, _ = clips_by_id()
    props = ok(call('list_properties', {'clipId': a}), 'props')
    x_of_original = next(p['value'] for p in props['properties'] if p['path'] == 'transform.x')
    check('duplicate_clip copy is independent',
          x_of_original == 0 and len(cl[a]['effects']) == 1 and len(cl[copy]['effects']) == 0,
          f'original x={x_of_original}, original effects={len(cl[a]["effects"])}, '
          f'copy effects={len(cl[copy]["effects"])}')
    check('duplicate_clip leaves the original picture alone',
          diff(before_original, frame(500)) < 0.5,
          f'original frame moved {diff(before_original, frame(500)):.4f}')

    r = ok(call('duplicate_clip', {'clipId': a, 'startTimeMs': 4000}), 'duplicate placed')
    cl, _ = clips_by_id()
    check('duplicate_clip places the copy where asked', cl[r['clipId']]['startMs'] == 4000,
          f"copy landed at {cl[r['clipId']]['startMs']}ms")
    refuses('duplicate_clip refuses an unknown id', 'duplicate_clip',
            {'clipId': 'clip_not_real'}, 'no clip matching')

    # ── rename_clip ─────────────────────────────────────────────────
    t = fresh(4000)
    a = shape(t, 0, 1000, x=0, label='Before')
    r = ok(call('rename_clip', {'clipId': a, 'name': 'Mascot Layer'}), 'rename')
    resolved = ok(call('rename_clip', {'clipId': 'mascot', 'name': 'Mascot Layer 2'}), 'fuzzy')
    check('rename_clip makes the new name addressable',
          r['to'] == 'Mascot Layer' and resolved['clipId'] == a,
          f"\"{r['from']}\" -> \"{r['to']}\", then resolved \"mascot\" back to the same clip")
    refuses('rename_clip refuses an unknown id', 'rename_clip',
            {'clipId': 'clip_not_real', 'name': 'x'}, 'no clip matching')

    # ── effect stack ────────────────────────────────────────────────
    _, c = chart_scene()
    baseline = frame(500)
    ok(call('add_effect', {'clipId': c, 'effectType': 'glow',
                           'params': {'radius': 120, 'threshold': 100,
                                      'tint': '#ffffff', 'streak': 1}}), 'glow')
    with_fx = frame(500)
    ok(call('toggle_effect', {'clipId': c, 'effect': 'glow', 'enabled': False}), 'bypass')
    bypassed = frame(500)
    check('toggle_effect off matches no effect at all', diff(bypassed, baseline) < 0.5,
          f'bypassed vs never-added {diff(bypassed, baseline):.4f} '
          f'(vs {diff(with_fx, baseline):.3f} with it on)')
    check('toggle_effect off differs from on', diff(bypassed, with_fx) > 5.0,
          f'bypassed vs enabled {diff(bypassed, with_fx):.3f}; '
          f'edge energy {edges(bypassed):.3f} bypassed vs {edges(with_fx):.3f} bloomed')

    r = ok(call('toggle_effect', {'clipId': c, 'effect': 'glow', 'enabled': False}), 'bypass again')
    check('toggle_effect admits a no-op', r['changed'] is False, f"changed={r['changed']}")
    ok(call('toggle_effect', {'clipId': c, 'effect': 'glow', 'enabled': True}), 'unbypass')

    ok(call('add_effect', {'clipId': c, 'effectType': 'letterbox',
                           'params': {'ratio': 2.39, 'color': '#000000'}}), 'letterbox')
    cleared = ok(call('clear_effects', {'clipId': c}), 'clear')
    check('clear_effects returns the un-effected picture',
          cleared['removed'] == 2 and diff(frame(500), baseline) < 0.5,
          f"removed {cleared['removed']}, frame vs baseline {diff(frame(500), baseline):.4f}")
    again = ok(call('clear_effects', {'clipId': c}), 'clear again')
    check('clear_effects admits a clean clip',
          again['changed'] is False and again['removed'] == 0,
          f"changed={again['changed']} — {again.get('note', '')[:52]}")

    ok(call('add_effect', {'clipId': c, 'effectType': 'glow'}), 'glow')
    ok(call('add_effect', {'clipId': c, 'effectType': 'letterbox'}), 'letterbox')
    refuses('reorder_effect refuses the end of the stack', 'reorder_effect',
            {'clipId': c, 'effect': 'letterbox', 'direction': 'later'}, 'already at')
    refuses('reorder_effect refuses an unknown effect', 'reorder_effect',
            {'clipId': c, 'effect': 'shake', 'direction': 'earlier'}, 'has no effect')
    refuses('toggle_effect refuses an unknown effect', 'toggle_effect',
            {'clipId': c, 'effect': 'shake'}, 'has no effect')
    refuses('clear_effects refuses an unknown clip', 'clear_effects',
            {'clipId': 'clip_not_real'}, 'no clip matching')

    # ── detach_audio ────────────────────────────────────────────────
    _, c = ramp_scene()
    d = ok(call('detach_audio', {'clipId': c}), 'detach')
    cl, meta = clips_by_id()
    tracks = {t['id']: t for t in meta['tracks']}
    check('detach_audio lands the sound on an audio track',
          tracks[d['audioTrackId']]['type'] == 'audio'
          and cl[d['audioClipId']]['type'] == 'audio'
          and d['videoClipIsNowSilent'] is True,
          f"audio clip on \"{tracks[d['audioTrackId']]['name']}\", video clip volume 0")
    refuses('detach_audio refuses a second detach', 'detach_audio',
            {'clipId': c}, 'already been detached')

    t2 = fresh(4000)
    s = shape(t2, 0, 1000, x=0, label='Shape')
    refuses('detach_audio refuses a non-video clip', 'detach_audio', {'clipId': s},
            'only video clips')
    refuses('detach_audio refuses an unknown clip', 'detach_audio',
            {'clipId': 'clip_not_real'}, 'no clip matching')

    # ── reverse_clip ────────────────────────────────────────────────
    _, c = ramp_scene()
    r = ok(call('reverse_clip', {'clipId': c}), 'reverse')
    r2 = ok(call('reverse_clip', {'clipId': c, 'reversed': True}), 'reverse again')
    check('reverse_clip toggles and admits a no-op',
          r['reversed'] is True and r['changed'] is True and r2['changed'] is False,
          f"toggled to reversed={r['reversed']}, second call changed={r2['changed']}")
    t2 = fresh(4000)
    s = shape(t2, 0, 1000, x=0, label='Shape')
    r = ok(call('reverse_clip', {'clipId': s}), 'reverse a shape')
    check('reverse_clip warns on a still source', 'tellTheUser' in r,
          (r.get('tellTheUser') or 'NO WARNING')[:74])
    refuses('reverse_clip refuses an unknown id', 'reverse_clip',
            {'clipId': 'clip_not_real'}, 'no clip matching')

    # Reversal used to read the SOURCE back to front for the picture and
    # do nothing at all for the sound: `collectAudioClips` never saw
    # `reversed` and the filtergraph had no `areverse`, so reversed
    # dialogue exported as forward dialogue. This row measured that and
    # said so; it now measures the fix. A constant tone could never have
    # caught either state — it sounds identical played backwards, which
    # is exactly how "reversed" looked done while doing nothing.
    t = fresh(RAMP_MS, 'sweepscene')
    a = ok(call('import_media_from_path', {'path': SWEEP, 'name': 'sweep'}), 'import')['assetId']
    c = ok(call('insert_clip', {'assetId': a, 'trackId': t, 'startTimeMs': 0}), 'insert')['clipId']
    fwd, _ = render('sweep-forward')
    ok(call('reverse_clip', {'clipId': c}), 'reverse')
    rev, _ = render('sweep-reversed')
    seg = int(0.4 * SR)
    f_lo, f_hi = dominant_hz(export_pcm(fwd)[:seg]), dominant_hz(export_pcm(fwd)[-seg:])
    r_lo, r_hi = dominant_hz(export_pcm(rev)[:seg]), dominant_hz(export_pcm(rev)[-seg:])
    check('reverse_clip reverses the SOUND as well as the picture',
          f_hi > f_lo * 1.5 and r_lo > r_hi * 1.5,
          f'a 300->3000Hz sweep: forward {f_lo:.0f}->{f_hi:.0f}Hz (rises), '
          f'reversed {r_lo:.0f}->{r_hi:.0f}Hz (falls)')
    # The mirror has to be a mirror, not merely a different shape: the
    # reversed clip's ends must match the forward clip's ends, swapped.
    check('and it is a mirror — the ends swap, they do not just differ',
          abs(r_lo - f_hi) < 220 and abs(r_hi - f_lo) < 220,
          f'forward ends {f_lo:.0f}/{f_hi:.0f}Hz vs reversed ends {r_lo:.0f}/{r_hi:.0f}Hz')
    # And playback still cannot do it, which the agent has to be told.
    pv = ok(call('describe_audio_preview', {'clipId': c, 'measure': False}), 'preview')
    says = any('revers' in str(x).lower()
               for cl in pv['clips'] for x in cl.get('previewCannotApply', []))
    check('describe_audio_preview admits playback cannot reverse sound', says,
          'reported as a preview/render divergence' if says
          else 'preview reports nothing about reversal — an agent would call it correct')

    # ── markers, through a save/open round trip ─────────────────────
    # Markers have no pixel signature, so they are checked the only way
    # that proves they are really in the project: written to disk and
    # read back into a reset editor.
    fresh(20000, 'markers')
    ok(call('add_marker', {'timeMs': 1000, 'label': 'Chapter One', 'kind': 'chapter'}), 'm1')
    ok(call('add_marker', {'timeMs': 2000, 'label': 'Chapter Two', 'kind': 'chapter'}), 'm2')
    ok(call('add_marker', {'timeMs': 3000, 'label': 'Beat A', 'kind': 'beat'}), 'm3')
    ok(call('add_marker', {'timeMs': 4000, 'label': 'Beat B', 'kind': 'beat'}), 'm4')
    ok(call('add_marker', {'timeMs': 5000, 'label': 'Fix the grade', 'kind': 'todo'}), 'm5')

    ok(call('update_marker', {'marker': 'Chapter Two', 'timeMs': 9000,
                              'label': 'Chapter Two (moved)'}), 'update')
    ok(call('remove_marker', {'marker': 'Beat A'}), 'remove')

    def round_trip(tag):
        path = os.path.join(TMP, f'markers-{tag}.kerf')
        ok(call('save_project', {'path': path}), 'save')
        ok(call('reset_project', {'name': 'wiped', 'durationMs': 1000}), 'wipe')
        wiped = ok(call('describe_timeline'), 'd')['markers']
        ok(call('open_project', {'path': path}), 'open')
        return ok(call('describe_timeline'), 'd')['markers'], wiped

    marks, wiped = round_trip('a')
    labels = sorted(m['label'] for m in marks)
    moved = next((m for m in marks if m['label'].startswith('Chapter Two')), None)
    check('update_marker survives a save/open round trip',
          wiped == [] and moved is not None and moved['timeMs'] == 9000,
          f"reopened {len(marks)} markers, Chapter Two at {moved['timeMs'] if moved else '?'}ms")
    check('remove_marker survives a save/open round trip',
          'Beat A' not in labels and 'Beat B' in labels,
          f'markers on disk: {labels}')

    r = ok(call('clear_markers', {'kind': 'beat'}), 'clear beats')
    marks, _ = round_trip('b')
    kinds = sorted({m['kind'] for m in marks})
    check('clear_markers(kind) leaves other kinds alone',
          r['removed'] == 1 and kinds == ['chapter', 'todo'] and len(marks) == 3,
          f"removed {r['removed']} beat marker(s); {len(marks)} left, kinds {kinds}")

    r = ok(call('clear_markers', {'kind': 'beat'}), 'clear beats again')
    check('clear_markers admits a no-op', r['changed'] is False and r['removed'] == 0,
          f"changed={r['changed']} — {r.get('note', '')[:52]}")

    r = ok(call('clear_markers', {}), 'clear all')
    marks, _ = round_trip('c')
    check('clear_markers() removes every kind', r['removed'] == 3 and marks == [],
          f"removed {r['removed']}; {len(marks)} left on disk")

    refuses('remove_marker refuses an unknown marker', 'remove_marker',
            {'marker': 'nothing like this'}, 'no markers')
    refuses('update_marker refuses an unknown marker', 'update_marker',
            {'marker': 'nothing like this', 'timeMs': 1}, 'no markers')

    ok(call('add_marker', {'timeMs': 100, 'label': 'Dupe one'}), 'd1')
    ok(call('add_marker', {'timeMs': 200, 'label': 'Dupe two'}), 'd2')
    refuses('remove_marker refuses an ambiguous label', 'remove_marker',
            {'marker': 'Dupe'}, 'matches 2 markers')
    refuses('update_marker refuses an empty patch', 'update_marker',
            {'marker': 'Dupe one'}, 'nothing to change')

    # ── in and out points ───────────────────────────────────────────
    # Two seconds, and only the SECOND one is lit. A range export of
    # 1000-2000ms must therefore be lit from its very first frame — if
    # it silently rendered from zero it would start dark, whatever its
    # frame count said.
    t = fresh(2000, 'inout')
    shape(t, 1000, 1000, x=0, label='Tail')
    ok(call('clear_in_out', {}), 'clear')
    r = ok(call('set_in_point', {'timeMs': 1000}), 'in')
    r = ok(call('set_out_point', {'timeMs': 2000}), 'out')
    check('set_in_point / set_out_point store the range',
          r['inPointMs'] == 1000 and r['outPointMs'] == 2000 and r['rangeMs'] == 1000,
          f"range {r['inPointMs']}–{r['outPointMs']}ms ({r['rangeMs']}ms)")
    check('and the report no longer calls itself preview-only',
          'render_export' in r['appliesTo'],
          f"appliesTo={r['appliesTo']}")

    whole = os.path.join(TMP, 'inout_whole.mp4')
    wdata = ok(call('render_export', {'resolution': '720p', 'outputPath': whole}), 'whole')
    ranged = os.path.join(TMP, 'inout_ranged.mp4')
    rdata = ok(call('render_export', {'resolution': '720p', 'outputPath': ranged,
                                      'useInOut': True}), 'ranged')

    check('useInOut renders the range, not the sequence',
          wdata['frames'] == 60 and rdata['frames'] == 30,
          f"whole {wdata['frames']} frames, 1000-2000ms range {rdata['frames']} frames")

    # The row that cannot be satisfied by counting frames.
    whole_head = ink(export_frame(whole, 0.10))
    ranged_head = ink(export_frame(ranged, 0.10))
    check('and it is the RIGHT second — content, not frame count',
          whole_head < 100 and ranged_head > 1000,
          f'ink 0.10s into the file: whole {whole_head:.0f} (dark, correct), '
          f'ranged {ranged_head:.0f} (lit — it starts at the in point)')

    ok(call('clear_in_out', {}), 'clear before the refusal row')
    refuses('render_export refuses useInOut with no range set', 'render_export',
            {'useInOut': True, 'outputPath': os.path.join(TMP, 'never.mp4')},
            'no in or out point is set')
    ok(call('set_in_point', {'timeMs': 1000}), 'in')
    ok(call('set_out_point', {'timeMs': 2000}), 'out')

    refuses('set_in_point refuses an inverted range', 'set_in_point',
            {'timeMs': 2500}, 'not before the out point')
    refuses('set_out_point refuses an empty range', 'set_out_point',
            {'timeMs': 500}, 'not after the in point')
    r = ok(call('clear_in_out', {}), 'clear')
    check('clear_in_out clears both and says it did',
          r['inPointMs'] is None and r['outPointMs'] is None and r['changed'] is True,
          f"changed={r['changed']}, now {r['inPointMs']}/{r['outPointMs']}")
    r = ok(call('clear_in_out', {}), 'clear again')
    check('clear_in_out admits a no-op', r['changed'] is False, f"changed={r['changed']}")


# ═══════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    if SELFTEST:
        print('holding every scene STILL — each metric must now move LESS than its bar\n')
        run_metrics()
        n = sum(results)
        print(f"\n{n}/{len(results)} clip-op thresholds discriminate — a still scene stays under them")
        if n != len(results):
            print('threshold does NOT discriminate — see the FAIL rows above')
    else:
        structural()
        print()
        run_metrics()
        n = sum(results)
        print(f"\n{n}/{len(results)} clip-op checks passed")
        if n != len(results):
            print('failing: see the FAIL rows above')
    sys.exit(0 if sum(results) == len(results) else 1)
