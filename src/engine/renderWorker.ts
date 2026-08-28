/* ═══════════════════════════════════════════════════════════════════
   A render-farm worker.

   This is the whole of the second window. It holds no store, no React,
   no project — main hands it a slice of timeline as JSON, it composites
   that slice through the SAME `renderFrameSequence` the editor uses, and
   it writes the bytes to its own chunk file. Then it waits for another.

   Why a window and not a Web Worker: a worker thread cannot create an
   `HTMLVideoElement`, and video decode is the entire reason this exists.
   `videoEngine` needs a DOM. A hidden BrowserWindow is the cheapest
   thing that has one.

   It reports failure rather than throwing into the void. A worker that
   dies quietly leaves a chunk that never arrives, and `renderFarm`
   would sit waiting on it for the length of the render — so every path
   out of `runChunk` ends in a message.
   ═══════════════════════════════════════════════════════════════════ */

import { Track, ProjectSettings } from '../types/edl';
import { createFrameEncoder } from './frameEncoder';
import { renderFrameSequence, ensureFontsLoaded, RenderTiming } from './exportPipeline';
import { undecodableSources } from './compositor';

interface RenderJob {
  job: string;
  chunk: number;
  sessionId: string;
  width: number;
  height: number;
  fps: number;
  codec: 'h264' | 'hevc' | 'prores';
  hardware?: boolean;
  bitrateMbps?: number;
  frameFormat: 'jpeg' | 'h264' | 'hevc';
  project: ProjectSettings;
  tracks: Track[];
  startMs: number;
  /** Index of this chunk's first frame within the whole render. */
  firstFrame: number;
  frames: number;
}

/**
 * Warm every decoder, once per window, and refuse to draw a placeholder.
 *
 * This is the same check the editor runs before an export, repeated here
 * because it is a DIFFERENT PROCESS: the editor proving a file decodes
 * says nothing about whether this window can open it, and a source that
 * fails here does not fail loudly — the compositor draws its grey
 * gradient, which goes into the file looking like a deliberate shot.
 *
 * It costs nothing extra. Every source has to be decoded before the
 * first seek anyway; this only does it up front and looks at the result.
 * Cached for the window's life, because the answer cannot change and the
 * decoders stay open between chunks.
 */
let decodeCheck: Promise<string[]> | null = null;

function sourcesReady(tracks: Track[]): Promise<string[]> {
  if (!decodeCheck) decodeCheck = undecodableSources(tracks);
  return decodeCheck;
}

async function runChunk(job: RenderJob): Promise<void> {
  const api = window.electronAPI;
  const report = (msg: Record<string, unknown>) =>
    api?.renderWorker?.report({ job: job.job, chunk: job.chunk, ...msg });

  if (!api?.exporter || !api.renderWorker) {
    report({ kind: 'error', message: 'The render worker has no bridge to the encoder.' });
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = job.width;
  canvas.height = job.height;
  // Same context options as the editor's export — see exportPipeline.
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    report({ kind: 'error', message: 'The render worker could not create a canvas context.' });
    return;
  }

  const sink = (bytes: Uint8Array, frames: number) =>
    api.exporter!.chunk(job.sessionId, job.chunk, bytes, frames);

  let encoder: Awaited<ReturnType<typeof createFrameEncoder>>['encoder'] = null;
  if (job.frameFormat !== 'jpeg') {
    const built = await createFrameEncoder({
      width: job.width, height: job.height, fps: job.fps, codec: job.codec,
      bitrateMbps: job.bitrateMbps, hardware: job.hardware ?? true, sink,
    });
    encoder = built.encoder;
    if (!encoder) {
      /*
        Main already decided the format and told ffmpeg to expect it. A
        worker that quietly fell back to JPEG here would send stills into
        a pipe reading h264 — a file of the right length containing
        nothing. Refuse instead.
      */
      report({
        kind: 'error',
        message: `Chunk ${job.chunk} could not start the ${job.codec} encoder: ` +
          (built as { reason: string }).reason,
      });
      return;
    }
  }

  const timing: RenderTiming = { seekMs: 0, compositeMs: 0, encodeMs: 0, writeMs: 0 };

  try {
    await ensureFontsLoaded(job.tracks);

    const undecodable = await sourcesReady(job.tracks);
    if (undecodable.length > 0) {
      report({
        kind: 'error',
        message:
          `${undecodable.length} media source${undecodable.length > 1 ? 's' : ''} could not be ` +
          'decoded in the render window, so this chunk would contain a placeholder instead of ' +
          `footage: ${undecodable.join(', ')}`,
      });
      encoder?.close();
      return;
    }

    await renderFrameSequence({
      tracks: job.tracks,
      project: job.project,
      width: job.width,
      height: job.height,
      fps: job.fps,
      startMs: job.startMs,
      firstFrame: job.firstFrame,
      totalFrames: job.frames,
      canvas,
      ctx,
      encoder,
      sendJpeg: (bytes) => sink(bytes, 1),
      timing,
      onProgress: (frames) => report({ kind: 'progress', frames }),
    });

    if (encoder) await encoder.finish();
    report({ kind: 'done', frames: job.frames });
  } catch (err) {
    encoder?.close();
    report({ kind: 'error', message: (err as Error).message });
  }
  /*
    The decoders are deliberately NOT dropped between chunks.

    The obvious housekeeping — `stopAllVideo()` in a `finally` — was
    written here and taken out again. A worker takes its next chunk from
    anywhere on the timeline, but almost always out of the SAME source
    files, and closing every element means re-opening and re-parsing all
    of them for each chunk. That is the exact cost this whole thing
    exists to avoid, paid three times per worker.

    `videoEngine` already pauses whatever is not under the playhead, so
    an idle element is a handle rather than a decode loop, and the window
    is destroyed the moment the job ends, which frees the lot at once.
  */
}

/** Listen for work. Called once, from `main.tsx`, in the worker window only. */
export function startRenderWorker(): void {
  const api = window.electronAPI;
  if (!api?.renderWorker) return;

  /*
    Serialised deliberately. Main only sends the next job after this one
    reports, but a queue here costs nothing and means a duplicate send
    cannot start two renders writing into the same chunk file.
  */
  let chain: Promise<void> = Promise.resolve();
  api.renderWorker.onJob((job) => {
    chain = chain.then(() => runChunk(job as RenderJob));
  });

  /*
    Say so, and only now.

    The farm used to start sending work at `did-finish-load`, which is
    the wrong signal by construction: this module arrives through a
    dynamic import, so the page has finished loading a measurable moment
    BEFORE the listener above exists. `ipcRenderer.on` does not receive
    what was sent before it was registered, so the first chunk would
    vanish and the render would wait on it for as long as anybody let it.

    The job id comes off this window's own URL because there is no job
    yet to read it from.
  */
  const job = new URLSearchParams(window.location.search).get('job') ?? '';
  api.renderWorker.report({ job, chunk: -1, kind: 'ready' });
}
