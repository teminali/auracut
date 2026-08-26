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

import { Track, ProjectSettings } from '../types/edl';
import { renderTimelineFrame, undecodableSources } from './compositor';
import { seekVideosForFrame } from './videoEngine';

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
}

/**
 * Audio settings the render cannot honour.
 *
 * The export filtergraph applies gain, fades and speed. It does not
 * apply ducking, pitch shift, voice effects or noise reduction — those
 * are stored on the clip and silently ignored. Returning them lets the
 * caller say so out loud, because a quiet omission is exactly what an
 * agent will report back to the user as "done".
 */
export function unsupportedAudioSettings(tracks: Track[]): string[] {
  const found = new Set<string>();

  for (const track of tracks) {
    for (const clip of track.clips) {
      if (!clip.mediaUrl) continue;
      const a = clip.audio;
      if (a.ducking) found.add('Audio ducking is set but is not applied to the exported render.');
      if (a.noiseReduction) found.add('Noise reduction is set but is not applied to the exported render.');
      if (a.pitch && a.pitch !== 0) found.add('Pitch shift is set but is not applied to the exported render.');
      if (a.voiceEffect && a.voiceEffect !== 'none') {
        found.add(`Voice effect "${a.voiceEffect}" is set but is not applied to the exported render.`);
      }
    }
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
      0.95
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
        speed: clip.speed?.multiplier ?? 1,
      });
    }
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
  const renderMs = config.durationMs ?? project.durationMs;
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
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  // Every frame is read back for JPEG encoding, so keep the surface on the CPU.
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!ctx) throw new Error('Could not create a render context for export.');

  try {
    for (let frame = 0; frame < totalFrames; frame++) {
      const timestampMs = frame * frameIntervalMs;

      /*
        Park every <video> on the exact source frame this instant needs
        BEFORE compositing. `renderTimelineFrame` is synchronous: it draws
        whatever frame each element happens to be holding, so without this
        the export writes one stale frame over and over — a real file, the
        right duration, and completely the wrong picture.
      */
      await seekVideosForFrame(tracks, timestampMs);

      renderTimelineFrame(ctx, tracks, project, timestampMs, width, height);
      const jpeg = await canvasToJpeg(canvas);

      const written = await api.exporter.frame(sessionId, jpeg);
      if (!written.ok) throw new Error(written.error ?? 'The encoder stopped accepting frames.');

      if (frame % 5 === 0 || frame === totalFrames - 1) {
        const pct = 2 + Math.round((frame / totalFrames) * 88);
        onProgress(pct, `Encoding frame ${frame + 1} of ${totalFrames}`);
        // Let the UI paint; without this the window locks for the whole render.
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    onProgress(92, 'Mixing audio…');
    const audioClips = collectAudioClips(tracks);
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
    };
  } catch (err) {
    await api.exporter.cancel(sessionId);
    throw err;
  }
}
