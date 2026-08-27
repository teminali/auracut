/* ═══════════════════════════════════════════════════════════════════
   Speech to text.

   Real transcription, in the main process, because it needs ffmpeg and
   a local Whisper — neither of which exists in a renderer.

   This replaces a stub that slept 1200ms and returned the same
   hardcoded Kiswahili sentence for every input, while its tool
   advertised "on-device speech-to-text". That is the most damaging
   shape a bug can take: it looks like it worked. Caption a wedding
   video and you would have got somebody else's marketing copy, with an
   agent confidently reporting success.

   So the contract here is: transcribe honestly, or fail honestly.
   Never invent words.
   ═══════════════════════════════════════════════════════════════════ */

import { ffmpegSource } from './mediaPath';
import { execFile, execFileSync, spawn } from 'child_process';
import { app } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs';

export interface TranscriptWordOut {
  word: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscribeResult {
  ok: true;
  language: string;
  text: string;
  segments: TranscriptSegment[];
  words: TranscriptWordOut[];
  model: string;
  elapsedMs: number;
}

export interface TranscribeFailure {
  ok: false;
  /** Machine-readable so the caller can log the right capability gap. */
  reason: 'no-ffmpeg' | 'no-whisper' | 'no-model' | 'extract-failed' | 'transcribe-failed';
  message: string;
}

/* ── Locating the binaries ────────────────────────────────────────
   A GUI app launched from Finder gets a minimal PATH without Homebrew
   or a Python framework bin, so bare names will not resolve.          */

function findBinary(name: string, extra: string[] = []): string | null {
  const candidates = [
    ...extra,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ];

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* keep looking */
    }
  }

  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const found = execFileSync(shell, ['-lic', `command -v ${name}`], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split('\n')
      .pop();
    return found && fs.existsSync(found) ? found : null;
  } catch {
    return null;
  }
}

const PYTHON_FRAMEWORK_BINS = [
  '/Library/Frameworks/Python.framework/Versions/3.12/bin/whisper',
  '/Library/Frameworks/Python.framework/Versions/3.11/bin/whisper',
  path.join(os.homedir(), '.local', 'bin', 'whisper'),
];

let ffmpegPath: string | null | undefined;
let whisperPath: string | null | undefined;

export function ffmpeg(): string | null {
  if (ffmpegPath === undefined) ffmpegPath = findBinary('ffmpeg');
  return ffmpegPath;
}

export function whisper(): string | null {
  if (whisperPath === undefined) whisperPath = findBinary('whisper', PYTHON_FRAMEWORK_BINS);
  return whisperPath;
}

/**
 * Which Whisper models are already downloaded.
 *
 * Checked up front because the model host is often unreachable behind a
 * corporate TLS proxy, and a download attempt then fails several seconds
 * in with an SSL error that says nothing about transcription.
 */
export function cachedModels(): string[] {
  const dir = path.join(os.homedir(), '.cache', 'whisper');
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.pt'))
      .map((f) => f.replace(/\.pt$/, ''));
  } catch {
    return [];
  }
}

/** Best available model, preferring accuracy that is already on disk. */
function pickModel(preferred?: string): string | null {
  const available = cachedModels();
  if (available.length === 0) return null;
  if (preferred && available.includes(preferred)) return preferred;

  // Ordered by quality; `small` is the sweet spot for caption work.
  for (const candidate of ['small', 'medium', 'base', 'large-v3', 'large-v2', 'large', 'tiny']) {
    if (available.includes(candidate)) return candidate;
  }
  return available[0];
}

export function transcriberStatus() {
  const models = cachedModels();
  return {
    ffmpeg: ffmpeg(),
    whisper: whisper(),
    models,
    ready: Boolean(ffmpeg() && whisper() && models.length > 0),
  };
}

export interface TranscribeOptions {
  /** file:// path or an http(s) URL — ffmpeg reads both. */
  mediaUrl: string;
  language?: string;
  model?: string;
  /**
   * Per-word times as well as per-segment ones.
   *
   * Off by default, and that default is the difference between a
   * transcription that takes about as long as the take and one that
   * takes several times longer: it is a second alignment pass over every
   * window. Captions are built from segments and do not need it. Karaoke
   * highlighting does, and asks.
   */
  wordTimestamps?: boolean;
  /** Called with 0..100 as Whisper reports frames. */
  onProgress?: (percent: number, note: string) => void;
}

/**
 * The Whisper child, so it can be stopped.
 *
 * A twenty-minute take is twenty-plus minutes of transcription, and an
 * edit that cannot be started until it finishes is an edit held hostage
 * by an optional feature. Only one runs at a time.
 */
let running: ReturnType<typeof spawn> | null = null;
let cancelled = false;

/** Abandon a transcription in flight. The caller carries on without captions. */
export function cancelTranscription(): boolean {
  if (!running) return false;
  cancelled = true;
  running.kill('SIGTERM');
  return true;
}

/** mm:ss, for a sentence about how long something will take. */
function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.max(0, seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export async function transcribeMedia(
  options: TranscribeOptions
): Promise<TranscribeResult | TranscribeFailure> {
  const startedAt = Date.now();
  cancelled = false;

  const ff = ffmpeg();
  if (!ff) {
    return {
      ok: false,
      reason: 'no-ffmpeg',
      message: 'ffmpeg was not found. Install it with `brew install ffmpeg` to enable transcription.',
    };
  }

  const wh = whisper();
  if (!wh) {
    return {
      ok: false,
      reason: 'no-whisper',
      message: 'Whisper was not found. Install it with `pip install -U openai-whisper` to enable transcription.',
    };
  }

  const model = pickModel(options.model);
  if (!model) {
    return {
      ok: false,
      reason: 'no-model',
      message:
        'No Whisper model is downloaded. Run `whisper --model small <any audio file>` once while online to fetch one.',
    };
  }

  const workDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'kerf-stt-'));
  const wavPath = path.join(workDir, 'audio.wav');

  const cleanup = () => {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };

  try {
    /* ── 1. Extract mono 16 kHz PCM, which is what Whisper wants ── */
    options.onProgress?.(5, 'Extracting audio…');

    const source = ffmpegSource(options.mediaUrl);

    await new Promise<void>((resolve, reject) => {
      execFile(
        ff,
        ['-y', '-i', source, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath],
        { timeout: 180_000, maxBuffer: 1024 * 1024 * 8 },
        (err, _out, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve())
      );
    });

    if (!fs.existsSync(wavPath) || fs.statSync(wavPath).size < 1024) {
      cleanup();
      return {
        ok: false,
        reason: 'extract-failed',
        message: 'That media has no audio track to transcribe.',
      };
    }

    /* ── 2. Transcribe ── */
    /*
      Named and quantified, because this is the one step that can run for
      minutes with nothing to show. Whisper reports nothing at all until
      its first window is decoded, and a bar sitting on one number is
      indistinguishable from a hang — which is exactly what somebody
      reported.
    */
    const audioSeconds = Math.round(fs.statSync(wavPath).size / 32000);
    options.onProgress?.(
      15,
      `Transcribing ${formatClock(audioSeconds)} with the ${model} model. `
      + 'This runs on the processor and usually takes longer than the take itself.'
    );

    /*
      ── `--word_timestamps` is opt-in, and it is NOT the slow part ──

      It runs a separate cross-attention alignment pass per window, so
      turning it off looked like the fix. Measured on the same 92 seconds
      of audio with the same `small` model: 769s with, 709s without.
      Eight percent, and the machine was busy for both runs, so treat
      even that as approximate.

      It stays off because captions are built from SEGMENTS, which carry
      their own start and end, and nothing on that path reads per-word
      times — only karaoke highlighting does, and it asks. Eight percent
      free is worth having. It is not a solution.

      **The slow part is that this runs on the CPU in FP32.** Whisper
      itself says so on every run: `FP16 is not supported on CPU; using
      FP32 instead`, decoding at 13 to 16 frames per second. That is why
      92 seconds of narration takes twelve minutes, and why transcription
      was moved off the critical path entirely rather than tuned. A
      Metal-backed whisper.cpp would change the order of magnitude; no
      flag here will.
    */
    const args = [
      wavPath,
      '--model', model,
      '--output_format', 'json',
      '--output_dir', workDir,
      ...(options.wordTimestamps ? ['--word_timestamps', 'True'] : []),
      /*
        `False`, not `None`. Whisper's own tqdm bar is disabled when
        `verbose is not False`, so this is the setting that makes a
        progress bar exist at all — and it is the only progress this
        process ever reports.
      */
      '--verbose', 'False',
      // Never let a missing model trigger a download mid-edit: it can hang
      // for minutes behind a TLS proxy and fail with an unrelated error.
      '--model_dir', path.join(os.homedir(), '.cache', 'whisper'),
    ];
    if (options.language && options.language !== 'auto') args.push('--language', options.language);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(wh, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      running = child;
      let stderr = '';

      /*
        Whisper writes a tqdm bar to stderr, redrawn with carriage
        returns, so one chunk can carry several updates. Taking the FIRST
        match reported the oldest number in the chunk, which is how a bar
        ends up sitting on a stale percentage; the last one is the
        current state.
      */
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
        const matches = [...chunk.matchAll(/(\d{1,3})%\|/g)];
        if (matches.length === 0) return;
        const percent = Number(matches[matches.length - 1][1]);
        options.onProgress?.(
          Math.min(99, 15 + percent * 0.8),
          `Transcribing with the ${model} model, ${percent}%`
        );
      });

      child.on('error', (err) => { running = null; reject(err); });
      child.on('close', (code) => {
        running = null;
        if (code === 0) { resolve(); return; }
        reject(new Error(
          cancelled
            ? 'Transcription was cancelled.'
            : stderr.trim().slice(-500) || `whisper exited ${code}`
        ));
      });
    });

    /* ── 3. Parse ── */
    const jsonPath = path.join(workDir, 'audio.json');
    if (!fs.existsSync(jsonPath)) {
      cleanup();
      return { ok: false, reason: 'transcribe-failed', message: 'Whisper produced no output.' };
    }

    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as {
      text?: string;
      language?: string;
      segments?: { start: number; end: number; text: string; words?: { word: string; start: number; end: number; probability?: number }[] }[];
    };

    const segments: TranscriptSegment[] = (parsed.segments ?? []).map((s) => ({
      startMs: Math.round(s.start * 1000),
      endMs: Math.round(s.end * 1000),
      text: s.text.trim(),
    }));

    const words: TranscriptWordOut[] = (parsed.segments ?? []).flatMap((s) =>
      (s.words ?? []).map((w) => ({
        word: w.word.trim(),
        startMs: Math.round(w.start * 1000),
        endMs: Math.round(w.end * 1000),
        confidence: w.probability ?? 1,
      }))
    );

    cleanup();
    options.onProgress?.(100, 'Done');

    return {
      ok: true,
      language: parsed.language ?? options.language ?? 'unknown',
      text: (parsed.text ?? '').trim(),
      segments,
      words,
      model,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    cleanup();
    return {
      ok: false,
      reason: 'transcribe-failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Audio understanding

   Transcription answers "what words were said". It does not answer any
   of the questions an editor actually asks first: is this too quiet, is
   it clipping, where are the dead patches, how noisy is the room, is
   there anything here at all.

   ffmpeg answers all of those from measurement — no model, no download,
   a second or two per clip. Whisper is for meaning; this is for sound.
   ═══════════════════════════════════════════════════════════════════ */

export interface SilenceRegion {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface AudioAnalysis {
  ok: true;
  durationMs: number;
  /** EBU R128 integrated loudness. Broadcast targets -23; social ~-14. */
  integratedLufs: number | null;
  loudnessRangeLu: number | null;
  truePeakDbfs: number | null;
  peakDbfs: number | null;
  rmsDbfs: number | null;
  noiseFloorDbfs: number | null;
  dynamicRangeDb: number | null;
  /** Samples pinned at full scale — anything above zero is audible damage. */
  clippedSamples: number | null;
  silences: SilenceRegion[];
  silentFraction: number;
  /** Plain-language read of the numbers, so an agent need not know dBFS. */
  notes: string[];
}

function num(match: RegExpMatchArray | null): number | null {
  return match ? Number(match[1]) : null;
}

export async function analyzeAudio(
  mediaUrl: string,
  silenceThresholdDb = -35,
  minSilenceMs = 400
): Promise<AudioAnalysis | TranscribeFailure> {
  const ff = ffmpeg();
  if (!ff) {
    return {
      ok: false,
      reason: 'no-ffmpeg',
      message: 'ffmpeg was not found. Install it with `brew install ffmpeg` to analyse audio.',
    };
  }

  const source = ffmpegSource(mediaUrl);

  // One pass, three filters: loudness, statistics, silence regions.
  const filter =
    `ebur128=peak=true,astats=metadata=1:reset=0,` +
    `silencedetect=n=${silenceThresholdDb}dB:d=${(minSilenceMs / 1000).toFixed(2)}`;

  const stderr = await new Promise<string>((resolve, reject) => {
    execFile(
      ff,
      ['-hide_banner', '-nostats', '-i', source, '-af', filter, '-f', 'null', '-'],
      { timeout: 300_000, maxBuffer: 1024 * 1024 * 64 },
      // ffmpeg writes analysis to stderr and exits 0; a real failure still
      // leaves the text we need, so parse either way.
      (err, _out, errOut) => (errOut ? resolve(errOut) : reject(err ?? new Error('No ffmpeg output')))
    );
  }).catch((e: Error) => `__ERROR__${e.message}`);

  if (stderr.startsWith('__ERROR__')) {
    return { ok: false, reason: 'transcribe-failed', message: stderr.replace('__ERROR__', '') };
  }

  // The ebur128 Summary block is the authoritative loudness read.
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const integratedLufs = num(summary.match(/I:\s*(-?[\d.]+)\s*LUFS/));
  const loudnessRangeLu = num(summary.match(/LRA:\s*(-?[\d.]+)\s*LU/));
  const truePeakDbfs = num(summary.match(/Peak:\s*(-?[\d.]+)\s*dBFS/));

  const overall = stderr.slice(stderr.lastIndexOf('Overall'));
  const peakDbfs = num(overall.match(/Peak level dB:\s*(-?[\d.]+)/));
  const rmsDbfs = num(overall.match(/RMS level dB:\s*(-?[\d.]+)/));
  const noiseFloorDbfs = num(overall.match(/Noise floor dB:\s*(-?[\d.]+)/));
  const dynamicRangeDb = num(overall.match(/Dynamic range:\s*(-?[\d.]+)/));
  const clippedSamples = num(overall.match(/Number of clipped samples:\s*(\d+)/));

  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const durationMs = durationMatch
    ? Math.round(
        (Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])) * 1000
      )
    : 0;

  /* Silence regions arrive as interleaved start/end lines. */
  const silences: SilenceRegion[] = [];
  const silenceRe = /silence_start:\s*(-?[\d.]+)|silence_end:\s*([\d.]+)/g;
  let pendingStart: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = silenceRe.exec(stderr)) !== null) {
    if (m[1] !== undefined) {
      pendingStart = Math.max(0, Number(m[1]) * 1000);
    } else if (m[2] !== undefined && pendingStart !== null) {
      const end = Number(m[2]) * 1000;
      silences.push({
        startMs: Math.round(pendingStart),
        endMs: Math.round(end),
        durationMs: Math.round(end - pendingStart),
      });
      pendingStart = null;
    }
  }
  // A trailing silence that runs to the end never gets its end line.
  if (pendingStart !== null && durationMs > pendingStart) {
    silences.push({
      startMs: Math.round(pendingStart),
      endMs: durationMs,
      durationMs: Math.round(durationMs - pendingStart),
    });
  }

  const silentMs = silences.reduce((n, s) => n + s.durationMs, 0);
  const silentFraction = durationMs > 0 ? silentMs / durationMs : 0;

  /* Turn the measurements into things an editor would actually say. */
  const notes: string[] = [];
  if (clippedSamples && clippedSamples > 0) {
    notes.push(`${clippedSamples} clipped samples — the audio is distorted and needs attention.`);
  }
  if (truePeakDbfs !== null && truePeakDbfs > -1) {
    notes.push(`True peak ${truePeakDbfs.toFixed(1)} dBFS is above -1; leave headroom before export.`);
  }
  if (integratedLufs !== null) {
    if (integratedLufs < -30) notes.push(`Very quiet at ${integratedLufs.toFixed(1)} LUFS — likely needs a large lift, or it may be near-silent.`);
    else if (integratedLufs < -20) notes.push(`Quiet for social at ${integratedLufs.toFixed(1)} LUFS (typical target -14).`);
    else if (integratedLufs > -9) notes.push(`Hot at ${integratedLufs.toFixed(1)} LUFS — most platforms will turn this down.`);
  }
  if (noiseFloorDbfs !== null && noiseFloorDbfs > -45) {
    notes.push(`High noise floor (${noiseFloorDbfs.toFixed(1)} dB) — audible hiss or room tone.`);
  }
  if (silentFraction > 0.35) {
    notes.push(`${Math.round(silentFraction * 100)}% of this clip is silence — a candidate for tightening.`);
  }
  if (loudnessRangeLu !== null && loudnessRangeLu < 3 && integratedLufs !== null && integratedLufs > -30) {
    /*
      Describe, do not diagnose. A narrow loudness range fits compressed
      music, a steady tone AND clean studio narration equally well —
      asserting "not speech" was wrong on the first real voiceover tested.
      Transcription is the thing that actually answers "is this speech".
    */
    notes.push(
      `Narrow loudness range (${loudnessRangeLu.toFixed(1)} LU) — consistent level throughout, typical of compressed music or close-mic narration.`
    );
  }
  if (notes.length === 0) notes.push('Levels look healthy — no clipping, reasonable loudness and noise floor.');

  return {
    ok: true,
    durationMs,
    integratedLufs,
    loudnessRangeLu,
    truePeakDbfs,
    peakDbfs,
    rmsDbfs,
    noiseFloorDbfs,
    dynamicRangeDb,
    clippedSamples,
    silences,
    silentFraction,
    notes,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   Self-setup

   Deliberately NOT bundling a Whisper model. It would add hundreds of
   megabytes to every download for a feature many projects never touch,
   and it would go stale. Installing on first need keeps the app small
   and lets the user pick the accuracy they want.
   ═══════════════════════════════════════════════════════════════════ */

export interface SetupResult {
  ok: boolean;
  step: string;
  message: string;
  log?: string;
}

function findPython(): string | null {
  return findBinary('python3', [
    '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3',
    '/opt/homebrew/bin/python3',
  ]);
}

export async function setupTranscription(model = 'small'): Promise<SetupResult> {
  const run = (bin: string, args: string[], timeout: number) =>
    new Promise<{ code: number; out: string }>((resolve) => {
      execFile(bin, args, { timeout, maxBuffer: 1024 * 1024 * 32 }, (err, stdout, stderr) =>
        resolve({ code: err ? 1 : 0, out: `${stdout}\n${stderr}`.trim() })
      );
    });

  if (!ffmpeg()) {
    const brew = findBinary('brew');
    if (!brew) {
      return {
        ok: false,
        step: 'ffmpeg',
        message: 'ffmpeg is missing and Homebrew was not found. Install ffmpeg manually, then retry.',
      };
    }
    const r = await run(brew, ['install', 'ffmpeg'], 900_000);
    ffmpegPath = undefined; // re-detect
    if (!ffmpeg()) {
      return { ok: false, step: 'ffmpeg', message: 'Installing ffmpeg failed.', log: r.out.slice(-1500) };
    }
  }

  if (!whisper()) {
    const python = findPython();
    if (!python) {
      return {
        ok: false,
        step: 'whisper',
        message: 'Python 3 was not found, so Whisper cannot be installed. Install Python 3, then retry.',
      };
    }
    const r = await run(python, ['-m', 'pip', 'install', '-U', 'openai-whisper'], 900_000);
    whisperPath = undefined; // re-detect
    if (!whisper()) {
      return {
        ok: false,
        step: 'whisper',
        message: 'Installing openai-whisper failed. Check the log for the pip error.',
        log: r.out.slice(-1500),
      };
    }
  }

  if (cachedModels().length === 0) {
    /*
      There is no "download only" flag, so fetch the model by transcribing
      a second of generated silence. Cheap, and it warms the exact cache
      path the real run will read from.
    */
    const ff = ffmpeg()!;
    const tmp = path.join(app.getPath('temp'), `kerf-warm-${Date.now()}.wav`);
    await run(ff, ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '1', tmp], 60_000);
    const r = await run(whisper()!, [tmp, '--model', model, '--output_format', 'txt',
      '--output_dir', app.getPath('temp'), '--verbose', 'False'], 1_800_000);
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }

    if (cachedModels().length === 0) {
      return {
        ok: false,
        step: 'model',
        message:
          `Downloading the "${model}" model failed. This is usually a TLS proxy blocking the model host.`,
        log: r.out.slice(-1500),
      };
    }
  }

  const status = transcriberStatus();
  return {
    ok: status.ready,
    step: 'done',
    message: status.ready
      ? `Transcription is ready. Models available: ${status.models.join(', ')}.`
      : 'Setup finished but transcription still reports not ready.',
  };
}
