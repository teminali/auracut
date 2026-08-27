/* ═══════════════════════════════════════════════════════════════════
   Keyframe interpolation & speed-ramp maths.
   Pure functions only — called on every rendered frame, so keep it fast.
   ═══════════════════════════════════════════════════════════════════ */

import { KeyframePoint, AnimatableProperty, Easing, SpeedCurvePreset, SpeedCurvePoint } from '../types/edl';

/* ── Cubic bezier easing ────────────────────────────────────────── */

/**
 * Solve a CSS-style cubic-bezier(p1x, p1y, p2x, p2y) for progress `t`.
 * Newton-Raphson with a bisection fallback for the flat regions where the
 * derivative collapses and Newton would stall.
 */
export function solveCubicBezier(p1x: number, p1y: number, p2x: number, p2y: number, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;

  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;

  const sampleX = (v: number) => ((ax * v + bx) * v + cx) * v;
  const sampleY = (v: number) => ((ay * v + by) * v + cy) * v;
  const sampleDX = (v: number) => (3 * ax * v + 2 * bx) * v + cx;

  let guess = t;
  for (let i = 0; i < 8; i++) {
    const x = sampleX(guess) - t;
    if (Math.abs(x) < 1e-5) return sampleY(guess);
    const d = sampleDX(guess);
    if (Math.abs(d) < 1e-6) break;
    guess -= x / d;
  }

  // Newton stalled — bisect, which always converges on a monotonic curve.
  let lo = 0;
  let hi = 1;
  guess = t;
  for (let i = 0; i < 20; i++) {
    const x = sampleX(guess);
    if (Math.abs(x - t) < 1e-5) break;
    if (x > t) hi = guess;
    else lo = guess;
    guess = (hi + lo) / 2;
  }

  return sampleY(guess);
}

/**
 * Control points for the easings that ARE cubic Béziers.
 *
 * This used to carry a row for every named easing and say it was
 * "exposed so the UI can preview the exact curve". It was not. Three of
 * the five rows were the CSS curves of the same NAME and not the curves
 * `applyEasing` computes: `easeIn` here was [0.42, 0, 1, 1] while
 * `applyEasing('easeIn')` is `t * t`, which at t=0.5 is 0.25 against the
 * bezier's 0.315. Nothing outside this module read them, so nothing
 * rendered wrong — but the first person to build that preview would have
 * drawn the wrong curve and had no reason to doubt it.
 *
 * So the table now holds only the rows that are true: `linear`, which is
 * the identity either way, and `bezier`, whose points are the actual
 * default `applyEasing` falls back to. The polynomial easings are not
 * here BECAUSE they are not Béziers, and a UI wanting their shape should
 * sample `applyEasing` — which is what `EasingPreview` already does.
 */
export const EASING_BEZIERS: Record<'linear' | 'bezier', [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  bezier: [0.25, 0.1, 0.25, 1],
};

/** Map linear progress through an easing function. */
export function applyEasing(t: number, easing: Easing, bezier?: [number, number, number, number]): number {
  switch (easing) {
    case 'hold':
      return 0;
    case 'linear':
      return t;
    case 'easeIn':
      return t * t;
    case 'easeOut':
      return 1 - (1 - t) * (1 - t);
    case 'easeInOut':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'bezier': {
      const [a, b, c, d] = bezier ?? EASING_BEZIERS.bezier;
      return solveCubicBezier(a, b, c, d, t);
    }
    default:
      return t;
  }
}

/* ── Interpolation ──────────────────────────────────────────────── */

/**
 * Value of `property` at `currentOffsetMs` (relative to the clip's start).
 * Falls back to `defaultValue` when the property has no keyframes.
 *
 * Runs per clip per property per frame, so the common "no keyframes" case
 * exits after a single pass with no allocation.
 */
export function interpolateKeyframes(
  keyframes: KeyframePoint[],
  property: AnimatableProperty,
  currentOffsetMs: number,
  defaultValue: number
): number {
  if (keyframes.length === 0) return defaultValue;

  // Single pass: locate the bracketing pair without building an array.
  let before: KeyframePoint | null = null;
  let after: KeyframePoint | null = null;
  let count = 0;

  for (let i = 0; i < keyframes.length; i++) {
    const k = keyframes[i];
    if (k.property !== property) continue;
    count++;

    if (k.timeOffsetMs <= currentOffsetMs) {
      if (!before || k.timeOffsetMs > before.timeOffsetMs) before = k;
    }
    if (k.timeOffsetMs >= currentOffsetMs) {
      if (!after || k.timeOffsetMs < after.timeOffsetMs) after = k;
    }
  }

  if (count === 0) return defaultValue;
  if (!before) return after!.value;   // before the first key. Hold it
  if (!after) return before.value;    // after the last key. Hold it
  if (before === after) return before.value;

  const span = after.timeOffsetMs - before.timeOffsetMs;
  if (span <= 0) return after.value;

  const t = (currentOffsetMs - before.timeOffsetMs) / span;
  const eased = applyEasing(t, before.easing, before.bezierPoints);

  return before.value + (after.value - before.value) * eased;
}

/** Every distinct property that has at least one keyframe on this clip. */
export function getAnimatedProperties(keyframes: KeyframePoint[]): AnimatableProperty[] {
  const seen = new Set<AnimatableProperty>();
  for (const k of keyframes) seen.add(k.property);
  return [...seen];
}

/** Keyframes for one property, in time order. */
export function keyframesFor(keyframes: KeyframePoint[], property: AnimatableProperty): KeyframePoint[] {
  return keyframes.filter((k) => k.property === property).sort((a, b) => a.timeOffsetMs - b.timeOffsetMs);
}

/** The keyframe sitting exactly at `offsetMs` (within one frame), if any. */
export function keyframeAt(
  keyframes: KeyframePoint[],
  property: AnimatableProperty,
  offsetMs: number,
  toleranceMs = 34
): KeyframePoint | undefined {
  return keyframes.find((k) => k.property === property && Math.abs(k.timeOffsetMs - offsetMs) <= toleranceMs);
}

/* ── Speed ramps ────────────────────────────────────────────────── */

/** Control points for each built-in ramp, so the editor can show and edit them. */
export const SPEED_CURVE_PRESETS: Record<Exclude<SpeedCurvePreset, 'custom'>, SpeedCurvePoint[]> = {
  linear: [
    { timePct: 0, speedMult: 1 },
    { timePct: 1, speedMult: 1 },
  ],
  montage: [
    { timePct: 0, speedMult: 2.5 },
    { timePct: 0.3, speedMult: 0.6 },
    { timePct: 0.7, speedMult: 0.8 },
    { timePct: 1, speedMult: 2.6 },
  ],
  hero: [
    { timePct: 0, speedMult: 1 },
    { timePct: 0.25, speedMult: 0.35 },
    { timePct: 0.6, speedMult: 0.35 },
    { timePct: 1, speedMult: 1.8 },
  ],
  bullet_time: [
    { timePct: 0, speedMult: 1 },
    { timePct: 0.35, speedMult: 1 },
    { timePct: 0.4, speedMult: 0.15 },
    { timePct: 0.62, speedMult: 0.15 },
    { timePct: 0.68, speedMult: 1.6 },
    { timePct: 1, speedMult: 1.6 },
  ],
  jump_cut: [
    { timePct: 0, speedMult: 1 },
    { timePct: 0.45, speedMult: 1 },
    { timePct: 0.5, speedMult: 6 },
    { timePct: 0.55, speedMult: 1 },
    { timePct: 1, speedMult: 1 },
  ],
  flash_in: [
    { timePct: 0, speedMult: 4 },
    { timePct: 1, speedMult: 1 },
  ],
  flash_out: [
    { timePct: 0, speedMult: 1 },
    { timePct: 1, speedMult: 4 },
  ],
};

/** Resolve the control points a clip's speed setting is currently using. */
export function resolveSpeedPoints(
  preset: SpeedCurvePreset,
  customPoints?: SpeedCurvePoint[]
): SpeedCurvePoint[] {
  if (preset === 'custom') {
    return customPoints && customPoints.length >= 2
      ? [...customPoints].sort((a, b) => a.timePct - b.timePct)
      : SPEED_CURVE_PRESETS.linear;
  }
  return SPEED_CURVE_PRESETS[preset] ?? SPEED_CURVE_PRESETS.linear;
}

/** Playback rate at `progress` (0..1) through the clip. */
export function getSpeedCurveMultiplier(
  preset: SpeedCurvePreset,
  progress: number,
  customPoints?: SpeedCurvePoint[]
): number {
  const points = resolveSpeedPoints(preset, customPoints);
  const p = Math.max(0, Math.min(1, progress));

  if (p <= points[0].timePct) return points[0].speedMult;
  const last = points[points.length - 1];
  if (p >= last.timePct) return last.speedMult;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (p >= a.timePct && p <= b.timePct) {
      const span = b.timePct - a.timePct;
      if (span <= 0) return b.speedMult;
      const t = (p - a.timePct) / span;
      // Smoothstep keeps ramps from snapping between control points.
      const eased = t * t * (3 - 2 * t);
      return a.speedMult + (b.speedMult - a.speedMult) * eased;
    }
  }

  return 1;
}

/**
 * How far into the SOURCE media we are at `progress` through the clip,
 * as a 0..1 fraction. Integrates the ramp so a slow-mo section actually
 * consumes less source than a sped-up one.
 */
export function getSourceProgress(
  preset: SpeedCurvePreset,
  progress: number,
  customPoints?: SpeedCurvePoint[],
  steps = 64
): number {
  if (preset === 'linear') return progress;

  const step = 1 / steps;
  let consumed = 0;
  let total = 0;
  const target = Math.max(0, Math.min(1, progress));

  for (let i = 0; i < steps; i++) {
    const at = (i + 0.5) * step;
    const rate = getSpeedCurveMultiplier(preset, at, customPoints);
    total += rate * step;
    if (at <= target) consumed += rate * step;
  }

  return total > 0 ? consumed / total : progress;
}
