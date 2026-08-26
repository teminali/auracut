/* ═══════════════════════════════════════════════════════════════════
   Geometry — the ONE place that decides where a clip lands on screen.

   Both the canvas compositor and the interactive transform gizmo call
   into here, which is what keeps the handles glued to the pixels.

   Three coordinate spaces:
     • source   – the media's own pixels
     • canvas   – project pixels (0,0 top-left … width,height)
     • view     – CSS pixels inside the monitor stage
   `Viewport` converts between canvas and view.
   ═══════════════════════════════════════════════════════════════════ */

import { Clip, ProjectSettings } from '../types/edl';
import { interpolateKeyframes } from './keyframeMath';

export interface Vec2 {
  x: number;
  y: number;
}

/** Axis-aligned box in canvas space. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A clip's placement on the canvas, including rotation. */
export interface ClipBox {
  /** Centre point in canvas space. */
  cx: number;
  cy: number;
  /** Post-scale dimensions in canvas space. */
  width: number;
  height: number;
  /** Degrees, clockwise. */
  rotation: number;
  opacity: number;
  /** Pre-scale content dimensions — what scale=1 would measure. */
  baseWidth: number;
  baseHeight: number;
  scaleX: number;
  scaleY: number;
  /**
   * Normalised 0..1 pivot inside the clip's own box. 0.5,0.5 is the
   * centre. `cx`/`cy` locate THIS point, and scale and rotation turn
   * about it — which is what makes a stroke able to grow from one end
   * rather than from the middle.
   */
  anchorX: number;
  anchorY: number;
}

/** Maps canvas space ⇄ view (CSS) space for the program monitor. */
export interface Viewport {
  /** view px per canvas px. */
  scale: number;
  /** Top-left of the canvas inside the stage element, in view px. */
  offsetX: number;
  offsetY: number;
  /** Canvas size in view px. */
  displayWidth: number;
  displayHeight: number;
}

/* ── Small helpers ──────────────────────────────────────────────── */

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const toRad = (deg: number): number => (deg * Math.PI) / 180;
export const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Rotate `p` around `origin` by `deg`. */
export function rotatePoint(p: Vec2, origin: Vec2, deg: number): Vec2 {
  if (deg === 0) return { x: p.x, y: p.y };
  const r = toRad(deg);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
}

/* ── Viewport construction & conversion ─────────────────────────── */

/**
 * Fit the project canvas inside a stage of `stageW × stageH`, honouring a
 * user zoom factor (1 = fit). Rounded so the canvas lands on whole pixels.
 */
export function computeViewport(
  stageW: number,
  stageH: number,
  project: ProjectSettings,
  zoom = 1,
  panX = 0,
  panY = 0
): Viewport {
  const safeW = Math.max(1, stageW);
  const safeH = Math.max(1, stageH);
  const fitScale = Math.min(safeW / project.width, safeH / project.height);
  const scale = Math.max(0.01, fitScale * zoom);

  const displayWidth = project.width * scale;
  const displayHeight = project.height * scale;

  return {
    scale,
    offsetX: (safeW - displayWidth) / 2 + panX,
    offsetY: (safeH - displayHeight) / 2 + panY,
    displayWidth,
    displayHeight,
  };
}

export const canvasToView = (p: Vec2, vp: Viewport): Vec2 => ({
  x: p.x * vp.scale + vp.offsetX,
  y: p.y * vp.scale + vp.offsetY,
});

export const viewToCanvas = (p: Vec2, vp: Viewport): Vec2 => ({
  x: (p.x - vp.offsetX) / vp.scale,
  y: (p.y - vp.offsetY) / vp.scale,
});

/** Convert a view-space delta (drag distance) into canvas units. */
export const viewDeltaToCanvas = (dx: number, dy: number, vp: Viewport): Vec2 => ({
  x: dx / vp.scale,
  y: dy / vp.scale,
});

/* ── Base (untransformed) content size ──────────────────────────── */

/**
 * Size of a clip's content at scale = 1, before any transform.
 *
 * Full-frame media covers the canvas; overlays/PIP/stickers keep their own
 * aspect ratio at a fraction of the frame; text measures its own run.
 */
export function getClipBaseSize(
  clip: Clip,
  project: ProjectSettings,
  natural?: { width: number; height: number } | null
): { width: number; height: number } {
  const cw = project.width;
  const ch = project.height;

  if (clip.type === 'text') {
    const style = clip.textStyle;
    if (!style) return { width: cw * 0.6, height: ch * 0.14 };
    const lines = style.text.split('\n');
    const longest = lines.reduce((a, b) => (a.length >= b.length ? a : b), '');
    // Approximate advance width; the compositor measures exactly at draw time
    // and writes the result back through `cacheTextMetrics`.
    const cached = textMetricsCache.get(textMetricsKey(clip));
    const width = cached
      ? cached.width
      : longest.length * style.fontSize * 0.56 + style.letterSpacing * longest.length;
    const height = lines.length * style.fontSize * style.lineHeight;
    return {
      width: Math.max(24, width + style.backgroundPadding * 2),
      height: Math.max(24, height + style.backgroundPadding * 2),
    };
  }

  const nw = natural?.width || clip.naturalWidth || cw;
  const nh = natural?.height || clip.naturalHeight || ch;
  const aspect = nw / nh || cw / ch;
  const canvasAspect = cw / ch;

  switch (clip.fitMode) {
    case 'fill':
      return { width: cw, height: ch };

    case 'none':
      return { width: nw, height: nh };

    case 'contain': {
      // Inset overlays sit at 55% of the frame's limiting dimension.
      const target = 0.55;
      return aspect > canvasAspect
        ? { width: cw * target, height: (cw * target) / aspect }
        : { width: ch * target * aspect, height: ch * target };
    }

    case 'cover':
    default:
      // Fill the frame with no letterboxing and no distortion.
      return aspect > canvasAspect
        ? { width: ch * aspect, height: ch }
        : { width: cw, height: cw / aspect };
  }
}

/* ── Text measurement cache ─────────────────────────────────────── */
/* The compositor measures text precisely on the 2D context; the gizmo needs
   the same number a frame later. A tiny cache bridges the two. */

interface TextMetrics {
  width: number;
  height: number;
}

const textMetricsCache = new Map<string, TextMetrics>();

export function textMetricsKey(clip: Clip): string {
  const s = clip.textStyle;
  if (!s) return clip.id;
  return `${clip.id}|${s.text}|${s.fontSize}|${s.fontFamily}|${s.fontWeight}|${s.letterSpacing}|${s.lineHeight}`;
}

export function cacheTextMetrics(clip: Clip, metrics: TextMetrics): void {
  const key = textMetricsKey(clip);
  const prev = textMetricsCache.get(key);
  if (!prev || prev.width !== metrics.width || prev.height !== metrics.height) {
    textMetricsCache.set(key, metrics);
    if (textMetricsCache.size > 400) {
      // Cheap eviction: drop the oldest insertion.
      const first = textMetricsCache.keys().next().value;
      if (first !== undefined) textMetricsCache.delete(first);
    }
  }
}

/* ── The clip box ───────────────────────────────────────────────── */

/**
 * Resolve a clip's on-canvas box at a given timeline position, applying
 * keyframe interpolation on top of its static transform.
 */
export function getClipBox(
  clip: Clip,
  project: ProjectSettings,
  playheadMs: number,
  natural?: { width: number; height: number } | null
): ClipBox {
  const offsetMs = playheadMs - clip.startTimeMs;
  const t = clip.transform;

  const x = interpolateKeyframes(clip.keyframes, 'positionX', offsetMs, t.x);
  const y = interpolateKeyframes(clip.keyframes, 'positionY', offsetMs, t.y);
  const scaleX = interpolateKeyframes(clip.keyframes, 'scaleX', offsetMs, t.scaleX);
  const scaleY = interpolateKeyframes(clip.keyframes, 'scaleY', offsetMs, t.scaleY);
  const rotation = interpolateKeyframes(clip.keyframes, 'rotation', offsetMs, t.rotation);
  const opacity = interpolateKeyframes(clip.keyframes, 'opacity', offsetMs, t.opacity);
  const anchorX = interpolateKeyframes(clip.keyframes, 'anchorX', offsetMs, t.anchorX ?? 0.5);
  const anchorY = interpolateKeyframes(clip.keyframes, 'anchorY', offsetMs, t.anchorY ?? 0.5);

  const base = getClipBaseSize(clip, project, natural);

  return {
    cx: project.width / 2 + x,
    cy: project.height / 2 + y,
    width: base.width * scaleX,
    height: base.height * scaleY,
    rotation,
    opacity,
    baseWidth: base.width,
    baseHeight: base.height,
    scaleX,
    scaleY,
    anchorX,
    anchorY,
  };
}

/** The four rotated corners of a box, clockwise from top-left. */
export function getBoxCorners(box: ClipBox): [Vec2, Vec2, Vec2, Vec2] {
  const hw = box.width / 2;
  const hh = box.height / 2;
  const c = { x: box.cx, y: box.cy };
  const raw: Vec2[] = [
    { x: box.cx - hw, y: box.cy - hh },
    { x: box.cx + hw, y: box.cy - hh },
    { x: box.cx + hw, y: box.cy + hh },
    { x: box.cx - hw, y: box.cy + hh },
  ];
  return raw.map((p) => rotatePoint(p, c, box.rotation)) as [Vec2, Vec2, Vec2, Vec2];
}

/** Axis-aligned bounding box of a (possibly rotated) clip box. */
export function getBoxAABB(box: ClipBox): Rect {
  if (box.rotation === 0) {
    return {
      x: box.cx - box.width / 2,
      y: box.cy - box.height / 2,
      width: box.width,
      height: box.height,
    };
  }
  const corners = getBoxCorners(box);
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/** Is a canvas-space point inside the (rotated) box? */
export function hitTestBox(point: Vec2, box: ClipBox): boolean {
  // Un-rotate the point into the box's local frame, then compare axis-aligned.
  const local = rotatePoint(point, { x: box.cx, y: box.cy }, -box.rotation);
  return (
    local.x >= box.cx - box.width / 2 &&
    local.x <= box.cx + box.width / 2 &&
    local.y >= box.cy - box.height / 2 &&
    local.y <= box.cy + box.height / 2
  );
}

/* ── Handle definitions ─────────────────────────────────────────── */

export type HandleId =
  | 'nw' | 'n' | 'ne'
  | 'w'  |       'e'
  | 'sw' | 's' | 'se'
  | 'rotate';

export interface HandleSpec {
  id: HandleId;
  /** Normalised position within the box, -0.5 … 0.5. */
  ux: number;
  uy: number;
  /** Which axes this handle resizes. */
  axis: 'both' | 'x' | 'y' | 'none';
  cursor: string;
}

export const RESIZE_HANDLES: HandleSpec[] = [
  { id: 'nw', ux: -0.5, uy: -0.5, axis: 'both', cursor: 'nwse-resize' },
  { id: 'n',  ux: 0,    uy: -0.5, axis: 'y',    cursor: 'ns-resize' },
  { id: 'ne', ux: 0.5,  uy: -0.5, axis: 'both', cursor: 'nesw-resize' },
  { id: 'w',  ux: -0.5, uy: 0,    axis: 'x',    cursor: 'ew-resize' },
  { id: 'e',  ux: 0.5,  uy: 0,    axis: 'x',    cursor: 'ew-resize' },
  { id: 'sw', ux: -0.5, uy: 0.5,  axis: 'both', cursor: 'nesw-resize' },
  { id: 's',  ux: 0,    uy: 0.5,  axis: 'y',    cursor: 'ns-resize' },
  { id: 'se', ux: 0.5,  uy: 0.5,  axis: 'both', cursor: 'nwse-resize' },
];

/**
 * Rotation makes a fixed cursor wrong — a "north" handle on a box turned 90°
 * should read as east/west. Pick the cursor whose direction matches on screen.
 */
const CURSOR_RING = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];

export function rotatedCursor(handle: HandleSpec, rotation: number): string {
  if (handle.id === 'rotate') return 'grab';
  // Base compass angle of the handle, 0° = north, increasing clockwise.
  const baseAngle = toDeg(Math.atan2(handle.ux, -handle.uy));
  const screenAngle = ((baseAngle + rotation) % 360 + 360) % 360;
  // Snap to the nearest 45° sector, then map onto the 4 resize cursors.
  const sector = Math.round(screenAngle / 45) % 8;
  return CURSOR_RING[sector % 4];
}

/* ── Resize solving ─────────────────────────────────────────────── */

export interface ResizeInput {
  /** Box as it was when the drag began. */
  startBox: ClipBox;
  handle: HandleSpec;
  /** Pointer delta in CANVAS units since drag start. */
  deltaCanvas: Vec2;
  /** Preserve the box's aspect ratio (Shift). */
  lockAspect: boolean;
  /** Grow symmetrically about the centre (Alt/Option). */
  fromCenter: boolean;
  /** Smallest permitted edge, in canvas px. */
  minSize: number;
}

export interface ResizeResult {
  /** New centre in canvas space. Subtract half the project size for transform.x/y. */
  cx: number;
  cy: number;
  scaleX: number;
  scaleY: number;
  /** Resolved box, handy for drawing guides mid-drag. */
  box: ClipBox;
}

/**
 * Resize a rotated box by dragging one handle.
 *
 * Works in the box's local (un-rotated) frame so rotation never skews the
 * result, then rotates the resulting centre shift back into canvas space.
 */
export function solveResize(input: ResizeInput): ResizeResult {
  const { startBox, handle, deltaCanvas, lockAspect, fromCenter, minSize } = input;

  // Move the pointer delta into the box's local axes.
  const local = rotatePoint(
    { x: deltaCanvas.x, y: deltaCanvas.y },
    { x: 0, y: 0 },
    -startBox.rotation
  );

  const signX = handle.axis === 'y' ? 0 : Math.sign(handle.ux);
  const signY = handle.axis === 'x' ? 0 : Math.sign(handle.uy);

  const symmetry = fromCenter ? 2 : 1;
  let newWidth = startBox.width + local.x * signX * symmetry;
  let newHeight = startBox.height + local.y * signY * symmetry;

  if (lockAspect && startBox.width > 0 && startBox.height > 0) {
    const aspect = startBox.width / startBox.height;
    if (handle.axis === 'both') {
      // Drive off whichever axis moved further, so the box tracks the pointer.
      if (Math.abs(local.x) > Math.abs(local.y)) newHeight = newWidth / aspect;
      else newWidth = newHeight * aspect;
    } else if (handle.axis === 'x') {
      newHeight = newWidth / aspect;
    } else {
      newWidth = newHeight * aspect;
    }
  }

  newWidth = Math.max(minSize, newWidth);
  newHeight = Math.max(minSize, newHeight);

  // The opposite edge stays put unless we're scaling from the centre.
  let localShiftX = 0;
  let localShiftY = 0;
  if (!fromCenter) {
    localShiftX = ((newWidth - startBox.width) / 2) * signX;
    localShiftY = ((newHeight - startBox.height) / 2) * signY;
    if (lockAspect) {
      // A locked-aspect edge drag also grows the perpendicular axis; keep that
      // growth centred so the anchored edge does not drift.
      if (handle.axis === 'x') localShiftY = 0;
      if (handle.axis === 'y') localShiftX = 0;
    }
  }

  const canvasShift = rotatePoint({ x: localShiftX, y: localShiftY }, { x: 0, y: 0 }, startBox.rotation);

  const cx = startBox.cx + canvasShift.x;
  const cy = startBox.cy + canvasShift.y;

  const scaleX = startBox.baseWidth > 0 ? newWidth / startBox.baseWidth : startBox.scaleX;
  const scaleY = startBox.baseHeight > 0 ? newHeight / startBox.baseHeight : startBox.scaleY;

  return {
    cx,
    cy,
    scaleX,
    scaleY,
    box: { ...startBox, cx, cy, width: newWidth, height: newHeight, scaleX, scaleY },
  };
}

/** Angle in degrees from box centre to a canvas point, 0° = up. */
export function angleFromCenter(center: Vec2, point: Vec2): number {
  return toDeg(Math.atan2(point.x - center.x, center.y - point.y));
}

/** Snap a rotation to the nearest `step` when within `tolerance` degrees. */
export function snapAngle(deg: number, step = 15, tolerance = 4): number {
  const nearest = Math.round(deg / step) * step;
  return Math.abs(deg - nearest) <= tolerance ? nearest : deg;
}

/** Normalise degrees into -180 … 180. */
export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a < -180) a += 360;
  return Math.round(a * 10) / 10;
}
