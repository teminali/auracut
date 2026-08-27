/*
 * The auto zoom is two pieces of arithmetic wearing a feature.
 *
 *   1. Deciding WHERE to look, from a cursor track. Every part of that
 *      is a threshold, and thresholds are exactly what drifts when
 *      somebody tunes one number by eye against one recording.
 *
 *   2. Deciding where the clip has to SIT for a chosen point to land on
 *      the canvas centre, and refusing to push past the footage. The
 *      clamp is the half that cannot be checked by looking: an unclamped
 *      pan shows the project background down one edge for a few frames
 *      and reads as a rendering glitch rather than as bad geometry.
 *
 * Neither needs the app, a display, or a camera, so both are pinned
 * here rather than left to be noticed in a take.
 */
import { describe, it, expect } from 'vitest';
import { CursorSample, InputEvent } from '../types/electron';
import {
  findZoomMoments, momentsFromEvents, detectMoments, planZoom, focusOffset,
  zoomKeyframes, DEFAULT_SHAPE, CUT_SHAPE, CLOSE_CURVE, CUT_GAP_MS, SOURCE_STRENGTH,
  ZoomMoment, MomentSource,
} from './cursorZoom';

/** A moment, without repeating the bookkeeping fields at every call site. */
const at = (
  atMs: number, x: number, y: number,
  source: MomentSource = 'settle', spanMs = 0
): ZoomMoment => ({ atMs, x, y, source, spanMs, weight: 1 });

/* ── A synthetic cursor track ───────────────────────────────────── */

const HZ = 30;

interface Leg {
  x: number;
  y: number;
  ms: number;
  /** Travel to (x, y) across the leg, rather than sitting at it. */
  move?: boolean;
}

/** Sample a path at the same rate the main process does. */
function makeTrack(legs: Leg[]): CursorSample[] {
  const out: CursorSample[] = [];
  let t = 0;
  let px = legs[0].x;
  let py = legs[0].y;

  for (const leg of legs) {
    const steps = Math.max(1, Math.round(leg.ms / (1000 / HZ)));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      out.push({
        tMs: Math.round(t + leg.ms * k),
        x: leg.move ? px + (leg.x - px) * k : leg.x,
        y: leg.move ? py + (leg.y - py) * k : leg.y,
      });
    }
    t += leg.ms;
    px = leg.x;
    py = leg.y;
  }
  return out;
}

describe('finding the moments', () => {
  it('reports travel-then-stillness as one moment, at the resting place', () => {
    const track = makeTrack([
      { x: 0.1, y: 0.1, ms: 400 },
      { x: 0.8, y: 0.6, ms: 400, move: true },
      { x: 0.8, y: 0.6, ms: 900 },
    ]);

    const moments = findZoomMoments(track, []);
    expect(moments).toHaveLength(1);
    expect(moments[0].source).toBe('settle');
    // Where it stopped, not where it started or the midpoint.
    expect(moments[0].x).toBeCloseTo(0.8, 2);
    expect(moments[0].y).toBeCloseTo(0.6, 2);
    // And when it stopped, which is the start of the dwell.
    expect(moments[0].atMs).toBeGreaterThan(700);
    expect(moments[0].atMs).toBeLessThan(900);
  });

  it('reports nothing for a pointer that never moved', () => {
    /* The control for the check above. Slowness on its own is not a
       signal — the pointer is slow for most of any recording — so a
       stationary track must produce nothing at all. */
    const track = makeTrack([{ x: 0.5, y: 0.5, ms: 8000 }]);
    expect(findZoomMoments(track, [])).toHaveLength(0);
  });

  it('reports nothing for a pointer that never stopped', () => {
    const track = makeTrack([
      { x: 0.05, y: 0.05, ms: 100 },
      { x: 0.95, y: 0.95, ms: 3000, move: true },
    ]);
    expect(findZoomMoments(track, [])).toHaveLength(0);
  });

  it('keeps two moments apart by at least the minimum gap', () => {
    /* Two real settles 800ms apart. Honouring both would push in,
       pull out and push in again inside a second, which is the single
       thing that makes an auto-zoomed recording unwatchable. */
    const track = makeTrack([
      { x: 0.1, y: 0.1, ms: 400 },
      { x: 0.8, y: 0.2, ms: 300, move: true },
      { x: 0.8, y: 0.2, ms: 500 },
      { x: 0.2, y: 0.8, ms: 300, move: true },
      { x: 0.2, y: 0.8, ms: 800 },
    ]);

    const moments = findZoomMoments(track, []);
    expect(moments).toHaveLength(1);
    expect(moments[0].x).toBeCloseTo(0.8, 2);
  });

  it('ignores a settle that barely travelled', () => {
    const track = makeTrack([
      { x: 0.50, y: 0.50, ms: 400 },
      { x: 0.52, y: 0.51, ms: 60, move: true },
      { x: 0.52, y: 0.51, ms: 900 },
    ]);
    expect(findZoomMoments(track, [])).toHaveLength(0);
  });

  it('ignores samples taken while the pointer was on another display', () => {
    /* Main records these UNCLAMPED on purpose. Clamping them would put
       a long, perfectly still dwell against the frame edge, which is
       the exact shape of a real settle. */
    const offscreen = makeTrack([
      { x: 1.8, y: 0.4, ms: 400 },
      { x: 2.4, y: 0.9, ms: 300, move: true },
      { x: 2.4, y: 0.9, ms: 900 },
    ]);
    expect(findZoomMoments(offscreen, [])).toHaveLength(0);
  });

  it('always keeps a mark, and lets it displace an inferred neighbour', () => {
    const track = makeTrack([
      { x: 0.1, y: 0.1, ms: 400 },
      { x: 0.8, y: 0.6, ms: 400, move: true },
      { x: 0.8, y: 0.6, ms: 900 },
    ]);

    const inferred = findZoomMoments(track, []);
    expect(inferred).toHaveLength(1);

    const withMark = findZoomMoments(track, [820]);
    expect(withMark).toHaveLength(1);
    expect(withMark[0].source).toBe('mark');
    expect(withMark[0].atMs).toBe(820);
    // A mark takes its focus point from where the pointer actually was.
    expect(withMark[0].x).toBeCloseTo(0.8, 2);
  });

  it('keeps a mark that stands on its own, far from any settle', () => {
    const track = makeTrack([{ x: 0.3, y: 0.7, ms: 9000 }]);
    const moments = findZoomMoments(track, [4000]);
    expect(moments).toHaveLength(1);
    expect(moments[0].source).toBe('mark');
    expect(moments[0].x).toBeCloseTo(0.3, 2);
  });
});

/* ── Real input ─────────────────────────────────────────────────── */

const ev = (tMs: number, kind: InputEvent['kind'], x: number, y: number): InputEvent =>
  ({ tMs, kind, x, y });

describe('moments from real input', () => {
  it('makes one moment out of a run of clicks in one place', () => {
    /*
      The reason clustering exists. A double click, or clicking through a
      stepper, is ONE thing to look at; a zoom per click is eleven zooms
      in four seconds and is unwatchable.
    */
    const moments = momentsFromEvents(
      [
        ev(1000, 'click', 0.4, 0.4),
        ev(1180, 'click', 0.4, 0.4),
        ev(1600, 'click', 0.42, 0.41),
      ],
      []
    );

    expect(moments).toHaveLength(1);
    expect(moments[0].source).toBe('click');
    expect(moments[0].atMs).toBe(1000);
    expect(moments[0].weight).toBe(3);
    // The hold covers the whole run, not just the first click.
    expect(moments[0].spanMs).toBe(600);
  });

  it('separates clicks that are far apart on screen', () => {
    /* Same timing as above, opposite corners. Time alone would merge
       them, and the frame would sit between two things and show
       neither. */
    const moments = momentsFromEvents(
      [ev(1000, 'click', 0.15, 0.15), ev(1180, 'click', 0.85, 0.85)],
      []
    );
    expect(moments.map((m) => m.source)).toEqual(['click']);
    // Merged down by the minimum gap rather than clustered — one survives.
    expect(moments[0].atMs).toBe(1000);
  });

  it('lets typing extend the click that started it', () => {
    /*
      Click a field, type into it. One idea, one zoom, held for the
      typing. A second moment here would push in on the same spot again
      halfway through a sentence.
    */
    const events: InputEvent[] = [ev(1000, 'click', 0.5, 0.5)];
    for (let t = 1300; t <= 4000; t += 150) events.push(ev(t, 'key', 0.5, 0.5));

    const moments = momentsFromEvents(events, []);
    expect(moments).toHaveLength(1);
    expect(moments[0].source).toBe('click');
    expect(moments[0].spanMs).toBeGreaterThan(2800);
  });

  it('gives typing out of nowhere its own, gentler moment', () => {
    const events: InputEvent[] = [];
    for (let t = 1000; t <= 3000; t += 150) events.push(ev(t, 'key', 0.5, 0.5));

    const moments = momentsFromEvents(events, []);
    expect(moments).toHaveLength(1);
    expect(moments[0].source).toBe('type');
    expect(SOURCE_STRENGTH.type).toBeLessThan(SOURCE_STRENGTH.click);
  });

  it('treats a scroll burst as one moment, and never folds it into a click', () => {
    const events: InputEvent[] = [ev(500, 'click', 0.2, 0.2)];
    for (let t = 3000; t <= 4400; t += 120) events.push(ev(t, 'scroll', 0.6, 0.5));

    const moments = momentsFromEvents(events, []);
    expect(moments.map((m) => m.source)).toEqual(['click', 'scroll']);
    expect(moments[1].spanMs).toBeGreaterThan(1200);
  });

  it('lets a mark displace a click it lands on top of', () => {
    /* A mark is the only signal here that is not an inference OR an
       automatic reading of intent, so it outranks everything. */
    const moments = momentsFromEvents([ev(2000, 'click', 0.3, 0.3)], [2100]);
    expect(moments).toHaveLength(1);
    expect(moments[0].source).toBe('mark');
  });

  it('ignores events recorded while the pointer was on another display', () => {
    const moments = momentsFromEvents(
      [ev(1000, 'click', 1.7, 0.4), ev(1500, 'click', 2.2, 0.6)],
      []
    );
    expect(moments).toHaveLength(0);
  });

  it('reports which detector it used, and prefers real input', () => {
    const cursor: CursorSample[] = makeTrack([
      { x: 0.1, y: 0.1, ms: 400 },
      { x: 0.8, y: 0.6, ms: 400, move: true },
      { x: 0.8, y: 0.6, ms: 900 },
    ]);

    const withEvents = detectMoments({ cursor, events: [ev(1200, 'click', 0.25, 0.7)], marks: [] });
    expect(withEvents.from).toBe('events');
    expect(withEvents.moments[0].source).toBe('click');
    expect(withEvents.moments[0].x).toBeCloseTo(0.25, 3);

    /* A hook that started and saw nothing must not stop the fallback
       from having a go: four seconds of nobody touching anything is not
       the same as no detector. */
    const withoutEvents = detectMoments({ cursor, events: [], marks: [] });
    expect(withoutEvents.from).toBe('cursor');
    expect(withoutEvents.moments[0].source).toBe('settle');
  });
});

/* ── The move ───────────────────────────────────────────────────── */

describe('planning the move', () => {
  /* The target is no longer just `shape.factor`: each kind of moment
     pushes by its own share of it, so a scroll sits wider than a click. */
  const target = (source: MomentSource) => DEFAULT_SHAPE.factor * SOURCE_STRENGTH[source];
  const F = target('settle');

  it('starts at full frame', () => {
    const plan = planZoom([at(2000, 0.4, 0.4, 'settle')], 6000);
    expect(plan[0].tMs).toBe(0);
    expect(plan[0].factor).toBe(1);
  });

  it('runs strictly forward in time', () => {
    const plan = planZoom(
      [
        at(900, 0.2, 0.2, 'settle'),
        at(2000, 0.7, 0.5, 'settle'),
        at(9000, 0.5, 0.8, 'settle'),
      ],
      14000
    );
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].tMs).toBeGreaterThan(plan[i - 1].tMs);
    }
  });

  it('pulls back out when there is room before the next moment', () => {
    const plan = planZoom(
      [
        at(1000, 0.3, 0.3, 'settle'),
        at(6000, 0.7, 0.7, 'settle'),
      ],
      9000
    );
    const between = plan.filter((s) => s.tMs > 1500 && s.tMs < 5500);
    expect(between.some((s) => s.factor === 1)).toBe(true);
  });

  it('chains instead of bouncing when the next moment arrives first', () => {
    /*
      The judgement this whole module exists for. Two moments a second
      apart must travel from one to the other AT ZOOM; snapping back to
      full frame in between is the artefact.
    */
    const plan = planZoom(
      [
        at(1000, 0.3, 0.3, 'settle'),
        at(2000, 0.7, 0.7, 'settle'),
      ],
      9000
    );

    const zoomed = plan.filter((s) => s.factor > 1);
    const first = zoomed[0];
    const last = zoomed[zoomed.length - 1];
    const interior = plan.filter((s) => s.tMs > first.tMs && s.tMs < last.tMs);

    expect(interior.length).toBeGreaterThan(0);
    // Nothing between the two pushes may return to full frame.
    expect(interior.every((s) => s.factor > 1)).toBe(true);
  });

  it('pushes a scroll less hard than a click', () => {
    /* Reading wants a wider frame than pointing does. Treating the two
       the same is most of what makes an auto zoom feel mechanical. */
    const click = planZoom([at(2000, 0.5, 0.5, 'click')], 9000);
    const scroll = planZoom([at(2000, 0.5, 0.5, 'scroll')], 9000);
    const peak = (plan: { factor: number }[]) => Math.max(...plan.map((s) => s.factor));

    expect(peak(click)).toBeGreaterThan(peak(scroll));
    expect(peak(click)).toBeCloseTo(target('click') * (1 + DEFAULT_SHAPE.overshoot), 5);
  });

  it('overshoots and settles rather than stopping dead', () => {
    const plan = planZoom([at(2000, 0.5, 0.5, 'click')], 9000);
    const peak = Math.max(...plan.map((s) => s.factor));
    const settled = plan.filter((s) => s.factor > 1 && s.factor < peak);

    expect(peak).toBeGreaterThan(target('click'));
    expect(settled.some((s) => Math.abs(s.factor - target('click')) < 1e-9)).toBe(true);
  });

  it('holds for as long as the moment spanned', () => {
    /* Eight clicks and forty keystrokes over six seconds are one zoom
       that stays for six seconds, not three zooms fighting each other. */
    const brief = planZoom([at(2000, 0.5, 0.5, 'click', 0)], 20000);
    const long = planZoom([at(2000, 0.5, 0.5, 'click', 6000)], 20000);
    const zoomedFor = (plan: { tMs: number; factor: number }[]) => {
      const zoomed = plan.filter((s) => s.factor > 1);
      return zoomed[zoomed.length - 1].tMs - zoomed[0].tMs;
    };

    expect(zoomedFor(long) - zoomedFor(brief)).toBeCloseTo(6000, 0);
  });

  it('carries a real curve, not the default easing', () => {
    /* The expo-out push is most of the feel, and it only exists if the
       bezier control points actually reach the keyframe. */
    const plan = planZoom([at(2000, 0.5, 0.5, 'click')], 9000);
    const curved = plan.filter((s) => s.easing === 'bezier');
    expect(curved.length).toBeGreaterThan(0);
    expect(curved.every((s) => Array.isArray(s.bezier) && s.bezier!.length === 4)).toBe(true);
  });

  it('ends back at full frame', () => {
    const plan = planZoom([at(1000, 0.3, 0.3, 'settle')], 9000);
    expect(plan[plan.length - 1].factor).toBe(1);
  });

  it('plans nothing when there is nothing to look at', () => {
    expect(planZoom([], 9000)).toEqual([]);
  });
});

/* ── Cutting ────────────────────────────────────────────────────── */

describe('cutting instead of pushing', () => {
  /*
    Everything here is against the reference video's own measurements,
    which are written out on `CUT_SHAPE`. These tests are the pure half:
    they say the PLAN has the shape the reference has. The pixel half is
    `skills/tutorial/verify.py`, which renders the frames either side of
    a cut and measures what actually changed.
  */
  const target = (source: MomentSource) => CUT_SHAPE.factor * SOURCE_STRENGTH[source];

  const scaleAt = (plan: ReturnType<typeof planZoom>, tMs: number) => {
    /* The same rule `interpolateKeyframes` follows, so a claim here is a
       claim about what will render: the easing belongs to the OUTGOING
       stop, and `hold` means the outgoing value stands until the next. */
    let before = plan[0];
    let after = plan[plan.length - 1];
    for (const stop of plan) {
      if (stop.tMs <= tMs && stop.tMs >= before.tMs) before = stop;
      if (stop.tMs >= tMs && stop.tMs <= after.tMs) after = stop;
    }
    if (before === after || after.tMs <= before.tMs) return before.factor;
    if (before.easing === 'hold') return before.factor;
    const k = (tMs - before.tMs) / (after.tMs - before.tMs);
    return before.factor + (after.factor - before.factor) * k;
  };

  it('changes the framing in a single frame, not over a push', () => {
    const plan = planZoom([at(3000, 0.5, 0.5, 'click')], 12000, CUT_SHAPE);
    const cutAt = 3000 - CUT_SHAPE.leadMs;

    /* 60fps is the reference's rate and the fastest the EDL allows, so a
       transition that is invisible at one frame of it is invisible. */
    const frame = 1000 / 60;
    expect(scaleAt(plan, cutAt - frame)).toBeLessThan(1.2);
    expect(scaleAt(plan, cutAt)).toBeCloseTo(target('click'), 5);
  });

  it('writes the cut as a hold keyframe and its successor', () => {
    const plan = planZoom([at(3000, 0.5, 0.5, 'click')], 12000, CUT_SHAPE);
    const cutAt = 3000 - CUT_SHAPE.leadMs;
    const outgoing = plan.filter((s) => s.easing === 'hold' && s.tMs < cutAt);
    expect(outgoing.length).toBeGreaterThan(0);
    const last = outgoing[outgoing.length - 1];
    /* The gap is not what makes it instantaneous — `hold` is — but it
       must stay inside one frame at the fastest rate the EDL allows, or
       the two keyframes could straddle a rendered frame. */
    expect(cutAt - last.tMs).toBe(CUT_GAP_MS);
    expect(CUT_GAP_MS).toBeLessThanOrEqual(Math.ceil(1000 / 60));
  });

  it('never pushes, so nothing on the way in carries a curve', () => {
    /* The one bezier in the whole plan is the closing move. A second one
       would mean something animated that the reference cuts. */
    const plan = planZoom([at(3000, 0.5, 0.5, 'click')], 12000, CUT_SHAPE);
    const curved = plan.filter((s) => s.easing === 'bezier');
    expect(curved).toHaveLength(1);
    expect(curved[0].bezier).toEqual(CLOSE_CURVE);
  });

  it('creeps while a framing is held, and is never locked off', () => {
    /* All four of the reference's shots drift. A cut edit whose shots
       hold perfectly still is a slideshow. */
    const plan = planZoom([at(3000, 0.5, 0.5, 'click')], 20000, CUT_SHAPE);
    const cutAt = 3000 - CUT_SHAPE.leadMs;
    const arrived = scaleAt(plan, cutAt);
    const later = scaleAt(plan, cutAt + 1000);
    expect(later).toBeGreaterThan(arrived);
    /* 3%/s, which is what was measured; a tenth of that would pass a
       "did it move" test and read as still. */
    expect((later / arrived - 1) * 100).toBeCloseTo(CUT_SHAPE.driftPctPerSec, 1);
  });

  it('caps the creep, so a long hold does not compound into a zoom', () => {
    const plan = planZoom([at(3000, 0.5, 0.5, 'click', 60000)], 90000, CUT_SHAPE);
    const peak = Math.max(...plan.map((s) => s.factor));
    expect(peak).toBeLessThan(target('click') * 1.2);
  });

  it('cuts straight from one framing to the next when they are close', () => {
    /* The reference cuts close-to-close three times and never opens out
       in between. A rest stop here would be a flash of wide. */
    const plan = planZoom(
      [at(3000, 0.3, 0.3, 'click'), at(5500, 0.7, 0.7, 'click')],
      20000, CUT_SHAPE
    );
    const first = 3000 - CUT_SHAPE.leadMs;
    const second = 5500 - CUT_SHAPE.leadMs;
    const between = plan.filter((s) => s.tMs > first && s.tMs < second);
    expect(between.length).toBeGreaterThan(0);
    expect(between.every((s) => s.factor > 1)).toBe(true);
  });

  it('does cut back to rest when the gap buys a whole rest shot', () => {
    const plan = planZoom(
      [at(3000, 0.3, 0.3, 'click'), at(30000, 0.7, 0.7, 'click')],
      45000, CUT_SHAPE
    );
    const between = plan.filter((s) => s.tMs > 3000 && s.tMs < 29000);
    expect(between.some((s) => s.factor === 1)).toBe(true);
  });

  it('ends where it opened, which is the reference\'s own bookend', () => {
    /* f563 matched against f0 fits at scale 1.000, rotation 0.001deg and
       0.008px of translation on 394 of 411 inliers. The film lands back
       on the frame it started on, and so does this. */
    const plan = planZoom([at(3000, 0.2, 0.8, 'click')], 12000, CUT_SHAPE);
    const first = plan[0];
    const last = plan[plan.length - 1];
    expect(last.factor).toBe(first.factor);
    expect(last.x).toBe(first.x);
    expect(last.y).toBe(first.y);
    expect(last.tMs).toBe(12000);
  });

  it('gives the closing move the measured length, on the measured curve', () => {
    const plan = planZoom([at(3000, 0.5, 0.5, 'click')], 12000, CUT_SHAPE);
    const launch = plan.find((s) => s.easing === 'bezier')!;
    const land = plan[plan.length - 1];
    expect(land.tMs - launch.tMs).toBeCloseTo(CUT_SHAPE.closeMs, 0);
  });

  it('lands the closing move by restByMs, so a fade never covers it', () => {
    /* The cinematic look dips to black over the last 620ms. The move is
       2100ms. Without this the film fades out mid-camera-move. */
    const plan = planZoom([at(3000, 0.5, 0.5, 'click')], 12000, CUT_SHAPE, 11380);
    const land = plan[plan.length - 1];
    expect(land.tMs).toBe(11380);
    expect(land.factor).toBe(1);
  });

  it('runs strictly forward in time, however the moments fall', () => {
    for (const moments of [
      [at(100, 0.5, 0.5, 'click')],
      [at(3000, 0.2, 0.2, 'click'), at(3100, 0.8, 0.8, 'click')],
      [at(500, 0.2, 0.2, 'click'), at(9000, 0.8, 0.8, 'scroll'), at(9200, 0.4, 0.4, 'type')],
    ]) {
      const plan = planZoom(moments, 12000, CUT_SHAPE);
      for (let i = 1; i < plan.length; i++) {
        expect(plan[i].tMs).toBeGreaterThan(plan[i - 1].tMs);
      }
    }
  });

  it('still writes all four properties at every stop', () => {
    const keys = zoomKeyframes(
      [at(3000, 0.3, 0.3, 'click')], 12000,
      { baseWidth: 1920, baseHeight: 1080, restScale: 1, canvasWidth: 1920, canvasHeight: 1080 },
      CUT_SHAPE
    );
    const plan = planZoom([at(3000, 0.3, 0.3, 'click')], 12000, CUT_SHAPE);
    expect(keys).toHaveLength(plan.length * 4);
    expect(keys.filter((k) => k.easing === 'hold').length).toBeGreaterThan(0);
  });
});

/* ── Geometry ───────────────────────────────────────────────────── */

describe('where the clip has to sit', () => {
  const geometry = {
    baseWidth: 1920,
    baseHeight: 1080,
    restScale: 1,
    canvasWidth: 1920,
    canvasHeight: 1080,
  };

  it('puts the chosen point on the canvas centre', () => {
    /* At 1.5x the frame is 2880 wide, so a point 45% across the source
       is 144px left of the middle and the clip moves 144px right. */
    const offset = focusOffset(0.45, 0.5, 1.5, geometry);
    expect(offset.x).toBeCloseTo(2880 * 0.05, 3);
    expect(offset.y).toBeCloseTo(0, 3);
  });

  it('refuses to pan the edge of the footage into frame', () => {
    const scale = 1.5;
    const limit = (geometry.baseWidth * scale - geometry.canvasWidth) / 2;
    // A point in the far corner asks for far more travel than exists.
    const offset = focusOffset(0, 0, scale, geometry);
    expect(offset.x).toBeCloseTo(limit, 3);
    expect(offset.y).toBeCloseTo((geometry.baseHeight * scale - geometry.canvasHeight) / 2, 3);
  });

  it('cannot move at all at rest', () => {
    // At scale 1 the frame exactly covers the canvas; any pan shows background.
    expect(focusOffset(0.05, 0.95, 1, geometry)).toEqual({ x: 0, y: 0 });
  });

  it('honours a resting scale below 1 when it builds the keyframes', () => {
    /*
      A 16:10 display in a canvas cut to 16:10 rests at 1. Rounding the
      canvas to even pixels can leave it a hair under, and the zoom has
      to be built on the measured value or the first frame of every push
      steps by a fraction of a pixel.
    */
    const keyframes = zoomKeyframes(
      [at(1000, 0.5, 0.5, 'settle')],
      6000,
      { ...geometry, restScale: 0.9 },
      DEFAULT_SHAPE
    );
    const scales = keyframes.filter((k) => k.property === 'scaleX').map((k) => k.value);
    expect(Math.min(...scales)).toBeCloseTo(0.9, 5);
    // Rest scale, times the moment's own strength, times the overshoot.
    expect(Math.max(...scales)).toBeCloseTo(
      0.9 * DEFAULT_SHAPE.factor * SOURCE_STRENGTH.settle * (1 + DEFAULT_SHAPE.overshoot),
      5
    );
  });

  it('puts the bezier control points on the keyframes themselves', () => {
    /*
      `interpolateKeyframes` reads `bezierPoints` off the keyframe BEFORE
      each segment. An easing of 'bezier' with no points silently falls
      back to a default curve, which is the exact shape of a bug that
      looks like nothing at all.
    */
    const keyframes = zoomKeyframes(
      [at(1000, 0.3, 0.3, 'click')],
      9000,
      geometry,
      DEFAULT_SHAPE
    );
    const curved = keyframes.filter((k) => k.easing === 'bezier');
    expect(curved.length).toBeGreaterThan(0);
    expect(curved.every((k) => k.bezierPoints?.length === 4)).toBe(true);
  });

  it('writes all four properties at every stop, and never past the clip', () => {
    const keyframes = zoomKeyframes(
      [
        at(1000, 0.3, 0.3, 'settle'),
        at(5000, 0.7, 0.7, 'settle'),
      ],
      9000,
      geometry,
      DEFAULT_SHAPE
    );

    expect(keyframes.length % 4).toBe(0);
    for (const property of ['scaleX', 'scaleY', 'positionX', 'positionY'] as const) {
      expect(keyframes.filter((k) => k.property === property)).toHaveLength(keyframes.length / 4);
    }
    expect(keyframes.every((k) => k.timeOffsetMs >= 0 && k.timeOffsetMs <= 9000)).toBe(true);
    // scaleX and scaleY must never diverge, or the picture is stretched.
    const x = keyframes.filter((k) => k.property === 'scaleX').map((k) => k.value);
    const y = keyframes.filter((k) => k.property === 'scaleY').map((k) => k.value);
    expect(x).toEqual(y);
  });

  it('writes nothing when nothing was found', () => {
    expect(zoomKeyframes([], 9000, geometry, DEFAULT_SHAPE)).toEqual([]);
  });
});
