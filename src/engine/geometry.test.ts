/* ═══════════════════════════════════════════════════════════════════
   geometry — viewport fitting, fit modes, clip boxes, resize solving.

   The ground truth here is mostly geometric identity rather than a
   recorded number: a `cover` box must actually cover, a square turned
   45° must have an AABB exactly sqrt(2) wider, a view↔canvas round trip
   must return the point it started with. Those hold no matter what the
   constants become, and they fail loudly if the maths is rewritten
   wrongly — which a recorded number would not.

   Everything the compositor draws and everything the transform gizmo
   grabs comes through here, so a silent error is two subsystems
   disagreeing about where a clip is.
   ═══════════════════════════════════════════════════════════════════ */

import { describe, it, expect } from 'vitest';
import {
  clamp,
  toRad,
  toDeg,
  rotatePoint,
  computeViewport,
  canvasToView,
  viewToCanvas,
  viewDeltaToCanvas,
  getClipBaseSize,
  textMetricsKey,
  cacheTextMetrics,
  getClipBox,
  getBoxCorners,
  getBoxAABB,
  hitTestBox,
  RESIZE_HANDLES,
  rotatedCursor,
  solveResize,
  angleFromCenter,
  snapAngle,
  normalizeAngle,
  ClipBox,
  HandleSpec,
} from './geometry';
import {
  Clip,
  ClipSeed,
  ProjectSettings,
  createClip,
  KeyframePoint,
  AnimatableProperty,
} from '../types/edl';

/* ── Fixtures ───────────────────────────────────────────────────── */

const project = (width: number, height: number): ProjectSettings => ({
  id: 'p',
  name: 'geometry fixture',
  aspectRatio: '16:9',
  width,
  height,
  fps: 30,
  durationMs: 10_000,
  backgroundColor: '#000000',
  createdAt: 0,
  updatedAt: 0,
});

const LANDSCAPE = project(1920, 1080);
const PORTRAIT = project(1080, 1920);

let clipSeq = 0;
/* `ClipSeed` is deep-partial, which is what lets a fixture set only
   `transform.x` or only `textStyle.fontSize` and have `createClip` fill
   in the rest — the same route the app takes when it builds a clip. */
const clip = (partial: Partial<ClipSeed> = {}): Clip =>
  createClip({
    id: `c${clipSeq++}`,
    trackId: 'tr1',
    type: 'video',
    name: 'fixture',
    ...partial,
  } as ClipSeed);

let kfSeq = 0;
const kf = (property: AnimatableProperty, timeOffsetMs: number, value: number): KeyframePoint => ({
  id: `gk${kfSeq++}`,
  property,
  timeOffsetMs,
  value,
  easing: 'linear',
});

const box = (over: Partial<ClipBox> = {}): ClipBox => ({
  cx: 960,
  cy: 540,
  width: 400,
  height: 200,
  rotation: 0,
  opacity: 1,
  baseWidth: 400,
  baseHeight: 200,
  scaleX: 1,
  scaleY: 1,
  anchorX: 0.5,
  anchorY: 0.5,
  ...over,
});

const handle = (id: string): HandleSpec => RESIZE_HANDLES.find((h) => h.id === id)!;

/* ── Small helpers ──────────────────────────────────────────────── */

describe('scalar helpers', () => {
  it('clamp holds the bounds, including inverted-looking inputs', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('toRad and toDeg round-trip', () => {
    for (const d of [-360, -90, 0, 33.7, 180, 359.9]) expect(toDeg(toRad(d))).toBeCloseTo(d, 9);
    expect(toRad(180)).toBeCloseTo(Math.PI, 12);
  });
});

describe('rotatePoint', () => {
  it('returns a copy, not the same object, at zero degrees', () => {
    // The fast path returns a fresh object; callers mutate the result.
    const p = { x: 3, y: 4 };
    const r = rotatePoint(p, { x: 0, y: 0 }, 0);
    expect(r).toEqual(p);
    expect(r).not.toBe(p);
  });

  it('turns clockwise on screen, where y grows downwards', () => {
    // (1,0) is to the right of the origin; a clockwise quarter turn puts
    // it below, at (0,1). Getting this backwards mirrors every gizmo.
    const r = rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, 90);
    expect(r.x).toBeCloseTo(0, 12);
    expect(r.y).toBeCloseTo(1, 12);
  });

  it('preserves distance from the origin at any angle', () => {
    const origin = { x: 120, y: -40 };
    const p = { x: 300, y: 260 };
    const d0 = Math.hypot(p.x - origin.x, p.y - origin.y);
    for (const deg of [7, 45, 90, 133, 180, 271, 359]) {
      const r = rotatePoint(p, origin, deg);
      expect(Math.hypot(r.x - origin.x, r.y - origin.y)).toBeCloseTo(d0, 9);
    }
  });

  it('a full turn is the identity', () => {
    const r = rotatePoint({ x: 17, y: -3 }, { x: 5, y: 5 }, 360);
    expect(r.x).toBeCloseTo(17, 9);
    expect(r.y).toBeCloseTo(-3, 9);
  });
});

/* ── Viewport ───────────────────────────────────────────────────── */

describe('computeViewport', () => {
  it('fits the canvas inside the stage, touching on exactly one axis', () => {
    /*
      The definition of "fit": nothing overflows, and one dimension is
      flush. Asserting both catches an under-fit (margins on all sides)
      as well as an overflow, which a single inequality would not.
    */
    const cases: [number, number, ProjectSettings][] = [
      [1000, 1000, LANDSCAPE],
      [1000, 1000, PORTRAIT],
      [3000, 400, LANDSCAPE],
      [400, 3000, LANDSCAPE],
      [1920, 1080, LANDSCAPE],
    ];
    for (const [w, h, proj] of cases) {
      const vp = computeViewport(w, h, proj);
      expect(vp.displayWidth).toBeLessThanOrEqual(w + 1e-9);
      expect(vp.displayHeight).toBeLessThanOrEqual(h + 1e-9);
      const flush = Math.max(vp.displayWidth / w, vp.displayHeight / h);
      expect(flush).toBeCloseTo(1, 9);
    }
  });

  it('centres the canvas, computed independently of the implementation', () => {
    const vp = computeViewport(1000, 1000, LANDSCAPE);
    // By hand: min(1000/1920, 1000/1080) = 0.520833…, so 1000 x 562.5.
    expect(vp.scale).toBeCloseTo(1000 / 1920, 12);
    expect(vp.displayWidth).toBeCloseTo(1000, 9);
    expect(vp.displayHeight).toBeCloseTo(562.5, 9);
    expect(vp.offsetX).toBeCloseTo(0, 9);
    expect(vp.offsetY).toBeCloseTo(218.75, 9);
  });

  it('the centring ground truth would reject a wrong offset', () => {
    // Negative control for the assertion above.
    const vp = computeViewport(1000, 1000, LANDSCAPE);
    expect(Math.abs(vp.offsetY - 200)).toBeGreaterThan(1e-6);
  });

  it('zoom multiplies the fit scale and pan only shifts the origin', () => {
    const fit = computeViewport(1000, 1000, LANDSCAPE);
    const zoomed = computeViewport(1000, 1000, LANDSCAPE, 2);
    expect(zoomed.scale).toBeCloseTo(fit.scale * 2, 12);
    expect(zoomed.displayWidth).toBeCloseTo(fit.displayWidth * 2, 9);

    const panned = computeViewport(1000, 1000, LANDSCAPE, 1, 30, -70);
    expect(panned.scale).toBe(fit.scale);
    expect(panned.offsetX).toBeCloseTo(fit.offsetX + 30, 9);
    expect(panned.offsetY).toBeCloseTo(fit.offsetY - 70, 9);
  });

  it('survives a zero-sized stage and a zero zoom without producing NaN', () => {
    // The stage measures 0x0 for one frame on mount, and every consumer
    // divides by `scale`. A NaN here becomes a blank monitor.
    for (const vp of [
      computeViewport(0, 0, LANDSCAPE),
      computeViewport(-10, -10, LANDSCAPE),
      computeViewport(800, 600, LANDSCAPE, 0),
      computeViewport(800, 600, LANDSCAPE, -3),
    ]) {
      expect(Number.isFinite(vp.scale)).toBe(true);
      expect(vp.scale).toBeGreaterThanOrEqual(0.01);
      expect(Number.isFinite(vp.offsetX)).toBe(true);
      expect(Number.isFinite(vp.offsetY)).toBe(true);
    }
  });

  it('does NOT round to whole pixels, whatever the header comment says', () => {
    /*
      Recorded, not endorsed. The doc comment on `computeViewport` says
      the result is "Rounded so the canvas lands on whole pixels"; there
      is no rounding in the function. Fractional offsets are what it
      actually returns, and the gizmo/compositor agree with each other
      because they both come through here — so nothing is broken today.
      This test exists so that adding the rounding is a deliberate change
      with a visible consequence, rather than a comment quietly becoming
      true one day.
    */
    const vp = computeViewport(1001, 1000, LANDSCAPE);
    expect(vp.offsetY % 1).not.toBe(0);
  });

  it('canvas -> view -> canvas is a round trip', () => {
    const vp = computeViewport(1234, 777, PORTRAIT, 1.7, 22, -13);
    for (const p of [{ x: 0, y: 0 }, { x: 1080, y: 1920 }, { x: 333.25, y: 1002.5 }]) {
      const back = viewToCanvas(canvasToView(p, vp), vp);
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
  });

  it('canvasToView puts the canvas origin at the viewport offset', () => {
    const vp = computeViewport(1000, 1000, LANDSCAPE, 1, 5, 6);
    const o = canvasToView({ x: 0, y: 0 }, vp);
    expect(o.x).toBeCloseTo(vp.offsetX, 9);
    expect(o.y).toBeCloseTo(vp.offsetY, 9);
  });

  it('viewDeltaToCanvas ignores pan. A drag is the same wherever it starts', () => {
    const a = computeViewport(1000, 1000, LANDSCAPE, 1.5, 0, 0);
    const b = computeViewport(1000, 1000, LANDSCAPE, 1.5, 400, -900);
    expect(viewDeltaToCanvas(100, 50, a)).toEqual(viewDeltaToCanvas(100, 50, b));
    expect(viewDeltaToCanvas(100, 50, a).x).toBeCloseTo(100 / a.scale, 9);
  });
});

/* ── Fit modes ──────────────────────────────────────────────────── */

describe('getClipBaseSize fit modes', () => {
  const WIDE = { width: 4000, height: 1000 }; // aspect 4.0, wider than 16:9
  const TALL = { width: 1000, height: 4000 }; // aspect 0.25, taller than 16:9

  it('`fill` is exactly the canvas, aspect ratio be damned', () => {
    for (const natural of [WIDE, TALL, null]) {
      const s = getClipBaseSize(clip({ fitMode: 'fill' }), LANDSCAPE, natural);
      expect(s).toEqual({ width: 1920, height: 1080 });
    }
  });

  it('`none` is the media\'s own pixels', () => {
    expect(getClipBaseSize(clip({ fitMode: 'none' }), LANDSCAPE, WIDE)).toEqual({
      width: 4000,
      height: 1000,
    });
  });

  it('`cover` covers the canvas, keeps aspect, and does not over-cover', () => {
    /*
      Three independent facts, none of them a recorded number:
        - neither dimension falls short of the canvas (it covers);
        - width/height still equals the source ratio (no distortion);
        - the smaller of the two overshoot ratios is exactly 1 (it is
          flush on one axis, i.e. scaled no more than it had to be).
    */
    for (const natural of [WIDE, TALL, { width: 1920, height: 1080 }]) {
      const s = getClipBaseSize(clip({ fitMode: 'cover' }), LANDSCAPE, natural);
      expect(s.width).toBeGreaterThanOrEqual(1920 - 1e-9);
      expect(s.height).toBeGreaterThanOrEqual(1080 - 1e-9);
      expect(s.width / s.height).toBeCloseTo(natural.width / natural.height, 6);
      expect(Math.min(s.width / 1920, s.height / 1080)).toBeCloseTo(1, 9);
    }
  });

  it('`contain` sits inside the canvas at 55% of the limiting dimension', () => {
    const wide = getClipBaseSize(clip({ fitMode: 'contain' }), LANDSCAPE, WIDE);
    expect(wide.width).toBeCloseTo(1920 * 0.55, 6);
    expect(wide.width / wide.height).toBeCloseTo(4, 6);

    const tall = getClipBaseSize(clip({ fitMode: 'contain' }), LANDSCAPE, TALL);
    expect(tall.height).toBeCloseTo(1080 * 0.55, 6);
    expect(tall.width / tall.height).toBeCloseTo(0.25, 6);

    // And it always fits.
    for (const s of [wide, tall]) {
      expect(s.width).toBeLessThanOrEqual(1920);
      expect(s.height).toBeLessThanOrEqual(1080);
    }
  });

  it('the cover assertions genuinely discriminate, `contain` fails them', () => {
    // Negative control: swap the fit mode and the "covers" test must break.
    const s = getClipBaseSize(clip({ fitMode: 'contain' }), LANDSCAPE, WIDE);
    expect(s.width < 1920 || s.height < 1080).toBe(true);
  });

  it('prefers the passed-in natural size over the clip\'s recorded one', () => {
    // The decoded element is authoritative; the stored numbers can be
    // stale or absent on a freshly imported asset.
    const c = clip({ fitMode: 'none', naturalWidth: 640, naturalHeight: 480 });
    expect(getClipBaseSize(c, LANDSCAPE, { width: 1280, height: 720 })).toEqual({
      width: 1280,
      height: 720,
    });
    expect(getClipBaseSize(c, LANDSCAPE, null)).toEqual({ width: 640, height: 480 });
  });

  it('falls back to the canvas when nothing knows the media size', () => {
    const s = getClipBaseSize(clip({ fitMode: 'cover' }), LANDSCAPE, null);
    expect(s).toEqual({ width: 1920, height: 1080 });
  });

  it('an unknown fit mode behaves as `cover` rather than collapsing', () => {
    const s = getClipBaseSize(
      clip({ fitMode: 'nonsense' as never }),
      LANDSCAPE,
      WIDE
    );
    expect(s.height).toBeCloseTo(1080, 6);
    expect(s.width).toBeCloseTo(1080 * 4, 6);
  });
});

describe('getClipBaseSize for text', () => {
  it('uses a canvas-relative default when the clip has no text style', () => {
    // `createClip` gives every text clip a style, so this is the
    // defensive branch for a hand-built or partially migrated clip.
    const c = { ...clip({ type: 'text' }), textStyle: undefined } as Clip;
    expect(getClipBaseSize(c, LANDSCAPE, null)).toEqual({ width: 1920 * 0.6, height: 1080 * 0.14 });
  });

  it('grows with line count and shrinks to the longest line, plus padding', () => {
    const single = clip({
      type: 'text',
      textStyle: { text: 'AB', fontSize: 100, lineHeight: 1, backgroundPadding: 0, letterSpacing: 0 },
    });
    const triple = clip({
      type: 'text',
      textStyle: {
        text: 'AB\nAB\nAB',
        fontSize: 100,
        lineHeight: 1,
        backgroundPadding: 0,
        letterSpacing: 0,
      },
    });
    expect(getClipBaseSize(single, LANDSCAPE, null).height).toBeCloseTo(100, 6);
    expect(getClipBaseSize(triple, LANDSCAPE, null).height).toBeCloseTo(300, 6);
    // Width tracks the LONGEST line, not the last or the first.
    const ragged = clip({
      type: 'text',
      textStyle: {
        text: 'i\nMMMMMMMM\ni',
        fontSize: 100,
        lineHeight: 1,
        backgroundPadding: 0,
        letterSpacing: 0,
      },
    });
    expect(getClipBaseSize(ragged, LANDSCAPE, null).width).toBeCloseTo(8 * 100 * 0.56, 6);
  });

  it('never returns a box smaller than 24px on either axis', () => {
    const tiny = clip({
      type: 'text',
      textStyle: { text: '', fontSize: 1, lineHeight: 1, backgroundPadding: 0, letterSpacing: 0 },
    });
    expect(getClipBaseSize(tiny, LANDSCAPE, null)).toEqual({ width: 24, height: 24 });
  });

  it('a cached measurement replaces the estimate, and the key tracks the style', () => {
    /*
      The compositor measures text exactly and writes it back here so the
      gizmo can draw handles on the real glyph run a frame later. If the
      key did not include the style, changing the font size would keep
      serving the old width and the handles would detach from the text.
    */
    const c = clip({
      type: 'text',
      textStyle: { text: 'MEASURE ME', fontSize: 80, backgroundPadding: 0, letterSpacing: 0 },
    });
    const estimate = getClipBaseSize(c, LANDSCAPE, null).width;
    cacheTextMetrics(c, { width: 1234, height: 0 });
    expect(getClipBaseSize(c, LANDSCAPE, null).width).toBeCloseTo(1234, 6);
    expect(estimate).not.toBeCloseTo(1234, 0);

    const resized = { ...c, textStyle: { ...c.textStyle!, fontSize: 120 } } as Clip;
    expect(textMetricsKey(resized)).not.toBe(textMetricsKey(c));
    expect(getClipBaseSize(resized, LANDSCAPE, null).width).not.toBeCloseTo(1234, 6);
  });

  it('textMetricsKey degrades to the clip id when there is no style', () => {
    const c = { ...clip({ type: 'video' }), textStyle: undefined } as Clip;
    expect(textMetricsKey(c)).toBe(c.id);
  });
});

/* ── The clip box ───────────────────────────────────────────────── */

describe('getClipBox', () => {
  it('places the transform offset relative to the canvas centre', () => {
    const c = clip({ fitMode: 'fill', transform: { x: 100, y: -50 } });
    const b = getClipBox(c, LANDSCAPE, 0, null);
    expect(b.cx).toBe(1920 / 2 + 100);
    expect(b.cy).toBe(1080 / 2 - 50);
  });

  it('multiplies the base size by scale and reports both', () => {
    const c = clip({ fitMode: 'fill', transform: { scaleX: 0.5, scaleY: 2 } });
    const b = getClipBox(c, LANDSCAPE, 0, null);
    expect(b.baseWidth).toBe(1920);
    expect(b.baseHeight).toBe(1080);
    expect(b.width).toBe(960);
    expect(b.height).toBe(2160);
    expect(b.scaleX).toBe(0.5);
    expect(b.scaleY).toBe(2);
  });

  it('defaults the anchor to the centre when the transform omits it', () => {
    const c = clip({ fitMode: 'fill' });
    const t = { ...c.transform } as Record<string, unknown>;
    delete t.anchorX;
    delete t.anchorY;
    const b = getClipBox({ ...c, transform: t } as unknown as Clip, LANDSCAPE, 0, null);
    expect(b.anchorX).toBe(0.5);
    expect(b.anchorY).toBe(0.5);
  });

  it('reads keyframes at an offset from the CLIP start, not the timeline zero', () => {
    /*
      The one thing in this function that is easy to get wrong and hard
      to see: `offsetMs = playheadMs - clip.startTimeMs`. Two clips
      carrying identical keyframes but placed at different times must
      report different boxes at the same playhead — if they agree, the
      subtraction has gone missing and every clip animates from the
      sequence start.
    */
    const keys = [kf('positionX', 0, 0), kf('positionX', 1000, 1000)];
    const early = clip({ fitMode: 'fill', startTimeMs: 0, keyframes: keys });
    const late = clip({ fitMode: 'fill', startTimeMs: 2000, keyframes: keys });

    expect(getClipBox(early, LANDSCAPE, 500, null).cx).toBeCloseTo(960 + 500, 6);
    expect(getClipBox(late, LANDSCAPE, 500, null).cx).toBeCloseTo(960 + 0, 6);
    expect(getClipBox(late, LANDSCAPE, 2500, null).cx).toBeCloseTo(960 + 500, 6);
  });

  it('a keyframed property overrides the static transform, unkeyed ones do not', () => {
    const c = clip({
      fitMode: 'fill',
      transform: { x: 700, opacity: 0.25 },
      keyframes: [kf('positionX', 0, 0), kf('positionX', 1000, 100)],
    });
    const b = getClipBox(c, LANDSCAPE, 1000, null);
    expect(b.cx).toBeCloseTo(960 + 100, 6); // keyframed
    expect(b.opacity).toBeCloseTo(0.25, 6); // not keyframed. Static wins
  });
});

/* ── Corners, bounds, hit testing ───────────────────────────────── */

describe('box corners and bounds', () => {
  it('an unrotated AABB is the box itself', () => {
    const b = box({ cx: 100, cy: 200, width: 40, height: 60 });
    expect(getBoxAABB(b)).toEqual({ x: 80, y: 170, width: 40, height: 60 });
  });

  it('a square turned 45 degrees has an AABB exactly sqrt(2) larger', () => {
    // Pure geometry, independent of the implementation.
    const side = 100;
    const b = box({ width: side, height: side, rotation: 45 });
    const aabb = getBoxAABB(b);
    expect(aabb.width).toBeCloseTo(side * Math.SQRT2, 6);
    expect(aabb.height).toBeCloseTo(side * Math.SQRT2, 6);
    expect(aabb.x + aabb.width / 2).toBeCloseTo(b.cx, 6);
    expect(aabb.y + aabb.height / 2).toBeCloseTo(b.cy, 6);
  });

  it('a quarter turn swaps width and height', () => {
    const b = box({ width: 400, height: 200, rotation: 90 });
    const aabb = getBoxAABB(b);
    expect(aabb.width).toBeCloseTo(200, 6);
    expect(aabb.height).toBeCloseTo(400, 6);
  });

  it('the sqrt(2) result is not what an unrotated box would give', () => {
    // Negative control: without the rotation the same assertion fails.
    const aabb = getBoxAABB(box({ width: 100, height: 100, rotation: 0 }));
    expect(Math.abs(aabb.width - 100 * Math.SQRT2)).toBeGreaterThan(1);
  });

  it('all four corners sit exactly one half-diagonal from the centre', () => {
    const b = box({ width: 300, height: 140, rotation: 37 });
    const half = Math.hypot(b.width / 2, b.height / 2);
    for (const c of getBoxCorners(b)) {
      expect(Math.hypot(c.x - b.cx, c.y - b.cy)).toBeCloseTo(half, 6);
    }
  });

  it('corners are ordered clockwise from top-left', () => {
    const [tl, tr, br, bl] = getBoxCorners(box({ width: 400, height: 200 }));
    expect(tl).toEqual({ x: 760, y: 440 });
    expect(tr).toEqual({ x: 1160, y: 440 });
    expect(br).toEqual({ x: 1160, y: 640 });
    expect(bl).toEqual({ x: 760, y: 640 });
  });
});

describe('hitTestBox', () => {
  it('accepts the centre and the exact edges, rejects just outside', () => {
    const b = box({ cx: 0, cy: 0, width: 100, height: 50 });
    expect(hitTestBox({ x: 0, y: 0 }, b)).toBe(true);
    expect(hitTestBox({ x: 50, y: 25 }, b)).toBe(true);
    expect(hitTestBox({ x: -50, y: -25 }, b)).toBe(true);
    expect(hitTestBox({ x: 50.001, y: 0 }, b)).toBe(false);
    expect(hitTestBox({ x: 0, y: -25.001 }, b)).toBe(false);
  });

  it('respects rotation: an AABB corner is a miss on the rotated box', () => {
    /*
      The test that separates a real hit test from `getBoxAABB` plus a
      rectangle check. On a square turned 45°, the AABB corner is inside
      the bounds and outside the shape — clicking there must select
      whatever is underneath, not this clip.
    */
    const b = box({ cx: 0, cy: 0, width: 100, height: 100, rotation: 45 });
    const aabbCorner = { x: 70, y: 70 }; // inside the sqrt(2)*100 bounds
    expect(getBoxAABB(b).width / 2).toBeGreaterThan(70);
    expect(hitTestBox(aabbCorner, b)).toBe(false);
    // …while the rotated box's own corner, straight down, is a hit.
    expect(hitTestBox({ x: 0, y: 69 }, b)).toBe(true);
  });

  it('agrees with the corner list on a rotated box', () => {
    // Independent cross-check: every corner is (just) inside, and a
    // point pushed 2% further out along the same ray is not.
    const b = box({ cx: 500, cy: 500, width: 260, height: 120, rotation: 61 });
    for (const c of getBoxCorners(b)) {
      const inward = { x: b.cx + (c.x - b.cx) * 0.98, y: b.cy + (c.y - b.cy) * 0.98 };
      const outward = { x: b.cx + (c.x - b.cx) * 1.02, y: b.cy + (c.y - b.cy) * 1.02 };
      expect(hitTestBox(inward, b)).toBe(true);
      expect(hitTestBox(outward, b)).toBe(false);
    }
  });
});

/* ── Handles ────────────────────────────────────────────────────── */

describe('rotatedCursor', () => {
  it('the rotate handle always grabs', () => {
    expect(rotatedCursor({ id: 'rotate', ux: 0, uy: -0.5, axis: 'none', cursor: 'grab' }, 137)).toBe(
      'grab'
    );
  });

  it('names the cursor by where the handle points on screen', () => {
    expect(rotatedCursor(handle('n'), 0)).toBe('ns-resize');
    expect(rotatedCursor(handle('e'), 0)).toBe('ew-resize');
    expect(rotatedCursor(handle('ne'), 0)).toBe('nesw-resize');
    expect(rotatedCursor(handle('nw'), 0)).toBe('nwse-resize');
  });

  it('a quarter turn swaps the vertical and horizontal cursors', () => {
    // The whole reason the function exists: a "north" handle on a box
    // turned 90° reads as east/west to the user.
    expect(rotatedCursor(handle('n'), 90)).toBe('ew-resize');
    expect(rotatedCursor(handle('e'), 90)).toBe('ns-resize');
    expect(rotatedCursor(handle('n'), 45)).toBe('nesw-resize');
  });

  it('is 180-degree periodic, a resize arrow is double-headed', () => {
    for (const h of RESIZE_HANDLES) {
      expect(rotatedCursor(h, 0), h.id).toBe(rotatedCursor(h, 180));
      expect(rotatedCursor(h, 30), h.id).toBe(rotatedCursor(h, 210));
    }
  });

  it('opposite handles share a cursor', () => {
    expect(rotatedCursor(handle('n'), 0)).toBe(rotatedCursor(handle('s'), 0));
    expect(rotatedCursor(handle('nw'), 0)).toBe(rotatedCursor(handle('se'), 0));
    expect(rotatedCursor(handle('ne'), 0)).toBe(rotatedCursor(handle('sw'), 0));
  });
});

/* ── Resize solving ─────────────────────────────────────────────── */

describe('solveResize', () => {
  const drag = (
    id: string,
    dx: number,
    dy: number,
    over: Partial<ClipBox> = {},
    opts: Partial<{ lockAspect: boolean; fromCenter: boolean; minSize: number }> = {}
  ) =>
    solveResize({
      startBox: box(over),
      handle: handle(id),
      deltaCanvas: { x: dx, y: dy },
      lockAspect: false,
      fromCenter: false,
      minSize: 10,
      ...opts,
    });

  it('pins the opposite edge: dragging east moves the centre by half', () => {
    // 400 wide, drag the east handle 100 right -> 500 wide, and the west
    // edge must not have moved, so the centre moves 50.
    const r = drag('e', 100, 0);
    expect(r.box.width).toBeCloseTo(500, 9);
    expect(r.box.height).toBeCloseTo(200, 9);
    expect(r.cx).toBeCloseTo(960 + 50, 9);
    expect(r.cy).toBeCloseTo(540, 9);
    // The west edge is where it started.
    expect(r.cx - r.box.width / 2).toBeCloseTo(960 - 400 / 2, 9);
  });

  it('mirrors correctly on the west handle', () => {
    const r = drag('w', -100, 0);
    expect(r.box.width).toBeCloseTo(500, 9);
    expect(r.cx).toBeCloseTo(960 - 50, 9);
    // The east edge is where it started.
    expect(r.cx + r.box.width / 2).toBeCloseTo(960 + 400 / 2, 9);
  });

  it('an edge handle only moves its own axis', () => {
    const r = drag('e', 100, 999);
    expect(r.box.height).toBeCloseTo(200, 9);
    expect(r.cy).toBeCloseTo(540, 9);
  });

  it('a corner handle moves both axes', () => {
    const r = drag('se', 100, 40);
    expect(r.box.width).toBeCloseTo(500, 9);
    expect(r.box.height).toBeCloseTo(240, 9);
    expect(r.cx).toBeCloseTo(960 + 50, 9);
    expect(r.cy).toBeCloseTo(540 + 20, 9);
  });

  it('fromCenter doubles the growth and leaves the centre alone', () => {
    const r = drag('e', 100, 0, {}, { fromCenter: true });
    expect(r.box.width).toBeCloseTo(600, 9);
    expect(r.cx).toBeCloseTo(960, 9);
  });

  it('lockAspect keeps the ratio and does not drift the anchored edge', () => {
    const r = drag('e', 200, 0, {}, { lockAspect: true });
    expect(r.box.width / r.box.height).toBeCloseTo(400 / 200, 9);
    expect(r.box.width).toBeCloseTo(600, 9);
    // Growing height on an x-drag is centred, so cy must not move.
    expect(r.cy).toBeCloseTo(540, 9);
  });

  it('lockAspect on a corner follows whichever axis the pointer moved further', () => {
    const wide = drag('se', 200, 5, {}, { lockAspect: true });
    expect(wide.box.width).toBeCloseTo(600, 9);
    expect(wide.box.height).toBeCloseTo(300, 9);

    const tall = drag('se', 5, 200, {}, { lockAspect: true });
    expect(tall.box.height).toBeCloseTo(400, 9);
    expect(tall.box.width).toBeCloseTo(800, 9);
  });

  it('clamps to minSize instead of inverting the box', () => {
    // A drag past the opposite edge would otherwise produce a negative
    // width, which renders as nothing and hit-tests as everything.
    const r = drag('e', -100000, 0, {}, { minSize: 12 });
    expect(r.box.width).toBe(12);
    expect(r.box.width).toBeGreaterThan(0);
  });

  it('works in the box\'s own frame, so a rotated box resizes along its own axis', () => {
    /*
      On a box turned 90°, the local +x axis points down the screen.
      Dragging the east handle straight DOWN by 100 must therefore make
      the box 100 wider, and dragging it right must do nothing. Solving
      in canvas space instead would skew the box as it turns.
    */
    const down = drag('e', 0, 100, { rotation: 90 });
    expect(down.box.width).toBeCloseTo(500, 6);

    const right = drag('e', 100, 0, { rotation: 90 });
    expect(right.box.width).toBeCloseTo(400, 6);

    // …and the centre shift comes back out into canvas space: half the
    // growth, along the rotated local +x, which is screen +y.
    expect(down.cx).toBeCloseTo(960, 6);
    expect(down.cy).toBeCloseTo(540 + 50, 6);
  });

  it('derives scale from the base size the clip was built at', () => {
    const r = drag('e', 100, 0, { baseWidth: 1000, baseHeight: 500, scaleX: 0.4, scaleY: 0.4 });
    expect(r.scaleX).toBeCloseTo(500 / 1000, 9);
    expect(r.scaleY).toBeCloseTo(200 / 500, 9);
    expect(r.box.scaleX).toBe(r.scaleX);
  });

  it('keeps the old scale rather than dividing by a zero base', () => {
    // A text clip measured before its font loaded reports a zero base.
    const r = drag('e', 100, 0, { baseWidth: 0, baseHeight: 0, scaleX: 3, scaleY: 7 });
    expect(r.scaleX).toBe(3);
    expect(r.scaleY).toBe(7);
    expect(Number.isFinite(r.box.width)).toBe(true);
  });

  it('a zero drag is a no-op', () => {
    const r = drag('se', 0, 0);
    expect(r.cx).toBeCloseTo(960, 9);
    expect(r.cy).toBeCloseTo(540, 9);
    expect(r.box.width).toBeCloseTo(400, 9);
    expect(r.box.height).toBeCloseTo(200, 9);
  });
});

/* ── Angles ─────────────────────────────────────────────────────── */

describe('angle helpers', () => {
  it('angleFromCenter measures clockwise from straight up', () => {
    const c = { x: 0, y: 0 };
    expect(angleFromCenter(c, { x: 0, y: -10 })).toBeCloseTo(0, 9);
    expect(angleFromCenter(c, { x: 10, y: 0 })).toBeCloseTo(90, 9);
    expect(Math.abs(angleFromCenter(c, { x: 0, y: 10 }))).toBeCloseTo(180, 9);
    expect(angleFromCenter(c, { x: -10, y: 0 })).toBeCloseTo(-90, 9);
    expect(angleFromCenter(c, { x: 10, y: -10 })).toBeCloseTo(45, 9);
  });

  it('snapAngle catches the step at exactly the tolerance and lets go past it', () => {
    // Boundary is the contract; the comparison is `<=`.
    expect(snapAngle(19)).toBe(15); // 4 away. Snaps
    expect(snapAngle(20)).toBe(20); // 5 away. Free
    expect(snapAngle(11)).toBe(15);
    expect(snapAngle(10)).toBe(10);
    expect(snapAngle(45)).toBe(45);
    expect(snapAngle(47, 45, 4)).toBe(45);
    expect(snapAngle(52, 45, 4)).toBe(52);
  });

  it('normalizeAngle folds into -180..180 and rounds to a tenth', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(-190)).toBe(170);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(720 + 45)).toBe(45);
    expect(normalizeAngle(-720 - 45)).toBe(-45);
    expect(normalizeAngle(33.333333)).toBe(33.3);
    // The two boundaries are kept, not wrapped onto each other.
    expect(normalizeAngle(180)).toBe(180);
    expect(normalizeAngle(-180)).toBe(-180);
  });

  it('normalizeAngle output is always inside the stated range', () => {
    for (let d = -1000; d <= 1000; d += 7.3) {
      const a = normalizeAngle(d);
      expect(a, String(d)).toBeGreaterThanOrEqual(-180);
      expect(a, String(d)).toBeLessThanOrEqual(180);
    }
  });
});
