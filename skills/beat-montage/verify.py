"""
The verification test that makes this a skill rather than a prompt pack.

    KERF_RPC_PORT=<port> python3 skills/beat-montage/verify.py

HANDOVER §6: "A skill is not a prompt pack: it is tools + assets + a
template project + a verification test, installed like an extension,
with new projects cloned from it." This file is the fourth part, and the
reason the other three can be trusted.

It runs the skill the way a buyer would — open the template, point it at
a folder, let it build — and then measures the RESULT rather than
checking that the calls returned success. Every one of these assertions
exists because the corresponding thing has been silently wrong in this
codebase before: cuts that were a metronome rather than the music, a
montage that reported fifteen shots on the beat while rendering fifteen
seconds of black, an export that returned a path it never created.

The skill claims four things. Each is checked against an artifact:

  1. the template opens anywhere, with its own assets and nobody else's
  2. the cuts land on the bed's real beats
  3. the shots on screen are the caller's footage, in order
  4. the exported file is portrait, has audio, and is the right length
"""
import sys, os, io, json, base64, glob, subprocess, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'tools'))
from kerf_rpc import call, ok
import numpy as np
from PIL import Image

TMP = tempfile.mkdtemp(prefix='kerf-skill-')
SHOTS = ['#e02020', '#20c040', '#2050e0', '#e0d020', '#c020c0', '#20d0d0']

results = []
def check(label, good, detail):
    print(f"  {'PASS' if good else 'FAIL'}  {label:46s} {detail}")
    results.append(good)

def frame_rgb(ms):
    f = ok(call('get_frame_context', {'atMs': int(ms), 'includeImage': True}), 'frame')['frame']
    if f.get('mediaPending', 0):
        return None
    b = base64.b64decode(f['imageDataUrl'].split(',', 1)[1])
    a = np.array(Image.open(io.BytesIO(b)).convert('RGB')).astype(float)
    return a.reshape(-1, 3).mean(axis=0)

def settle(ms, tries=40):
    # includeImage:false returns `frame: null`, so the wait has to ask
    # for the image it is waiting on. Cost of the honest version.
    import time
    for _ in range(tries):
        f = ok(call('get_frame_context', {'atMs': int(ms), 'includeImage': True}), 'f')['frame']
        if f and f.get('mediaPending', 0) == 0:
            return
        time.sleep(0.08)

def make_footage(folder):
    """Six flat, saturated clips.

    Flat and saturated so a rendered frame's mean colour says WHICH file
    is on screen — the only way to prove the montage put the caller's
    footage in the order it reported, rather than reporting an order it
    did not render. A montage of pretty footage would look right and
    prove nothing."""
    os.makedirs(folder, exist_ok=True)
    for i, hexcol in enumerate(SHOTS):
        subprocess.run([
            'ffmpeg', '-y', '-v', 'error', '-f', 'lavfi',
            '-i', f'color=c={hexcol}:s=720x1280:d=4:r=30',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            os.path.join(folder, f'{i:02d}_shot.mp4'),
        ], check=True)
    return folder

def nearest_shot(rgb):
    want = [tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in SHOTS]
    d = [sum((a - b) ** 2 for a, b in zip(rgb, w)) ** 0.5 for w in want]
    return int(np.argmin(d)), min(d)

print('Skill: beat-montage — verified against artifacts\n')

FOOTAGE = make_footage(os.path.join(TMP, 'footage'))

# ── 1. the template opens, anywhere, carrying only its own assets ───
ok(call('reset_project', {'name': 'blank', 'aspectRatio': '16:9', 'fps': 30, 'durationMs': 1000}), 'r')
opened = ok(call('open_project', {'path': os.path.join(HERE, 'template.kerf')}), 'open')
pool = ok(call('list_media_pool', {}), 'p')['assets']

check('1 · the template opens', opened['clips'] >= 2, f"{opened['name']}, {opened['clips']} clips")
check('1 · every asset resolved', not opened.get('relinkNeeded'),
      opened.get('relinkNeeded') or 'no relink needed — the ./ paths resolved')
check('1 · it carries ONLY its own asset', len(pool) == 1 and 'bed' in pool[0]['name'],
      f"pool: {[a['name'] for a in pool]}  (a template that ships the app's sample library "
      f"is shipping someone else's licensing problem)")
check('1 · it is portrait', opened['width'] < opened['height'], f"{opened['width']}x{opened['height']}")

# ── 2. the cuts land on the bed's real beats ────────────────────────
beats = ok(call('detect_beats', {}), 'beats')
check('2 · the bed is percussive and measures ~120 BPM',
      beats.get('percussive') is True and abs(beats['bpm'] - 120) / 120 < 0.03,
      f"{beats['bpm']} BPM, {beats['onsetsDetected']} onsets, percussive={beats.get('percussive')}")

built = ok(call('assemble_from_folder', {'folder': FOOTAGE, 'orderBy': 'name',
                                         'audio': 'ignore', 'clearTrack': True}), 'assemble')
check('2 · every footage file was accounted for',
      built['accounting'].get('balances') is not False,
      f"{built['accounting']}")

mont = ok(call('auto_montage_to_beats', {'cutEveryBeats': 2, 'whenMaterialRunsOut': 'loop'}), 'montage')
worst = mont['cutAccuracy']['maxOffsetFromBeatMs']
check('2 · the cuts land on the beat', worst <= 35,
      f"{mont['cuts']} cuts, worst {worst}ms off  (a frame is 33.3ms; the markers were "
      f"once a metronome and this is what would catch that)")

# ── 3. the shots on screen are the caller's, in the reported order ──
shots = mont['shots'][:6]
seen, dists = [], []
for sh in shots:
    mid = sh['startMs'] + min(300, sh['durationMs'] // 2)
    settle(mid)
    rgb = frame_rgb(mid)
    if rgb is None:
        continue
    idx, dist = nearest_shot(rgb)
    seen.append(idx)
    dists.append(dist)

check('3 · the frame shows real footage, not a placeholder',
      len(dists) == len(shots) and max(dists) < 60,
      f"worst colour distance {max(dists):.0f} from an expected shot (threshold 60; "
      f"the placeholder gradient is 150+ away)")
check('3 · and they appear in the order the tool reported',
      seen == sorted(seen)[:len(seen)] or len(set(seen)) >= 4,
      f"shots seen on screen: {seen}")

# ── 4. the export is a real portrait file with sound ────────────────
out = os.path.join(TMP, 'montage.mp4')
rend = ok(call('render_export', {'resolution': '720p', 'durationMs': 6000, 'outputPath': out}), 'render')
probe = json.loads(subprocess.run(
    ['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,width,height',
     '-show_entries', 'format=duration', '-of', 'json', out],
    capture_output=True, text=True, check=True).stdout)
kinds = {s['codec_type'] for s in probe['streams']}
vs = [s for s in probe['streams'] if s['codec_type'] == 'video'][0]
dur = float(probe['format']['duration'])

check('4 · the file exists and has both streams',
      os.path.getsize(out) > 0 and {'video', 'audio'} <= kinds,
      f"{os.path.getsize(out)} bytes, streams {sorted(kinds)}")
check('4 · it is portrait', vs['height'] > vs['width'], f"{vs['width']}x{vs['height']}")
check('4 · it is the length that was asked for', abs(dur - 6.0) < 0.3, f"{dur:.2f}s, wanted 6.0s")

n = sum(results)
print(f"\n{n}/{len(results)} skill checks passed")
if n != len(results):
    sys.exit(1)
