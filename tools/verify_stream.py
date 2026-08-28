"""
Does the live stream actually go out, and does it look like the edit?

    KERF_RPC_PORT=<port> python3 tools/verify_stream.py

THE METHOD, AND WHY IT IS AN RTMP SERVER
----------------------------------------
Nothing here trusts the app's own report. ffmpeg can LISTEN for RTMP as
well as publish to it, so this suite stands up a real ingest on
localhost, tells Kerf to stream to it, and then measures the file that
came out the far end. Every claim is made about received bytes:

  · the ingest accepted a connection at all;
  · the video is H.264 at the size and rate that were asked for;
  · there is an AAC track beside it;
  · KEYFRAMES ARRIVE EVERY TWO SECONDS, which is not a detail — it is
    what YouTube's published requirements ask for, it is what lets a
    server cut segments, and it is invisible in every other kind of test;
  · and the PICTURE is the edit: a green screen inset on a light
    backdrop with a blue camera in the corner, measured as colour shares
    of a frame pulled out of the received stream.

THE SOURCES ARE SYNTHETIC ON PURPOSE
------------------------------------
A stream fed from the real screen is a stream nobody can assert anything
about. Two canvases — one solid green standing in for the display, one
solid blue standing in for the camera — turn every claim the look makes
into arithmetic:

  · the backdrop is visible, because the corners of the frame are
    NEITHER green nor blue;
  · the picture is inset rather than full-frame, because green covers
    most of the middle and none of the extreme edge;
  · the camera is present and in the right corner, because blue appears
    in the bottom-right eighth and nowhere else.

Written after the same rule the rest of `tools/` is written on: a
montage that reported fifteen shots on the beat while rendering fifteen
seconds of black has happened in this codebase.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from kerf_rpc import raw  # noqa: E402

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

results = []

STREAM_SECONDS = 8
HEIGHT = 720
FPS = 30

SCREEN_GREEN = (0, 190, 60)
CAMERA_BLUE = (30, 60, 220)


def check(label, good, detail):
    print(f"  {'PASS' if good else 'FAIL'}  {label:54s} {detail}")
    results.append({'label': label, 'pass': bool(good)})


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def ffmpeg():
    return shutil.which('ffmpeg') or '/opt/homebrew/bin/ffmpeg'


def evaluate(expression, timeout=120):
    """Run JS in the renderer and hand back the value."""
    reply = raw('debug/eval', {'expression': expression}, timeout=timeout)
    if 'result' not in reply:
        raise RuntimeError(f'debug/eval failed: {json.dumps(reply)[:300]}')
    return reply['result']


# ── 1. A real ingest, listening ─────────────────────────────────────

port = free_port()
work = tempfile.mkdtemp(prefix='kerf-stream-')
received = os.path.join(work, 'received.flv')
url = f'rtmp://127.0.0.1:{port}/live/kerf'

listener = subprocess.Popen(
    [ffmpeg(), '-hide_banner', '-loglevel', 'error',
     '-rtmp_listen', '1', '-timeout', '30', '-i', url,
     '-c', 'copy', '-y', received],
    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
time.sleep(2)

# ── 2. Stream to it, from known colours ─────────────────────────────
#
# The canvases are painted every frame rather than once: a canvas that
# is never touched again can stop producing frames on its captureStream,
# and a stream of zero frames is a very confusing thing to debug.

start_js = """(async () => {
  const paint = (w, h, colour) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const tick = () => { g.fillStyle = colour; g.fillRect(0, 0, w, h); };
    tick();
    const timer = setInterval(tick, 33);
    const stream = c.captureStream(30);
    stream.__kerfTimer = timer;
    return stream;
  };
  const screen = paint(1280, 800, 'rgb(%d,%d,%d)');
  const camera = paint(640, 360, 'rgb(%d,%d,%d)');
  window.__kerfStreamSources = [screen, camera];
  const session = await window.__kerf.liveStream.startLiveStream({
    url: %s, screen, camera, height: %d, fps: %d,
  });
  return JSON.stringify({ width: session.width, height: session.height, fps: session.fps });
})()""" % (*SCREEN_GREEN, *CAMERA_BLUE, json.dumps(url), HEIGHT, FPS)

started = evaluate(start_js, timeout=180)
session = json.loads(started) if isinstance(started, str) else started

check('the stream starts and reports a size',
      isinstance(session, dict) and session.get('height') == HEIGHT,
      f"{session.get('width')}x{session.get('height')}@{session.get('fps')}"
      if isinstance(session, dict) else str(started)[:70])

time.sleep(STREAM_SECONDS)

state = evaluate('window.electronAPI.stream.getState()', timeout=60)
check('and main reports it live rather than merely started',
      isinstance(state, dict) and state.get('state') == 'live',
      json.dumps(state)[:80] if isinstance(state, dict) else str(state)[:80])

evaluate("""(async () => {
  await window.__kerf.liveStream.stopLiveStream();
  for (const s of (window.__kerfStreamSources || [])) {
    if (s.__kerfTimer) clearInterval(s.__kerfTimer);
    s.getTracks().forEach(t => t.stop());
  }
  return 'stopped';
})()""", timeout=120)

try:
    listener.wait(timeout=30)
except subprocess.TimeoutExpired:
    listener.kill()

# ── 3. What the ingest actually received ────────────────────────────

exists = os.path.exists(received) and os.path.getsize(received) > 10_000
check('the ingest received a stream',
      exists,
      f'{os.path.getsize(received) / 1024:.0f} KB at the far end' if exists
      else 'NOTHING ARRIVED')

if not exists:
    print(f'\n0/{len(results)} stream checks passed')
    print('listener said:', (listener.stderr.read() or '')[-300:])
    sys.exit(1)

probe = json.loads(subprocess.run(
    ['ffprobe', '-hide_banner', '-v', 'error', '-show_streams', '-show_format',
     '-of', 'json', received], capture_output=True, text=True).stdout)
streams = probe.get('streams', [])
video = next((s for s in streams if s.get('codec_type') == 'video'), None)
audio = next((s for s in streams if s.get('codec_type') == 'audio'), None)
duration = float(probe.get('format', {}).get('duration', 0) or 0)

check('it is H.264 at the size that was asked for',
      video is not None and video.get('codec_name') == 'h264'
      and video.get('height') == HEIGHT,
      f"{video.get('codec_name')} {video.get('width')}x{video.get('height')}"
      if video else 'no video stream')

check('with an AAC track beside it',
      audio is not None and audio.get('codec_name') == 'aac',
      f"{audio.get('codec_name')} {audio.get('sample_rate')}Hz "
      f"{audio.get('channels')}ch" if audio else 'NO AUDIO STREAM')

check('and it ran for as long as it was asked to',
      duration >= STREAM_SECONDS * 0.6,
      f'{duration:.1f}s received of {STREAM_SECONDS}s streamed')

# ── 4. The keyframe cadence the ingest requires ─────────────────────
#
# YouTube: "Keyframe frequency: recommended 2 seconds", capped at 4.
# Nothing else in the app would ever notice this being wrong.

frames = subprocess.run(
    ['ffprobe', '-hide_banner', '-v', 'error', '-select_streams', 'v:0',
     '-show_frames', '-of', 'csv=p=0:nk=0', received],
    capture_output=True, text=True).stdout
keys = []
for line in frames.splitlines():
    if 'key_frame=1' in line:
        for part in line.split(','):
            if part.startswith('pts_time='):
                keys.append(float(part.split('=', 1)[1]))
                break
gaps = [round(keys[i + 1] - keys[i], 2) for i in range(len(keys) - 1)]

check('keyframes arrive every two seconds, as the ingest requires',
      len(gaps) > 0 and all(1.8 <= g <= 2.2 for g in gaps),
      f'{len(keys)} keyframes, gaps {gaps[:4]}' if gaps else 'FEWER THAN TWO KEYFRAMES')

# ── 5. The picture is the EDIT ──────────────────────────────────────

still = os.path.join(work, 'frame.png')
subprocess.run(
    ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
     '-ss', str(max(0.5, duration / 2)), '-i', received,
     '-frames:v', '1', still],
    check=False)

if not os.path.exists(still):
    check('a frame can be pulled out of the received stream', False, 'no frame decoded')
else:
    img = np.asarray(Image.open(still).convert('RGB')).astype(int)
    h, w, _ = img.shape

    def share(region, colour, tol=70):
        d = np.abs(region - np.array(colour)).sum(axis=2)
        return float((d < tol).mean())

    green_all = share(img, SCREEN_GREEN)
    blue_all = share(img, CAMERA_BLUE)

    # The extreme edge: the backdrop, if the picture is really inset.
    edge = np.concatenate([
        img[:6, :, :].reshape(-1, 1, 3),
        img[-6:, :, :].reshape(-1, 1, 3),
        img[:, :6, :].reshape(-1, 1, 3),
        img[:, -6:, :].reshape(-1, 1, 3),
    ])
    edge_green = share(edge, SCREEN_GREEN)
    edge_blue = share(edge, CAMERA_BLUE)

    middle = img[h // 3: 2 * h // 3, w // 3: 2 * w // 3]
    corner = img[int(h * 0.62):, int(w * 0.62):]
    other_corner = img[int(h * 0.62):, : int(w * 0.38)]

    check('the screen is on the stream',
          green_all > 0.25,
          f'{green_all * 100:.0f}% of the frame is the screen colour')

    check('and it is INSET, because the backdrop holds the frame edge',
          edge_green < 0.02 and edge_blue < 0.02,
          f'{edge_green * 100:.1f}% green and {edge_blue * 100:.1f}% blue '
          'in the outermost 6px')

    check('the middle of the frame is the screen, not the backdrop',
          share(middle, SCREEN_GREEN) > 0.85,
          f'{share(middle, SCREEN_GREEN) * 100:.0f}% of the centre third')

    check('the camera is on the stream, in the corner it was put in',
          share(corner, CAMERA_BLUE) > 0.1 and share(other_corner, CAMERA_BLUE) < 0.01,
          f'{share(corner, CAMERA_BLUE) * 100:.0f}% blue bottom-right against '
          f'{share(other_corner, CAMERA_BLUE) * 100:.1f}% bottom-left')

    check('and the camera is an inset rather than the whole picture',
          0.01 < blue_all < 0.35,
          f'{blue_all * 100:.1f}% of the frame is camera')

shutil.rmtree(work, ignore_errors=True)

passed = sum(1 for r in results if r['pass'])
print(f'\n{passed}/{len(results)} stream checks passed')
if passed != len(results):
    print('failing: ' + ', '.join(r['label'] for r in results if not r['pass']))
    sys.exit(1)
