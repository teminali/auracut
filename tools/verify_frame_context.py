"""
`get_frame_context` must say when the frame is not the frame you asked for.

    Kerf must be running.  python3 tools/verify_frame_context.py

The compositor draws a dark gradient for media that has not finished
decoding. That is the right thing to draw — but the frame went back to the
caller with no indication, and a dark gradient reads as a legitimately
dark shot. Measuring straight after an insert measured the placeholder.

It cost ten false failures while `verify_keyframes.py` was being written,
and the workaround there is to poll until the picture stops changing —
a guess, in the caller, about something only the renderer knows. The frame
now carries `mediaPending`, so the caller can wait on a fact.

The checks below have to catch a RACE, so they are built to fail loudly if
they ever stop racing:

  · the clip is written to a fresh mkdtemp every run, so its URL is one
    the media cache has never seen — a file already decoded this session
    is never pending, and the check would pass without testing anything;
  · the picture is bright and the placeholder is dark, so the two frames
    are far apart in the one number being measured, and the suite asserts
    that gap rather than trusting the flag;
  · and if no pending frame is ever observed, that is reported as a
    FAILURE, not quietly passed. A check for "does it warn while loading"
    that never sees a load is not evidence of anything.
"""
import sys, os, io, math, base64, subprocess, tempfile, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kerf_rpc import call, ok
import numpy as np
from PIL import Image

TMP = tempfile.mkdtemp(prefix='kerf-frame-')

results = []
def check(label, good, detail):
    print(f"  {'PASS' if good else 'FAIL'}  {label:38s} {detail}")
    results.append(good)

def frame(**kw):
    return ok(call('get_frame_context', {'includeImage': True, **kw}), 'frame')['frame']

def luma_of(f):
    if not f.get('imageDataUrl'):
        return None
    b = base64.b64decode(f['imageDataUrl'].split(',', 1)[1])
    a = np.array(Image.open(io.BytesIO(b)).convert('RGB')).astype(float)
    return float((0.299*a[:,:,0] + 0.587*a[:,:,1] + 0.114*a[:,:,2]).mean())

def make_video(path, seconds=8):
    """A bright clip, at a URL Kerf has never seen.

    Bright because the placeholder is a dark gradient, so 'decoded' and
    'not decoded' have to be far apart in the one number this measures.
    New because the media cache is keyed by URL and a file already decoded
    this session is never pending — `TMP` is a fresh mkdtemp per run, so
    the URL is new even though the bars are not.

    The first version of this generated `color=white` through ffmpeg's
    `noise` filter at `-preset ultrafast`, which produced a **71MB**
    eight-second file. Chromium logged `Unsupported pixel format: -1` on
    a loop and never decoded it, so the clip was pending forever. The test
    was wrong, not the app. Bars compress to ~1MB and decode immediately.
    """
    hue = random.randint(0, 359)
    subprocess.run([
        'ffmpeg', '-y', '-v', 'error',
        '-f', 'lavfi', '-i', f'smptebars=s=1920x1080:d={seconds}:r=30',
        '-vf', f'hue=h={hue}',
        '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high',
        '-pix_fmt', 'yuv420p', path,
    ], check=True)
    return path

print('get_frame_context and the frames it cannot draw yet\n')

VIDEO = make_video(os.path.join(TMP, 'probe.mp4'))

ok(call('reset_project', {'name': 'framectx', 'aspectRatio': '16:9', 'fps': 30,
                          'backgroundColor': '#000000', 'durationMs': 4000}), 'reset')
t = ok(call('add_track', {'type': 'video', 'name': 'V'}), 't')['trackId']
a = ok(call('import_media_from_path', {'path': VIDEO, 'name': 'probe.mp4'}), 'imp')['assetId']
c = ok(call('insert_clip', {'assetId': a, 'trackId': t, 'startTimeMs': 0}), 'ins')['clipId']
ok(call('patch_clip', {'clipId': c, 'properties': {'durationMs': 4000, 'fitMode': 'cover'}}), 'p')

# ── poll from the instant the clip lands ────────────────────────────
seen_pending = None
settled = None
for i in range(60):
    f = frame(atMs=500)
    if f.get('mediaPending', 0) > 0 and seen_pending is None:
        seen_pending = (f, luma_of(f))
    if f.get('mediaPending', 0) == 0:
        settled = (f, luma_of(f))
        break

check('a decoding frame is reported, not hidden', seen_pending is not None,
      'saw mediaPending > 0 while the clip decoded'
      if seen_pending else
      'NEVER saw a pending frame — this check raced and lost, so it proved nothing')

check('the frame settles', settled is not None,
      f"mediaPending reached 0 (luma {settled[1]:.1f})" if settled else 'never settled')

if seen_pending and settled:
    pf, pl = seen_pending
    sf, sl = settled
    check('the pending frame names the clips', pf.get('mediaPendingClipIds') == [c],
          f"mediaPendingClipIds={pf.get('mediaPendingClipIds')}")
    check('the pending frame carries a warning',
          'do not measure' in (pf.get('mediaPendingNote') or '').lower(),
          (pf.get('mediaPendingNote') or 'NO NOTE')[:62] + '…')
    # The whole point: the two frames are different pictures. If they were
    # not, `mediaPending` would be reporting a distinction without one.
    check('the placeholder really was a different picture', abs(sl - pl) > 20,
          f'placeholder luma {pl:.1f} -> decoded {sl:.1f}  (Δ{abs(sl-pl):.1f})')
    check('the placeholder is the dark one', pl < sl,
          f'{pl:.1f} < {sl:.1f}')

# ── a settled frame must not cry wolf ───────────────────────────────
f = frame(atMs=500)
check('a settled frame reports 0 and no note',
      f.get('mediaPending') == 0 and 'mediaPendingNote' not in f,
      f"mediaPending={f.get('mediaPending')}, note absent={'mediaPendingNote' not in f}")

# ── a frame with no media at all is not 'pending' ───────────────────
ok(call('reset_project', {'name': 'framectx2', 'aspectRatio': '16:9', 'fps': 30,
                          'backgroundColor': '#101010', 'durationMs': 2000}), 'reset')
t2 = ok(call('add_track', {'type': 'video', 'name': 'S'}), 't')['trackId']
ok(call('add_shape_layer', {'kind': 'rectangle', 'trackId': t2, 'startTimeMs': 0,
                            'durationMs': 2000, 'style': {'fill': '#ffffff'}}), 's')
f = frame(atMs=100)
check('shapes and text never count as pending', f.get('mediaPending') == 0,
      f"mediaPending={f.get('mediaPending')} on a shape-only frame")

n = sum(results)
print(f"\n{n}/{len(results)} frame-context checks passed")
if n != len(results):
    sys.exit(1)
