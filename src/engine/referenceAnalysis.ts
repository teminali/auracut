/* ═══════════════════════════════════════════════════════════════════
   Reference-video analysis — describe HOW a video is edited.

   An agent handed a reference clip currently improvises: a dozen
   `ffmpeg_process` calls, a handful of `get_frame_context` reads, and a
   different answer every run. This does it once, deterministically, and
   returns cuts, cadence against the beat, grade, motion and on-screen
   overlays as numbers.

   ── How the pixels get here, and why it is done this way ────────────

   The renderer cannot run ffmpeg and main cannot run a canvas, so the
   two have to meet somewhere. The obvious meeting point — seek a
   `<video>` to every frame and read it back — is neither fast nor
   deterministic: a seek lands on whatever frame the demuxer decides is
   nearest, and the answer changes with decoder state.

   So ffmpeg is asked for a CONTACT SHEET instead. `scale` shrinks every
   frame to a cell and `tile` lays the whole clip out as ONE image:

       fps=R, scale=CW:CH:flags=area, tile=GxG:padding=2:margin=2:color=magenta

   One decode, one seek, one `getImageData`, and every analysed frame is
   in memory at a known offset. Nothing is inferred from metadata; every
   number below is measured off those pixels.

   Two properties of that sheet are load-bearing:

   · **The magenta.** `tile` fills the cells past the end of the clip
     with the padding colour, so counting real cells measures the frame
     count — and `frameCount / duration` is then a MEASURED frame rate
     rather than a container's claim. The 2px gutter between cells is
     magenta too, which is why the reader checks it: if the gutter is not
     magenta the grid arithmetic is wrong, and every number after it
     would be measured off the wrong pixels. That check also doubles as
     "has the frame actually painted yet", since an unpainted canvas is
     black, not magenta.

   · **The sampling flag.** The cut/motion sheet uses `flags=area` — a
     box average, which suppresses sensor noise and is what a difference
     metric wants. The grade sheet uses `flags=neighbor` — POINT samples,
     which is what a HISTOGRAM wants: area-averaging pulls the extremes
     towards the middle, so it would report every clip as having lifted
     blacks and less contrast than it has. Point sampling is an unbiased
     sample of the real pixel distribution.

   ── The one input this cannot analyse, and it is not the tool ───────

   One constructed fixture reproduces a failure every time: 1.5s of
   `smptebars` hard-cut to 2.5s of a darkened `testsrc2`. ffmpeg writes
   its contact sheet correctly — an independent reader finds the magenta
   gutter at 100% of the expected pixels — and the browser engine will
   not produce a frame from it. `<video>` fires `loadeddata`, `drawImage`
   paints nothing, and the log carries Chromium's "Unsupported pixel
   format: -1".

   It is not the geometry (five different grids, all the same), the
   source encoding (three re-encodes including a resize, all the same),
   the colour tagging (byte-for-byte the same tags as sheets that DO
   decode), or an exhausted decoder pool (files before and after it
   analyse in 0.2s). A ProRes rebuild is not the way out either: this
   Chromium cannot open ProRes at all.

   So what happens instead is that it REFUSES, in about two seconds, and
   says the canvas was blank. The alternative — measuring an unpainted
   canvas — reports a very dark video with no cuts and no reason to doubt
   it, which is exactly the shape of failure this codebase exists to
   prevent. The magenta gutter is what makes the refusal possible.

   ── What was measured while building this ───────────────────────────

   Every threshold here was set against constructed fixtures, and the
   negative controls are the ones that set them:

   · A 12.5 %-of-width-per-second pan with NO cuts scores 0.103 on the
     cut metric, above the absolute floor of 0.10. It is rejected by the
     local-baseline ratio instead, because a steady pan produces a FLAT
     score curve. A floor alone would have called it a cut; a ratio alone
     would have called dead-still footage a cut, because a ratio has
     nothing to divide by when the baseline is encoder noise. Both tests
     are needed and `tools/verify_reference_analysis.py` fails if either
     is removed.

   · A two-frame white flash inside one continuous shot scores 1.26 —
     higher than any real cut in the fixtures — twice, once in and once
     out. Flashes are recognised by the content RETURNING: if the frame
     before the first spike matches the frame after the second, nothing
     was cut.

   · Hard histogram bins produced a 0.15 phantom on static colour bars,
     purely from values sitting on a bin edge and flipping. The
     histograms here are trilinearly interpolated, which drops that
     phantom to 0.022.

   · Motion was wrong first. Estimating a shift between ADJACENT frames
     and interpolating the correlation peak reported the 12.5 %/s pan as
     4.6 %/s and a 31.25 %/s pan as 44.7 %/s — a sub-pixel parabola fitted
     to a V-shaped SAD surface, plus a shift too small to resolve at all.
     I suspected the fixture (its detail was drawn on a periodic grid);
     re-testing on non-periodic detail moved the numbers by less than
     0.1 %/s, so the fixture was fine and the ESTIMATOR was wrong. It
     measures displacement from an anchor frame over a growing baseline
     and fits a line through it, which reads those same two pans as
     12.32 and 30.26 %/s.
   ═══════════════════════════════════════════════════════════════════ */

import type { BeatDetectionResult } from './beatDetect';

/* ── The bridge this needs, declared rather than imported ──────────
   `analyzeReferenceVideo` is handed its ffmpeg and its beat detector so
   the orchestration can be driven with fakes, and so this module has no
   opinion about which process it is running in. */

export interface FfmpegProcessOptions {
  input: string;
  vf?: string;
  af?: string;
  fps?: number;
  codec?: 'h264' | 'prores';
  noAudio?: boolean;
  audioOnly?: boolean;
  name?: string;
}

export interface FfmpegProcessResult {
  ok: boolean;
  path?: string;
  bytes?: number;
  error?: string;
}

export interface ReferenceAnalysisDeps {
  ffmpegProcess: (opts: FfmpegProcessOptions) => Promise<FfmpegProcessResult>;
  detectBeats: (url: string, offsetMs?: number) => Promise<BeatDetectionResult>;
}

export interface ReferenceAnalysisInput {
  /** `file://` URL or absolute path of the reference video. */
  url: string;
  name?: string;
  /** Force the analysis frame rate instead of measuring the source's. */
  analysisFps?: number;
  /** Ceiling on analysed frames; the rate is reduced to fit. Default 3600. */
  maxFrames?: number;
  /** 0..100. Higher finds more cuts. Default 50. */
  cutSensitivity?: number;
  includeGrade?: boolean;
  includeMotion?: boolean;
  includeOverlays?: boolean;
  includeCadence?: boolean;
}

/* ── Tile geometry ────────────────────────────────────────────────── */

export interface TileLayout {
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
  padding: number;
  margin: number;
  width: number;
  height: number;
  capacity: number;
}

const PAD_RGB = [255, 0, 255] as const;

function even(n: number): number {
  return Math.max(2, 2 * Math.round(n / 2));
}

/**
 * Lay out a contact sheet that holds `capacityWanted` cells of the
 * source's aspect ratio without exceeding `maxSide` in either direction.
 *
 * Cell dimensions are forced EVEN because the sheet is encoded as
 * yuv420p, which cannot represent an odd width or height — and ffmpeg
 * does not fail on one, it silently rounds, which would move every cell
 * after the first by a pixel and quietly corrupt the whole read.
 */
export function chooseTileLayout(
  capacityWanted: number,
  srcW: number,
  srcH: number,
  opts: { cellArea?: number; maxSide?: number; padding?: number; margin?: number } = {}
): TileLayout {
  const cellArea = opts.cellArea ?? 2304; // 64x36
  const maxSide = opts.maxSide ?? 2400;
  const padding = opts.padding ?? 2;
  const margin = opts.margin ?? 2;

  const capacity = Math.max(1, Math.ceil(capacityWanted));
  const cols = Math.ceil(Math.sqrt(capacity));
  const rows = Math.ceil(capacity / cols);

  const aspect = srcW > 0 && srcH > 0 ? srcW / srcH : 16 / 9;
  let cellW = even(Math.sqrt(cellArea * aspect));
  let cellH = even(cellW / aspect);

  // Shrink until the sheet fits, keeping the aspect and staying even.
  for (let guard = 0; guard < 64; guard++) {
    const w = 2 * margin + cols * cellW + (cols - 1) * padding;
    const h = 2 * margin + rows * cellH + (rows - 1) * padding;
    if (w <= maxSide && h <= maxSide) break;
    const shrink = Math.min(maxSide / w, maxSide / h) * 0.98;
    cellW = even(cellW * shrink);
    cellH = even(cellH * shrink);
    if (cellW <= 8 || cellH <= 8) break;
  }

  cellW = Math.max(8, cellW);
  cellH = Math.max(8, cellH);

  return {
    cellW, cellH, cols, rows, padding, margin,
    width: 2 * margin + cols * cellW + (cols - 1) * padding,
    height: 2 * margin + rows * cellH + (rows - 1) * padding,
    capacity: cols * rows,
  };
}

export function tileFiltergraph(
  layout: TileLayout,
  opts: { fps?: number; flags: 'area' | 'neighbor' }
): string {
  const parts: string[] = [];
  if (opts.fps) parts.push(`fps=${opts.fps.toFixed(6)}`);
  parts.push(`scale=${layout.cellW}:${layout.cellH}:flags=${opts.flags}`);
  /*
    `setsar=1` is not cosmetic and leaving it out cost a debugging round.

    `scale` preserves the DISPLAY aspect ratio by writing a sample aspect
    ratio, so scaling 1280x720 into a 238x134 cell tags the output
    SAR=1072:1071. ffprobe still reports the sheet as 1682 wide, and so
    does every pixel in it — but Chromium multiplies by the SAR, hands
    back `videoWidth` 1684, and `drawImage` RESAMPLES the sheet by 1.001
    on the way to the canvas. Every cell after the first would then be
    read a fraction of a pixel out, drifting further along the row, with
    no error anywhere. The geometry check in `readSheet` is what caught
    it; this is what stops it happening.
  */
  parts.push('setsar=1');
  parts.push(
    `tile=${layout.cols}x${layout.rows}:padding=${layout.padding}:` +
    `margin=${layout.margin}:color=magenta`
  );
  return parts.join(',');
}

/** Where cell `index` starts in the sheet. */
export function cellOrigin(layout: TileLayout, index: number): { x: number; y: number } {
  const row = Math.floor(index / layout.cols);
  const col = index % layout.cols;
  return {
    x: layout.margin + col * (layout.cellW + layout.padding),
    y: layout.margin + row * (layout.cellH + layout.padding),
  };
}

function isPadColour(r: number, g: number, b: number): boolean {
  return r > 190 && g < 80 && b > 190;
}

/**
 * How many cells at the start of the sheet hold real frames.
 *
 * `tile` fills the tail with `color=magenta`, so this is a MEASUREMENT of
 * the clip's frame count rather than a number read off a container. A
 * real frame reduced to a cell is never a flat magenta field: the test
 * requires both the hue and near-zero variance.
 */
export function countRealCells(
  pixels: Uint8ClampedArray, sheetW: number, layout: TileLayout
): number {
  for (let index = 0; index < layout.capacity; index++) {
    const { x, y } = cellOrigin(layout, index);
    let sr = 0, sg = 0, sb = 0, n = 0, maxDev = 0;
    // A sparse probe: a padding cell is uniform, so a grid of samples
    // decides it as well as every pixel would, for a fraction of the work.
    for (let dy = 0; dy < layout.cellH; dy += 3) {
      for (let dx = 0; dx < layout.cellW; dx += 3) {
        const o = ((y + dy) * sheetW + (x + dx)) * 4;
        sr += pixels[o]; sg += pixels[o + 1]; sb += pixels[o + 2];
        n++;
      }
    }
    const mr = sr / n, mg = sg / n, mb = sb / n;
    for (let dy = 0; dy < layout.cellH; dy += 3) {
      for (let dx = 0; dx < layout.cellW; dx += 3) {
        const o = ((y + dy) * sheetW + (x + dx)) * 4;
        maxDev = Math.max(maxDev,
          Math.abs(pixels[o] - mr), Math.abs(pixels[o + 1] - mg), Math.abs(pixels[o + 2] - mb));
      }
    }
    if (isPadColour(mr, mg, mb) && maxDev < 24) return index;
  }
  return layout.capacity;
}

/**
 * Is the gutter between cells actually the padding colour?
 *
 * If it is not, the grid arithmetic disagrees with the sheet ffmpeg
 * produced and every measurement downstream is being read off the wrong
 * pixels. Cheap, and it turns a whole class of silent off-by-one into a
 * refusal. It doubles as a paint check: a canvas that has not received
 * the frame yet is black, and black is not magenta.
 */
export function paddingIntact(
  pixels: Uint8ClampedArray, sheetW: number, sheetH: number, layout: TileLayout
): boolean {
  if (layout.cols < 2 && layout.rows < 2) return true;
  let checked = 0;
  let good = 0;
  const probe = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= sheetW || y >= sheetH) return;
    const o = (y * sheetW + x) * 4;
    checked++;
    if (isPadColour(pixels[o], pixels[o + 1], pixels[o + 2])) good++;
  };
  for (let c = 1; c < layout.cols; c++) {
    const x = layout.margin + c * (layout.cellW + layout.padding) - 1;
    for (let r = 0; r < layout.rows; r++) probe(x, layout.margin + r * (layout.cellH + layout.padding) + 2);
  }
  for (let r = 1; r < layout.rows; r++) {
    const y = layout.margin + r * (layout.cellH + layout.padding) - 1;
    for (let c = 0; c < layout.cols; c++) probe(layout.margin + c * (layout.cellW + layout.padding) + 2, y);
  }
  return checked > 0 && good / checked > 0.9;
}

/* ── Per-frame features ───────────────────────────────────────────── */

const HIST_BINS = 4; // per channel, so 64 in total
const HIST_SIZE = HIST_BINS * HIST_BINS * HIST_BINS;

export interface FrameFeatures {
  /** Rec.709 luma, 0..255, cellW*cellH. */
  luma: Float32Array;
  /** Trilinearly-binned RGB histogram, sums to 1. */
  hist: Float32Array;
  lumaMean: number;
}

/**
 * Luma plane and colour histogram for one cell.
 *
 * The histogram is TRILINEARLY interpolated rather than hard-binned.
 * Hard bins put a phantom 0.15 distance on static colour bars — nothing
 * in the picture moved, but values sitting on a bin edge flipped sides
 * from one frame's rounding to the next. Spreading each pixel across its
 * eight neighbouring bins by distance drops that to 0.022, which is
 * below the noise the encoder itself contributes.
 */
export function cellFeatures(
  pixels: Uint8ClampedArray, sheetW: number, layout: TileLayout, index: number
): FrameFeatures {
  const { x, y } = cellOrigin(layout, index);
  const { cellW, cellH } = layout;
  const luma = new Float32Array(cellW * cellH);
  const hist = new Float32Array(HIST_SIZE);
  const scale = HIST_BINS - 1;
  let lumaSum = 0;

  for (let dy = 0; dy < cellH; dy++) {
    let o = ((y + dy) * sheetW + x) * 4;
    let p = dy * cellW;
    for (let dx = 0; dx < cellW; dx++, o += 4, p++) {
      const r = pixels[o], g = pixels[o + 1], b = pixels[o + 2];
      const yy = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      luma[p] = yy;
      lumaSum += yy;

      const fr = (r / 255) * scale, fg = (g / 255) * scale, fb = (b / 255) * scale;
      const ir = Math.min(HIST_BINS - 2, Math.floor(fr));
      const ig = Math.min(HIST_BINS - 2, Math.floor(fg));
      const ib = Math.min(HIST_BINS - 2, Math.floor(fb));
      const tr = fr - ir, tg = fg - ig, tb = fb - ib;
      for (let ar = 0; ar < 2; ar++) {
        const wr = ar ? tr : 1 - tr;
        if (wr === 0) continue;
        for (let ag = 0; ag < 2; ag++) {
          const wg = wr * (ag ? tg : 1 - tg);
          if (wg === 0) continue;
          for (let ab = 0; ab < 2; ab++) {
            const w = wg * (ab ? tb : 1 - tb);
            if (w === 0) continue;
            hist[(ir + ar) * HIST_BINS * HIST_BINS + (ig + ag) * HIST_BINS + (ib + ab)] += w;
          }
        }
      }
    }
  }

  const total = cellW * cellH;
  for (let i = 0; i < HIST_SIZE; i++) hist[i] /= total;
  return { luma, hist, lumaMean: lumaSum / total };
}

/** Half the L1 distance between two normalised histograms: 0..1. */
export function histDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / 2;
}

/* ── Shift estimation ─────────────────────────────────────────────── */

export interface ShiftEstimate {
  dx: number;
  dy: number;
  /** Mean absolute luma difference after compensation, 0..1. */
  residual: number;
  clipped: boolean;
}

function ssdAt(
  a: Float32Array, b: Float32Array, w: number, h: number, dx: number, dy: number
): { ssd: number; sad: number; n: number } {
  const x0 = Math.max(0, dx), x1 = w + Math.min(0, dx);
  const y0 = Math.max(0, dy), y1 = h + Math.min(0, dy);
  let ssd = 0, sad = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    const ra = y * w;
    const rb = (y - dy) * w;
    for (let x = x0; x < x1; x++) {
      const d = a[ra + x] - b[rb + x - dx];
      ssd += d * d;
      sad += d < 0 ? -d : d;
      n++;
    }
  }
  return { ssd, sad, n: n || 1 };
}

/**
 * Best whole-pixel translation from `a` to `b`, with the correlation
 * peak interpolated to sub-pixel.
 *
 * Sub-pixel interpolation is kept because it costs nothing, but it is
 * NOT what makes the motion numbers correct — see `shotMotion`, which
 * only trusts it over a baseline long enough for the displacement to be
 * several whole pixels.
 */
export function estimateShift(
  a: Float32Array, b: Float32Array, w: number, h: number, search: number
): ShiftEstimate {
  let best = Infinity, bx = 0, by = 0;
  const grid = new Map<string, number>();
  for (let dy = -search; dy <= search; dy++) {
    for (let dx = -search; dx <= search; dx++) {
      const { ssd, n } = ssdAt(a, b, w, h, dx, dy);
      const v = ssd / n;
      grid.set(`${dx},${dy}`, v);
      if (v < best) { best = v; bx = dx; by = dy; }
    }
  }

  const refine = (axis: 0 | 1): number => {
    const k = axis === 0 ? bx : by;
    if (Math.abs(k) >= search) return k;
    const lo = grid.get(axis === 0 ? `${bx - 1},${by}` : `${bx},${by - 1}`);
    const hi = grid.get(axis === 0 ? `${bx + 1},${by}` : `${bx},${by + 1}`);
    if (lo === undefined || hi === undefined) return k;
    const denom = lo - 2 * best + hi;
    if (Math.abs(denom) < 1e-12) return k;
    const delta = (0.5 * (lo - hi)) / denom;
    return k + Math.max(-1, Math.min(1, delta));
  };

  const { sad, n } = ssdAt(a, b, w, h, bx, by);
  return {
    dx: refine(0),
    dy: refine(1),
    residual: sad / n / 255,
    clipped: Math.abs(bx) >= search || Math.abs(by) >= search,
  };
}

/* ── Cut detection ────────────────────────────────────────────────── */

export interface CutDetectionOptions {
  /** 0..100; maps to the absolute floor. */
  sensitivity?: number;
  /** How many frames either side form the local baseline. */
  baselineWindow?: number;
  /** Score must beat the local baseline by this factor. */
  ratio?: number;
  /** Two spikes this close together with the content returning = a flash. */
  flashMaxFrames?: number;
  search?: number;
}

export interface CutDetection {
  cutFrames: number[];
  flashes: { startFrame: number; endFrame: number }[];
  dissolves: { startFrame: number; endFrame: number; blendError: number }[];
  scores: Float32Array;
  histScores: Float32Array;
  residuals: Float32Array;
  shifts: ShiftEstimate[];
  absoluteFloor: number;
  ratio: number;
  baseline: Float32Array;
}

const RESIDUAL_GAIN = 2.5;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Where the cuts are.
 *
 * A frame is a cut when its dissimilarity from the frame before clears
 * BOTH an absolute floor and a multiple of the local baseline. Neither
 * test is sufficient on its own and the fixtures say so:
 *
 * · Dead-still footage has a baseline of pure encoder noise, so the
 *   ratio test alone fires on 0.013 against 0.012. This is the same
 *   shape as `computeNovelty` in `beatDetect.ts`, which divides by its
 *   own maximum and so turns the 1.5% ripple of a held tone into 36
 *   onsets (NEXT.md §8). A curve with no absolute floor describes noise
 *   with total confidence.
 *
 * · A steady 12.5 %/s pan scores 0.103 on every single frame, which
 *   clears the 0.10 floor. It is flat, so the ratio test throws it out.
 */
export function detectCuts(
  frames: FrameFeatures[], layout: TileLayout, opts: CutDetectionOptions = {}
): CutDetection {
  const sensitivity = Math.max(0, Math.min(100, opts.sensitivity ?? 50));
  /* 0.18 .. 0.02, and 0.10 at the default 50. Deliberately BELOW the
     0.103 a steady 12.5 %/s pan scores, so the pan is thrown out by the
     local-baseline ratio and the two tests are not silently redundant.
     A floor that also happened to reject it would leave the ratio test
     untested and the next person free to delete it. */
  const absoluteFloor = 0.18 - (sensitivity / 100) * 0.16;
  const ratio = opts.ratio ?? 3.0;
  const window = opts.baselineWindow ?? 12;
  const search = opts.search ?? 6;
  const n = frames.length;

  const scores = new Float32Array(Math.max(0, n - 1));
  const histScores = new Float32Array(Math.max(0, n - 1));
  const residuals = new Float32Array(Math.max(0, n - 1));
  const shifts: ShiftEstimate[] = [];
  const baseline = new Float32Array(Math.max(0, n - 1));

  for (let i = 1; i < n; i++) {
    const dh = histDistance(frames[i - 1].hist, frames[i].hist);
    const sh = estimateShift(frames[i - 1].luma, frames[i].luma, layout.cellW, layout.cellH, search);
    histScores[i - 1] = dh;
    residuals[i - 1] = sh.residual;
    shifts.push(sh);
    scores[i - 1] = Math.max(dh, sh.residual * RESIDUAL_GAIN);
  }

  const raw: number[] = [];
  for (let i = 0; i < scores.length; i++) {
    const lo = Math.max(0, i - window), hi = Math.min(scores.length, i + window + 1);
    const around: number[] = [];
    for (let j = lo; j < hi; j++) if (j !== i) around.push(scores[j]);
    const base = median(around);
    baseline[i] = base;

    if (scores[i] < absoluteFloor) continue;
    if (scores[i] < base * ratio) continue;
    // A cut is a spike, not a plateau: it must beat its immediate
    // neighbours, or a two-frame dissolve reads as two cuts.
    const prev = i > 0 ? scores[i - 1] : 0;
    const next = i < scores.length - 1 ? scores[i + 1] : 0;
    if (scores[i] < prev || scores[i] < next) continue;
    raw.push(i + 1); // score i is the change INTO frame i+1
  }

  // Collapse runs: keep the strongest frame of any pair closer than 2.
  const merged: number[] = [];
  for (const f of raw) {
    const last = merged[merged.length - 1];
    if (last !== undefined && f - last < 2) {
      if (scores[f - 1] > scores[last - 1]) merged[merged.length - 1] = f;
    } else merged.push(f);
  }

  /* Flashes. Two spikes close together with the picture returning to
     what it was is one continuous shot with a flash in it, not two cuts
     around a one-frame shot. The two-frame white flash fixture scores
     1.26 twice — higher than any genuine cut in the set — so nothing
     about the magnitude could separate them. The return does. */
  const flashMax = opts.flashMaxFrames ?? 6;
  const flashes: { startFrame: number; endFrame: number }[] = [];
  const kept: number[] = [];
  for (let i = 0; i < merged.length; i++) {
    const a = merged[i], b = merged[i + 1];
    if (b !== undefined && b - a <= flashMax && a - 1 >= 0 && b < n) {
      const before = frames[a - 1];
      const after = frames[b];
      if (histDistance(before.hist, after.hist) < 0.15) {
        flashes.push({ startFrame: a, endFrame: b });
        i++; // consume both spikes
        continue;
      }
    }
    kept.push(a);
  }

  return {
    cutFrames: kept,
    flashes,
    dissolves: findDissolves(frames, kept, layout),
    scores, histScores, residuals, shifts, absoluteFloor, ratio, baseline,
  };
}

/**
 * Cross-dissolves, found by the one thing that is true of a dissolve and
 * of nothing else: the middle of it is the AVERAGE of its two ends.
 *
 * A pan also changes a lot over half a second, but its middle frame is a
 * shifted picture, not a blended one, and the blend error separates the
 * two by an order of magnitude. Magnitude alone cannot: a slow dissolve
 * and a fast pan move the same distance.
 */
export function findDissolves(
  frames: FrameFeatures[], cutFrames: number[], layout: TileLayout
): { startFrame: number; endFrame: number; blendError: number }[] {
  const n = frames.length;
  const px = layout.cellW * layout.cellH;
  const isCutNear = (a: number, b: number) => cutFrames.some((c) => c > a && c <= b);
  const found: { startFrame: number; endFrame: number; blendError: number }[] = [];

  /*
    The gate here used to be a histogram distance between the two ends,
    and it found nothing on an actual one-second cross-dissolve: the two
    shots either side were different pictures with the SAME histogram, so
    the distance was near zero and every candidate was skipped before it
    was tested. What has to be far apart for this to be answerable is the
    PICTURE, not the palette — which is the mean absolute luma difference,
    and it was already being computed one line further down.
  */
  /*
    Every window is scored, then the BEST fits are taken first.

    Taking the first window that merely passed put a one-second dissolve
    at 1.167–2.233s when it ran 1.500–2.500s: a window centred a third of
    the way in still fits loosely enough to clear the threshold, and
    scanning forwards means the loose fit is found before the exact one.
    Sorting by blend error puts the window actually centred on the
    dissolve first, and the rest are suppressed as overlaps.
  */
  const candidates: { startFrame: number; endFrame: number; blendError: number }[] = [];
  for (const half of [16, 8, 4, 2]) {
    for (let mid = half; mid + half < n; mid++) {
      const a = mid - half, b = mid + half;
      if (isCutNear(a, b)) continue;

      let blendErr = 0, span = 0;
      const A = frames[a].luma, B = frames[b].luma, M = frames[mid].luma;
      for (let p = 0; p < px; p++) {
        blendErr += Math.abs(M[p] - (A[p] + B[p]) / 2);
        span += Math.abs(A[p] - B[p]);
      }
      if (span < px * 20) continue; // the ends are not far enough apart to tell
      const ratio = blendErr / span;
      if (ratio < 0.25) {
        candidates.push({ startFrame: a, endFrame: b, blendError: Number(ratio.toFixed(3)) });
      }
    }
  }

  candidates.sort((x, y) => x.blendError - y.blendError);
  for (const c of candidates) {
    if (found.some((f) => c.startFrame <= f.endFrame && c.endFrame >= f.startFrame)) continue;
    found.push(c);
  }

  /* One dissolve is often covered by two windows that abut rather than
     overlap — a 30-frame fade gets a tight 16-frame fit and then a
     second one alongside it. Adjacent pieces are the same event. */
  found.sort((x, y) => x.startFrame - y.startFrame);
  const joined: typeof found = [];
  for (const f of found) {
    const last = joined[joined.length - 1];
    if (last && f.startFrame <= last.endFrame + 4) {
      last.endFrame = Math.max(last.endFrame, f.endFrame);
      last.blendError = Math.min(last.blendError, f.blendError);
    } else joined.push({ ...f });
  }
  return joined;
}

/* ── Motion ───────────────────────────────────────────────────────── */

export interface ShotMotion {
  /** Signed, in per cent of frame width / height per second. */
  panPctWidthPerSec: number;
  tiltPctHeightPerSec: number;
  speedPctPerSec: number;
  direction: string;
  classification: 'locked off' | 'slight' | 'moderate' | 'strong' | 'very strong';
  /** Difference left over after the best translation — subject or
      lens movement that a pan cannot explain. */
  residual: number;
  segments: number;
}

const MOTION_NAMES: [number, ShotMotion['classification']][] = [
  [0.6, 'locked off'], [4, 'slight'], [12, 'moderate'], [30, 'strong'], [Infinity, 'very strong'],
];

/**
 * Which way the CAMERA went — not which way the picture went, which is
 * the opposite and is the sign error waiting to happen. The caller flips
 * the sign once on the way in rather than four times at the call sites.
 *
 * An axis is only named if it is both above the measurement floor and a
 * real share of the movement. A dead-straight 31 %/s pan measures 0.11
 * %/s of tilt — above the floor, and meaningless — and calling that
 * "right and up" would be a claim the numbers do not support.
 */
function directionName(dx: number, dy: number, floor: number): string {
  const speed = Math.hypot(dx, dy);
  const limit = Math.max(floor, speed * 0.15);
  const horizontal = Math.abs(dx) > limit ? (dx > 0 ? 'left' : 'right') : '';
  const vertical = Math.abs(dy) > limit ? (dy > 0 ? 'up' : 'down') : '';
  if (!horizontal && !vertical) return 'none';
  if (horizontal && vertical) return `${horizontal} and ${vertical}`;
  return horizontal || vertical;
}

/**
 * How much the frame moves during one shot.
 *
 * The displacement is measured from an ANCHOR frame over a growing
 * baseline and a line is fitted through it, rather than frame to frame.
 * Frame to frame, a 12.5 %-of-width-per-second pan moves a quarter of one
 * analysis pixel — below what a correlation peak can resolve — and the
 * estimate came back at a third of the truth. Over sixteen frames the
 * same pan has moved four whole pixels and the slope is recoverable.
 * Measured on constructed pans: 12.50 -> 12.32, 31.25 -> 30.26,
 * 25.00 -> 24.95 %/s, and 0 -> 0.000 on a locked-off frame.
 */
export const MOTION_SEARCH = 8;

export function shotMotion(
  frames: FrameFeatures[], from: number, to: number,
  layout: TileLayout, fps: number, search = MOTION_SEARCH
): ShotMotion {
  const vx: number[] = [];
  const vy: number[] = [];
  const residuals: number[] = [];
  let anchor = from;

  while (anchor < to - 2) {
    const ts: number[] = [], xs: number[] = [], ys: number[] = [];
    let k = anchor + 1;
    while (k <= to && ts.length < 48) {
      const s = estimateShift(frames[anchor].luma, frames[k].luma, layout.cellW, layout.cellH, search);
      if (Math.max(Math.abs(s.dx), Math.abs(s.dy)) > search - 1.5) break;
      ts.push(k - anchor); xs.push(s.dx); ys.push(s.dy);
      residuals.push(s.residual);
      k++;
    }
    if (ts.length >= 3) {
      vx.push(slope(ts, xs));
      vy.push(slope(ts, ys));
      anchor += ts[ts.length - 1];
    } else if (ts.length > 0) {
      // The picture left the search window inside three frames: too fast
      // to fit a line to, so take the last measurable step directly.
      vx.push(xs[xs.length - 1] / ts[ts.length - 1]);
      vy.push(ys[ys.length - 1] / ts[ts.length - 1]);
      anchor += Math.max(1, ts[ts.length - 1]);
    } else anchor++;
  }

  const mx = vx.length ? median(vx) : 0;
  const my = vy.length ? median(vy) : 0;
  const pctW = (mx / layout.cellW) * 100 * fps;
  const pctH = (my / layout.cellH) * 100 * fps;
  const speed = Math.hypot(pctW, pctH);
  const floorPct = motionFloorPct(layout, fps);

  return {
    panPctWidthPerSec: Number(pctW.toFixed(2)),
    tiltPctHeightPerSec: Number(pctH.toFixed(2)),
    speedPctPerSec: Number(speed.toFixed(2)),
    direction: directionName(-pctW, -pctH, floorPct),
    classification: MOTION_NAMES.find(([limit]) => speed < limit)![1],
    residual: Number((residuals.length ? median(residuals) : 0).toFixed(4)),
    segments: vx.length,
  };
}

function slope(xs: number[], ys: number[]): number {
  const n = xs.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
  const denom = n * sxx - sx * sx;
  return Math.abs(denom) < 1e-12 ? 0 : (n * sxy - sx * sy) / denom;
}

/**
 * Below this, "moving" and "still" are the same measurement.
 *
 * One tenth of an analysis pixel over the longest baseline the estimator
 * uses. Quoting it is the point: a number under the floor is reported as
 * a floor, not as a small number, because "unknown is not the same as
 * absent" and neither is "too small to see".
 */
export function motionFloorPct(layout: TileLayout, fps: number): number {
  return Number(((0.1 / 48 / layout.cellW) * 100 * fps).toFixed(3));
}

/*
  Why the search window is 8 and not 6. The anchor walk stops as soon as
  the displacement approaches the edge of the window, so the window sets
  how long a baseline a fast move gets to be measured over. At 6 a
  31.25 %/s pan only ever got 6 frames of baseline and read 26.5 — 15%
  low. At 8 it gets 9 and reads 30.3. The cost is 289 shift evaluations
  per pair instead of 169, and only on the motion pass; cut detection
  compares adjacent frames, where 6 is already more than the picture ever
  moves between two of them.
*/

/* ── Grade ────────────────────────────────────────────────────────── */

export interface GradeSample {
  lumaHist: Float64Array;   // 256
  rHist: Float64Array;
  gHist: Float64Array;
  bHist: Float64Array;
  satHist: Float64Array;    // 101
  hueHist: Float64Array;    // 36
  linR: number; linG: number; linB: number;
  pixels: number;
}

export function emptyGradeSample(): GradeSample {
  return {
    lumaHist: new Float64Array(256),
    rHist: new Float64Array(256), gHist: new Float64Array(256), bHist: new Float64Array(256),
    satHist: new Float64Array(101), hueHist: new Float64Array(36),
    linR: 0, linG: 0, linB: 0, pixels: 0,
  };
}

function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Accumulate one cell into a grade sample. */
export function accumulateGrade(
  target: GradeSample, pixels: Uint8ClampedArray, sheetW: number,
  layout: TileLayout, index: number
): void {
  const { x, y } = cellOrigin(layout, index);
  for (let dy = 0; dy < layout.cellH; dy++) {
    let o = ((y + dy) * sheetW + x) * 4;
    for (let dx = 0; dx < layout.cellW; dx++, o += 4) {
      const r = pixels[o], g = pixels[o + 1], b = pixels[o + 2];
      const luma = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      target.lumaHist[luma < 0 ? 0 : luma > 255 ? 255 : luma]++;
      target.rHist[r]++; target.gHist[g]++; target.bHist[b]++;
      target.linR += srgbToLinear(r); target.linG += srgbToLinear(g); target.linB += srgbToLinear(b);

      const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
      const delta = max - min;
      const sat = max === 0 ? 0 : delta / max;
      target.satHist[Math.round(sat * 100)]++;

      if (delta > 12 && max > 24) {
        let hue: number;
        if (max === r) hue = 60 * (((g - b) / delta) % 6);
        else if (max === g) hue = 60 * ((b - r) / delta + 2);
        else hue = 60 * ((r - g) / delta + 4);
        if (hue < 0) hue += 360;
        // Weighted by saturation and level: a washed-out dark pixel has
        // a hue, but nobody would call it the look of the piece.
        target.hueHist[Math.min(35, Math.floor(hue / 10))] += sat * (max / 255);
      }
      target.pixels++;
    }
  }
}

function percentile(hist: Float64Array, total: number, p: number): number {
  const want = total * p;
  let cum = 0;
  for (let i = 0; i < hist.length; i++) {
    cum += hist[i];
    if (cum >= want) return i;
  }
  return hist.length - 1;
}

function histMean(hist: Float64Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < hist.length; i++) sum += i * hist[i];
  return total ? sum / total : 0;
}

function histStd(hist: Float64Array, total: number, mean: number): number {
  let sum = 0;
  for (let i = 0; i < hist.length; i++) sum += hist[i] * (i - mean) * (i - mean);
  return total ? Math.sqrt(sum / total) : 0;
}

const HUE_NAMES = [
  'red', 'orange', 'yellow', 'chartreuse', 'green', 'spring green',
  'cyan', 'azure', 'blue', 'violet', 'magenta', 'rose',
];

export interface GradeReport {
  sampledFrames: number;
  sampledPixels: number;
  luminance: { mean: number; p1: number; p5: number; p50: number; p95: number; p99: number };
  contrast: { rms: number; p95MinusP5: number; descriptor: string };
  blackPoint: { level: number; lifted: boolean; crushed: boolean };
  whitePoint: { level: number; clipped: boolean };
  saturation: { mean: number; p90: number; descriptor: string };
  colour: {
    meanRgb: [number, number, number];
    redOverBlue: number;
    tintGreenMagenta: number;
    cctKelvin: number | null;
    cctReliable: boolean;
    descriptor: string;
  };
  dominantHues: { hue: number; name: string; sharePct: number }[];
  descriptors: string[];
}

export function summariseGrade(s: GradeSample): GradeReport {
  const total = s.pixels || 1;
  const lumaMean = histMean(s.lumaHist, total);
  const p1 = percentile(s.lumaHist, total, 0.01);
  const p5 = percentile(s.lumaHist, total, 0.05);
  const p50 = percentile(s.lumaHist, total, 0.50);
  const p95 = percentile(s.lumaHist, total, 0.95);
  const p99 = percentile(s.lumaHist, total, 0.99);
  const rms = histStd(s.lumaHist, total, lumaMean);
  const satMean = histMean(s.satHist, total);
  const satP90 = percentile(s.satHist, total, 0.90);

  const meanR = histMean(s.rHist, total);
  const meanG = histMean(s.gHist, total);
  const meanB = histMean(s.bHist, total);

  /* CCT is computed from the mean LINEAR colour: averaging gamma-encoded
     values and calling the result a colour temperature is a category
     error, and it lands hundreds of kelvin out on anything with a wide
     tonal range. */
  const lr = s.linR / total, lg = s.linG / total, lb = s.linB / total;
  const X = 0.4124 * lr + 0.3576 * lg + 0.1805 * lb;
  const Y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const Z = 0.0193 * lr + 0.1192 * lg + 0.9505 * lb;
  const sumXYZ = X + Y + Z;
  let cct: number | null = null;
  if (sumXYZ > 1e-6) {
    const cx = X / sumXYZ, cy = Y / sumXYZ;
    const nn = (cx - 0.3320) / (0.1858 - cy);
    const k = 437 * nn ** 3 + 3601 * nn ** 2 + 6861 * nn + 5517;
    if (Number.isFinite(k) && k > 1000 && k < 25000) cct = Math.round(k / 10) * 10;
  }

  const redOverBlue = meanB > 0.5 ? meanR / meanB : 0;
  const tint = (meanG - (meanR + meanB) / 2) / Math.max(1, (meanR + meanG + meanB) / 3);
  const cctReliable = Math.abs(tint) < 0.10;

  let hueTotal = 0;
  for (let i = 0; i < 36; i++) hueTotal += s.hueHist[i];
  const hues = Array.from(s.hueHist, (v, i) => ({ i, v }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .filter((h) => hueTotal > 0 && h.v / hueTotal > 0.05)
    .map((h) => ({
      hue: h.i * 10 + 5,
      name: HUE_NAMES[Math.floor(((h.i * 10 + 5) / 30)) % 12],
      sharePct: Number(((h.v / hueTotal) * 100).toFixed(1)),
    }));

  const contrastWord = rms < 38 ? 'flat' : rms > 72 ? 'punchy' : 'normal';
  const satWord = satMean < 12 ? 'desaturated' : satMean > 45 ? 'saturated' : 'natural';
  const tempWord = redOverBlue > 1.15 ? 'warm' : redOverBlue < 0.87 ? 'cool' : 'neutral';

  const descriptors: string[] = [];
  descriptors.push(
    lumaMean < 70 ? 'dark' : lumaMean < 100 ? 'low-key' : lumaMean < 150 ? 'mid' :
    lumaMean < 190 ? 'bright' : 'high-key'
  );
  descriptors.push(contrastWord, satWord, tempWord);
  if (p1 > 24) descriptors.push('lifted blacks');
  if (p1 < 3 && p5 < 10) descriptors.push('crushed blacks');
  if (p99 > 252) descriptors.push('clipped highlights');
  if (Math.abs(tint) > 0.06) descriptors.push(tint > 0 ? 'green tint' : 'magenta tint');

  return {
    sampledFrames: 0,
    sampledPixels: total,
    luminance: {
      mean: Number(lumaMean.toFixed(2)),
      p1, p5, p50, p95, p99,
    },
    contrast: {
      rms: Number(rms.toFixed(2)),
      p95MinusP5: p95 - p5,
      descriptor: contrastWord,
    },
    blackPoint: { level: p1, lifted: p1 > 24, crushed: p1 < 3 && p5 < 10 },
    whitePoint: { level: p99, clipped: p99 > 252 },
    saturation: {
      mean: Number(satMean.toFixed(2)),
      p90: satP90,
      descriptor: satWord,
    },
    colour: {
      meanRgb: [Number(meanR.toFixed(1)), Number(meanG.toFixed(1)), Number(meanB.toFixed(1))],
      redOverBlue: Number(redOverBlue.toFixed(3)),
      tintGreenMagenta: Number(tint.toFixed(4)),
      cctKelvin: cct,
      cctReliable,
      descriptor: tempWord,
    },
    dominantHues: hues,
    descriptors,
  };
}

/* ── Cadence against the beat ─────────────────────────────────────── */

export interface CadenceReport {
  bpm: number;
  beatPeriodMs: number;
  beats: number;
  onsetsDetected: number;
  beatsOnRealOnsets: number;
  gridConfidence: string;
  cutsAnalysed: number;
  cutsOnBeat: number;
  onBeatPct: number;
  toleranceMs: number;
  medianOffsetMs: number;
  maxOffsetMs: number;
  offsetsMs: number[];
  subdivision: { name: string; divisions: number; hitPct: number } | null;
  subdivisionEvidence: { name: string; divisions: number; hitPct: number; chancePct: number; eligible: boolean }[];
  subdivisionNote: string;
  shotLengthsInBeats: number[];
  verdict: string;
}

const SUBDIVISIONS: { name: string; divisions: number }[] = [
  { name: 'on the beat', divisions: 1 },
  { name: 'half beat (1/8)', divisions: 2 },
  { name: 'triplet (1/8T)', divisions: 3 },
  { name: 'quarter beat (1/16)', divisions: 4 },
  { name: 'sixth beat (1/16T)', divisions: 6 },
  { name: 'eighth beat (1/32)', divisions: 8 },
];

/**
 * Do the cuts land on the music, and at what subdivision?
 *
 * The subdivision is reported as the SMALLEST one that explains the cuts,
 * because a finer grid trivially explains more: at 1/32 the grid points
 * are 62ms apart at 120 BPM and a ±40ms tolerance covers most of the bar.
 * Every subdivision's hit rate is returned alongside so the reader can
 * see the claim being made rather than take the label.
 */
export function cadenceAgainstBeats(
  cutsMs: number[], shotDurationsMs: number[], beats: BeatDetectionResult
): CadenceReport {
  const beatsMs = beats.beatsMs;
  const period = beats.bpm > 0 ? 60000 / beats.bpm : 0;
  /* A twelfth of a beat — 42ms at 120 BPM, a little over one frame at
     30fps, which is the finest an editor can place a cut anyway. */
  const tolerance = Math.max(20, Math.min(50, period / 12));

  const offsets: number[] = [];
  for (const cut of cutsMs) {
    let best = Infinity;
    for (const b of beatsMs) {
      const d = cut - b;
      if (Math.abs(d) < Math.abs(best)) best = d;
    }
    if (Number.isFinite(best)) offsets.push(Math.round(best));
  }
  const onBeat = offsets.filter((d) => Math.abs(d) <= tolerance).length;

  /*
    Subdivision, and the trap that eats it.
    ---------------------------------------
    A finer grid explains more cuts for free. At 120 BPM a 1/32 grid puts
    a point every 62ms, and a ±42ms tolerance then covers the ENTIRE bar
    — every cut "hits", including cuts thrown at random. The first version
    of this reported 100% at every subdivision from 1 to 8 for a clip cut
    exactly on the beat, which is true and says nothing.

    So each subdivision is scored against what CHANCE would give it:
    2 x tolerance / step. A subdivision is only eligible to be the answer
    if chance is under 40%, and it has to beat chance by 40 points on top
    of clearing 80%. Because tolerance is a fixed fraction of the beat,
    chance works out at S/6 regardless of tempo — so at this tolerance
    only the beat and the half-beat can be told from chance at all, and
    `subdivisionNote` says exactly that rather than letting a reader
    assume 1/16 was ruled out when it was never testable.
  */
  const evidence = SUBDIVISIONS.map(({ name, divisions }) => {
    const step = period / divisions;
    let hits = 0;
    for (const cut of cutsMs) {
      let closest = Infinity;
      for (const b of beatsMs) {
        const rel = cut - b;
        if (Math.abs(rel) > period) continue;
        const k = Math.round(rel / step);
        const d = Math.abs(rel - k * step);
        if (d < closest) closest = d;
      }
      if (closest <= tolerance) hits++;
    }
    const chance = step > 0 ? Math.min(100, (2 * tolerance / step) * 100) : 100;
    return {
      name, divisions,
      hitPct: cutsMs.length ? Number(((hits / cutsMs.length) * 100).toFixed(1)) : 0,
      chancePct: Number(chance.toFixed(1)),
      eligible: chance <= 40,
    };
  });

  const chosen = cutsMs.length >= 3
    ? evidence.find((e) => e.eligible && e.hitPct >= 80 && e.hitPct - e.chancePct >= 40) ?? null
    : null;
  const ineligible = evidence.filter((e) => !e.eligible).map((e) => e.name);
  const absOffsets = offsets.map(Math.abs);
  const onBeatPct = offsets.length ? Number(((onBeat / offsets.length) * 100).toFixed(1)) : 0;

  const anchoredPct = beatsMs.length
    ? Math.round((beats.beatsAnchored / beatsMs.length) * 100) : 0;

  return {
    bpm: Number(beats.bpm.toFixed(1)),
    beatPeriodMs: Number(period.toFixed(1)),
    beats: beatsMs.length,
    onsetsDetected: beats.onsetsDetected,
    beatsOnRealOnsets: beats.beatsAnchored,
    gridConfidence:
      `${anchoredPct}% of the beat grid sits on a detected onset; the rest is interpolated ` +
      'at the estimated tempo. A low figure means the cadence below is being measured against ' +
      'a metronome, not against the music.',
    cutsAnalysed: offsets.length,
    cutsOnBeat: onBeat,
    onBeatPct,
    toleranceMs: Number(tolerance.toFixed(1)),
    medianOffsetMs: Number(median(absOffsets).toFixed(1)),
    maxOffsetMs: absOffsets.length ? Math.max(...absOffsets) : 0,
    offsetsMs: offsets,
    subdivision: chosen ? { name: chosen.name, divisions: chosen.divisions, hitPct: chosen.hitPct } : null,
    subdivisionEvidence: evidence,
    subdivisionNote:
      `Hits are within ${tolerance.toFixed(0)}ms. chancePct is what a randomly placed cut would ` +
      `score on that grid; ${ineligible.join(', ') || 'no subdivision'} could not be told from ` +
      'chance at this tempo and are never selected, so their hit rates are reported but mean nothing. ' +
      (cutsMs.length < 3 ? 'Fewer than three cuts: no subdivision is claimed at all.' : ''),
    shotLengthsInBeats: period > 0
      ? shotDurationsMs.map((d) => Number((d / period).toFixed(2))) : [],
    verdict:
      onBeatPct >= 75
        ? `${onBeat} of ${offsets.length} cuts land within ${tolerance.toFixed(0)}ms of a beat — ` +
          'this is cut to the music.'
        : onBeatPct >= 40
          ? `${onBeat} of ${offsets.length} cuts land on a beat. Partly beat-driven, partly not.`
          : `Only ${onBeat} of ${offsets.length} cuts land on a beat. The edit is not following ` +
            'this track, or the track has no clear pulse.',
  };
}

/* ── Static overlay regions ───────────────────────────────────────── */

export interface OverlayRegion {
  /** 0..1 of the frame, from the top-left. */
  x: number; y: number; w: number; h: number;
  where: string;
  startMs: number;
  endMs: number;
  coveragePct: number;
  edgeStrength: number;
}

export interface OverlayReport {
  regions: OverlayRegion[];
  sampledFrames: number;
  sampleIntervalMs: number;
  framePctStatic: number;
  framePctChanging: number;
  /** Median longest run of unchanged samples, per pixel. */
  medianHeldSamples: number;
  /** Share of pixels whose longest held run spans at least one cut. */
  pctCrossingCut: number;
  heldThresholdSamples: number;
  /** Cuts as seen in THIS sheet's sample index space. */
  boundariesFound: number;
  usable: boolean;
  note: string;
}

function whereIs(x: number, y: number, w: number, h: number): string {
  const cy = y + h / 2, cx = x + w / 2;
  const band = cy < 0.28 ? 'top' : cy > 0.72 ? 'lower' : 'middle';
  const side = cx < 0.3 ? 'left' : cx > 0.7 ? 'right' : 'centre';
  return band === 'middle' && side === 'centre' ? 'centre' : `${band} ${side}`;
}

/**
 * Regions of the frame that do not change while the rest of it does.
 *
 * **This is not text detection and it is not OCR.** It cannot read a
 * word, it cannot tell a caption from a logo or a lower-third bar, and a
 * caption that animates or moves is invisible to it. What it measures is
 * exactly one thing: pixels that hold still across cuts, in a frame that
 * is otherwise changing — which is what a burnt-in overlay does and what
 * the footage under it does not.
 *
 * Reporting it as "text placement" would be the failure this codebase
 * exists to prevent: a plausible label over a measurement that does not
 * support it. The measurement is real, so it is reported under its own
 * name and the caller can decide what the region contains.
 *
 * It refuses rather than guesses when the whole frame is static — a
 * locked-off shot with no cuts gives it nothing to separate an overlay
 * FROM, and it would otherwise return "the entire frame is a caption".
 */
export function findOverlayRegions(
  lumas: Float32Array[], layout: TileLayout, timesMs: number[],
  opts: { tolerance?: number } = {}
): OverlayReport {
  const { cellW, cellH } = layout;
  const n = lumas.length;
  const sampleInterval = timesMs.length > 1
    ? Math.round((timesMs[timesMs.length - 1] - timesMs[0]) / (timesMs.length - 1)) : 0;

  let framePctChanging = 0;
  let medianHeld = 0;
  let pctCrossing = 0;
  let heldThreshold = 0;
  let boundaryCount = 0;
  const empty = (note: string, framePctStatic: number, usable: boolean): OverlayReport => ({
    regions: [], sampledFrames: n, sampleIntervalMs: sampleInterval,
    framePctStatic: Number(framePctStatic.toFixed(1)),
    framePctChanging: Number(framePctChanging.toFixed(1)),
    medianHeldSamples: medianHeld,
    pctCrossingCut: Number(pctCrossing.toFixed(1)),
    heldThresholdSamples: heldThreshold,
    boundariesFound: boundaryCount,
    usable, note,
  });

  if (n < 4) return empty('Too few sampled frames to tell a held pixel from a still shot.', 0, false);

  /* Tolerance has to sit above what the encoder contributes to a pixel
     that genuinely did not move. Measured on a constructed still: the
     same pixel varies by up to 5 levels between frames of a clip where
     nothing changed at all. */
  const tol = opts.tolerance ?? 8;
  const px = cellW * cellH;

  /*
    First question, before anything else: is there anything here to
    separate an overlay FROM? A pixel that never moves in a clip where
    nothing else moves either is a still shot, not a caption. Measured as
    the share of pixels whose range across the samples exceeds the
    tolerance — independent of the run logic below, so a clip that fails
    this refuses for a reason that can be quoted rather than producing a
    region list nobody should act on.
  */
  {
    let changing = 0;
    for (let p = 0; p < px; p++) {
      let lo = Infinity, hi = -Infinity;
      for (let t = 0; t < n; t++) {
        const v = lumas[t][p];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > tol) changing++;
    }
    framePctChanging = (changing / px) * 100;
  }
  if (framePctChanging < 45) {
    return empty(
      `Only ${framePctChanging.toFixed(1)}% of the frame changes across the whole clip, so a held ` +
      'region cannot be told from a shot that simply does not move. No regions reported rather ' +
      'than a guess.', 0, false);
  }
  const stableRuns = new Uint16Array(px);      // longest run of "unchanged"
  const runStart = new Uint16Array(px);
  const bestStart = new Uint16Array(px);
  const current = new Uint16Array(px);

  for (let p = 0; p < px; p++) { runStart[p] = 0; current[p] = 1; stableRuns[p] = 1; bestStart[p] = 0; }
  for (let t = 1; t < n; t++) {
    const a = lumas[t - 1], b = lumas[t];
    for (let p = 0; p < px; p++) {
      if (Math.abs(a[p] - b[p]) <= tol) {
        current[p]++;
        if (current[p] > stableRuns[p]) { stableRuns[p] = current[p]; bestStart[p] = runStart[p]; }
      } else {
        current[p] = 1;
        runStart[p] = t;
      }
    }
  }

  /*
    A run of unchanged samples is not enough on its own, and the first
    version of this proved it: on a clip whose last shot is a static test
    pattern, EVERY pixel held still for a quarter of the samples and the
    detector reported the frame as 100% static. What an overlay does that
    a still shot does not is survive a CUT — so a held run only counts if
    it spans one.

    The cut positions used here are derived FROM THIS SHEET, not from the
    cut list the main pass produced, and that is not tidiness. The two
    passes sample at different rates, and `fps` resolves each output frame
    to the nearest source frame — so a cut at 1000ms lands in a grade
    sample whose nominal timestamp is 972ms. Comparing one pass's cut
    times against the other's sample times then puts the cut INSIDE the
    run that starts just after it, every run "crossed a cut", and the
    detector reported 100% of the frame as a held overlay. Measured
    against a Python reading of the same sheet, which got 34.7%: the
    off-by-one sample was the entire difference.

    A boundary here is simply a sample where most of the picture changed.
    That is the same event, measured in the only index space where both
    sides of the comparison are the same data.
  */
  const boundaries: number[] = [];
  for (let t = 1; t < n; t++) {
    const a = lumas[t - 1], b = lumas[t];
    let changed = 0;
    for (let p = 0; p < px; p++) if (Math.abs(a[p] - b[p]) > tol) changed++;
    if (changed / px > 0.5) boundaries.push(t);
  }
  boundaryCount = boundaries.length;
  const hasCuts = boundaries.length > 0;
  const spansCount = (from: number, to: number): number =>
    boundaries.reduce((acc, k) => acc + (k > from && k <= to ? 1 : 0), 0);

  /*
    ONE cut is not enough evidence and the arithmetic says so.

    The held test is |Δluma| <= 8. Two unrelated shots of ordinary
    material put about one pixel in eight inside that window purely by
    coincidence — measured at 12% per cut on a fixture of six unrelated
    shots — so "held across a cut" alone marked 37% of the frame and the
    detector returned the whole picture as one giant caption. Requiring
    the SAME unbroken run to survive three cuts takes that to 0.13^3, and
    the same fixture drops to well under 1%, while a burnt-in caption
    survives all of them by construction.

    Clips with fewer than three cuts fall back to "all of them", and the
    note says so: on a one-cut clip this is a 12% coin flip per pixel and
    should not be trusted the way it can be on a montage.
  */
  const spansNeeded = Math.min(3, boundaries.length);

  const HOLD = hasCuts ? Math.max(4, Math.ceil(n * 0.15)) : Math.max(4, Math.ceil(n * 0.6));
  heldThreshold = HOLD;
  let staticCount = 0;
  let crossingCount = 0;
  const isStatic = new Uint8Array(px);
  for (let p = 0; p < px; p++) {
    const spans = !hasCuts
      || spansCount(bestStart[p], bestStart[p] + stableRuns[p] - 1) >= spansNeeded;
    if (spans) crossingCount++;
    if (stableRuns[p] < HOLD) continue;
    if (!spans) continue;
    isStatic[p] = 1; staticCount++;
  }
  medianHeld = median(Array.from(stableRuns));
  pctCrossing = (crossingCount / px) * 100;
  const framePctStatic = (staticCount / px) * 100;

  if (framePctStatic > 55) {
    return empty(
      'More than half the frame holds still across cuts, which is not what an overlay looks like ' +
      '— it is what a repeated or barely-changing shot looks like. No regions reported.',
      framePctStatic, false);
  }
  if (framePctStatic < 0.5) return empty('No held region found.', framePctStatic, true);

  /* Blocks, not pixels: a caption is a patch, and asking for a run of
     held pixels inside a block is what separates it from one lucky pixel
     in a bush that happened to match. */
  const bx = 16, by = 12;
  const blockW = Math.max(1, Math.floor(cellW / bx));
  const blockH = Math.max(1, Math.floor(cellH / by));
  const hot = new Uint8Array(bx * by);
  const blockStart = new Float32Array(bx * by);
  const blockEnd = new Float32Array(bx * by);
  const edge = new Float32Array(bx * by);

  for (let r = 0; r < by; r++) {
    for (let c = 0; c < bx; c++) {
      const x0 = c * blockW, y0 = r * blockH;
      const x1 = Math.min(cellW, x0 + blockW), y1 = Math.min(cellH, y0 + blockH);
      let count = 0, held = 0, startSum = 0, endSum = 0, edgeSum = 0, edgeN = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = y * cellW + x;
          count++;
          if (isStatic[p]) {
            held++;
            startSum += bestStart[p];
            endSum += bestStart[p] + stableRuns[p] - 1;
          }
          if (x + 1 < cellW && y + 1 < cellH) {
            const ref = lumas[Math.floor(n / 2)];
            edgeSum += Math.abs(ref[p] - ref[p + 1]) + Math.abs(ref[p] - ref[p + cellW]);
            edgeN++;
          }
        }
      }
      const frac = count ? held / count : 0;
      edge[r * bx + c] = edgeN ? edgeSum / edgeN : 0;
      /* A held region with no edges in it is a letterbox bar or a sky,
         not an overlay. Graphics have hard borders; that is what makes
         them legible over footage and what makes them findable here. */
      /* Above an absolute floor AND well above whatever the rest of this
         particular clip is doing — the same two-test shape as the cut
         detector, and for the same reason. */
      if (frac >= 0.30 && frac >= (staticCount / px) * 3 + 0.05 && edge[r * bx + c] > 6) {
        hot[r * bx + c] = 1;
        blockStart[r * bx + c] = held ? startSum / held : 0;
        blockEnd[r * bx + c] = held ? endSum / held : 0;
      }
    }
  }

  // Merge touching hot blocks into rectangles.
  const seen = new Uint8Array(bx * by);
  const regions: OverlayRegion[] = [];
  for (let r = 0; r < by; r++) {
    for (let c = 0; c < bx; c++) {
      const i0 = r * bx + c;
      if (!hot[i0] || seen[i0]) continue;
      const stack = [i0];
      seen[i0] = 1;
      let minC = c, maxC = c, minR = r, maxR = r, cells = 0, sStart = 0, sEnd = 0, sEdge = 0;
      while (stack.length) {
        const i = stack.pop()!;
        const rr = Math.floor(i / bx), cc = i % bx;
        cells++;
        sStart += blockStart[i]; sEnd += blockEnd[i]; sEdge += edge[i];
        minC = Math.min(minC, cc); maxC = Math.max(maxC, cc);
        minR = Math.min(minR, rr); maxR = Math.max(maxR, rr);
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
          const nr = rr + dr, nc = cc + dc;
          if (nr < 0 || nc < 0 || nr >= by || nc >= bx) continue;
          const ni = nr * bx + nc;
          if (hot[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
        }
      }
      if (cells < 2) continue;
      const x = minC / bx, y = minR / by;
      const w = (maxC - minC + 1) / bx, h = (maxR - minR + 1) / by;
      const startIdx = Math.round(sStart / cells);
      const endIdx = Math.round(sEnd / cells);
      regions.push({
        x: Number(x.toFixed(3)), y: Number(y.toFixed(3)),
        w: Number(w.toFixed(3)), h: Number(h.toFixed(3)),
        where: whereIs(x, y, w, h),
        startMs: timesMs[Math.max(0, Math.min(n - 1, startIdx))],
        endMs: timesMs[Math.max(0, Math.min(n - 1, endIdx))],
        coveragePct: Number(((cells / (bx * by)) * 100).toFixed(1)),
        edgeStrength: Number((sEdge / cells).toFixed(1)),
      });
    }
  }

  regions.sort((a, b) => b.coveragePct - a.coveragePct);
  return {
    regions: regions.slice(0, 6),
    sampledFrames: n,
    sampleIntervalMs: sampleInterval,
    framePctStatic: Number(framePctStatic.toFixed(1)),
    framePctChanging: Number(framePctChanging.toFixed(1)),
    medianHeldSamples: medianHeld,
    pctCrossingCut: Number(pctCrossing.toFixed(1)),
    heldThresholdSamples: HOLD,
    boundariesFound: boundaryCount,
    usable: true,
    note:
      'Regions that hold still while the rest of the frame changes. This is NOT text detection ' +
      'and NOT OCR: it cannot read anything, and it cannot tell a caption from a logo, a bug or ' +
      'a lower-third bar. A caption that moves or animates will not appear here. A region has to ' +
      `hold unchanged across ${spansNeeded} cut(s) to count` +
      (spansNeeded < 3
        ? ', which is all this clip has — on so few cuts a held pixel is roughly a one-in-eight ' +
          'coincidence and these regions are weak evidence'
        : '') +
      `. Timing is resolved to ${sampleInterval}ms, the sampling interval.`,
  };
}

/* ── Getting the sheet out of ffmpeg and into an array ────────────── */

export function toFileUrl(pathOrUrl: string): string {
  if (/^(file|https?|blob|data):/.test(pathOrUrl)) return pathOrUrl;
  if (pathOrUrl.startsWith('/')) return `file://${encodeURI(pathOrUrl).replace(/#/g, '%23')}`;
  return pathOrUrl;
}

interface VideoMeta { width: number; height: number; durationMs: number }

function loadVideoMeta(url: string, timeoutMs = 12000): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.muted = true;
    let settled = false;
    /* `fn()` runs BEFORE the element is released. Clearing `src` first
       resets `videoWidth` and `duration` to zero, and the first version
       of this did exactly that — every file came back as "no video
       stream this engine can decode" while the decode had worked. */
    const finish = (fn: () => void) => { if (!settled) { settled = true; fn(); el.removeAttribute('src'); el.load(); } };
    el.onloadedmetadata = () => finish(() => resolve({
      width: el.videoWidth,
      height: el.videoHeight,
      durationMs: Number.isFinite(el.duration) ? el.duration * 1000 : 0,
    }));
    el.onerror = () => finish(() => reject(new Error(
      `Could not open "${url}" — the browser engine has no decoder for it, or the path is wrong.`)));
    setTimeout(() => finish(() => reject(new Error(`Timed out opening "${url}".`))), timeoutMs);
    el.src = url;
  });
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface SheetRead {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  realCells: number;
  attempts: number;
}

/**
 * Decode one contact sheet and hand back its pixels.
 *
 * The magenta gutter is the acceptance test, and it is checked BEFORE
 * anything is measured, because both ways this can go wrong are silent.
 * A canvas that has not received the frame yet reads as black and would
 * be measured as a very dark video with no cuts; a sheet whose geometry
 * differs from the layout by a pixel would be measured with every cell
 * straddling two frames. Neither raises an error on its own.
 */
export async function readSheet(url: string, layout: TileLayout, timeoutMs = 20000): Promise<SheetRead> {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;

  /*
    These timeouts are deliberately short, and the reason is the bridge.
    `toolBridge` gives an ordinary tool 60 seconds and then answers the
    caller with "Timed out after 60s waiting for the editor" — a message
    about the plumbing that says nothing about what went wrong. Anything
    that can hang in here has to give up in time to report its own
    failure, or the diagnosis is thrown away and replaced with a shrug.
  */
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => { if (!settled) { settled = true; fn(); } };
    video.onloadeddata = () => finish(resolve);
    video.onerror = () => finish(() => reject(new Error(
      `Could not decode the contact sheet at ${url}: ${video.error?.message ?? 'no reason given'} ` +
      `(code ${video.error?.code ?? '?'}). ffmpeg wrote the file, so this is a decoder gap in the ` +
      'browser engine, not a bad filtergraph.')));
    setTimeout(() => finish(() => reject(new Error(
      `The contact sheet at ${url} parsed but never produced a frame within ${timeoutMs}ms ` +
      `(readyState ${video.readyState}, networkState ${video.networkState}). ffmpeg wrote ` +
      `${layout.width}x${layout.height}; the engine would not decode it.`))), timeoutMs);
    video.src = url;
  });

  if (video.videoWidth !== layout.width || video.videoHeight !== layout.height) {
    throw new Error(
      `The contact sheet is ${video.videoWidth}x${video.videoHeight} but the layout expects ` +
      `${layout.width}x${layout.height}. Every cell offset would be wrong, so nothing is measured.`
    );
  }

  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas context to read the contact sheet with.');
  ctx.imageSmoothingEnabled = false;

  /*
    `loadeddata` says the data arrived, NOT that a frame has been
    presented — and `drawImage` on a video that has data but has never
    presented a frame paints nothing at all, silently. One fixture hit
    this reproducibly: ffmpeg's sheet was perfect (its gutter reads 100%
    magenta in an independent reader) and the canvas came back black
    every time. `requestVideoFrameCallback` is the signal that actually
    means "there is a frame you can draw"; a seek is what makes one
    happen on a single-frame video that will not start on its own.
  */
  const framePresented = () => new Promise<void>((resolve) => {
    const rvfc = (video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    }).requestVideoFrameCallback;
    if (typeof rvfc === 'function') rvfc.call(video, () => resolve());
    setTimeout(resolve, 250);
  });

  /*
    The retry budget is wall-clock, not a count, because the two cases
    cost wildly different amounts. A sheet that paints comes back on the
    first attempt in under a millisecond; a sheet the decoder has given
    up on makes `drawImage` and `getImageData` take about a second EACH,
    so a plain "try 40 times" spent forty seconds discovering something
    it knew after three — and forty seconds is past the tool bridge's
    own timeout, so the diagnosis never reached the caller. Counting
    attempts is not enough either: a single `drawImage` on a video the
    decoder has abandoned can itself take ten seconds or more, so the
    budget has to be a race against a timer rather than a check between
    iterations. It only works because the loop yields — the renderer
    answers other calls normally throughout, so this is a stalled
    promise, not a blocked thread.
  */
  const paint = async (): Promise<SheetRead | null> => {
    for (let attempt = 1; attempt <= 20; attempt++) {
      if (attempt > 1) await framePresented();
      ctx.drawImage(video, 0, 0);
      const data = ctx.getImageData(0, 0, layout.width, layout.height);
      if (paddingIntact(data.data, layout.width, layout.height, layout)) {
        return {
          pixels: data.data, width: layout.width, height: layout.height,
          realCells: countRealCells(data.data, layout.width, layout),
          attempts: attempt,
        };
      }
      await delay(50);
    }
    return null;
  };

  const got = await Promise.race([paint(), delay(6000).then(() => null)]);
  video.removeAttribute('src');
  video.load();
  if (got) return got;

  throw new Error(
    'The contact sheet decoded but nothing was painted: its magenta gutter is missing from the ' +
    'canvas within six seconds. ffmpeg wrote the file correctly — read it with any other tool — ' +
    'so ' +
    'this is the browser engine declining to produce a frame. Refusing to measure a blank canvas ' +
    'rather than reporting a very dark video with no cuts.'
  );
}

/* ── Format ───────────────────────────────────────────────────────── */

const STANDARD_RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 120];

const NAMED_ASPECTS: [number, string][] = [
  [16 / 9, '16:9'], [9 / 16, '9:16'], [1, '1:1'], [4 / 5, '4:5'], [5 / 4, '5:4'],
  [4 / 3, '4:3'], [3 / 4, '3:4'], [21 / 9, '21:9'], [2.39, '2.39:1'], [2, '2:1'],
];

export function describeAspect(w: number, h: number): { ratio: string; decimal: number; orientation: string } {
  const decimal = h > 0 ? w / h : 0;
  let ratio = `${w}:${h}`;
  let bestErr = Infinity;
  for (const [value, name] of NAMED_ASPECTS) {
    const err = Math.abs(decimal - value) / value;
    if (err < 0.02 && err < bestErr) { bestErr = err; ratio = name; }
  }
  if (bestErr === Infinity) {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const g = gcd(w, h) || 1;
    ratio = `${w / g}:${h / g}`;
  }
  return {
    ratio,
    decimal: Number(decimal.toFixed(4)),
    orientation: decimal > 1.05 ? 'landscape' : decimal < 0.95 ? 'portrait' : 'square',
  };
}

/**
 * Snap a measured rate onto a standard one — the NEAREST, not the first
 * that is close enough.
 *
 * 29.97 and 30 are 0.1% apart, which is inside any tolerance wide enough
 * to absorb a container duration rounded to the millisecond. The first
 * version of this returned the first rate within tolerance, so a file
 * measured at exactly 30.000 came back as 29.97 because 29.97 is earlier
 * in the list — and every cut time then drifted by 1ms per second,
 * putting a cut at a known 3.500s at 3.504s.
 */
export function snapFrameRate(measured: number): { fps: number; snappedTo: number | null } {
  let best: number | null = null;
  let bestErr = Infinity;
  for (const rate of STANDARD_RATES) {
    const err = Math.abs(measured - rate) / rate;
    if (err < 0.006 && err < bestErr) { bestErr = err; best = rate; }
  }
  return best !== null
    ? { fps: best, snappedTo: best }
    : { fps: Number(measured.toFixed(3)), snappedTo: null };
}

/* ── The whole thing ──────────────────────────────────────────────── */

export interface ReferenceAnalysis {
  source: { url: string; name: string };
  format: {
    width: number; height: number; aspectRatio: string; aspectDecimal: number;
    orientation: string; durationMs: number; frameCount: number; fps: number;
    fpsMeasured: number; fpsSnappedTo: number | null; analysisFps: number;
    analysedFrames: number; note: string;
  };
  cuts: {
    count: number;
    cutMs: number[];
    shots: { index: number; startMs: number; endMs: number; durationMs: number; frames: number }[];
    shotDurationMs: { min: number; median: number; mean: number; max: number };
    flashes: { atMs: number; durationMs: number }[];
    dissolves: { startMs: number; endMs: number; durationMs: number; blendError: number }[];
    detection: {
      metric: string; absoluteFloor: number; localBaselineRatio: number;
      strongestScore: number; weakestCutScore: number; loudestRejected: number;
      cellPx: string; framePeriodMs: number;
    };
  };
  cadence: CadenceReport | null;
  cadenceUnavailable?: string;
  grade: (GradeReport & { perShot: { shotIndex: number; luma: number; saturation: number; meanRgb: [number, number, number] }[] }) | null;
  motion: {
    perShot: (ShotMotion & { shotIndex: number; startMs: number; endMs: number })[];
    dominant: string;
    floorPctPerSec: number;
    note: string;
  } | null;
  overlays: OverlayReport | null;
  notes: string[];
  analysis: {
    elapsedMs: number;
    passes: { name: string; filtergraph: string; outputBytes: number; ms: number }[];
    warnings: string[];
  };
}

/**
 * How long the whole analysis gets before it gives up and says where it
 * was.
 *
 * `toolBridge` allows an ordinary tool 60 seconds and then answers
 * "Timed out after 60s waiting for the editor", which tells the caller
 * about the plumbing and nothing about the video. Every await in here is
 * individually bounded, but "every await is bounded" is a claim, and the
 * first file that hung proved it false — so the claim is enforced from
 * outside as well, with a deadline that reports the stage it died in.
 */
const DEADLINE_MS = 50_000;

function withDeadline<T>(work: Promise<T>, stage: () => string): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(
      `Gave up after ${DEADLINE_MS / 1000}s during: ${stage()}. This is the tool's own deadline, ` +
      'set below the tool bridge\'s, so the stage is named rather than lost to a bridge timeout.'
    )), DEADLINE_MS)),
  ]);
}

export async function analyzeReferenceVideo(
  input: ReferenceAnalysisInput, deps: ReferenceAnalysisDeps
): Promise<ReferenceAnalysis> {
  let stage = 'starting';
  return withDeadline(analyzeInner(input, deps, (s) => { stage = s; }), () => stage);
}

async function analyzeInner(
  input: ReferenceAnalysisInput, deps: ReferenceAnalysisDeps, setStage: (s: string) => void
): Promise<ReferenceAnalysis> {
  const started = Date.now();
  const url = toFileUrl(input.url);
  const name = input.name ?? decodeURIComponent(url.split('/').pop() ?? 'reference');
  const warnings: string[] = [];
  const notes: string[] = [];
  const passes: { name: string; filtergraph: string; outputBytes: number; ms: number }[] = [];

  setStage(`opening ${name}`);
  const meta = await loadVideoMeta(url);
  if (!meta.width || !meta.height) throw new Error(`"${name}" has no video stream this engine can decode.`);
  if (!(meta.durationMs > 0)) throw new Error(`"${name}" reports no duration, so nothing can be timed against it.`);
  const durationSec = meta.durationMs / 1000;

  /* How many frames to look at. The bound assumes 60fps until the sheet
     itself says otherwise — it is a CEILING for the grid, not a claim
     about the source. */
  const maxFrames = Math.max(60, input.maxFrames ?? 3600);
  let forcedFps: number | null = input.analysisFps ?? null;
  let bound = Math.ceil(durationSec * (forcedFps ?? 60)) + 4;
  if (bound > maxFrames) {
    forcedFps = Number((maxFrames / durationSec).toFixed(3));
    bound = maxFrames + 4;
    warnings.push(
      `${durationSec.toFixed(1)}s at up to 60fps is more than the ${maxFrames}-frame ceiling, so the ` +
      `analysis samples at ${forcedFps}fps. Cut times are quantised to ${(1000 / forcedFps).toFixed(1)}ms ` +
      'and the source frame rate is not measured.'
    );
  }

  const layout = chooseTileLayout(bound, meta.width, meta.height, { cellArea: 2304, maxSide: 2400 });
  const vf = tileFiltergraph(layout, { fps: forcedFps ?? undefined, flags: 'area' });

  let t0 = Date.now();
  setStage('building the cut/motion contact sheet with ffmpeg');
  const sheet = await deps.ffmpegProcess({ input: url, vf, noAudio: true, name: 'ref-cuts' });
  if (!sheet.ok || !sheet.path) throw new Error(`ffmpeg could not build the contact sheet: ${sheet.error}`);
  passes.push({ name: 'cuts+motion sheet', filtergraph: vf, outputBytes: sheet.bytes ?? 0, ms: Date.now() - t0 });

  setStage('decoding the cut/motion contact sheet');
  const read = await readSheet(toFileUrl(sheet.path), layout);
  const frameCount = read.realCells;
  if (frameCount < 2) throw new Error(`Only ${frameCount} frame(s) came back from the contact sheet.`);
  if (frameCount >= layout.capacity) {
    warnings.push(
      `The contact sheet filled all ${layout.capacity} of its cells, so the clip may have more ` +
      'frames than were analysed. Pass a lower analysisFps or a higher maxFrames.'
    );
  }

  const measuredFps = frameCount / durationSec;
  const snapped = forcedFps ? { fps: forcedFps, snappedTo: null } : snapFrameRate(measuredFps);
  const fps = snapped.fps;
  const msPerFrame = 1000 / fps;
  const frameToMs = (f: number) => Math.round(f * msPerFrame);

  const frames: FrameFeatures[] = [];
  for (let i = 0; i < frameCount; i++) frames.push(cellFeatures(read.pixels, layout.width, layout, i));

  /* ── cuts ── */
  setStage(`detecting cuts across ${frameCount} frames`);
  const detection = detectCuts(frames, layout, { sensitivity: input.cutSensitivity, search: 6 });
  const cutMs = detection.cutFrames.map(frameToMs);

  const boundaries = [0, ...detection.cutFrames, frameCount];
  const shots = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const a = boundaries[i], b = boundaries[i + 1];
    shots.push({
      index: i, startMs: frameToMs(a), endMs: frameToMs(b),
      durationMs: frameToMs(b) - frameToMs(a), frames: b - a,
    });
  }
  const durations = shots.map((s) => s.durationMs);

  const cutScores = detection.cutFrames.map((f) => detection.scores[f - 1]);
  const rejected = Array.from(detection.scores).filter((_, i) => !detection.cutFrames.includes(i + 1));

  /* ── motion ── */
  let motion: ReferenceAnalysis['motion'] = null;
  if (input.includeMotion !== false) {
    setStage(`measuring motion across ${shots.length} shot(s)`);
    const perShot = shots.map((s) => ({
      shotIndex: s.index, startMs: s.startMs, endMs: s.endMs,
      ...shotMotion(frames, boundaries[s.index], boundaries[s.index + 1] - 1, layout, fps),
    }));
    const counts = new Map<string, number>();
    for (const s of perShot) counts.set(s.classification, (counts.get(s.classification) ?? 0) + 1);
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
    motion = {
      perShot, dominant, floorPctPerSec: motionFloorPct(layout, fps),
      note:
        `Global translation only, measured on ${layout.cellW}x${layout.cellH} frames. A zoom, a ` +
        'rotation or a moving subject in a locked-off frame shows up as residual, not as pan or ' +
        'tilt. Anything under the floor is reported as locked off because it cannot be told from one.',
    };
  }

  /* ── grade and overlays ── */
  let grade: ReferenceAnalysis['grade'] = null;
  let overlays: OverlayReport | null = null;
  const wantGrade = input.includeGrade !== false;
  const wantOverlays = input.includeOverlays !== false;

  if (wantGrade || wantOverlays) {
    const wanted = Math.min(frameCount, 36);
    const gradeFps = Number((wanted / durationSec).toFixed(4));
    const gradeLayout = chooseTileLayout(wanted + 4, meta.width, meta.height,
      { cellArea: 32000, maxSide: 2400 });
    /* Point samples, not an area average. A box filter reports every clip
       as having lifted blacks and less contrast than it has, because it
       pulls both tails of the histogram towards the middle. `neighbor`
       takes real pixels, so the distribution it reports is the real one. */
    const gradeVf = tileFiltergraph(gradeLayout, { fps: gradeFps, flags: 'neighbor' });
    t0 = Date.now();
    setStage('building the grade/overlay contact sheet with ffmpeg');
    const gradeSheet = await deps.ffmpegProcess({ input: url, vf: gradeVf, noAudio: true, name: 'ref-grade' });
    if (!gradeSheet.ok || !gradeSheet.path) {
      warnings.push(`The grade sheet failed: ${gradeSheet.error}`);
    } else {
      passes.push({ name: 'grade+overlay sheet', filtergraph: gradeVf, outputBytes: gradeSheet.bytes ?? 0, ms: Date.now() - t0 });
      setStage('decoding the grade/overlay contact sheet');
      const gradeRead = await readSheet(toFileUrl(gradeSheet.path), gradeLayout);
      const gradeCells = gradeRead.realCells;
      const sampleMs: number[] = [];
      for (let i = 0; i < gradeCells; i++) sampleMs.push(Math.round((i / gradeFps) * 1000));

      if (wantGrade) {
        const overall = emptyGradeSample();
        for (let i = 0; i < gradeCells; i++) accumulateGrade(overall, gradeRead.pixels, gradeLayout.width, gradeLayout, i);
        const report = summariseGrade(overall);
        report.sampledFrames = gradeCells;

        const perShot = shots.map((s) => {
          const sample = emptyGradeSample();
          let used = 0;
          for (let i = 0; i < gradeCells; i++) {
            if (sampleMs[i] >= s.startMs && sampleMs[i] < s.endMs) {
              accumulateGrade(sample, gradeRead.pixels, gradeLayout.width, gradeLayout, i);
              used++;
            }
          }
          if (used === 0) return null;
          const r = summariseGrade(sample);
          return {
            shotIndex: s.index, luma: r.luminance.mean,
            saturation: r.saturation.mean, meanRgb: r.colour.meanRgb,
          };
        }).filter((x): x is NonNullable<typeof x> => x !== null);

        grade = { ...report, perShot };
      }

      if (wantOverlays) {
        const lumas: Float32Array[] = [];
        for (let i = 0; i < gradeCells; i++) {
          lumas.push(cellFeatures(gradeRead.pixels, gradeLayout.width, gradeLayout, i).luma);
        }
        overlays = findOverlayRegions(lumas, gradeLayout, sampleMs);
      }
    }
  }

  /* ── cadence ── */
  let cadence: CadenceReport | null = null;
  let cadenceUnavailable: string | undefined;
  if (input.includeCadence !== false) {
    t0 = Date.now();
    setStage('extracting the audio');
    const audio = await deps.ffmpegProcess({ input: url, audioOnly: true, name: 'ref-audio' });
    if (!audio.ok || !audio.path) {
      cadenceUnavailable =
        `No audio could be extracted, so there is no beat to measure the cuts against (${audio.error}). ` +
        'A video with no audio track fails here, and so does one whose audio ffmpeg cannot decode.';
    } else {
      passes.push({ name: 'audio extract', filtergraph: '(audio only)', outputBytes: audio.bytes ?? 0, ms: Date.now() - t0 });
      try {
        setStage('detecting beats');
        const beats = await deps.detectBeats(toFileUrl(audio.path), 0);
        cadence = cadenceAgainstBeats(cutMs, durations, beats);
      } catch (err) {
        cadenceUnavailable = `Beat detection failed on the extracted audio: ${(err as Error).message}`;
      }
    }
  }

  if (cadence && cadence.onsetsDetected > 0 && cadence.beatsOnRealOnsets / Math.max(1, cadence.beats) > 0.95
      && cadence.beats > 4 && cadence.onsetsDetected > cadence.beats * 2) {
    notes.push(
      'The beat grid claims to sit entirely on detected onsets while the detector found more than ' +
      'twice as many onsets as beats. `computeNovelty` normalises by its own maximum and has no ' +
      'absolute floor, so a steady tone produces onsets everywhere (NEXT.md §8). Treat the tempo ' +
      'as unconfirmed on music with no clear transient.'
    );
  }
  if (detection.flashes.length) {
    notes.push(
      `${detection.flashes.length} flash(es) were found and are NOT counted as cuts: the picture ` +
      'returns to what it was, which a cut never does.'
    );
  }

  return {
    source: { url, name },
    format: {
      width: meta.width, height: meta.height,
      ...(({ ratio, decimal, orientation }) => ({ aspectRatio: ratio, aspectDecimal: decimal, orientation }))(
        describeAspect(meta.width, meta.height)),
      durationMs: Math.round(meta.durationMs),
      frameCount,
      fps,
      fpsMeasured: Number(measuredFps.toFixed(3)),
      fpsSnappedTo: snapped.snappedTo,
      analysisFps: forcedFps ?? fps,
      analysedFrames: frameCount,
      note: forcedFps
        ? `Sampled at ${forcedFps}fps; frameCount is the number of SAMPLED frames, not the source's.`
        : `frameCount is counted off the contact sheet, and fps is that count over the container ` +
          `duration (${measuredFps.toFixed(3)}), not a value read from metadata.`,
    },
    cuts: {
      count: detection.cutFrames.length,
      cutMs,
      shots,
      shotDurationMs: {
        min: durations.length ? Math.min(...durations) : 0,
        median: Number(median(durations).toFixed(0)),
        mean: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
        max: durations.length ? Math.max(...durations) : 0,
      },
      flashes: detection.flashes.map((f) => ({
        atMs: frameToMs(f.startFrame),
        durationMs: frameToMs(f.endFrame) - frameToMs(f.startFrame),
      })),
      dissolves: detection.dissolves.map((d) => ({
        startMs: frameToMs(d.startFrame), endMs: frameToMs(d.endFrame),
        durationMs: frameToMs(d.endFrame) - frameToMs(d.startFrame),
        blendError: d.blendError,
      })),
      detection: {
        metric:
          'max(trilinear 4x4x4 RGB histogram distance, 2.5 x motion-compensated mean absolute ' +
          'luma difference). A cut must clear an absolute floor AND a multiple of the local ' +
          'baseline; a steady pan clears the floor and a still frame clears the ratio, so both are needed.',
        absoluteFloor: Number(detection.absoluteFloor.toFixed(3)),
        localBaselineRatio: detection.ratio,
        strongestScore: Number(Math.max(0, ...cutScores).toFixed(3)),
        weakestCutScore: cutScores.length ? Number(Math.min(...cutScores).toFixed(3)) : 0,
        loudestRejected: rejected.length ? Number(Math.max(...rejected).toFixed(3)) : 0,
        cellPx: `${layout.cellW}x${layout.cellH}`,
        framePeriodMs: Number(msPerFrame.toFixed(3)),
      },
    },
    cadence,
    ...(cadenceUnavailable ? { cadenceUnavailable } : {}),
    grade,
    motion,
    overlays,
    notes,
    analysis: { elapsedMs: Date.now() - started, passes, warnings },
  };
}
