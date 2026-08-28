/* ═══════════════════════════════════════════════════════════════════
   How a render is cut into chunks.

   Pure arithmetic, in `src/services` rather than `electron/`, for the
   reason `trialPolicy` and `updateFeed` are: the main process cannot be
   unit tested, and this is the part of the render farm where being
   wrong is silent. A gap between two chunks is frames that never reach
   the file; an overlap is frames written twice. Either produces a video
   that plays, at the wrong length, with the picture drifting out of the
   audio from the seam onward — and neither raises anything.

   So the ranges are computed in one place, and `renderPlan.test.ts`
   asserts the property that matters: the chunks tile the render exactly.
   ═══════════════════════════════════════════════════════════════════ */

export interface FarmPlan {
  /** How many windows to open. 1 means render in the editor window. */
  workers: number;
  /** How many slices the timeline is cut into. */
  chunks: number;
  /** Frames per chunk, before the last one is trimmed to fit. */
  chunkFrames: number;
  /** Whether the farm is worth using at all. */
  chunked: boolean;
  /** Said in the UI, so the choice is never a mystery. */
  reason: string;
}

/** The absolute upper bound on windows, whatever a caller asks for. */
export const MAX_WORKERS = 8;

/**
 * Frames per chunk.
 *
 * A window costs roughly a second to open and load the bundle, so a
 * chunk has to be worth more than that or the farm spends its time
 * starting up. Four seconds of timeline is the floor; longer renders get
 * proportionally longer chunks so the queue does not grow without bound.
 *
 * Three chunks per worker is the target: enough that a slow chunk is
 * evened out by the others, few enough that the per-chunk overhead
 * stays invisible.
 */
export function chunkSize(totalFrames: number, fps: number, workers: number): number {
  const floor = Math.max(1, Math.round(fps * 4));
  const target = Math.ceil(Math.max(1, totalFrames) / Math.max(1, workers * 3));
  return Math.max(floor, target);
}

/**
 * Decide the shape of a render before it starts.
 *
 * `requested` is what the user picked; absent means "use `fallback`",
 * which main fills in from the core count.
 */
export function planFarm(
  totalFrames: number,
  fps: number,
  fallbackWorkers: number,
  requested?: number
): FarmPlan {
  const asked = requested ?? fallbackWorkers;
  const workers = Math.max(1, Math.min(MAX_WORKERS, Math.floor(asked) || 1));

  if (workers < 2) {
    return {
      workers: 1, chunks: 1, chunkFrames: Math.max(1, totalFrames), chunked: false,
      reason: 'Rendering in one window.',
    };
  }

  const size = chunkSize(totalFrames, fps, workers);
  const chunks = Math.ceil(Math.max(1, totalFrames) / size);
  if (chunks < 2) {
    return {
      workers: 1, chunks: 1, chunkFrames: Math.max(1, totalFrames), chunked: false,
      reason: 'The render is shorter than one chunk, so a second window would only cost time.',
    };
  }

  /* Never more windows than there is work for them: a fifth window on a
     four-chunk render opens, loads the bundle and exits having drawn
     nothing. */
  const used = Math.min(workers, chunks);
  return {
    workers: used,
    chunks,
    chunkFrames: size,
    chunked: true,
    reason: `${chunks} chunks across ${used} windows.`,
  };
}

export interface ChunkRange {
  index: number;
  /** First frame of the chunk, counted from the start of the render. */
  firstFrame: number;
  /** How many frames it covers. The last chunk is usually short. */
  frames: number;
}

/**
 * Every chunk's frame range, in order.
 *
 * The one definition. `runChunkedRender` walks this rather than
 * recomputing `index * size` at the call site, because a second copy of
 * the arithmetic is how a farm ends up rendering frame 900 twice and
 * frame 1200 never.
 */
export function chunkRanges(totalFrames: number, size: number): ChunkRange[] {
  const out: ChunkRange[] = [];
  if (totalFrames <= 0 || size <= 0) return out;
  for (let index = 0, firstFrame = 0; firstFrame < totalFrames; index++, firstFrame += size) {
    out.push({ index, firstFrame, frames: Math.min(size, totalFrames - firstFrame) });
  }
  return out;
}
