"""
`analyze_reference_video` must recover numbers we already know.

    Kerf must be running.  python3 tools/verify_reference_analysis.py

Every fixture below is CONSTRUCTED, so the right answer is arithmetic
rather than opinion: cuts at exactly 1.000/2.000/3.500s, a pan of exactly
160 px/s across a 1280-wide frame, a black point lifted to exactly 0.25,
a 120.000 BPM bed of synthetic percussion. The tool is then asked, and
its answer is compared to the number that was built in.

WHY MOST OF THESE ARE NEGATIVE CONTROLS
---------------------------------------
A cut detector that returns a cut for every frame scores 100% on any
"did it find the cuts" test. What decides whether it is real is what it
does on footage with NO cuts, and there are three kinds that each break a
different naive detector:

  · `strobe` — ONE continuous shot with the light flickering every frame.
               It scores 0.836, eight times the absolute floor and higher
               than most real cuts, so only the local-baseline ratio can
               throw it out. This suite asserts that it DID clear the
               floor: without that, the check would pass while testing
               nothing.
  · `static` — a held frame. Nothing differs, so a purely relative
               threshold fires: encoder noise divided by encoder noise is
               a large ratio. This is the same shape as `computeNovelty`
               in beatDetect.ts, which normalises by its own maximum and
               so reports 36 onsets in five seconds of a held tone
               (NEXT.md §8).
  · `flash`  — one continuous shot with a two-frame white flash. It
               scores 1.25, higher than any genuine cut in this set, so
               nothing about the magnitude can separate them.
  · `pan`    — a steady 12.5 %/s move, which the floor handles once the
               difference is motion-compensated. It is here because a
               detector that dropped the compensation would report a pan
               as a cut every frame.

A note on how the strobe got here, because it is the point of the file.
The pan was originally asked to prove the ratio test, on the strength of
it scoring 0.103 against a 0.100 floor. That reading came from a fixture
whose detail was drawn on a periodic grid; on ordinary detail the same
pan scores 0.073 and the floor rejects it, so the check was asserting
something that was not true and would have failed the moment the fixture
improved. Grain does not work either — `scale=…:flags=area` averages
per-pixel noise away, and full-frame static scores 0.093. A flicker
survives the averaging because it moves the whole frame at once.

THRESHOLDS ARE SHOWN REJECTING SOMETHING
----------------------------------------
Wherever a tolerance is used, the same tolerance is applied to a value
that should fail it, and the suite asserts that it does. A black-point
window of ±6 around 64 is worth nothing until it is shown to exclude the
unfiltered clip's 2.

AND ONE FIXTURE NOBODY HERE CONSTRUCTED
---------------------------------------
Kerf's own starter project, rendered through `render_export`. Its cut
list was established independently and written down in HANDOVER §3a —
13 cuts from 4.000s to 10.000s, 345 frames, 11.500s, a 118.9 BPM bed —
and this suite additionally cross-checks the cut list against ffmpeg's
own `scene` detector, which shares no code with anything in Kerf.
"""
import sys, os, json, math, glob, shutil, subprocess, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kerf_rpc import call
import numpy as np
from PIL import Image, ImageDraw

TMP = tempfile.mkdtemp(prefix='kerf-refanalysis-')
results = []


def check(label, good, detail):
    print(f"  {'PASS' if good else 'FAIL'}  {label:44s} {detail}")
    results.append(good)


def ff(args):
    r = subprocess.run(['ffmpeg', '-y', '-v', 'error'] + args, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError('ffmpeg failed: ' + ' '.join(args) + '\n' + r.stderr[-800:])


def p(name):
    return os.path.join(TMP, name)


def try_analyze(path, **kw):
    r = call('analyze_reference_video', dict(source=path, **kw), timeout=900)['result']
    return (True, r['data']) if r.get('success') else (False, r.get('error') or '')


def analyze(path, **kw):
    good, payload = try_analyze(path, **kw)
    if not good:
        raise RuntimeError(f'analyze_reference_video({os.path.basename(path)}): {payload}')
    return payload


# ═══════════════════════════════════════════════════════════════════
# Fixtures. Every constant here is a ground truth asserted below.
# ═══════════════════════════════════════════════════════════════════

def big_still(path, w, h, seed):
    """Detail with no periodic structure, so a correlation peak is unique.

    The first version drew lines on a fixed pitch and the motion numbers
    came back erratic. Removing the lines changed them by less than
    0.1 %/s — the fixture was innocent and the estimator was the problem
    (it is documented in referenceAnalysis.ts). The lines are gone anyway:
    a fixture that COULD be blamed is a fixture that will be.
    """
    rng = np.random.default_rng(seed)
    small = rng.integers(0, 255, size=(h // 6 + 1, w // 6 + 1, 3), dtype=np.uint8)
    Image.fromarray(small).resize((w, h), Image.BICUBIC).save(path)


def concat(name, parts, fps):
    lst = p(f'_{name}.txt')
    with open(lst, 'w') as fh:
        for f in parts:
            fh.write(f"file '{os.path.basename(f)}'\n")
    ff(['-f', 'concat', '-safe', '0', '-i', lst, '-c:v', 'libx264', '-crf', '16',
        '-pix_fmt', 'yuv420p', '-r', str(fps), '-an', p(name + '.mp4')])
    return p(name + '.mp4')


def enc(out, src_args, vf, seconds, fps):
    ff(src_args + ['-t', f'{seconds:.5f}'] + (['-vf', vf] if vf else []) +
       ['-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p',
        '-r', str(fps), '-an', out])
    return out


CUTS_TRUTH = [1000, 2000, 3500]
PAN_PCT_PER_SEC = 160 / 1280 * 100          # 12.500 %width/s
PAN400_PCT_PER_SEC = 400 / 1280 * 100       # 31.250 %width/s
TILT_PCT_PER_SEC = 180 / 720 * 100          # 25.000 %height/s
BPM_TRUTH = 120.0
BLACK_LIFT = 0.25                            # colorlevels romin
CAPTION_BOX = (0.18, 0.72, 0.64, 0.14)       # x, y, w, h as frame fractions


def build_fixtures():
    big_still(p('_big.png'), 2560, 1440, seed=7)
    big_still(p('_still.png'), 1280, 720, seed=11)

    # 1 · cuts at exactly 1.000 / 2.000 / 3.500 s, 5.000s @ 30fps
    segs = [('testsrc2=s=1280x720:r=30', 'hue=h=0', 1.0),
            ('testsrc2=s=1280x720:r=30', 'hue=h=120', 1.0),
            ('testsrc2=s=1280x720:r=30', 'hue=h=240', 1.5),
            ('smptebars=s=1280x720:r=30', None, 1.5)]
    parts = [enc(p(f'_c{i}.mp4'), ['-f', 'lavfi', '-i', src], vf, d, 30)
             for i, (src, vf, d) in enumerate(segs)]
    concat('cuts', parts, 30)

    # 2 · cuts between shots of the SAME material: the palette barely
    #     moves, so a histogram-only detector misses them.
    parts = [enc(p(f'_s{i}.mp4'), ['-loop', '1', '-framerate', '30', '-i', p('_big.png')],
                 f'crop=1280:720:{x}:{y}', 1.0, 30)
             for i, (x, y) in enumerate([(0, 0), (1200, 700), (600, 300)])]
    concat('similar', parts, 30)

    # 3 · NO cuts, a pan of exactly 160 px/s: the false-positive control
    #     for cuts AND the ground truth for the motion number.
    enc(p('pan.mp4'), ['-loop', '1', '-framerate', '30', '-i', p('_big.png')],
        "crop=1280:720:x='160*t':y=360", 4.0, 30)
    enc(p('pan400.mp4'), ['-loop', '1', '-framerate', '30', '-i', p('_big.png')],
        "crop=1280:720:x='400*t':y=360", 3.0, 30)
    enc(p('tilt.mp4'), ['-loop', '1', '-framerate', '30', '-i', p('_big.png')],
        "crop=1280:720:x=640:y='180*t'", 3.0, 30)

    # 4 · NO cuts and no motion at all.
    enc(p('static.mp4'), ['-loop', '1', '-framerate', '30', '-i', p('_still.png')], None, 4.0, 30)

    # 5 · NO cuts, one two-frame white flash at 2.000s.
    enc(p('flash.mp4'), ['-loop', '1', '-framerate', '30', '-i', p('_still.png')],
        "geq=lum_expr='if(between(T,2.0,2.066),255,lum(X,Y))'"
        ":cb_expr='if(between(T,2.0,2.066),128,cb(X,Y))'"
        ":cr_expr='if(between(T,2.0,2.066),128,cr(X,Y))'", 4.0, 30)

    # 5b · ONE continuous shot, light flickering every frame. Large change
    #      on every pair, and flat — the only control here that the
    #      absolute floor cannot handle.
    enc(p('strobe.mp4'), ['-loop', '1', '-framerate', '30', '-i', p('_still.png')],
        r"geq=lum_expr='lum(X,Y)*(0.55+0.45*eq(mod(floor(T*30+0.5)\,2)\,0))'"
        r":cb_expr='cb(X,Y)':cr_expr='cr(X,Y)'", 3.0, 30)

    # 6 · a 120.000 BPM bed: kick on the beat, hat on the off-beat.
    #     NOT a click track — the one signal that cannot expose a tempo
    #     estimator locking onto the subdivision (HANDOVER §3a).
    sr = 48000
    n = int(sr * 8)
    x = np.zeros(n)
    t = np.arange(int(sr * 0.20)) / sr
    kick = np.sin(2 * np.pi * (160 * np.exp(-t * 28) + 45) * t) * np.exp(-t * 22)
    th = np.arange(int(sr * 0.05)) / sr
    hat = np.random.default_rng(5).normal(0, 1, th.size) * np.exp(-th * 140) * 0.35
    k = 0
    while k * 30.0 / BPM_TRUTH < 8.0:
        s = int(k * (30.0 / BPM_TRUTH) * sr)
        src = kick if k % 2 == 0 else hat
        e = min(n, s + src.size)
        x[s:e] += src[:e - s]
        k += 1
    x = np.clip(x / np.abs(x).max() * 0.85, -1, 1)
    (np.stack([x, x], 1) * 32767).astype('<i2').tofile(p('_bed.raw'))
    ff(['-f', 's16le', '-ar', str(sr), '-ac', '2', '-i', p('_bed.raw'),
        '-c:a', 'pcm_s16le', p('bed.wav')])

    # 7 · shots against that bed. Each shot is a different crop of the
    #     still, so every pixel of the picture changes at every cut —
    #     which is what the overlay detector needs to have something to
    #     separate a held region FROM.
    crops = [(0, 0), (1200, 700), (600, 300), (200, 720), (1100, 100), (700, 0), (0, 700)]

    def cutclip(name, bounds, total, fps, with_audio):
        parts = []
        for i, (a, b) in enumerate(zip([0.0] + bounds, bounds + [total])):
            cx, cy = crops[i % len(crops)]
            parts.append(enc(p(f'_{name}{i}.mp4'),
                             ['-loop', '1', '-framerate', str(fps), '-i', p('_big.png')],
                             f'crop=1280:720:{cx}:{cy}', b - a, fps))
        video = concat('_v' + name, parts, fps)
        if with_audio:
            ff(['-i', video, '-i', p('bed.wav'), '-c:v', 'copy', '-c:a', 'aac',
                '-b:a', '192k', '-shortest', p(name + '.mp4')])
        else:
            shutil.copy(video, p(name + '.mp4'))
        return p(name + '.mp4')

    # beat = 500ms exactly; every cut sits on one.
    cutclip('onbeat', [1.0, 1.5, 2.0, 3.0, 3.5], 5.0, 30, True)
    # +100ms: off the beat, off the half-beat, and off the triplet too.
    cutclip('offbeat', [1.1, 1.6, 2.1, 3.1, 3.6], 5.0, 30, True)
    # on the half-beat grid, at 24fps so 250ms is a whole number of frames.
    cutclip('halfbeat', [1.25, 1.75, 2.75, 3.25, 4.25], 5.0, 24, True)
    # the same picture with no audio: the overlay negative control.
    cutclip('nocaption', [1.0, 1.5, 2.0, 3.0, 3.5], 5.0, 30, False)

    # 8 · the same clip with a caption burnt in at a KNOWN box, in two
    #     styles: glyph strokes alone, and glyphs on a plate.
    for tag, plate in (('caption', False), ('lowerthird', True)):
        ov = Image.new('RGBA', (1280, 720), (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        x0, y0 = int(CAPTION_BOX[0] * 1280), int(CAPTION_BOX[1] * 720)
        x1 = x0 + int(CAPTION_BOX[2] * 1280)
        y1 = y0 + int(CAPTION_BOX[3] * 720)
        if plate:
            d.rectangle([x0, y0, x1, y1], fill=(15, 15, 15, 235))
        for i in range(9):
            gx = x0 + int(i * (x1 - x0) / 9) + 6
            d.rectangle([gx, y0 + 6, gx + 34, y1 - 6], fill=(255, 255, 255, 255),
                        outline=(0, 0, 0, 255), width=5)
            d.rectangle([gx + 9, y0 + 18, gx + 25, y0 + 36], fill=(0, 0, 0, 255))
        ov.save(p(f'_{tag}.png'))
        ff(['-i', p('nocaption.mp4'), '-i', p(f'_{tag}.png'),
            '-filter_complex', '[0:v][1:v]overlay=0:0', '-c:v', 'libx264', '-crf', '16',
            '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', '30', '-an', p(tag + '.mp4')])

    # 9 · a grey ramp, whose statistics are arithmetic, and two known grades.
    ramp = np.tile(np.linspace(0, 255, 1280, dtype=np.uint8)[None, :, None], (720, 1, 3))
    Image.fromarray(ramp).save(p('_ramp.png'))
    for tag, vf in (('ramp', None),
                    ('ramp_lift', f'colorlevels=romin={BLACK_LIFT}:gomin={BLACK_LIFT}:bomin={BLACK_LIFT}'),
                    ('ramp_warm', 'colorchannelmixer=rr=1.2:bb=0.8')):
        enc(p(tag + '.mp4'), ['-loop', '1', '-framerate', '30', '-i', p('_ramp.png')], vf, 3.0, 30)

    enc(p('bars.mp4'), ['-f', 'lavfi', '-i', 'smptebars=s=1280x720:r=30'], None, 3.0, 30)
    ff(['-i', p('bars.mp4'), '-vf', 'eq=saturation=0.25', '-c:v', 'libx264', '-crf', '16',
        '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', '30', '-an', p('bars_desat.mp4')])

    # 10 · portrait, at a different frame rate.
    enc(p('portrait.mp4'), ['-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=24'], None, 2.0, 24)

    # 11 · a one-second cross-dissolve from 1.500s to 2.500s, and the SAME
    #      two shots hard-cut at 1.500s. The pair is what makes it a test:
    #      a detector that calls any large change a dissolve fires on the
    #      hard cut too.
    enc(p('_xa.mp4'), ['-f', 'lavfi', '-i', 'smptebars=s=1280x720:r=30'], None, 2.5, 30)
    enc(p('_xb.mp4'), ['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30'],
        'hue=h=200,eq=brightness=-0.25', 2.5, 30)
    ff(['-i', p('_xa.mp4'), '-i', p('_xb.mp4'), '-filter_complex',
        'xfade=transition=fade:duration=1.0:offset=1.5', '-c:v', 'libx264', '-crf', '16',
        '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', '30', '-an', p('dissolve.mp4')])
    enc(p('_xa15.mp4'), ['-f', 'lavfi', '-i', 'smptebars=s=1280x720:r=30'], None, 1.5, 30)
    concat('hardcut', [p('_xa15.mp4'), p('_xb.mp4')], 30)


def ffprobe_frames(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames',
                        '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', path],
                       capture_output=True, text=True)
    return int(r.stdout.strip())


def ffmpeg_scene_cuts(path, threshold=0.15):
    """ffmpeg's own scene detector — an independent opinion on the cuts."""
    r = subprocess.run(['ffmpeg', '-v', 'info', '-i', path, '-vf',
                        f"select='gt(scene,{threshold})',showinfo", '-an', '-f', 'null', '-'],
                       capture_output=True, text=True)
    out = []
    for line in r.stderr.split('\n'):
        i = line.find('pts_time:')
        if i >= 0:
            out.append(round(float(line[i + 9:].split()[0]) * 1000))
    return sorted(out)


def close_list(got, want, tol_ms):
    return len(got) == len(want) and all(abs(a - b) <= tol_ms for a, b in zip(got, want))


print('analyze_reference_video against ground truth that was built, not observed\n')
print(f'building fixtures in {TMP} …')
build_fixtures()

FRAME_MS = 1000 / 30
CUT_TOL = FRAME_MS + 1        # one frame; a cut cannot be resolved finer

# ═══════════════════════════════════════════════════════════════════
print('\n· format')
# ═══════════════════════════════════════════════════════════════════
a = analyze(p('cuts.mp4'))
f = a['format']
check('resolution, aspect and orientation',
      (f['width'], f['height'], f['aspectRatio'], f['orientation']) == (1280, 720, '16:9', 'landscape'),
      f"{f['width']}x{f['height']} {f['aspectRatio']} {f['orientation']}")
check('frame count is counted, not read off metadata',
      f['frameCount'] == ffprobe_frames(p('cuts.mp4')) == 150,
      f"{f['frameCount']} cells held real frames; ffprobe counts {ffprobe_frames(p('cuts.mp4'))}")
# The regression for a real bug: 29.97 sits earlier in the standard-rate
# table than 30 and is within tolerance of it, so returning the FIRST
# match put a cut at a known 3.500s at 3.504s.
check('frame rate snaps to the NEAREST standard rate',
      f['fps'] == 30 and f['fpsSnappedTo'] == 30,
      f"measured {f['fpsMeasured']} -> {f['fps']} (29.97 is 0.1% away and must not win)")

pa = analyze(p('portrait.mp4'), includeCadence=False)['format']
check('portrait and a second frame rate',
      (pa['width'], pa['height'], pa['aspectRatio'], pa['orientation'], pa['fps'], pa['frameCount'])
      == (1080, 1920, '9:16', 'portrait', 24, 48),
      f"{pa['width']}x{pa['height']} {pa['aspectRatio']} {pa['fps']}fps {pa['frameCount']} frames")

# The sheet must carry setsar=1 or Chromium scales it by the pixel aspect
# ratio and every cell after the first is read a fraction of a pixel out.
check('the contact sheet forces square pixels',
      all('setsar=1' in x['filtergraph'] for x in a['analysis']['passes'] if 'sheet' in x['name']),
      a['analysis']['passes'][0]['filtergraph'][:72] + '…')

# ═══════════════════════════════════════════════════════════════════
print('\n· cuts — found where they are')
# ═══════════════════════════════════════════════════════════════════
check('cuts at exactly 1.000 / 2.000 / 3.500s',
      close_list(a['cuts']['cutMs'], CUTS_TRUTH, CUT_TOL),
      f"{a['cuts']['cutMs']} vs {CUTS_TRUTH} (±{CUT_TOL:.0f}ms)")
# A tolerance nobody has tried to fail is not a tolerance.
check('…and the same tolerance rejects a wrong answer',
      not close_list(a['cuts']['cutMs'], [1000, 2000, 3400], CUT_TOL),
      f"3.400s is {abs(a['cuts']['cutMs'][2] - 3400)}ms away, outside ±{CUT_TOL:.0f}ms")

sim = analyze(p('similar.mp4'), includeCadence=False)
check('cuts between shots of the same material',
      close_list(sim['cuts']['cutMs'], [1000, 2000], CUT_TOL),
      f"{sim['cuts']['cutMs']} vs [1000, 2000] — palette barely moves, so this is the "
      f"motion-compensated term, not the histogram")

# ═══════════════════════════════════════════════════════════════════
print('\n· cuts — the three ways to find one that is not there')
# ═══════════════════════════════════════════════════════════════════
pan = analyze(p('pan.mp4'), includeCadence=False)
det = pan['cuts']['detection']
check('a steady pan is not a cut',
      pan['cuts']['count'] == 0 and det['loudestRejected'] < det['absoluteFloor'],
      f"0 cuts on a {PAN_PCT_PER_SEC:.1f} %width/s pan; loudest frame "
      f"{det['loudestRejected']} under the {det['absoluteFloor']} floor once the difference is "
      f"motion-compensated")

strobe = analyze(p('strobe.mp4'), includeCadence=False)
sd = strobe['cuts']['detection']
check('a flickering light is not 89 cuts',
      strobe['cuts']['count'] == 0 and len(strobe['cuts']['flashes']) == 0,
      f"0 cuts and 0 flashes across {strobe['format']['frameCount']} frames of one shot")
# Without this the previous check could pass on a detector with no ratio
# test at all, simply because the floor happened to be high enough.
check('…and only the ratio test could have rejected it',
      sd['loudestRejected'] > sd['absoluteFloor'] * 3,
      f"loudest frame scored {sd['loudestRejected']}, {sd['loudestRejected'] / sd['absoluteFloor']:.1f}x "
      f"the {sd['absoluteFloor']} floor — an absolute threshold cannot save this one")

st = analyze(p('static.mp4'), includeCadence=False)
sdet = st['cuts']['detection']
check('a held frame is not a cut',
      st['cuts']['count'] == 0, '0 cuts on four seconds of one frame')
check('…and it was the floor that rejected it',
      sdet['loudestRejected'] < sdet['absoluteFloor'],
      f"loudest frame scored {sdet['loudestRejected']}, floor {sdet['absoluteFloor']} — a ratio "
      f"test alone divides encoder noise by encoder noise")

fl = analyze(p('flash.mp4'), includeCadence=False)
check('a flash is a flash, not two cuts',
      fl['cuts']['count'] == 0 and len(fl['cuts']['flashes']) == 1
      and abs(fl['cuts']['flashes'][0]['atMs'] - 2000) <= 2 * FRAME_MS,
      f"0 cuts, flash at {fl['cuts']['flashes'][0]['atMs'] if fl['cuts']['flashes'] else '—'}ms "
      f"(it scored {fl['cuts']['detection']['loudestRejected']}, above every real cut here)")

low = analyze(p('similar.mp4'), includeCadence=False, cutSensitivity=0)
check('cutSensitivity moves a real threshold',
      len(low['cuts']['cutMs']) < len(sim['cuts']['cutMs'])
      and low['cuts']['detection']['absoluteFloor'] > sim['cuts']['detection']['absoluteFloor'],
      f"floor {sim['cuts']['detection']['absoluteFloor']} -> "
      f"{low['cuts']['detection']['absoluteFloor']}: {len(sim['cuts']['cutMs'])} cuts -> "
      f"{len(low['cuts']['cutMs'])}")

# ═══════════════════════════════════════════════════════════════════
print('\n· dissolves, and the hard cut that must not look like one')
# ═══════════════════════════════════════════════════════════════════
dis = analyze(p('dissolve.mp4'), includeCadence=False, includeGrade=False, includeOverlays=False)
dl = dis['cuts']['dissolves']
check('a 1.000s cross-dissolve at 1.500s is one dissolve, not a cut',
      dis['cuts']['count'] == 0 and len(dl) == 1
      and abs(dl[0]['startMs'] - 1500) <= 150 and abs(dl[0]['durationMs'] - 1000) <= 350,
      f"0 cuts, 1 dissolve {dl[0]['startMs']}–{dl[0]['endMs']}ms ({dl[0]['durationMs']}ms, blend "
      f"error {dl[0]['blendError']}) vs 1500–2500ms" if len(dl) == 1
      else f"{dis['cuts']['count']} cuts, {len(dl)} dissolves")

clean = {'cuts.mp4': a, 'similar.mp4': sim, 'pan.mp4': pan, 'static.mp4': st, 'flash.mp4': fl,
         'strobe.mp4': strobe}
check('nothing else in this set is called a dissolve',
      all(len(v['cuts']['dissolves']) == 0 for v in clean.values()),
      'hard cuts, a pan, a held frame, a flash and a flicker: 0 dissolves between them — a fade '
      'is recognised by its midpoint being the AVERAGE of its ends, which none of these are')

# The clip the engine will not decode a contact sheet for (module header).
# What matters is not that it works — it does not, here — but that it says
# so instead of measuring an unpainted canvas and reporting a dark video
# with no cuts.
hc_ok, hc = try_analyze(p('hardcut.mp4'), includeCadence=False, includeGrade=False,
                        includeOverlays=False, includeMotion=False)
check('an undecodable contact sheet refuses instead of measuring black',
      (hc_ok and hc['cuts']['count'] == 1 and abs(hc['cuts']['cutMs'][0] - 1500) <= 2 * FRAME_MS)
      or (not hc_ok and 'nothing was painted' in hc),
      f"analysed: cuts {hc['cuts']['cutMs']}" if hc_ok
      else f"refused: {hc[:78]}…")

# ═══════════════════════════════════════════════════════════════════
print('\n· cadence against the beat')
# ═══════════════════════════════════════════════════════════════════
ob = analyze(p('onbeat.mp4'))
c = ob['cadence']
check('tempo of a 120.000 BPM percussion bed',
      abs(c['bpm'] - BPM_TRUTH) / BPM_TRUTH < 0.02,
      f"{c['bpm']} BPM vs {BPM_TRUTH} ({abs(c['bpm'] - BPM_TRUTH) / BPM_TRUTH * 100:.2f}% out)")
check('cuts on the beat are reported as on the beat',
      c['cutsOnBeat'] == 5 and c['medianOffsetMs'] <= 25,
      f"{c['cutsOnBeat']}/{c['cutsAnalysed']} within {c['toleranceMs']}ms, median "
      f"{c['medianOffsetMs']}ms")
check('subdivision of a beat-cut edit',
      c['subdivision'] and c['subdivision']['divisions'] == 1,
      f"{c['subdivision']['name'] if c['subdivision'] else None}")

off = analyze(p('offbeat.mp4'))
co = off['cadence']
check('cuts 100ms late are NOT reported as on the beat',
      co['cutsOnBeat'] == 0 and abs(co['medianOffsetMs'] - 100) <= 20,
      f"{co['cutsOnBeat']}/{co['cutsAnalysed']} on beat, median offset {co['medianOffsetMs']}ms "
      f"(built at 100ms)")
check('…and no subdivision is invented to explain them',
      co['subdivision'] is None,
      'subdivision: None')

hb = analyze(p('halfbeat.mp4'))
ch = hb['cadence']
one = next(e for e in ch['subdivisionEvidence'] if e['divisions'] == 1)
check('a half-beat edit is reported as a half-beat edit',
      ch['subdivision'] and ch['subdivision']['divisions'] == 2 and one['hitPct'] == 0,
      f"{ch['subdivision']['name'] if ch['subdivision'] else None}; the plain beat scores "
      f"{one['hitPct']}%")
# The guard against a fine grid winning by covering the whole bar.
fine = next(e for e in ch['subdivisionEvidence'] if e['divisions'] == 8)
check('a grid that covers the bar is ruled out, not believed',
      fine['hitPct'] == 100 and fine['chancePct'] >= 99 and not fine['eligible'],
      f"1/32 scores {fine['hitPct']}% and chance is {fine['chancePct']}% — eligible="
      f"{fine['eligible']}")

# ═══════════════════════════════════════════════════════════════════
print('\n· grade')
# ═══════════════════════════════════════════════════════════════════
rp = analyze(p('ramp.mp4'), includeCadence=False)['grade']
lift = analyze(p('ramp_lift.mp4'), includeCadence=False)['grade']
warm = analyze(p('ramp_warm.mp4'), includeCadence=False)['grade']

check('a grey ramp measures grey',
      abs(rp['luminance']['mean'] - 127.5) < 3 and rp['saturation']['mean'] < 4
      and abs(rp['colour']['redOverBlue'] - 1.0) < 0.03,
      f"mean {rp['luminance']['mean']} (127.5), saturation {rp['saturation']['mean']} (0), "
      f"R/B {rp['colour']['redOverBlue']} (1.000)")

want_black = BLACK_LIFT * 255
check(f'a black point lifted to {BLACK_LIFT} reads as {want_black:.0f}',
      abs(lift['blackPoint']['level'] - want_black) <= 6 and lift['blackPoint']['lifted'],
      f"p1 = {lift['blackPoint']['level']} vs {want_black:.2f}; lifted={lift['blackPoint']['lifted']}")
check('…and the same window excludes the ungraded ramp',
      abs(rp['blackPoint']['level'] - want_black) > 6 and not rp['blackPoint']['lifted'],
      f"ungraded p1 = {rp['blackPoint']['level']}, {abs(rp['blackPoint']['level'] - want_black):.0f} "
      f"outside a ±6 window")

want_mean = BLACK_LIFT * 255 + (1 - BLACK_LIFT) * 127.5
check('…and the mean moves by exactly as much as the lift predicts',
      abs(lift['luminance']['mean'] - want_mean) <= 5,
      f"{lift['luminance']['mean']} vs {want_mean:.2f} predicted")

check('R x1.2 / B x0.8 reads as a red/blue ratio of 1.5',
      abs(warm['colour']['redOverBlue'] - 1.5) < 0.08 and warm['colour']['descriptor'] == 'warm',
      f"R/B {warm['colour']['redOverBlue']} (1.500), called '{warm['colour']['descriptor']}', "
      f"CCT {warm['colour']['cctKelvin']}K vs the neutral ramp's {rp['colour']['cctKelvin']}K")
check('…and the same window excludes the neutral ramp',
      abs(rp['colour']['redOverBlue'] - 1.5) > 0.08 and rp['colour']['descriptor'] != 'warm',
      f"neutral R/B {rp['colour']['redOverBlue']}, called '{rp['colour']['descriptor']}'")

bars = analyze(p('bars.mp4'), includeCadence=False)['grade']
desat = analyze(p('bars_desat.mp4'), includeCadence=False)['grade']
check('a desaturated grade measures desaturated',
      desat['saturation']['mean'] < bars['saturation']['mean'] * 0.75
      and bars['saturation']['descriptor'] == 'saturated'
      and desat['saturation']['descriptor'] != 'saturated',
      f"{bars['saturation']['mean']} ('{bars['saturation']['descriptor']}') -> "
      f"{desat['saturation']['mean']} ('{desat['saturation']['descriptor']}')")

# ═══════════════════════════════════════════════════════════════════
print('\n· motion')
# ═══════════════════════════════════════════════════════════════════
MOTION_TOL = 0.10   # 10% of the true speed


def shot0(path):
    return analyze(path, includeCadence=False, includeGrade=False,
                   includeOverlays=False)['motion']['perShot'][0]


m160 = shot0(p('pan.mp4'))
m400 = shot0(p('pan400.mp4'))
mtil = shot0(p('tilt.mp4'))
mst = shot0(p('static.mp4'))

check(f'a {PAN_PCT_PER_SEC:.3f} %width/s pan',
      abs(m160['speedPctPerSec'] - PAN_PCT_PER_SEC) / PAN_PCT_PER_SEC < MOTION_TOL
      and m160['direction'] == 'right',
      f"{m160['speedPctPerSec']} %/s, '{m160['direction']}', "
      f"{abs(m160['speedPctPerSec'] - PAN_PCT_PER_SEC) / PAN_PCT_PER_SEC * 100:.1f}% out")
check(f'a {PAN400_PCT_PER_SEC:.3f} %width/s pan, 2.5x faster',
      abs(m400['speedPctPerSec'] - PAN400_PCT_PER_SEC) / PAN400_PCT_PER_SEC < MOTION_TOL,
      f"{m400['speedPctPerSec']} %/s, "
      f"{abs(m400['speedPctPerSec'] - PAN400_PCT_PER_SEC) / PAN400_PCT_PER_SEC * 100:.1f}% out")
check(f'a {TILT_PCT_PER_SEC:.3f} %height/s tilt, on the other axis',
      abs(mtil['speedPctPerSec'] - TILT_PCT_PER_SEC) / TILT_PCT_PER_SEC < MOTION_TOL
      and mtil['direction'] == 'down' and abs(mtil['panPctWidthPerSec']) < 1,
      f"{mtil['speedPctPerSec']} %/s '{mtil['direction']}', pan {mtil['panPctWidthPerSec']} %/s")
check('a locked-off frame measures zero',
      mst['speedPctPerSec'] == 0 and mst['classification'] == 'locked off',
      f"{mst['speedPctPerSec']} %/s, '{mst['classification']}'")
check('…and the same 10% window would not have accepted zero',
      abs(mst['speedPctPerSec'] - PAN_PCT_PER_SEC) / PAN_PCT_PER_SEC > MOTION_TOL,
      f"0 is {PAN_PCT_PER_SEC:.1f} %/s away from the pan it must not be confused with")

sim_m = analyze(p('similar.mp4'), includeCadence=False, includeGrade=False,
                includeOverlays=False)['motion']
check('every shot of still material reads locked off',
      all(s['classification'] == 'locked off' for s in sim_m['perShot']),
      f"{len(sim_m['perShot'])} shots, speeds "
      f"{[s['speedPctPerSec'] for s in sim_m['perShot']]}")

# ═══════════════════════════════════════════════════════════════════
print('\n· burnt-in overlay regions (NOT text, and it says so)')
# ═══════════════════════════════════════════════════════════════════
cx, cy, cw, chh = CAPTION_BOX


def covers(r, frac):
    """How much of the true caption box this region contains."""
    ox = max(0.0, min(r['x'] + r['w'], cx + cw) - max(r['x'], cx))
    oy = max(0.0, min(r['y'] + r['h'], cy + chh) - max(r['y'], cy))
    return (ox * oy) / (cw * chh) >= frac


lt = analyze(p('lowerthird.mp4'), includeCadence=False)['overlays']
cap = analyze(p('caption.mp4'), includeCadence=False)['overlays']
noc = analyze(p('nocaption.mp4'), includeCadence=False)['overlays']

check('a lower-third plate is found where it was put',
      len(lt['regions']) == 1 and covers(lt['regions'][0], 0.7)
      and lt['regions'][0]['where'].startswith('lower'),
      f"1 region at ({lt['regions'][0]['x']:.2f},{lt['regions'][0]['y']:.2f}) "
      f"{lt['regions'][0]['w']:.2f}x{lt['regions'][0]['h']:.2f} '{lt['regions'][0]['where']}' "
      f"vs truth ({cx},{cy}) {cw}x{chh}" if lt['regions'] else 'no region found')
check('glyphs with no plate are found, if only in pieces',
      len(cap['regions']) >= 1 and all(r['y'] >= cy - 0.09 for r in cap['regions']),
      f"{len(cap['regions'])} region(s), all in the lower band: "
      f"{[(round(r['x'], 2), round(r['y'], 2), round(r['w'], 2)) for r in cap['regions']]}")
check('the same picture with no caption finds nothing',
      len(noc['regions']) == 0 and noc['usable'],
      f"0 regions, {noc['framePctStatic']}% of the frame held across "
      f"{noc['boundariesFound']} cuts")
check('a clip with nothing changing refuses instead of guessing',
      not st['overlays']['usable'] and 'cannot be told' in st['overlays']['note'],
      st['overlays']['note'][:64] + '…')
check('it never claims to have read anything',
      'NOT OCR' in lt['note'] and 'NOT text detection' in lt['note'],
      'the report names itself as held regions, not as text')

# ═══════════════════════════════════════════════════════════════════
print('\n· honesty')
# ═══════════════════════════════════════════════════════════════════
# `sim` above was analysed with includeCadence=False, and asking THAT
# whether it declined to report a tempo proves only that the flag works.
# This asks a silent clip for its cadence.
silent = analyze(p('nocaption.mp4'))
check('no audio means no cadence, not an invented tempo',
      silent.get('cadence') is None and 'No audio' in (silent.get('cadenceUnavailable') or ''),
      (silent.get('cadenceUnavailable') or 'MISSING')[:70] + '…')
check('a forced sampling rate is declared, not hidden',
      (lambda z: z['format']['analysisFps'] < 30 and len(z['analysis']['warnings']) > 0
       and 'quantised' in z['analysis']['warnings'][0])(
          analyze(p('cuts.mp4'), maxFrames=60, includeCadence=False,
                  includeGrade=False, includeOverlays=False)),
      'maxFrames=60 lowers the rate and says the cut times are now quantised')

# ═══════════════════════════════════════════════════════════════════
print("\n· Kerf's own starter export — a fixture nobody here constructed")
# ═══════════════════════════════════════════════════════════════════
STARTER = p('starter.mp4')
r = call('open_starter_project', {}, timeout=300)['result']
if not r.get('success'):
    raise RuntimeError(f'open_starter_project: {r.get("error")}')
r = call('render_export', {'resolution': '1080p', 'outputPath': STARTER}, timeout=900)['result']
if not r.get('success'):
    raise RuntimeError(f'render_export: {r.get("error")}')

s = analyze(STARTER)
sf = s['format']
# HANDOVER §3a, verified independently there and written down before this
# tool existed: 1920x1080, 30fps, 345 frames, 11.500s, 13 cuts from
# 4.000s to 10.000s, a 118.9 BPM bed.
check('format matches the record in HANDOVER §3a',
      (sf['width'], sf['height'], sf['fps'], sf['frameCount'], sf['durationMs'])
      == (1920, 1080, 30, 345, 11500),
      f"{sf['width']}x{sf['height']} {sf['fps']}fps {sf['frameCount']} frames "
      f"{sf['durationMs']}ms")
check('13 cuts, from 4.000s to 10.000s',
      s['cuts']['count'] == 13 and s['cuts']['cutMs'][0] == 4000 and s['cuts']['cutMs'][-1] == 10000,
      f"{s['cuts']['count']} cuts, {s['cuts']['cutMs'][0]}ms … {s['cuts']['cutMs'][-1]}ms")
scene = ffmpeg_scene_cuts(STARTER)
check('and ffmpeg\'s own scene detector agrees, to the millisecond',
      scene == s['cuts']['cutMs'],
      f"{len(scene)} cuts from ffmpeg `select=gt(scene,0.15)`, "
      f"max |Δ| {max([abs(x - y) for x, y in zip(scene, s['cuts']['cutMs'])] or [0])}ms")
check('four seconds of runway with no cut at all',
      s['cuts']['shots'][0]['durationMs'] == 4000,
      f"first shot runs {s['cuts']['shots'][0]['durationMs']}ms — the piece's stated design")
sc = s['cadence']
check('the bed measures 118.9 BPM, as it was recorded doing',
      abs(sc['bpm'] - 118.9) < 1.2 and sc['beats'] == 22,
      f"{sc['bpm']} BPM, {sc['beats']} beats (HANDOVER says 118.9 and 22)")
check('every cut in the film lands on that grid',
      sc['cutsOnBeat'] == 13 and sc['maxOffsetMs'] <= 40,
      f"{sc['cutsOnBeat']}/{sc['cutsAnalysed']} cuts within {sc['toleranceMs']}ms, worst "
      f"{sc['maxOffsetMs']}ms")

# The luminance zig-zag the starter is built around: adjacent shots must
# be far apart in brightness. Measured off the render rather than trusted.
lums = [x['luma'] for x in s['grade']['perShot']]
gaps = [abs(b - a) for a, b in zip(lums, lums[1:])]
check('the luminance zig-zag the film is built on is visible in the grade',
      min(gaps) > 25,
      f"smallest gap between adjacent shots is {min(gaps):.1f} luma over {len(gaps)} cuts")

# Independent measurement of the grade, from full-resolution frames that
# never went through the contact sheet. float64 accumulation: summing
# 70M float32 values silently loses enough precision to make three
# different channel means print as identical, which cost a detour.
gd = os.path.join(TMP, 'gradecheck')
os.makedirs(gd, exist_ok=True)
ff(['-i', STARTER, '-vf', 'fps=3', '-f', 'image2', os.path.join(gd, 'f%03d.png')])
tot = np.zeros(3, dtype=np.float64)
ysum = 0.0
npix = 0
for fn in sorted(glob.glob(os.path.join(gd, '*.png'))):
    arr = np.asarray(Image.open(fn).convert('RGB'), dtype=np.float64).reshape(-1, 3)
    tot += arr.sum(0)
    ysum += float((0.2126 * arr[:, 0] + 0.7152 * arr[:, 1] + 0.0722 * arr[:, 2]).sum())
    npix += arr.shape[0]
ind_rgb = tot / npix
ind_luma = ysum / npix
tool_rgb = s['grade']['colour']['meanRgb']
"""
This compares TWO DECODERS, and that is a wider tolerance than it looks.

The tool reads its pixels through Chromium (a <video> element onto a
canvas); this independent measurement reads them through ffmpeg into
PNGs. h264 is YUV, and turning YUV into RGB involves a colour matrix and
a range convention (limited 16-235 against full 0-255) that the two do
not have to agree on to the last digit — and Chromium's answer depends
on whether the machine gave it a hardware decoder.

Measured: the INDEPENDENT side reads 75.8 on both this machine and a
GitHub macOS runner — ffmpeg is stable. The TOOL side reads 68.26 here
and 63.48 there. So the drift is Chromium's, it is about 5 luma between
machines, and a +-10 window that passed locally failed in CI on the
first run. Tightening it further would only make the suite a detector of
which decoder the machine has.

So: +-20, and what this check is really asserting is that the contact
sheet is a faithful sample of the film rather than of something else
entirely — a scrambled or half-black sheet would be 40 or 80 out, not
12. The SHAPE of the grade is checked by the neighbours below (B > R,
"cool", the dominant hue, the zig-zag), and those are range-invariant,
which is why they are the ones to trust.

Recorded in NEXT.md: analyze_reference_video's ABSOLUTE grade numbers
are decoder-dependent to about 5 luma. Its comparative readings are not.
"""
check('the grade agrees with full-resolution frames it never saw',
      abs(s['grade']['luminance']['mean'] - ind_luma) < 20
      and all(abs(t - i) < 20 for t, i in zip(tool_rgb, ind_rgb)),
      f"tool luma {s['grade']['luminance']['mean']} vs {ind_luma:.1f} independent "
      f"(two decoders, ~5 luma of machine variance); "
      f"RGB {tool_rgb} vs [{ind_rgb[0]:.1f}, {ind_rgb[1]:.1f}, {ind_rgb[2]:.1f}]")
check('and it reads the blue in it as blue',
      tool_rgb[2] > tool_rgb[0] and ind_rgb[2] > ind_rgb[0]
      and s['grade']['colour']['descriptor'] == 'cool'
      and s['grade']['dominantHues'][0]['name'] in ('azure', 'blue', 'cyan'),
      f"B > R in both measurements; called '{s['grade']['colour']['descriptor']}', dominant hue "
      f"'{s['grade']['dominantHues'][0]['name']}' at {s['grade']['dominantHues'][0]['sharePct']}%")


def stripped(x):
    x = json.loads(json.dumps(x))
    x['analysis']['elapsedMs'] = 0
    for q in x['analysis']['passes']:
        q['ms'] = 0
        q['outputBytes'] = 0
    return json.dumps(x, sort_keys=True)


check('two runs of the same file give the same answer',
      stripped(analyze(STARTER)) == stripped(s),
      'byte-identical apart from the wall-clock timings')

n = sum(results)
print(f"\n{n}/{len(results)} reference-analysis checks passed")
shutil.rmtree(TMP, ignore_errors=True)
if n != len(results):
    sys.exit(1)
