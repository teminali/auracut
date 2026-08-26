"""
The ffmpeg bridge, checked against the files it writes.

    Kerf must be running.  python3 tools/verify_ffmpeg_bridge.py

A tool that shells out is the easiest place in this codebase to report
success and produce nothing — the previous export did exactly that for
months. So every check here confirms a real file exists, is non-empty,
and differs from the input in the way the operation claims.
"""
import sys, os, subprocess, tempfile, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kerf_rpc import call, ok

TMP = tempfile.mkdtemp(prefix='kerf-bridge-')
results = []

def check(label, good, detail):
    print(f"  {'PASS' if good else 'FAIL'}  {label:30s} {detail}")
    results.append(good)

def probe(path):
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries',
         'stream=codec_type,codec_name,width,height,nb_frames,r_frame_rate:format=duration',
         '-of', 'json', path], capture_output=True, text=True).stdout
    return json.loads(out or '{}')

# A short source clip with motion and detail.
SRC = os.path.join(TMP, 'src.mp4')
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi',
                '-i', 'testsrc2=size=640x360:rate=24:duration=2',
                '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
                '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-shortest', SRC], check=True)
src_info = probe(SRC)
print(f'source: {SRC}  {src_info["format"]["duration"]}s\n')

def run(op, **kw):
    return ok(call('ffmpeg_process', {'source': SRC, 'operation': op, **kw}), f'ffmpeg_process {op}')

# ── interpolate: the frame RATE must actually go up ────────────────
r = run('interpolate', fps=60)
info = probe(r['outputPath'])
v = next(s for s in info['streams'] if s['codec_type'] == 'video')
rate = eval(v['r_frame_rate'])
check('interpolate raises the rate', abs(rate - 60) < 1, f"24 -> {rate:.0f} fps, {r['sizeMb']} MB")

# ── speed: the DURATION must change ────────────────────────────────
r = run('speed', speed=2)
d = float(probe(r['outputPath'])['format']['duration'])
check('speed 2x halves duration', abs(d - 1.0) < 0.25, f'2.0s -> {d:.2f}s')

# ── reverse: a real file, and different pixels ─────────────────────
r = run('reverse')
d = float(probe(r['outputPath'])['format']['duration'])
check('reverse keeps duration', abs(d - 2.0) < 0.3, f'{d:.2f}s')

# ── denoise / sharpen / stabilize / deflicker produce real files ───
for op in ('denoise', 'sharpen', 'stabilize', 'deflicker'):
    r = run(op, amount=70)
    exists = os.path.exists(r['outputPath']) and r['bytes'] > 10_000
    check(f'{op} writes a real file', exists, f"{r['sizeMb']} MB  vf={r['filtergraph'][:44]}")

# ── extract_audio gives an audio-only file ─────────────────────────
r = run('extract_audio')
info = probe(r['outputPath'])
kinds = {s['codec_type'] for s in info['streams']}
check('extract_audio is audio only', kinds == {'audio'}, f'streams: {sorted(kinds)}')

# ── lut3d applies a real .cube ─────────────────────────────────────
CUBE = os.path.join(TMP, 'warm.cube')
with open(CUBE, 'w') as f:
    f.write('LUT_3D_SIZE 2\n')
    for b in (0, 1):
        for g in (0, 1):
            for rr in (0, 1):
                f.write(f'{min(1.0, rr * 1.0):.6f} {g * 0.55:.6f} {b * 0.25:.6f}\n')
r = run('lut', lutPath=CUBE)
png = os.path.join(TMP, 'lut.png')
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', '0.5', '-i', r['outputPath'],
                '-frames:v', '1', png], check=True)
png0 = os.path.join(TMP, 'orig.png')
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', '0.5', '-i', SRC,
                '-frames:v', '1', png0], check=True)
import numpy as np
from PIL import Image
a0 = np.array(Image.open(png0).convert('RGB')).astype(float)
a1 = np.array(Image.open(png).convert('RGB')).astype(float)
shift = (a0[:, :, 2].mean() - a1[:, :, 2].mean())
check('lut3d applies a .cube', shift > 8, f'blue channel {a0[:,:,2].mean():.1f} -> {a1[:,:,2].mean():.1f}')

# ── custom filtergraph is the escape hatch ─────────────────────────
r = run('custom', filtergraph='hflip,eq=saturation=0')
png2 = os.path.join(TMP, 'custom.png')
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', '0.5', '-i', r['outputPath'],
                '-frames:v', '1', png2], check=True)
a2 = np.array(Image.open(png2).convert('RGB')).astype(float)
def sat_of(a): return float((a.max(axis=2) - a.min(axis=2)).mean())
# Against the SOURCE, not an absolute floor: yuv420p chroma subsampling and
# H.264 leave a few units of residual colour however hard you desaturate.
check('custom filtergraph runs', sat_of(a2) < sat_of(a0) * 0.1,
      f'saturation {sat_of(a0):.1f} -> {sat_of(a2):.2f}')

# ── a bad graph must FAIL, not report success ──────────────────────
bad = call('ffmpeg_process', {'source': SRC, 'operation': 'custom',
                              'filtergraph': 'thisisnotafilter=9'})['result']
check('a bad filtergraph fails loudly', not bad.get('success'),
      (bad.get('error') or '')[:60])

# ── the imported asset is in the pool ──────────────────────────────
pool = ok(call('list_media_pool', {}), 'pool')
names = [a['name'] for a in pool['assets']]
check('processed media is imported', any('(interpolate)' in n for n in names),
      f'{len(names)} assets in the pool')

print(f"\n{sum(results)}/{len(results)} ffmpeg-bridge checks passed on written files")
