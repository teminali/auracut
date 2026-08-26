#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════════════
Kerf brand-film sound bed.

The v1 sting was five elements mixed for a single hit at 0.95s. Its
recipe lived only in the prose of commit d281790, so it could not be
rebuilt — only described. This script IS the recipe, which is why it is
in the repo rather than in a commit message.

Structure is reverse-engineered from the reference film's measured
envelope, not invented:

    0.0 - 4.0s   runway. One riser, no cuts. RMS climbs -30 -> -12 dB.
                 A tick on every beat from 1.0s so the tempo is
                 established BEFORE the first cut arrives — that is what
                 makes the cut feel on-time rather than sudden.
    4.0s         the impact. Loudest single moment in the piece.
    4.0 -11.0s   120 BPM: a kick on every beat, and a ghost hit on the
                 16th before each beat (the "a" of 1-e-and-a). The
                 reference's per-beat shape measured
                 -9 / -16 / -27 / -17 dB across its four 16ths, and that
                 trough is the reason the next kick lands.
   11.0 -11.5s   tail.

Everything is additive and vectorised: sines, exponential decays, and
noise coloured by subtracting a moving average. No time-varying IIR, so
the output is deterministic and the script has no scipy dependency.

    python3 tools/build_sting.py src/assets/kerf_sting.wav
═══════════════════════════════════════════════════════════════════════
"""
import sys
import wave
import numpy as np

SR = 48_000
DUR = 11.5
BPM = 120.0
BEAT = 60.0 / BPM              # 0.5s
RUNWAY_END = 4.0               # first cut, and the impact
BEATS_END = 11.0               # last kick

N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(0x4B455246)  # "KERF" — fixed seed, so this is reproducible


def env_exp(start_s, decay_s, floor=1e-4):
    """Exponential decay envelope starting at `start_s`, zero before it."""
    e = np.zeros(N)
    i0 = int(start_s * SR)
    if i0 >= N:
        return e
    tail = t[i0:] - start_s
    e[i0:] = np.exp(-tail / decay_s)
    e[e < floor] = 0.0
    return e


def moving_average(x, win):
    """Vectorised box filter via cumulative sum — used to colour noise."""
    c = np.cumsum(np.concatenate([[0.0], x]))
    ma = (c[win:] - c[:-win]) / win
    return np.concatenate([np.full(win - 1, ma[0]), ma])


def db(x):
    r = np.sqrt(np.mean(x ** 2))
    return 20 * np.log10(r + 1e-9)


noise = rng.standard_normal(N)
dark = moving_average(noise, 96)                       # dull, low
mid = noise - moving_average(noise, 220)               # body
bright = noise - moving_average(noise, 24)             # air

mix = np.zeros(N)

# ── 1. The riser ────────────────────────────────────────────────────
# Amplitude climbs on a curve, not a line: most of the rise happens in
# the last second so the runway stays quiet long enough to feel long.
# The 0.16 floor matters — the reference opens at -28 dB, not silence.
# A runway that fades up from nothing reads as a missing first second.
ramp = np.clip(t / RUNWAY_END, 0, 1)
riser_amp = np.where(t < RUNWAY_END, 0.085 + 0.915 * ramp ** 2.4, 0.0)

# A pad under the whole runway, present from frame one.
pad_gate = np.clip(t / 0.25, 0, 1) * np.clip((RUNWAY_END + 0.5 - t) / 0.7, 0, 1)
for f, a in ((49.0, 0.055), (73.5, 0.033), (98.0, 0.019), (147.0, 0.010)):
    mix += np.sin(2 * np.pi * f * t + f * 0.7) * pad_gate * a
mix += dark * pad_gate * 0.028

# Noise opens up dark -> mid -> bright across the runway.
w_dark = np.clip(1 - ramp * 2.0, 0, 1)
w_bright = np.clip(ramp * 2.0 - 1.0, 0, 1)
w_mid = np.clip(1 - w_dark - w_bright, 0, 1)
riser_noise = (dark * w_dark + mid * w_mid * 1.1 + bright * w_bright * 0.5)
mix += riser_noise * riser_amp * 0.26

# An uplifting tone under it: three partials sweeping upward together.
sweep = 70 * (1 + 5.5 * ramp ** 2)                     # 70 Hz -> ~455 Hz
phase = 2 * np.pi * np.cumsum(sweep) / SR
for k, amp in ((1, 0.30), (2, 0.13), (3, 0.06)):
    mix += np.sin(phase * k) * riser_amp * amp

# ── 2. The runway pulse ─────────────────────────────────────────────
# From 1.0s, so eight ticks establish 120 BPM before the montage.
tick_beats = np.arange(1.0, RUNWAY_END, BEAT)
for b in tick_beats:
    grow = (b - 1.0) / max(RUNWAY_END - 1.0, 1e-6)
    e = env_exp(b, 0.030)
    mix += np.sin(2 * np.pi * 1180 * t) * e * (0.05 + 0.10 * grow)
    mix += bright * e * (0.02 + 0.05 * grow)

# ── 3. The impact at 4.0s ───────────────────────────────────────────
# Sub drop, inharmonic metal ring, and a noise slam — the three things
# that make a hit read as an event rather than a loud note.
imp = RUNWAY_END
sub_f = 130 * np.exp(-np.clip(t - imp, 0, None) / 0.10) + 34
sub_phase = 2 * np.pi * np.cumsum(sub_f) / SR
mix += np.sin(sub_phase) * env_exp(imp, 0.30) * 0.85

for f, a in ((1860, 0.11), (2790, 0.08), (3730, 0.05), (5210, 0.03)):
    mix += np.sin(2 * np.pi * f * t) * env_exp(imp, 0.55) * a

mix += bright * env_exp(imp, 0.16) * 0.42
mix += mid * env_exp(imp, 0.40) * 0.18

# ── 4. The 120 BPM engine ───────────────────────────────────────────
kick_beats = np.arange(RUNWAY_END, BEATS_END + 1e-6, BEAT)


def drive(b):
    """The montage gains weight as it runs. The reference climbs from
    -14.6 dB at its first montage beat to about -9 by two-thirds through
    and holds there; a loop at constant level reads as a placeholder."""
    return 0.70 + 0.55 * min(max((b - RUNWAY_END) / 3.5, 0.0), 1.0)


for i, b in enumerate(kick_beats):
    d = drive(b)
    accent = 1.0 if i == 0 else (0.92 if i % 4 == 0 else 0.74)
    kf = 148 * np.exp(-np.clip(t - b, 0, None) / 0.045) + 46
    kp = 2 * np.pi * np.cumsum(kf) / SR
    mix += np.sin(kp) * env_exp(b, 0.17) * 0.78 * accent * d
    mix += bright * env_exp(b, 0.012) * 0.17 * accent * d   # beater click

    # A bass note per beat, entering with the second half of the montage.
    if b >= RUNWAY_END + BEAT * 3:
        note = (55.0, 55.0, 73.4, 65.4)[i % 4]
        mix += np.sin(2 * np.pi * note * t + i) * env_exp(b, 0.22) * 0.22 * d

    # Ghost on the 16th before the next beat. This is the pickup that
    # makes the following kick land; without it the grid reads as a
    # metronome rather than a groove.
    g = b + BEAT * 0.75
    if g < BEATS_END + BEAT:
        mix += bright * env_exp(g, 0.028) * 0.13 * d
        mix += np.sin(2 * np.pi * 2400 * t) * env_exp(g, 0.020) * 0.045 * d

    # An open hat on the "and" of alternate beats only. The reference is
    # a written track, not a one-bar loop — its beats do not all measure
    # the same, and a perfect loop is audible as one.
    if i % 2 == 1 and i > 2:
        mix += bright * env_exp(b + BEAT * 0.5, 0.075) * 0.075 * d

# ── 5. The bed ──────────────────────────────────────────────────────
# Two detuned lows holding under the montage so the gaps between kicks
# are quiet, not empty.
bed_gate = np.clip((t - RUNWAY_END + 0.4) / 0.6, 0, 1) * np.clip((DUR - t) / 0.45, 0, 1)
for f, a in ((55.0, 0.20), (82.5, 0.11), (110.0, 0.06)):
    mix += np.sin(2 * np.pi * f * t + f) * bed_gate * a

# ── 6. Tail ─────────────────────────────────────────────────────────
mix += mid * env_exp(BEATS_END, 0.55) * 0.10
for f, a in ((1860, 0.05), (2790, 0.03)):
    mix += np.sin(2 * np.pi * f * t) * env_exp(BEATS_END, 0.80) * a

# ── Master ──────────────────────────────────────────────────────────
mix *= np.clip((DUR - t) / 0.35, 0, 1)                  # hard-out, no click
mix = np.tanh(mix * 1.15) * 0.92                        # soft clip for glue
mix /= np.max(np.abs(mix)) / 0.89                       # peak ~ -1.0 dBFS

# Slight stereo width on the airy content only; lows stay centred.
side = (bright * riser_amp * 0.05) + (bright * env_exp(imp, 0.16) * 0.06)
left = np.clip(mix + side, -1, 1)
right = np.clip(mix - side, -1, 1)

inter = np.empty(N * 2, dtype=np.float32)
inter[0::2] = left
inter[1::2] = right
pcm = (inter * 32767).astype('<i2')

out = sys.argv[1] if len(sys.argv) > 1 else 'kerf_sting.wav'
with wave.open(out, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())

print(f"wrote {out}  {DUR}s  {SR}Hz stereo")
print("  t      RMS dB")
for s in np.arange(0, DUR, 0.5):
    seg = mix[int(s * SR):int((s + 0.5) * SR)]
    print(f"{s:5.1f}   {db(seg):7.1f}")
