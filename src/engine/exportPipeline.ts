/* ═══════════════════════════════════════════════════════════════════
   Export — renderer half.

   Composites each frame and hands it to main, which feeds ffmpeg. The
   previous version did the first half and skipped the second: it
   rendered every frame, encoded nothing, slept, and returned a path to
   a file that was never written while reporting success.

   Frames go over as JPEG rather than raw RGBA on purpose. A 1080p frame
   is 8.3MB raw — a 16-second sequence would push 4GB through IPC. The
   same frame is ~300KB as JPEG at quality 0.95, which is visually
   indistinguishable after the encoder has had its way with it.
   ═══════════════════════════════════════════════════════════════════ */

import { Track, ProjectSettings, Clip } from '../types/edl';
import { renderTimelineFrame, undecodableSources } from './compositor';
import { seekVideosForFrame } from './videoEngine';
import { interpolateKeyframes } from './keyframeMath';
import { createFrameEncoder, probeFrameFormat, FrameEncoder, fastYield } from './frameEncoder';
import { serializeCaptions, CaptionCue } from './captions';

export type ExportResolution = '720p' | '1080p' | '1440p' | '4k';

export interface ExportConfig {
  resolution: ExportResolution;
  fps: 30 | 60;
  codec: 'h264' | 'hevc' | 'prores';
  bitrateMbps?: number;
  outputPath?: string;
  /** Apple VideoToolbox — much faster, slightly larger files. */
  hardware?: boolean;
  /** Render only this much of the timeline; defaults to the project duration. */
  durationMs?: number;
  /**
   * Where the render STARTS on the timeline. Defaults to 0.
   */
  startMs?: number;
  /**
   * Which encoder produces the picture.
   */
  engine?: 'auto' | 'ffmpeg';
  /**
   * How many hidden windows render at once.
   */
  workers?: number;
  /** Optional cancellation signal to immediately abort export. */
  signal?: AbortSignal;
}

/** Live numbers for the export UI, alongside the percentage. */
export interface ExportProgressDetail {
  frame: number;
  totalFrames: number;
  /** Frames per second the render is currently achieving. */
  fps: number;
  /** Milliseconds left at the current rate, or null before there is a rate. */
  etaMs: number | null;
  /** Which encoder is doing the work. */
  engine: 'webcodecs' | 'ffmpeg';
  phase: 'preparing' | 'rendering' | 'audio' | 'done';
  /**
   * One entry per render window when the farm is running, so the UI can
   * show what each is doing rather than one average. Empty for a
   * single-window render.
   */
  lanes?: { worker: number; chunk: number; frames: number; totalFrames: number }[];
}

export interface ExportResult {
  outputPath: string;
  frames: number;
  hasAudio: boolean;
  bytes: number;
  elapsedMs: number;
  /** Present when the render came out silent and should not have. */
  audioError?: string;
  /** Structured version of the same: which sources were dropped, and why. */
  audio?: {
    requested: number;
    included: number;
    dropped: { source: string; reason: string }[];
    note?: string;
  };
  durationMs: number;
  width: number;
  height: number;
  /** How many clips actually contributed sound to the mix. */
  audioSegments: number;
  /** Which encoder produced the picture. */
  engine: 'webcodecs' | 'ffmpeg';
  /** How the work was split: 1 window and 1 chunk means it was not. */
  farm: { workers: number; chunks: number };
  /** Why the fast path was not taken, when it was asked for and refused. */
  engineNote?: string;
  /**
   * Subtitle files written beside the video, absolute paths.
   *
   * Empty when the timeline has no text track that reads as subtitles.
   * See `subtitleCues` for what "reads as subtitles" means and why it
   * is not simply "the first text track".
   */
  subtitlePaths?: string[];
  /** Why no subtitles were written, when there was a reason worth saying. */
  subtitleNote?: string;
  /** Where the render time went, so a slow one can be diagnosed. */
  timing?: {
    seekMs: number;
    compositeMs: number;
    encodeMs: number;
    writeMs: number;
    msPerFrame: number;
  };
}

/**
 * Audio settings the render cannot honour.
 *
 * Pitch, voice effects, noise reduction and ducking are all applied by
 * the export filtergraph now, so this list is empty in the ordinary case
 * — but the function stays, because the thing it protects against is a
 * setting that is stored, offered by `list_properties`, and quietly
 * dropped. A quiet omission is exactly what an agent reports back to the
 * user as "done".
 *
 * The one that remains: ducking needs something to duck AGAINST. With
 * every audible clip marked, there is no key bus and the mix is left
 * alone rather than compressed against itself.
 */
export function unsupportedAudioSettings(tracks: Track[]): string[] {
  const found = new Set<string>();

  const audible: Clip[] = [];
  for (const track of tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      if (!clip.mediaUrl || clip.hidden) continue;
      if (track.type !== 'audio' && clip.type !== 'video') continue;
      audible.push(clip);
    }
  }

  const ducked = audible.filter((c) => c.audio.ducking).length;
  if (ducked > 0 && ducked === audible.length) {
    found.add(
      'Every audible clip is set to duck, so there is nothing to duck against, ' +
      'ducking was not applied. Clear it on whatever should stay at full level.'
    );
  }

  return [...found];
}

/*
  The SHORT edge of the output, not a fixed landscape frame.

  The table used to be literal {1920, 1080} pairs, so a 9:16 project
  exported at "1080p" got a 1920x1080 landscape file — and since the
  compositor scales the composition to the canvas, the scale came out
  non-uniform and the whole picture was squashed. Export follows the
  project's aspect ratio; the setting only chooses how big.

  1440p is what consumer apps label "2K".
*/
const RESOLUTION_SHORT_EDGE: Record<ExportResolution, number> = {
  '720p': 720,
  '1080p': 1080,
  '1440p': 1440,
  '4k': 2160,
};

export const RESOLUTION_LABELS: Record<ExportResolution, string> = {
  '720p': 'HD · 720p',
  '1080p': 'Full HD · 1080p',
  '1440p': '2K · 1440p',
  '4k': '4K · 2160p',
};

function outputSize(project: ProjectSettings, resolution: ExportResolution): { width: number; height: number } {
  const short = RESOLUTION_SHORT_EDGE[resolution];
  const portrait = project.height > project.width;
  const aspect = project.width / project.height;

  // h264 and hevc reject odd dimensions outright, so round to even.
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

  return portrait
    ? { width: even(short), height: even(short / aspect) }
    : { width: even(short * aspect), height: even(short) };
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) { reject(new Error('Frame encoding failed')); return; }
        blob.arrayBuffer().then((b) => resolve(new Uint8Array(b))).catch(reject);
      },
      'image/jpeg',
      0.92
    );
  });
}

/**
 * One line describing anything that went wrong with the audio, or
 * undefined when the mix came through whole.
 */
function audioSummary(
  audio: { requested: number; included: number; dropped: { source: string; reason: string }[]; note?: string } | undefined,
  fallback?: string
): string | undefined {
  if (!audio) return fallback;
  const parts: string[] = [];
  for (const d of audio.dropped) parts.push(`${d.source} could not be read (${d.reason})`);
  if (audio.note) parts.push(audio.note);
  if (parts.length === 0) return fallback;
  return `${audio.included} of ${audio.requested} audio sources made it into the render. ` + parts.join('; ');
}

/** Every clip that contributes sound, described for ffmpeg. */
/*
  ffmpeg runs in the MAIN process; these URLs are resolved in the
  RENDERER. A page-relative one (`/src/assets/bed.wav` from a bundled
  import, or anything relative a project file carries) means nothing on
  the other side of the bridge — main hands it to ffmpeg, which resolves
  it against the filesystem root and reports "No such file or directory".
  The renderer is the only side that knows what the URL is relative TO,
  so it is the side that has to make it absolute.
*/
function absoluteMediaUrl(url: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;   // already has a scheme
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return url;
  }
}

/**
 * A keyframed `volume` as a series of timeline-local points.
 *
 * `volume` is one of the 35 ANIMATABLE_PROPERTIES and was read by
 * NOTHING: `interpolateKeyframes` is consumed by `compositor.ts` and the
 * inspector, and neither `audioEngine` nor this file ever mentioned
 * keyframes. `add_keyframes` reported success, handed back two ids, and
 * the exported envelope came out byte-identical — the eighteenth
 * property to say it was animatable and not be.
 *
 * The curve is sampled HERE rather than expressed in ffmpeg, because
 * easing lives here: `interpolateKeyframes` already applies easeIn,
 * easeInOut, hold and custom beziers, and reproducing those in an
 * expression evaluator would be a second implementation to keep in
 * step. The main process gets plain points and interpolates linearly
 * between them, so the only thing that can drift is resolution.
 *
 * Segment boundaries are keyframe times, with sub-samples inside each
 * so a curve is not flattened to a straight line. Bounded, because a
 * three-minute music bed keyframed every second would otherwise build
 * an expression thousands of terms long.
 */
const ENVELOPE_SUBSAMPLES = 8;
const ENVELOPE_MAX_POINTS = 256;

function volumeEnvelopeFor(clip: Clip): { tMs: number; v: number }[] | undefined {
  const keys = clip.keyframes
    .filter((k) => k.property === 'volume')
    .sort((a, b) => a.timeOffsetMs - b.timeOffsetMs);
  if (keys.length < 2) return undefined;

  const base = clip.audio.volume;
  const times: number[] = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i].timeOffsetMs;
    const b = keys[i + 1].timeOffsetMs;
    const steps = Math.max(1, Math.min(ENVELOPE_SUBSAMPLES,
      Math.floor(ENVELOPE_MAX_POINTS / Math.max(1, keys.length - 1))));
    for (let s = 0; s < steps; s++) times.push(a + ((b - a) * s) / steps);
  }
  times.push(keys[keys.length - 1].timeOffsetMs);

  return times.map((tMs) => ({
    tMs: Math.round(tMs),
    v: interpolateKeyframes(clip.keyframes, 'volume', tMs, base),
  }));
}

function collectAudioClips(tracks: Track[]) {
  const anySolo = tracks.some((t) => t.type === 'audio' && t.solo);
  const out = [];

  for (const track of tracks) {
    if (track.muted) continue;
    /*
      Solo means "only this", so a soloed AUDIO track silences every
      other source of sound — including the audio embedded in clips on
      VIDEO tracks, which used to sail straight past this gate because
      it also tested `track.type === 'audio'`. Measured before the
      change: a soloed audio track left a video clip's 440Hz tone at
      68.75dB, exactly where it started, delta 0.00dB.

      This is the AUDIO gate only, and it is deliberately identical to
      the one in `audioEngine.ts` — the two agreeing with each other is
      what kept this from looking like a slip, and the same property has
      to hold after the change. The picture is governed separately.
    */
    if (anySolo && !track.solo) continue;

    for (const clip of track.clips) {
      const audible = Boolean(clip.mediaUrl) && (track.type === 'audio' || clip.type === 'video');
      if (!audible || clip.hidden) continue;

      const volume = clip.audio.volume * track.volume;
      if (volume <= 0) continue;

      out.push({
        mediaUrl: absoluteMediaUrl(clip.mediaUrl!),
        startTimeMs: clip.startTimeMs,
        durationMs: clip.durationMs,
        sourceStartMs: clip.sourceStartMs,
        volume,
        fadeInMs: clip.audio.fadeInMs,
        fadeOutMs: clip.audio.fadeOutMs,
        pitch: clip.audio.pitch,
        voiceEffect: clip.audio.voiceEffect,
        noiseReduction: clip.audio.noiseReduction,
        ducking: clip.audio.ducking,
        speed: clip.speed?.multiplier ?? 1,
        reversed: Boolean(clip.speed?.reversed),
        /*
          Scaled by the TRACK volume, the same way the static `volume`
          above it is — otherwise keyframing a clip would silently
          escape the track fader.
        */
        volumeEnvelope: volumeEnvelopeFor(clip)?.map((pt) => ({
          tMs: pt.tMs,
          v: pt.v * track.volume,
        })),
      });
    }
  }
  return out;
}

/**
 * Cut the audio set down to the render window.
 *
 * The picture only needed its clock offset — one `+ startMs` in the frame
 * loop. Sound is laid out in absolute timeline coordinates by
 * `render.ts` (`adelay=startTimeMs`, and `-ss sourceStartMs` on the
 * input), so exporting a window means re-expressing every clip relative
 * to the window's start, dropping the ones outside it, and trimming the
 * two that straddle its edges.
 *
 * Source time advances at the PLAYBACK speed — `render.ts` takes
 * `durationMs * speed` seconds of source for a clip — so a head cut of
 * `n` timeline-ms skips `n * speed` ms of source. Getting that factor
 * wrong is silent: the audio still plays, just from the wrong place.
 *
 * Reversal flips which END of the source a timeline cut lands on. A
 * reversed clip plays its source window backwards, so trimming the
 * front of it on the TIMELINE drops the LAST of that window, and the
 * source start does not move; trimming the back of the timeline drops
 * the FIRST of it, and the source start does. Handled below.
 */
function windowAudioClips(
  clips: ReturnType<typeof collectAudioClips>,
  startMs: number,
  renderMs: number
): ReturnType<typeof collectAudioClips> {
  if (startMs === 0) {
    // Still drop what starts after the end, so a shortened render does
    // not carry sound the picture never reaches.
    return clips.filter((c) => c.startTimeMs < renderMs);
  }

  const endMs = startMs + renderMs;
  const out: ReturnType<typeof collectAudioClips> = [];

  for (const c of clips) {
    const clipEndMs = c.startTimeMs + c.durationMs;
    if (clipEndMs <= startMs || c.startTimeMs >= endMs) continue;

    const headCutMs = Math.max(0, startMs - c.startTimeMs);
    const tailCutMs = Math.max(0, clipEndMs - endMs);
    const durationMs = c.durationMs - headCutMs - tailCutMs;
    if (durationMs <= 0) continue;

    /*
      Forward: a head cut skips into the source. Reversed: the clip
      plays its window back to front, so the head cut comes off the END
      of the window and the source start is moved by the TAIL cut
      instead. Using the forward formula on a reversed clip lands the
      sound in the wrong place and still plays, which is the failure
      mode that does not announce itself.
    */
    const speed = c.speed || 1;
    const sourceShiftMs = (c.reversed ? tailCutMs : headCutMs) * speed;

    /*
      The envelope is in TIMELINE order, so re-basing it is the same
      subtraction whether or not the clip is reversed — the head cut
      always removes the first `headCutMs` of what the listener hears.
    */
    const envelope = c.volumeEnvelope
      ?.map((pt) => ({ tMs: pt.tMs - headCutMs, v: pt.v }))
      .filter((pt) => pt.tMs >= -1 && pt.tMs <= durationMs + 1);

    out.push({
      ...c,
      startTimeMs: c.startTimeMs + headCutMs - startMs,
      sourceStartMs: c.sourceStartMs + sourceShiftMs,
      durationMs,
      ...(envelope && envelope.length >= 2 ? { volumeEnvelope: envelope } : {}),
    });
  }
  return out;
}

/** Where a render's time went, accumulated as it goes. */
export interface RenderTiming {
  seekMs: number;
  compositeMs: number;
  encodeMs: number;
  writeMs: number;
}

export interface FrameSequenceSpec {
  tracks: Track[];
  project: ProjectSettings;
  width: number;
  height: number;
  fps: number;
  /** Where on the timeline the RENDER starts, not this run of frames. */
  startMs: number;
  /**
   * The index, within the whole render, of this run's first frame.
   *
   * Zero for a single-window export; the chunk's first frame for a farm
   * worker. It exists so the two paths compute a timestamp with the
   * IDENTICAL arithmetic, and that is not pedantry — it was measured.
   *
   * The farm used to be handed a pre-multiplied `startMs` of
   * `(240 * 1000) / 30`, which is exactly 8000, while the single window
   * reached the same instant as `0 + 240 * (1000 / 30)`, which is
   * 8000.000000000001. Same moment, different bits, and at a clip
   * boundary they fall on opposite sides of it: frame 240 of a 600-frame
   * render came out visibly different between the two paths, and only
   * that frame, and only at that one seam.
   */
  firstFrame?: number;
  totalFrames: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** The WebCodecs encoder, or null to fall back to JPEG stills. */
  encoder: FrameEncoder | null;
  /** Where a JPEG goes when there is no encoder. */
  sendJpeg: (bytes: Uint8Array) => Promise<{ ok: boolean; error?: string }>;
  timing: RenderTiming;
  /**
   * Called on a clock rather than per frame — see the comment at the
   * call site. Receives frames finished so far.
   */
  onProgress: (framesDone: number) => void;
  /** Optional cancellation signal to immediately abort export. */
  signal?: AbortSignal;
}

/** ~12 progress updates a second, whatever the render rate. */
const PROGRESS_INTERVAL_MS = 80;

/**
 * Make sure every font the render will draw with is actually loaded.
 *
 * `await document.fonts.ready` is NOT enough, and the difference is a
 * bug that shipped past a suite: `ready` only waits for faces something
 * has ALREADY requested, and assigning `ctx.font` on a canvas requests
 * nothing. A window that has not laid out any DOM text in Inter — which
 * is every render-farm worker, because they mount no React at all —
 * therefore resolves `ready` immediately and draws its first frames in
 * the platform fallback.
 *
 * It was found as a single wrong frame: on a 600-frame farmed render,
 * frame 240 differed from the single-window render by 6.2 mean levels,
 * in a band across the middle of the picture and nowhere else. That band
 * was the title. Whether it happens at all, and to which chunk, is a
 * race between four windows and the font cache, so it is exactly the
 * kind of defect that reproduces on somebody else's machine and not on
 * yours.
 *
 * `load()` is what actually requests a face. Failures are swallowed on
 * purpose: a missing font must fall back and render, not stop the export.
 */
export async function ensureFontsLoaded(tracks: Track[]): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;

  /* Inter unconditionally: `fontString` names it as the fallback for
     every text clip, so it is drawn even by clips that ask for something
     else and do not get it. */
  const families = new Set<string>(['Inter']);
  for (const track of tracks) {
    for (const clip of track.clips) {
      const family = clip.textStyle?.fontFamily;
      if (family) families.add(family);
    }
  }

  await Promise.all(
    [...families].flatMap((family) =>
      /* Both weights the compositor commonly asks for. A face loaded at
         one weight does not bring its siblings with it. */
      /* 800 as well as 400 and 700: the kinetic captions ask for 900,
         which resolves to the 800 face, and a face loaded at 700 does
         not bring its siblings with it — that is a render in the wrong
         weight with no error anywhere. */
      [400, 700, 800].map((weight) =>
        document.fonts.load(`${weight} 16px "${family}"`).catch(() => [])
      )
    )
  );
  try { await document.fonts.ready; } catch { /* no font loading API */ }
}

/**
 * Composite and encode a run of frames.
 *
 * THE one frame loop. The single-window export and every render-farm
 * worker call this, because a second copy of it is a second definition
 * of what a frame looks like — and the two would agree right up until
 * somebody changed one of them.
 */
export async function renderFrameSequence(spec: FrameSequenceSpec): Promise<void> {
  const {
    tracks, project, width, height, fps, startMs, totalFrames,
    canvas, ctx, encoder, sendJpeg, timing, onProgress, signal,
  } = spec;

  const firstFrame = spec.firstFrame ?? 0;
  const frameIntervalMs = 1000 / fps;
  let lastReportAt = 0;

  for (let frame = 0; frame < totalFrames; frame++) {
    if (signal?.aborted) {
      throw new DOMException('Export cancelled by user', 'AbortError');
    }

    /*
      Counted from the start of the RENDER, not of this chunk. See
      `firstFrame` above: the alternative put one frame of a farmed
      render on the wrong side of a cut.
    */
    const timestampMs = startMs + (firstFrame + frame) * frameIntervalMs;

    /*
      Park every <video> on the exact source frame this instant needs
      BEFORE compositing. `renderTimelineFrame` is synchronous: it draws
      whatever frame each element happens to be holding, so without this
      the export writes one stale frame over and over — a real file, the
      right duration, and completely the wrong picture.
    */
    let t0 = performance.now();
    await seekVideosForFrame(tracks, timestampMs);
    timing.seekMs += performance.now() - t0;

    if (signal?.aborted) {
      throw new DOMException('Export cancelled by user', 'AbortError');
    }

    t0 = performance.now();
    renderTimelineFrame(ctx, tracks, project, timestampMs, width, height);
    timing.compositeMs += performance.now() - t0;

    if (encoder) {
      /*
        `encode` hands the frame to the hardware and returns. The encoder
        works while the loop seeks and composites the NEXT frame, which
        is the second half of the win — the first is that the picture is
        never read back off the GPU at all.

        `settle` is where the waiting happens, and only when a queue is
        actually deep. On a render that composites faster than the
        encoder drains it costs the difference; on one that composites
        slower it costs nothing.
      */
      t0 = performance.now();
      encoder.encode(canvas, frame);
      timing.encodeMs += performance.now() - t0;

      t0 = performance.now();
      await encoder.settle();
      timing.writeMs += performance.now() - t0;
    } else {
      t0 = performance.now();
      const jpeg = await canvasToJpeg(canvas);
      timing.encodeMs += performance.now() - t0;

      t0 = performance.now();
      const written = await sendJpeg(jpeg);
      timing.writeMs += performance.now() - t0;
      if (!written.ok) throw new Error(written.error ?? 'The encoder stopped accepting frames.');
    }

    /*
      Progress on a CLOCK, not a frame count.

      `frame % 5` was written for a render that managed 22 frames a
      second; the fast path does several hundred, which is a store write
      and a React pass every 15ms, and a yield to the event loop with
      them. Throttling to ~12 updates a second makes the reporting cost
      independent of the render rate, and the number a viewer can
      actually read is the same either way.
    */
    const now = performance.now();
    if (now - lastReportAt >= PROGRESS_INTERVAL_MS || frame === totalFrames - 1) {
      onProgress(frame + 1);
      lastReportAt = now;
      // Fast microtask event-loop yield
      await fastYield();
    }
  }
}

/**
 * Render the sequence to a real file.
 *
 * `onProgress` receives 0..100 and a status line. Throws on failure —
 * an export that cannot produce a file must never report success.
 */
/* ── Subtitles beside the video ──────────────────────────────────── */

/**
 * The text track that is a TRANSCRIPT, out of however many there are.
 *
 * Not "the first text track", and the difference matters as soon as the
 * Tutorial skill has run: it leaves two of them. `T2 · Captions` is one
 * clip per WORD — kinetic type, a few words at a time at 300px — and
 * serialising that gives a subtitle file with one word per cue, which
 * is worse than no subtitle file because it looks like it worked.
 * `T1 · Subtitles` is the whole sentence and is the one to write.
 *
 * Chosen by MEASURING the clips rather than by matching the name, so it
 * still works on a project whose tracks were renamed, on one built by
 * hand, and on one whose captions were imported from an `.srt` in the
 * first place. The mean words per clip separates the two cleanly: a
 * kinetic track is 1.0 by construction and a sentence track is four or
 * five.
 *
 * MUTED TRACKS COUNT, and that is the case this gets right that a
 * "visible clips" rule would get exactly backwards. The Tutorial skill
 * mutes the sentence track precisely BECAUSE the kinetic one is drawing
 * the words on screen — so the track that must not be burned into the
 * picture is the same track that must be written to the sidecar. A
 * subtitle file is for a player to draw, not for the renderer to.
 */
export function subtitleCues(tracks: Track[]): { cues: CaptionCue[]; note?: string } {
  const candidates = tracks
    .filter((track) => track.type === 'text')
    .map((track) => {
      const clips = track.clips
        .filter((clip) => typeof clip.textStyle?.text === 'string' && clip.textStyle.text.trim().length > 0)
        .sort((a, b) => a.startTimeMs - b.startTimeMs);
      const words = clips.reduce(
        (n, clip) => n + (clip.textStyle!.text as string).trim().split(/\s+/).length,
        0
      );
      return { track, clips, perClip: clips.length > 0 ? words / clips.length : 0 };
    })
    .filter((c) => c.clips.length > 0);

  if (candidates.length === 0) return { cues: [] };

  /*
    Two words a clip is the floor. Below it the track is a kinetic
    display or a set of title cards, and writing it out as subtitles
    would produce a file that is technically valid and useless. Said in
    the note rather than silently skipped, because "my export had no
    captions" needs an answer.
  */
  const best = candidates.reduce((a, b) => (b.perClip > a.perClip ? b : a));
  if (best.perClip < 2) {
    return {
      cues: [],
      note:
        `No subtitle file was written: the only text on this timeline averages `
        + `${best.perClip.toFixed(1)} words a clip, which is a title or a kinetic caption `
        + 'rather than a transcript.',
    };
  }

  return {
    cues: best.clips.map((clip, i) => ({
      index: i + 1,
      startMs: clip.startTimeMs,
      endMs: clip.startTimeMs + clip.durationMs,
      /* Line breaks the layout put there are the layout's, not the
         transcript's: a subtitle player wraps to its own width. */
      text: (clip.textStyle!.text as string).replace(/\s*\n\s*/g, ' ').trim(),
      align: clip.textStyle!.align === 'center' ? undefined : clip.textStyle!.align,
    })),
  };
}

/**
 * Write `.srt` and `.vtt` next to the rendered video.
 *
 * Both, because they are two lines of code apart and the two places
 * this file is going want different ones: YouTube, Vimeo and every
 * NLE take SRT; a `<video>` tag on the web takes WebVTT and nothing
 * else. Naming them after the video means a player that looks for a
 * sidecar finds it without being told.
 *
 * Cues are shifted by the export's own start, because a range export
 * begins at `startMs` and a subtitle file that still carries the
 * timeline's absolute times is silently three minutes out. Cues
 * entirely outside the exported range are dropped rather than clamped
 * to zero, where they would all pile up on the first frame.
 *
 * Failure is a NOTE. A video that rendered is not a failed export
 * because a text file could not be written beside it.
 */
async function writeSubtitleSidecars(
  tracks: Track[],
  videoPath: string,
  startMs: number,
  durationMs: number
): Promise<{ paths: string[]; note?: string }> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.project) return { paths: [] };

  const found = subtitleCues(tracks);
  if (found.cues.length === 0) return { paths: [], note: found.note };

  const endMs = startMs + durationMs;
  const windowed = found.cues
    .filter((cue) => cue.endMs > startMs && cue.startMs < endMs)
    .map((cue, i) => ({
      ...cue,
      index: i + 1,
      startMs: Math.max(0, cue.startMs - startMs),
      endMs: Math.max(1, Math.min(durationMs, cue.endMs - startMs)),
    }));

  if (windowed.length === 0) {
    return { paths: [], note: 'No subtitle file was written: no captions fall inside the exported range.' };
  }

  const base = videoPath.replace(/\.[^./\\]+$/, '');
  const paths: string[] = [];
  const failures: string[] = [];

  for (const format of ['srt', 'vtt'] as const) {
    const target = `${base}.${format}`;
    try {
      const written = await api.project.write(target, serializeCaptions(windowed, format));
      if (written.ok) paths.push(target);
      else failures.push(`${format}: ${written.error ?? 'write refused'}`);
    } catch (error) {
      failures.push(`${format}: ${(error as Error).message}`);
    }
  }

  return {
    paths,
    ...(failures.length > 0 && paths.length === 0
      ? { note: `The subtitle files could not be written (${failures.join('; ')}).` }
      : {}),
  };
}

export async function runHardwareExport(
  tracks: Track[],
  project: ProjectSettings,
  config: ExportConfig,
  onProgress: (progressPct: number, statusText: string, detail?: ExportProgressDetail) => void,
  externalSignal?: AbortSignal
): Promise<ExportResult> {
  const signal = config.signal ?? externalSignal;
  if (signal?.aborted) {
    throw new DOMException('Export cancelled by user', 'AbortError');
  }

  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.exporter) {
    throw new Error('Export needs the desktop app. A browser cannot write video files.');
  }

  const startedAt = Date.now();
  const { width, height } = outputSize(project, config.resolution);
  const startMs = Math.max(0, Math.round(config.startMs ?? 0));
  const renderMs = config.durationMs ?? Math.max(0, project.durationMs - startMs);
  const totalFrames = Math.max(1, Math.round((renderMs / 1000) * config.fps));
  const frameIntervalMs = 1000 / config.fps;

  const extension = config.codec === 'prores' ? 'mov' : 'mp4';
  /*
    The renderer has no idea where the user's home directory is. Guessing
    produced `/Movies/...` and every export died on `mkdir '/Movies'`.
    Send a bare filename; main resolves it against the real Movies folder.
  */
  const outputPath =
    config.outputPath ?? `${project.name.replace(/[^\w\-]+/g, '_')}.${extension}`;

  /*
    Refuse to encode a placeholder. A source that cannot decode renders
    as the compositor's grey gradient, which would go into the file
    looking exactly like a deliberate shot.
  */
  onProgress(1, 'Decoding video sources…');
  await ensureFontsLoaded(tracks);
  if (signal?.aborted) throw new DOMException('Export cancelled by user', 'AbortError');

  const undecodable = await undecodableSources(tracks);
  if (undecodable.length > 0) {
    throw new Error(
      `${undecodable.length} media source${undecodable.length > 1 ? 's' : ''} could not be decoded, ` +
      'so the render would contain a placeholder instead of footage:\n' +
      undecodable.map((u) => `  • ${decodeURIComponent(u.replace(/^file:\/\//, ''))}`).join('\n')
    );
  }

  onProgress(2, 'Starting encoder…');

  /*
    The canvas has to exist before the encoder is built, because the
    encoder is configured against its exact size and the fallback path
    reads the same surface.
  */
  let surface: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;
  const editorCanvas = () => {
    if (surface) return surface;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not create a render context for export.');
    surface = { canvas, ctx };
    return surface;
  };

  const encoderOptions = {
    width, height, fps: config.fps, codec: config.codec,
    bitrateMbps: config.bitrateMbps, hardware: config.hardware ?? true,
  };

  let engineNote: string | undefined;
  let frameFormat: 'jpeg' | 'h264' | 'hevc' = 'jpeg';

  if ((config.engine ?? 'auto') === 'auto') {
    const probe = await probeFrameFormat(encoderOptions);
    if (probe.format) frameFormat = probe.format;
    else engineNote = probe.reason;
  } else {
    engineNote = 'The ffmpeg encoder was requested, so the picture is re-encoded from JPEG stills.';
  }

  const engine: 'webcodecs' | 'ffmpeg' = frameFormat === 'jpeg' ? 'ffmpeg' : 'webcodecs';

  const plan = api.exporter.plan
    ? await api.exporter.plan({ totalFrames, fps: config.fps, workers: config.workers })
    : { workers: 1, chunks: 1, chunked: false, reason: '' };

  onProgress(2, plan.chunked ? `Opening ${plan.workers} render windows…` : 'Starting encoder…');
  if (signal?.aborted) throw new DOMException('Export cancelled by user', 'AbortError');

  const started = await api.exporter.start({
    width, height, fps: config.fps, codec: config.codec,
    outputPath, hardware: config.hardware, bitrateMbps: config.bitrateMbps,
    frameFormat,
  });
  if (!started.sessionId) throw new Error(started.error ?? 'Could not start the encoder.');
  const sessionId = started.sessionId;

  // Active abort hook
  const onAbort = () => {
    try { void api.exporter?.cancel(sessionId); } catch { /* ignore */ }
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  let frameEncoder: FrameEncoder | null = null;
  if (!plan.chunked && frameFormat !== 'jpeg') {
    const built = await createFrameEncoder({
      ...encoderOptions,
      sink: (bytes, frames) => api.exporter!.frame(sessionId, bytes, frames),
    });
    frameEncoder = built.encoder;
    if (!built.encoder) {
      signal?.removeEventListener('abort', onAbort);
      await api.exporter.cancel(sessionId);
      throw new Error(`The encoder could not start: ${(built as { reason: string }).reason}`);
    }
  }

  const timing = { seekMs: 0, compositeMs: 0, encodeMs: 0, writeMs: 0 };
  const renderBeganAt = performance.now();

  const reportFrames = (
    done: number,
    lanes?: { worker: number; chunk: number; frames: number; totalFrames: number }[]
  ) => {
    const elapsed = performance.now() - renderBeganAt;
    const rate = elapsed > 0 ? (done / elapsed) * 1000 : 0;
    const pct = 2 + Math.round((done / totalFrames) * 88);
    onProgress(pct, `Encoding frame ${done} of ${totalFrames}`, {
      frame: done,
      totalFrames,
      fps: Math.round(rate * 10) / 10,
      etaMs: rate > 0 ? Math.round(((totalFrames - done) / rate) * 1000) : null,
      engine,
      phase: 'rendering',
      ...(lanes ? { lanes } : {}),
    });
  };

  try {
    if (signal?.aborted) throw new DOMException('Export cancelled by user', 'AbortError');

    if (plan.chunked) {
      const stopListening = api.exporter.onChunkProgress?.((p) =>
        reportFrames(p.frames, p.lanes)
      );
      try {
        const farmed = await api.exporter.runChunked!({
          sessionId,
          width, height, fps: config.fps, codec: config.codec,
          hardware: config.hardware, bitrateMbps: config.bitrateMbps,
          frameFormat,
          project, tracks,
          startMs, totalFrames,
          workers: plan.workers,
        });
        if (!farmed.ok) throw new Error(farmed.error ?? 'The chunked render failed.');
      } finally {
        stopListening?.();
      }
    } else {
      const { canvas, ctx } = editorCanvas();
      await renderFrameSequence({
        tracks, project, width, height, fps: config.fps,
        startMs, totalFrames, canvas, ctx,
        encoder: frameEncoder,
        sendJpeg: (bytes) => api.exporter!.frame(sessionId, bytes),
        timing,
        onProgress: (done) => reportFrames(done),
        signal,
      });
    }

    if (signal?.aborted) throw new DOMException('Export cancelled by user', 'AbortError');

    if (frameEncoder) {
      onProgress(90, 'Finishing the last frames…', {
        frame: totalFrames, totalFrames, fps: 0, etaMs: 0, engine, phase: 'rendering',
      });
      await frameEncoder.finish();
    }

    if (signal?.aborted) throw new DOMException('Export cancelled by user', 'AbortError');

    onProgress(92, 'Mixing audio…', {
      frame: totalFrames, totalFrames, fps: 0, etaMs: null, engine, phase: 'audio',
    });
    const audioClips = windowAudioClips(collectAudioClips(tracks), startMs, renderMs);
    const result = await api.exporter.finish(sessionId, audioClips);
    if (!result.ok) throw new Error(result.error ?? 'Encoding failed.');

    onProgress(97, 'Writing subtitles…', {
      frame: totalFrames, totalFrames, fps: 0, etaMs: 0, engine, phase: 'audio',
    });
    const subtitles = await writeSubtitleSidecars(
      tracks, result.outputPath!, startMs, renderMs
    );

    onProgress(100, `Wrote ${result.outputPath}`, {
      frame: totalFrames, totalFrames, fps: 0, etaMs: 0, engine, phase: 'done',
    });

    signal?.removeEventListener('abort', onAbort);

    return {
      outputPath: result.outputPath!,
      frames: result.frames ?? totalFrames,
      hasAudio: Boolean(result.hasAudio),
      audio: result.audio,
      ...(audioSummary(result.audio, result.audioError) ? { audioError: audioSummary(result.audio, result.audioError) } : {}),
      bytes: result.bytes ?? 0,
      elapsedMs: Date.now() - startedAt,
      durationMs: renderMs,
      width,
      height,
      audioSegments: audioClips.length,
      engine,
      farm: { workers: plan.chunked ? plan.workers : 1, chunks: plan.chunked ? plan.chunks : 1 },
      ...(engineNote ? { engineNote } : {}),
      ...(subtitles.paths.length > 0 ? { subtitlePaths: subtitles.paths } : {}),
      ...(subtitles.note ? { subtitleNote: subtitles.note } : {}),
      timing: {
        seekMs: Math.round(timing.seekMs),
        compositeMs: Math.round(timing.compositeMs),
        encodeMs: Math.round(timing.encodeMs),
        writeMs: Math.round(timing.writeMs),
        msPerFrame: totalFrames > 0
          ? Math.round(((timing.seekMs + timing.compositeMs + timing.encodeMs + timing.writeMs)
              / totalFrames) * 10) / 10
          : 0,
      },
    };
  } catch (err) {
    signal?.removeEventListener('abort', onAbort);
    frameEncoder?.close();
    await api.exporter.cancel(sessionId);
    throw err;
  }
}
