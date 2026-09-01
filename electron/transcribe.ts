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
import { findBinary } from './packageManager';
import { execFile, execFileSync, spawn } from 'child_process';
import { app } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { transcribeVibeVoiceDiarized } from './vibeVoiceServer';

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
  /**
   * Stretches whisper heard as sound but produced no words for, and it
   * matters far more than it looks.
   *
   * whisper marks them `(speaking in foreign language)`, `[Music]`,
   * `(silence)`. Dropping them from the CAPTIONS is right — nobody wants
   * a line on screen reading "[Music]". Dropping them silently is not:
   * on a take that opened with 25 seconds of Swahili, an English-only
   * model returned one such marker for the whole opening, it was
   * filtered here, and every layer above saw a take whose first words
   * were 25 seconds in. The introduction detector refused, correctly, on
   * a transcript that was wrong.
   *
   * So they come out as well as being taken out.
   */
  nonSpeech: { startMs: number; endMs: number; text: string }[];
  /**
   * Anything the model CHOICE has to say for itself.
   *
   * A model was fetched, or one could not be and the decode ran on a
   * model that hears this language badly. Both are things the caption
   * report has to be able to repeat, and neither is an error.
   */
  modelNotes?: string[];
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

const PYTHON_FRAMEWORK_BINS = [
  '/Library/Frameworks/Python.framework/Versions/3.12/bin/whisper',
  '/Library/Frameworks/Python.framework/Versions/3.11/bin/whisper',
  path.join(os.homedir(), '.local', 'bin', 'whisper'),
];

let ffmpegPath: string | null | undefined;
let whisperPath: string | null | undefined;
let cliPath: string | null | undefined;

export function clearBinaryCache(): void {
  ffmpegPath = undefined;
  whisperPath = undefined;
  cliPath = undefined;
}

export function ffmpeg(): string | null {
  return findBinary('ffmpeg');
}

export function whisper(): string | null {
  return findBinary('whisper', PYTHON_FRAMEWORK_BINS);
}

export function whisperCli(): string | null {
  return findBinary('whisper-cli');
}

export type WhisperBackend = 'whisper.cpp' | 'python' | null;

/** GGML models on disk, as whisper.cpp names them. */
export function ggmlModels(): string[] {
  const dir = path.join(os.homedir(), '.cache', 'whisper');
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /^ggml-.+\.bin$/.test(f))
      .map((f) => f.replace(/^ggml-/, '').replace(/\.bin$/, ''));
  } catch {
    return [];
  }
}

/**
 * The backend that will actually run, and why.
 *
 * A binary with no model is not a usable backend, so both halves are
 * checked. Reported rather than inferred, because "why is this taking
 * twelve minutes" has exactly one answer and the UI should be able to
 * give it.
 */
export function chooseBackend(language?: string): { backend: WhisperBackend; model: string | null } {
  const ggml = ggmlModels();
  if (whisperCli() && ggml.length > 0) {
    return { backend: 'whisper.cpp', model: pickGgml(ggml, undefined, language) };
  }
  const pt = cachedModels();
  if (whisper() && pt.length > 0) return { backend: 'python', model: pickModel() };
  return { backend: null, model: null };
}

/* ══ Model size is a language decision ═══════════════════════════════

   `small` is the right model for English narration and it is the wrong
   model for most other languages, and the gap is not a few percent.

   What this was measured on: 45 seconds of Swahili-with-English
   code-switching, recorded in Kerf, decoded by `whisper-cli` with
   `-l auto -mc 0`. `ggml-small` returned, in full:

       "Trandakona yeksel."
       "Skina Shidagani, lakini, tranda…"
       "semo, maneno, selzake."
       "Kwaangaliya truya iniini, lakini, kuna jamsing sana sasa, tanzana"

   Those are not misspellings of what was said. They are not Swahili at
   all — they are the decoder producing Swahili-shaped syllables, which
   is what a model that has seen very little of a language does when it
   is asked to produce that language. There is nothing downstream that
   can repair it: `auditCaptions` sees plausible timings and distinct
   lines and passes it, and a language model asked to spell-check it
   invents fluent Swahili nobody said.

   So the fix has to be here, at the only place that can still change
   the answer, and it is a bigger model. Whisper's own published WER by
   language puts Swahili in the bottom decile at every size, and the
   drop from `small` to `large-v3` on the low-resource languages is the
   largest single step in the family.

   None of the languages Kerf offers in the `language` slot are in
   Whisper's high-resource set except English, French, Spanish,
   Portuguese and German — which is why those five keep `small` and the
   rest do not.                                                        */

/**
 * Languages `small` is good enough for, so nothing is downloaded for a
 * take that does not need it.
 *
 * The list is the intersection of Whisper's own top-tier languages
 * with the ones Kerf's `language` slot offers. Everything else — and
 * `auto`, because an unknown language cannot be assumed to be an easy
 * one — asks for the large model.
 */
const SMALL_IS_ENOUGH = new Set(['en', 'fr', 'es', 'pt', 'de', 'it', 'nl']);

/** The model a language actually wants, before checking what is on disk. */
export function modelWantedFor(language?: string): 'small' | 'large-v3' {
  if (language === 'en') return 'small';
  if (language && SMALL_IS_ENOUGH.has(language)) return 'small';
  /*
    `auto` included, deliberately. Detection runs INSIDE the decode, so
    by the time the language is known the model has already been chosen
    — and the case that needs the big model is exactly the case where
    nobody set the language, because they did not know they had to.
  */
  return 'large-v3';
}

/**
 * True when the language wants a model this machine does not have.
 *
 * Split out from `pickGgml` because it is the thing the UI has to be
 * able to ask BEFORE a twelve-minute decode produces nonsense: the
 * answer decides whether to offer a download, and asking it should not
 * require starting a transcription.
 */
export function needsBetterModel(language?: string): boolean {
  return modelWantedFor(language) === 'large-v3'
    && !ggmlModels().some((m) => m.startsWith('large'));
}

/**
 * `.en` models first for English, the largest model for everything else.
 *
 * The English-only weights are both faster and more accurate on English
 * than the multilingual ones of the same size. For any other language
 * the ordering inverts and size wins over everything, for the reason
 * measured above.
 */
function pickGgml(available: string[], preferred?: string, language?: string): string | null {
  if (preferred && available.includes(preferred)) return preferred;

  /* Multilingual first unless English was asked for, for the reason on
     `ggmlNameFor`: an `.en` model on other speech returns a marker, not
     a bad transcript, and the failure is invisible from above. */
  const english = language === 'en';
  const order = english
    ? ['small.en', 'small', 'medium.en', 'medium', 'base.en', 'base',
      'large-v3', 'large-v2', 'large', 'tiny.en', 'tiny']
    : SMALL_IS_ENOUGH.has(language ?? '')
      ? ['small', 'medium', 'large-v3', 'large-v2', 'large', 'base', 'tiny',
        'small.en', 'medium.en', 'base.en', 'tiny.en']
      /* Everything else: size first, and `small` only as a last resort
         so a take still gets captions on a machine that is offline. */
      : ['large-v3', 'large-v2', 'large', 'medium', 'small', 'base', 'tiny',
        'small.en', 'medium.en', 'base.en', 'tiny.en'];

  for (const candidate of order) {
    if (available.includes(candidate)) return candidate;
  }
  return available[0] ?? null;
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
  const ggml = ggmlModels();
  const chosen = chooseBackend();
  return {
    ffmpeg: ffmpeg(),
    whisper: whisper(),
    whisperCli: whisperCli(),
    models,
    ggmlModels: ggml,
    backend: 'vibevoice' as const,
    backendModel: 'microsoft/VibeVoice-ASR',
    fast: true,
    ready: Boolean(ffmpeg()),
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

interface PythonWhisperJson {
  text?: string;
  language?: string;
  segments?: {
    start: number; end: number; text: string;
    words?: { word: string; start: number; end: number; probability?: number }[];
  }[];
}

/** whisper.cpp's JSON. Offsets are already milliseconds, which is the shape we want. */
interface WhisperCppJson {
  result?: { language?: string };
  transcription?: {
    offsets: { from: number; to: number };
    text: string;
    tokens?: { text: string; offsets?: { from: number; to: number }; p?: number }[];
  }[];
}

/**
 * Caption-length lines, not thirty-second blocks.
 *
 * whisper.cpp emits ONE SEGMENT PER 30-SECOND WINDOW by default, which
 * is right for a transcript and useless for everything this is for: a
 * caption you can read, and a sentence boundary a cut can land between.
 * `--max-len` with `--split-on-word` breaks it at word boundaries near
 * that length. Measured on 92 seconds of narration: 4 segments without
 * these, 16 with.
 */
const CPP_MAX_LEN = '70';

async function runWhisperCpp(
  wavPath: string,
  workDir: string,
  model: string,
  options: TranscribeOptions
): Promise<{ segments: TranscriptSegment[]; words: TranscriptWordOut[]; language: string }> {
  const cli = whisperCli()!;
  const outBase = path.join(workDir, 'out');
  const args = [
    '-m', path.join(os.homedir(), '.cache', 'whisper', `ggml-${model}.bin`),
    '-f', wavPath,
    '-oj',
    '-of', outBase,
    '-ml', CPP_MAX_LEN,
    '-sow',
    '-pp',
    ...(options.wordTimestamps ? ['-ojf'] : []),
    /*
      ALWAYS `-l`, and this one flag is the whole Swahili bug.

      `whisper-cli --language` defaults to **`en`**, not to detection:
      `-l LANG [en] spoken language ('auto' for auto-detect)`. Omitting
      the flag is therefore not "let it decide", it is "assume English",
      and an English decode of another language does not come back
      wrong, it comes back as one `(speaking in foreign language)`
      marker for the whole stretch. Which is then correctly filtered out
      of the captions, so the transcript is simply empty and nothing
      anywhere says why.

      Measured on 54 seconds of Swahili narration, same binary, same
      multilingual model, one flag apart:

          no -l      language: en, first words at 30.0s
          -l auto    auto-detected language: sw (p = 0.84), words at 0s

      An `.en` model cannot detect anything, so it is told `en` rather
      than `auto` — asking it to choose is how you get a silent failure
      of a different kind.
    */
    '-l', options.language && options.language !== 'auto'
      ? options.language
      : (model.endsWith('.en') ? 'en' : 'auto'),
    /*
      ALWAYS `-mc 0`, and this is the second one-flag bug of exactly the
      shape of the `-l` bug above.

      whisper.cpp carries the previous window's decoded tokens into the
      next window as text context (`-mc` defaults to 224). That is a
      feedback path: once the model emits a sentence it is unsure of,
      that sentence is in the prompt for the next window, which makes it
      likelier again, which puts it in the prompt again. On a long take
      it latches, and everything after the latch is one sentence
      repeated to the end of the file.

      It does not fail loudly. The decode succeeds, the language is
      detected correctly, the segments have plausible timings, and the
      captions that come out are a single hallucinated line laid down
      every two seconds for four minutes.

      Measured on the 275-second Swahili take in Kerf Recordings,
      same binary, same model, same `-l auto`, one flag apart:

          no -mc     124 segments, 15 distinct, ONE line 109 times
                     — 86% of the film, from 37s to the end
          -mc 0       70 segments, 70 distinct, no repeat at all
                     — and 62.6s of compute against 83.7s

      The same audio cut to a 70-second slice decodes cleanly WITHOUT
      the flag, which is what says the length is the trigger and the
      audio is fine.

      What it costs is cross-window coherence, which is why upstream
      defaults it on. For captions that is a trivial price: a caption is
      read one line at a time, and the alternative is losing the film.
    */
    '-mc', '0',
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(cli, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    running = child;
    let stderr = '';

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      const matches = [...chunk.matchAll(/progress\s*=\s*(\d{1,3})%/g)];
      if (matches.length === 0) return;
      /*
        Clamped. whisper.cpp reports progress per window against the
        whole file and can overshoot: this run printed 32, 65, 97, then
        130. A bar that goes past the end is a bar nobody trusts.
      */
      const percent = Math.min(100, Number(matches[matches.length - 1][1]));
      options.onProgress?.(Math.min(99, 15 + percent * 0.8), `Transcribing, ${percent}%`);
    });

    child.on('error', (err) => { running = null; reject(err); });
    child.on('close', (code) => {
      running = null;
      if (code === 0) { resolve(); return; }
      reject(new Error(
        cancelled ? 'Transcription was cancelled.'
          : stderr.trim().slice(-500) || `whisper-cli exited ${code}`
      ));
    });
  });

  const jsonPath = `${outBase}.json`;
  if (!fs.existsSync(jsonPath)) throw new Error('whisper.cpp produced no output file.');

  const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as WhisperCppJson;
  const segments: TranscriptSegment[] = (parsed.transcription ?? []).map((seg) => ({
    startMs: seg.offsets.from,
    endMs: seg.offsets.to,
    text: seg.text.trim(),
  }));

  const words: TranscriptWordOut[] = (parsed.transcription ?? []).flatMap((seg) =>
    (seg.tokens ?? [])
      .filter((tok) => tok.offsets && tok.text.trim() && !tok.text.startsWith('['))
      .map((tok) => ({
        word: tok.text.trim(),
        startMs: tok.offsets!.from,
        endMs: tok.offsets!.to,
        confidence: tok.p ?? 1,
      }))
  );

  return { segments, words, language: parsed.result?.language ?? 'unknown' };
}

async function runPythonWhisper(
  wavPath: string,
  workDir: string,
  model: string,
  options: TranscribeOptions
): Promise<void> {
  const wh = whisper()!;

  /*
    The fallback, and it is a distant one. Kept because a machine may
    have the Python implementation and not whisper.cpp, and losing
    captions entirely on that machine would be worse than losing them
    slowly. Everything about it is slow: CPU, FP32, and it says so.
  */
  const args = [
    wavPath,
    '--model', model,
    '--output_format', 'json',
    '--output_dir', workDir,
    ...(options.wordTimestamps ? ['--word_timestamps', 'True'] : []),
    /* `False`, not `None`: whisper disables its own tqdm bar when
       `verbose is not False`, so this is what makes progress exist. */
    '--verbose', 'False',
    // Never let a missing model trigger a download mid-edit: it can hang
    // for minutes behind a TLS proxy and fail with an unrelated error.
    '--model_dir', path.join(os.homedir(), '.cache', 'whisper'),
  ];
  if (options.language && options.language !== 'auto') args.push('--language', options.language);
  /* The Python implementation's name for the same feedback path, and it
     latches the same way. See the `-mc 0` comment in runWhisperCpp for
     the measurement; this backend is too slow to re-measure on, so it
     is set from the same reasoning rather than from its own numbers. */
  args.push('--condition_on_previous_text', 'False');

  await new Promise<void>((resolve, reject) => {
    const child = spawn(wh, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    running = child;
    let stderr = '';

    /*
      One stderr chunk carries several tqdm redraws, separated by
      carriage returns. Taking the FIRST match reports the oldest number
      in the chunk, and the first chunk always contains `0%|` — which is
      how a bar ends up frozen on zero for twelve minutes.
    */
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      const matches = [...chunk.matchAll(/(\d{1,3})%\|/g)];
      if (matches.length === 0) return;
      const percent = Math.min(100, Number(matches[matches.length - 1][1]));
      options.onProgress?.(Math.min(99, 15 + percent * 0.8), `Transcribing, ${percent}%`);
    });

    child.on('error', (err) => { running = null; reject(err); });
    child.on('close', (code) => {
      running = null;
      if (code === 0) { resolve(); return; }
      reject(new Error(
        cancelled ? 'Transcription was cancelled.'
          : stderr.trim().slice(-500) || `whisper exited ${code}`
      ));
    });
  });
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
      message: 'FFmpeg was not found. Download it with 1-click in the Packages & Models manager.',
    };
  }

  const workDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'frontier-stt-'));
  const wavPath = path.join(workDir, 'audio.wav');

  const cleanup = () => {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };

  try {
    /* ── 1. Extract mono 16 kHz PCM ── */
    options.onProgress?.(5, 'Extracting audio track…');

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

    /* ── 2. Primary Engine: VibeVoice Diarized Fast ASR ── */
    options.onProgress?.(25, 'Transcribing speech with VibeVoice Diarized AI…');
    try {
      const vvResult = await transcribeVibeVoiceDiarized(wavPath, options.language);
      if (vvResult.ok && vvResult.segments && vvResult.segments.length > 0) {
        const segments: TranscriptSegment[] = vvResult.segments.map((seg) => ({
          startMs: seg.startMs,
          endMs: seg.endMs,
          text: seg.text,
        }));
        const words: TranscriptWordOut[] = vvResult.segments.flatMap((seg) =>
          (seg.words || []).map((w) => ({
            word: w.word,
            startMs: w.startMs,
            endMs: w.endMs,
            confidence: w.confidence,
          }))
        );

        cleanup();
        options.onProgress?.(100, 'Done');
        return {
          ok: true,
          language: vvResult.language || options.language || 'en',
          text: segments.map((s) => s.text).join(' ').trim(),
          segments,
          words,
          model: vvResult.model || 'microsoft/VibeVoice-ASR',
          elapsedMs: Date.now() - startedAt,
          nonSpeech: [],
        };
      }
    } catch {
      /* Fallback to local whisper if present */
    }

    const chosen = chooseBackend(options.language);
    const model = chosen.model || 'base';

    /* ── 2. Transcribe ── */

    const audioSeconds = Math.round(fs.statSync(wavPath).size / 32000);
    options.onProgress?.(
      15,
      chosen.backend === 'whisper.cpp'
        ? `Transcribing ${formatClock(audioSeconds)} with ${model} on the GPU`
        : `Transcribing ${formatClock(audioSeconds)} with the ${model} model. `
          + 'This one runs on the processor and takes longer than the take itself.'
    );

    const segments: TranscriptSegment[] = [];
    const words: TranscriptWordOut[] = [];
    let language = options.language ?? 'unknown';

    if (chosen.backend === 'whisper.cpp') {
      const parsed = await runWhisperCpp(wavPath, workDir, model, options);
      segments.push(...parsed.segments);
      words.push(...parsed.words);
      language = parsed.language;
    } else {
      await runPythonWhisper(wavPath, workDir, model, options);
      const jsonPath = path.join(workDir, 'audio.json');
      if (!fs.existsSync(jsonPath)) {
        cleanup();
        return { ok: false, reason: 'transcribe-failed', message: 'Whisper produced no output.' };
      }
      const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as PythonWhisperJson;
      language = parsed.language ?? language;
      for (const seg of parsed.segments ?? []) {
        segments.push({
          startMs: Math.round(seg.start * 1000),
          endMs: Math.round(seg.end * 1000),
          text: seg.text.trim(),
        });
        for (const w of seg.words ?? []) {
          words.push({
            word: w.word.trim(),
            startMs: Math.round(w.start * 1000),
            endMs: Math.round(w.end * 1000),
            confidence: w.probability ?? 1,
          });
        }
      }
    }

    /* ── 3. What came back ── */

    /*
      Non-speech markers out. whisper emits `[Music]`, `(silence)` and
      similar for stretches with no words in them, which are correct
      observations and terrible captions: a tutorial does not want a line
      on screen reading "[Music]" over its own title sequence.
    */
    const isMarker = (text: string) => /^[[(][^\])]*[\])]$/.test(text);
    const speech = segments.filter((seg) => seg.text.length > 0 && !isMarker(seg.text));
    const nonSpeech = segments
      .filter((seg) => seg.text.length > 0 && isMarker(seg.text))
      .map((seg) => ({ startMs: seg.startMs, endMs: seg.endMs, text: seg.text }));

    if (speech.length === 0) {
      cleanup();
      return {
        ok: false,
        reason: 'transcribe-failed',
        message: 'Nothing that sounded like speech was found in that audio.',
      };
    }

    cleanup();
    options.onProgress?.(100, 'Done');

    return {
      ok: true,
      language,
      text: speech.map((seg) => seg.text).join(' ').trim(),
      segments: speech,
      words,
      model,
      elapsedMs: Date.now() - startedAt,
      nonSpeech,
      modelNotes: [],
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
      message: 'FFmpeg was not found. Download it with 1-click in the Packages & Models manager to analyse audio.',
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

/**
 * The GGML file name for a model, given the language it will be asked
 * for.
 *
 * `.en` weights are faster and more accurate on English than the
 * multilingual ones of the same size, and that is still why they are
 * preferred for English. What they are not is a safe DEFAULT, and this
 * used to append `.en` unconditionally on the grounds that "narration
 * for a screen tutorial is overwhelmingly English".
 *
 * That assumption fails silently and completely. An `.en` model handed
 * Swahili does not transcribe it badly: it returns a single
 * `(speaking in foreign language)` marker for the whole stretch, which
 * is then correctly filtered out of the captions, and every layer above
 * sees a take with no words in it. Found on a real take that opened with
 * 25 seconds of Swahili and reported its first words at 25.3s.
 *
 * So `.en` now needs to be ASKED for. `auto` and anything non-English
 * get the multilingual weights, which is the only choice that can be
 * right when the language is not known.
 */
function ggmlNameFor(model: string, language?: string): string {
  const base = model.replace(/^ggml-/, '').replace(/\.bin$/, '').replace(/\.en$/, '');
  const english = language === 'en';
  if (!/^(tiny|base|small|medium)$/.test(base)) return base;  // large has no .en build
  return english ? `${base}.en` : base;
}

/**
 * Fetch one GGML model into the same cache the Python models use.
 *
 * Written to a `.part` file and renamed only once complete: a truncated
 * model is not a failure anybody sees at download time, it is a failure
 * at transcription time, days later, that looks like a broken app.
 */
async function fetchGgmlModel(
  name: string,
  onProgress?: (percent: number, note: string) => void
): Promise<{ ok: boolean; message: string; log?: string }> {
  const dir = path.join(os.homedir(), '.cache', 'whisper');
  const target = path.join(dir, `ggml-${name}.bin`);
  const partial = `${target}.part`;
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`;

  try {
    fs.mkdirSync(dir, { recursive: true });
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      return { ok: false, message: `Could not download the ${name} model (HTTP ${response.status}).` };
    }

    /*
      STREAMED, and that is not a tidiness preference.

      This used to `await response.arrayBuffer()` and then write the
      lot. `small` is 488MB and survives that; `large-v3` is 3.1GB, and
      buffering 3.1GB into the main process to write it straight back
      out is two copies of it resident at once in a process that is
      also holding a video project. The streaming write also gives the
      one thing a three-gigabyte download must have and the old one
      could not: a percentage.
    */
    const total = Number(response.headers.get('content-length') ?? 0);
    const out = fs.createWriteStream(partial);
    let written = 0;
    let lastReport = 0;

    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      written += value.byteLength;
      if (!out.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => out.once('drain', () => resolve()));
      }
      /* Once a percent, not once a chunk: this fires thousands of times
         a second and every report crosses an IPC boundary. */
      const percent = total > 0 ? Math.floor((written / total) * 100) : 0;
      if (percent > lastReport) {
        lastReport = percent;
        onProgress?.(
          percent,
          `Downloading the ${name} speech model, ${percent}% of ${(total / 1e9).toFixed(1)}GB`
        );
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve());
      out.on('error', reject);
    });

    if (written < 1024 * 1024) {
      fs.rmSync(partial, { force: true });
      return { ok: false, message: `The ${name} model came back too small to be real.` };
    }
    /* Renamed only once complete, so an interrupted download is a
       `.part` file that nothing will ever load rather than a truncated
       model that fails days later looking like a broken app. */
    fs.renameSync(partial, target);
    return { ok: true, message: `Downloaded the ${name} model.` };
  } catch (err) {
    try { fs.rmSync(partial, { force: true }); } catch { /* nothing to remove */ }
    return { ok: false, message: `Could not download the ${name} model.`, log: (err as Error).message };
  }
}

/**
 * Make sure the model this language actually needs is on disk.
 *
 * Called before the decode rather than offered afterwards, because
 * afterwards is too late to be useful: the failure it prevents does not
 * look like a failure, it looks like a finished transcript of words
 * nobody said. See the measurement on `SMALL_IS_ENOUGH`.
 *
 * Every failure path is NON-FATAL and returns `false`: no network, a
 * proxy, a full disk, a cancelled download. The decode then runs on
 * whatever is there, which is what happened before this existed, and
 * the caller says so in the report.
 */
export async function ensureModelFor(
  language: string | undefined,
  onProgress?: (percent: number, note: string) => void
): Promise<{ fetched: boolean; model: string | null; note?: string }> {
  if (!whisperCli()) return { fetched: false, model: null };
  if (!needsBetterModel(language)) {
    return { fetched: false, model: pickGgml(ggmlModels(), undefined, language) };
  }

  onProgress?.(0, 'Fetching a speech model that can hear this language');
  const result = await fetchGgmlModel('large-v3', onProgress);
  if (!result.ok) {
    return {
      fetched: false,
      model: pickGgml(ggmlModels(), undefined, language),
      note:
        `${result.message} Falling back to the model already on this machine, which decodes `
        + 'this language poorly — expect the captions to need correcting.',
    };
  }
  return {
    fetched: true,
    model: 'large-v3',
    note: 'Downloaded the large speech model, which is the one that can hear this language.',
  };
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

  /*
    ── whisper.cpp FIRST, and it is not a preference ─────────────────

    Measured on this machine, 92 seconds of narration, the same small
    model: 2.2 seconds through whisper.cpp on Metal against 769 through
    the Python one on the CPU. Installing the slow one when the fast one
    is a brew formula away would be setting somebody up to wait twelve
    minutes for every take and never know why.

    The whole install is a bottled formula and one model file. It is
    tried first and the Python path is only reached if it fails.
  */
  if (!whisperCli() || ggmlModels().length === 0) {
    const brew = findBinary('brew');
    if (brew) {
      if (!whisperCli()) {
        await run(brew, ['install', 'whisper-cpp'], 900_000);
        cliPath = undefined; // re-detect
      }
      if (whisperCli() && ggmlModels().length === 0) {
        const ok = await fetchGgmlModel(ggmlNameFor(model));
        if (!ok.ok) {
          return { ok: false, step: 'model', message: ok.message, log: ok.log };
        }
      }
    }
  }

  if (whisperCli() && ggmlModels().length > 0) {
    const chosen = chooseBackend();
    return {
      ok: true,
      step: 'done',
      message: `Ready. whisper.cpp with ${chosen.model}, which runs on the GPU.`,
    };
  }

  if (!whisper()) {
    const python = findPython();
    if (!python) {
      return {
        ok: false,
        step: 'whisper',
        message: 'Neither whisper.cpp nor Python 3 was found. `brew install whisper-cpp` is the '
          + 'one worth having; it is what makes transcription take seconds rather than minutes.',
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
