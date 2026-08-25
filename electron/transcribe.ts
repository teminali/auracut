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
  /** Called with 0..100 as Whisper reports frames. */
  onProgress?: (percent: number, note: string) => void;
}

export async function transcribeMedia(
  options: TranscribeOptions
): Promise<TranscribeResult | TranscribeFailure> {
  const startedAt = Date.now();

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

  const workDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'auracut-stt-'));
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

    const source = options.mediaUrl.startsWith('file://')
      ? decodeURIComponent(options.mediaUrl.replace('file://', ''))
      : options.mediaUrl;

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
    options.onProgress?.(15, `Transcribing with Whisper (${model})…`);

    const args = [
      wavPath,
      '--model', model,
      '--output_format', 'json',
      '--output_dir', workDir,
      '--word_timestamps', 'True',
      '--verbose', 'False',
      // Never let a missing model trigger a download mid-edit: it can hang
      // for minutes behind a TLS proxy and fail with an unrelated error.
      '--model_dir', path.join(os.homedir(), '.cache', 'whisper'),
    ];
    if (options.language && options.language !== 'auto') args.push('--language', options.language);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(wh, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';

      // Whisper writes a tqdm progress bar to stderr; scrape it for a percentage.
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
        const match = /(\d{1,3})%\|/.exec(chunk);
        if (match) {
          const pct = Math.min(99, 15 + Number(match[1]) * 0.8);
          options.onProgress?.(pct, `Transcribing… ${match[1]}%`);
        }
      });

      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(stderr.trim().slice(-500) || `whisper exited ${code}`))
      );
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
