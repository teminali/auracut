"""
`auto_montage_to_beats` and `assemble_from_folder`, checked on the picture.

    Kerf must be running.  python3 tools/verify_montage.py

Both tools report a great deal, and a report is exactly the thing this
codebase has been burned by: `transform.scaleX` was settable, keyframeable
and read back correctly, and rendered nothing (HANDOVER §3a). So almost
nothing here is asserted against the arguments that went in.

**The ground truth is constructed, and it is constructed to be able to
fail.**

  · The music bed is synthesised at exactly 120 BPM with a kick on every
    beat, a snare on 2 and 4, an open hat on every off-beat and ghost
    sixteenths in between. A bare click track — onsets ONLY on the beat —
    is the one signal that cannot expose either of the two beat-detection
    bugs this repo has already had, and it passed on one for months
    (HANDOVER §3a). The hats and ghosts are there precisely so a tempo
    estimator that locks onto the subdivision is caught: this bed
    measured 186 BPM before that fix.

  · The footage is six files of six DIFFERENT SOLID COLOURS. That is what
    makes "which file is on screen at 5.98 seconds" a measurement rather
    than a guess, so the shot ORDER and the CUT TIMES can both be read
    off the picture. One of them is 0.4s long, so the "clip is shorter
    than its slot" decision has something real to decide.

  · One file is 40KB of /dev/urandom named `.mp4`, and one is a `.txt`.
    A tool that silently drops three files out of twelve is the failure
    these tools exist to prevent, so the suite checks that the broken one
    is named, is NOT imported, and is not confused with the text file.

Every tolerance is tried in both directions. A `minShotMs` that refuses
nothing is not a guard, and a cut-to-beat window that accepts everything
is not a measurement, so each is shown rejecting a wrong value as well as
accepting a right one.

The final section leaves the compositor entirely and reads the EXPORTED
FILE with ffmpeg. `get_frame_context` proves what the compositor draws;
only the file proves the file.
"""
import base64
import io
import json
import os
import statistics
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kerf_rpc import call, ok  # noqa: E402

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

TMP = tempfile.mkdtemp(prefix='kerf-montage-')
FOLDER = os.path.join(TMP, 'shoot')
BPM = 120.0
BEAT_MS = 60000.0 / BPM
BED_SECONDS = 16.0

results = []


def check(label, good, detail):
    print(f"  {'PASS' if good else 'FAIL'}  {label:52s} {detail}")
    results.append(good)


# ── fixtures ───────────────────────────────────────────────────────

def make_bed(path, bpm=BPM, seconds=BED_SECONDS):
    """A drum pattern at a tempo we chose, written through ffmpeg.

    NOT a click track. `estimateBpm` autocorrelates the novelty curve and
    the failure mode it was rewritten to fix is locking onto the
    subdivision — which only a signal WITH events between the beats can
    expose. The hats sit on the off-beats and the ghosts on the
    sixteenths for that reason.
    """
    sr = 48000
    n = int(sr * seconds)
    buf = np.zeros(n)
    rng = np.random.default_rng(7)
    beat = 60.0 / bpm

    def put(t, sig):
        i = int(round(t * sr))
        if i >= n:
            return
        m = min(len(sig), n - i)
        buf[i:i + m] += sig[:m]

    def kick():
        L = int(0.22 * sr); t = np.arange(L) / sr
        f = 110 * np.exp(-t / 0.03) + 48
        s = np.sin(2 * np.pi * np.cumsum(f) / sr) * np.exp(-t / 0.075)
        s[:int(0.003 * sr)] += rng.normal(0, 0.6, int(0.003 * sr))
        return s * 0.95

    def snare():
        L = int(0.16 * sr); t = np.arange(L) / sr
        s = rng.normal(0, 1, L) * np.exp(-t / 0.045)
        s += np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05) * 0.5
        return s * 0.62

    def hat(amp):
        L = int(0.05 * sr); t = np.arange(L) / sr
        s = rng.normal(0, 1, L) * np.exp(-t / 0.012)
        return np.diff(np.concatenate([[0], s])) * amp

    for b in range(int(seconds / beat)):
        t = b * beat
        put(t, kick())
        if b % 2 == 1:
            put(t, snare())
        put(t + beat * 0.50, hat(0.30))
        put(t + beat * 0.25, hat(0.11))
        put(t + beat * 0.75, hat(0.11))
    buf += rng.normal(0, 0.0015, n)
    buf = buf / np.abs(buf).max() * 0.89
    subprocess.run(
        ['ffmpeg', '-nostdin', '-y', '-v', 'error', '-f', 's16le', '-ar', str(sr),
         '-ac', '1', '-i', 'pipe:0', '-c:a', 'pcm_s16le', path],
        input=(buf * 32767).astype('<i2').tobytes(), check=True)


PALETTE = {
    'red': (0xE0, 0x20, 0x20), 'green': (0x20, 0xB0, 0x20), 'blue': (0x20, 0x40, 0xE0),
    'yellow': (0xE0, 0xD0, 0x20), 'magenta': (0xC0, 0x20, 0xC0), 'cyan': (0x20, 0xC0, 0xC0),
    'orange': (0xFF, 0x80, 0x00), 'black': (0, 0, 0),
}

# name -> (file, colour, seconds). `shot12_cyan` is deliberately short.
CLIPS = [
    ('shot01_red.mp4', 'red', 6.0),
    ('shot02_green.mp4', 'green', 6.0),
    ('shot03_blue.mp4', 'blue', 6.0),
    ('shot10_yellow.mp4', 'yellow', 6.0),
    ('shot11_magenta.mp4', 'magenta', 6.0),
    ('shot12_cyan.mp4', 'cyan', 0.4),
]


def build_fixtures():
    os.makedirs(FOLDER, exist_ok=True)
    for name, colour, secs in CLIPS:
        r, g, b = PALETTE[colour]
        subprocess.run([
            'ffmpeg', '-nostdin', '-y', '-v', 'error',
            '-f', 'lavfi', '-i', f'color=c=0x{r:02X}{g:02X}{b:02X}:s=640x360:r=30',
            '-t', str(secs), '-c:v', 'libx264', '-preset', 'veryfast',
            '-pix_fmt', 'yuv420p', '-g', '10', '-crf', '18',
            os.path.join(FOLDER, name),
        ], check=True)
    r, g, b = PALETTE['orange']
    subprocess.run([
        'ffmpeg', '-nostdin', '-y', '-v', 'error', '-f', 'lavfi',
        '-i', f'color=c=0x{r:02X}{g:02X}{b:02X}:s=640x360', '-frames:v', '1',
        os.path.join(FOLDER, 'still_orange.png'),
    ], check=True)
    # A file that claims to be video and is not. The point of the tool.
    with open(os.path.join(FOLDER, 'broken_download.mp4'), 'wb') as f:
        f.write(os.urandom(40000))
    with open(os.path.join(FOLDER, 'notes.txt'), 'w') as f:
        f.write('a shot list, not footage\n')
    make_bed(os.path.join(FOLDER, 'music_bed.wav'))


# ── reading the picture ────────────────────────────────────────────

def frame_rgb(at_ms):
    """Mean colour of the centre third of the composited frame."""
    f = ok(call('get_frame_context', {'atMs': at_ms, 'includeImage': True}), 'frame')['frame']
    if f.get('mediaPending', 0) > 0:
        return None
    raw = base64.b64decode(f['imageDataUrl'].split(',', 1)[1])
    a = np.array(Image.open(io.BytesIO(raw)).convert('RGB')).astype(float)
    h, w, _ = a.shape
    return tuple(a[h // 3:2 * h // 3, w // 3:2 * w // 3].reshape(-1, 3).mean(0))


def classify(rgb):
    if rgb is None:
        return 'PENDING', 999.0
    best = min(PALETTE, key=lambda k: sum((rgb[i] - PALETTE[k][i]) ** 2 for i in range(3)))
    dist = sum((rgb[i] - PALETTE[best][i]) ** 2 for i in range(3)) ** 0.5
    return best, dist


def settle(at_ms, tries=50):
    for _ in range(tries):
        c = frame_rgb(at_ms)
        if c is not None:
            return c
    return None


def colour_at(at_ms):
    return classify(settle(at_ms))[0]


def bisect_change(lo_ms, hi_ms):
    """First millisecond at which the picture stops being what it was at lo."""
    a = colour_at(lo_ms)
    b = colour_at(hi_ms)
    if a == b:
        return None, a, b
    lo, hi = lo_ms, hi_ms
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if colour_at(mid) == a:
            lo = mid
        else:
            hi = mid
    return hi, a, b


def beats_on_timeline():
    tl = ok(call('describe_timeline', {}), 'tl')
    return sorted(m['timeMs'] for m in tl['markers'] if m['kind'] == 'beat')


def video_clips():
    tl = ok(call('describe_timeline', {}), 'tl')
    vt = [t for t in tl['tracks'] if t['type'] == 'video'][0]
    return sorted(vt['clips'], key=lambda c: c['startMs'])


def fresh_assembly(**kw):
    ok(call('reset_project', {'name': 'montage-suite', 'aspectRatio': '16:9',
                              'fps': 30, 'durationMs': 20000}), 'reset')
    return ok(call('assemble_from_folder', dict(folder=FOLDER, **kw)), 'assemble')


def source_colour(name):
    return name.rsplit('_', 1)[-1].split('.')[0]


# ═══════════════════════════════════════════════════════════════════

print('auto_montage_to_beats and assemble_from_folder, measured on pixels\n')
build_fixtures()
print(f'  fixtures in {FOLDER}  ({BPM:.0f} BPM bed, {len(CLIPS)} colour clips, '
      f'1 still, 1 corrupt .mp4, 1 .txt)\n')

# ── A. assemble_from_folder ───────────────────────────────────────
print('assemble_from_folder — what happened to every file')
a = fresh_assembly()
acc = a['accounting']

check('every file is accounted for',
      acc['balances'] and acc['filesSeen'] == 10 and
      acc['subdirectories'] + acc['notMedia'] + acc['undecodable'] + acc['decoded'] == acc['filesSeen'],
      f"{acc['filesSeen']} seen = {acc['decoded']} decoded + {acc['undecodable']} undecodable "
      f"+ {acc['notMedia']} not-media + {acc['subdirectories']} dirs")

bad = [u for u in a['undecodable'] if u['name'] == 'broken_download.mp4']
check('the corrupt file is named, with a reason',
      len(bad) == 1 and len(bad[0]['reason']) > 10,
      f"broken_download.mp4: {bad[0]['reason'] if bad else 'NOT REPORTED'}")

# Negative control: the list must not be a list of everything.
healthy = {c[0] for c in CLIPS} | {'still_orange.png', 'music_bed.wav'}
check('and no healthy file is on that list',
      not (healthy & {u['name'] for u in a['undecodable']}),
      f"undecodable = {[u['name'] for u in a['undecodable']]}")

pool = ok(call('list_media_pool', {}), 'pool')
pool_names = [x['name'] for x in (pool.get('assets') or pool.get('media') or [])]
check('the corrupt file was NOT imported',
      'broken_download.mp4' not in pool_names,
      f"media pool holds {len(pool_names)}: {', '.join(sorted(pool_names))[:70]}")

check('a .txt is "not media", not "undecodable"',
      any(x['name'] == 'notes.txt' for x in a['notMedia']) and
      not any(x['name'] == 'notes.txt' for x in a['undecodable']),
      'the two lists mean different things and are kept apart')

names = [c['name'] for c in a['videoTrack']['clips']]
check('filenames order naturally (shot02 before shot10)',
      names.index('shot02_green.mp4') < names.index('shot10_yellow.mp4') and
      a['order']['by'] == 'name',
      ' → '.join(n.split('_')[0] for n in names))

by_dur = fresh_assembly(orderBy='duration')
check('ordering is a real choice, not a label',
      by_dur['videoTrack']['clips'][0]['name'] == 'shot12_cyan.mp4' and
      [c['name'] for c in by_dur['videoTrack']['clips']] != names,
      f"orderBy=duration starts with {by_dur['videoTrack']['clips'][0]['name']} "
      f"({by_dur['videoTrack']['clips'][0]['durationMs']}ms), name order starts with {names[0]}")

a = fresh_assembly()
measured = {c['name']: c['durationMs'] for c in a['videoTrack']['clips']}
probe = float(subprocess.run(
    ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1',
     os.path.join(FOLDER, 'shot01_red.mp4')], capture_output=True, text=True).stdout.strip())
check('video durations are measured, and match ffprobe',
      abs(measured['shot01_red.mp4'] - probe * 1000) <= 40 and
      abs(measured['shot12_cyan.mp4'] - 400) <= 40,
      f"shot01 {measured['shot01_red.mp4']}ms vs ffprobe {probe*1000:.0f}ms; "
      f"shot12 {measured['shot12_cyan.mp4']}ms")

still = [c for c in a['videoTrack']['clips'] if c['kind'] == 'image'][0]
check('the still gets a CHOSEN hold, and the report says so',
      still['durationMs'] == 3000 and still['durationFrom'] == 'still hold' and
      'choice, not a measurement' in a['durations']['policy'],
      f"{still['name']} {still['durationMs']}ms, durationFrom={still['durationFrom']}")

gaps = [a['videoTrack']['clips'][i + 1]['startMs'] -
        (a['videoTrack']['clips'][i]['startMs'] + a['videoTrack']['clips'][i]['durationMs'])
        for i in range(len(a['videoTrack']['clips']) - 1)]
check('the sequence butts together with no holes',
      all(g == 0 for g in gaps),
      f"{len(gaps)} joins, max gap {max(gaps) if gaps else 0}ms")

check('audio goes to an audio track, not into the picture',
      len(a['audioTrack']['clips']) == 1 and
      a['audioTrack']['clips'][0]['name'] == 'music_bed.wav' and
      not any(c['name'] == 'music_bed.wav' for c in a['videoTrack']['clips']),
      f"bed on {a['audioTrack']['trackId']}, {a['audioTrack']['clips'][0]['durationMs']}ms")

# ── B. the grid it cuts on ────────────────────────────────────────
print('\nthe beat grid — against a bed built at a tempo we chose')
m = ok(call('auto_montage_to_beats', {'cutEveryBeats': 2}), 'montage')
bpm = m['music']['bpm']
check(f'tempo within 3% of the constructed {BPM:.0f} BPM',
      abs(bpm - BPM) / BPM < 0.03,
      f"detected {bpm} BPM ({abs(bpm-BPM)/BPM*100:.2f}% off)")

# Negative control on the tolerance itself.
check('...and that tolerance rejects a 5% error',
      not (abs(BPM * 1.05 - BPM) / BPM < 0.03),
      f"{BPM*1.05:.1f} BPM would be refused by the same test")

beats = beats_on_timeline()
true_beats = [round(k * BEAT_MS) for k in range(int(BED_SECONDS / (BEAT_MS / 1000)) + 1)]
beat_err = [min(abs(b - t) for t in true_beats) for b in beats]
check('detected beats sit on the beats we synthesised',
      max(beat_err) <= 25,
      f"n={len(beats)}, mean {statistics.mean(beat_err):.1f}ms, max {max(beat_err)}ms "
      f"(one frame at 30fps is 33.3ms)")

shot_ms = [s['durationMs'] for s in m['shots']]
check('cutEveryBeats=2 gives two-beat shots',
      abs(statistics.mean(shot_ms) - 2 * BEAT_MS) < 30,
      f"mean shot {statistics.mean(shot_ms):.0f}ms, two beats is {2*BEAT_MS:.0f}ms")

marker_set = set(beats)
off = [s['startMs'] for s in m['shots'] if s['startMs'] not in marker_set]
check('every cut is exactly on a beat marker',
      not off and m['cutAccuracy']['maxOffsetFromBeatMs'] == 0,
      f"{len(m['shots'])} cuts, {len(off)} off a marker, "
      f"max reported offset {m['cutAccuracy']['maxOffsetFromBeatMs']}ms")

fresh_assembly()
half = ok(call('auto_montage_to_beats', {'cutEveryBeats': 0.5, 'minShotMs': 200}), 'half')
check('a sub-beat grid says which cuts are interpolated',
      half['grid']['cutsOnInterpolatedPositions'] > 0 and
      half['grid']['subdivision'] == 2 and
      'No onset was detected there' in half['grid']['note'],
      f"{half['grid']['cutsOnDetectedBeats']} on detected beats, "
      f"{half['grid']['cutsOnInterpolatedPositions']} interpolated")

fresh_assembly()
refused = call('auto_montage_to_beats', {'cutEveryBeats': 0.5, 'minShotMs': 300})['result']
check('minShotMs refuses a grid finer than the clip floor',
      refused['success'] is False and 'minShotMs' in refused.get('error', ''),
      (refused.get('error') or 'IT DID NOT REFUSE')[:74] + '…')

accepted = call('auto_montage_to_beats', {'cutEveryBeats': 0.5, 'minShotMs': 200})['result']
check('...and the same threshold accepts one that is not',
      accepted['success'] is True and accepted['data']['cuts'] > 20,
      f"minShotMs=200 laid {accepted['data']['cuts'] if accepted['success'] else 0} cuts "
      f"of ~{BEAT_MS/2:.0f}ms")

# ── C. the cuts, in pixels ────────────────────────────────────────
print('\nthe cuts, read off the composited frame')
fresh_assembly()
m = ok(call('auto_montage_to_beats', {'cutEveryBeats': 2}), 'montage')
clips = video_clips()
for c in clips:                       # let every source decode once
    settle(c['startMs'] + c['durationMs'] // 2)

seen = [(c, classify(settle(c['startMs'] + c['durationMs'] // 2))) for c in clips]
wrong = [(c['name'], k, d) for c, (k, d) in seen if source_colour(c['name']) != k or d > 40]
check('every shot renders the file it says it does',
      not wrong,
      f"{len(seen)} shots identified by colour, worst distance "
      f"{max(d for _, (_, d) in seen):.0f} (threshold 40)")

# Negative control: the classifier is not simply agreeable.
first = settle(clips[0]['startMs'] + 200)
wrong_colour = 'green' if source_colour(clips[0]['name']) != 'green' else 'blue'
d_wrong = sum((first[i] - PALETTE[wrong_colour][i]) ** 2 for i in range(3)) ** 0.5
check('...and would not have accepted the wrong file',
      d_wrong > 40,
      f"shot 1 is {source_colour(clips[0]['name'])}; distance to {wrong_colour} "
      f"is {d_wrong:.0f}, well past the threshold of 40")

cut_err = []
for i in range(1, len(clips)):
    at, before, after = bisect_change(clips[i]['startMs'] - 200, clips[i]['startMs'] + 200)
    if at is None:
        continue
    nearest = min(beats_on_timeline(), key=lambda x: abs(x - at))
    cut_err.append(abs(at - nearest))
check('the picture changes ON the beat, to the millisecond',
      cut_err and max(cut_err) == 0,
      f"{len(cut_err)} cuts bisected at 1ms resolution, max |error| "
      f"{max(cut_err) if cut_err else 'n/a'}ms")

shifted = [b + 80 for b in beats_on_timeline()]
shift_err = []
for i in range(1, min(5, len(clips))):
    at, _, _ = bisect_change(clips[i]['startMs'] - 200, clips[i]['startMs'] + 200)
    if at is not None:
        shift_err.append(abs(at - min(shifted, key=lambda x: abs(x - at))))
check('...and that measurement is not vacuous',
      shift_err and min(shift_err) >= 75,
      f"the same bisector against beats moved +80ms reports "
      f"{statistics.mean(shift_err):.0f}ms, so 0ms above was a result, not a tautology")

# A montage the tool did NOT lay, on the same music.
#
# The first version of this control placed the clips on round SECONDS and
# it failed — 1000ms is 2ms from the detected beat at 998, so a sequence
# meant to be off the beat was on it. A control that cannot tell the two
# apart proves nothing, so these start a half-beat late and are laid a
# whole beat apart, which keeps every join in the middle of a bar.
OFFBEAT_START = int(round(BEAT_MS / 2))
ok(call('reset_project', {'name': 'handmade', 'aspectRatio': '16:9', 'fps': 30,
                          'durationMs': 8000}), 'reset')
hand = ok(call('assemble_from_folder', {'folder': FOLDER, 'uniformDurationMs': int(BEAT_MS * 2),
                                        'startMs': OFFBEAT_START,
                                        'limit': 4, 'audio': 'ignore'}), 'hand')
ok(call('import_media_from_path', {'path': os.path.join(FOLDER, 'music_bed.wav')}), 'bed')
at_track = ok(call('add_track', {'type': 'audio', 'name': 'Bed'}), 'at')['trackId']
ok(call('insert_clip', {'assetId': 'music_bed.wav', 'trackId': at_track, 'startTimeMs': 0}), 'ins')
ok(call('detect_beats', {}), 'db')
hand_clips = video_clips()
for c in hand_clips:
    settle(c['startMs'] + c['durationMs'] // 2)
hb = beats_on_timeline()
hand_err = []
for i in range(1, len(hand_clips)):
    at, _, _ = bisect_change(hand_clips[i]['startMs'] - 200, hand_clips[i]['startMs'] + 200)
    if at is not None:
        hand_err.append(abs(at - min(hb, key=lambda x: abs(x - at))))
check('a hand-laid sequence measures OFF the beat',
      hand_err and min(hand_err) > BEAT_MS / 4,
      f"clips laid from {OFFBEAT_START}ms bisect {[int(e) for e in hand_err]}ms from the "
      f"nearest beat (a quarter-beat is {BEAT_MS/4:.0f}ms) — the 0ms above is the "
      f"montage, not the ruler")

# ── D. the three decisions ────────────────────────────────────────
print('\nthe decisions the tool is forced to make')
fresh_assembly()
loop = ok(call('auto_montage_to_beats', {'cutEveryBeats': 1, 'whenMaterialRunsOut': 'loop'}), 'loop')
fresh_assembly()
stop = ok(call('auto_montage_to_beats', {'cutEveryBeats': 1, 'whenMaterialRunsOut': 'stop'}), 'stop')
fresh_assembly()
stretch = ok(call('auto_montage_to_beats', {'cutEveryBeats': 1, 'whenMaterialRunsOut': 'stretch'}), 'str')

check('material runs out: "loop" covers the music and says how often',
      loop['material']['uncoveredMs'] == 0 and
      loop['material']['timesEachSourceUsedAtMost'] > 1 and
      loop['cuts'] > loop['material']['sourcesAvailable'],
      f"{loop['cuts']} shots from {loop['material']['sourcesAvailable']} sources, "
      f"each used up to {loop['material']['timesEachSourceUsedAtMost']}x, 0ms uncovered")

check('"stop" ends early and reports the hole it left',
      stop['cuts'] == stop['material']['sourcesAvailable'] and
      stop['material']['uncoveredMs'] > 1000 and
      stop['material']['uncoveredFromMs'] is not None,
      f"{stop['cuts']} shots, then {stop['material']['uncoveredMs']}ms uncovered "
      f"from {stop['material']['uncoveredFromMs']}ms")

check('"stretch" coarsens the grid instead of repeating',
      stretch['material']['timesEachSourceUsedAtMost'] == 1 and
      stretch['grid']['cutEveryBeats'] > loop['grid']['cutEveryBeats'] and
      stretch['material']['uncoveredMs'] == 0,
      f"cutEveryBeats {loop['grid']['cutEveryBeats']} → "
      f"{stretch['grid']['cutEveryBeats']}, {stretch['cuts']} shots, nothing reused")

check('...and a stretched montage still cuts on beats',
      all(s['startMs'] in set(beats_on_timeline()) for s in stretch['shots']),
      f"{len(stretch['shots'])}/{len(stretch['shots'])} stretched cuts on a marker")

# The short-clip policies, told apart on the picture. shot12_cyan is
# 400ms and its slot is ~1000ms; 800ms into the slot is the moment where
# 'slow' and 'gap' must look different.
fresh_assembly()
slow = ok(call('auto_montage_to_beats', {'cutEveryBeats': 2, 'whenClipIsShort': 'slow'}), 'slow')
slow_shot = [s for s in slow['shots'] if 'cyan' in s['sourceName']][0]
settle(slow_shot['startMs'] + 100)
at_slow = colour_at(slow_shot['startMs'] + int(slow_shot['durationMs'] * 0.8))
check('"slow" keeps a 400ms clip on screen for its whole 1000ms shot',
      at_slow == 'cyan' and slow_shot['speedMultiplier'] < 0.5,
      f"80% into the shot the frame is {at_slow}; speed {slow_shot['speedMultiplier']}x")

fresh_assembly()
gap = ok(call('auto_montage_to_beats', {'cutEveryBeats': 2, 'whenClipIsShort': 'gap'}), 'gap')
gap_shot = [s for s in gap['shots'] if 'cyan' in s['sourceName']][0]
settle(gap_shot['startMs'] + 100)
at_gap = colour_at(gap_shot['startMs'] + 800)
check('"gap" really leaves the rest of the shot empty',
      at_gap != 'cyan' and gap_shot['gapMs'] > 400,
      f"800ms into the same shot the frame is {at_gap}, and {gap_shot['gapMs']}ms "
      f"was reported as gap")

fresh_assembly()
skip = ok(call('auto_montage_to_beats', {'cutEveryBeats': 2, 'whenClipIsShort': 'skip'}), 'skip')
check('"skip" passes the short source over and names it',
      not any('cyan' in s['sourceName'] for s in skip['shots']) and
      any('cyan' in s['name'] for s in skip['short'].get('skipped', [])),
      f"{len(skip['short'].get('skipped', []))} skip(s) reported; cyan appears in "
      f"{sum(1 for s in skip['shots'] if 'cyan' in s['sourceName'])} shots")

fresh_assembly()
lead = ok(call('auto_montage_to_beats', {'cutEveryBeats': 2}), 'lead')
check('an empty head before the first beat is reported',
      lead['leadInMs'] > 0 and
      any('nothing is on the video track' in w for w in lead.get('warnings', [])),
      f"leadInMs={lead['leadInMs']} and it is in warnings")

check('a dry run changes nothing',
      (lambda before, d, after: d['dryRun'] is True and before == after)(
          [c['id'] for c in video_clips()],
          ok(call('auto_montage_to_beats', {'cutEveryBeats': 4, 'dryRun': True}), 'dry'),
          [c['id'] for c in video_clips()]),
      'the clip ids on the track are identical either side of a dryRun call')

# ── E. the exported file ──────────────────────────────────────────
print('\nthe artifact — the same montage, read back out of the file')
fresh_assembly()
m = ok(call('auto_montage_to_beats', {'cutEveryBeats': 2}), 'montage')
beats = beats_on_timeline()
clips = video_clips()
for c in clips:
    settle(c['startMs'] + c['durationMs'] // 2)

FPS = 30
SPAN = 8000
OUT = os.path.join(TMP, 'montage.mp4')
res = ok(call('render_export', {'resolution': '720p', 'fps': FPS, 'codec': 'h264',
                                'outputPath': OUT, 'durationMs': SPAN}), 'export')
check('a real file comes out',
      os.path.exists(OUT) and os.path.getsize(OUT) > 10000 and res.get('frames', 0) > 200,
      f"{os.path.getsize(OUT) if os.path.exists(OUT) else 0} bytes, "
      f"{res.get('frames')} frames reported")

raw = subprocess.run(
    ['ffmpeg', '-nostdin', '-v', 'error', '-i', OUT,
     '-vf', 'crop=iw/3:ih/3:iw/3:ih/3,scale=4:4', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    capture_output=True, check=True).stdout
buf = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 4, 4, 3).astype(float)
seq = [classify(f.reshape(-1, 3).mean(0))[0] for f in buf]

runs = []
for i, k in enumerate(seq):
    if not runs or runs[-1][0] != k:
        runs.append([k, i, i])
    else:
        runs[-1][2] = i

expected = [source_colour(s['sourceName']) for s in m['shots']
            if s['startMs'] < SPAN - 1]
in_file = [k for k, _, _ in runs if k != 'black']
check('the file shows the shots in the order the tool reported',
      in_file == expected[:len(in_file)],
      f"file: {'→'.join(in_file)}")

frame_ms = 1000.0 / FPS
quant = []
for k, a_i, _ in runs[1:]:
    t = a_i * frame_ms
    if t > SPAN - frame_ms * 2:
        break
    nb = min(beats, key=lambda x: abs(x - t))
    quant.append(t - nb)
check('in the file, every cut is the first frame at or after its beat',
      quant and all(0 <= e < frame_ms for e in quant),
      f"{len(quant)} cuts, offsets {min(quant):.1f}..{max(quant):.1f}ms, "
      f"one frame is {frame_ms:.1f}ms")

# Negative control on that window: a cut one frame late must fail it.
late = [e + frame_ms for e in quant]
check('...and that window rejects a cut one frame late',
      not all(0 <= e < frame_ms for e in late),
      f"the same test on offsets+{frame_ms:.1f}ms fails, as it must")

check('the render carried the music',
      (res.get('audio') or {}).get('included', 0) == 1,
      f"audio {json.dumps(res.get('audio'))}")

n = sum(results)
print(f"\n{n}/{len(results)} montage checks passed")
if n != len(results):
    print('failing: ' + ', '.join(str(i + 1) for i, r in enumerate(results) if not r))
    sys.exit(1)
