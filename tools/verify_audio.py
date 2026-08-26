"""
Per-clip audio processing, proved on the EXPORTED WAVEFORM.

    Kerf must be running.  python3 tools/verify_audio.py

pitch, voiceEffect, noiseReduction and ducking were stored on the clip,
offered by list_properties, settable by patch_clip, and applied by
neither playback nor export. Checking the store would have passed on all
four, so every check here renders a real file and measures the sound that
came out.
"""
import sys, os, math, wave, subprocess, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kerf_rpc import call, ok
import numpy as np

TMP = tempfile.mkdtemp(prefix='kerf-audio-')
SR = 48000

def tone(path, freq, dur=2.0, gate=None, amp=0.5):
    t = np.arange(int(SR * dur)) / SR
    x = np.sin(2 * np.pi * freq * t) * amp
    if gate is not None:
        x *= gate(t)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())
    return path

def render(name, dur_ms):
    out = os.path.join(TMP, f'{name}.mp4')
    ok(call('render_export', {'resolution': '720p', 'durationMs': dur_ms,
                              'outputPath': out}), 'render')
    wav = os.path.join(TMP, f'{name}.wav')
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', out, '-vn', '-ac', '1',
                    '-ar', str(SR), '-c:a', 'pcm_s16le', wav], check=True)
    with wave.open(wav) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(float) / 32768

def dominant_hz(x):
    seg = x[int(0.3 * SR):int(1.3 * SR)]
    if len(seg) < 1024: return 0.0
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
    return float(np.fft.rfftfreq(len(seg), 1 / SR)[int(np.argmax(spec))])

def band_energy(x, lo, hi):
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    f = np.fft.rfftfreq(len(x), 1 / SR)
    m = (f >= lo) & (f < hi)
    return float((spec[m] ** 2).sum())

def rms_at(x, a, b):
    seg = x[int(a * SR):int(b * SR)]
    return float(np.sqrt((seg ** 2).mean() + 1e-12))

def build(path, name, dur_ms, props=None):
    ok(call('reset_project', {'name': name, 'aspectRatio': '16:9', 'fps': 30,
                              'backgroundColor': '#000000', 'durationMs': dur_ms}), 'reset')
    a = ok(call('import_media_from_path', {'path': path, 'name': name}), 'imp')['assetId']
    t = ok(call('add_track', {'type': 'audio', 'name': 'A'}), 't')['trackId']
    c = ok(call('insert_clip', {'assetId': a, 'trackId': t, 'startTimeMs': 0}), 'ins')['clipId']
    if props: ok(call('patch_clip', {'clipId': c, 'properties': props}), 'p')
    return c

results = []
def check(label, good, detail):
    print(f"  {'PASS' if good else 'FAIL'}  {label:30s} {detail}")
    results.append(good)

src = tone(os.path.join(TMP, 'a440.wav'), 440.0)

# ── 1 · pitch shift, and the duration must survive it ──────────────
build(src, 'plain', 2000)
base = render('plain', 2000)
f0 = dominant_hz(base)
build(src, 'pitched', 2000, {'audio.pitch': 12})
up = render('pitched', 2000)
f1 = dominant_hz(up)
check('pitch +12st doubles the tone', abs(f1 - 2 * f0) < 40, f'{f0:.0f} Hz -> {f1:.0f} Hz (want ~{2*f0:.0f})')
check('pitch keeps the duration', abs(len(up) - len(base)) < SR * 0.15,
      f'{len(base)/SR:.2f}s -> {len(up)/SR:.2f}s')

build(src, 'down', 2000, {'audio.pitch': -12})
dn = render('down', 2000)
f2 = dominant_hz(dn)
check('pitch -12st halves the tone', abs(f2 - f0 / 2) < 25, f'{f0:.0f} Hz -> {f2:.0f} Hz (want ~{f0/2:.0f})')

# ── 2 · telephone band-limits ──────────────────────────────────────
wide = tone(os.path.join(TMP, 'wide.wav'), 120.0)
build(wide, 'lowplain', 2000)
lp = render('lowplain', 2000)
build(wide, 'phone', 2000, {'audio.voiceEffect': 'telephone'})
ph = render('phone', 2000)
low_before = band_energy(lp[:SR], 60, 300)
low_after = band_energy(ph[:SR], 60, 300)
check('telephone removes the lows', low_after < low_before * 0.25,
      f'60-300Hz energy {low_before:.3g} -> {low_after:.3g}')

# ── 3 · voice effects each change the sound ────────────────────────
for eff in ('deep', 'high', 'robot', 'echo', 'stadium'):
    build(src, eff, 2000, {'audio.voiceEffect': eff})
    y = render(eff, 2000)
    n = min(len(y), len(base))
    d = float(np.abs(y[:n] - base[:n]).mean())
    check(f'voiceEffect {eff}', d > 0.005, f'mean abs difference from dry {d:.4f}')

# ── 4 · noise reduction lowers the noise floor ─────────────────────
noisy = os.path.join(TMP, 'noisy.wav')
rng = np.random.default_rng(7)
t = np.arange(int(SR * 2)) / SR
x = np.sin(2 * np.pi * 440 * t) * 0.4 + rng.standard_normal(len(t)) * 0.07
with wave.open(noisy, 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((x * 32767).astype('<i2').tobytes())
build(noisy, 'noisy', 2000)
nb = render('noisy', 2000)
build(noisy, 'denoised', 2000, {'audio.noiseReduction': True})
na = render('denoised', 2000)
hf_before = band_energy(nb[:SR], 6000, 20000)
hf_after = band_energy(na[:SR], 6000, 20000)
check('noiseReduction cuts hiss', hf_after < hf_before * 0.6,
      f'6-20kHz energy {hf_before:.3g} -> {hf_after:.3g}')

# ── 5 · ducking pulls the music down while the voice speaks ────────
music = tone(os.path.join(TMP, 'music.wav'), 220.0, dur=3.0, amp=0.5)
voice = tone(os.path.join(TMP, 'voice.wav'), 900.0, dur=3.0, amp=0.6,
             gate=lambda t: ((t > 1.0) & (t < 2.0)).astype(float))
ok(call('reset_project', {'name': 'duck', 'aspectRatio': '16:9', 'fps': 30,
                          'backgroundColor': '#000000', 'durationMs': 3000}), 'reset')
am = ok(call('import_media_from_path', {'path': music, 'name': 'music'}), 'i')['assetId']
av = ok(call('import_media_from_path', {'path': voice, 'name': 'voice'}), 'i')['assetId']
tm = ok(call('add_track', {'type': 'audio', 'name': 'M'}), 't')['trackId']
tv = ok(call('add_track', {'type': 'audio', 'name': 'V'}), 't')['trackId']
cm = ok(call('insert_clip', {'assetId': am, 'trackId': tm, 'startTimeMs': 0}), 'i')['clipId']
ok(call('insert_clip', {'assetId': av, 'trackId': tv, 'startTimeMs': 0}), 'i')
off = render('duckoff', 3000)
ok(call('patch_clip', {'clipId': cm, 'properties': {'audio.ducking': True}}), 'd')
on = render('duckon', 3000)

def music_only(x, a, b):
    seg = x[int(a * SR):int(b * SR)]
    return band_energy(seg, 180, 260)     # the 220Hz bed, away from the 900Hz voice

quiet_off, loud_off = music_only(off, 0.2, 0.8), music_only(off, 1.3, 1.8)
quiet_on, loud_on = music_only(on, 0.2, 0.8), music_only(on, 1.3, 1.8)
ratio_off = loud_off / max(quiet_off, 1e-9)
ratio_on = loud_on / max(quiet_on, 1e-9)
check('ducking dips music under voice', ratio_on < ratio_off * 0.75,
      f'music-while-voice / music-alone: {ratio_off:.3f} unducked -> {ratio_on:.3f} ducked')

print(f"\n{sum(results)}/{len(results)} audio checks passed on the exported waveform")
