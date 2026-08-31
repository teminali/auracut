/* ═══════════════════════════════════════════════════════════════════
   Export — actually writing a file.

   What was here before rendered every frame correctly and then encoded
   nothing: no VideoEncoder, no muxer, no ffmpeg. It ran the frame loop,
   printed "Muxing AAC audio streams and finalizing MP4 container…",
   slept 400ms, and returned a path to a file that had never been
   created — reporting "Hardware Export Complete". An editor that cannot
   produce a file is not an editor.

   The pipeline, in three verifiable steps:

     1. VIDEO  the renderer composites each frame and hands it over as
               JPEG; ffmpeg reads them from stdin as an image2pipe
               stream and encodes to h264 / hevc / prores.
     2. AUDIO  the timeline's audio is rebuilt as an ffmpeg filtergraph
               straight from the source files — trim to the clip's source
               range, delay to its timeline position, apply gain and
               fades, mix. Deterministic, and independent of whatever the
               preview engine happens to be doing.
     3. MUX    stream-copy the two together.

   Three steps rather than one command because when an export fails you
   need to know which half broke.
   ═══════════════════════════════════════════════════════════════════ */

import { ffmpegSource } from './mediaPath';
import { spawn, execFile } from 'child_process';
import { app, powerSaveBlocker } from 'electron';
import path from 'path';
import fs from 'fs';
import { ffmpeg } from './transcribe';

export interface ExportClipAudio {
  mediaUrl: string;
  /** Where it sits on the timeline. */
  startTimeMs: number;
  durationMs: number;
  /** Where playback begins inside the source. */
  sourceStartMs: number;
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
  speed: number;
  /**
   * Play this clip's sound backwards.
   *
   * `reverseClip` has always reversed the PICTURE and never the sound:
   * `collectAudioClips` did not read `speed.reversed` and this
   * filtergraph had no `areverse`, so reversed dialogue exported as
   * forward dialogue. Measured on a 300Hz-to-3000Hz sweep — the export
   * still ROSE in both directions (572Hz to 2738Hz either way).
   */
  reversed?: boolean;
  /**
   * A keyframed volume, sampled in the renderer as timeline-local
   * points. Empty or absent means the static `volume` above applies.
   *
   * Sampled rather than expressed, because easing (easeInOut, hold,
   * custom bezier) is implemented in `keyframeMath.ts` and a second
   * implementation inside an ffmpeg expression would be one more thing
   * to keep in step.
   */
  volumeEnvelope?: { tMs: number; v: number }[];
  /** Semitones, -24..24. */
  pitch?: number;
  voiceEffect?: 'none' | 'deep' | 'high' | 'robot' | 'echo' | 'telephone' | 'stadium';
  noiseReduction?: boolean;
  /** Pull this clip down under whatever is NOT ducked — music under voice. */
  ducking?: boolean;
}

export interface StartExportOptions {
  width: number;
  height: number;
  fps: number;
  codec: 'h264' | 'hevc' | 'prores';
  outputPath: string;
  /** Prefer Apple VideoToolbox where the codec supports it. */
  hardware?: boolean;
  bitrateMbps?: number;
  /**
   * What arrives on the pipe.
   *
   * `jpeg` is the original path: one compressed still per frame, decoded
   * and re-encoded here. `h264`/`hevc` mean the RENDERER has already
   * encoded the picture with WebCodecs and this side does nothing but
   * stream-copy it into a container — no decode, no second encode, and
   * the bytes in the file are the bytes the encoder produced.
   */
  frameFormat?: 'jpeg' | 'h264' | 'hevc';
}

interface Session {
  id: string;
  proc: ReturnType<typeof spawn>;
  videoPath: string;
  outputPath: string;
  options: StartExportOptions;
  framesWritten: number;
  stderr: string;
  /** Set when ffmpeg dies early, so writeFrame can fail loudly. */
  failed: Error | null;
  closed: Promise<void>;
  /**
   * Picture written out of order, one file per chunk.
   *
   * A chunked render has several windows compositing DIFFERENT parts of
   * the timeline at once, and they finish at whatever rate their slice
   * happens to take. They cannot share the one pipe — ffmpeg reads a
   * stream, and interleaved slices are not a stream — so each writes to
   * its own file and `drainChunks` feeds them in, in order, at the end.
   *
   * This works for BOTH formats, and it is the reason the chunked path
   * is a hundred lines rather than a muxer. A JPEG stream is
   * concatenated JPEGs. An Annex B stream is concatenated NAL units, and
   * every chunk starts on an IDR with its own SPS/PPS because the
   * encoder is asked for a keyframe on the chunk's first frame. Joining
   * either is `cat`.
   */
  chunks: Map<number, { stream: fs.WriteStream; path: string; frames: number; done: boolean }>;
}

const sessions = new Map<string, Session>();
let counter = 0;
let activePowerBlockerId: number | null = null;

function acquirePowerLock(): void {
  if (activePowerBlockerId === null) {
    try {
      activePowerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    } catch { /* ignore */ }
  }
}

function releasePowerLock(): void {
  if (sessions.size === 0 && activePowerBlockerId !== null) {
    try {
      if (powerSaveBlocker.isStarted(activePowerBlockerId)) {
        powerSaveBlocker.stop(activePowerBlockerId);
      }
    } catch { /* ignore */ }
    activePowerBlockerId = null;
  }
}

function encoderArgs(options: StartExportOptions): string[] {
  const { codec, hardware, bitrateMbps } = options;

  if (codec === 'prores') {
    // Profile 3 = ProRes 422 HQ, the usual delivery/intermediate choice.
    return ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le'];
  }

  const bitrate = bitrateMbps ? ['-b:v', `${bitrateMbps}M`] : ['-crf', '18'];

  if (hardware) {
    // VideoToolbox ignores CRF, so give it an explicit bitrate.
    const vtBitrate = bitrateMbps ?? (options.height >= 2000 ? 40 : 12);
    return [
      '-c:v', codec === 'hevc' ? 'hevc_videotoolbox' : 'h264_videotoolbox',
      '-b:v', `${vtBitrate}M`,
      '-pix_fmt', 'yuv420p',
      ...(codec === 'hevc' ? ['-tag:v', 'hvc1'] : []),
    ];
  }

  return [
    '-c:v', codec === 'hevc' ? 'libx265' : 'libx264',
    ...bitrate,
    '-preset', 'medium',
    '-pix_fmt', 'yuv420p',
    ...(codec === 'hevc' ? ['-tag:v', 'hvc1'] : []),
  ];
}

export function startExport(options: StartExportOptions): { sessionId: string } | { error: string } {
  const ff = ffmpeg();
  if (!ff) return { error: 'ffmpeg was not found. Install it with `brew install ffmpeg` to export.' };

  /*
    Accept either an absolute path or a bare filename. Only main knows
    where "Movies" actually is, and a renderer-side guess put every
    default export at `/Movies/...`, which no user can write to.
  */
  if (!path.isAbsolute(options.outputPath)) {
    const base = path.basename(options.outputPath) || 'Kerf_Export.mp4';
    options = { ...options, outputPath: path.join(app.getPath('videos'), base) };
  }

  const id = `exp_${Date.now().toString(36)}_${++counter}`;
  const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'kerf-export-'));
  const videoPath = path.join(dir, options.codec === 'prores' ? 'video.mov' : 'video.mp4');

  /*
    Two shapes of input, and the difference is the whole point of the
    fast path. A JPEG stream has to be decoded and encoded here. An
    elementary stream is already finished: ffmpeg's only job is to put
    timestamps on it and write a container, which costs approximately
    nothing and — more importantly — cannot degrade the picture.

    A raw stream carries no timing of its own, so the INPUT side is what
    gives the frames their spacing — and the option is `-r`, not
    `-framerate`. That distinction is the whole of a bug that took a
    verify run to find: `-framerate` is the image2pipe demuxer's option
    and the raw h264 demuxer ignores it, so a 90-frame 30fps render came
    out 90 frames long and 1.667 SECONDS long, playing at 54fps with the
    audio muxed against a timeline nearly twice its length.

    Measured on a real Chromium encoder stream, 90 frames at 30fps:

        -framerate 30 (input)                  90 frames   1.667s
        -framerate 30 (input) + -r 30 (output) 90 frames   1.703s
        -r 30 (input)                          90 frames   3.000s

    Nothing was ever lost — every variant carries all 90 frames. Only
    the input `-r` gives them the right spacing.
  */
  const raw = options.frameFormat === 'h264' || options.frameFormat === 'hevc';

  const args = raw
    ? [
        '-y',
        '-f', options.frameFormat!,
        '-r', String(options.fps),
        '-i', 'pipe:0',
        '-c:v', 'copy',
        ...(options.codec === 'hevc' ? ['-tag:v', 'hvc1'] : []),
        videoPath,
      ]
    : [
        '-y',
        // Input: a stream of JPEGs, one per frame, at the project rate.
        '-f', 'image2pipe',
        '-framerate', String(options.fps),
        '-i', 'pipe:0',
        ...encoderArgs(options),
        '-r', String(options.fps),
        videoPath,
      ];

  const proc = spawn(ff, args, { stdio: ['pipe', 'ignore', 'pipe'] });

  const session: Session = {
    id, proc, videoPath, outputPath: options.outputPath, options,
    framesWritten: 0, stderr: '', failed: null,
    closed: Promise.resolve(),
    chunks: new Map(),
  };

  proc.stderr?.setEncoding('utf8');
  proc.stderr?.on('data', (chunk: string) => {
    // Keep only the tail; ffmpeg is chatty and the end is what matters.
    session.stderr = (session.stderr + chunk).slice(-4000);
  });

  // A broken pipe here means ffmpeg exited; surface it rather than crash.
  proc.stdin?.on('error', (err: Error) => { session.failed = err; });
  proc.on('error', (err) => { session.failed = err; });

  session.closed = new Promise<void>((resolve) => {
    proc.on('close', (code) => {
      if (code !== 0) session.failed = new Error(session.stderr.trim().slice(-800) || `ffmpeg exited ${code}`);
      resolve();
    });
  });

  sessions.set(id, session);
  acquirePowerLock();
  return { sessionId: id };
}

/**
 * Push composited picture. Applies backpressure so memory stays flat.
 *
 * `frames` is how many frames the bytes represent, and it is a parameter
 * rather than an increment because the WebCodecs path batches: one write
 * carries roughly a megabyte of h264, which is ~20 frames at 1080p.
 * Counting writes instead would put `framesWritten` an order of
 * magnitude low, and that number sets the mux's `-t` — the file would be
 * cut to a twentieth of its length with the audio truncated to match.
 */
export function writeFrame(
  sessionId: string,
  jpeg: Uint8Array,
  frames = 1
): Promise<{ ok: boolean; error?: string }> {
  const session = sessions.get(sessionId);
  if (!session) return Promise.resolve({ ok: false, error: 'No such export session.' });
  if (session.failed) return Promise.resolve({ ok: false, error: session.failed.message });

  return new Promise((resolve) => {
    const buffer = Buffer.from(jpeg);
    const ok = session.proc.stdin?.write(buffer, (err) =>
      err ? resolve({ ok: false, error: err.message }) : undefined
    );
    session.framesWritten += frames;

    // `write` returning false means the buffer is full — wait for drain
    // instead of queueing gigabytes of frames in memory.
    if (ok === false) session.proc.stdin?.once('drain', () => resolve({ ok: true }));
    else resolve({ ok: true });
  });
}

/**
 * Append one worker's picture to its own chunk file.
 *
 * Unlike `writeFrame` there is no backpressure to apply: a file accepts
 * everything at disk speed, and the memory the pipe was protecting is
 * not at risk. What IS at risk is losing a write, so the callback is
 * awaited rather than fired and forgotten.
 */
export function writeChunk(
  sessionId: string, index: number, bytes: Uint8Array, frames: number
): Promise<{ ok: boolean; error?: string }> {
  const session = sessions.get(sessionId);
  if (!session) return Promise.resolve({ ok: false, error: 'No such export session.' });
  if (session.failed) return Promise.resolve({ ok: false, error: session.failed.message });

  let chunk = session.chunks.get(index);
  if (!chunk) {
    const chunkPath = path.join(path.dirname(session.videoPath), `chunk-${index}.bin`);
    chunk = { stream: fs.createWriteStream(chunkPath), path: chunkPath, frames: 0, done: false };
    session.chunks.set(index, chunk);
  }
  if (chunk.done) return Promise.resolve({ ok: false, error: `Chunk ${index} is already closed.` });

  chunk.frames += frames;
  return new Promise((resolve) => {
    chunk!.stream.write(Buffer.from(bytes), (err) =>
      resolve(err ? { ok: false, error: err.message } : { ok: true })
    );
  });
}

/**
 * Throw away whatever a failed attempt wrote and start the chunk again.
 *
 * `writeChunk` APPENDS, so a retry without this would land on top of the
 * half-written bytes of the attempt that died: a chunk containing the
 * first two seconds twice, joined into the render without complaint.
 */
export function resetChunk(sessionId: string, index: number): Promise<{ ok: boolean }> {
  const session = sessions.get(sessionId);
  const chunk = session?.chunks.get(index);
  if (!session || !chunk) return Promise.resolve({ ok: true });

  session.chunks.delete(index);
  return new Promise((resolve) => {
    chunk.stream.destroy();
    try { fs.rmSync(chunk.path, { force: true }); } catch { /* never written */ }
    resolve({ ok: true });
  });
}

/** Finish one chunk. Its file is complete after this resolves. */
export function closeChunk(sessionId: string, index: number): Promise<{ ok: boolean; frames: number }> {
  const session = sessions.get(sessionId);
  const chunk = session?.chunks.get(index);
  if (!session || !chunk) return Promise.resolve({ ok: false, frames: 0 });
  if (chunk.done) return Promise.resolve({ ok: true, frames: chunk.frames });
  chunk.done = true;
  return new Promise((resolve) =>
    chunk.stream.end(() => resolve({ ok: true, frames: chunk.frames }))
  );
}

/**
 * Feed every chunk into ffmpeg, in timeline order.
 *
 * Order is the entire contract. The chunks are byte-concatenable but not
 * commutative: play them out of sequence and the render is shuffled,
 * with no error anywhere, which is why a missing chunk is a hard failure
 * rather than a gap to skip over.
 */
export async function drainChunks(sessionId: string, count: number): Promise<{ ok: boolean; error?: string }> {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, error: 'No such export session.' };

  /*
    Read through a helper rather than testing `session.failed` directly.
    ffmpeg sets it from a `close` handler, so it changes underneath this
    loop — but a direct test narrows the field to `never` for the rest of
    the function and the compiler then refuses the re-check that is the
    entire point of looking again.
  */
  const failure = () => sessions.get(sessionId)?.failed ?? null;
  const early = failure();
  if (early) return { ok: false, error: early.message };

  for (let i = 0; i < count; i++) {
    const chunk = session.chunks.get(i);
    if (!chunk || !chunk.done) {
      return { ok: false, error: `Chunk ${i} of ${count} never finished, so the render is incomplete.` };
    }

    const ok = await new Promise<boolean>((resolve) => {
      const read = fs.createReadStream(chunk.path);
      read.on('error', () => resolve(false));
      // `end: false` — the pipe stays open for the chunks after this one.
      read.pipe(session.proc.stdin!, { end: false });
      read.on('end', () => resolve(true));
    });
    if (!ok) return { ok: false, error: `Chunk ${i} could not be read back.` };
    const late = failure();
    if (late) return { ok: false, error: late.message };

    session.framesWritten += chunk.frames;
    try { fs.rmSync(chunk.path, { force: true }); } catch { /* the temp dir goes anyway */ }
  }
  return { ok: true };
}

/* ── Audio ────────────────────────────────────────────────────────
   Rebuilt from the sources rather than captured from the preview, so a
   render is reproducible and does not depend on playback state.       */

export interface AudioMixReport {
  path: string | null;
  /** How many sources made it into the mix. */
  included: number;
  /** Sources ffmpeg could not open, with the reason. */
  dropped: { source: string; reason: string }[];
  /** Set when the mix failed for a reason other than a bad source. */
  error?: string;
}

/** Can ffmpeg actually open this? Cheap, and the answer decides the mix. */
function probeSource(ff: string, source: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      ff,
      ['-nostdin', '-v', 'error', '-i', source, '-t', '0.1', '-f', 'null', '-'],
      { timeout: 30_000, maxBuffer: 1024 * 512 },
      (err, _out, stderr) => {
        const text = (stderr || '').trim();
        // ffmpeg reports an unopenable input on stderr while still exiting 0,
        // so the exit code alone is not the answer.
        const broke = Boolean(err) || /Error opening input|Invalid data|No such file|Protocol not found|Server returned/i.test(text);
        resolve(broke ? (text.split('\n').find((l) => /Error|Invalid|No such|Server/i.test(l)) ?? 'unreadable') : null);
      }
    );
  });
}

/**
 * Shift pitch without changing duration.
 *
 * Resampling alone moves both. `asetrate` retunes the file (and speeds it
 * up), then `atempo` puts the duration back. atempo is limited to
 * 0.5..2.0 per stage, which is +-12 semitones, so a wider shift needs
 * chaining — a -24 semitone drop is two stages, not one impossible one.
 */
function pitchShift(semitones: number): string[] {
  const ratio = Math.pow(2, semitones / 12);
  const out = [`asetrate=48000*${ratio.toFixed(6)}`, 'aresample=48000'];
  let remaining = 1 / ratio;
  while (remaining > 2) { out.push('atempo=2.0'); remaining /= 2; }
  while (remaining < 0.5) { out.push('atempo=0.5'); remaining /= 0.5; }
  out.push(`atempo=${remaining.toFixed(6)}`);
  return out;
}

function mixArgsFor(clips: ExportClipAudio[], outPath: string): string[] {
  const inputs: string[] = [];
  const filters: string[] = [];

  clips.forEach((clip, i) => {
    const source = ffmpegSource(clip.mediaUrl);

    /*
      Remote hosts often refuse ffmpeg's default identity. The demo
      project's music returns 403 without a browser User-Agent, which
      silently produced a video with no sound.
    */
    if (/^https?:/.test(source)) {
      inputs.push(
        '-user_agent',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0 Safari/537.36'
      );
    }
    // Seek before the input so ffmpeg skips rather than decodes-and-drops.
    inputs.push('-ss', (clip.sourceStartMs / 1000).toFixed(3), '-i', source);

    const chain: string[] = [];
    // Length of source needed, accounting for speed.
    const takeSeconds = (clip.durationMs * clip.speed) / 1000;
    chain.push(`atrim=0:${takeSeconds.toFixed(3)}`);

    /*
      Reverse the trimmed window, not the whole file. `areverse` buffers
      its entire input, so it must sit AFTER the atrim that bounds it —
      in front of it, a long source would be read to the end and held in
      memory before a single sample came out.

      Before the speed stages, so `atempo` still stretches a
      forward-in-time buffer and the two operations do not have to
      reason about each other.
    */
    if (clip.reversed) chain.push('areverse');

    if (clip.speed !== 1) {
      // atempo is limited to 0.5–2.0 per stage, so chain them.
      let remaining = clip.speed;
      const stages: number[] = [];
      while (remaining > 2) { stages.push(2); remaining /= 2; }
      while (remaining < 0.5) { stages.push(0.5); remaining /= 0.5; }
      stages.push(remaining);
      for (const s of stages) chain.push(`atempo=${s.toFixed(4)}`);
    }

    chain.push('asetpts=PTS-STARTPTS');

    /*
      Per-clip processing. All four of these were stored on the clip,
      offered by `list_properties`, settable by `patch_clip` — and applied
      by neither playback nor export. `unsupportedAudioSettings` at least
      said so out loud rather than pretending, which is the only reason
      this was a known gap rather than a silent one.
    */
    if (clip.noiseReduction) {
      // Spectral denoise. `nf` is the noise floor; -25dB is conservative
      // enough not to chew the top off speech.
      chain.push('afftdn=nf=-25');
    }

    const semitones = clip.pitch ?? 0;
    if (semitones !== 0) chain.push(...pitchShift(semitones));

    switch (clip.voiceEffect) {
      case 'deep':
        chain.push(...pitchShift(-5));
        break;
      case 'high':
        chain.push(...pitchShift(5));
        break;
      case 'robot':
        // Ring modulation via a short flat delay plus heavy vibrato.
        chain.push('vibrato=f=32:d=0.9', 'aecho=0.8:0.9:5:0.6');
        break;
      case 'echo':
        chain.push('aecho=0.8:0.85:180|340:0.5|0.28');
        break;
      case 'telephone':
        chain.push('highpass=f=400', 'lowpass=f=3200', 'volume=1.4');
        break;
      case 'stadium':
        chain.push('aecho=0.7:0.85:420|780|1200:0.5|0.35|0.22', 'lowpass=f=9000');
        break;
      default:
        break;
    }

    /*
      A keyframed volume REPLACES the static one — the envelope was
      sampled from the same `audio.volume` the static value comes from,
      already multiplied by the track fader, so applying both would
      square it.

      Disjoint half-open segments summed, rather than nested `if()`:
      `gte(t,a)*lt(t,b)` is 1 inside exactly one segment and 0
      everywhere else, so the terms add to a piecewise-linear curve with
      no nesting depth to worry about. `t` here is clip-local seconds —
      the chain has already run `asetpts=PTS-STARTPTS` and has not yet
      run `adelay` — and it is post-`areverse`, so the envelope follows
      what the listener hears rather than the source.
    */
    const env = clip.volumeEnvelope;
    if (env && env.length >= 2) {
      const terms: string[] = [];
      const first = env[0];
      const last = env[env.length - 1];
      terms.push(`lt(t,${(first.tMs / 1000).toFixed(4)})*${first.v.toFixed(4)}`);
      for (let k = 0; k < env.length - 1; k++) {
        const a = env[k].tMs / 1000;
        const b = env[k + 1].tMs / 1000;
        if (b <= a) continue;
        const va = env[k].v;
        const vb = env[k + 1].v;
        terms.push(
          `(gte(t,${a.toFixed(4)})*lt(t,${b.toFixed(4)}))*` +
          `(${va.toFixed(4)}+(${(vb - va).toFixed(4)})*(t-${a.toFixed(4)})/${(b - a).toFixed(4)})`
        );
      }
      terms.push(`gte(t,${(last.tMs / 1000).toFixed(4)})*${last.v.toFixed(4)}`);
      chain.push(`volume=volume='${terms.join('+')}':eval=frame`);
    } else if (clip.volume !== 1) {
      chain.push(`volume=${clip.volume.toFixed(3)}`);
    }
    if (clip.fadeInMs > 0) chain.push(`afade=t=in:st=0:d=${(clip.fadeInMs / 1000).toFixed(3)}`);
    if (clip.fadeOutMs > 0) {
      const start = Math.max(0, (clip.durationMs - clip.fadeOutMs) / 1000);
      chain.push(`afade=t=out:st=${start.toFixed(3)}:d=${(clip.fadeOutMs / 1000).toFixed(3)}`);
    }
    // Place it at its timeline position.
    chain.push(`adelay=${Math.round(clip.startTimeMs)}:all=1`);
    chain.push('aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo');

    filters.push(`[${i}:a]${chain.join(',')}[a${i}]`);
  });

  /*
    Ducking.

    A clip marked `ducking` is the one that should get out of the way —
    music under a voiceover — so it cannot just be compressed against
    itself. The mix splits into two buses: everything ducked, and
    everything not. The un-ducked bus is the key, and it is used twice
    (once as the sidechain, once in the final mix), which is what the
    `asplit` is for — a filter output cannot be consumed by two filters.

    With every clip ducked, or none, there is nothing to duck against and
    it falls back to a plain mix rather than doing something arbitrary.
  */
  const ducked = clips.map((c, i) => (c.ducking ? i : -1)).filter((i) => i >= 0);
  const keys = clips.map((c, i) => (c.ducking ? -1 : i)).filter((i) => i >= 0);

  // `normalize=0` keeps a single clip at its own level instead of
  // attenuating everything by the number of inputs.
  if (ducked.length > 0 && keys.length > 0) {
    filters.push(
      `${ducked.map((i) => `[a${i}]`).join('')}amix=inputs=${ducked.length}:dropout_transition=0:normalize=0[dbus]`
    );
    filters.push(
      `${keys.map((i) => `[a${i}]`).join('')}amix=inputs=${keys.length}:dropout_transition=0:normalize=0[kbus]`
    );
    filters.push('[kbus]asplit=2[kmix][kside]');
    filters.push(
      '[dbus][kside]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=320:makeup=1[dcomp]'
    );
    filters.push('[dcomp][kmix]amix=inputs=2:dropout_transition=0:normalize=0[out]');
  } else {
    const mixInputs = clips.map((_, i) => `[a${i}]`).join('');
    filters.push(`${mixInputs}amix=inputs=${clips.length}:dropout_transition=0:normalize=0[out]`);
  }

  return [
    '-y', '-nostdin', ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '[out]',
    '-c:a', 'aac', '-b:a', '320k',
    outPath,
  ];
}

function runMix(ff: string, args: string[], outPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(ff, args, { timeout: 900_000, maxBuffer: 1024 * 1024 * 16 }, (err) => {
      resolve(err || !fs.existsSync(outPath) ? null : outPath);
    });
  });
}

/**
 * Build the audio bed, and say what happened.
 *
 * One unreadable source used to silence the ENTIRE render: the mix threw,
 * the failure was swallowed as "audio is not worth failing a render over",
 * and the export returned `ok: true, hasAudio: false`. The user asked for
 * a video with sound, got a silent file, and was told it worked. The seed
 * project reproduced it every time — its music URL 403s to ffmpeg.
 *
 * Failing the whole render is still the wrong answer. Dropping the one bad
 * source, keeping the rest, and REPORTING the loss is the right one.
 */
async function buildAudioMix(clips: ExportClipAudio[], outPath: string): Promise<AudioMixReport> {
  const ff = ffmpeg();
  if (!ff) return { path: null, included: 0, dropped: [], error: 'ffmpeg was not found.' };
  if (clips.length === 0) return { path: null, included: 0, dropped: [] };

  // Optimistic first: when every source is readable this costs nothing.
  const first = await runMix(ff, mixArgsFor(clips, outPath), outPath);
  if (first) return { path: first, included: clips.length, dropped: [] };

  // Something failed. Find out which sources, rather than guessing.
  const sources = clips.map((c) =>
    ffmpegSource(c.mediaUrl)
  );
  const reasons = await Promise.all(sources.map((src) => probeSource(ff, src)));

  const dropped: { source: string; reason: string }[] = [];
  const usable: ExportClipAudio[] = [];
  clips.forEach((clip, i) => {
    if (reasons[i]) dropped.push({ source: sources[i], reason: reasons[i]! });
    else usable.push(clip);
  });

  if (usable.length === 0) {
    return {
      path: null,
      included: 0,
      dropped,
      error: dropped.length ? undefined : 'The audio mix failed for a reason no source explains.',
    };
  }

  const retry = await runMix(ff, mixArgsFor(usable, outPath), outPath);
  return retry
    ? { path: retry, included: usable.length, dropped }
    : { path: null, included: 0, dropped, error: 'The audio mix failed even after dropping unreadable sources.' };
}

/**
 * How long the written video actually is, in seconds, or null.
 *
 * Reads the container, so it costs ~20ms whatever the length — no
 * decoding, no frame counting.
 */
function probeDuration(ff: string, file: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      // Same directory, same suffix — `.exe` included on Windows.
      ff.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1'),
      ['-v', 'error', '-select_streams', 'v:0',
       '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
      { timeout: 30_000 },
      (err, out) => {
        if (err) { resolve(null); return; }
        const n = Number.parseFloat(String(out).trim());
        resolve(Number.isFinite(n) ? n : null);
      }
    );
  });
}

export interface FinishResult {
  ok: boolean;
  outputPath?: string;
  frames?: number;
  hasAudio?: boolean;
  bytes?: number;
  error?: string;
  /*
    Why the file has the audio it has. `hasAudio: false` alone cannot
    distinguish "the timeline is silent" from "the mix was dropped", and
    the caller has to be able to tell the user which.
  */
  audio?: {
    requested: number;
    included: number;
    dropped: { source: string; reason: string }[];
    note?: string;
  };
}

export async function finishExport(
  sessionId: string,
  audioClips: ExportClipAudio[]
): Promise<FinishResult> {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, error: 'No such export session.' };

  const ff = ffmpeg();
  const workDir = path.dirname(session.videoPath);

  const cleanup = () => {
    sessions.delete(sessionId);
    releasePowerLock();
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* best effort */ }
  };

  // Close the pipe and let ffmpeg flush.
  session.proc.stdin?.end();
  await session.closed;

  if (session.failed) {
    const error = session.failed.message;
    cleanup();
    return { ok: false, error };
  }

  if (!fs.existsSync(session.videoPath) || fs.statSync(session.videoPath).size < 1024) {
    cleanup();
    return { ok: false, error: `Encoding produced no video. ${session.stderr.slice(-400)}` };
  }

  /*
    Is the file as long as the render that produced it?

    This is here because of a measured failure, not a hypothetical one. A
    raw Annex B stream carries no timestamps, so ffmpeg numbers the
    frames in arrival order — and if the encoder emitted B-frames, the
    DTS it derives are not monotonic and the mp4 muxer DROPS the
    offending samples. Measured on a 90-frame test stream: 90 frames in,
    88 out, 2.933s instead of 3.000s, exit code 0, no warning. The same
    stream with `-bf 0` came out 90/90 at exactly 3.000s.

    `frameEncoder.ts` asks for `latencyMode: 'realtime'` precisely so
    that cannot happen. This checks that it did not, because the failure
    it guards against produces a file that plays.
  */
  const expectedSeconds = session.framesWritten / session.options.fps;
  const rawStream = session.options.frameFormat === 'h264' || session.options.frameFormat === 'hevc';
  if (ff && rawStream && session.framesWritten > 0) {
    const actual = await probeDuration(ff, session.videoPath);
    const tolerance = 2 / session.options.fps;
    if (actual !== null && Math.abs(actual - expectedSeconds) > tolerance) {
      const lost = Math.round((expectedSeconds - actual) * session.options.fps);
      cleanup();
      return {
        ok: false,
        error:
          `The container kept ${actual.toFixed(3)}s of a ${expectedSeconds.toFixed(3)}s render ` +
          `(${lost} frame${Math.abs(lost) === 1 ? '' : 's'} lost at the mux). ` +
          'Export again with the ffmpeg encoder, which re-encodes rather than stream-copying.',
      };
    }
  }

  // Audio, if the timeline has any.
  const mix = await buildAudioMix(audioClips, path.join(workDir, 'audio.m4a'));
  const audioReport = {
    requested: audioClips.length,
    included: mix.included,
    dropped: mix.dropped,
    ...(mix.error ? { note: mix.error } : {}),
  };

  fs.mkdirSync(path.dirname(session.outputPath), { recursive: true });

  if (!mix.path || !ff) {
    fs.copyFileSync(session.videoPath, session.outputPath);
    const bytes = fs.statSync(session.outputPath).size;
    cleanup();
    return {
      ok: true, outputPath: session.outputPath, frames: session.framesWritten,
      hasAudio: false, bytes, audio: audioReport,
    };
  }

  /*
    Mux: stream-copy both, so nothing is re-encoded and nothing degrades.

    `-t` rather than `-shortest`. The PICTURE is the master — an edit is
    as long as its visuals — and `-shortest` made the audio decide: a
    music bed that stopped before the last shot truncated the export to
    the length of the sound. Observed as a 16-second sequence exported at
    5.5s because the only surviving audio ended there.

    Capping at the video's own duration also covers the other direction,
    where a long music tail would otherwise leave audio playing over
    nothing.
  */
  const videoSeconds = expectedSeconds;
  // `ff` is `string | null`; without this the mux threw on a machine
  // with no ffmpeg instead of falling back to the silent copy above.
  const ffPath: string | null = ff;
  const audioPath: string | null = mix.path;
  const muxed = ffPath === null || audioPath === null ? false : await new Promise<boolean>((resolve) => {
    execFile(
      ffPath,
      ['-y', '-i', session.videoPath, '-i', audioPath,
       '-c', 'copy', '-map', '0:v:0', '-map', '1:a:0',
       '-t', videoSeconds.toFixed(6), session.outputPath],
      { timeout: 600_000 },
      (err) => resolve(!err && fs.existsSync(session.outputPath))
    );
  });

  if (!muxed) {
    // Better to deliver a silent file than nothing at all — but say so.
    fs.copyFileSync(session.videoPath, session.outputPath);
    const bytes = fs.statSync(session.outputPath).size;
    cleanup();
    return {
      ok: true, outputPath: session.outputPath, frames: session.framesWritten,
      hasAudio: false, bytes,
      audio: { ...audioReport, note: 'The audio mixed but could not be muxed into the container.' },
    };
  }

  const bytes = fs.statSync(session.outputPath).size;
  cleanup();
  return {
    ok: true, outputPath: session.outputPath, frames: session.framesWritten,
    hasAudio: true, bytes, audio: audioReport,
  };
}

export function cancelExport(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  try { session.proc.stdin?.end(); session.proc.kill('SIGKILL'); } catch { /* already gone */ }
  try { fs.rmSync(path.dirname(session.videoPath), { recursive: true, force: true }); } catch { /* best effort */ }
  sessions.delete(sessionId);
  releasePowerLock();
}
