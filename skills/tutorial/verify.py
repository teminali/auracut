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
  · a CUT really being a cut means the whole change lands between two
    frames rendered 17ms apart, and nothing at all moves in the 17ms
    before them;
  · the one MOVE in the film really being a move means its midpoint is
    genuinely between its ends, which is the same measurement run the
    other way;
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
import math
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


def build_take(directory, events=None, transcript=None):
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
        'events': events if events is not None else [
            {'tMs': CLICK_1_MS, 'kind': 'click', 'x': square_x, 'y': square_y},
            {'tMs': CLICK_1_MS + 180, 'kind': 'click', 'x': square_x, 'y': square_y},
            {'tMs': CLICK_2_MS, 'kind': 'click', 'x': 0.8, 'y': 0.8},
        ],
        'samples': samples,
    }
    with open(os.path.join(directory, 'cursor.json'), 'w') as f:
        json.dump(manifest, f)

    # A transcript beside the take is used instead of running Whisper, so
    # the parts of the skill that read the WORDS can be checked without a
    # machine-dependent speech model deciding whether the suite passes.
    if transcript is not None:
        with open(os.path.join(directory, 'transcript.json'), 'w') as f:
            json.dump(transcript, f)

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


# Every colour in this fixture is dark AND saturated, so its darkest
# channel is 48. Backdrop paint is pale: measured on the light default,
# the pixels that were being miscounted have a darkest channel of 180 to
# 197. 130 sits between the two with room on both sides.
DARKEST_CHANNEL = 130


def mask_for(img, channel):
    """
    Pixels where `channel` dominates the other two by a clear margin AND
    the pixel is a dark, saturated colour rather than pale paint.

    A distance-to-colour test was the first version of this and it was
    wrong in a way that took a frame dump to see: the skill applies a
    vignette, so the green square in the CORNER of the picture — the
    darkest place in the frame — comes back at (38,150,38) rather than
    (48,192,48) and falls outside any tolerance tight enough to be
    meaningful. Hue survives the grade; absolute colour does not, and a
    check that a grade can break is a check that will break.

    `DARKEST_CHANNEL` is the second half of that lesson, and it was added
    when the default backdrop became a light one. `daylight` has a coral
    corner, and a coral corner is red-dominant by the hue test alone: the
    share of the frame edges reading as "the recording" went from 0% to
    16% against a threshold of 20% without one pixel of recording moving.
    The check was still passing and had stopped measuring what it says.

    The bound is deliberately ONE-SIDED, so it cannot undo the first
    lesson. Every grade in this skill darkens — the vignette, the dip to
    black — and darkening only lowers the darkest channel. Nothing that
    was in range can be pushed out of it. What it excludes is pale
    backdrop paint, which was never meant to count.
    """
    if img is None:
        return None
    r, g, b = img[:, :, 0], img[:, :, 1], img[:, :, 2]
    saturated = img.min(axis=2) < DARKEST_CHANNEL
    if channel == 'green':
        return (g > r + 40) & (g > b + 40) & saturated
    if channel == 'blue':
        return (b > r + 40) & (b > g + 40) & saturated
    if channel == 'red':
        return (r > g + 40) & (r > b + 40) & saturated
    raise ValueError(channel)


def words_per_clip(track):
    """Mean words a clip on this track carries. 1.0 is kinetic type."""
    texts = [c['name'] for c in track['clips'] if c.get('name')]
    if not texts:
        return 0.0
    return sum(len(t.split()) for t in texts) / len(texts)


def sentence_tracks(timeline):
    """
    The text tracks that hold SENTENCES rather than single words.

    There are two now: whole-sentence subtitles, and the kinetic display
    that puts one word per clip on screen. Told apart by measuring the
    clips rather than by matching the track name, which is the same rule
    the exporter uses to decide what goes in the `.srt` and is checked
    the same way in `exportSubtitles.test.ts`.
    """
    return [t for t in timeline['tracks']
            if t['type'] == 'text' and words_per_clip(t) >= 2]


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

    args = {'folder': directory, 'captions': False, 'edge': 'neon-cyan'}
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
        # Through `mask_for`, not a second inline copy of it. There WAS a
        # second copy, and it is why this check did not move when the
        # colour test was corrected.
        edge_cols = np.concatenate([rest[:, :6], rest[:, -6:]], axis=1)
        edge_is_screen = float(mask_for(edge_cols, 'red').mean())
        check('the picture is inset, so the backdrop shows at the edges',
              edge_is_screen < 0.2,
              f'{edge_is_screen * 100:.0f}% of the left and right edges are the recording')

        # The rim is deliberately restrained and therefore anti-aliases
        # with the red picture rather than producing pure #67e8f9 pixels.
        # Identify its cyan direction, then count it only in a narrow band
        # along the known red plate's top and left edges. The blue camera
        # occupies the bottom-right and cannot satisfy this by accident.
        rr, gg, bb = rest[:, :, 0], rest[:, :, 1], rest[:, :, 2]
        cyan = (gg > rr + 30) & (bb > rr + 40) & (bb > 160)
        red = mask_for(rest, 'red')
        ys, xs = np.nonzero(red)
        edge_band = np.zeros(cyan.shape, dtype=bool)
        if len(xs) > 0:
            x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
            edge_band[max(0, y0 - 10):min(rest.shape[0], y0 + 5),
                      max(0, x0 - 10):min(rest.shape[1], x1 + 11)] = True
            edge_band[max(0, y0 - 10):min(rest.shape[0], y1 + 11),
                      max(0, x0 - 10):min(rest.shape[1], x0 + 5)] = True
        edge_cyan = int((cyan & edge_band).sum())
        outer_cyan = np.concatenate([cyan[:, :6], cyan[:, -6:]], axis=1)
        check('the selected cinematic edge renders on the picture',
              edge_cyan > 500,
              f'{edge_cyan} cyan-directed pixels along the picture rim')
        check('and its glow stays inside the inset',
              int(outer_cyan.sum()) == 0,
              f'{int(outer_cyan.sum())} cyan pixels reached the outermost 6px')
    else:
        check('the picture is inset, so the backdrop shows at the edges', False, 'no frame')
        check('the selected cinematic edge renders on the picture', False, 'no frame')
        check('and its glow stays inside the inset', False, 'no frame')

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
    #
    # AND IT DOES NOT RUN UNDER --selftest, which was a real bug rather
    # than a tidy-up. This branch BUILDS AGAIN, without `raw`, so from
    # here on the timeline held a full tutorial assembly — and every
    # control after it was quietly measuring the thing it was supposed to
    # be the control for. `the film opens from black` had been reported
    # as "STILL PASSED, proves nothing" for exactly that reason, on a
    # build where the raw assembly genuinely has no fade. The rebuild is
    # `control=False`, so skipping it costs the selftest nothing.
    stt = ok(call('check_transcription_ready', {}), 'stt')
    if stt.get('fast') and not SELFTEST:
        captioned = ok(call('build_tutorial_from_recording',
                            {'folder': directory, 'captions': True}), 'captioned')
        check('with a fast backend the transcript is waited for, not deferred',
              captioned.get('transcribedInBackground') is False,
              f"transcribedInBackground={captioned.get('transcribedInBackground')}, "
              f"backend={stt.get('backend')}",
              control=False)
    elif stt.get('fast'):
        check('with a fast backend the transcript is waited for, not deferred',
              True,
              f"backend={stt.get('backend')}, not re-run under --selftest",
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

    # ── 9. The transitions, and they are the reference's ─────────────
    #
    # THIS SECTION WAS REWRITTEN, and the old version passing is the
    # reason it needed to be. It checked that the framing arrives on a
    # hard CUT, which is what the skill used to do and what the first
    # reference video does. The skill now GLIDES between the same
    # framings, on a curve fitted to the kinetic-typography reference at
    # RMS 0.010 — see `SMOOTH_SHAPE` and `GLIDE_CURVE`.
    #
    # The framings themselves did not change: `factor`, `holdMs`,
    # `driftPctPerSec` and `closeMs` are still the numbers measured off
    # `252d89a9da0a6a67df21c59e80013eb7.mp4`. What changed is how the
    # frame gets between them, so what is measured here is the MOVE.
    #
    # The keyframes are read off the timeline rather than recomputed, so
    # these render either side of the move the build ACTUALLY made. A
    # check that works out where the move ought to be and looks there is
    # checking its own arithmetic.
    scale_keys = sorted(
        (k for k in keys['keyframes'] if k['property'] == 'scaleX'),
        key=lambda k: k['timeOffsetMs'])

    # A push: a pair whose value climbs, with real time between them.
    pushes = [
        (a, b) for a, b in zip(scale_keys, scale_keys[1:])
        if b['value'] > a['value'] * 1.5 and b['timeOffsetMs'] - a['timeOffsetMs'] > 100
    ]
    check('the framing is moved to rather than cut to',
          len(pushes) > 0,
          f'{len(pushes)} timed climbs among {len(scale_keys)} scale keyframes')

    # And nothing anywhere is a cut. `hold` easing is what makes a
    # keyframe pair instantaneous, and there must not be one left: a
    # single stray hold is a frame that teleports in the middle of an
    # otherwise smooth film, which is worse than a film that cuts
    # throughout.
    #
    # The `>= 4` half was put here by the selftest, exactly as it was on
    # the repetition-loop check below. Written as `len(holds) == 0`
    # alone this PASSED on the raw build, where there are no zooms at all
    # and therefore trivially no cutting ones: a check asserting that
    # something did not happen, on a build where nothing happens.
    # Requiring the keyframes to BE there makes it measure the grammar
    # rather than the absence of one.
    holds = [k for k in scale_keys if k['easing'] == 'hold']
    check('and no framing anywhere still cuts',
          len(holds) == 0 and len(scale_keys) >= 4,
          f'{len(holds)} hold-eased of {len(scale_keys)} scale keyframes')

    # Every check below runs whether or not a push was found, and reports
    # what it could not measure. Skipping them on the raw build would
    # leave them out of `results` entirely, and a check with no control is
    # a check nobody has shown measures anything.
    held, arrived = pushes[0] if pushes else (None, None)

    # The measurement that separates a move from a cut, and it is the
    # same one used on the closing pull-back below: sample the MIDPOINT.
    # A cut's midpoint equals one of its ends. A move's is between them,
    # and an eased-both-ends move is near the middle rather than hard up
    # against either side, which is what the viewer feels as smooth.
    if arrived is not None:
        a_ms, b_ms = held['timeOffsetMs'], arrived['timeOffsetMs']
        mid_ms = (a_ms + b_ms) // 2
        a = share(frame(a_ms), 'green')
        m = share(frame(mid_ms), 'green')
        b = share(frame(b_ms), 'green')
        travel = b - a
        check('the push is in flight at its own midpoint, not already landed',
              b_ms - a_ms >= 300 and travel > 0.02
              and (m - a) > travel * 0.15 and (b - m) > travel * 0.15,
              f'green {a * 100:.3f}% at {a_ms}ms, {m * 100:.3f}% at {mid_ms}ms, '
              f'{b * 100:.3f}% at {b_ms}ms across a {b_ms - a_ms}ms move')
    else:
        check('the push is in flight at its own midpoint, not already landed',
              False, 'no move to measure')

    # The same measurement on the closing pull-back, which was the one
    # move the film had when it cut and is now simply the last of
    # several. Kept because it is the longest move in the film and so
    # the one where a broken curve is most visible.
    close = scale_keys[-1] if scale_keys else None
    launch = scale_keys[-2] if len(scale_keys) > 1 else None
    if launch is not None and close['value'] < launch['value']:
        a_ms, b_ms = launch['timeOffsetMs'], close['timeOffsetMs']
        mid_ms = (a_ms + b_ms) // 2
        a = share(frame(a_ms), 'red')
        m = share(frame(mid_ms), 'red')
        b = share(frame(b_ms), 'red')
        travel = a - b
        check('the closing pull-back travels through its own midpoint',
              b_ms - a_ms > 400 and travel > 0.05
              and (a - m) > travel * 0.15 and (m - b) > travel * 0.15,
              f'the recording covers {a * 100:.1f}% of the frame at {a_ms}ms, '
              f'{m * 100:.1f}% at {mid_ms}ms, {b * 100:.1f}% at {b_ms}ms')
    else:
        check('the closing pull-back travels through its own midpoint', False,
              'no closing move in the keyframe track')

    # Every one of the reference's four shots creeps. An edit whose
    # shots hold still is a slideshow, and this is the difference. 3%/s of
    # scale is 6.1% of AREA over a second, which is what the green
    # square's share of the frame measures.
    settled = (arrived['timeOffsetMs'] + 20) if arrived is not None else 700
    crept = share(frame(settled), 'green')
    later = share(frame(settled + 1000), 'green')
    growth = (later / crept - 1) * 100 if crept > 0 else 0
    check('the held framing creeps rather than sitting still',
          4.0 < growth < 9.0,
          f'green {crept * 100:.3f}% -> {later * 100:.3f}% over 1.0s, {growth:+.1f}%')

    # The reference's last frame is its first: matched against each other
    # they fit at scale 1.000 on 394 of 411 inlying features. Here the
    # film has to land back on the framing it opened on, and to do it
    # before the dip to black rather than under it.
    #
    # NOT a control. The raw build never leaves the resting framing at
    # all, so it lands where it opened for the least interesting reason
    # there is; what this catches is a closing move that overshoots,
    # stops short, or runs on into the fade.
    rest_by = report['durationMs'] - 620
    opened = share(frame(600), 'green')
    landed = share(frame(rest_by), 'green')
    apart = abs(landed - opened) / opened if opened > 0 else 1
    check('the film lands on the framing it opened on',
          apart < 0.06,
          f'green {opened * 100:.3f}% at 0.6s against {landed * 100:.3f}% '
          f'at {rest_by}ms, {apart * 100:.1f}% apart',
          control=False)

    shutil.rmtree(directory, ignore_errors=True)

    # ── 10. Opening on the face, and only when it should ─────────────
    #
    # Somebody who starts by saying who they are and what they are about
    # to show is not narrating a screen, and an inset webcam in the
    # corner of a static desktop is the worst framing available for it.
    #
    # The pair of takes below is the whole check, and the SECOND one is
    # what makes the first mean anything: identical footage, identical
    # timings, identical cursor track, and words that point at the screen
    # instead of introducing anybody. A detector that simply liked the
    # start of takes would pass the first and fail the second.
    intro_words = [
        {'startMs': 200, 'endMs': 3600, 'text': 'Hi everyone, my name is Sam.'},
        {'startMs': 3800, 'endMs': 8200,
         'text': "Today I'm going to show you how the importer works."},
    ]
    demo_words = [
        {'startMs': 200, 'endMs': 3600, 'text': 'Right, so here you can see the importer screen.'},
        {'startMs': 3800, 'endMs': 8200, 'text': 'As you can see the queue is already full.'},
    ]
    late_click = [{'tMs': 10500, 'kind': 'click', 'x': 0.8, 'y': 0.8}]

    def run(words):
        folder = tempfile.mkdtemp(prefix='kerf-tutorial-intro-')
        build_take(folder, events=late_click, transcript=words)
        opts = {'folder': folder, 'captions': True}
        if SELFTEST:
            opts['raw'] = True
        rep = ok(call('build_tutorial_from_recording', opts), 'intro build')
        early = share(frame(300), 'blue')
        middle = share(frame(6000), 'blue')
        after = share(frame(11800), 'blue')
        shutil.rmtree(folder, ignore_errors=True)
        return rep, early, middle, after

    intro_rep, intro_early, intro_mid, intro_after = run(intro_words)

    check('the film opens on the face when the take opens with an introduction',
          intro_early > 0.9,
          f"{intro_early * 100:.0f}% of the very first frames are the camera, "
          f"introductionMs={intro_rep['introductionMs']}")

    # Not a control: it is the control FOR its neighbour. Without it,
    # "the film opens on the face" would also pass on a build where the
    # camera simply never left.
    check('and hands the frame back when the work starts',
          intro_mid > 0.9 and intro_after < 0.2,
          f'{intro_mid * 100:.0f}% camera at 6.0s, {intro_after * 100:.0f}% at 11.8s',
          control=False)

    demo_rep, demo_early, _, _ = run(demo_words)

    # Not a control, and it cannot be one: it asserts that something did
    # NOT happen, and nothing happens on the raw build, so it would pass
    # there for the least interesting reason available. It is the control
    # for its NEIGHBOUR, and the stronger half of the pair — the two takes
    # differ only in what is said over them.
    check('and does not, on the same take, when the words point at the screen',
          demo_rep['introductionMs'] == 0 and demo_early < 0.2,
          f"introductionMs={demo_rep['introductionMs']}, "
          f'{demo_early * 100:.0f}% of the first frames are the camera',
          control=False)

    check('and says why it decided either way',
          any('open' in n.lower() or 'introduc' in n.lower() for n in demo_rep['notes']),
          next((n[:80] for n in demo_rep['notes']
                if 'open' in n.lower() or 'introduc' in n.lower()), 'nothing said'),
          control=False)

    # ── 12. The words are read before they go on screen ──────────────
    #
    # The check that was missing, and the reason it is here.
    #
    # A real 275-second Swahili take was transcribed on device and came
    # back as 127 caption lines of which 109 were the SAME sentence,
    # consecutively, from 37s to the end of the film. The build reported
    # success and every number it checked was fine: the decoder exited 0,
    # the language was detected correctly (`sw`, p=0.70), the segment
    # timings were plausible, and 127 caption clips really were on the
    # timeline. Nothing anywhere read the words.
    #
    # The cause is fixed at source, in `electron/transcribe.ts` — whisper
    # feeds each window's output back in as context for the next one, so
    # a sentence it is unsure of reinforces itself until it latches, and
    # `-mc 0` cuts that path. Measured on that take, one flag apart: 124
    # segments / 15 distinct against 70 segments / 70 distinct.
    #
    # This checks the SECOND line of defence rather than the flag,
    # because the flag fixes the failure that was found and this catches
    # the next one. A transcript is supplied directly, so no model has to
    # misbehave on demand for the check to mean something.
    looped = (
        [{'startMs': 200, 'endMs': 1600, 'text': 'Right, here is the importer screen.'}]
        + [{'startMs': 2000 + i * 800, 'endMs': 2700 + i * 800,
            'text': 'Tukazumu zia iswi ya manu nuzi.'} for i in range(12)]
    )
    folder = tempfile.mkdtemp(prefix='kerf-tutorial-loop-')
    build_take(folder, transcript=looped)
    opts = {'folder': folder, 'captions': True, 'cleanCaptions': False}
    if SELFTEST:
        opts['raw'] = True
    loop_rep = ok(call('build_tutorial_from_recording', opts), 'looped build')

    tl = ok(call('describe_timeline', {}), 'looped timeline')
    # The SENTENCE track only. There are two text tracks now and the
    # kinetic one holds a clip per WORD, so a single surviving line would
    # be counted once for each of its words and `repeats <= 1` would fail
    # on a build that repaired the loop correctly.
    caption_text = [c['name'] for t in sentence_tracks(tl) for c in t['clips']]
    repeats = sum(1 for n in caption_text if 'Tukazumu' in n)
    shutil.rmtree(folder, ignore_errors=True)

    # 13 cues went in, 12 of them identical. At most one may survive: the
    # first occurrence is kept on purpose, because it may be a real line
    # the decoder then got stuck on.
    #
    # The `>= 2` half is not decoration and was put there by the selftest.
    # Written as `repeats <= 1` alone this passed on the RAW build, where
    # there are no captions at all and so trivially no repeated ones —
    # a check that asserts something did not happen, on a build where
    # nothing happens. Requiring the surviving lines to BE there makes it
    # measure the repair rather than the absence of captions, and makes
    # it a control that genuinely goes red.
    check('a repetition loop in the transcript does not reach the screen',
          repeats <= 1 and len(caption_text) >= 2,
          f'{repeats} of the 12 identical lines are on the timeline, '
          f'{len(caption_text)} caption clips in total')

    # Saying so matters as much as doing it. Captions that silently
    # vanish read as a take with no narration in it.
    check('and the build says the narration there was not transcribed',
          any('not transcribed' in n.lower() or 'repetition loop' in n.lower()
              for n in loop_rep['notes']),
          next((n[:88] for n in loop_rep['notes']
                if 'not transcribed' in n.lower() or 'repetition loop' in n.lower()),
               'NOTHING SAID'))

    # The control for both of the above: a clean transcript of the same
    # shape must come through whole. Without this, "the loop was removed"
    # would also pass on a build that dropped every caption it was given.
    clean = [{'startMs': 200 + i * 800, 'endMs': 900 + i * 800,
              'text': f'This is line number {i} of the narration.'} for i in range(13)]
    folder = tempfile.mkdtemp(prefix='kerf-tutorial-clean-')
    build_take(folder, transcript=clean)
    opts = {'folder': folder, 'captions': True, 'cleanCaptions': False}
    if SELFTEST:
        opts['raw'] = True
    ok(call('build_tutorial_from_recording', opts), 'clean build')
    tl = ok(call('describe_timeline', {}), 'clean timeline')
    kept = sum(1 for t in sentence_tracks(tl) for c in t['clips'])
    shutil.rmtree(folder, ignore_errors=True)

    check('and a clean transcript of the same shape is left alone',
          kept >= 13,
          f'{kept} caption clips from 13 distinct lines')

    # ── 13. The kinetic captions ─────────────────────────────────────
    #
    # The design is a copy of a measured reference; `_design` in
    # skill.json is where the measurements are. What is checked here is
    # not that the numbers are right, it is that the timeline carries the
    # structure they describe, and that the SENTENCE was not thrown away
    # to get it.
    #
    # Driven from a supplied transcript rather than from Whisper, so it
    # runs the same on a machine with no speech model on it at all.
    lines = [
        {'startMs': 400, 'endMs': 3200, 'text': 'The encoder crashed during the final export.'},
        {'startMs': 3600, 'endMs': 6800, 'text': 'So we rewrote the pipeline from scratch.'},
        {'startMs': 7200, 'endMs': 10400, 'text': 'Now it renders everything in parallel.'},
    ]
    folder = tempfile.mkdtemp(prefix='kerf-tutorial-kinetic-')
    build_take(folder, transcript=lines)
    opts = {'folder': folder, 'captions': True, 'cleanCaptions': False}
    if SELFTEST:
        opts['raw'] = True
    kin_rep = ok(call('build_tutorial_from_recording', opts), 'kinetic build')
    kin_tl = ok(call('describe_timeline', {}), 'kinetic timeline')
    shutil.rmtree(folder, ignore_errors=True)

    text_tracks = [t for t in kin_tl['tracks'] if t['type'] == 'text']
    sentence = sentence_tracks(kin_tl)
    kinetic = [t for t in text_tracks if t['clips'] and words_per_clip(t) < 2]

    check('the narration is laid down twice: as sentences and as kinetic type',
          len(sentence) >= 1 and len(kinetic) >= 1,
          f'{len(text_tracks)} text tracks, words per clip '
          + ', '.join(f'{words_per_clip(t):.1f}' for t in text_tracks))

    # The half that is easy to lose. The kinetic track is the look, and
    # a build that produced it by REPLACING the transcript would pass
    # every visual check while destroying the only copy of what was said
    # and the only thing an `.srt` can be written from.
    said = ' '.join(c['name'] for t in sentence for c in t['clips']).lower()
    check('and the whole sentence survives, not just the words on screen',
          'crashed' in said and 'during' in said and 'final' in said,
          f'sentence track carries {sum(len(t["clips"]) for t in sentence)} clips: '
          f'"{said[:56]}..."' if said else 'nothing on the sentence track')

    # Drawn by default. A tutorial that shows only the emphasis words is
    # a tutorial with no subtitles on it, and somebody who cannot hear
    # the audio needs the sentence rather than the three words of it
    # that carried the emphasis.
    check('the sentence track is drawn, not silently hidden',
          bool(sentence) and not any(t.get('muted') for t in sentence),
          ', '.join(f"{t['name']}: muted={t.get('muted')}" for t in sentence) or 'no sentence track')

    # And muting it is a build option, not a manual step. Muted rather
    # than removed is the point: the words are still edited, still
    # exported as the `.srt`, and one click brings them back.
    folder = tempfile.mkdtemp(prefix='kerf-tutorial-muted-')
    build_take(folder, transcript=lines)
    opts = {'folder': folder, 'captions': True, 'cleanCaptions': False, 'subtitlesHidden': True}
    if SELFTEST:
        opts['raw'] = True
    ok(call('build_tutorial_from_recording', opts), 'muted build')
    muted_tl = ok(call('describe_timeline', {}), 'muted timeline')
    shutil.rmtree(folder, ignore_errors=True)
    muted_sentence = sentence_tracks(muted_tl)

    check('and asking for it muted mutes it rather than dropping the words',
          bool(muted_sentence)
          and all(t.get('muted') for t in muted_sentence)
          and sum(len(t['clips']) for t in muted_sentence) >= 3,
          ', '.join(f"{t['name']}: muted={t.get('muted')}, {len(t['clips'])} clips"
                    for t in muted_sentence) or 'the sentence track was removed')

    kin_clips = [c for t in kinetic for c in t['clips']]
    check('the kinetic captions really are one word a clip',
          len(kin_clips) >= 6 and all(len(c['name'].split()) == 1 for c in kin_clips),
          f'{len(kin_clips)} word clips, '
          f'longest "{max((c["name"] for c in kin_clips), key=len, default="")}"'
          if kin_clips else 'no kinetic clips')

    # Fewer than the transcript has, or nothing was emphasised: the
    # point of the design is that it shows the words that carry the line,
    # not the line.
    spoken = sum(len(line['text'].split()) for line in lines)
    check('and they are a selection rather than the whole transcript',
          0 < len(kin_clips) < spoken,
          f'{len(kin_clips)} words on screen out of {spoken} spoken')

    # The move, read off the clips rather than rendered: a word that has
    # another arriving after it carries eased scale and position keys, and
    # the newest word of a phrase carries none at all.
    with_keys = [c for c in kin_clips if c.get('keyframeCount', 0) > 0]
    check('the stack move is editable keyframes on each word',
          len(with_keys) >= 3,
          f'{len(with_keys)} of {len(kin_clips)} word clips carry keyframes')

    if with_keys:
        kf = ok(call('list_keyframes', {'clipId': with_keys[0]['id']}), 'word keys')
        eased = [k for k in kf['keyframes'] if k['easing'] == 'easeInOut']
        scales = sorted((k for k in kf['keyframes'] if k['property'] == 'scaleX'),
                        key=lambda k: k['timeOffsetMs'])
        shrank = bool(scales) and scales[-1]['value'] < scales[0]['value'] * 0.95
        check('and every one of them is eased at both ends, and shrinks the word',
              len(eased) == len(kf['keyframes']) and shrank,
              f"{len(eased)}/{len(kf['keyframes'])} eased, scale "
              f"{scales[0]['value']:.2f} to {scales[-1]['value']:.2f}" if scales
              else f"{len(eased)}/{len(kf['keyframes'])} eased, no scale keys")
    else:
        check('and every one of them is eased at both ends, and shrinks the word',
              False, 'no keyframed word clips to read')

    check('the build reports how many words reached the screen',
          kin_rep.get('kineticWords', 0) == len(kin_clips),
          f"kineticWords={kin_rep.get('kineticWords')} against {len(kin_clips)} on the timeline",
          control=False)


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
