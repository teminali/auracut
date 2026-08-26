/* ═══════════════════════════════════════════════════════════════════
   keyframeMath — interpolation, easing, keyframe lookup, speed ramps.

   The rule this file follows: every number it asserts is derived from
   something other than the function under test. The bezier solver is
   checked against a plain bisection written here; the ramps are checked
   against the physical statement they encode ("a section played at 4x
   eats more source than one at 1x"); the interpolator is checked against
   `a + (b-a)*t` computed by hand.

   Where a tolerance appears, there is a sibling assertion showing the
   tolerance rejects a wrong answer. A threshold nobody has tried to fail
   is not a threshold.
   ═══════════════════════════════════════════════════════════════════ */

import { describe, it, expect } from 'vitest';
import {
  solveCubicBezier,
  EASING_BEZIERS,
  applyEasing,
  interpolateKeyframes,
  getAnimatedProperties,
  keyframesFor,
  keyframeAt,
  SPEED_CURVE_PRESETS,
  resolveSpeedPoints,
  getSpeedCurveMultiplier,
  getSourceProgress,
} from './keyframeMath';
import { KeyframePoint, AnimatableProperty, Easing } from '../types/edl';

/* ── Ground truth ───────────────────────────────────────────────── */

/**
 * Independent cubic-bezier solver: pure bisection on x, no Newton, no
 * shared code with the implementation. Slow and obviously correct, which
 * is exactly what a reference is for.
 */
function refBezier(p1x: number, p1y: number, p2x: number, p2y: number, t: number): number {
  const bez = (a: number, b: number, v: number) =>
    3 * a * (1 - v) * (1 - v) * v + 3 * b * (1 - v) * v * v + v * v * v;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (bez(p1x, p2x, mid) < t) lo = mid;
    else hi = mid;
  }
  return bez(p1y, p2y, (lo + hi) / 2);
}

let kfSeq = 0;
const kf = (
  property: AnimatableProperty,
  timeOffsetMs: number,
  value: number,
  easing: Easing = 'linear',
  bezierPoints?: [number, number, number, number]
): KeyframePoint => ({
  id: `k${kfSeq++}`,
  property,
  timeOffsetMs,
  value,
  easing,
  ...(bezierPoints ? { bezierPoints } : {}),
});

/* ── solveCubicBezier ───────────────────────────────────────────── */

describe('solveCubicBezier', () => {
  it('is the identity for the linear control points', () => {
    /*
      x(v) and y(v) are the same polynomial when p1y == p1x and
      p2y == p2x, so y-as-a-function-of-x is exactly t.

      Asserted to 4 decimals and deliberately not tighter: Newton stops
      at |x - t| < 1e-5, so ~1e-5 of slop in the answer is the solver
      working as written. Demanding 5 decimals here fails at t = 0.1 by
      8.7e-6 — which is the test being wrong about the contract, not the
      solver being wrong.
    */
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      expect(solveCubicBezier(0, 0, 1, 1, t)).toBeCloseTo(t, 4);
    }
  });

  it('pins the endpoints exactly', () => {
    expect(solveCubicBezier(0.42, 0, 0.58, 1, 0)).toBe(0);
    expect(solveCubicBezier(0.42, 0, 0.58, 1, 1)).toBe(1);
    // Out of range too — callers clamp, but the solver must not extrapolate.
    expect(solveCubicBezier(0.42, 0, 0.58, 1, -0.5)).toBe(0);
    expect(solveCubicBezier(0.42, 0, 0.58, 1, 1.5)).toBe(1);
  });

  it('matches an independent bisection solver across the CSS presets', () => {
    const curves: [number, number, number, number][] = [
      [0.42, 0, 1, 1],
      [0, 0, 0.58, 1],
      [0.42, 0, 0.58, 1],
      [0.25, 0.1, 0.25, 1],
      [0.68, -0.55, 0.265, 1.55], // overshoots on both ends
    ];
    for (const [a, b, c, d] of curves) {
      for (let i = 1; i < 20; i++) {
        const t = i / 20;
        expect(solveCubicBezier(a, b, c, d, t)).toBeCloseTo(refBezier(a, b, c, d, t), 4);
      }
    }
  });

  it('still solves where Newton stalls, so the bisection fallback is real', () => {
    /*
      cubic-bezier(1, 0, 0, 1) has dx/dt = 3(2v-1)^2, which is zero at
      v = 0.5. Newton's step blows up near there and the guess walks out
      of [0,1]; only the bisection fallback brings it back. t = 0.4 lands
      the first Newton step at -0.4, so this input exercises that path.
    */
    for (const t of [0.35, 0.4, 0.45, 0.55, 0.6]) {
      expect(solveCubicBezier(1, 0, 0, 1, t)).toBeCloseTo(refBezier(1, 0, 0, 1, t), 4);
    }
  });

  it('4-decimal agreement is a real constraint, not a free pass', () => {
    // Negative control: the same tolerance must reject the WRONG curve.
    const t = 0.3;
    expect(
      Math.abs(solveCubicBezier(0.42, 0, 0.58, 1, t) - refBezier(0.25, 0.1, 0.25, 1, t))
    ).toBeGreaterThan(1e-4);
  });

  it('is monotonic non-decreasing on a monotonic curve', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const v = solveCubicBezier(0.42, 0, 0.58, 1, i / 100);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
});

/* ── applyEasing ────────────────────────────────────────────────── */

describe('applyEasing', () => {
  const NAMED: Easing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'bezier'];

  it('maps 0 to 0 and 1 to 1 for every named curve', () => {
    for (const e of NAMED) {
      expect(applyEasing(0, e)).toBeCloseTo(0, 6);
      expect(applyEasing(1, e)).toBeCloseTo(1, 6);
    }
  });

  it('holds at zero for the whole span when easing is `hold`', () => {
    // `hold` returns 0 even at t = 1: the value only changes when the
    // NEXT keyframe becomes the `before` key. That is what makes a step.
    for (const t of [0, 0.25, 0.5, 0.75, 1]) expect(applyEasing(t, 'hold')).toBe(0);
  });

  it('is monotonic non-decreasing for every named curve', () => {
    for (const e of NAMED) {
      let prev = -Infinity;
      for (let i = 0; i <= 50; i++) {
        const v = applyEasing(i / 50, e);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
  });

  it('easeIn starts slow and easeOut starts fast, relative to linear', () => {
    // The defining property of each name, asserted rather than assumed.
    expect(applyEasing(0.25, 'easeIn')).toBeLessThan(0.25);
    expect(applyEasing(0.25, 'easeOut')).toBeGreaterThan(0.25);
    expect(applyEasing(0.75, 'easeIn')).toBeLessThan(0.75);
    expect(applyEasing(0.75, 'easeOut')).toBeGreaterThan(0.75);
  });

  it('easeInOut is point-symmetric about (0.5, 0.5)', () => {
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      expect(applyEasing(t, 'easeInOut') + applyEasing(1 - t, 'easeInOut')).toBeCloseTo(1, 6);
    }
  });

  it('routes `bezier` through the solver, honouring custom control points', () => {
    const pts: [number, number, number, number] = [0.68, 0, 0.32, 1];
    expect(applyEasing(0.37, 'bezier', pts)).toBeCloseTo(solveCubicBezier(...pts, 0.37), 9);
    // No points supplied falls back to the table entry, not to linear.
    expect(applyEasing(0.37, 'bezier')).toBeCloseTo(
      solveCubicBezier(...EASING_BEZIERS.bezier, 0.37),
      9
    );
    expect(applyEasing(0.37, 'bezier')).not.toBeCloseTo(0.37, 3);
  });

  it('EASING_BEZIERS does NOT describe the named curves applyEasing uses', () => {
    /*
      Recorded, not asserted as correct. `EASING_BEZIERS.easeIn` is the
      CSS ease-in bezier; `applyEasing('easeIn')` is t*t. They are
      different curves, and only the `bezier` entry is actually consumed
      (as the default control points). Nothing outside this module reads
      the table, so nothing is currently wrong on screen — the header
      comment claiming the UI previews from it is stale, and anyone who
      starts using it for a preview will draw the wrong curve.
    */
    const t = 0.5;
    expect(applyEasing(t, 'easeIn')).toBeCloseTo(0.25, 9);
    expect(solveCubicBezier(...EASING_BEZIERS.easeIn, t)).not.toBeCloseTo(0.25, 2);
    // The linear row is the one that does agree.
    expect(solveCubicBezier(...EASING_BEZIERS.linear, t)).toBeCloseTo(applyEasing(t, 'linear'), 5);
  });
});

/* ── interpolateKeyframes ───────────────────────────────────────── */

describe('interpolateKeyframes', () => {
  it('returns the default when there are no keyframes at all', () => {
    expect(interpolateKeyframes([], 'opacity', 500, 0.42)).toBe(0.42);
  });

  it('returns the default when no keyframe targets this property', () => {
    const keys = [kf('positionX', 0, 10), kf('positionX', 1000, 90)];
    expect(interpolateKeyframes(keys, 'opacity', 500, 0.42)).toBe(0.42);
  });

  it('holds the first value before the first key and the last after the last', () => {
    const keys = [kf('scaleX', 1000, 2), kf('scaleX', 2000, 4)];
    expect(interpolateKeyframes(keys, 'scaleX', 0, 99)).toBe(2);
    expect(interpolateKeyframes(keys, 'scaleX', 999, 99)).toBe(2);
    expect(interpolateKeyframes(keys, 'scaleX', 2001, 99)).toBe(4);
    expect(interpolateKeyframes(keys, 'scaleX', 1e6, 99)).toBe(4);
  });

  it('lands exactly on a keyframe value at that keyframe time', () => {
    const keys = [kf('rotation', 0, 0), kf('rotation', 500, 45), kf('rotation', 1000, 90)];
    expect(interpolateKeyframes(keys, 'rotation', 0, -1)).toBe(0);
    expect(interpolateKeyframes(keys, 'rotation', 500, -1)).toBe(45);
    expect(interpolateKeyframes(keys, 'rotation', 1000, -1)).toBe(90);
  });

  it('interpolates linearly to a + (b - a) * t', () => {
    const keys = [kf('positionY', 200, -100), kf('positionY', 1200, 300)];
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const at = 200 + 1000 * t;
      expect(interpolateKeyframes(keys, 'positionY', at, 0)).toBeCloseTo(-100 + 400 * t, 9);
    }
  });

  it('the linear ground truth would reject a wrong value', () => {
    // Negative control for the assertion above.
    const keys = [kf('positionY', 200, -100), kf('positionY', 1200, 300)];
    const mid = interpolateKeyframes(keys, 'positionY', 700, 0);
    expect(mid).toBeCloseTo(100, 9);
    expect(Math.abs(mid - 120)).toBeGreaterThan(1e-9);
  });

  it('uses the easing of the LEFT key, not the right one', () => {
    /*
      A segment's shape belongs to the key it leaves, which is what lets
      one clip ease out of A and hold through B. Swapping the two keys'
      easings must change the answer.
    */
    const easeThenLinear = [kf('opacity', 0, 0, 'easeIn'), kf('opacity', 1000, 1, 'linear')];
    const linearThenEase = [kf('opacity', 0, 0, 'linear'), kf('opacity', 1000, 1, 'easeIn')];
    expect(interpolateKeyframes(easeThenLinear, 'opacity', 500, 0)).toBeCloseTo(0.25, 9);
    expect(interpolateKeyframes(linearThenEase, 'opacity', 500, 0)).toBeCloseTo(0.5, 9);
  });

  it('`hold` makes a step: the left value right up to the next key', () => {
    const keys = [kf('opacity', 0, 0.2, 'hold'), kf('opacity', 1000, 0.9, 'linear')];
    expect(interpolateKeyframes(keys, 'opacity', 1, 0)).toBe(0.2);
    expect(interpolateKeyframes(keys, 'opacity', 999, 0)).toBe(0.2);
    expect(interpolateKeyframes(keys, 'opacity', 1000, 0)).toBe(0.9);
  });

  it('does not require the keyframes to be sorted', () => {
    const sorted = [kf('scaleY', 0, 1), kf('scaleY', 400, 3), kf('scaleY', 900, 2)];
    const shuffled = [sorted[2], sorted[0], sorted[1]];
    for (const at of [0, 100, 400, 650, 900, 1200]) {
      expect(interpolateKeyframes(shuffled, 'scaleY', at, 0)).toBeCloseTo(
        interpolateKeyframes(sorted, 'scaleY', at, 0),
        9
      );
    }
  });

  it('keeps properties separate when several are keyed on one clip', () => {
    /*
      The bracketing search is a single pass over ALL keyframes with a
      property filter inside it. If that filter ever slips, an opacity
      ramp starts reading rotation degrees — and the numbers stay
      plausible, which is why this is worth a test.
    */
    const keys = [
      kf('opacity', 0, 0),
      kf('rotation', 0, 0),
      kf('opacity', 1000, 1),
      kf('rotation', 1000, 360),
    ];
    expect(interpolateKeyframes(keys, 'opacity', 500, -1)).toBeCloseTo(0.5, 9);
    expect(interpolateKeyframes(keys, 'rotation', 500, -1)).toBeCloseTo(180, 9);
  });

  it('survives two keys stacked on the same millisecond', () => {
    // `add_keyframes` appends rather than replaces (HANDOVER), so stacked
    // keys are a state real projects reach. It must not divide by zero.
    const keys = [kf('scaleX', 500, 1), kf('scaleX', 500, 4), kf('scaleX', 1500, 9)];
    const v = interpolateKeyframes(keys, 'scaleX', 500, 0);
    expect(Number.isFinite(v)).toBe(true);
    expect([1, 4]).toContain(v);
    expect(Number.isFinite(interpolateKeyframes(keys, 'scaleX', 1000, 0))).toBe(true);
  });

  it('a single keyframe holds its value everywhere', () => {
    const keys = [kf('anchorX', 750, 0.1)];
    expect(interpolateKeyframes(keys, 'anchorX', 0, 0.5)).toBe(0.1);
    expect(interpolateKeyframes(keys, 'anchorX', 750, 0.5)).toBe(0.1);
    expect(interpolateKeyframes(keys, 'anchorX', 5000, 0.5)).toBe(0.1);
  });
});

/* ── Keyframe lookup helpers ────────────────────────────────────── */

describe('keyframe lookup', () => {
  const keys = [
    kf('opacity', 900, 1),
    kf('positionX', 0, 0),
    kf('opacity', 100, 0),
    kf('positionX', 400, 50),
  ];

  it('getAnimatedProperties lists each keyed property once', () => {
    const props = getAnimatedProperties(keys).sort();
    expect(props).toEqual(['opacity', 'positionX']);
    expect(getAnimatedProperties([])).toEqual([]);
  });

  it('keyframesFor filters to one property and sorts by time', () => {
    expect(keyframesFor(keys, 'opacity').map((k) => k.timeOffsetMs)).toEqual([100, 900]);
    expect(keyframesFor(keys, 'positionX').map((k) => k.timeOffsetMs)).toEqual([0, 400]);
    expect(keyframesFor(keys, 'rotation')).toEqual([]);
  });

  it('keyframesFor does not reorder the caller\'s array', () => {
    const before = keys.map((k) => k.id);
    keyframesFor(keys, 'opacity');
    expect(keys.map((k) => k.id)).toEqual(before);
  });

  it('keyframeAt is inclusive at the tolerance and empty one ms past it', () => {
    /*
      The default 34ms is "within one frame at 30fps". The boundary is
      the whole point of the function — a hit at 34 and a miss at 35 is
      what proves the comparison is `<=` and not `<`, and that the
      tolerance is not being silently widened somewhere.
    */
    const k = [kf('opacity', 1000, 1)];
    expect(keyframeAt(k, 'opacity', 1000)?.timeOffsetMs).toBe(1000);
    expect(keyframeAt(k, 'opacity', 1034)?.timeOffsetMs).toBe(1000);
    expect(keyframeAt(k, 'opacity', 966)?.timeOffsetMs).toBe(1000);
    expect(keyframeAt(k, 'opacity', 1035)).toBeUndefined();
    expect(keyframeAt(k, 'opacity', 965)).toBeUndefined();
    // And it respects an explicit tolerance.
    expect(keyframeAt(k, 'opacity', 1035, 40)?.timeOffsetMs).toBe(1000);
    expect(keyframeAt(k, 'opacity', 1010, 5)).toBeUndefined();
  });

  it('keyframeAt does not cross property lines', () => {
    const k = [kf('rotation', 1000, 90)];
    expect(keyframeAt(k, 'opacity', 1000)).toBeUndefined();
  });
});

/* ── Speed ramps ────────────────────────────────────────────────── */

describe('speed curves', () => {
  it('every preset starts at 0 and ends at 1, ascending, with positive rates', () => {
    // A preset that does not span the whole clip leaves the ends
    // undefined and `getSpeedCurveMultiplier` clamps to a plateau, which
    // silently changes the ramp. Cheaper to catch here.
    for (const [name, points] of Object.entries(SPEED_CURVE_PRESETS)) {
      expect(points.length, name).toBeGreaterThanOrEqual(2);
      expect(points[0].timePct, name).toBe(0);
      expect(points[points.length - 1].timePct, name).toBe(1);
      for (let i = 1; i < points.length; i++) {
        expect(points[i].timePct, name).toBeGreaterThan(points[i - 1].timePct);
      }
      for (const p of points) expect(p.speedMult, name).toBeGreaterThan(0);
    }
  });

  it('resolveSpeedPoints sorts custom points and falls back when there are too few', () => {
    const scrambled = [
      { timePct: 1, speedMult: 2 },
      { timePct: 0, speedMult: 1 },
      { timePct: 0.5, speedMult: 4 },
    ];
    expect(resolveSpeedPoints('custom', scrambled).map((p) => p.timePct)).toEqual([0, 0.5, 1]);
    // The caller's array is left alone.
    expect(scrambled[0].timePct).toBe(1);
    expect(resolveSpeedPoints('custom', [{ timePct: 0, speedMult: 3 }])).toEqual(
      SPEED_CURVE_PRESETS.linear
    );
    expect(resolveSpeedPoints('custom')).toEqual(SPEED_CURVE_PRESETS.linear);
  });

  it('clamps progress outside 0..1 to the end plateaus', () => {
    expect(getSpeedCurveMultiplier('flash_in', -2)).toBe(4);
    expect(getSpeedCurveMultiplier('flash_in', 5)).toBe(1);
    expect(getSpeedCurveMultiplier('flash_out', -2)).toBe(1);
    expect(getSpeedCurveMultiplier('flash_out', 5)).toBe(4);
  });

  it('hits the preset control points exactly at their own timePct', () => {
    for (const [name, points] of Object.entries(SPEED_CURVE_PRESETS)) {
      for (const p of points) {
        expect(getSpeedCurveMultiplier(name as never, p.timePct), `${name}@${p.timePct}`)
          .toBeCloseTo(p.speedMult, 6);
      }
    }
  });

  it('smoothstep puts the midpoint of a segment at the mean of its ends', () => {
    // smoothstep(0.5) = 0.5 exactly, so this is arithmetic, not a fudge.
    // flash_in runs 4 -> 1 across the whole clip; halfway is 2.5.
    expect(getSpeedCurveMultiplier('flash_in', 0.5)).toBeCloseTo(2.5, 9);
    // And a quarter in, smoothstep(0.25) = 0.15625, so 4 + (1-4)*0.15625.
    expect(getSpeedCurveMultiplier('flash_in', 0.25)).toBeCloseTo(4 - 3 * 0.15625, 9);
  });

  it('jump_cut spikes to 6x only in its narrow window', () => {
    expect(getSpeedCurveMultiplier('jump_cut', 0.5)).toBeCloseTo(6, 6);
    expect(getSpeedCurveMultiplier('jump_cut', 0.2)).toBeCloseTo(1, 6);
    expect(getSpeedCurveMultiplier('jump_cut', 0.8)).toBeCloseTo(1, 6);
  });

  it('never returns a non-positive or non-finite rate anywhere on any preset', () => {
    // A zero rate stalls the source read forever; a negative one plays
    // backwards. Neither is reachable from a preset, and it should stay
    // that way as presets are edited.
    for (const name of Object.keys(SPEED_CURVE_PRESETS)) {
      for (let i = 0; i <= 200; i++) {
        const r = getSpeedCurveMultiplier(name as never, i / 200);
        expect(Number.isFinite(r), `${name}@${i}`).toBe(true);
        expect(r, `${name}@${i}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('getSourceProgress', () => {
  const RAMPS = ['montage', 'hero', 'bullet_time', 'jump_cut', 'flash_in', 'flash_out'] as const;

  it('is the identity for a linear ramp', () => {
    for (const p of [0, 0.13, 0.5, 0.87, 1]) expect(getSourceProgress('linear', p)).toBe(p);
  });

  it('spans the full source: 0 at the head, 1 at the tail', () => {
    for (const preset of RAMPS) {
      expect(getSourceProgress(preset, 0), preset).toBeCloseTo(0, 9);
      expect(getSourceProgress(preset, 1), preset).toBeCloseTo(1, 9);
    }
  });

  it('is monotonic non-decreasing — the source never rewinds mid-clip', () => {
    for (const preset of RAMPS) {
      let prev = -Infinity;
      for (let i = 0; i <= 128; i++) {
        const v = getSourceProgress(preset, i / 128);
        expect(v, `${preset}@${i}`).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = v;
      }
    }
  });

  it('a fast opening eats more than its share of the source, and vice versa', () => {
    /*
      The physical claim the integration exists to make. flash_in runs
      4x -> 1x, so by the halfway point of the CLIP it must have consumed
      well over half the SOURCE; flash_out is the mirror image. If the
      integrator were dropped and this returned `progress`, both would sit
      at 0.5 and the ramp would be decorative.
    */
    expect(getSourceProgress('flash_in', 0.5)).toBeGreaterThan(0.55);
    expect(getSourceProgress('flash_out', 0.5)).toBeLessThan(0.45);
    // Negative control: the two are genuinely on opposite sides of 0.5,
    // so neither assertion could pass by accident on a stub.
    expect(getSourceProgress('flash_in', 0.5)).toBeGreaterThan(
      getSourceProgress('flash_out', 0.5)
    );
    expect(getSourceProgress('flash_in', 0.5)).not.toBeCloseTo(0.5, 2);
  });

  it('flash_in and flash_out are mirror images of each other', () => {
    // Independent cross-check: the two presets are the same ramp
    // reversed, so consumed(t) + consumed_mirror(1-t) must be 1.
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      expect(
        getSourceProgress('flash_in', t, undefined, 512) +
          getSourceProgress('flash_out', 1 - t, undefined, 512)
      ).toBeCloseTo(1, 2);
    }
  });
});
