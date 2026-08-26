/* ═══════════════════════════════════════════════════════════════════
   beatDetect — the analysis chain, on signals whose answer is known.

   This module passed for months on a click track, which is the one input
   that could not expose either of the two bugs it had. So none of the
   fixtures here is a bare click track: every one of them carries the
   thing that used to break it — ghost notes between the beats for the
   subdivision lock, and a stray transient before bar one for the phase
   error — and the expected answer is the number the fixture was BUILT
   from, never a number read back off the implementation.

   `detectBeats` itself needs `fetch` and WebAudio and is not tested here.
   Everything under it is arithmetic on a Float32Array, and that is where
   both bugs lived.
   ═══════════════════════════════════════════════════════════════════ */

import { describe, it, expect } from 'vitest';
import {
  HOP_SIZE,
  TARGET_RATE,
  computeNovelty,
  pickOnsets,
  tempoPrior,
  estimateBpm,
  buildBeatGrid,
  nearestBeat,
} from './beatDetect';

/** What `detectBeats` uses when the decode already sits at TARGET_RATE. */
const FRAME_MS = (HOP_SIZE / TARGET_RATE) * 1000; // 23.2199…ms

/* ── Synthetic audio ────────────────────────────────────────────── */

/** Deterministic noise. Math.random here would make every threshold in
    this file a coin flip that usually lands the right way up. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

interface TrackSpec {
  bpm: number;
  seconds: number;
  /** Subdivisions per beat that also get a hit. 2 = offbeat eighths. */
  subdivide?: number;
  /** Amplitude of those subdivision hits, relative to the beat. */
  ghostGain?: number;
  /** Move the whole pattern later, so the downbeat is not at zero. */
  phaseMs?: number;
  /** A single loud transient this many ms BEFORE the first beat. */
  leadInMs?: number;
  leadInGain?: number;
  /** Broadband bed so the novelty curve is not a bare impulse train. */
  bedGain?: number;
  seed?: number;
}

/**
 * A percussive track with a known tempo, and the list of beat times it
 * was built from. Every hit is a ~25ms exponentially decayed noise burst,
 * short against the 23ms analysis frame so the energy rise is visible.
 */
function synthTrack(spec: TrackSpec): { samples: Float32Array; trueBeatsMs: number[] } {
  const {
    bpm,
    seconds,
    subdivide = 1,
    ghostGain = 0.45,
    phaseMs = 0,
    leadInMs,
    leadInGain = 1,
    bedGain = 0.015,
    seed = 12345,
  } = spec;

  const rng = makeRng(seed);
  const n = Math.floor(seconds * TARGET_RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (rng() * 2 - 1) * bedGain;

  const hit = (atMs: number, gain: number) => {
    const start = Math.round((atMs / 1000) * TARGET_RATE);
    const len = Math.round(0.025 * TARGET_RATE);
    const tau = 0.004 * TARGET_RATE;
    for (let i = 0; i < len; i++) {
      const idx = start + i;
      if (idx < 0 || idx >= n) continue;
      out[idx] += (rng() * 2 - 1) * gain * Math.exp(-i / tau);
    }
  };

  const periodMs = 60000 / bpm;
  const trueBeatsMs: number[] = [];

  if (leadInMs !== undefined) hit(phaseMs - leadInMs, leadInGain);

  for (let t = phaseMs; t < seconds * 1000; t += periodMs) {
    trueBeatsMs.push(t);
    hit(t, 1);
    for (let s = 1; s < subdivide; s++) hit(t + (periodMs * s) / subdivide, ghostGain);
  }

  return { samples: out, trueBeatsMs };
}

const noveltyOf = (spec: TrackSpec) => {
  const { samples, trueBeatsMs } = synthTrack(spec);
  return { novelty: computeNovelty(samples), trueBeatsMs };
};

/** |actual - expected| as a percentage of expected. */
const errPct = (actual: number, expected: number) =>
  (Math.abs(actual - expected) / expected) * 100;

/* ── The fixtures themselves ────────────────────────────────────── */

describe('the synthetic fixtures', () => {
  it('put their hits where they say they do', () => {
    /*
      If the generator is wrong, every tempo assertion below is testing
      the generator. Cross-check it against the onset detector — which is
      a different piece of code from the tempo estimator — and require
      that a plain grid produces onsets on the beats it was built from.
    */
    const { novelty, trueBeatsMs } = noveltyOf({ bpm: 120, seconds: 12 });
    const onsets = pickOnsets(novelty, FRAME_MS).map((f) => f * FRAME_MS);
    expect(onsets.length).toBeGreaterThan(trueBeatsMs.length * 0.8);
    for (const o of onsets) {
      const nearest = Math.min(...trueBeatsMs.map((b) => Math.abs(b - o)));
      expect(nearest, `onset at ${o.toFixed(0)}ms is on no beat`).toBeLessThan(2 * FRAME_MS);
    }
  });

  it('the novelty curve is normalised and non-negative', () => {
    const { novelty } = noveltyOf({ bpm: 128, seconds: 6 });
    let max = 0;
    for (const v of novelty) {
      expect(v).toBeGreaterThanOrEqual(0);
      if (v > max) max = v;
    }
    expect(max).toBeCloseTo(1, 6);
  });

  it('computeNovelty rectifies: a decay produces no onset', () => {
    // Only rises count. A signal that only ever falls must be flat here,
    // otherwise every note tail reads as a new hit.
    const n = TARGET_RATE * 2;
    const decaying = new Float32Array(n);
    for (let i = 0; i < n; i++) decaying[i] = Math.exp(-i / (n / 4)) * Math.sin(i * 0.1);
    const novelty = computeNovelty(decaying);
    for (const v of novelty) expect(v).toBeLessThan(1e-3);
  });
});

/* ── The tempo prior ────────────────────────────────────────────── */

describe('tempoPrior', () => {
  it('peaks at the centre tempo', () => {
    expect(tempoPrior(125)).toBeCloseTo(1, 12);
    expect(tempoPrior(90)).toBeLessThan(1);
    expect(tempoPrior(180)).toBeLessThan(1);
  });

  it('penalises half-time exactly as hard as double-time', () => {
    /*
      The whole point of a LOG-normal prior, and the property that keeps
      autocorrelation from always preferring the subdivision: it must be
      symmetric in octaves, not in BPM. A plain gaussian on BPM would
      make 62.5 far cheaper than 250 and the octave choice would be
      decided by the shape of the prior instead of by the audio.

      Symmetric about the CENTRE, not about an arbitrary tempo — the
      first version of this test asserted prior(bpm*2) == prior(bpm/2)
      for any bpm, which is only true at 125 and says nothing about the
      prior's shape. That was the test being wrong, not the prior.
    */
    for (const k of [1.2, 1.5, 2, 3, 4]) {
      expect(tempoPrior(125 * k)).toBeCloseTo(tempoPrior(125 / k), 12);
    }
    /*
      Negative control: equal DIFFERENCES in BPM are not equally
      penalised. 185 and 65 are both 60 BPM from the centre; a prior that
      is linear in BPM would score them the same, and this one must not.
    */
    expect(tempoPrior(185)).not.toBeCloseTo(tempoPrior(65), 3);
  });

  it('falls off monotonically in both directions from the centre', () => {
    let prev = tempoPrior(125);
    for (let bpm = 126; bpm <= 260; bpm += 2) {
      const v = tempoPrior(bpm);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
    prev = tempoPrior(125);
    for (let bpm = 124; bpm >= 40; bpm -= 2) {
      const v = tempoPrior(bpm);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });
});

/* ── The tempo estimator ────────────────────────────────────────── */

describe('estimateBpm', () => {
  const TOL_PCT = 3;

  it('reads a plain grid at the tempo it was built at', () => {
    for (const bpm of [90, 100, 120, 128, 140, 174]) {
      const { novelty } = noveltyOf({ bpm, seconds: 14, seed: 900 + bpm });
      const got = estimateBpm(novelty, FRAME_MS);
      expect(errPct(got, bpm), `plain ${bpm} -> ${got.toFixed(2)}`).toBeLessThan(TOL_PCT);
    }
  });

  it('does not lock onto the subdivision when there are ghost notes', () => {
    /*
      The failure this estimator was rewritten for. Eighth-note ghosts on
      a 90 BPM bed give the autocorrelation a genuine, denser periodicity
      at 180 — which is inside the search range, so nothing but the
      evidence and the prior stops it winning. The old scorer divided by
      sqrt(period), which actively rewarded the shorter one.
    */
    for (const bpm of [90, 95] as const) {
      const { novelty } = noveltyOf({ bpm, seconds: 14, subdivide: 2, ghostGain: 0.45 });
      const got = estimateBpm(novelty, FRAME_MS);
      expect(errPct(got, bpm), `eighths ${bpm} -> ${got.toFixed(2)}`).toBeLessThan(TOL_PCT);
      expect(errPct(got, bpm * 2), `locked onto the eighths at ${got.toFixed(2)}`)
        .toBeGreaterThan(TOL_PCT);
    }
  });

  it('survives sixteenth-note ghosts, the pattern that used to read 186', () => {
    for (const bpm of [100, 120] as const) {
      const { novelty } = noveltyOf({ bpm, seconds: 14, subdivide: 4, ghostGain: 0.35 });
      const got = estimateBpm(novelty, FRAME_MS);
      expect(errPct(got, bpm), `sixteenths ${bpm} -> ${got.toFixed(2)}`).toBeLessThan(TOL_PCT);
    }
  });

  it('is not thrown by a downbeat that is not at time zero', () => {
    const { novelty } = noveltyOf({ bpm: 128, seconds: 14, phaseMs: 371, subdivide: 2 });
    expect(errPct(estimateBpm(novelty, FRAME_MS), 128)).toBeLessThan(TOL_PCT);
  });

  it('the 3% tolerance actually discriminates', () => {
    /*
      A threshold nobody has tried to fail is not a threshold. The same
      assertion, pointed at a tempo the fixture was NOT built from, must
      fail — including at the neighbouring octave, which is the specific
      wrong answer this module used to give.
    */
    const { novelty } = noveltyOf({ bpm: 90, seconds: 14, subdivide: 2 });
    const got = estimateBpm(novelty, FRAME_MS);
    expect(errPct(got, 90)).toBeLessThan(TOL_PCT);
    for (const wrong of [45, 120, 128, 180]) {
      expect(errPct(got, wrong), `3% cannot tell 90 from ${wrong}`).toBeGreaterThan(TOL_PCT);
    }
  });

  it('resolves finer than the 23ms frame grid', () => {
    /*
      Whole-frame lags near 120 BPM can only represent 123.0 and 117.4.
      Landing inside 1% of 120 is only possible with the sub-frame
      parabolic fit, so this asserts that the fit is present and pointing
      the right way — a compounding ~200ms grid drift over 8s otherwise.
    */
    const { novelty } = noveltyOf({ bpm: 120, seconds: 20, seed: 77 });
    const got = estimateBpm(novelty, FRAME_MS);
    expect(errPct(got, 120), `${got.toFixed(3)} BPM`).toBeLessThan(1);
    // And the two representable whole-frame tempos are further out than
    // that, so the assertion could not pass without the interpolation.
    expect(errPct(60000 / (21 * FRAME_MS), 120)).toBeGreaterThan(1);
    expect(errPct(60000 / (22 * FRAME_MS), 120)).toBeGreaterThan(1);
  });

  it('never returns anything outside its own search range', () => {
    // Including for inputs it cannot read: silence, a single hit, a
    // curve too short for even one lag.
    const cases: Float32Array[] = [
      new Float32Array(500),
      computeNovelty(new Float32Array(TARGET_RATE * 5)),
      noveltyOf({ bpm: 240, seconds: 8 }).novelty,
      noveltyOf({ bpm: 50, seconds: 20 }).novelty,
      new Float32Array(4),
      new Float32Array(0),
    ];
    for (const novelty of cases) {
      const got = estimateBpm(novelty, FRAME_MS);
      expect(Number.isFinite(got)).toBe(true);
      expect(got).toBeGreaterThanOrEqual(70);
      expect(got).toBeLessThanOrEqual(190);
    }
  });

  it('falls back to the centre tempo when there is no room to correlate', () => {
    // maxLag <= minLag. Silence is not evidence for 125, but a finite
    // number the caller can display beats a NaN on the ruler.
    expect(estimateBpm(new Float32Array(4), FRAME_MS)).toBe(125);
  });
});

/* ── Onset picking ──────────────────────────────────────────────── */

describe('pickOnsets', () => {
  it('honours the 90ms minimum gap', () => {
    // Two hits inside one 90ms window are one hit. Without this, a
    // flam or a snare buzz multiplies into a burst of false onsets.
    const { novelty } = noveltyOf({ bpm: 174, seconds: 10, subdivide: 4 });
    const onsets = pickOnsets(novelty, FRAME_MS);
    for (let i = 1; i < onsets.length; i++) {
      expect((onsets[i] - onsets[i - 1]) * FRAME_MS).toBeGreaterThanOrEqual(90 - FRAME_MS);
    }
  });

  it('finds nothing in silence', () => {
    // Safe only because `computeNovelty` skips the normalise step when
    // the maximum rise is 0 — see the next test for what happens when
    // the maximum rise is merely tiny.
    expect(pickOnsets(computeNovelty(new Float32Array(TARGET_RATE * 5)), FRAME_MS)).toEqual([]);
  });

  it('FIXED: a steady tone with no transients yields no onsets at all', () => {
    /*
      Not an endorsement — a finding, written down so it is not
      rediscovered.

      `computeNovelty` divides the whole curve by its own maximum and has
      no absolute floor. A 440Hz sine has a per-frame RMS ripple of about
      1.5% of its level, purely from frames not containing a whole number
      of cycles. Normalising turns that ripple into a full-scale novelty
      curve, and `pickOnsets` — whose thresholds are all relative to that
      normalised curve — then returns onsets at close to the rate its
      90ms minimum gap allows: 36 of them in five seconds of a signal
      with no transients in it at all.

      Silence escapes because max === 0 short-circuits the divide, so the
      failure is specific to quiet-but-not-silent sustained material: a
      pad, a drone, room tone, a long reverb tail. On such a bed the
      markers would be noise while `beatsAnchored` reported them as
      solidly anchored, which is exactly the shape of "reports success
      and does nothing" this repo keeps finding.

      FIXED by `NOVELTY_FLOOR_RATIO`: the largest rise must be at least
      8% of the track's mean frame energy before the curve is normalised
      at all. Below that the curve is emitted flat and the caller sees
      zero onsets, and `detectBeats` reports `percussive: false`.

      The check below is kept in the shape it was written in, so the
      thing that used to be true is visible next to the thing that is
      true now. The two assertions at the end are inverted; the
      measurement above them is unchanged and still passes, which is what
      says the fixture still contains what it always did.
    */
    const tone = new Float32Array(TARGET_RATE * 5);
    for (let i = 0; i < tone.length; i++) tone[i] = Math.sin((i / TARGET_RATE) * 2 * Math.PI * 440);

    // The raw rise really is negligible before normalisation…
    const frames = Math.floor(tone.length / HOP_SIZE);
    const energy = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      for (let i = 0; i < HOP_SIZE; i++) {
        const v = tone[f * HOP_SIZE + i];
        sum += v * v;
      }
      energy[f] = Math.sqrt(sum / HOP_SIZE);
    }
    let rawMax = 0;
    for (let f = 1; f < frames; f++) rawMax = Math.max(rawMax, energy[f] - energy[f - 1]);
    expect(rawMax / energy[10]).toBeLessThan(0.02);

    // …and the floor now refuses to stretch it. Flat curve, no onsets.
    const novelty = computeNovelty(tone);
    expect(Math.max(...novelty)).toBe(0);
    expect(pickOnsets(novelty, FRAME_MS)).toHaveLength(0);
  });

  it('the floor does not silence real percussion, however quiet', () => {
    /*
      The negative control, and the reason the floor is a RATIO against
      the track's own mean energy rather than an absolute amplitude.

      A threshold that only proves "a drone yields nothing" is half a
      test: setting the floor to infinity would pass it and would break
      every real track. So the same fixture is measured at full level and
      at 1/50th of it, and both must still resolve their tempo — a quiet
      passage with real transients has rises that are a large fraction of
      ITS level, which is exactly the property being relied on.
    */
    const { samples } = synthTrack({ bpm: 120, seconds: 6, phaseMs: 300, bedGain: 0.05 });

    for (const gain of [1, 0.02]) {
      const scaled = new Float32Array(samples.length);
      for (let i = 0; i < samples.length; i++) scaled[i] = samples[i] * gain;

      const novelty = computeNovelty(scaled);
      expect(pickOnsets(novelty, FRAME_MS).length).toBeGreaterThan(8);
      expect(errPct(estimateBpm(novelty, FRAME_MS), 120)).toBeLessThan(3);
    }
  });

  it('prefers the strong hits over the ghosts it sits between', () => {
    /*
      Not an absolute claim — the detector does pick up loud-enough
      ghosts. What must hold is that the beats are found at all, since
      the grid is anchored to whatever this returns.
    */
    const { novelty, trueBeatsMs } = noveltyOf({
      bpm: 100,
      seconds: 12,
      subdivide: 2,
      ghostGain: 0.4,
    });
    const onsetMs = pickOnsets(novelty, FRAME_MS).map((f) => f * FRAME_MS);
    const found = trueBeatsMs.filter((b) =>
      onsetMs.some((o) => Math.abs(o - b) <= 1.5 * FRAME_MS)
    );
    expect(found.length / trueBeatsMs.length).toBeGreaterThan(0.85);
  });
});

/* ── The beat grid ──────────────────────────────────────────────── */

/** Mean distance from each true beat to the nearest emitted marker. */
function meanBeatError(beatsMs: number[], trueBeatsMs: number[]): number {
  if (beatsMs.length === 0) return Infinity;
  const errs = trueBeatsMs.map((b) => Math.min(...beatsMs.map((x) => Math.abs(x - b))));
  return errs.reduce((a, b) => a + b, 0) / errs.length;
}

describe('buildBeatGrid', () => {
  const gridFor = (spec: TrackSpec, bpmOverride?: number) => {
    const { novelty, trueBeatsMs } = noveltyOf(spec);
    const bpm = bpmOverride ?? estimateBpm(novelty, FRAME_MS);
    const onsets = pickOnsets(novelty, FRAME_MS);
    const grid = buildBeatGrid(onsets, bpm, FRAME_MS, novelty.length, novelty);
    return { ...grid, trueBeatsMs, bpm, novelty };
  };

  /*
    Every grid fixture below puts its downbeat at 300ms rather than at
    zero, and that is load-bearing rather than cosmetic.

    `computeNovelty` is a FIRST DIFFERENCE, so a transient starting at
    sample 0 has no earlier frame to rise from and produces no novelty at
    all. A fixture whose downbeat is at t=0 therefore hides its own first
    beat from the detector, the phase search settles one period late, and
    the orphaned beat alone pushes the mean error from 11ms to 28ms —
    which reads exactly like a broken anchor and is not one. Real audio
    has the same blind spot (recorded below), and real audio essentially
    never starts a kick on sample 0.
  */
  const DOWNBEAT_MS = 300;

  it('lands its markers on the beats the track was built from', () => {
    const { beats, trueBeatsMs } = gridFor({ bpm: 120, seconds: 14, phaseMs: DOWNBEAT_MS });
    expect(beats.length).toBeGreaterThan(trueBeatsMs.length * 0.9);
    const err = meanBeatError(beats, trueBeatsMs);
    expect(err, `${err.toFixed(1)}ms adrift`).toBeLessThan(FRAME_MS);
  });

  it('RECORDED: a transient on sample 0 is invisible to the novelty curve', () => {
    /*
      The blind spot named above, asserted so it stays known. `novelty[0]`
      is never written and `novelty[1]` sees the hit DECAYING, so a beat
      at time zero contributes nothing. Harmless in practice — it costs
      one marker at the very head of a file — but it is why the fixtures
      here are phased, and it would be a real bug if the grid were ever
      used to trim a clip's head.
    */
    const { novelty } = noveltyOf({ bpm: 120, seconds: 6, phaseMs: 0 });
    expect(novelty[0]).toBe(0);
    expect(novelty[1]).toBe(0);
    const firstOnsetMs = pickOnsets(novelty, FRAME_MS)[0] * FRAME_MS;
    expect(firstOnsetMs).toBeGreaterThan(400); // the SECOND beat, not the first
  });

  it('does not inherit the phase of a stray transient before bar one', () => {
    /*
      The exact failure from the brand-film bed: it opens with 209ms of
      riser noise, phase used to come from the FIRST onset, and every
      beat in the piece was 209ms late. Phase now comes from whichever
      offset collects the most onset energy across the whole track, so a
      single early transient cannot move it.
    */
    const spec: TrackSpec = {
      bpm: 120,
      seconds: 16,
      phaseMs: 500,
      leadInMs: 209,
      leadInGain: 1.1,
    };
    const { beats, trueBeatsMs } = gridFor(spec);
    const err = meanBeatError(beats, trueBeatsMs);
    expect(err, `${err.toFixed(1)}ms adrift`).toBeLessThan(FRAME_MS);

    // Negative control: the metric is capable of showing 209ms of drift.
    // Shift every marker by the lead-in and it must blow the threshold.
    const shifted = beats.map((b) => b - 209);
    expect(meanBeatError(shifted, trueBeatsMs)).toBeGreaterThan(FRAME_MS * 4);
  });

  it('is not dragged onto ghost notes sitting near the beat', () => {
    /*
      Snapping to the NEAREST onset put beats on hats and pickups. It now
      takes the STRONGEST onset within an eighth of a beat, and only if
      it is at least 0.6x the typical on-grid onset.
    */
    const { beats, trueBeatsMs } = gridFor({
      bpm: 100,
      seconds: 16,
      subdivide: 4,
      ghostGain: 0.4,
      phaseMs: DOWNBEAT_MS,
    });
    const err = meanBeatError(beats, trueBeatsMs);
    expect(err, `${err.toFixed(1)}ms adrift`).toBeLessThan(FRAME_MS);
    // A marker parked on a sixteenth would be 150ms out at 100 BPM, so
    // the threshold above is well inside what that failure would cost.
    expect(err).toBeLessThan(150 / 4);
  });

  it('reports how many markers are real onsets rather than grid fill', () => {
    // `beatsAnchored` is the caller's only way to know whether the
    // markers describe the music or just the tempo estimate. On a track
    // built entirely of clean hits it should be most of them.
    const { beats, anchored } = gridFor({ bpm: 120, seconds: 14, phaseMs: DOWNBEAT_MS });
    expect(anchored).toBeGreaterThan(beats.length * 0.75);
    expect(anchored).toBeLessThanOrEqual(beats.length);
  });

  it('keeps the grid position where the detector missed a beat entirely', () => {
    // No onsets at all: every marker is grid fill, none anchored, and
    // the spacing is exactly the period. Silence must not produce an
    // empty ruler, because the tempo is still a usable answer.
    const frames = 400;
    const { beats, anchored } = buildBeatGrid([], 120, FRAME_MS, frames, new Float32Array(frames));
    expect(anchored).toBe(0);
    expect(beats.length).toBeGreaterThan(10);
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i] - beats[i - 1]).toBeCloseTo(500, 0);
    }
  });

  it('emits an empty grid rather than looping forever on a nonsense tempo', () => {
    const novelty = new Float32Array(200);
    expect(buildBeatGrid([], 0, FRAME_MS, 200, novelty)).toEqual({ beats: [], anchored: 0 });
    expect(buildBeatGrid([], -30, FRAME_MS, 200, novelty)).toEqual({ beats: [], anchored: 0 });
    expect(buildBeatGrid([], 120, FRAME_MS, 0, novelty)).toEqual({ beats: [], anchored: 0 });
  });

  it('markers stay inside the audio', () => {
    const { beats, novelty } = gridFor({ bpm: 140, seconds: 10, phaseMs: DOWNBEAT_MS });
    const durationMs = novelty.length * FRAME_MS;
    for (const b of beats) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(durationMs);
    }
  });
});

/* ── nearestBeat ────────────────────────────────────────────────── */

describe('nearestBeat', () => {
  const beats = [0, 500, 1000, 1500, 2000];

  it('returns the closer of two neighbours', () => {
    expect(nearestBeat(beats, 600)).toBe(500);
    expect(nearestBeat(beats, 900)).toBe(1000);
    expect(nearestBeat(beats, 1000)).toBe(1000);
  });

  it('is inclusive at the tolerance and null one past it', () => {
    // The boundary is the contract: a cut 250ms from a beat snaps, 251
    // does not. Exercised on both sides of the beat.
    expect(nearestBeat(beats, 1250)).toBe(1000);
    expect(nearestBeat(beats, 1250, 250)).toBe(1000);
    expect(nearestBeat([0, 1000], 1251, 250)).toBeNull();
    expect(nearestBeat([0, 1000], 749, 250)).toBeNull();
    expect(nearestBeat([0, 1000], 750, 250)).toBe(1000);
  });

  it('returns null for an empty beat list', () => {
    expect(nearestBeat([], 400)).toBeNull();
    expect(nearestBeat([], 0)).toBeNull();
  });

  it('handles unsorted beats and negative times', () => {
    expect(nearestBeat([2000, 0, 1000], 1100)).toBe(1000);
    expect(nearestBeat([0, 500], -100, 250)).toBe(0);
    expect(nearestBeat([0, 500], -400, 250)).toBeNull();
  });
});
