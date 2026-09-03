/* ═══════════════════════════════════════════════════════════════════
   The per-clip audio chain the PREVIEW plays through.

   Why this is a module of its own rather than a few lines inside
   `audioEngine`: it is the half of the audio path that can be measured
   without a sound card. `buildVoiceChain` takes any `BaseAudioContext`,
   so the same graph the preview runs can be rendered by an
   `OfflineAudioContext` over a probe signal and inspected — which is how
   `describe_audio_preview` returns evidence instead of a claim, and how
   `tools/verify_playback_audio.py` checks any of this at all. A
   `MediaElementAudioSourceNode` cannot be rendered offline; a chain that
   only knows about nodes can.

   ── What this is fixing ──────────────────────────────────────────────

   `pitch`, `voiceEffect`, `noiseReduction` and `ducking` are applied by
   the EXPORT filtergraph (`electron/render.ts`, verified on the exported
   waveform by `tools/verify_audio.py`). Playback applied none of them.
   That is a worse failure than the gap it replaced: before, nothing
   applied them and the export said so out loud; after, the render applied
   them and the preview quietly disagreed. You would cut against a
   telephone voice you could not hear.

   Four of the settings are reproducible here and now match the render.
   Four are NOT, and this module names them rather than letting the
   preview imply it played them — see `unpreviewableAudio`. The rule in
   this codebase is that a control which lies is worse than a missing
   feature, and a preview is a control.

   ── Why the other four cannot be done here ───────────────────────────

   `pitch`, and the `deep`/`high` voice effects which are ±5 semitones of
   the same machinery, need pitch moved WITHOUT moving speed. A voice is a
   `MediaElementAudioSourceNode` wrapped around an <audio> element, and
   the only pitch control an element has is `playbackRate`, which moves
   both. Doing it properly needs `AudioBufferSourceNode.detune`, i.e.
   decoding each clip to a buffer — a ten-minute track is ~100MB as raw
   float samples, which is exactly why playback streams from elements in
   the first place. That is a change to the playback architecture, not an
   addition to it.

   `noiseReduction` is ffmpeg's `afftdn`, a spectral subtraction with a
   learned noise profile. WebAudio has no equivalent. A noise gate and a
   high shelf would produce SOMETHING, and it would not be what the render
   produces — which is the failure this module exists to end, not a
   smaller version of it.
   ═══════════════════════════════════════════════════════════════════ */

import { ClipAudioSettings, VoiceEffect } from '../types/edl';

/** A built chain: patch a source into `input`, take the result from `output`. */
export interface VoiceChain {
  input: AudioNode;
  output: AudioNode;
  /** Everything created, so teardown can disconnect all of it. */
  nodes: AudioNode[];
  /** Effects this chain reproduces, e.g. `['telephone']`. */
  applied: string[];
}

/* ── The pitch worklet ─────────────────────────────────────────────

   `addModule` is async and `buildVoiceChain` is not, so the module is
   loaded per context and remembered. A chain built before the module
   lands simply has no pitch node in it — and `pitchReady` is threaded
   through so the caller can SAY that rather than quietly omitting it,
   which is the failure this whole module exists to end.               */

const workletLoaded = new WeakMap<BaseAudioContext, Promise<boolean>>();

export function ensurePitchWorklet(ctx: BaseAudioContext): Promise<boolean> {
  const existing = workletLoaded.get(ctx);
  if (existing) return existing;

  const ctxWithWorklet = ctx as BaseAudioContext & { audioWorklet?: AudioWorklet };
  if (!ctxWithWorklet.audioWorklet) {
    const no = Promise.resolve(false);
    workletLoaded.set(ctx, no);
    return no;
  }

  /*
    `new URL(..., import.meta.url)` is what makes this work in the dev
    server AND in the packaged build: Vite rewrites it to the emitted
    asset's real path either way. A bare relative string resolves against
    the document in dev and against the asar root when packaged, and the
    packaged one is the build nobody runs until it matters.
  */
  const url = new URL('./pitchWorklet.js', import.meta.url).href;
  const loading = ctxWithWorklet
    .audioWorklet!.addModule(url)
    .then(() => true)
    .catch((err: unknown) => {
      // Loud, not silent: without this the preview drops pitch and the
      // only symptom is that it sounds wrong.
      console.error('[TeminaliCut] pitch worklet failed to load; playback cannot pitch-shift', err);
      return false;
    });

  workletLoaded.set(ctx, loading);
  return loading;
}

/**
 * Butterworth, expressed the way WebAudio wants it: DECIBELS.
 *
 * ffmpeg's `highpass`/`lowpass` default to two poles at width_type=q,
 * width=0.707 — a linear quality factor. `BiquadFilterNode.Q` is NOT that
 * for `lowpass` and `highpass`: the Web Audio spec defines it as a
 * resonance in dB, so the filter uses `alpha = sin(w0) / (2 * 10^(Q/20))`.
 *
 * Writing `Q.value = 0.7071` therefore asks for 0.7071 **dB**, which is a
 * linear Q of 1.0854 — a filter with a resonant lift around the corner
 * instead of a flat passband. It looks exactly like the correct line and
 * measures 3.8dB off the render at 3kHz.
 *
 * Caught by comparing the preview against the rendered file rather than
 * against expectations: `verify_playback_audio.py` measured the preview's
 * passband at +4.2dB where ffmpeg's was +0.4dB, and the analytic RBJ
 * response for a linear Q of 1.0854 reproduced the preview to 0.00dB.
 * A check that only asserted "telephone attenuates 100Hz" would have
 * passed on the wrong filter.
 */
const BUTTERWORTH_Q_DB = 20 * Math.log10(Math.SQRT1_2); // -3.0103

/**
 * One setting the preview cannot reproduce, for two different readers.
 *
 * `short` is for the person editing the video: what will differ, and what
 * to do about it. `why` is for whoever might try to fix it, and belongs in
 * the tool output and nowhere near the inspector — an editor reading
 * "an <audio> element only has playbackRate" learns nothing they can act
 * on. Splitting them beats picking one audience and failing the other.
 */
export interface UnpreviewableSetting {
  setting: 'pitch' | 'voiceEffect' | 'noiseReduction';
  short: string;
  why: string;
}

/**
 * Settings the preview graph cannot reproduce.
 *
 * Mirrors `unsupportedAudioSettings` in `exportPipeline`, which does the
 * same job for the render. Both exist because a setting that is stored,
 * listed by `list_properties` and quietly dropped is what an agent
 * reports back to the user as "done".
 */
export function unpreviewableAudio(a: ClipAudioSettings): UnpreviewableSetting[] {
  const out: UnpreviewableSetting[] = [];

  /*
    `pitch`, `deep` and `high` USED to be listed here.

    They are previewed now. The reasoning that put them on this list —
    that moving pitch without moving speed needs
    `AudioBufferSourceNode.detune` and therefore decoding whole clips
    into memory — was true of that technique and not of the problem.
    `pitchWorklet.js` is a granular shifter running in an AudioWorklet:
    it reads a delay line faster or slower than it is written and
    crossfades two heads over the seam, so it processes a streamed
    element exactly as well as a buffer. No decode, no memory budget.
  */
  if (a.noiseReduction) {
    out.push({
      setting: 'noiseReduction',
      short: 'Noise reduction is in the export, not in playback.',
      why:
        "The export runs ffmpeg's afftdn spectral denoise, which has no WebAudio equivalent. " +
        'A gate and a shelf would produce something, and it would not be what the render ' +
        'produces, which is the failure this is here to end, not a smaller version of it.',
    });
  }

  return out;
}

/** True when the render and the preview will differ on this clip. */
export function previewMatchesRender(a: ClipAudioSettings): boolean {
  return unpreviewableAudio(a).length === 0;
}

/**
 * ffmpeg's `aecho=in_gain:out_gain:delays:decays`, as nodes.
 *
 * `af_aecho` writes the INPUT into its delay line, not the output, so the
 * echoes are finite — a tap per delay, no feedback path. Reproducing that
 * shape rather than the more obvious feedback delay is the difference
 * between matching the render and merely sounding echoey:
 *
 *     out = out_gain * ( in_gain*in + Σ decay_j * in(t - delay_j) )
 */
function aecho(
  ctx: BaseAudioContext,
  inGain: number,
  outGain: number,
  delaysMs: number[],
  decays: number[],
  nodes: AudioNode[]
): { input: AudioNode; output: AudioNode } {
  const input = ctx.createGain();
  const sum = ctx.createGain();
  const dry = ctx.createGain();
  const out = ctx.createGain();

  input.gain.value = 1;
  dry.gain.value = inGain;
  sum.gain.value = 1;
  out.gain.value = outGain;

  input.connect(dry);
  dry.connect(sum);

  delaysMs.forEach((ms, j) => {
    const delay = ctx.createDelay(Math.max(1, ms / 1000 + 0.1));
    delay.delayTime.value = ms / 1000;
    const decay = ctx.createGain();
    decay.gain.value = decays[j] ?? 0;
    input.connect(delay);
    delay.connect(decay);
    decay.connect(sum);
    nodes.push(delay, decay);
  });

  sum.connect(out);
  nodes.push(input, sum, dry, out);
  return { input, output: out };
}

/**
 * Build the chain for one clip's audio settings.
 *
 * Always returns a usable chain: with no effects it is a single
 * pass-through gain, so the caller never has to special-case "no chain"
 * and the graph shape does not change when a setting is cleared.
 */
export function buildVoiceChain(
  ctx: BaseAudioContext,
  a: ClipAudioSettings,
  opts: { pitchReady?: boolean } = {}
): VoiceChain {
  const nodes: AudioNode[] = [];
  const applied: string[] = [];

  const input = ctx.createGain();
  input.gain.value = 1;
  nodes.push(input);

  let tail: AudioNode = input;
  const chain = (n: AudioNode) => { tail.connect(n); tail = n; nodes.push(n); };

  /*
    Pitch first, so everything after it filters the shifted signal — the
    same order the export builds: afftdn, pitch, then the voice effect.
    `deep` and `high` are ±5 semitones of exactly this machinery, which
    is why they stopped being unpreviewable the moment it existed.
  */
  const semitones =
    (a.pitch ?? 0) +
    (a.voiceEffect === 'deep' ? -5 : a.voiceEffect === 'high' ? 5 : 0);

  if (semitones !== 0 && opts.pitchReady) {
    const shifter = new AudioWorkletNode(ctx as AudioContext, 'kerf-pitch', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    shifter.parameters.get('semitones')!.value = semitones;
    chain(shifter);
    if (a.pitch) applied.push(`pitch ${a.pitch > 0 ? '+' : ''}${a.pitch}`);
    if (a.voiceEffect === 'deep' || a.voiceEffect === 'high') applied.push(a.voiceEffect);
  }

  switch (a.voiceEffect as VoiceEffect) {
    // deep and high are handled above as a pitch shift; there is nothing
    // further to add for them.
    case 'deep':
    case 'high':
      break;

    case 'telephone': {
      // Render: highpass=f=400, lowpass=f=3200, volume=1.4
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 400; hp.Q.value = BUTTERWORTH_Q_DB;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = BUTTERWORTH_Q_DB;
      const vol = ctx.createGain(); vol.gain.value = 1.4;
      chain(hp); chain(lp); chain(vol);
      applied.push('telephone');
      break;
    }

    case 'echo': {
      // Render: aecho=0.8:0.85:180|340:0.5|0.28
      const e = aecho(ctx, 0.8, 0.85, [180, 340], [0.5, 0.28], nodes);
      tail.connect(e.input); tail = e.output;
      applied.push('echo');
      break;
    }

    case 'stadium': {
      // Render: aecho=0.7:0.85:420|780|1200:0.5|0.35|0.22, lowpass=f=9000
      const e = aecho(ctx, 0.7, 0.85, [420, 780, 1200], [0.5, 0.35, 0.22], nodes);
      tail.connect(e.input); tail = e.output;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 9000; lp.Q.value = BUTTERWORTH_Q_DB;
      chain(lp);
      applied.push('stadium');
      break;
    }

    case 'robot': {
      /*
        Render: vibrato=f=32:d=0.9, aecho=0.8:0.9:5:0.6

        `vibrato` is pitch modulation by sweeping a short delay, and that
        is the one form of pitch movement a streamed element CAN do —
        it is the delay line being modulated, not the source being
        retuned, so no buffer is needed. An oscillator drives delayTime
        directly; `d` scales how far it swings.

        This one is an approximation and is marked as such by
        `describe_audio_preview`: ffmpeg's vibrato interpolates its delay
        line differently, so the warble matches in rate and depth but not
        sample for sample. The four settings in `unpreviewableAudio` are
        the ones that are not reproduced AT ALL; this is not one of them.
      */
      const baseS = 0.003;
      const depthS = 0.9 * 0.0025;
      const delay = ctx.createDelay(0.05);
      delay.delayTime.value = baseS;

      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 32;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = depthS;
      lfo.connect(lfoDepth);
      lfoDepth.connect(delay.delayTime);
      lfo.start();
      nodes.push(lfo, lfoDepth);

      chain(delay);

      const e = aecho(ctx, 0.8, 0.9, [5], [0.6], nodes);
      tail.connect(e.input); tail = e.output;
      applied.push('robot');
      break;
    }

    default:
      break;
  }

  // A trailing gain gives the caller one stable node to connect from,
  // whatever the chain above did.
  const output = ctx.createGain();
  output.gain.value = 1;
  tail.connect(output);
  nodes.push(output);

  return { input, output, nodes, applied };
}

/**
 * Tear a chain down.
 *
 * Disconnecting is not enough on its own: `robot` starts an oscillator to
 * drive its delay, and an `OscillatorNode` that is merely disconnected
 * keeps running for the life of the context. One per rebuild of one clip
 * is not audible, which is exactly why it would accumulate unnoticed.
 */
export function disposeChain(chain: VoiceChain): void {
  for (const n of chain.nodes) {
    try {
      if (typeof (n as OscillatorNode).stop === 'function') (n as OscillatorNode).stop();
    } catch { /* already stopped */ }
    try { n.disconnect(); } catch { /* already detached */ }
  }
}

/**
 * A value that changes whenever the chain would have to be rebuilt.
 *
 * Voices are kept across frames and only their gain is written, so a
 * clip whose voiceEffect changed has to be noticed explicitly — without
 * this, switching a clip to `telephone` mid-session did nothing until the
 * voice happened to be released for another reason.
 *
 * `volume`, the fades and `noiseReduction` are deliberately NOT in here:
 * volume and fades are written per frame as gain, and noise reduction
 * builds no nodes because playback cannot do it at all.
 */
export function chainSignature(a: ClipAudioSettings): string {
  // `pitch` is in here now. It builds a node, so changing it has to
  // rebuild the chain — without this, dragging the pitch slider moved a
  // number nothing was reading.
  return `${a.voiceEffect ?? 'none'}:${a.pitch ?? 0}`;
}

/* ── Ducking ───────────────────────────────────────────────────────

   WebAudio has no sidechain. The render uses
   `sidechaincompress=threshold=0.03:ratio=8:attack=20:release=320`, with
   the mix split into a ducked bus and a key bus, and the preview does the
   same split — the difference is that the key bus level is measured with
   an `AnalyserNode` once per frame and written to the ducked bus's gain,
   rather than sample-accurately inside the filter.

   Per frame is coarse — ~16ms against ffmpeg's per-sample envelope — but
   the attack and release constants that matter here are 20ms and 320ms,
   so the audible behaviour lands in the same place. It is measured, not
   assumed: `verify_playback_audio.py` drives a key signal and checks the
   ducked gain actually falls and recovers.                             */

export const DUCK_THRESHOLD = 0.03;
export const DUCK_RATIO = 8;
export const DUCK_ATTACK_S = 0.02;
export const DUCK_RELEASE_S = 0.32;

/**
 * Target gain for the ducked bus given the key bus's current RMS.
 *
 * Same curve as the render's compressor: below the threshold nothing
 * happens; above it, every dB over is reduced to 1/ratio of itself.
 */
export function duckGainFor(keyRms: number): number {
  if (!(keyRms > DUCK_THRESHOLD)) return 1;
  const overDb = 20 * Math.log10(keyRms / DUCK_THRESHOLD);
  const reductionDb = overDb * (1 - 1 / DUCK_RATIO);
  return Math.pow(10, -reductionDb / 20);
}

/* ── Measuring the chain ───────────────────────────────────────────

   The reason `buildVoiceChain` takes a `BaseAudioContext` rather than
   reaching for the playback context: the same graph can be rendered by an
   `OfflineAudioContext` over a signal we choose, and then measured. So
   "the preview applies telephone" stops being a claim in a tool
   description and becomes a number — the band 5kHz above the passband
   coming back ~30dB down, measured on rendered samples.

   This is the tap `NEXT.md` said playback did not have, and it is what
   `tools/verify_playback_audio.py` asserts against.                    */

export interface ChainMeasurement {
  /** Effects the preview graph reproduces. */
  applied: string[];
  /** Steady-state gain in dB at representative frequencies. */
  bandDb: Record<string, number>;
  /** Echo taps found in the impulse response: ms after the impulse. */
  tapsMs: number[];
  /** Peak of the impulse response — how far the chain moves a transient. */
  impulsePeak: number;
}

const PROBE_HZ = [100, 300, 1000, 3000, 6000, 12000];

function offlineCtx(frames: number, sampleRate: number): OfflineAudioContext | null {
  const Ctor =
    typeof window !== 'undefined'
      ? window.OfflineAudioContext ??
        (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext
      : undefined;
  return Ctor ? new Ctor(1, frames, sampleRate) : null;
}

function rms(data: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

/**
 * Render the chain offline and measure what it does.
 *
 * Band gains come from steady tones rather than from the FFT of an
 * impulse: a chain with echoes has a comb-filtered impulse response, and
 * reading band energy off that measures the comb, not the filter. A
 * settled sine gives the gain the ear actually gets.
 */
export async function measureChain(
  a: ClipAudioSettings,
  sampleRate = 48000
): Promise<ChainMeasurement | null> {
  const probe = offlineCtx(Math.round(sampleRate * 0.5), sampleRate);
  if (!probe) return null;

  const bandDb: Record<string, number> = {};
  let applied: string[] = [];

  for (const hz of PROBE_HZ) {
    const ctx = offlineCtx(Math.round(sampleRate * 0.5), sampleRate);
    if (!ctx) return null;
    // Each OfflineAudioContext needs its own copy of the module.
    const pitchReady = await ensurePitchWorklet(ctx);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = hz;

    const chain = buildVoiceChain(ctx, a, { pitchReady });
    applied = chain.applied;
    osc.connect(chain.input);
    chain.output.connect(ctx.destination);
    osc.start();

    const rendered = await ctx.startRendering();
    const data = rendered.getChannelData(0);
    // Last 40% only: filters and echo taps need time to settle, and a
    // measurement taken during the onset reads as attenuation.
    const out = rms(data, Math.floor(data.length * 0.6), data.length);
    // A unit sine has RMS 1/sqrt(2); express the chain's gain against that.
    bandDb[`${hz}Hz`] = Number((20 * Math.log10(Math.max(out, 1e-9) / Math.SQRT1_2)).toFixed(2));
  }

  // Impulse response — where the echo taps land.
  const irCtx = offlineCtx(Math.round(sampleRate * 2), sampleRate);
  if (!irCtx) return null;
  const buf = irCtx.createBuffer(1, Math.round(sampleRate * 2), sampleRate);
  buf.getChannelData(0)[0] = 1;
  const src = irCtx.createBufferSource();
  src.buffer = buf;
  const irPitchReady = await ensurePitchWorklet(irCtx);
  const irChain = buildVoiceChain(irCtx, a, { pitchReady: irPitchReady });
  src.connect(irChain.input);
  irChain.output.connect(irCtx.destination);
  src.start();

  const ir = (await irCtx.startRendering()).getChannelData(0);
  let peak = 0;
  for (let i = 0; i < ir.length; i++) peak = Math.max(peak, Math.abs(ir[i]));

  /*
    Taps, not samples. A biquad rings for many samples after a transient,
    so anything within a millisecond of a tap already found is the same
    tap — otherwise `telephone` reports a hundred "echoes" that are one
    filter settling.
  */
  const tapsMs: number[] = [];
  const floor = Math.max(peak * 0.05, 1e-4);
  const guard = Math.round(sampleRate * 0.001);
  let lastIdx = -guard * 2;
  for (let i = 0; i < ir.length; i++) {
    if (Math.abs(ir[i]) < floor) continue;
    if (i - lastIdx <= guard) { lastIdx = i; continue; }
    tapsMs.push(Number(((i / sampleRate) * 1000).toFixed(1)));
    lastIdx = i;
  }

  return { applied, bandDb, tapsMs: tapsMs.slice(0, 12), impulsePeak: Number(peak.toFixed(4)) };
}
