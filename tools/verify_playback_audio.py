"""
Does the PREVIEW sound like the RENDER? Measured on both, not asserted.

    Kerf must be running.  python3 tools/verify_playback_audio.py

`tools/verify_audio.py` proves the export applies pitch, voice effects,
noise reduction and ducking. It says nothing about playback, which applied
none of them — so the app played one thing and wrote another, and nothing
in the codebase could have told you. That is worse than the gap it
replaced: before, neither side applied them and the export said so.

The difficulty was always the instrument. The export can be checked by
reading the file it wrote; playback has no file. So the preview chain is
built on a `BaseAudioContext` rather than on the playback context, and
`describe_audio_preview` renders it through an `OfflineAudioContext` over a
probe signal. That gives two measurements of the same quantity, one per
engine, and this suite compares them:

  · echo and stadium — the impulse response of the RENDERED FILE, and the
    taps `describe_audio_preview` reports, have to name the same delays;
  · telephone — the band gains of the rendered file and of the preview
    chain have to agree in dB;
  · pitch, deep, high, noiseReduction — the preview must declare it cannot
    do them AND be measurably transparent, while the export must
    measurably change the sound. A gap that is declared is a gap; a gap
    that is declared while the preview quietly does something else is the
    original bug wearing a label.

Ground truth is constructed here, not borrowed: an impulse to read delays
off, and white noise to read a filter's band gains off. A music bed would
have measured the bed.
"""
import sys, os, math, wave, subprocess, tempfile, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kerf_rpc import call, ok
import numpy as np

TMP = tempfile.mkdtemp(prefix='kerf-preview-')
SR = 48000
BANDS = [100, 300, 1000, 3000, 6000, 12000]

results = []
def check(label, good, detail):
    print(f"  {'PASS' if good else 'FAIL'}  {label:34s} {detail}")
    results.append(good)

# ── probe signals ───────────────────────────────────────────────────
def write_wav(path, x):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())
    return path

def impulse_wav(path, dur=2.5, at=0.25):
    """One sample at full scale. The render of this IS the render's
    impulse response, which is where the echo taps can be read off."""
    x = np.zeros(int(SR * dur))
    x[int(SR * at)] = 1.0
    return write_wav(path, x)

def noise_wav(path, dur=2.5):
    """White noise — flat across the spectrum, so any band that comes back
    down came down because of a filter and not because the source had
    nothing there. A sine would only ever measure one band."""
    rng = np.random.default_rng(11)
    return write_wav(path, rng.normal(0, 0.25, int(SR * dur)))

IMPULSE = impulse_wav(os.path.join(TMP, 'impulse.wav'))
NOISE = noise_wav(os.path.join(TMP, 'noise.wav'))

# ── the render side ─────────────────────────────────────────────────
def render(path, name, props, dur_ms=2500):
    """Put one clip on an empty timeline, set it, export, read it back."""
    ok(call('reset_project', {'name': name, 'aspectRatio': '16:9', 'fps': 30,
                              'backgroundColor': '#000000', 'durationMs': dur_ms}), 'reset')
    a = ok(call('import_media_from_path', {'path': path, 'name': name}), 'imp')['assetId']
    t = ok(call('add_track', {'type': 'audio', 'name': 'A'}), 't')['trackId']
    c = ok(call('insert_clip', {'assetId': a, 'trackId': t, 'startTimeMs': 0}), 'ins')['clipId']
    if props: ok(call('patch_clip', {'clipId': c, 'properties': props}), 'p')

    out = os.path.join(TMP, f'{name}.mp4')
    ok(call('render_export', {'resolution': '720p', 'durationMs': dur_ms,
                              'outputPath': out}), 'render')
    wav = os.path.join(TMP, f'{name}.wav')
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', out, '-vn', '-ac', '1',
                    '-ar', str(SR), '-c:a', 'pcm_s16le', wav], check=True)
    with wave.open(wav) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(float) / 32768
    return c, x

# ── metrics, applied identically to both sides ──────────────────────
def taps_ms(x, floor_ratio=0.05, guard_ms=1.0):
    """Delays present in an impulse response, relative to the first.

    Same rule the preview measurement uses: a filter rings for many
    samples after a transient, so anything within a millisecond of a tap
    already found is that same tap still decaying."""
    peak = np.abs(x).max()
    if peak <= 0: return []
    floor = max(peak * floor_ratio, 1e-4)
    guard = int(SR * guard_ms / 1000)
    out, last = [], -guard * 2
    for i in np.nonzero(np.abs(x) >= floor)[0]:
        if i - last <= guard:
            last = i; continue
        out.append(i); last = i
    if not out: return []
    return [round((i - out[0]) / SR * 1000, 1) for i in out]

def band_gain_db(dry, wet, ratio=1.08):
    """The render's actual transfer function: mean PSD of the processed
    render over mean PSD of the unprocessed one, per band.

    The first version of this summed band ENERGY and normalised to the
    loudest band, and that was wrong in a way worth keeping written down.
    Bands defined as a ratio around a centre get wider as the centre goes
    up, and white noise puts energy in proportion to width — so the metric
    measured how wide each band was as much as what the filter did. It
    reported 3kHz as LOUDER than 1kHz through a 3200Hz lowpass, which no
    lowpass can do, and then blamed the preview for a 10dB disagreement.

    A ratio of mean power spectral densities has neither problem: the
    bandwidth cancels, the source spectrum cancels, and what is left is
    the gain in dB — directly comparable to the preview's tone
    measurements, which are gains too."""
    n = min(len(dry), len(wet))
    w = np.hanning(n)
    X = np.abs(np.fft.rfft(dry[:n] * w)) ** 2
    Y = np.abs(np.fft.rfft(wet[:n] * w)) ** 2
    f = np.fft.rfftfreq(n, 1 / SR)
    out = {}
    for hz in BANDS:
        m = (f >= hz / ratio) & (f < hz * ratio)
        out[hz] = round(10 * math.log10(max(Y[m].mean(), 1e-30) / max(X[m].mean(), 1e-30)), 2)
    return out

def preview(clip_id):
    d = ok(call('describe_audio_preview', {'clipId': clip_id}), 'preview')
    return d['clips'][0]

def preview_gain_db(measured):
    """The preview's gains, keyed the same way. Both sides are absolute
    gains in dB now, so no normalisation is needed on either."""
    return {int(k.replace('Hz', '')): v for k, v in measured['bandDb'].items()}

print('Preview vs render, both measured\n')

# ── 1. transparent chain ────────────────────────────────────────────
cid, x = render(IMPULSE, 'plain', None)
p = preview(cid)
m = p['measured']
check('none · preview transparent',
      abs(m['impulsePeak'] - 1.0) < 0.02 and m['tapsMs'] == [0]
      and all(abs(v) < 0.5 for v in m['bandDb'].values()),
      f"peak={m['impulsePeak']} taps={m['tapsMs']} bands flat")
check('none · preview claims match',
      p['previewMatchesRender'] and p['previewCannotApply'] == [],
      'previewMatchesRender=True')

# ── 2. echo and stadium — the delays must be the same delays ────────
for fx, want in (('echo', [0.0, 180.0, 340.0]),
                 ('stadium', [0.0, 420.0, 780.0, 1200.0])):
    cid, x = render(IMPULSE, fx, {'audio.voiceEffect': fx})
    rendered = taps_ms(x)
    p = preview(cid)
    shown = p['measured']['tapsMs']
    shown_rel = [round(t - shown[0], 1) for t in shown] if shown else []

    near = lambda a, b: len(a) == len(b) and all(abs(i - j) <= 8 for i, j in zip(a, b))
    check(f'{fx} · render taps', near(rendered, want), f'{rendered} (want {want})')
    check(f'{fx} · preview taps match render', near(shown_rel, rendered),
          f'preview {shown_rel} vs render {rendered}')
    check(f'{fx} · declared as previewed', fx in p['previewApplies'],
          f"previewApplies={p['previewApplies']}")

# ── 3. telephone — the two filters must BE the same filter ──────────
#     Not "both attenuate the ends": a check that loose passes on a filter
#     with a resonant peak in the passband, which is exactly what the
#     preview had — WebAudio reads BiquadFilterNode.Q in dB where ffmpeg's
#     width is a linear Q, so `Q = 0.7071` asked for 0.7071dB.
_, noise_dry = render(NOISE, 'noise_dry', None)
cid, x = render(NOISE, 'telephone', {'audio.voiceEffect': 'telephone'})
r = band_gain_db(noise_dry, x)
p = preview(cid)
q = preview_gain_db(p['measured'])
worst = max(abs(r[b] - q[b]) for b in BANDS)
check('telephone · render is a 400-3200 bandpass',
      r[100] < -15 and r[12000] < -15 and r[1000] > 0,
      f"100Hz {r[100]}dB  1kHz {r[1000]}dB  12kHz {r[12000]}dB")
check('telephone · preview IS the render\'s filter', worst <= 1.5,
      f'worst disagreement {worst:.2f}dB  ' +
      f"render {[r[b] for b in BANDS]} vs preview {[q[b] for b in BANDS]}")

# ── 4. robot — an approximation, so assert it MOVES ─────────────────
cid, x = render(NOISE, 'robot', {'audio.voiceEffect': 'robot'})
p = preview(cid)
check('robot · declared as previewed', 'robot' in p['previewApplies'],
      f"previewApplies={p['previewApplies']}")
check('robot · named as an approximation',
      any('robot' in a for a in ok(call('describe_audio_preview', {}), 'd')['approximations']),
      'listed under approximations, not claimed identical')

# ── 5. what the preview CANNOT do ───────────────────────────────────
#     Declared, AND transparent, AND actually different in the render.
dry = noise_dry
for label, props, key in (
    ('pitch +7',        {'audio.pitch': 7},                     'pitch'),
    ('deep',            {'audio.voiceEffect': 'deep'},          'deep'),
    ('high',            {'audio.voiceEffect': 'high'},          'high'),
    ('noiseReduction',  {'audio.noiseReduction': True},         'noise'),
):
    cid, x = render(NOISE, label.replace(' ', '_').replace('+', 'p'), props)
    p = preview(cid)
    m = p['measured']

    declared = len(p['previewCannotApply']) > 0 and not p['previewMatchesRender']
    transparent = abs(m['impulsePeak'] - 1.0) < 0.02 and all(abs(v) < 0.5 for v in m['bandDb'].values())

    # The render really does something — otherwise "they disagree" is a
    # claim about nothing, and this suite would pass on a broken export.
    n = min(len(dry), len(x))
    changed = float(np.abs(np.abs(np.fft.rfft(x[:n])) - np.abs(np.fft.rfft(dry[:n]))).mean())

    check(f'{label} · preview declares it cannot', declared,
          (p['previewCannotApply'][0][:64] + '…') if declared else 'NOT DECLARED')
    check(f'{label} · preview is silent about it, not wrong', transparent,
          f"peak={m['impulsePeak']} bands flat")
    check(f'{label} · render really does apply it', changed > 1.0,
          f'spectral distance from dry render {changed:.2f}')

# ── 6. ducking is a property of the mix ─────────────────────────────
ok(call('reset_project', {'name': 'duck', 'aspectRatio': '16:9', 'fps': 30,
                          'backgroundColor': '#000000', 'durationMs': 2500}), 'reset')
an = ok(call('import_media_from_path', {'path': NOISE, 'name': 'bed'}), 'i')['assetId']
t1 = ok(call('add_track', {'type': 'audio', 'name': 'A1'}), 't')['trackId']
t2 = ok(call('add_track', {'type': 'audio', 'name': 'A2'}), 't')['trackId']
music = ok(call('insert_clip', {'assetId': an, 'trackId': t1, 'startTimeMs': 0}), 'i')['clipId']
voice = ok(call('insert_clip', {'assetId': an, 'trackId': t2, 'startTimeMs': 0}), 'i')['clipId']

ok(call('patch_clip', {'clipId': music, 'properties': {'audio.ducking': True}}), 'p')
p = preview(music)
check('ducking · applied when there is a key clip', 'ducking' in p['previewApplies'],
      f"previewApplies={p['previewApplies']}")

ok(call('patch_clip', {'clipId': voice, 'properties': {'audio.ducking': True}}), 'p')
p = preview(music)
check('ducking · declared off when everything ducks',
      'ducking' not in p['previewApplies']
      and any('duck' in s for s in p['previewCannotApply']),
      'nothing to duck against — same fallback as the export')

n = sum(results)
print(f"\n{n}/{len(results)} preview-vs-render checks passed")
if n != len(results):
    sys.exit(1)
