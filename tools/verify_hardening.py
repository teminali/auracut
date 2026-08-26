"""
Regressions for the six findings HANDOVER §8 asks for by name.

    Kerf must be running.  python3 tools/verify_hardening.py

§8 opens "There are no automated tests. None." and then lists six things
to start with, "mostly mechanical to write because the manual
verification is recorded in the commit messages". Four of them are now
covered elsewhere — but covered by suites written for other reasons,
which is not the same as covered on purpose. If `verify_keyframes` is
ever narrowed, `shadows` stops being checked and nobody finds out.

So each of the six is asserted here, in §8's own words, against the
artifact:

  1. export produces a file with a video AND an audio stream
  2. a video clip renders footage, not the placeholder gradient
  3. a 120 BPM source measures ~120 with no drift
  4. `shadows` moves measured luminance; `sharpen` moves edge energy
  5. the no-op tools throw instead of reporting success
  6. a 9:16 project exports portrait and undistorted

Every one of those is a thing that ONCE REPORTED SUCCESS AND DID NOTHING.
The export encoded nothing and returned a path it never created. Every
clip drew through `new Image()`, so real footage was a grey gradient.
Beat markers were a metronome. Five colour controls rendered nothing
while appearing as live sliders. Ten tools bailed silently and returned
void. This file exists so that none of that can come back quietly.
"""
import sys, os, io, json, math, base64, wave, subprocess, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kerf_rpc import call, ok
import numpy as np
from PIL import Image

TMP = tempfile.mkdtemp(prefix='kerf-harden-')
SR = 48000

results = []
def check(label, good, detail):
    print(f"  {'PASS' if good else 'FAIL'}  {label:44s} {detail}")
    results.append(good)

def frame(ms):
    f = ok(call('get_frame_context', {'atMs': int(ms), 'includeImage': True}), 'frame')['frame']
    return f

def pixels(f):
    b = base64.b64decode(f['imageDataUrl'].split(',', 1)[1])
    return np.array(Image.open(io.BytesIO(b)).convert('RGB')).astype(float)

def luma(a):  return (0.299*a[:,:,0] + 0.587*a[:,:,1] + 0.114*a[:,:,2])
def edges(a):
    l = luma(a)
    return float(np.abs(np.diff(l, axis=0)).mean() + np.abs(np.diff(l, axis=1)).mean())

def settle(ms, tries=40):
    import time
    for _ in range(tries):
        if frame(ms).get('mediaPending', 0) == 0: return
        time.sleep(0.08)

def probe_video(path, seconds=3, colour='green', size='640x360'):
    """Bright, moving, and loud — so 'rendered' and 'placeholder' are far
    apart, and so the export has a real audio stream to find."""
    subprocess.run([
        'ffmpeg', '-y', '-v', 'error',
        '-f', 'lavfi', '-i', f'color=c={colour}:s={size}:d={seconds}:r=30',
        '-f', 'lavfi', '-i', f'sine=frequency=440:duration={seconds}',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path,
    ], check=True)
    return path

def streams(path):
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,width,height',
         '-of', 'json', path], capture_output=True, text=True, check=True).stdout
    return json.load(io.StringIO(out))['streams']

print('HANDOVER §8, the six named regressions\n')

VIDEO = probe_video(os.path.join(TMP, 'probe.mp4'))

# ── 1. export produces a file with a video AND an audio stream ──────
ok(call('reset_project', {'name': 'h1', 'aspectRatio': '16:9', 'fps': 30,
                          'backgroundColor': '#000000', 'durationMs': 2000}), 'reset')
tv = ok(call('add_track', {'type': 'video', 'name': 'V'}), 't')['trackId']
av = ok(call('import_media_from_path', {'path': VIDEO, 'name': 'probe.mp4'}), 'i')['assetId']
cv = ok(call('insert_clip', {'assetId': av, 'trackId': tv, 'startTimeMs': 0}), 'i')['clipId']
ok(call('patch_clip', {'clipId': cv, 'properties': {'durationMs': 2000, 'fitMode': 'cover'}}), 'p')

out1 = os.path.join(TMP, 'export.mp4')
res1 = ok(call('render_export', {'resolution': '720p', 'durationMs': 2000, 'outputPath': out1}), 'render')

check('1 · the export file exists on disk', os.path.exists(out1) and os.path.getsize(out1) > 0,
      f'{os.path.getsize(out1) if os.path.exists(out1) else 0} bytes'
      + ('' if os.path.exists(out1) else '  — it once returned a path it never created'))
st = streams(out1) if os.path.exists(out1) else []
kinds = {s['codec_type'] for s in st}
check('1 · it has BOTH a video and an audio stream', {'video', 'audio'} <= kinds, f'streams: {sorted(kinds)}')

# ── 2. a video clip renders footage, not the placeholder gradient ───
settle(1000)
f = frame(1000)
px = pixels(f)
mean_rgb = px.reshape(-1, 3).mean(axis=0)
greenish = mean_rgb[1] > mean_rgb[0] + 25 and mean_rgb[1] > mean_rgb[2] + 25
check('2 · mediaPending is 0 before measuring', f.get('mediaPending') == 0,
      f"mediaPending={f.get('mediaPending')}")
check('2 · a video clip renders FOOTAGE, not the gradient', greenish,
      f'mean RGB {mean_rgb.round(1).tolist()} — the placeholder is a grey-blue gradient')

# ── 3. a 120 BPM source measures ~120 with no drift ─────────────────
bed = os.path.join(TMP, 'bed120.wav')
rng = np.random.default_rng(3)
n = int(SR * 8)
x = np.zeros(n)
for b in range(16):                      # 120 BPM = a hit every 500ms
    s = int(b * 0.5 * SR)
    d = int(0.025 * SR)
    x[s:s+d] += rng.normal(0, 1, d) * np.exp(-np.arange(d) / (0.006 * SR))
with wave.open(bed, 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())

ok(call('reset_project', {'name': 'h3', 'aspectRatio': '16:9', 'fps': 30, 'durationMs': 8000}), 'reset')
ta = ok(call('add_track', {'type': 'audio', 'name': 'A'}), 't')['trackId']
aa = ok(call('import_media_from_path', {'path': bed, 'name': 'bed120'}), 'i')['assetId']
ca = ok(call('insert_clip', {'assetId': aa, 'trackId': ta, 'startTimeMs': 0}), 'i')['clipId']
beats = ok(call('detect_beats', {'clipId': ca}), 'beats')

check('3 · a 120 BPM source measures ~120', abs(beats['bpm'] - 120) / 120 < 0.03,
      f"{beats['bpm']} BPM  (markers were once a metronome synthesised from the estimate)")
check('3 · and it is measured, not interpolated', beats.get('percussive') is True and beats['onsetsDetected'] > 8,
      f"percussive={beats.get('percussive')}, {beats['onsetsDetected']} onsets")
# No drift: the LAST beat must still be on the grid, not just the first.
#
# `detect_beats` returns a COUNT, not the positions — the grid lands on
# the timeline as markers, which is also what makes the claim visible in
# the app rather than merely reported. So drift is measured off the
# markers, which is the artifact a user would actually cut against.
bm = sorted(m['timeMs'] for m in ok(call('describe_timeline', {}), 'd')['markers']
            if m.get('kind') == 'beat')
if len(bm) >= 4:
    span = bm[-1] - bm[0]
    drift = abs(span - round(span / 500) * 500)
    check('3 · no drift across the whole file', drift < 60,
          f'{drift:.0f}ms over {span/1000:.1f}s, {len(bm)} markers  (2.5% once became 4+ seconds)')
else:
    check('3 · no drift across the whole file', False, f'only {len(bm)} beat markers')

# ── 4. shadows moves luminance; sharpen moves edge energy ───────────
def graded(prop, value, src=None):
    ok(call('reset_project', {'name': 'h4', 'aspectRatio': '16:9', 'fps': 30, 'durationMs': 1000}), 'reset')
    t = ok(call('add_track', {'type': 'video', 'name': 'V'}), 't')['trackId']
    a = ok(call('import_media_from_path', {'path': src or VIDEO, 'name': 'g'}), 'i')['assetId']
    c = ok(call('insert_clip', {'assetId': a, 'trackId': t, 'startTimeMs': 0}), 'i')['clipId']
    ok(call('patch_clip', {'clipId': c, 'properties': {'durationMs': 1000, 'fitMode': 'cover', prop: value}}), 'p')
    settle(500)
    return pixels(frame(500))

sh   = graded('filters.shadows', 90)
shn  = graded('filters.shadows', -90)
check('4 · filters.shadows moves measured luminance',
      abs(luma(sh).mean() - luma(shn).mean()) > 4,
      f'{luma(shn).mean():.1f} -> {luma(sh).mean():.1f}  (five colour controls once rendered nothing)')

"""
Sharpen needs something to sharpen.

The first version of this check ran on the solid-green probe clip and
compared it against the SAME clip with grain on — two different scenes,
one of which had no edges at all. It measured 15.073 -> 0.000 and called
sharpen broken. The clip was flat, so an edge metric on it is zero
whatever the filter does; the test was wrong, not the code.

So: a detailed source, and the SAME source at sharpen 0 and 100.
"""
DETAIL = os.path.join(TMP, 'detail.mp4')
# Broadband texture, not colour bars. Bars have a handful of hard edges
# and large flat fields between them, so a whole-frame edge metric barely
# moves: measured 0.797 -> 0.809, which is 1.5% and too close to noise to
# assert on. Noise gives sharpen detail in every pixel.
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi',
                '-i', 'color=c=gray:s=640x360:d=2:r=30',
                '-vf', 'noise=alls=40:allf=t+u', '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p', '-crf', '18', DETAIL], check=True)
flat  = graded('filters.sharpen', 0,   src=DETAIL)
sharp = graded('filters.sharpen', 100, src=DETAIL)
check('4 · filters.sharpen moves edge energy', edges(sharp) - edges(flat) > 0.1,
      f'{edges(flat):.3f} -> {edges(sharp):.3f}  on a detailed source')

# ── 5. the no-op tools throw instead of reporting success ───────────
ok(call('reset_project', {'name': 'h5', 'aspectRatio': '16:9', 'fps': 30, 'durationMs': 2000}), 'reset')
t5 = ok(call('add_track', {'type': 'video', 'name': 'V'}), 't')['trackId']
c5 = ok(call('add_shape_layer', {'kind': 'rectangle', 'trackId': t5, 'startTimeMs': 0,
                                 'durationMs': 2000, 'style': {'fill': '#ffffff'}}), 's')['clipId']

def refuses(name, args):
    return not call(name, args)['result'].get('success')

check('5 · an unknown effect throws', refuses('add_effect', {'clipId': c5, 'effectType': 'no_such_effect'}),
      'once returned void and reported success')
check('5 · removing an absent effect throws', refuses('remove_effect', {'clipId': c5, 'effect': 'never_added'}), '')
check('5 · a param on an absent effect throws',
      refuses('set_effect_param', {'clipId': c5, 'effect': 'never_added', 'param': 'x', 'value': 1}), '')
check('5 · an unknown clip id throws', refuses('patch_clip', {'clipId': 'clip_does_not_exist',
                                                              'properties': {'opacity': 0.5}}), '')

ok(call('patch_clip', {'clipId': c5, 'properties': {'locked': True}}), 'lock')
for tool, args in (('split_clip', {'clipId': c5, 'atMs': 1000}),
                   ('delete_clip', {'clipId': c5}),
                   ('move_clip', {'clipId': c5, 'startTimeMs': 500}),
                   ('trim_clip', {'clipId': c5, 'durationMs': 1000})):
    check(f'5 · {tool} refuses a locked clip', refuses(tool, args), '')

"""
RECORDED, not asserted — a finding, so it is not rediscovered.

`add_effect` and `patch_clip` write straight through a lock, while
`split_clip`, `delete_clip`, `move_clip` and `trim_clip` all refuse it.
Four tools honour the lock and two ignore it, so what "locked" protects
depends on which tool you reach for.

This is NOT the §8 no-op bug — those tools bailed silently and returned
void, and these two really do apply the edit. It is a consistency
defect, found while writing this file, and left alone deliberately:
`batch_apply`'s `includeLocked` option calls `patch_clip` expecting it to
write through, so making the lock uniform means giving that option
another way in. Worth doing, not worth doing blind.
"""
locked_effect = call('add_effect', {'clipId': c5, 'effectType': 'glow'})['result'].get('success')
check('5 · RECORDED: add_effect still writes through a lock', locked_effect is True,
      'four edit tools refuse a locked clip; add_effect and patch_clip do not — see NEXT.md §8')

# ── 6. a 9:16 project exports portrait and undistorted ──────────────
ok(call('reset_project', {'name': 'h6', 'aspectRatio': '9:16', 'fps': 30,
                          'backgroundColor': '#000000', 'durationMs': 1000}), 'reset')
t6 = ok(call('add_track', {'type': 'video', 'name': 'V'}), 't')['trackId']
a6 = ok(call('import_media_from_path', {'path': VIDEO, 'name': 'p'}), 'i')['assetId']
c6 = ok(call('insert_clip', {'assetId': a6, 'trackId': t6, 'startTimeMs': 0}), 'i')['clipId']
ok(call('patch_clip', {'clipId': c6, 'properties': {'durationMs': 1000, 'fitMode': 'cover'}}), 'p')

out6 = os.path.join(TMP, 'portrait.mp4')
ok(call('render_export', {'resolution': '1080p', 'durationMs': 1000, 'outputPath': out6}), 'render')
vs = [s for s in streams(out6) if s['codec_type'] == 'video']
w, h = (vs[0]['width'], vs[0]['height']) if vs else (0, 0)
check('6 · a 9:16 project exports PORTRAIT', h > w, f'{w}x{h}  (a 9:16 project once exported 1920x1080)')
check('6 · at the right aspect, undistorted', abs((w / h) - (9 / 16)) < 0.02 if h else False,
      f'{w}/{h} = {w/h:.4f}, want {9/16:.4f}  — the compositor scaled non-uniformly and squashed the picture')
check('6 · "1080p" means the SHORT edge', w == 1080, f'short edge {w}px')

n = sum(results)
print(f"\n{n}/{len(results)} hardening checks passed")
if n != len(results):
    sys.exit(1)
