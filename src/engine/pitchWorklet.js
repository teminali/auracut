/* ═══════════════════════════════════════════════════════════════════
   Pitch, without decoding anything.

   `NEXT.md` §1 said moving pitch without moving speed "needs
   `AudioBufferSourceNode.detune`, i.e. decoding each clip to a buffer —
   a ten-minute track is ~100MB as raw float samples, which is exactly
   why playback streams from elements in the first place. That is a
   change to the playback architecture, not an addition to it."

   The premise was too narrow. `detune` is one way to move pitch; it is
   not the only one. A granular shifter reads a delay line at a rate
   different from the rate it is written, and crossfades between two
   read heads so the seam is never audible. It processes whatever
   samples arrive, which means it works on a
   `MediaElementAudioSourceNode` exactly as well as on a buffer — no
   decode, no memory budget, no eviction, and nothing about the
   streaming architecture changes.

   ── Why it sounds the way it does ─────────────────────────────────

   Reading the line faster than it is written raises pitch and exhausts
   the buffer, so the head must periodically jump back; reading slower
   lowers pitch and the head must jump forward. Either way there is a
   discontinuity, and the whole craft is hiding it. Two heads half a
   grain out of phase, each windowed by a raised cosine that sums to
   unity with its partner, means one head is always at full gain while
   the other is at zero — the jump happens where nothing is being heard.

   This is an APPROXIMATION and is declared as one. ffmpeg does the same
   job with `asetrate` + `atempo`, which resamples and then time-stretches
   with a different algorithm, so the two will not match sample for
   sample. What they DO match is the thing that matters: the fundamental
   moves by 2^(semitones/12) and the duration does not change.
   `verify_playback_audio.py` measures exactly that on both engines.
   ═══════════════════════════════════════════════════════════════════ */

/*
  Grain length is the one real trade-off.

  Short grains follow transients but impose their own periodicity on the
  sound — at 20ms that is 50Hz, buzzing right in the bass. Long grains
  are smoother but smear attacks and lengthen the delay. 80ms puts the
  grain rate at 12.5Hz, below the audio band, and keeps the smear short
  enough that speech stays intelligible, which is what these effects are
  for.
*/
const GRAIN_SECONDS = 0.08;

class PitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{
      name: 'semitones',
      defaultValue: 0,
      minValue: -24,
      maxValue: 24,
      automationRate: 'k-rate',
    }];
  }

  constructor() {
    super();
    this.grain = Math.max(256, Math.round(GRAIN_SECONDS * sampleRate));
    // Two grains of headroom: the read head trails the write head by up
    // to one grain, and may fall a further grain behind before it wraps.
    this.size = this.grain * 4;
    this.buffers = [];
    this.writeIndex = 0;
    // Distance behind the write head, in samples. Fractional because the
    // read rate is fractional.
    this.readOffset = 0;
  }

  ensureChannels(count) {
    while (this.buffers.length < count) this.buffers.push(new Float32Array(this.size));
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const semitones = parameters.semitones[0];

    // Unity: copy through untouched rather than run the grain machinery
    // and add its artefacts for nothing.
    if (!semitones) {
      for (let c = 0; c < output.length; c++) {
        const src = input && input[c];
        if (src) output[c].set(src);
        else output[c].fill(0);
      }
      return true;
    }

    const ratio = Math.pow(2, semitones / 12);
    const frames = output[0].length;
    this.ensureChannels(output.length);

    for (let c = 0; c < output.length; c++) {
      const buf = this.buffers[c];
      const src = input && input[c];
      const out = output[c];
      let write = this.writeIndex;
      let offset = this.readOffset;

      for (let i = 0; i < frames; i++) {
        buf[write] = src ? src[i] : 0;

        /*
          Two heads, half a grain apart. `offset` is how far the first
          head trails the write head; the second trails by half a grain
          more. Their windows are cos^2 and sin^2 of the same phase, and
          those sum to exactly 1 — so the pair is unity-gain everywhere
          and the crossfade introduces no ripple.
        */
        const phase = (offset % this.grain) / this.grain;      // 0..1
        const a = Math.cos(phase * Math.PI * 0.5);
        const b = Math.sin(phase * Math.PI * 0.5);

        out[i] =
          a * a * this.read(buf, write - offset) +
          b * b * this.read(buf, write - offset - this.grain * 0.5);

        /*
          The read head advances by `ratio` while the write head advances
          by 1, so its LAG behind the write head shrinks by (ratio - 1)
          per sample. Minus, not plus: to raise pitch you read the line
          faster, which closes the gap. Getting this backwards inverts
          the effect and is not subtle about it — +12 semitones came out
          an octave and a half DOWN, at 85Hz against a wanted 880.

          Left alone the head would run past the write pointer or fall
          out of the buffer; the wrap keeps it within one grain of where
          it started, and the window above guarantees the wrap lands
          where this head is silent.
        */
        offset -= ratio - 1;
        if (offset >= this.grain) offset -= this.grain;
        else if (offset < 0) offset += this.grain;

        write = (write + 1) % this.size;
      }

      if (c === output.length - 1) {
        this.writeIndex = write;
        this.readOffset = offset;
      }
    }

    return true;
  }

  /** Linear interpolation, because the read position is fractional. */
  read(buf, position) {
    let p = position % this.size;
    if (p < 0) p += this.size;
    const i = Math.floor(p);
    const frac = p - i;
    const j = (i + 1) % this.size;
    return buf[i] * (1 - frac) + buf[j] * frac;
  }
}

registerProcessor('kerf-pitch', PitchProcessor);
