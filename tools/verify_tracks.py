"""
The seven track actions and `redo`, proved on the artifact they change.

    Kerf must be running.  python3 tools/verify_tracks.py [--selftest]

Every one of these wrapped a store action that returned `void`. Mute was
the clearest: `toggleTrackMute` did nothing at all for an id that was not
there, and no caller could tell that apart from a successful toggle. So
nothing here asks `describe_timeline` whether a track says `muted: true`.
A mute has to come out of the WAV quieter, a volume of 0.25 has to come
out four times quieter than 1.0, a solo has to silence the other track's
tone, and a reorder has to change the COLOUR of the pixel where two
opaque shapes overlap.

Two rows exist because of a bug this suite was written around. `anySolo`
was computed on the video side without filtering by track type, while the
audio side filtered — so soloing an AUDIO track meant no video track
counted as soloed, every video track was skipped, and the picture went
black. Mean luma 7.06 -> 0.00, with nothing changed but an audio flag.
`solo audio keeps the picture` is the regression guard; it is a row that
must NOT move, and the row directly under it (`solo video hides the
others`) is what proves the same metric responds when a solo really
should hide something. A "must not move" row is worth nothing on its own.

--selftest holds everything still — the same scenes, the same
measurements, but every action replaced by one that should change
nothing (mute to the value it already has, reorder down and back up
again, remove a different empty track) — and demands each metric move
LESS than its bar.
"""
import sys, os, base64, io, wave, subprocess, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kerf_rpc import call, ok, token
import numpy as np
from PIL import Image

SELFTEST = '--selftest' in sys.argv
TMP = tempfile.mkdtemp(prefix='kerf-tracks-')
SR = 48000
DUR = 1500

results = []


def check(label, good, detail):
    print(f"  {'PASS' if good else 'FAIL'}  {label:38s} {detail}")
    results.append((label, good))


def metric(label, m0, m1, bar, kind='move', extra=True):
    """One measured row: a number before, the same number after, and a bar.

    `kind='move'` rows need |Δ| >= bar. `kind='stay'` rows need |Δ| < bar
    and are only evidence when a 'move' row nearby uses the same metric.
    Under --selftest every row is judged as a 'stay' row, because the
    action has been replaced by a no-op: a threshold nobody has tried to
    fail is not a threshold.
    """
    d = abs(m1 - m0)
    still = SELFTEST or kind == 'stay'
    good = (d < bar) if still else (d >= bar and bool(extra))
    want = f'want <{bar:g}' if still else f'need {bar:g}'
    check(label, good, f'{m0:11.4f} ->{m1:11.4f}   D{d:10.4f}  ({want})')
    return good


def threw(name, args):
    """1 when the tool refused, 0 when it reported success.

    A refusal must be an ERROR, not `{success: true}` with nothing done —
    which is what every one of these did before the store learnt to
    report.
    """
    return 0 if call(name, args).get('result', {}).get('success') else 1


# ── audio ───────────────────────────────────────────────────────────
def tone(path, freq, dur=2.0, amp=0.4):
    t = np.arange(int(SR * dur)) / SR
    x = np.sin(2 * np.pi * freq * t) * amp
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())
    return path


def has_audio_stream(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a',
                        '-show_entries', 'stream=index', '-of', 'csv=p=0', path],
                       capture_output=True, text=True)
    return bool(r.stdout.strip())


def render(name, dur_ms):
    out = os.path.join(TMP, f'{name}.mp4')
    ok(call('render_export', {'resolution': '720p', 'durationMs': dur_ms,
                              'outputPath': out}), f'render {name}')
    if not has_audio_stream(out):
        # Worth knowing, and it cost this suite a run: when nothing at all
        # is audible, render_export writes a file with NO audio stream
        # rather than a silent one. That is still silence, so it is
        # measured as silence instead of failing the decode.
        return np.zeros(int(SR * dur_ms / 1000))
    wav = os.path.join(TMP, f'{name}.wav')
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', out, '-vn', '-ac', '1',
                    '-ar', str(SR), '-c:a', 'pcm_s16le', wav], check=True)
    with wave.open(wav) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(float) / 32768


def rms(x):
    return float(np.sqrt((x ** 2).mean() + 1e-12))


def band_db(x, lo, hi):
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    f = np.fft.rfftfreq(len(x), 1 / SR)
    m = (f >= lo) & (f < hi)
    return float(10 * np.log10((spec[m] ** 2).sum() + 1e-12))


# ── pixels ──────────────────────────────────────────────────────────
def frame(ms=DUR // 2):
    f = ok(call('get_frame_context', {'atMs': int(ms), 'includeImage': True}), 'frame')['frame']
    if f.get('mediaPending'):
        raise RuntimeError(f"{f['mediaPending']} layer(s) still decoding — the frame is a placeholder")
    return np.array(Image.open(io.BytesIO(
        base64.b64decode(f['imageDataUrl'].split(',', 1)[1]))).convert('RGB')).astype(float)


def luma(a):
    return 0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]


def box(a, cx_frac, half=0.06):
    """Mean of a small box, positioned as a fraction of the frame width."""
    h, w = a.shape[:2]
    x0, x1 = int(w * (cx_frac - half)), int(w * (cx_frac + half))
    y0, y1 = int(h * 0.44), int(h * 0.56)
    return a[y0:y1, x0:x1]


def region_luma(a, cx_frac):
    return float(luma(box(a, cx_frac)).mean())


def redness(a, cx_frac=0.5):
    """R minus B over the overlap. Positive is red on top, negative blue."""
    b = box(a, cx_frac)
    return float(b[:, :, 0].mean() - b[:, :, 2].mean())


def reset(name, dur_ms=DUR):
    ok(call('reset_project', {'name': name, 'aspectRatio': '16:9', 'fps': 30,
                              'backgroundColor': '#000000', 'durationMs': dur_ms}), 'reset')


def shape(track_id, fill, x=0.0, scale=0.5, dur_ms=DUR):
    c = ok(call('add_shape_layer', {'kind': 'rectangle', 'trackId': track_id, 'startTimeMs': 0,
                                    'durationMs': dur_ms,
                                    'style': {'fill': fill, 'strokeWidth': 0}}), 'shape')['clipId']
    ok(call('patch_clip', {'clipId': c, 'properties': {
        'transform.x': x, 'transform.y': 0,
        'transform.scaleX': scale, 'transform.scaleY': scale}}), 'patch')
    return c


def add_track(kind, name):
    return ok(call('add_track', {'type': kind, 'name': name}), 'track')['trackId']


# ═══ 1 · mute, and whether it is undoable ═══════════════════════════
def probe_mute_and_history():
    print('\n· mute / undo / redo — on the exported waveform')
    reset('mute', 2000)
    a = ok(call('import_media_from_path',
                {'path': tone(os.path.join(TMP, 't440.wav'), 440.0), 'name': 'tone'}), 'imp')['assetId']
    ta = add_track('audio', 'A1')
    ok(call('insert_clip', {'assetId': a, 'trackId': ta, 'startTimeMs': 0}), 'ins')

    loud = rms(render('mute_before', 2000))

    # The action under test, or a no-op that sets it to what it already is.
    ok(call('set_track_mute', {'trackId': ta, 'muted': False if SELFTEST else True}), 'mute')
    muted = rms(render('mute_after', 2000))
    metric('mute silences the track', loud, muted, loud * 0.5)

    # Mute did not commit before this change, so undo could not reach it.
    # Under --selftest the undo is followed straight back by a redo: a
    # round trip has to leave the WAV exactly where it was, which is a
    # sharper demand than skipping the call would have been.
    ok(call('undo', {}), 'undo')
    if SELFTEST:
        ok(call('redo', {}), 'redo back')
    undone = rms(render('mute_undone', 2000))
    metric('undo brings the sound back', muted, undone, loud * 0.5)

    # In selftest the redo branch is empty by now, so this legitimately
    # cannot move anything — which is the point.
    r = ok(call('redo', {}), 'redo')
    redone = rms(render('mute_redone', 2000))
    metric('redo re-applies the mute', undone, redone, loud * 0.5)

    # `redo` used to be the `undo` pattern: report the number requested,
    # whatever the stack had in it.
    empty = ok(call('redo', {}), 'redo again')
    metric('redo reports what it did', r.get('redone', -1), empty.get('redone', -1), 0.5)

    if SELFTEST:
        ok(call('undo', {'steps': 20}), 'drain')   # start already at the bottom
    deep = ok(call('undo', {'steps': 20}), 'undo 20')
    floor = ok(call('undo', {'steps': 20}), 'undo 20 again')
    metric('undo reports what it did', deep.get('undone', -1), floor.get('undone', -1), 0.5)


# ═══ 2 · volume ═════════════════════════════════════════════════════
def probe_volume():
    print('\n· volume — a gain has to be the gain it says')
    reset('vol', 2000)
    a = ok(call('import_media_from_path',
                {'path': tone(os.path.join(TMP, 't300.wav'), 300.0, amp=0.3), 'name': 'tone'}), 'imp')['assetId']
    ta = add_track('audio', 'A1')
    ok(call('insert_clip', {'assetId': a, 'trackId': ta, 'startTimeMs': 0}), 'ins')

    unity = rms(render('vol_1', 2000))

    ok(call('set_track_volume', {'trackId': ta, 'volume': 1.0 if SELFTEST else 0.25}), 'vol')
    quarter = rms(render('vol_025', 2000))
    ratio = unity / max(quarter, 1e-9)
    # "Different" is not the claim. 0.25 has to be four times quieter.
    metric('volume 0.25 is 4x quieter', unity, quarter, unity * 0.5,
           extra=3.2 <= ratio <= 5.0)
    check('volume ratio lands near 4x' if not SELFTEST else 'volume ratio stays near 1x',
          (3.2 <= ratio <= 5.0) if not SELFTEST else (0.8 <= ratio <= 1.25),
          f'rms {unity:.5f} / {quarter:.5f} = {ratio:.3f}x')

    # Clamping has to happen in the RENDER, not only in the reply.
    ok(call('set_track_volume', {'trackId': ta, 'volume': 1.0 if SELFTEST else 2.0}), 'vol2')
    at_two = rms(render('vol_2', 2000))
    r = ok(call('set_track_volume', {'trackId': ta, 'volume': 1.0 if SELFTEST else 9.0}), 'vol9')
    at_nine = rms(render('vol_9', 2000))
    check('volume 9 is clamped to 2 in the file',
          abs(at_nine - at_two) < at_two * 0.05 and r.get('volume') == (1.0 if SELFTEST else 2),
          f"reported {r.get('volume')}, rms at 2.0 {at_two:.5f} vs at 9.0 {at_nine:.5f}")


# ═══ 3 · solo ═══════════════════════════════════════════════════════
def probe_solo_audio():
    print('\n· solo — the other track has to go, and only the other track')
    reset('solo', 2000)
    lo = ok(call('import_media_from_path',
                 {'path': tone(os.path.join(TMP, 's300.wav'), 300.0), 'name': 'lo'}), 'i')['assetId']
    hi = ok(call('import_media_from_path',
                 {'path': tone(os.path.join(TMP, 's1200.wav'), 1200.0), 'name': 'hi'}), 'i')['assetId']
    t1 = add_track('audio', 'LO')
    t2 = add_track('audio', 'HI')
    ok(call('insert_clip', {'assetId': lo, 'trackId': t1, 'startTimeMs': 0}), 'i')
    ok(call('insert_clip', {'assetId': hi, 'trackId': t2, 'startTimeMs': 0}), 'i')

    before = render('solo_before', 2000)
    ok(call('set_track_solo', {'trackId': t1, 'solo': False if SELFTEST else True}), 'solo')
    after = render('solo_after', 2000)

    metric('solo kills the other track', band_db(before, 1100, 1300), band_db(after, 1100, 1300), 20.0)
    metric('solo keeps the soloed track', band_db(before, 250, 350), band_db(after, 250, 350), 3.0,
           kind='stay')

    # A video clip's own sound is sound too. Both audio implementations
    # used to gate the solo skip on `track.type === 'audio'`, so a
    # soloed audio track silenced other AUDIO tracks and left the audio
    # embedded in video clips playing at full level — measured at 68.75dB
    # before and 68.75dB after, delta 0.00. They agreed with each other,
    # which is what kept it looking like intent rather than a slip.
    reset('solocross', 2000)
    vpath = os.path.join(TMP, 'vid440.mp4')
    subprocess.run(['ffmpeg', '-y', '-v', 'error',
                    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=2',
                    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
                    '-c:a', 'aac', '-shortest', vpath], check=True)
    vt = add_track('video', 'PIC')
    at = add_track('audio', 'VO')
    va = ok(call('import_media_from_path', {'path': vpath, 'name': 'vid440'}), 'i')['assetId']
    ta = ok(call('import_media_from_path',
                 {'path': tone(os.path.join(TMP, 's1200b.wav'), 1200.0), 'name': 'vo'}), 'i')['assetId']
    ok(call('insert_clip', {'assetId': va, 'trackId': vt, 'startTimeMs': 0}), 'i')
    ok(call('insert_clip', {'assetId': ta, 'trackId': at, 'startTimeMs': 0}), 'i')

    b2 = render('solocross_before', 2000)
    pic_before = float(luma(frame(500)).mean())
    ok(call('set_track_solo', {'trackId': at, 'solo': False if SELFTEST else True}), 'solo vo')
    a2 = render('solocross_after', 2000)
    pic_after = float(luma(frame(500)).mean())

    metric('solo silences a VIDEO clip\'s own audio too',
           band_db(b2, 380, 500), band_db(a2, 380, 500), 20.0)
    metric('and leaves the soloed voice alone',
           band_db(b2, 1100, 1300), band_db(a2, 1100, 1300), 3.0, kind='stay')
    # The picture must not move: an AUDIO solo blanking the frame is the
    # separate bug this suite already covers, and widening the audio gate
    # is exactly the kind of change that could reintroduce it.
    metric('and does not touch the picture', pic_before, pic_after, 0.5, kind='stay')


# ═══ 4 · solo across streams, and mute on picture ═══════════════════
def probe_solo_video():
    print('\n· solo is per stream — the bug this suite was written around')
    reset('solovid')
    a = ok(call('import_media_from_path',
                {'path': tone(os.path.join(TMP, 'bed.wav'), 440.0), 'name': 'bed'}), 'i')['assetId']
    tl = add_track('video', 'LEFT')
    tr = add_track('video', 'RIGHT')
    ta = add_track('audio', 'BED')
    shape(tl, '#ffffff', x=-500)
    shape(tr, '#ffffff', x=500)
    ok(call('insert_clip', {'assetId': a, 'trackId': ta, 'startTimeMs': 0}), 'i')

    f0 = frame()
    whole0 = float(luma(f0).mean())

    # THE BUG: an audio track's solo flag used to blank every video track.
    ok(call('set_track_solo', {'trackId': ta, 'solo': False if SELFTEST else True}), 'solo audio')
    f1 = frame()
    metric('solo audio keeps the picture', whole0, float(luma(f1).mean()), 0.5, kind='stay')

    ok(call('set_track_solo', {'trackId': ta, 'solo': False}), 'unsolo audio')

    # And the same metric, proved to respond when a solo really should hide.
    left0, right0 = region_luma(frame(), 0.24), region_luma(frame(), 0.76)
    ok(call('set_track_solo', {'trackId': tl, 'solo': False if SELFTEST else True}), 'solo video')
    f2 = frame()
    metric('solo video hides the others', right0, region_luma(f2, 0.76), 60.0)
    metric('solo video keeps its own', left0, region_luma(f2, 0.24), 3.0, kind='stay')
    ok(call('set_track_solo', {'trackId': tl, 'solo': False}), 'unsolo video')

    # Mute on a VIDEO track is a picture edit, not only a sound one.
    ok(call('set_track_mute', {'trackId': tr, 'muted': False if SELFTEST else True}), 'mute video')
    metric('mute hides a video track', right0, region_luma(frame(), 0.76), 60.0)


# ═══ 5 · reorder is z-order ═════════════════════════════════════════
def probe_reorder():
    print('\n· reorder — paint order, measured at the overlap')
    reset('zorder')
    t_red = add_track('video', 'RED')
    t_blue = add_track('video', 'BLUE')          # unshifted, so BLUE is index 0
    shape(t_red, '#ff0000')
    shape(t_blue, '#0000ff')

    before = redness(frame())
    if SELFTEST:
        # Down and back up: the same two calls, ending where it started.
        ok(call('reorder_track', {'trackId': t_blue, 'direction': 'down'}), 'down')
        ok(call('reorder_track', {'trackId': t_blue, 'direction': 'up'}), 'up')
    else:
        ok(call('reorder_track', {'trackId': t_blue, 'direction': 'down'}), 'down')
    after = redness(frame())
    metric('reorder changes the top colour', before, after, 120.0)
    check('reorder puts red in front' if not SELFTEST else 'reorder round trip leaves blue in front',
          (after > 60) if not SELFTEST else (after < -60),
          f'R-B at the overlap {before:.1f} -> {after:.1f}')


# ═══ 6 · remove ═════════════════════════════════════════════════════
def probe_remove():
    print('\n· remove — the clips have to stop rendering')
    reset('remove')
    keep = add_track('video', 'KEEP')
    doomed = add_track('video', 'DOOMED')
    spare = add_track('video', 'SPARE')          # empty; the selftest removes this one
    shape(keep, '#ffffff', x=-500)
    shape(doomed, '#ffffff', x=500)

    right0, left0 = region_luma(frame(), 0.76), region_luma(frame(), 0.24)
    ok(call('remove_track', {'trackId': spare if SELFTEST else doomed}), 'remove')
    f1 = frame()
    metric('remove stops the clips', right0, region_luma(f1, 0.76), 60.0)
    metric('remove leaves the rest alone', left0, region_luma(f1, 0.24), 3.0, kind='stay')


# ═══ 7 · rename survives a round trip ═══════════════════════════════
def probe_rename():
    print('\n· rename — metadata, so proved through save and reopen')
    reset('rename')
    t = add_track('video', 'BEFORE')
    shape(t, '#ffffff')
    wanted = 'Renamed by verify_tracks'

    if not SELFTEST:
        ok(call('rename_track', {'trackId': t, 'name': f'  {wanted}  '}), 'rename')

    path = os.path.join(TMP, 'rename.kerf')
    ok(call('save_project', {'path': path}), 'save')
    reset('scratch')
    ok(call('open_project', {'path': path}), 'open')
    names = [tr['name'] for tr in ok(call('describe_timeline'), 'd')['tracks']]
    metric('rename survives save + reopen', 0.0, 1.0 if wanted in names else 0.0, 0.5)
    check('rename trims what it was given', wanted in names if not SELFTEST else 'BEFORE' in names,
          f'tracks after reopen: {names}')


# ═══ 9 · the lock, measured rather than read ════════════════════════
def probe_lock_is_honoured():
    """`set_track_lock` claims split/trim/move/delete decline on a locked
    track. That claim was READ from `refuseReason` in the source and
    shipped in a tool description without ever being run — and a
    description an agent believes is exactly as load-bearing as code.
    `add_effect` once reported success on a locked clip, so the claim is
    not obviously true.

    Under --selftest the track is NOT locked, and the same six calls must
    then all SUCCEED — which is what makes the count a real threshold
    rather than six calls that were going to fail anyway.
    """
    print('\n· the lock — every clip edit on a locked track must refuse')
    reset('locked')
    a = add_track('video', 'LOCKED')
    b = add_track('video', 'SPARE')
    c = shape(a, '#ffffff')

    if not SELFTEST:
        ok(call('set_track_lock', {'trackId': a, 'locked': True}), 'lock')

    edits = [('split_clip',  {'clipId': c, 'atMs': DUR // 2}),
             ('trim_clip',   {'clipId': c, 'newEndMs': DUR - 200}),
             ('move_clip',   {'clipId': c, 'trackId': b, 'startTimeMs': 100}),
             ('patch_clip',  {'clipId': c, 'properties': {'transform.x': 99}}),
             ('add_effect',  {'clipId': c, 'effectType': 'glow'}),
             ('delete_clip', {'clipId': c})]
    refused = sum(threw(name, args) for name, args in edits)
    metric('a locked track refuses clip edits', 0.0, float(refused), 5.5)


# ═══ 8 · refusals ═══════════════════════════════════════════════════
def probe_refusals():
    print('\n· refusals — an unknown id must throw, not report success')
    def legal_calls():
        """Seven calls with real ids and arguments that change nothing.

        Rebuilt each time: a scene is not idempotent, so running the same
        seven twice against one project would refuse the second remove
        and the second move-to-the-top for perfectly good reasons.
        """
        reset('refuse')
        a = add_track('video', 'ALPHA')
        add_track('video', 'BETA')               # BETA is index 0
        add_track('video', 'SPARE')
        return [('rename_track', {'trackId': a, 'name': 'ALPHA'}),
                ('reorder_track', {'trackId': a, 'direction': 'up'}),
                ('set_track_mute', {'trackId': a, 'muted': False}),
                ('set_track_solo', {'trackId': a, 'solo': False}),
                ('set_track_lock', {'trackId': a, 'locked': False}),
                ('set_track_volume', {'trackId': a, 'volume': 1.0}),
                ('remove_track', {'trackId': 'SPARE'})]

    on_real = sum(threw(n, args) for n, args in legal_calls())
    second = legal_calls()
    if not SELFTEST:
        second = [(n, {**args, 'trackId': 'no_such_track_zzz'}) for n, args in second]
    on_bogus = sum(threw(n, args) for n, args in second)
    metric('7 tools refuse an unknown id', on_real, on_bogus, 6.5)

    # The last track, and a move past the end of the stack.
    reset('refuse2')
    x = add_track('video', 'X')
    if SELFTEST:
        # Two tracks, so removing one is legal and must NOT refuse.
        lastly = threw('remove_track', {'trackId': add_track('video', 'Y')})
    else:
        lastly = threw('remove_track', {'trackId': x})
    reset('refuse3')
    p = add_track('video', 'P')
    add_track('video', 'Q')                      # Q index 0, P index 1
    edge = threw('reorder_track', {'trackId': p if SELFTEST else 'Q', 'direction': 'up'})
    blank = threw('rename_track', {'trackId': p, 'name': 'fine' if SELFTEST else '   '})
    metric('remove refuses the last track', 0.0, float(lastly), 0.5)
    metric('reorder refuses past the top', 0.0, float(edge), 0.5)
    metric('rename refuses a blank name', 0.0, float(blank), 0.5)


if __name__ == '__main__':
    token()   # fail here, not three renders in, if nothing is listening
    if SELFTEST:
        print('holding every track still — each metric must now move LESS than its bar')
    for probe in (probe_mute_and_history, probe_volume, probe_solo_audio, probe_solo_video,
                  probe_reorder, probe_remove, probe_rename, probe_refusals,
                  probe_lock_is_honoured):
        try:
            probe()
        except Exception as e:
            check(probe.__name__, False, f'ERROR {e}')
    n = sum(1 for _, g in results if g)
    bad = [x for x, g in results if not g]
    print()
    if SELFTEST:
        print(f'{n}/{len(results)} track-tool thresholds discriminate')
    else:
        print(f'{n}/{len(results)} track-tool checks passed')
    if bad:
        print('failing:', ', '.join(bad))
    sys.exit(0 if n == len(results) else 1)
