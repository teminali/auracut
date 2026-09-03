import { describe, it, expect } from 'vitest';
import {
  cursorLayerKeyframes,
  cursorPlaneStyle,
  CURSOR_SIZE_PCT,
  PLANE_HOTSPOT,
  PLANE_PATH,
  PLANE_GRADIENT_ANGLE,
  CursorLayerGeometry,
} from './cursorLayer';
import { SHAPE_BASE } from './cinematicLook';
import { GLIDE_CURVE, ZoomKeyframe } from './cursorZoom';
import { interpolateKeyframes, applyEasing } from './keyframeMath';
import type { CursorSample } from '../types/electron';
import type { KeyframePoint, AnimatableProperty } from '../types/edl';

const GEOMETRY: CursorLayerGeometry = {
  baseWidth: 1920,
  baseHeight: 1080,
  restScale: 1,
  canvasWidth: 1920,
  canvasHeight: 1080,
};

/** A cursor sitting perfectly still, sampled at 30Hz. */
function resting(x: number, y: number, durationMs: number): CursorSample[] {
  const out: CursorSample[] = [];
  for (let tMs = 0; tMs <= durationMs; tMs += 33) out.push({ tMs, x, y });
  return out;
}

/** The emitted keyframes as `interpolateKeyframes` will read them. */
function asPoints(
  keyframes: ReturnType<typeof cursorLayerKeyframes>
): KeyframePoint[] {
  return keyframes.map((k, i) => ({
    id: `k_${i}`,
    property: k.property as AnimatableProperty,
    timeOffsetMs: k.timeOffsetMs,
    value: k.value,
    easing: k.easing,
    ...(k.bezierPoints ? { bezierPoints: k.bezierPoints } : {}),
  }));
}

function stampsOf(
  keyframes: ReturnType<typeof cursorLayerKeyframes>,
  property: string
): number[] {
  return keyframes.filter((k) => k.property === property).map((k) => k.timeOffsetMs);
}

describe('the cursor icon', () => {
  it('points up and to the left, so its hotspot is above and left of centre', () => {
    /*
      The hotspot has to be the drawn point rather than the vertex, and
      it has to be in the first quadrant of the box. A dart authored
      pointing any other way would place every click in the film off by
      most of the icon.
    */
    expect(PLANE_HOTSPOT).toBeGreaterThan(0);
    expect(PLANE_HOTSPOT).toBeLessThan(50);
    expect(PLANE_PATH.startsWith('M9 9')).toBe(true);
  });

  it('puts the crease exactly on the line from the tip to the notch', () => {
    /*
      This is the claim the single-gradient design rests on: with the
      axis perpendicular to the crease, both ends of the crease sit at
      the same position along it, so a pair of stops there is a straight
      hard edge rather than a smear. Recomputed here from the path
      itself so that moving a vertex and forgetting the angle fails.
    */
    const style = cursorPlaneStyle(60);
    const gradient = style.gradient!;
    const rad = (gradient.angle * Math.PI) / 180;
    const ux = Math.cos(rad);
    const uy = Math.sin(rad);
    const startX = 50 - ux * 50;
    const startY = 50 - uy * 50;
    const along = (x: number, y: number) => ((x - startX) * ux + (y - startY) * uy) / 100;

    const tip = along(9, 9);
    const notch = along(57, 64);
    expect(Math.abs(tip - notch)).toBeLessThan(0.005);

    /* And the stops straddle it. */
    const stops = gradient.stops!;
    expect(stops).toHaveLength(2);
    expect(stops[0].at).toBeLessThan(tip);
    expect(stops[1].at).toBeGreaterThan(tip);
    expect(stops[1].at - stops[0].at).toBeLessThan(0.05);
  });

  it('sizes the shadow off the resting box, since canvas shadows do not scale', () => {
    const small = cursorPlaneStyle(60).shadow!;
    const big = cursorPlaneStyle(600).shadow!;
    expect(big.blur).toBeGreaterThan(small.blur);
    /* Down and to the left, matching a specular on the upper right. */
    expect(small.offsetX).toBeLessThan(0);
    expect(small.offsetY).toBeGreaterThan(0);
  });

  it('keeps a flat fill as well as the gradient, for a renderer without one', () => {
    const style = cursorPlaneStyle(60);
    expect(style.fill).toBe(style.gradient!.from);
    expect(style.strokeWidth).toBeGreaterThan(0);
    expect(PLANE_GRADIENT_ANGLE).toBeLessThan(0);
  });
});

describe('placing the cursor', () => {
  it('draws nothing without samples', () => {
    expect(cursorLayerKeyframes([], [], 5000, GEOMETRY)).toEqual([]);
    expect(cursorLayerKeyframes(resting(0.5, 0.5, 100), [], 0, GEOMETRY).length)
      .toBeGreaterThan(0);
  });

  it('lands the tip on the sampled point, not the layer centre', () => {
    const keyframes = cursorLayerKeyframes(resting(0.25, 0.75, 300), [], 300, GEOMETRY);
    const points = asPoints(keyframes);

    const boxPx = (CURSOR_SIZE_PCT / 100) * 1080;
    const scale = interpolateKeyframes(points, 'scaleX', 0, 0);
    expect(scale).toBeCloseTo(boxPx / SHAPE_BASE, 10);

    /*
      Walk it back out: the layer centre is at canvas centre plus
      positionX, and the tip is `PLANE_HOTSPOT` of the way across the
      box from that centre's top left corner.
    */
    const centreX = GEOMETRY.canvasWidth / 2 + interpolateKeyframes(points, 'positionX', 0, 0);
    const centreY = GEOMETRY.canvasHeight / 2 + interpolateKeyframes(points, 'positionY', 0, 0);
    const tipX = centreX - boxPx / 2 + (PLANE_HOTSPOT / 100) * boxPx;
    const tipY = centreY - boxPx / 2 + (PLANE_HOTSPOT / 100) * boxPx;

    expect(tipX).toBeCloseTo(0.25 * 1920, 6);
    expect(tipY).toBeCloseTo(0.75 * 1080, 6);
  });

  it('grows with the frame rather than holding one size', () => {
    /*
      The measurement the whole design turns on: at 1.89x frame scale
      the reference's cursor was 1.75x, and constant size would have
      been 1.00x. So a doubled frame doubles the icon.
    */
    const zoom: ZoomKeyframe[] = [
      { property: 'scaleX', timeOffsetMs: 0, value: 1, easing: 'linear' },
      { property: 'scaleY', timeOffsetMs: 0, value: 1, easing: 'linear' },
      { property: 'positionX', timeOffsetMs: 0, value: 0, easing: 'linear' },
      { property: 'positionY', timeOffsetMs: 0, value: 0, easing: 'linear' },
      { property: 'scaleX', timeOffsetMs: 1000, value: 2, easing: 'linear' },
      { property: 'scaleY', timeOffsetMs: 1000, value: 2, easing: 'linear' },
      { property: 'positionX', timeOffsetMs: 1000, value: 0, easing: 'linear' },
      { property: 'positionY', timeOffsetMs: 1000, value: 0, easing: 'linear' },
    ];
    const points = asPoints(
      cursorLayerKeyframes(resting(0.5, 0.5, 2000), zoom, 2000, GEOMETRY)
    );
    const at0 = interpolateKeyframes(points, 'scaleX', 0, 0);
    const at1000 = interpolateKeyframes(points, 'scaleX', 1000, 0);
    expect(at1000 / at0).toBeCloseTo(2, 9);
  });

  it('travels a resting cursor on the push curve exactly, not across it', () => {
    /*
      The artefact this rules out is the cursor sliding against the
      pixels it is pointing at while the frame moves under it. The
      module's claim is that one keyframe per zoom span, carrying that
      span's easing, is EXACT for a resting cursor because the canvas
      position is affine in the eased fraction. This checks it at the
      midpoint of a bezier push, where a linear chord would be furthest
      off.
    */
    const zoom: ZoomKeyframe[] = [
      { property: 'scaleX', timeOffsetMs: 0, value: 1, easing: 'bezier', bezierPoints: GLIDE_CURVE },
      { property: 'positionX', timeOffsetMs: 0, value: 0, easing: 'bezier', bezierPoints: GLIDE_CURVE },
      { property: 'positionY', timeOffsetMs: 0, value: 0, easing: 'bezier', bezierPoints: GLIDE_CURVE },
      { property: 'scaleX', timeOffsetMs: 1000, value: 2.4, easing: 'linear' },
      { property: 'positionX', timeOffsetMs: 1000, value: 240, easing: 'linear' },
      { property: 'positionY', timeOffsetMs: 1000, value: -120, easing: 'linear' },
    ];
    const cursor = resting(0.3, 0.62, 2000);
    const points = asPoints(cursorLayerKeyframes(cursor, zoom, 2000, GEOMETRY));

    const f = applyEasing(0.5, 'bezier', GLIDE_CURVE);
    const scale = 1 + (2.4 - 1) * f;
    const frameX = 240 * f;
    const frameY = -120 * f;
    const pictureW = 1920 * scale;
    const pictureH = 1080 * scale;
    const boxPx = (CURSOR_SIZE_PCT / 100) * pictureH;
    const centreOffset = ((50 - PLANE_HOTSPOT) / 100) * boxPx;

    const wantX = 960 + frameX + pictureW * (0.3 - 0.5) + centreOffset - 960;
    const wantY = 540 + frameY + pictureH * (0.62 - 0.5) + centreOffset - 540;

    expect(interpolateKeyframes(points, 'positionX', 500, 0)).toBeCloseTo(wantX, 6);
    expect(interpolateKeyframes(points, 'positionY', 500, 0)).toBeCloseTo(wantY, 6);
    expect(interpolateKeyframes(points, 'scaleX', 500, 0)).toBeCloseTo(boxPx / SHAPE_BASE, 9);
  });

  it('forces a keyframe at every zoom stamp so no span is chorded', () => {
    const zoom: ZoomKeyframe[] = [
      { property: 'scaleX', timeOffsetMs: 400, value: 1.8, easing: 'bezier', bezierPoints: GLIDE_CURVE },
      { property: 'scaleX', timeOffsetMs: 1400, value: 1, easing: 'linear' },
    ];
    const stamps = stampsOf(
      cursorLayerKeyframes(resting(0.5, 0.5, 3000), zoom, 3000, GEOMETRY),
      'positionX'
    );
    expect(stamps).toContain(400);
    expect(stamps).toContain(1400);
  });
});

describe('decimating a 30Hz track', () => {
  it('collapses a straight drag to its endpoints', () => {
    const cursor: CursorSample[] = [];
    for (let i = 0; i < 120; i++) {
      cursor.push({ tMs: i * 33, x: 0.1 + (0.8 * i) / 119, y: 0.1 + (0.8 * i) / 119 });
    }
    expect(stampsOf(cursorLayerKeyframes(cursor, [], 4000, GEOMETRY), 'positionX'))
      .toHaveLength(2);
  });

  it('keeps the corner where a drag stops, because arriving is the point', () => {
    /*
      Simplifying the 2D path instead of the two time series would drop
      this: a cursor holding still contributes coincident points and no
      spatial deviation at all, so the pause would vanish and the
      pointer would drift for the whole second it was supposed to be
      sitting on the thing it had just reached.
    */
    const cursor: CursorSample[] = [];
    for (let i = 0; i < 30; i++) cursor.push({ tMs: i * 33, x: 0.1 + (0.4 * i) / 29, y: 0.5 });
    for (let i = 0; i < 30; i++) cursor.push({ tMs: 990 + i * 33, x: 0.5, y: 0.5 });

    const stamps = stampsOf(cursorLayerKeyframes(cursor, [], 2000, GEOMETRY), 'positionX');
    const arrival = stamps.filter((t) => t >= 900 && t <= 1050);
    expect(arrival.length).toBeGreaterThan(0);
    expect(stamps.length).toBeLessThan(10);
  });

  it('loosens the tolerance to meet the budget rather than truncating the film', () => {
    /*
      Truncating would draw a real pointer for the first stretch and
      then a frozen one for the rest, which is worse than a slightly
      loose path all the way through.
    */
    const cursor: CursorSample[] = [];
    for (let i = 0; i < 900; i++) {
      cursor.push({ tMs: i * 33, x: 0.5 + 0.4 * Math.sin(i / 2), y: 0.5 + 0.4 * Math.cos(i / 3) });
    }
    const stamps = stampsOf(
      cursorLayerKeyframes(cursor, [], 30_000, GEOMETRY, { maxSamples: 40 }),
      'positionX'
    );
    expect(stamps.length).toBeLessThanOrEqual(40);
    /* Still spans the film rather than stopping early. */
    expect(Math.max(...stamps)).toBeGreaterThan(25_000);
  });

  it('drops samples that are not finite or not inside the film', () => {
    const cursor: CursorSample[] = [
      { tMs: -100, x: 0.5, y: 0.5 },
      { tMs: 0, x: 0.2, y: 0.2 },
      { tMs: 500, x: Number.NaN, y: 0.5 },
      { tMs: 900, x: 0.8, y: 0.8 },
      { tMs: 90_000, x: 0.5, y: 0.5 },
    ];
    const stamps = stampsOf(cursorLayerKeyframes(cursor, [], 1000, GEOMETRY), 'positionX');
    expect(stamps).toEqual([0, 900]);
  });
});

describe('hiding the cursor under a camera takeover', () => {
  const spans = [{ startMs: 2000, endMs: 4000 }];

  it('fades out for the takeover and back in after it', () => {
    const points = asPoints(
      cursorLayerKeyframes(resting(0.5, 0.5, 6000), [], 6000, GEOMETRY, {
        hiddenSpans: spans,
        fadeMs: 320,
      })
    );
    expect(interpolateKeyframes(points, 'opacity', 0, 1)).toBeCloseTo(1, 9);
    expect(interpolateKeyframes(points, 'opacity', 1600, 1)).toBeCloseTo(1, 9);
    expect(interpolateKeyframes(points, 'opacity', 3000, 1)).toBeCloseTo(0, 9);
    expect(interpolateKeyframes(points, 'opacity', 5000, 1)).toBeCloseTo(1, 9);
  });

  it('opens visible even when the film opens on the face', () => {
    /*
      `interpolateKeyframes` holds the FIRST keyframe backwards, so
      without an explicit 1 at zero a take that opens on an
      introduction would hold that opening 0 over the whole film up to
      it, which for a takeover starting at zero is the whole film.
    */
    const points = asPoints(
      cursorLayerKeyframes(resting(0.5, 0.5, 6000), [], 6000, GEOMETRY, {
        hiddenSpans: [{ startMs: 0, endMs: 1500 }],
      })
    );
    expect(interpolateKeyframes(points, 'opacity', 5000, 0)).toBeCloseTo(1, 9);
  });

  it('does not let one takeover fade back in on top of the next', () => {
    const points = asPoints(
      cursorLayerKeyframes(resting(0.5, 0.5, 9000), [], 9000, GEOMETRY, {
        hiddenSpans: [
          { startMs: 2000, endMs: 4000 },
          { startMs: 4200, endMs: 6000 },
        ],
        fadeMs: 320,
      })
    );
    /* The gap is shorter than two fades, so the tail of the first would
       otherwise put a 1 inside the second. */
    expect(interpolateKeyframes(points, 'opacity', 5000, 1)).toBeCloseTo(0, 9);
    expect(interpolateKeyframes(points, 'opacity', 7000, 1)).toBeCloseTo(1, 9);
  });

  it('writes no opacity at all when nothing is hidden', () => {
    const keyframes = cursorLayerKeyframes(resting(0.5, 0.5, 3000), [], 3000, GEOMETRY);
    expect(keyframes.some((k) => k.property === 'opacity')).toBe(false);
  });
});
