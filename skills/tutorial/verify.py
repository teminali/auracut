"""
The verification test that makes the Tutorial skill a skill.

    KERF_RPC_PORT=<port> python3 skills/tutorial/verify.py

HANDOVER §6: "A skill is not a prompt pack: it is tools + assets + a
template project + a verification test." This is the fourth part, and
the reason to believe the other three.

It runs the skill the way a buyer would — point it at a take folder and
let it build — and then measures the RESULT. Not the tool's report: the
pixels on the canvas and the clips on the timeline.

THE METHOD, AND WHY IT IS COLOURS
---------------------------------
The take is SYNTHESISED with ffmpeg, so every claim the skill makes has
a measurable consequence:

    screen.mp4   a dark red field, 1280x800, with ONE bright green
                 square in the top-left corner
    camera.mp4   solid blue, 1920x1080 (big enough to fill the frame,
                 which is a rule the skill enforces and this checks)
    cursor.json  a click on the green square at 1.5s, a nine-second
                 pause, and a click at 10.5s

Then:

  · a zoom that really happened makes green a much larger share of the
    frame at 2.1s than at 0.7s;
  · a zoom that was really AIMED puts the green near the middle, not
    merely larger somewhere;
  · a camera takeover that really happened makes the frame blue at 6s
    and not blue at 1s or 11.5s;
  · an inset frame really being inset means the backdrop is visible at
    the edges at rest;
  · click ticks really being on the timeline means audio clips exist,
    with a source file that is on disk.

A tool's own report is not evidence. This codebase has shipped a
montage that reported fifteen shots on the beat while rendering fifteen
seconds of black, and every suite written since works this way because
of it.

--selftest is the control: it builds the take with `raw: true`, which
turns every one of the skill's features off, and requires each check
marked `control` to go RED. A check that passes on the raw assembly was
measuring something the skill did not do.
"""
import base64
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'tools'))
from kerf_rpc import call, ok  # noqa: E402

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

SELFTEST = '--selftest' in sys.argv

# The take's own numbers, in one place: verify.py and the generator below
# must agree or every measurement is against the wrong frame.
W, H = 1280, 800
DURATION_S = 12
SQUARE = 160            # px, at the top-left of the screen recording
CLICK_1_MS = 1500
CLICK_2_MS = 10500

SCREEN_RED = (0xB0, 0x30, 0x30)
SQUARE_GREEN = (0x30, 0xC0, 0x30)
CAMERA_BLUE = (0x30, 0x50, 0xD0)

results = []


def check(label, good, detail, control=True):
    print(f"  {'PASS' if good else 'FAIL'}  {label:52s} {detail}")
    results.append({'label': label, 'pass': bool(good), 'control': control})


# ── Building the take ───────────────────────────────────────────────

def ffmpeg():
    for name in ('ffmpeg',):
        path = shutil.which(name)
        if path:
            return path
    return None


def build_take(directory):
    """A screen and a camera with known colours, plus a cursor track."""
    ff = ffmpeg()
    if not ff:
        print('  ERROR  ffmpeg is not on PATH; this suite synthesises its own take.')
        sys.exit(1)

    screen = os.path.join(directory, 'screen.mp4')
    camera = os.path.join(directory, 'camera.mp4')

    subprocess.run(
        [ff, '-y', '-loglevel', 'error',
         '-f', 'lavfi', '-i', f'color=c=0x{SCREEN_RED[0]:02X}{SCREEN_RED[1]:02X}{SCREEN_RED[2]:02X}:s={W}x{H}:d={DURATION_S}:r=30',
         '-vf', f'drawbox=x=48:y=48:w={SQUARE}:h={SQUARE}:'
                f'color=0x{SQUARE_GREEN[0]:02X}{SQUARE_GREEN[1]:02X}{SQUARE_GREEN[2]:02X}@1:t=fill',
         '-pix_fmt', 'yuv420p', screen],
        check=True)

    subprocess.run(
        [ff, '-y', '-loglevel', 'error',
         '-f', 'lavfi', '-i', f'color=c=0x{CAMERA_BLUE[0]:02X}{CAMERA_BLUE[1]:02X}{CAMERA_BLUE[2]:02X}:s=1920x1080:d={DURATION_S}:r=30',
         '-pix_fmt', 'yuv420p', camera],
        check=True)

    # The centre of the square, normalised. The zoom should aim HERE.
    square_x = (48 + SQUARE / 2) / W
    square_y = (48 + SQUARE / 2) / H

    samples = []
    for t in range(0, DURATION_S * 1000, 33):
        samples.append({'tMs': t, 'x': square_x, 'y': square_y})

    manifest = {
        'durationMs': DURATION_S * 1000,
        'scaleFactor': 1,
        'marks': [],
        'events': [
            {'tMs': CLICK_1_MS, 'kind': 'click', 'x': square_x, 'y': square_y},
            {'tMs': CLICK_1_MS + 180, 'kind': 'click', 'x': square_x, 'y': square_y},
            {'tMs': CLICK_2_MS, 'kind': 'click', 'x': 0.8, 'y': 0.8},
        ],
        'samples': samples,
    }
    with open(os.path.join(directory, 'cursor.json'), 'w') as f:
        json.dump(manifest, f)

    return {'square': (square_x, square_y)}


# ── Reading the canvas ──────────────────────────────────────────────

def frame(ms, tries=50):
    """
    The composited canvas at `ms`, once the media has actually decoded.

    Waiting on `mediaPending` rather than on the picture holding still.
    A video element that has not decoded yet composites as the
    placeholder gradient, which is a perfectly plausible dark frame and
    is why every measurement in this repo waits for this flag instead of
    sampling once and hoping.
    """
    for _ in range(tries):
        result = ok(call('get_frame_context', {'atMs': int(ms), 'includeImage': True}), 'frame')['frame']
        if result and result.get('mediaPending', 0) == 0:
            raw = base64.b64decode(result['imageDataUrl'].split(',', 1)[1])
            return np.asarray(Image.open(io.BytesIO(raw)).convert('RGB'), dtype=np.int16)
        time.sleep(0.1)
    return None


def mask_for(img, channel):
    """
    Pixels where `channel` dominates the other two by a clear margin.

    A distance-to-colour test was the first version of this and it was
    wrong in a way that took a frame dump to see: the skill applies a
    vignette, so the green square in the CORNER of the picture — the
    darkest place in the frame — comes back at (38,150,38) rather than
    (48,192,48) and falls outside any tolerance tight enough to be
    meaningful. Hue survives the grade; absolute colour does not, and a
    check that a grade can break is a check that will break.
    """
    if img is None:
        return None
    r, g, b = img[:, :, 0], img[:, :, 1], img[:, :, 2]
    if channel == 'green':
        return (g > r + 40) & (g > b + 40)
    if channel == 'blue':
        return (b > r + 40) & (b > g + 40)
    if channel == 'red':
        return (r > g + 40) & (r > b + 40)
    raise ValueError(channel)


def share(img, channel):
    """Fraction of the frame where that channel dominates."""
    mask = mask_for(img, channel)
    return 0.0 if mask is None else float(mask.mean())


def darkness(img):
    """Fraction of the frame that is essentially black."""
    if img is None:
        return 0.0
    return float((img.max(axis=2) < 40).mean())


def centroid(img, channel):
    """Where that colour sits, normalised. None when there is none of it."""
    mask = mask_for(img, channel)
    if mask is None:
        return None
    ys, xs = np.nonzero(mask)
    if len(xs) < 50:
        return None
    return float(xs.mean() / img.shape[1]), float(ys.mean() / img.shape[0])


# ── The run ─────────────────────────────────────────────────────────

def main():
    directory = tempfile.mkdtemp(prefix='kerf-tutorial-')
    build_take(directory)

    args = {'folder': directory, 'captions': False}
    if SELFTEST:
        # The control: every feature off. Each `control` check must go red.
        args['raw'] = True

    report = ok(call('build_tutorial_from_recording', args), 'build')
    print()

    # ── 1. The take is on the timeline at all ────────────────────────
    timeline = ok(call('describe_timeline', {}), 'timeline')
    clips = [c for t in timeline['tracks'] for c in t['clips']]
    names = [c['name'] for c in clips]

    check('control: the take is on the timeline',
          any(n == 'Screen' for n in names) and any(n == 'Camera' for n in names),
          f"{len(clips)} clips: {', '.join(sorted(set(names))[:6])}", control=False)

    check('control: the canvas matches the recorded display',
          report['width'] == W and report['height'] == H,
          f"{report['width']}x{report['height']} against {W}x{H}", control=False)

    # ── 2. The zoom is real, and aimed ───────────────────────────────
    rest = frame(700)
    zoomed = frame(2100)

    green_rest = share(rest, 'green')
    green_zoom = share(zoomed, 'green')
    check('the zoom really makes the clicked thing bigger',
          green_rest > 0.002 and green_zoom > green_rest * 2,
          f'green {green_rest * 100:.2f}% at rest, {green_zoom * 100:.2f}% zoomed')

    # "Aimed" cannot mean "dead centre", and the reason is geometry
    # rather than tuning: bringing a point 10% from the edge to the
    # middle needs a scale of five. What it can mean, and what the
    # `edgeOverhang` rule exists to buy, is that the clicked thing
    # travels a long way TOWARD the middle instead of merely swelling
    # where it was.
    rest_aim = centroid(rest, 'green')
    aim = centroid(zoomed, 'green')
    moved = (abs(rest_aim[0] - 0.5) - abs(aim[0] - 0.5)) if (rest_aim and aim) else 0
    check('the zoom is aimed at the click, not merely closer to it',
          aim is not None and rest_aim is not None and moved > 0.06,
          f'green centre {rest_aim[0]:.2f} to {aim[0]:.2f}, {moved:+.2f} toward the middle'
          if (rest_aim and aim) else 'no green to measure')

    # ── 3. The frame is inset on a backdrop ──────────────────────────
    if rest is not None:
        edge = np.concatenate([rest[:, :6].reshape(-1, 3), rest[:, -6:].reshape(-1, 3)])
        edge_is_screen = float(
            ((edge[:, 0] > edge[:, 1] + 40) & (edge[:, 0] > edge[:, 2] + 40)).mean()
        )
        check('the picture is inset, so the backdrop shows at the edges',
              edge_is_screen < 0.2,
              f'{edge_is_screen * 100:.0f}% of the left and right edges are the recording')
    else:
        check('the picture is inset, so the backdrop shows at the edges', False, 'no frame')

    # ── 4. The camera takes the frame during the pause ───────────────
    before = share(frame(1100), 'blue')
    during = share(frame(6000), 'blue')
    after = share(frame(11400), 'blue')

    check('the camera fills the frame during the pause',
          during > 0.8,
          f'{during * 100:.0f}% of the frame is the camera at 6.0s')
    # Not a control, and it is the CONTROL FOR ITS NEIGHBOUR: without it,
    # "the frame is blue during the pause" would also pass on a build
    # where the camera was simply full frame the whole way through.
    check('and it is an inset on either side of it',
          before < 0.2 and after < 0.2,
          f'{before * 100:.0f}% at 1.1s, {after * 100:.0f}% at 11.4s',
          control=False)

    # ── 5. The sounds are files on the timeline ──────────────────────
    ticks = [c for c in clips if c['name'] == 'Click']
    air = [c for c in clips if c['name'] == 'Zoom air']
    check('a tick is placed for every click that was recorded',
          len(ticks) == 3,
          f'{len(ticks)} ticks for 3 clicks')
    check('and air under every zoom',
          len(air) == report['zoomMoments'] and len(air) > 0,
          f"{len(air)} for {report['zoomMoments']} zooms")

    pool = ok(call('list_media_pool', {}), 'pool')
    sfx = [a for a in pool['assets'] if a['type'] == 'audio']
    check('the sounds are real files in the media pool',
          len(sfx) == 2 and {a['name'] for a in sfx} == {'Click.wav', 'Zoom air.wav'},
          f"{len(sfx)} audio assets: {', '.join(sorted(a['name'] for a in sfx)) or 'none'}")

    # ── 6. The moments came from real input, not the fallback ────────
    check('the zooms came from the click stream, not the cursor track',
          report['momentsFrom'] == 'events',
          f"momentsFrom={report['momentsFrom']}, {report['zoomMoments']} moments")

    # ── 7. Nothing was baked ─────────────────────────────────────────
    keys = ok(call('list_keyframes', {'clipId': next(c['id'] for c in clips if c['name'] == 'Screen')}),
              'keyframes')
    check('the zoom is editable keyframes, not a rendered move',
          len(keys['keyframes']) >= 8
          and any(k['property'] == 'scaleX' for k in keys['keyframes'])
          and any(k['easing'] == 'bezier' for k in keys['keyframes']),
          f"{len(keys['keyframes'])} keyframes on the screen clip")

    # Not a control either: splitting the voice off the camera clip is
    # part of laying a take down at all, not part of the skill, so it is
    # true of the raw build too. Checked here because it is the thing
    # that makes every other edit survivable, not because the skill did it.
    check('the narration is on its own track',
          report['narrationDetached'] is True,
          f"narrationDetached={report['narrationDetached']}",
          control=False)

    # ── 8. The words, when a backend fast enough to wait for is here ──
    #
    # Transcription is the one part of this skill whose PLACE in the
    # pipeline depends on the machine. With whisper.cpp it runs before
    # the build, so the camera cuts can land between sentences; with only
    # the CPU implementation it runs after, and the skill says so. Both
    # are correct and they are not the same edit, so the check is against
    # what the machine actually has rather than against one of them.
    stt = ok(call('check_transcription_ready', {}), 'stt')
    if stt.get('fast'):
        captioned = ok(call('build_tutorial_from_recording',
                            {'folder': directory, 'captions': True}), 'captioned')
        check('with a fast backend the transcript is waited for, not deferred',
              captioned.get('transcribedInBackground') is False,
              f"transcribedInBackground={captioned.get('transcribedInBackground')}, "
              f"backend={stt.get('backend')}",
              control=False)
    else:
        check('the slow backend defers the transcript instead of blocking',
              True,
              f"backend={stt.get('backend')}, nothing to wait for",
              control=False)

    # Sampled at the very first frame, and against the middle of the film
    # rather than against an absolute level: the dip is an EASE, so how
    # dark it is a twentieth of a second in is a property of the curve
    # rather than of whether there is a dip at all.
    opening = darkness(frame(20))
    middle = darkness(frame(5000))
    check('the film opens from black rather than starting flat',
          opening > 0.9 and middle < 0.1,
          f'{opening * 100:.0f}% black at 0.02s against {middle * 100:.0f}% at 5.0s')

    shutil.rmtree(directory, ignore_errors=True)


main()

if not SELFTEST:
    passed = sum(1 for r in results if r['pass'])
    print(f'\n{passed}/{len(results)} tutorial-skill checks passed')
    if passed != len(results):
        print('failing: ' + ', '.join(r['label'] for r in results if not r['pass']))
        sys.exit(1)
else:
    """
    Built with every feature off. A check that still passes was reading
    something the skill did not do.
    """
    controls = [r for r in results if r['control']]
    red = [r for r in controls if not r['pass']]
    print()
    for r in controls:
        good = not r['pass']
        print(f"  {'PASS' if good else 'FAIL'}  {r['label']:52s} "
              f"{'went red on the raw build' if good else 'STILL PASSED, proves nothing'}")
    print(f'\n{len(red)}/{len(controls)} tutorial-skill controls passed')
    if len(red) != len(controls):
        print('failing: ' + ', '.join(r['label'] for r in controls if r['pass']))
        sys.exit(1)
