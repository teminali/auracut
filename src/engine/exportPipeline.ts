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
   *
   * `durationMs` alone could only ever shorten a render from the front,
   * so the timeline's in/out points had nowhere to land: `ExportConfig`
   * had no field for them, `runHardwareExport` always rendered frame 0
   * to `durationMs`, and the ExportModal's "range only" checkbox
   * computed a duration that fed a LABEL and never reached the encoder.
   * A 1000-2000ms range still wrote all 60 frames from zero.
   */
  startMs?: number;
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
      'Every audible clip is set to duck, so there is nothing to duck against — ' +
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
    if (anySolo && track.type === 'audio' && !track.solo) continue;

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

/**
 * Render the sequence to a real file.
 *
 * `onProgress` receives 0..100 and a status line. Throws on failure —
 * an export that cannot produce a file must never report success.
 */
export async function runHardwareExport(
  tracks: Track[],
  project: ProjectSettings,
  config: ExportConfig,
  onProgress: (progressPct: number, statusText: string) => void
): Promise<ExportResult> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.exporter) {
    throw new Error('Export needs the desktop app — a browser cannot write video files.');
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
  const undecodable = await undecodableSources(tracks);
  if (undecodable.length > 0) {
    throw new Error(
      `${undecodable.length} media source${undecodable.length > 1 ? 's' : ''} could not be decoded, ` +
      'so the render would contain a placeholder instead of footage:\n' +
      undecodable.map((u) => `  • ${decodeURIComponent(u.replace(/^file:\/\//, ''))}`).join('\n')
    );
  }

  onProgress(2, 'Starting encoder…');

  const started = await api.exporter.start({
    width, height, fps: config.fps, codec: config.codec,
    outputPath, hardware: config.hardware, bitrateMbps: config.bitrateMbps,
  });
  if (!started.sessionId) throw new Error(started.error ?? 'Could not start the encoder.');
  const sessionId = started.sessionId;

  /*
    Render at the EXPORT resolution, not the project's. The compositor
    works in project pixels, so scaling here would resample twice; giving
    it the output size directly keeps one resampling step.
  */
  /*
    ONE canvas, and deliberately NOT `willReadFrequently`.

    That flag was set here with the reasoning "every frame is read back
    for JPEG encoding, so keep the surface on the CPU" — which sounds
    right and is backwards. Measured on the starter project, 345 frames
    at 1080p:

        willReadFrequently: true    encode 13,435ms   total 14,786ms
        willReadFrequently: false   encode  4,883ms   total  6,233ms

    A CPU-backed canvas pushes compositing through software rasterisation
    and gives `toBlob` no fast path to take. 2.4x, for removing a flag.

    A ring of canvases with the encodes issued together was tried and
    removed: at ring sizes 1, 4 and 8 the render took 6277ms, 6210ms and
    6318ms. `toBlob` serialises inside Chromium however many are in
    flight, so the ring bought nothing and cost 66MB at 1080p. If frame
    encoding is ever worth parallelising it needs OffscreenCanvas in
    workers, or WebCodecs, not more canvases on this thread.
  */
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not create a render context for export.');

  /*
    Where the time actually goes. The handover has listed a performance
    pass as "currently unmeasured" since the export was built, and the
    first question about a slow render — is it compositing, encoding, or
    the bridge? — had no answer. Four counters cost nothing and the
    result carries them back.
  */
  const timing = { seekMs: 0, compositeMs: 0, encodeMs: 0, writeMs: 0 };

  try {
    for (let frame = 0; frame < totalFrames; frame++) {
      const timestampMs = startMs + frame * frameIntervalMs;

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

      t0 = performance.now();
      renderTimelineFrame(ctx, tracks, project, timestampMs, width, height);
      timing.compositeMs += performance.now() - t0;

      t0 = performance.now();
      const jpeg = await canvasToJpeg(canvas);
      timing.encodeMs += performance.now() - t0;

      t0 = performance.now();
      const written = await api.exporter.frame(sessionId, jpeg);
      timing.writeMs += performance.now() - t0;
      if (!written.ok) throw new Error(written.error ?? 'The encoder stopped accepting frames.');

      if (frame % 5 === 0 || frame === totalFrames - 1) {
        const pct = 2 + Math.round((frame / totalFrames) * 88);
        onProgress(pct, `Encoding frame ${frame + 1} of ${totalFrames}`);
        // Let the UI paint; without this the window locks for the whole render.
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    onProgress(92, 'Mixing audio…');
    const audioClips = windowAudioClips(collectAudioClips(tracks), startMs, renderMs);
    const result = await api.exporter.finish(sessionId, audioClips);
    if (!result.ok) throw new Error(result.error ?? 'Encoding failed.');

    onProgress(100, `Wrote ${result.outputPath}`);

    return {
      outputPath: result.outputPath!,
      frames: result.frames ?? totalFrames,
      hasAudio: Boolean(result.hasAudio),
      audio: result.audio,
      /* Same fact in one line, for callers that only want to print it. */
      ...(audioSummary(result.audio, result.audioError) ? { audioError: audioSummary(result.audio, result.audioError) } : {}),
      bytes: result.bytes ?? 0,
      elapsedMs: Date.now() - startedAt,
      durationMs: renderMs,
      width,
      height,
      audioSegments: audioClips.length,
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
    await api.exporter.cancel(sessionId);
    throw err;
  }
}
