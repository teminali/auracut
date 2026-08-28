/* ═══════════════════════════════════════════════════════════════════
   The render farm.

   An export used to be one window compositing one frame at a time, and
   the shape of that loop is: seek every <video> to the exact source
   frame, wait for the decoder, draw, encode. Once WebCodecs took the
   encode off the critical path (`frameEncoder.ts`), what is left is
   almost entirely the SEEK — and a seek is one decoder, on one thread,
   waiting. Eight idle cores watch it happen.

   So: cut the timeline into chunks and render them at the same time in
   several hidden windows.

   The three things that make this simpler than it sounds:

     1. NOTHING NEEDS A MUXER. Each worker writes a byte stream — JPEG
        stills or Annex B NAL units — and both formats concatenate. Every
        chunk begins on a keyframe because the encoder is asked for one
        on its first frame, so joining chunks is `cat` in the right
        order. `render.ts` does the joining.
     2. THE WORKERS ARE THE SAME RENDERER. They load the same bundle with
        `?window=render-worker` and call the same `renderTimelineFrame`.
        There is no second compositor to keep in step, which is the
        mistake that would make every look change a two-place edit.
     3. AUDIO IS UNAFFECTED. It was never rendered frame by frame — it is
        rebuilt from the source files by an ffmpeg filtergraph at the end
        — so chunking the picture does not touch it.

   Chunks outnumber workers on purpose. Equal frame counts are not equal
   WORK: four seconds over a stack of six clips with a blur costs many
   times four seconds of a single cut. With a queue, a worker that draws
   a cheap chunk comes back for another instead of finishing early and
   idling while one slow chunk holds up the render.
   ═══════════════════════════════════════════════════════════════════ */

import { BrowserWindow, app } from 'electron';
import path from 'path';
import os from 'os';
import { closeChunk, drainChunks, resetChunk } from './render';
import { logEvent } from './crashLog';
import { planFarm as planPure, chunkRanges, FarmPlan } from '../src/services/renderPlan';

export type { FarmPlan };

export interface ChunkJobSpec {
  /** The export session every chunk feeds. */
  sessionId: string;
  width: number;
  height: number;
  fps: number;
  codec: 'h264' | 'hevc' | 'prores';
  hardware?: boolean;
  bitrateMbps?: number;
  frameFormat: 'jpeg' | 'h264' | 'hevc';
  /** The project and timeline, as plain JSON. */
  project: unknown;
  tracks: unknown;
  /** Where the render starts on the timeline, and how many frames it is. */
  startMs: number;
  totalFrames: number;
  /** How many windows to run at once. */
  workers: number;
}

export interface ChunkProgress {
  /** Frames finished across every chunk. */
  frames: number;
  totalFrames: number;
  /** Per worker, the chunk it is on and how far through it is. */
  lanes: { worker: number; chunk: number; frames: number; totalFrames: number }[];
}

/**
 * How many windows to run.
 *
 * Half the cores, because each worker is a full Chromium renderer with
 * its own video decoders and its own copy of every frame in flight —
 * this is bounded by memory and decoder bandwidth long before it is
 * bounded by arithmetic. Four is the ceiling until somebody has measured
 * a machine where more helps.
 */
export function defaultWorkerCount(): number {
  const cores = os.cpus()?.length ?? 4;
  return Math.max(1, Math.min(4, Math.floor(cores / 2)));
}

/**
 * Decide the shape of a render before it starts.
 *
 * The arithmetic itself is in `src/services/renderPlan.ts` so it can be
 * unit tested, which main cannot be, and so the ranges the farm renders
 * are built by the same function that counted them. This wrapper only
 * supplies the machine-dependent default.
 */
export function planFarm(totalFrames: number, fps: number, requested?: number): FarmPlan {
  return planPure(totalFrames, fps, defaultWorkerCount(), requested);
}

interface Lane {
  worker: number;
  window: BrowserWindow;
  ready: Promise<void>;
}

let jobCounter = 0;

function createWorker(index: number, jobId: string): Lane {
  const window = new BrowserWindow({
    show: false,
    /*
      A real size, not 1x1. The window never appears, but the page's
      layout viewport is derived from it and a degenerate one has caught
      out enough Chromium features to not be worth the memory it saves.
    */
    width: 640,
    height: 360,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      /* Local media is read straight off disk, exactly as in the editor. */
      webSecurity: false,
      /*
        Load-bearing, not defensive. macOS throttles timers in windows
        that are not visible, and every one of these is invisible for its
        whole life — with throttling on, the render loop's yield becomes
        a one-per-second tick and the farm is slower than the single
        window it replaced.
      */
      backgroundThrottling: false,
    },
  });

  /*
    Wait for the WORKER to say it is listening, not for the page to say
    it has loaded.

    `did-finish-load` fires when index.html and its bundle are in;
    `startRenderWorker` arrives a dynamic import later and registers the
    IPC listener then. A job sent in that gap is not queued anywhere —
    `ipcRenderer.on` only receives what is sent after it exists — so the
    chunk would simply never be rendered and the farm would wait on it
    forever.

    The timeout is the other half: a window that crashes during load
    never sends anything, and a render must fail rather than hang.
  */
  const ready = new Promise<void>((resolve, reject) => {
    const wc = window.webContents;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Render window ${index + 1} did not start within 30 seconds.`));
    }, 30_000);

    const onMessage = (_e: Electron.IpcMainEvent, msg: { job: string; kind: string }) => {
      if (msg?.kind !== 'ready' || msg.job !== jobId) return;
      cleanup();
      resolve();
    };
    const onGone = () => {
      cleanup();
      reject(new Error(`Render window ${index + 1} stopped before it could start.`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      wc.ipc.removeListener('render:chunk', onMessage);
      wc.removeListener('render-process-gone', onGone);
    };

    wc.ipc.on('render:chunk', onMessage);
    wc.once('render-process-gone', onGone);
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  const query = { window: 'render-worker', job: jobId, lane: String(index) };
  if (!app.isPackaged) {
    const qs = new URLSearchParams(query).toString();
    void window.loadURL(`${devUrl}?${qs}`);
  } else {
    void window.loadFile(path.join(__dirname, '../dist/index.html'), { query });
  }

  return { worker: index, window, ready };
}

/**
 * Render `spec` across several windows and feed the result to the
 * session's encoder in order.
 *
 * Resolves once every chunk has been written AND drained into ffmpeg, so
 * the caller can go straight to `finishExport`. Rejects — after tearing
 * every window down — if any chunk fails, because a render missing a
 * slice is not a shorter render, it is a wrong one.
 */
export async function runChunkedRender(
  spec: ChunkJobSpec,
  onProgress: (p: ChunkProgress) => void
): Promise<{ chunks: number }> {
  const jobId = `job_${Date.now().toString(36)}_${++jobCounter}`;
  /*
    Re-plan rather than trust the numbers that came over the bridge. The
    renderer asked `planFarm` what the shape would be and is showing that
    answer in its dialog, but the RANGES have to be built here by the
    same function that produced the count. One source, or the seams do
    not meet.
  */
  const plan = planFarm(spec.totalFrames, spec.fps, spec.workers);
  const ranges = chunkRanges(spec.totalFrames, plan.chunkFrames);
  const chunkCount = ranges.length;
  const workers = Math.min(spec.workers, chunkCount);

  /*
    The queue, as a list rather than a counter.

    A counter cannot give a chunk back. When a render window dies — and
    over a twenty-minute render on a loaded machine, one sometimes does —
    the chunk it had claimed is simply gone, `drainChunks` finds a hole
    and the whole render fails at ninety percent. With a list, a
    surviving lane picks it up and the render is slower instead of lost.

    One retry, and then it is a real failure. A chunk that fails twice is
    failing for a reason that will not change, and retrying it forever
    would turn a broken source into a render that never ends.
  */
  const queue: number[] = ranges.map((r) => r.index);
  const attempts = new Map<number, number>();
  /** Frames confirmed written, per finished chunk. */
  const finished = new Map<number, number>();
  /** Live progress, per worker. */
  const lanes = new Map<number, { chunk: number; frames: number; totalFrames: number }>();

  const report = () => {
    let frames = 0;
    for (const n of finished.values()) frames += n;
    for (const lane of lanes.values()) frames += lane.frames;
    onProgress({
      frames: Math.min(frames, spec.totalFrames),
      totalFrames: spec.totalFrames,
      lanes: [...lanes.entries()].map(([worker, l]) => ({ worker, ...l })),
    });
  };

  const pool: Lane[] = [];
  for (let i = 0; i < workers; i++) pool.push(createWorker(i, jobId));

  const destroy = () => {
    for (const lane of pool) {
      try { if (!lane.window.isDestroyed()) lane.window.destroy(); } catch { /* already gone */ }
    }
  };

  try {
    /*
      One lane's whole life: take a chunk, render it, take the next.
      Each iteration is a fresh promise over the window's IPC rather than
      a long-lived listener, so a crashed window rejects the chunk it was
      on instead of leaving the farm waiting forever.
    */
    const runLane = async (lane: Lane): Promise<void> => {
      await lane.ready;

      for (;;) {
        const index = queue.shift();
        if (index === undefined) return;

        attempts.set(index, (attempts.get(index) ?? 0) + 1);
        const { firstFrame, frames } = ranges[index];
        lanes.set(lane.worker, { chunk: index, frames: 0, totalFrames: frames });
        report();

        await new Promise<void>((resolve, reject) => {
          const wc = lane.window.webContents;

          const onMessage = (
            _e: Electron.IpcMainEvent,
            msg: { job: string; chunk: number; kind: string; frames?: number; message?: string }
          ) => {
            if (msg.job !== jobId || msg.chunk !== index) return;
            if (msg.kind === 'progress') {
              const l = lanes.get(lane.worker);
              if (l) { l.frames = msg.frames ?? 0; report(); }
              return;
            }
            cleanup();
            if (msg.kind === 'done') resolve();
            else reject(new Error(msg.message ?? `Chunk ${index} failed.`));
          };

          const onGone = () => {
            cleanup();
            reject(new Error(`The render window for chunk ${index} stopped responding.`));
          };

          const cleanup = () => {
            wc.ipc.removeListener('render:chunk', onMessage);
            wc.removeListener('render-process-gone', onGone);
            wc.removeListener('destroyed', onGone);
          };

          wc.ipc.on('render:chunk', onMessage);
          wc.once('render-process-gone', onGone);
          wc.once('destroyed', onGone);

          wc.send('render:job', {
            job: jobId,
            chunk: index,
            sessionId: spec.sessionId,
            width: spec.width,
            height: spec.height,
            fps: spec.fps,
            codec: spec.codec,
            hardware: spec.hardware,
            bitrateMbps: spec.bitrateMbps,
            frameFormat: spec.frameFormat,
            project: spec.project,
            tracks: spec.tracks,
            /*
              The render's own start, unchanged, plus the index of this
              chunk's first frame. NOT a pre-multiplied start time: the
              worker has to reach a given instant by exactly the same
              arithmetic the single-window path uses, or the two disagree
              in the last bit and a frame on a cut boundary renders
              differently. See `firstFrame` in `exportPipeline.ts`.
            */
            startMs: spec.startMs,
            firstFrame,
            frames,
          });
        });

        const closed = await closeChunk(spec.sessionId, index);
        finished.set(index, closed.frames);
        lanes.delete(lane.worker);
        report();
      }
    };

    /*
      A lane that fails puts its chunk back and stops, rather than taking
      the render down with it. The render still fails if nobody picks the
      chunk up — `drainChunks` refuses a job with a hole in it — but one
      dead window out of four is now a slower render instead of no
      render at all.
    */
    const runLaneSafely = async (lane: Lane): Promise<void> => {
      try {
        await runLane(lane);
      } catch (err) {
        const held = lanes.get(lane.worker);
        if (held) {
          lanes.delete(lane.worker);
          if ((attempts.get(held.chunk) ?? 0) < 2) {
            await resetChunk(spec.sessionId, held.chunk);
            queue.push(held.chunk);
            /* Recorded, because a retried chunk is invisible from the
               outside: the render simply takes longer and finishes. */
            logEvent('export', 'warn',
              `Render chunk ${held.chunk} failed and will be retried`,
              (err as Error).message);
          }
        }
        report();
      }
    };

    await Promise.all(pool.map(runLaneSafely));

    /*
      Chunks put back by a dying lane need somebody to take them, and by
      now every lane has stopped. One more pass over whatever is left,
      on the windows that are still alive.
    */
    while (queue.length > 0) {
      const alive = pool.filter((l) => !l.window.isDestroyed());
      if (alive.length === 0) break;
      const before = queue.length;
      await Promise.all(alive.map(runLaneSafely));
      /* No progress means nothing is going to make any. Stop, and let
         `drainChunks` report the hole rather than spinning. */
      if (queue.length >= before) break;
    }
  } finally {
    destroy();
  }

  const drained = await drainChunks(spec.sessionId, chunkCount);
  if (!drained.ok) throw new Error(drained.error ?? 'The chunks could not be joined.');

  return { chunks: chunkCount };
}
