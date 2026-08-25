/* ═══════════════════════════════════════════════════════════════════
   Beat detection — decode an audio file, find onsets, estimate tempo.

   Approach: spectral-flux-ish energy novelty on a downsampled mono
   signal, adaptive-threshold peak picking, then autocorrelation over the
   inter-onset intervals to lock a tempo and quantise the grid.
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

const HOP_SIZE = 512;
const TARGET_RATE = 22050;

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
function computeNovelty(samples: Float32Array): Float32Array {
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
function pickOnsets(novelty: Float32Array, frameMs: number): number[] {
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

/** Autocorrelate the onset train to find the dominant beat period. */
function estimateBpm(onsetFrames: number[], frameMs: number): number {
  if (onsetFrames.length < 4) return 120;

  const MIN_BPM = 70;
  const MAX_BPM = 190;
  const minPeriod = Math.round(60000 / MAX_BPM / frameMs);
  const maxPeriod = Math.round(60000 / MIN_BPM / frameMs);

  const onsetSet = new Set(onsetFrames);
  let bestPeriod = minPeriod;
  let bestScore = -1;

  for (let period = minPeriod; period <= maxPeriod; period++) {
    let score = 0;
    for (const f of onsetFrames) {
      // Allow ±1 frame of slop when matching the next expected beat.
      if (onsetSet.has(f + period) || onsetSet.has(f + period - 1) || onsetSet.has(f + period + 1)) {
        score++;
      }
    }
    // Normalise so slow tempos aren't unfairly favoured by having fewer beats.
    const normalised = score / Math.sqrt(period);
    if (normalised > bestScore) {
      bestScore = normalised;
      bestPeriod = period;
    }
  }

  /*
    `bestPeriod` is a whole number of analysis frames, and a frame is
    23.2ms — so the representable tempos near 120 BPM are 123.0 and
    117.4, and there is no 120. A 120 BPM click track measured 123, and
    because the grid below was generated from that number the error
    scaled: ~200ms adrift after 8 seconds, and over four seconds adrift
    across a three-minute song.

    Refine over a LONG baseline instead. The first and last onset each
    carry at most half a frame of error, so dividing their separation by
    the number of periods between them divides that error by the beat
    count — 15 periods turns +-11.6ms into +-0.8ms.
  */
  const refined = refinePeriod(onsetFrames, bestPeriod);
  const bpm = 60000 / (refined * frameMs);
  return Math.max(MIN_BPM, Math.min(MAX_BPM, bpm));
}

/** Sub-frame beat period, measured across the whole detected span. */
function refinePeriod(onsetFrames: number[], coarsePeriod: number): number {
  if (onsetFrames.length < 2 || coarsePeriod <= 0) return coarsePeriod;

  const first = onsetFrames[0];
  const last = onsetFrames[onsetFrames.length - 1];
  const span = last - first;
  if (span <= 0) return coarsePeriod;

  const periods = Math.round(span / coarsePeriod);
  if (periods < 1) return coarsePeriod;

  const refined = span / periods;
  // Reject a refinement that disagrees wildly — that means the coarse
  // estimate was on the wrong multiple, not slightly off.
  return Math.abs(refined - coarsePeriod) > coarsePeriod * 0.25 ? coarsePeriod : refined;
}

/** Lay a regular grid at `bpm`, phase-aligned to the strongest early onset. */
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
 */
function buildBeatGrid(
  onsetFrames: number[],
  bpm: number,
  frameMs: number,
  totalFrames: number
): { beats: number[]; anchored: number } {
  const periodFrames = 60000 / bpm / frameMs;
  if (periodFrames <= 0) return { beats: [], anchored: 0 };

  // Within a quarter of a beat is the same beat; further away it is a
  // different one, and snapping to it would be worse than the grid.
  const tolerance = periodFrames / 4;
  const onsets = [...onsetFrames].sort((a, b) => a - b);

  const beats: number[] = [];
  let anchored = 0;
  let cursor = onsets.length > 0 ? onsets[0] : 0;

  for (let expected = cursor; expected < totalFrames; expected += periodFrames) {
    let best: number | null = null;
    let bestDistance = tolerance;

    for (const onset of onsets) {
      const distance = Math.abs(onset - expected);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = onset;
      }
      // Onsets are sorted, so nothing further along can be closer.
      if (onset > expected + tolerance) break;
    }

    if (best !== null) anchored++;
    beats.push(Math.round((best ?? expected) * frameMs));
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
  const bpm = estimateBpm(onsetFrames, frameMs);
  const grid = buildBeatGrid(onsetFrames, bpm, frameMs, novelty.length);

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
