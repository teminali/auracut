/**
 * The synthetic cursor.
 *
 * `Take.cursor` has existed for as long as the recorder has, sampled at
 * 30Hz and normalised to the captured display's bounds, and until now it
 * was read for exactly one purpose: deciding WHERE to zoom. Nothing
 * drew a pointer. A screen capture on macOS does not include the cursor
 * in the frame, so a tutorial built from a take had no pointer in it at
 * all, and the zooms pushed in on things the viewer could not see being
 * clicked.
 *
 * This draws one. It is not the system arrow: it is the paper-plane dart
 * measured off the reference video, because a synthetic cursor is the
 * one element of a screen recording that is unambiguously ALLOWED to be
 * a designed object rather than a faithful capture, and at phone size a
 * 24px system arrow is invisible while this reads.
 *
 * ── Everything here is measured, and here is what off what ──────────
 *
 * Frames at t=200s (frame at rest) and t=440s (deep zoom) of the
 * reference, both 1920x1080. See
 * `.claude/reference/REFERENCE-VIDEO-ANALYSIS.md`.
 *
 * The one question that decided the whole design was whether the cursor
 * is composited BEFORE the zoom, and so grows with the frame, or after
 * it at a constant size. Two independent rulers put the frame's own
 * magnification between those frames at 1.89x: the big slide numeral
 * grew 79px to 149px (1.886) and the card's border stroke 5.0px to
 * 9.5px (1.90). The cursor's outline grew 56.5px to 99px, which is
 * 1.75x. Constant size would have been 1.00x, so it is not that. It
 * scales with the frame, and that is what `cursorLayerKeyframes` emits.
 *
 * The residual is worth writing down rather than fitting: 1.75 is 93%
 * of 1.89, so either the reference damps the growth slightly or one of
 * the two single-frame cursor samples caught it mid-animation. Two
 * points cannot tell those apart, and the difference at our deepest
 * zoom is under 15% of the icon's size, so this scales it fully and
 * says so out loud.
 */

import type { Easing, KeyframePoint, ShapeStyle, AnimatableProperty } from '../types/edl';
import type { CursorSample } from '../types/electron';
import type { ZoomKeyframe } from './cursorZoom';
import { interpolateKeyframes } from './keyframeMath';
import { SHAPE_BASE } from './cinematicLook';

/* ── The icon ───────────────────────────────────────────────────── */

/**
 * The dart, as SVG path data in the 0..100 box `traceShape` authors in.
 *
 * Four vertices, traced off the t=440 frame where the icon is 99px
 * across and every edge is several pixels wide:
 *
 *     tip    (9, 9)     the hotspot, pointing up and to the left
 *     wing   (94, 42)   the rightmost point
 *     notch  (57, 64)   the reflex vertex, where the two facets meet
 *     tail   (38, 93)   the bottommost point
 *
 * The measured outer boundary of the drawn icon ran corner to corner of
 * its box; these sit inset from it by half the stroke, which is what
 * puts the STROKED result back on the box.
 *
 * The corners are sharp here and rounded by the stroke's round join,
 * which is how the reference's are rounded too. That matters for the
 * tip: at a 45 degree point a miter join would throw a spike two and a
 * half stroke-widths past it, which is why `traceShape` now sets
 * `lineJoin` for path shapes the way it always did for built-in ones.
 */
export const PLANE_PATH = 'M9 9 L94 42 L57 64 L38 93 Z';

/**
 * Where the point actually is, in path units.
 *
 * NOT vertex (9, 9). The stroke is 9 units wide and centred, so the
 * round join at the tip bulges half a stroke past the vertex along the
 * bisector, and the pixel a user would call "the tip" is that bulge.
 * `9 - 4.5/sqrt(2)` is 5.8. Getting this wrong offsets every click in
 * the film by 3% of the icon, which is small and reads as sloppy.
 */
export const PLANE_HOTSPOT = 5.8;

/** Sampled directly off the t=440 frame, one pixel per part. */
export const PLANE_OUTLINE = '#222448';
export const PLANE_TEAL = '#5E9FB6';
export const PLANE_MINT = '#86D5A8';
export const PLANE_SPECULAR = '#F4FFFA';

/**
 * Where the crease falls along the gradient axis.
 *
 * The icon is two facets split by a crease running tip to notch, and
 * one linear gradient can hold that exactly, because a line through
 * two points is a constant position along the axis PERPENDICULAR to it.
 * Tip to notch is (48, 55), so 48.9 degrees, so the axis is -41.1 and
 * both ends of the crease land on 0.461 of it. The pair of stops either
 * side of that is the crease; it is a hard step rather than a ramp
 * because in the reference it is a hard step.
 *
 * Past the crease the mint facet ramps to near-white toward the wing,
 * which is the specular the analysis doc describes as "reads as a
 * gradient toward the tip edge". It is a real band about 11px wide at
 * 99px icon size, not a hairline.
 */
export const PLANE_GRADIENT_ANGLE = -41;
const CREASE_AT = 0.461;
/** Half the width of the hard step, in axis units. Two frames of ramp. */
const CREASE_STEP = 0.009;

/** The stroke, in path units, so 9% of the icon. Measured at 10/99. */
export const PLANE_STROKE_WIDTH = 9;

/**
 * The icon's box as a percentage of the PICTURE's on-screen height.
 *
 * Not of the canvas: the picture is inset on a backdrop and the cursor
 * belongs to the picture, so a take framed at `insetPct` 88 and one at
 * 100 must draw the same size cursor relative to the content under it.
 *
 * 6.0 is measured. The reference's icon was 56.5px of outline in a
 * picture 1009px tall, which is 5.6%, and the stroked path fills about
 * 94% of its own box, so the BOX is 6.0%. That is roughly two and a
 * half times a system arrow, which is the point.
 */
export const CURSOR_SIZE_PCT = 6.0;

/**
 * The drop shadow, as fractions of the icon's resting size.
 *
 * Down and to the LEFT, which corrects the analysis doc: it says below
 * and right, and the darkest non-shape pixels around the icon are
 * `#C6C5CE` hugging the lower-LEFT edge while directly below the tail
 * is `#FDFDFD`. Down-left is also the only reading consistent with the
 * specular, which is on the upper right: one light, upper right, so one
 * shadow, lower left.
 *
 * These are fractions here and absolute canvas pixels in `ShapeStyle`,
 * because `ctx.shadowBlur` and `ctx.shadowOffset*` are explicitly NOT
 * transformed by the CTM. So the shadow cannot scale with the zoom the
 * way the icon does, and `cursorPlaneStyle` takes the RESTING size and
 * sizes the shadow for that. On a deep zoom the shadow is therefore
 * relatively tighter than the reference's. It is a soft grey edge on a
 * small object and nobody will find it; a keyframable shadow is the fix
 * and it is not worth one on its own.
 */
const SHADOW_BLUR = 0.10;
const SHADOW_OFFSET_X = -0.02;
const SHADOW_OFFSET_Y = 0.035;
const SHADOW_COLOR = 'rgba(34, 36, 72, 0.30)';

/**
 * The icon's style, sized for a given resting box in canvas pixels.
 *
 * `fill` is set as well as `gradient` and is not dead: it is what a
 * renderer that cannot do gradient fills on a path draws, which is what
 * ours did until this landed, and the teal facet is the better half to
 * fall back to because it is the larger one.
 */
export function cursorPlaneStyle(restSizePx: number): Partial<ShapeStyle> {
  const size = Math.max(1, restSizePx);
  return {
    kind: 'path',
    pathData: PLANE_PATH,
    fill: PLANE_TEAL,
    stroke: PLANE_OUTLINE,
    strokeWidth: PLANE_STROKE_WIDTH,
    gradient: {
      from: PLANE_TEAL,
      to: PLANE_SPECULAR,
      angle: PLANE_GRADIENT_ANGLE,
      stops: [
        { color: PLANE_TEAL, at: CREASE_AT - CREASE_STEP },
        { color: PLANE_MINT, at: CREASE_AT + CREASE_STEP },
      ],
    },
    shadow: {
      color: SHADOW_COLOR,
      blur: Math.round(size * SHADOW_BLUR),
      offsetX: Math.round(size * SHADOW_OFFSET_X),
      offsetY: Math.round(size * SHADOW_OFFSET_Y),
    },
  };
}

/* ── Placing it ─────────────────────────────────────────────────── */

export interface CursorLayerGeometry {
  /** The screen clip's content size at scale 1, from `getClipBaseSize`. */
  baseWidth: number;
  baseHeight: number;
  /** The scale the screen clip rests at. The same number the zoom is built on. */
  restScale: number;
  canvasWidth: number;
  canvasHeight: number;
}

/** A span where the screen is not on camera, so neither is its cursor. */
export interface HiddenSpan {
  startMs: number;
  endMs: number;
}

export interface CursorLayerOptions {
  /** The icon's box as a percentage of the picture's height. */
  sizePct: number;
  /**
   * How far the cursor may stray from the emitted path before a sample
   * is kept, as a fraction of the picture.
   *
   * 0.0015 and it is chosen against the ZOOM, not against the picture:
   * an error of 0.15% of the content is 0.4% of the canvas once the
   * frame is pushed in 2.8x, which is about 4px at 1080p and under a
   * tenth of the icon. Ten times looser is visible as the cursor
   * cutting corners.
   */
  tolerance: number;
  /**
   * Ceiling on kept samples, before the tolerance is loosened to fit.
   *
   * A 30Hz track is 1800 samples a minute and four properties, so a
   * ten minute take asks for 288,000 keyframes if nothing decimates it.
   * The editor stays usable at a few thousand.
   */
  maxSamples: number;
  /** Spans to fade the cursor out over, e.g. camera takeovers. */
  hiddenSpans: HiddenSpan[];
  /** How long the fade at a hidden span's edge takes. */
  fadeMs: number;
}

export const DEFAULT_CURSOR_LAYER: CursorLayerOptions = {
  sizePct: CURSOR_SIZE_PCT,
  tolerance: 0.0015,
  maxSamples: 900,
  hiddenSpans: [],
  fadeMs: 320,
};

export interface CursorLayerKeyframe {
  property: 'positionX' | 'positionY' | 'scaleX' | 'scaleY' | 'opacity';
  timeOffsetMs: number;
  value: number;
  easing: Easing;
  bezierPoints?: [number, number, number, number];
}

/**
 * Ramer-Douglas-Peucker over one time series, returning kept indices.
 *
 * Run per AXIS rather than once over the 2D path, and the difference is
 * not cosmetic: a 2D simplification of the polyline collapses a pause,
 * because a cursor that sits still for two seconds contributes a
 * hundred coincident points and no deviation. Run over the graph of
 * x(t) and again over y(t), the pause is a long flat run whose
 * endpoints are both corners, so it survives, and a pause is exactly
 * what tells the viewer the pointer has arrived at the thing.
 */
function simplify(
  values: number[],
  times: number[],
  tolerance: number,
  keep: Set<number>
): void {
  if (values.length < 3) {
    for (let i = 0; i < values.length; i++) keep.add(i);
    return;
  }

  keep.add(0);
  keep.add(values.length - 1);

  /* Explicit stack rather than recursion: a 30Hz hour is 108,000 points
     and a degenerate split pattern would blow the call stack. */
  const stack: [number, number][] = [[0, values.length - 1]];

  while (stack.length > 0) {
    const [from, to] = stack.pop()!;
    if (to - from < 2) continue;

    const spanMs = times[to] - times[from];
    const spanValue = values[to] - values[from];
    let worst = -1;
    let worstAt = -1;

    for (let i = from + 1; i < to; i++) {
      /* Vertical distance in VALUE, not perpendicular distance in a
         mixed time-value plane, which would need the two axes to share
         a unit and they do not. */
      const at = spanMs === 0 ? 0 : (times[i] - times[from]) / spanMs;
      const error = Math.abs(values[i] - (values[from] + spanValue * at));
      if (error > worst) {
        worst = error;
        worstAt = i;
      }
    }

    if (worst > tolerance && worstAt > from) {
      keep.add(worstAt);
      stack.push([from, worstAt], [worstAt, to]);
    }
  }
}

/** The screen clip's transform at a moment, mirroring the renderer exactly. */
function screenTransformAt(
  keyframes: KeyframePoint[],
  tMs: number,
  geometry: CursorLayerGeometry
): { scale: number; x: number; y: number } {
  return {
    scale: interpolateKeyframes(keyframes, 'scaleX', tMs, geometry.restScale),
    x: interpolateKeyframes(keyframes, 'positionX', tMs, 0),
    y: interpolateKeyframes(keyframes, 'positionY', tMs, 0),
  };
}

/**
 * `ZoomKeyframe[]` as the renderer sees it, so the cursor is placed by
 * the same arithmetic that will draw the frame under it.
 *
 * Reusing `interpolateKeyframes` rather than reimplementing the lerp is
 * the whole point: its two edge rules are load-bearing here and neither
 * is the obvious guess. Before the first keyframe it HOLDS the first
 * one's value rather than falling back to the clip's own transform, and
 * the easing that governs a span belongs to the keyframe at its START.
 */
function asKeyframePoints(zoom: ZoomKeyframe[]): KeyframePoint[] {
  return zoom.map((k, i) => ({
    id: `zk_${i}`,
    property: k.property as AnimatableProperty,
    timeOffsetMs: k.timeOffsetMs,
    value: k.value,
    easing: k.easing,
    ...(k.bezierPoints ? { bezierPoints: k.bezierPoints } : {}),
  }));
}

/**
 * Every keyframe the cursor layer needs.
 *
 * ── Why the zoom's own keyframe times are forced into the output ────
 *
 * A cursor sitting still while the frame pushes in is not sitting still
 * ON THE CANVAS: it travels, because the content under it does. That
 * travel has to be drawn on the same curve as the push or the pointer
 * visibly slides against the pixels it is pointing at, which is the one
 * artefact that would make this feature read as broken.
 *
 * It comes out exact, and cheaply. The canvas position of a content
 * point is
 *
 *     cx = canvasW/2 + offsetX + baseW * scale * (px - 0.5)
 *
 * and during a zoom span `offsetX` and `scale` are both the same eased
 * fraction of the way between their endpoints. So for a stationary
 * cursor `cx` is AFFINE in that fraction, and one keyframe at each end
 * of the span carrying the span's own easing reproduces the curve
 * exactly rather than approximating it. For a cursor that is moving as
 * well the two curves multiply and it is an approximation, but a
 * second-order one over at most a few hundred milliseconds.
 */
export function cursorLayerKeyframes(
  cursor: CursorSample[],
  zoom: ZoomKeyframe[],
  durationMs: number,
  geometry: CursorLayerGeometry,
  options: Partial<CursorLayerOptions> = {}
): CursorLayerKeyframe[] {
  const o = { ...DEFAULT_CURSOR_LAYER, ...options };
  if (cursor.length === 0) return [];

  /* In take time, ascending, and inside the film. The recorder samples
     in order, but a take assembled from a paused session has had time
     removed from under it, so this does not assume it. */
  const samples = cursor
    .filter((s) => Number.isFinite(s.tMs) && Number.isFinite(s.x) && Number.isFinite(s.y))
    .filter((s) => s.tMs >= 0 && s.tMs <= durationMs)
    .sort((a, b) => a.tMs - b.tMs);
  if (samples.length === 0) return [];

  const times = samples.map((s) => s.tMs);
  const xs = samples.map((s) => s.x);
  const ys = samples.map((s) => s.y);

  /* Loosen rather than truncate. Truncating at a budget would draw the
     first N seconds of pointer and then a cursor frozen for the rest of
     the film, which is worse than a slightly loose path throughout. */
  let tolerance = Math.max(1e-6, o.tolerance);
  let keep = new Set<number>();
  for (let attempt = 0; attempt < 12; attempt++) {
    keep = new Set<number>();
    simplify(xs, times, tolerance, keep);
    simplify(ys, times, tolerance, keep);
    if (keep.size <= o.maxSamples) break;
    tolerance *= 2;
  }

  const kept = [...keep].sort((a, b) => a - b);
  const points = asKeyframePoints(zoom);

  /* The zoom's keyframe times, as sample-shaped entries carrying the
     easing of the span they open. A time that already has a kept sample
     keeps the sample's position and gains the span's easing. */
  const atTime = new Map<number, { x: number; y: number; easing?: Easing; bezier?: [number, number, number, number] }>();

  const lerpAt = (tMs: number): { x: number; y: number } => {
    if (tMs <= times[0]) return { x: xs[0], y: ys[0] };
    const last = times.length - 1;
    if (tMs >= times[last]) return { x: xs[last], y: ys[last] };
    let hi = 1;
    while (hi < last && times[hi] < tMs) hi++;
    const lo = hi - 1;
    const span = times[hi] - times[lo];
    const f = span <= 0 ? 0 : (tMs - times[lo]) / span;
    return { x: xs[lo] + (xs[hi] - xs[lo]) * f, y: ys[lo] + (ys[hi] - ys[lo]) * f };
  };

  for (const i of kept) {
    atTime.set(Math.round(times[i]), { x: xs[i], y: ys[i] });
  }

  for (const k of zoom) {
    if (k.property !== 'scaleX') continue;
    const at = Math.round(k.timeOffsetMs);
    if (at < 0 || at > durationMs) continue;
    const existing = atTime.get(at);
    const position = existing ?? lerpAt(at);
    atTime.set(at, {
      x: position.x,
      y: position.y,
      easing: k.easing,
      ...(k.bezierPoints ? { bezier: k.bezierPoints } : {}),
    });
  }

  const out: CursorLayerKeyframe[] = [];
  const stamps = [...atTime.keys()].sort((a, b) => a - b);

  for (const at of stamps) {
    const entry = atTime.get(at)!;
    const frame = screenTransformAt(points, at, geometry);
    const pictureW = geometry.baseWidth * frame.scale;
    const pictureH = geometry.baseHeight * frame.scale;

    /* The box, then the layer scale that gets it. A shape layer is
       `SHAPE_BASE` square whatever its style, so the scale is the box
       over that and never over the path's own 0..100. */
    const boxPx = (o.sizePct / 100) * pictureH;
    const layerScale = boxPx / SHAPE_BASE;

    /* Content point to canvas, then hotspot to layer centre. The tip is
       at `PLANE_HOTSPOT` of the way across a box drawn centred on the
       layer's position, so the layer sits half a box minus that further
       down and right than the point it is aiming at. */
    const tipX = geometry.canvasWidth / 2 + frame.x + pictureW * (entry.x - 0.5);
    const tipY = geometry.canvasHeight / 2 + frame.y + pictureH * (entry.y - 0.5);
    const centreOffset = ((50 - PLANE_HOTSPOT) / 100) * boxPx;

    const shared = {
      timeOffsetMs: at,
      easing: entry.easing ?? ('linear' as Easing),
      ...(entry.bezier ? { bezierPoints: entry.bezier } : {}),
    };

    out.push({
      property: 'positionX',
      value: tipX + centreOffset - geometry.canvasWidth / 2,
      ...shared,
    });
    out.push({
      property: 'positionY',
      value: tipY + centreOffset - geometry.canvasHeight / 2,
      ...shared,
    });
    out.push({ property: 'scaleX', value: layerScale, ...shared });
    out.push({ property: 'scaleY', value: layerScale, ...shared });
  }

  /* ── Hiding it ─────────────────────────────────────────────────── */

  /*
    A camera takeover fills the frame with the speaker's face, and a
    pointer floating over a face is the single most obviously wrong
    thing this feature could draw. `removeActivityFromTakeovers` has
    already guaranteed the pointer is not MOVING during one, which is
    why this is a fade rather than a cut: there is nothing to see going,
    so it may as well go softly.
  */
  const fade = Math.max(1, o.fadeMs);

  /*
    Merged first, and closer than TWO fades counts as touching.

    Emitting a fade per span independently is wrong in a way that only
    shows up with takeovers close together, which is exactly what a take
    with several pauses in a row produces: the first span's fade back in
    lands inside the second span, so the pointer flashes on over the
    face for a fifth of a second between two shots that were supposed to
    be one continuous look at the speaker. There is nothing to reveal in
    a gap shorter than the fades either side of it, so there is no gap.
  */
  const spans: HiddenSpan[] = [];
  for (const span of o.hiddenSpans
    .filter((s) => s.endMs > s.startMs)
    .sort((a, b) => a.startMs - b.startMs)) {
    const last = spans[spans.length - 1];
    if (last && span.startMs - last.endMs < fade * 2) {
      last.endMs = Math.max(last.endMs, span.endMs);
    } else {
      spans.push({ startMs: span.startMs, endMs: span.endMs });
    }
  }

  if (spans.length > 0) {
    const opacity: CursorLayerKeyframe[] = [];
    const at = (tMs: number, value: number) => {
      opacity.push({
        property: 'opacity',
        timeOffsetMs: Math.max(0, Math.min(Math.round(durationMs), Math.round(tMs))),
        value,
        easing: 'easeInOut',
      });
    };

    /* An explicit 1 at time 0, because `interpolateKeyframes` holds the
       FIRST keyframe's value backwards. Without it a takeover starting
       at 4s would hold its own leading 1, which is right by luck, and a
       take that opens on the face holds a 0 over the whole opening,
       which is not. */
    at(0, 1);
    for (const span of spans) {
      at(span.startMs - fade, 1);
      at(span.startMs, 0);
      at(span.endMs, 0);
      at(span.endMs + fade, 1);
    }

    /* Hidden wins on a tie. A film that opens on the face clamps its
       own leading fade back to zero, so stamp 0 is asked for both a 1
       and a 0, and the 0 is the true one. */
    const byTime = new Map<number, CursorLayerKeyframe>();
    for (const k of opacity.sort((a, b) => a.timeOffsetMs - b.timeOffsetMs)) {
      const prior = byTime.get(k.timeOffsetMs);
      byTime.set(k.timeOffsetMs, prior && prior.value < k.value ? prior : k);
    }
    out.push(...[...byTime.values()].sort((a, b) => a.timeOffsetMs - b.timeOffsetMs));
  }

  return out;
}
