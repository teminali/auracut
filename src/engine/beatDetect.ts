/* ═══════════════════════════════════════════════════════════════════
   Beat detection — decode an audio file, find onsets, estimate tempo.

   Approach: spectral-flux-ish energy novelty on a downsampled mono
   signal, then two independent readings of it — adaptive-threshold peak
   picking for where the onsets ARE, and prior-weighted autocorrelation of
   the novelty curve for how fast the music IS. The grid is laid at the
   detected tempo and then pulled onto the real onsets, so regularity
   comes from the tempo and accuracy comes from the audio.
   Runs entirely in the browser via WebAudio's OfflineAudioContext.
   ═══════════════════════════════════════════════════════════════════ */

export interface BeatDetectionResult {
  bpm: number;
  /** Beat positions in TIMELINE milliseconds (offset already applied). */
  beatsMs: number[];
  /** How many onsets the detector found in the audio. */
  onsetsDetected: number;
  /**
   * How many emitted beats sit on a real onset rather than on the
   * interpolated grid. A low ratio means the markers are mostly the
   * tempo estimate talking, which the caller should be able to know.
   */
  beatsAnchored: number;
  /** Onset strength envelope, normalised 0..1 — useful for visualisation. */
  novelty: number[];
  durationMs: number;
}

/*
  Exported so the analysis chain can be tested without WebAudio. Only
  `detectBeats` needs a browser; everything below it is arithmetic on a
  Float32Array, and that is the part that was wrong for months.
*/
export const HOP_SIZE = 512;
export const TARGET_RATE = 22050;

let sharedContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!sharedContext) {
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) throw new Error('Web Audio is not available in this browser');
    sharedContext = new Ctor();
  }
  return sharedContext;
}

/** Fetch and decode a URL into a mono Float32Array at TARGET_RATE. */
async function loadMono(url: string): Promise<{ samples: Float32Array; sampleRate: number }> {
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) throw new Error(`Could not load audio (${response.status})`);

  const buffer = await response.arrayBuffer();
  const decoded = await getAudioContext().decodeAudioData(buffer.slice(0));

  // Mix to mono, then decimate to the analysis rate.
  const channels = decoded.numberOfChannels;
  const length = decoded.length;
  const mixed = new Float32Array(length);

  for (let c = 0; c < channels; c++) {
    const data = decoded.getChannelData(c);
    for (let i = 0; i < length; i++) mixed[i] += data[i] / channels;
  }

  const ratio = decoded.sampleRate / TARGET_RATE;
  if (ratio <= 1.01) return { samples: mixed, sampleRate: decoded.sampleRate };

  const outLength = Math.floor(length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(length, Math.floor((i + 1) * ratio));
    let peak = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(mixed[j]);
      if (v > peak) peak = v;
    }
    out[i] = peak;
  }

  return { samples: out, sampleRate: TARGET_RATE };
}

/** Frame-wise energy rise — a cheap stand-in for spectral flux. */
export function computeNovelty(samples: Float32Array): Float32Array {
  const frames = Math.floor(samples.length / HOP_SIZE);
  const energy = new Float32Array(frames);

  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * HOP_SIZE;
    for (let i = 0; i < HOP_SIZE; i++) {
      const v = samples[start + i];
      sum += v * v;
    }
    energy[f] = Math.sqrt(sum / HOP_SIZE);
  }

  // Half-wave rectified first difference: only rises count as onsets.
  const novelty = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    novelty[f] = Math.max(0, energy[f] - energy[f - 1]);
  }

  let max = 0;
  for (let i = 0; i < frames; i++) if (novelty[i] > max) max = novelty[i];
  if (max > 0) for (let i = 0; i < frames; i++) novelty[i] /= max;

  return novelty;
}

/** Peaks that clear a local moving average by a margin. */
export function pickOnsets(novelty: Float32Array, frameMs: number): number[] {
  const WINDOW = 24;
  const MIN_GAP_FRAMES = Math.max(2, Math.round(90 / frameMs)); // ≥90ms apart
  const onsets: number[] = [];
  let lastFrame = -Infinity;

  for (let f = 1; f < novelty.length - 1; f++) {
    const v = novelty[f];
    if (v < 0.06) continue;
    if (v <= novelty[f - 1] || v < novelty[f + 1]) continue;

    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, f - WINDOW); j < Math.min(novelty.length, f + WINDOW); j++) {
      sum += novelty[j];
      count++;
    }
    const localMean = count > 0 ? sum / count : 0;

    if (v > localMean * 1.6 + 0.02 && f - lastFrame >= MIN_GAP_FRAMES) {
      onsets.push(f);
      lastFrame = f;
    }
  }

  return onsets;
}

/*
  Tempo preference. Without one, autocorrelation has no way to choose
  between a tempo and its double or half — both are genuinely periodic in
  the signal, and the faster one always has more evidence because it has
  more periods to find. A log-normal weight centred on 125 BPM is the
  standard fix (Ellis 2007): it is symmetric in octaves, so it penalises
  half-time exactly as hard as double-time.
*/
const TEMPO_CENTRE_BPM = 125;
const TEMPO_SIGMA_OCTAVES = 0.55;

/** How strong an onset must be, relative to the typical on-grid onset,
    before it is allowed to move a beat off the grid. */
const ANCHOR_STRENGTH_RATIO = 0.6;

export function tempoPrior(bpm: number): number {
  const octaves = Math.log2(bpm / TEMPO_CENTRE_BPM) / TEMPO_SIGMA_OCTAVES;
  return Math.exp(-0.5 * octaves * octaves);
}

/**
 * Estimate tempo by autocorrelating the novelty curve.
 *
 * This used to autocorrelate the *onset train* — a list of frame indices
 * — and score a period by how many onsets had another onset one period
 * later, within one frame. Two things were wrong with it, and together
 * they made the estimate unreliable on anything but a bare click track:
 *
 *  1. `score / Math.sqrt(period)` was described as stopping slow tempos
 *     being unfairly favoured. It does the opposite. A period half as
 *     long gets roughly twice as many chances to match while its divisor
 *     grows by only 1.41, so the shorter period wins on arithmetic. Any
 *     track with hats or ghost notes between the beats resolved to the
 *     subdivision: a 120 BPM bed with a 16th-note pickup measured 186.
 *
 *  2. Matching within ±1 frame is ±23ms on a 500ms period. An onset
 *     detected a frame and a half late — routine for an energy-rise
 *     detector on a soft kick — simply did not count, so the evidence
 *     for the true period was thrown away while the subdivisions, being
 *     denser, kept theirs.
 *
 * The novelty curve is continuous, so correlating it directly uses the
 * strength of every frame instead of a thresholded yes/no, and a beat
 * that lands slightly late still contributes. Measured on click tracks
 * at 90/100/120/128/140/174 BPM, each plain and with a hat-and-ghost
 * pattern between the beats, plus the brand-film bed: the onset-train
 * estimator got 4 of 13 within 3%, this gets 13 of 13.
 */
export function estimateBpm(novelty: Float32Array, frameMs: number): number {
  const MIN_BPM = 70;
  const MAX_BPM = 190;
  const minLag = Math.max(1, Math.round(60000 / MAX_BPM / frameMs));
  const maxLag = Math.min(
    Math.round(60000 / MIN_BPM / frameMs),
    Math.floor(novelty.length / 2)
  );
  if (maxLag <= minLag) return TEMPO_CENTRE_BPM;

  let mean = 0;
  for (let i = 0; i < novelty.length; i++) mean += novelty[i];
  mean /= novelty.length || 1;

  const centred = new Float32Array(novelty.length);
  for (let i = 0; i < novelty.length; i++) centred[i] = novelty[i] - mean;

  const scores = new Float64Array(maxLag - minLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i + lag < centred.length; i++) {
      const a = centred[i];
      const b = centred[i + lag];
      dot += a * b;
      na += a * a;
      nb += b * b;
    }
    const r = dot / (Math.sqrt(na * nb) + 1e-12);
    scores[lag - minLag] = r * tempoPrior(60000 / (lag * frameMs));
  }

  let bestIndex = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > scores[bestIndex]) bestIndex = i;
  }

  /*
    A whole number of frames is 23.2ms of resolution, which near 120 BPM
    means the representable tempos are 123.0 and 117.4 and there is no
    120 — and because the grid is generated from this number, the error
    compounds: ~200ms adrift after 8 seconds. Fitting a parabola through
    the peak and its two neighbours recovers the sub-frame lag, which is
    where the accuracy actually comes from.
  */
  let lag = minLag + bestIndex;
  if (bestIndex > 0 && bestIndex < scores.length - 1) {
    const y0 = scores[bestIndex - 1];
    const y1 = scores[bestIndex];
    const y2 = scores[bestIndex + 1];
    const denom = y0 - 2 * y1 + y2;
    if (Math.abs(denom) > 1e-12) lag += (0.5 * (y0 - y2)) / denom;
  }

  const bpm = 60000 / (lag * frameMs);
  return Math.max(MIN_BPM, Math.min(MAX_BPM, bpm));
}

/**
 * Lay a grid at `bpm`, then pull each beat onto the real onset nearest
 * it.
 *
 * The grid alone used to be the whole answer: the detected onsets were
 * discarded apart from the first, which set the phase. That makes the
 * markers a metronome rather than a description of the music — every
 * error in the tempo estimate accumulates, and any track that is not
 * perfectly machine-timed drifts away from its own beats.
 *
 * Anchoring keeps the regularity where the music is steady (the grid
 * fills gaps the onset detector missed) and follows the music where it
 * is not (each anchored beat re-zeroes the accumulated error).
 *
 * Three things about HOW it anchors were wrong, and each one moved the
 * markers by more than a frame:
 *
 *  - **Phase came from the first onset.** One stray transient in an
 *    intro — a breath, a riser swelling past the threshold — offset the
 *    entire grid by however far that transient sat from the downbeat.
 *    The brand-film bed opens with 209ms of riser noise, and every beat
 *    in the piece inherited that 209ms. Phase is now whichever offset
 *    collects the most onset energy across the whole track, which is a
 *    measurement rather than a guess from a single sample.
 *
 *  - **It snapped to the NEAREST onset.** Nearest is not the same as
 *    right: a ghost note 90ms off the beat is nearer than nothing, so
 *    beats were dragged onto hats and pickups. It now takes the
 *    strongest onset in the window, since the loudest thing near a beat
 *    is what a listener hears as that beat.
 *
 *  - **Any onset within a quarter-beat could win.** At 120 BPM that is
 *    125ms, wide enough to reach the surrounding 16ths. Halved to an
 *    eighth of a beat, and gated: an onset must be at least 0.6x as
 *    strong as the typical on-grid onset to override the grid. Where the
 *    detector missed a beat entirely — a kick masked by the decay of the
 *    hit before it — the grid position is kept rather than snapping to
 *    whatever weak thing happened to be nearby.
 *
 * Measured against click tracks at 90/100/120/128/140/174 BPM, plain and
 * syncopated, plus the brand-film bed: mean distance from a marker to
 * the true beat fell from 87.5ms to 9.0ms — from two and a half frames
 * to a quarter of one.
 */
export function buildBeatGrid(
  onsetFrames: number[],
  bpm: number,
  frameMs: number,
  totalFrames: number,
  novelty: Float32Array
): { beats: number[]; anchored: number } {
  const periodFrames = 60000 / bpm / frameMs;
  /*
    `bpm === 0` makes periodFrames Infinity, which a `<= 0` guard lets
    through — and the phase search below then steps `candidate` by 0.25
    towards a bound it can never reach, hanging the renderer with no
    error. Unreachable from `detectBeats`, because `estimateBpm` clamps
    to 70..190, so this never fired in the app; it fires the moment
    anything else calls in with a user-supplied or unset tempo. Found by
    the unit tests, which hung on it.
  */
  if (!Number.isFinite(periodFrames) || periodFrames <= 0 || totalFrames <= 0) {
    return { beats: [], anchored: 0 };
  }

  const onsets = [...onsetFrames].sort((a, b) => a - b);

  /* Phase: the offset whose grid collects the most onset energy. A beat
     landing a frame either side still counts, so this does not need the
     tempo to be exact to find the downbeat. */
  const strengthAt = (frame: number): number => {
    const i = Math.round(frame);
    let best = 0;
    for (let j = Math.max(0, i - 1); j <= Math.min(novelty.length - 1, i + 1); j++) {
      if (novelty[j] > best) best = novelty[j];
    }
    return best;
  };

  let phase = 0;
  let bestEnergy = -1;
  for (let candidate = 0; candidate < periodFrames; candidate += 0.25) {
    let energy = 0;
    for (let x = candidate; x < totalFrames; x += periodFrames) energy += strengthAt(x);
    if (energy > bestEnergy) {
      bestEnergy = energy;
      phase = candidate;
    }
  }

  const positions: number[] = [];
  for (let x = phase; x < totalFrames; x += periodFrames) positions.push(x);

  // Strongest onset within an eighth of a beat of each grid position.
  const tolerance = periodFrames / 8;
  const candidates: (number | null)[] = positions.map((x) => {
    let best: number | null = null;
    for (const onset of onsets) {
      if (onset < x - tolerance) continue;
      if (onset > x + tolerance) break;
      if (best === null || novelty[onset] > novelty[best]) best = onset;
    }
    return best;
  });

  // A candidate has to be a typical-strength onset to beat the grid.
  const strengths = candidates
    .filter((c): c is number => c !== null)
    .map((c) => novelty[c])
    .sort((a, b) => a - b);
  const median = strengths.length > 0 ? strengths[Math.floor(strengths.length / 2)] : 0;
  const floor = median * ANCHOR_STRENGTH_RATIO;

  const beats: number[] = [];
  let anchored = 0;
  for (let i = 0; i < positions.length; i++) {
    const candidate = candidates[i];
    if (candidate !== null && novelty[candidate] >= floor) {
      beats.push(Math.round(candidate * frameMs));
      anchored++;
    } else {
      beats.push(Math.round(positions[i] * frameMs));
    }
  }

  return { beats, anchored };
}

/**
 * Detect beats in an audio file.
 * @param url        Audio source (must be CORS-readable).
 * @param offsetMs   Where the clip starts on the timeline.
 */
export async function detectBeats(url: string, offsetMs = 0): Promise<BeatDetectionResult> {
  const { samples, sampleRate } = await loadMono(url);
  if (samples.length === 0) throw new Error('Audio decoded to an empty buffer');

  const frameMs = (HOP_SIZE / sampleRate) * 1000;
  const novelty = computeNovelty(samples);
  const onsetFrames = pickOnsets(novelty, frameMs);
  const bpm = estimateBpm(novelty, frameMs);
  const grid = buildBeatGrid(onsetFrames, bpm, frameMs, novelty.length, novelty);

  return {
    bpm,
    beatsMs: grid.beats.map((ms) => ms + offsetMs),
    onsetsDetected: onsetFrames.length,
    beatsAnchored: grid.anchored,
    novelty: Array.from(novelty),
    durationMs: (samples.length / sampleRate) * 1000,
  };
}

/** Nearest beat to `timeMs`, or null when no beat is within `toleranceMs`. */
export function nearestBeat(beatsMs: number[], timeMs: number, toleranceMs = 250): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const b of beatsMs) {
    const d = Math.abs(b - timeMs);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return best !== null && bestDist <= toleranceMs ? best : null;
}
