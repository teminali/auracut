/*
 * The timeline's time scale.
 *
 * Zoom used to be clamped in THREE places with the same two literals —
 * `setZoomLevel`, `zoomToFit`, and `Timeline`'s ⌘-wheel handler — so
 * moving the ceiling in one of them left the others pinned at the old
 * one and the controls disagreed about how far in you could go. There
 * is one clamp now, and these are the properties it has to hold.
 *
 * The ceiling is not a taste decision. This engine honours element
 * widths up to 16,777,214px and silently clamps beyond that, which
 * would put the lanes, the ruler and the playhead on three different
 * scales without anything failing. So a long project has to get a
 * LOWER ceiling rather than a broken one, and that is what most of
 * this file is about.
 */
import { describe, it, expect } from 'vitest';
import { BASE_PX_PER_MS, MIN_ZOOM, MAX_ZOOM, clampZoom, maxZoomFor } from './timelineStore';

/** Lane width in CSS pixels at a given zoom. */
const lanePx = (durationMs: number, zoom: number) => durationMs * BASE_PX_PER_MS * zoom;

/** Measured in the running app: widths above this are silently clamped. */
const ENGINE_LIMIT_PX = 16_777_214;

describe('the time scale', () => {
  it('turns milliseconds into pixels at the documented rate', () => {
    expect(BASE_PX_PER_MS).toBe(0.05);
    // 1x is 20ms per pixel; a 16s sequence is 800px, which is what the
    // default view is laid out around.
    expect(lanePx(16_000, 1)).toBe(800);
  });

  it('reaches millisecond scale at the ceiling, and says what that is in frames', () => {
    const pxPerMs = BASE_PX_PER_MS * MAX_ZOOM;
    expect(pxPerMs).toBe(4);
    // 30fps: a video frame is 1000/30 ms, so at the ceiling one frame
    // is this many pixels. The ruler may show ms; there is no frame
    // between two frames and nothing should draw one.
    expect(Math.round(pxPerMs * (1000 / 30))).toBe(133);
  });
});

describe('the clamp', () => {
  it('holds the floor and the ceiling for an ordinary project', () => {
    const d = 16_000;
    expect(clampZoom(0, d)).toBe(MIN_ZOOM);
    expect(clampZoom(-5, d)).toBe(MIN_ZOOM);
    expect(clampZoom(1e9, d)).toBe(MAX_ZOOM);
    expect(clampZoom(3.7, d)).toBe(3.7);
  });

  it('refuses a value that is not a number rather than propagating NaN', () => {
    // A NaN zoom silently makes every clip width NaN and empties the
    // timeline while reporting nothing.
    expect(clampZoom(NaN, 16_000)).toBe(MIN_ZOOM);
    expect(clampZoom(Infinity, 16_000)).toBe(MIN_ZOOM);
  });

  it('gives an empty project the full range rather than dividing by zero', () => {
    expect(maxZoomFor(0)).toBe(MAX_ZOOM);
    expect(clampZoom(50, 0)).toBe(50);
  });

  it('never lets any project out-measure what the engine will draw', () => {
    // An hour, three hours, and a full day of timeline.
    for (const durationMs of [16_000, 600_000, 3_600_000, 10_800_000, 86_400_000]) {
      const z = clampZoom(1e9, durationMs);
      expect(lanePx(durationMs, z)).toBeLessThanOrEqual(ENGINE_LIMIT_PX);
      // And the ceiling is still usable, not collapsed onto the floor.
      expect(z).toBeGreaterThan(MIN_ZOOM);
    }
  });

  it('lowers the ceiling for a long project instead of breaking it', () => {
    // Short enough to reach the nominal ceiling.
    expect(maxZoomFor(60_000)).toBe(MAX_ZOOM);
    // Long enough that the engine, not the design, decides.
    const long = maxZoomFor(3_600_000);
    expect(long).toBeLessThan(MAX_ZOOM);
    expect(long).toBeGreaterThan(1);
  });

  it('is monotonic: a longer project never gets a higher ceiling', () => {
    let prev = Infinity;
    for (const d of [1_000, 60_000, 600_000, 3_600_000, 86_400_000]) {
      const c = maxZoomFor(d);
      expect(c).toBeLessThanOrEqual(prev);
      prev = c;
    }
  });
});

describe('zoom to fit', () => {
  /* The store's own arithmetic, checked here because it is the one
     zoom the user cannot nudge afterwards — it has to land right. */
  const fit = (viewportPx: number, durationMs: number) =>
    clampZoom(viewportPx / (durationMs * BASE_PX_PER_MS), durationMs);

  it('puts the whole sequence in the viewport', () => {
    for (const [vp, d] of [[1226, 16_000], [800, 5_000], [1920, 600_000]] as const) {
      const z = fit(vp, d);
      expect(lanePx(d, z)).toBeCloseTo(vp, 6);
    }
  });

  it('does not zoom past the ceiling to fit a very short clip', () => {
    // 40ms of content in a 1226px viewport wants 613x; the ceiling is 80.
    expect(fit(1226, 40)).toBe(MAX_ZOOM);
  });

  it('does not zoom below the floor to fit a very long one', () => {
    expect(fit(400, 86_400_000)).toBe(MIN_ZOOM);
  });
});
