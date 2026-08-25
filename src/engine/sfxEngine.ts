/* ═══════════════════════════════════════════════════════════════════
   Sound effects, synthesised.

   AuraCut had no sound library at all — the "Music & SFX" panel listed
   whatever you had already imported, which is not a library.

   The obvious fix is to ship a catalogue of files. This does not,
   for a reason this codebase has already been bitten by twice: the old
   B-roll "library" was four Unsplash JPEGs named `.mp4`, and the seed
   project's music is a mixkit URL that returns 403 to ffmpeg, which
   silently produced a SILENT render on every export until it was
   found. A catalogue of hotlinked URLs looks like assets and breaks
   exactly that way.

   So these are generated. Every one is rendered here, from noise and
   oscillators through filters and envelopes, into a real WAV written to
   disk. That means:

     • no licensing question at all — they are not anyone's recordings
     • nothing to 404, and nothing to download
     • parameterised rather than fixed, so it is a generator and not a
       list of twelve things
     • a real file on disk, which matters because ffmpeg cannot read a
       blob: URL, so anything that only existed in memory would play in
       the preview and vanish from the export

   They are synthesised, and the UI says so. A synthesised whoosh is not
   a recorded one, and pretending otherwise would be the same lie in a
   new costume.
   ═══════════════════════════════════════════════════════════════════ */

export type SfxKind =
  | 'whoosh' | 'reverse_whoosh' | 'impact' | 'boom' | 'riser'
  | 'sub_drop' | 'click' | 'pop' | 'beep' | 'glitch' | 'sweep_up' | 'noise_hit';

export interface SfxSpec {
  kind: SfxKind;
  label: string;
  hint: string;
  /** Default length in seconds. */
  seconds: number;
}

export const SFX_CATALOGUE: SfxSpec[] = [
  { kind: 'whoosh',         label: 'Whoosh',         hint: 'Air pass, for a cut or a swipe',   seconds: 0.7 },
  { kind: 'reverse_whoosh', label: 'Reverse Whoosh', hint: 'Sucks into the next shot',          seconds: 0.8 },
  { kind: 'impact',         label: 'Impact',         hint: 'Hard hit on the beat',              seconds: 1.2 },
  { kind: 'boom',           label: 'Cinematic Boom', hint: 'Deep trailer hit with tail',        seconds: 2.2 },
  { kind: 'riser',          label: 'Riser',          hint: 'Builds tension into a drop',        seconds: 2.0 },
  { kind: 'sub_drop',       label: 'Sub Drop',       hint: 'Falling sub bass',                  seconds: 1.6 },
  { kind: 'click',          label: 'Click',          hint: 'Tight UI tick',                     seconds: 0.12 },
  { kind: 'pop',            label: 'Pop',            hint: 'Bubble pop for text',               seconds: 0.25 },
  { kind: 'beep',           label: 'Beep',           hint: 'Clean notification tone',           seconds: 0.3 },
  { kind: 'glitch',         label: 'Glitch',         hint: 'Digital stutter and tear',          seconds: 0.6 },
  { kind: 'sweep_up',       label: 'Sweep Up',       hint: 'Filtered rise, softer than a riser', seconds: 1.4 },
  { kind: 'noise_hit',      label: 'Noise Hit',      hint: 'Short percussive burst',            seconds: 0.5 },
];

const SAMPLE_RATE = 48000;

/* ── Building blocks ────────────────────────────────────────────── */

function noiseBuffer(ctx: OfflineAudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function noiseSource(ctx: OfflineAudioContext, seconds: number): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, seconds);
  return source;
}

/**
 * A percussive envelope: near-instant attack, exponential decay.
 *
 * `exponentialRampToValueAtTime` cannot reach zero, so the floor is a
 * small positive value followed by a hard stop — ramping to 0 throws.
 */
function envelope(gain: GainNode, at: number, attack: number, decay: number, peak = 1): void {
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
}

/* ── The voices ─────────────────────────────────────────────────── */

function render(kind: SfxKind, seconds: number, ctx: OfflineAudioContext): void {
  const t = 0;
  const end = seconds;
  const out = ctx.destination;

  switch (kind) {
    case 'whoosh':
    case 'reverse_whoosh': {
      const source = noiseSource(ctx, seconds);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.4;

      const reversed = kind === 'reverse_whoosh';
      // Sweeping the band is what makes it read as movement past the mic.
      filter.frequency.setValueAtTime(reversed ? 300 : 1800, t);
      filter.frequency.exponentialRampToValueAtTime(reversed ? 4200 : 260, end);

      const gain = ctx.createGain();
      if (reversed) {
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.9, end * 0.92);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
      } else {
        envelope(gain, t, seconds * 0.18, seconds * 0.8, 0.9);
      }

      source.connect(filter).connect(gain).connect(out);
      source.start(t);
      break;
    }

    case 'impact':
    case 'noise_hit': {
      const deep = kind === 'impact';

      const body = ctx.createOscillator();
      body.type = 'sine';
      body.frequency.setValueAtTime(deep ? 160 : 320, t);
      body.frequency.exponentialRampToValueAtTime(deep ? 42 : 110, t + seconds * 0.5);
      const bodyGain = ctx.createGain();
      envelope(bodyGain, t, 0.004, seconds * 0.75, deep ? 1 : 0.6);
      body.connect(bodyGain).connect(out);
      body.start(t);
      body.stop(end);

      const crack = noiseSource(ctx, seconds);
      const shape = ctx.createBiquadFilter();
      shape.type = deep ? 'lowpass' : 'highpass';
      shape.frequency.value = deep ? 900 : 1400;
      const crackGain = ctx.createGain();
      envelope(crackGain, t, 0.002, seconds * (deep ? 0.22 : 0.4), deep ? 0.5 : 0.8);
      crack.connect(shape).connect(crackGain).connect(out);
      crack.start(t);
      break;
    }

    case 'boom': {
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(90, t);
      sub.frequency.exponentialRampToValueAtTime(28, t + seconds * 0.7);
      const subGain = ctx.createGain();
      envelope(subGain, t, 0.01, seconds * 0.95, 1);
      sub.connect(subGain).connect(out);
      sub.start(t);
      sub.stop(end);

      // A long filtered tail is what separates a boom from a thud.
      const tail = noiseSource(ctx, seconds);
      const tailFilter = ctx.createBiquadFilter();
      tailFilter.type = 'lowpass';
      tailFilter.frequency.setValueAtTime(1800, t);
      tailFilter.frequency.exponentialRampToValueAtTime(180, end);
      const tailGain = ctx.createGain();
      envelope(tailGain, t, 0.02, seconds * 0.9, 0.35);
      tail.connect(tailFilter).connect(tailGain).connect(out);
      tail.start(t);
      break;
    }

    case 'riser':
    case 'sweep_up': {
      const bright = kind === 'riser';

      const source = noiseSource(ctx, seconds);
      const filter = ctx.createBiquadFilter();
      filter.type = bright ? 'bandpass' : 'lowpass';
      filter.Q.value = bright ? 6 : 1;
      filter.frequency.setValueAtTime(200, t);
      filter.frequency.exponentialRampToValueAtTime(bright ? 7000 : 5200, end);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(bright ? 0.85 : 0.6, end * 0.95);
      // Cut hard at the top; a riser that fades out has no landing.
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      source.connect(filter).connect(gain).connect(out);
      source.start(t);

      if (bright) {
        const tone = ctx.createOscillator();
        tone.type = 'sawtooth';
        tone.frequency.setValueAtTime(110, t);
        tone.frequency.exponentialRampToValueAtTime(880, end);
        const toneGain = ctx.createGain();
        toneGain.gain.setValueAtTime(0.0001, t);
        toneGain.gain.exponentialRampToValueAtTime(0.22, end * 0.95);
        toneGain.gain.exponentialRampToValueAtTime(0.0001, end);
        tone.connect(toneGain).connect(out);
        tone.start(t);
        tone.stop(end);
      }
      break;
    }

    case 'sub_drop': {
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(220, t);
      sub.frequency.exponentialRampToValueAtTime(25, end);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.9, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      sub.connect(gain).connect(out);
      sub.start(t);
      sub.stop(end);
      break;
    }

    case 'click':
    case 'pop': {
      const osc = ctx.createOscillator();
      osc.type = kind === 'pop' ? 'sine' : 'square';
      osc.frequency.setValueAtTime(kind === 'pop' ? 420 : 1600, t);
      if (kind === 'pop') osc.frequency.exponentialRampToValueAtTime(1100, end);
      const gain = ctx.createGain();
      envelope(gain, t, 0.001, seconds * 0.9, 0.7);
      osc.connect(gain).connect(out);
      osc.start(t);
      osc.stop(end);
      break;
    }

    case 'beep': {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 880;
      const gain = ctx.createGain();
      // A trapezoid rather than a spike, or it clicks at both ends.
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.7, t + 0.012);
      gain.gain.setValueAtTime(0.7, end - 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(out);
      osc.start(t);
      osc.stop(end);
      break;
    }

    case 'glitch': {
      /* Stutter: several short bursts at jumping pitches. Regular
         spacing sounds like a machine fault rather than a glitch, so the
         slice count and pitches vary across the span. */
      const slices = 9;
      for (let i = 0; i < slices; i++) {
        const at = (i / slices) * seconds;
        const width = (seconds / slices) * (0.35 + Math.random() * 0.5);

        const osc = ctx.createOscillator();
        osc.type = Math.random() > 0.5 ? 'square' : 'sawtooth';
        osc.frequency.value = 200 + Math.random() * 2600;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.45, at + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + width);

        osc.connect(gain).connect(out);
        osc.start(at);
        osc.stop(Math.min(end, at + width));
      }
      break;
    }
  }
}

/**
 * Scale to a fixed peak, leaving headroom.
 *
 * Several of these sum two voices — the impact is a sine body plus a
 * noise crack — and the sum runs past full scale. The WAV encoder
 * clamps, so it would not wrap into noise, but it would hard-clip and
 * the result measured 0.0 dBFS. Normalising also makes the whole set
 * land at a consistent level, so swapping one for another does not
 * change the mix.
 */
const TARGET_PEAK = 0.89; // about -1 dBFS
/*
  Peak alone is not enough. A sustained tone and a transient can share a
  peak and be ten decibels apart in perceived level — normalised only to
  peak, the beep measured -4.5 dB mean against the whoosh's -23.7 and
  would arrive in the mix roughly three times as loud. Capping average
  energy too keeps the set usable together.
*/
const MAX_RMS = 0.10; // about -20 dBFS

function normalisePeak(buffer: AudioBuffer): void {
  let peak = 0;
  let sumSquares = 0;
  let samples = 0;

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const value = Math.abs(data[i]);
      if (value > peak) peak = value;
      sumSquares += data[i] * data[i];
      samples++;
    }
  }
  if (peak === 0 || samples === 0) return;

  const rms = Math.sqrt(sumSquares / samples);
  // Whichever constraint binds first wins, so nothing clips and nothing
  // dominates.
  const scale = Math.min(TARGET_PEAK / peak, rms > 0 ? MAX_RMS / rms : Infinity);

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) data[i] *= scale;
  }
}

/* ── WAV encoding ───────────────────────────────────────────────── */

/** 16-bit PCM WAV — the format everything reads without negotiation. */
function encodeWav(buffer: AudioBuffer): Uint8Array {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = frames * channels * 2;

  const out = new ArrayBuffer(44 + bytes);
  const view = new DataView(out);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);                          // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, bytes, true);

  let offset = 44;
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      // Clamp before scaling, or a peak over 1.0 wraps to full-scale noise.
      const sample = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(offset, sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Uint8Array(out);
}

/* ── Public API ─────────────────────────────────────────────────── */

export interface RenderedSfx {
  kind: SfxKind;
  label: string;
  wav: Uint8Array;
  durationMs: number;
}

/**
 * Synthesise one effect and return it as WAV bytes.
 *
 * `seconds` overrides the catalogue default, which is what makes this a
 * generator: the same whoosh at 0.3s and at 1.5s are different sounds
 * with different uses.
 */
export async function renderSfx(kind: SfxKind, seconds?: number): Promise<RenderedSfx> {
  const spec = SFX_CATALOGUE.find((s) => s.kind === kind);
  if (!spec) throw new Error(`No sound effect called "${kind}".`);

  const length = Math.max(0.05, Math.min(15, seconds ?? spec.seconds));
  const Ctor =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!Ctor) throw new Error('This browser cannot render audio offline.');

  const ctx = new Ctor(1, Math.ceil(length * SAMPLE_RATE), SAMPLE_RATE);
  render(kind, length, ctx);
  const buffer = await ctx.startRendering();
  normalisePeak(buffer);

  return {
    kind,
    label: spec.label,
    wav: encodeWav(buffer),
    durationMs: Math.round(length * 1000),
  };
}
