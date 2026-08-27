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
import { app } from 'electron';
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
}

const sessions = new Map<string, Session>();
let counter = 0;

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

  const args = [
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
  return { sessionId: id };
}

/** Push one composited frame. Applies backpressure so memory stays flat. */
export function writeFrame(sessionId: string, jpeg: Uint8Array): Promise<{ ok: boolean; error?: string }> {
  const session = sessions.get(sessionId);
  if (!session) return Promise.resolve({ ok: false, error: 'No such export session.' });
  if (session.failed) return Promise.resolve({ ok: false, error: session.failed.message });

  return new Promise((resolve) => {
    const buffer = Buffer.from(jpeg);
    const ok = session.proc.stdin?.write(buffer, (err) =>
      err ? resolve({ ok: false, error: err.message }) : undefined
    );
    session.framesWritten++;

    // `write` returning false means the buffer is full — wait for drain
    // instead of queueing gigabytes of frames in memory.
    if (ok === false) session.proc.stdin?.once('drain', () => resolve({ ok: true }));
    else resolve({ ok: true });
  });
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
  const videoSeconds = session.framesWritten / session.options.fps;
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
}
