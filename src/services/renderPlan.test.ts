import { describe, it, expect } from 'vitest';
import { planFarm, chunkSize, chunkRanges, MAX_WORKERS } from './renderPlan';

/*
  The chunk arithmetic, tested for the property that cannot be seen by
  watching the render: that the pieces add up to the whole. A farm that
  loses one frame at a seam produces a file that plays.
*/

describe('chunkRanges', () => {
  const tile = (total: number, size: number) => {
    const ranges = chunkRanges(total, size);
    /* Contiguous: each chunk starts exactly where the last one ended. */
    let cursor = 0;
    for (const r of ranges) {
      expect(r.firstFrame).toBe(cursor);
      expect(r.frames).toBeGreaterThan(0);
      cursor += r.frames;
    }
    /* And together they are the whole render, no more and no less. */
    expect(cursor).toBe(total);
    return ranges;
  };

  it('tiles a render that divides evenly', () => {
    const ranges = tile(900, 300);
    expect(ranges).toHaveLength(3);
    expect(ranges[2]).toEqual({ index: 2, firstFrame: 600, frames: 300 });
  });

  it('tiles a render with a short last chunk', () => {
    const ranges = tile(4590, 400);
    expect(ranges).toHaveLength(12);
    expect(ranges[11].frames).toBe(4590 - 11 * 400);
  });

  it('tiles every awkward size it is given', () => {
    for (const total of [1, 2, 7, 29, 30, 31, 119, 120, 121, 1000, 4590, 10007]) {
      for (const size of [1, 2, 7, 30, 120, 400, 9999]) {
        tile(total, size);
      }
    }
  }, 15000);

  it('has nothing to do for an empty render', () => {
    expect(chunkRanges(0, 120)).toEqual([]);
    expect(chunkRanges(100, 0)).toEqual([]);
  });
});

describe('planFarm', () => {
  it('does not split a short render', () => {
    const plan = planFarm(60, 30, 4);
    expect(plan.chunked).toBe(false);
    expect(plan.workers).toBe(1);
    expect(plan.chunks).toBe(1);
  });

  it('splits a long one across the workers it was given', () => {
    const plan = planFarm(4590, 30, 4);
    expect(plan.chunked).toBe(true);
    expect(plan.workers).toBe(4);
    expect(plan.chunks).toBeGreaterThan(1);
  });

  it('honours an explicit choice of one window', () => {
    const plan = planFarm(4590, 30, 4, 1);
    expect(plan.chunked).toBe(false);
    expect(plan.workers).toBe(1);
  });

  it('never opens a window with no chunk for it', () => {
    /* Eight workers on a render only long enough for two chunks must not
       open eight windows to draw nothing in six of them. */
    for (const frames of [130, 250, 400, 900, 4590]) {
      const plan = planFarm(frames, 30, 8, 8);
      expect(plan.workers).toBeLessThanOrEqual(plan.chunks);
    }
  });

  it('clamps a request that makes no sense', () => {
    expect(planFarm(4590, 30, 4, 0).workers).toBe(1);
    expect(planFarm(4590, 30, 4, -3).workers).toBe(1);
    expect(planFarm(4590, 30, 4, 999).workers).toBeLessThanOrEqual(MAX_WORKERS);
  });

  it('plans chunks that tile the render it planned them for', () => {
    /* The two halves of the arithmetic have to agree, and this is the
       assertion that says so: whatever `planFarm` decides, the ranges
       built from it cover the render exactly once. */
    for (const frames of [90, 451, 1800, 4590, 17_999]) {
      for (const fps of [24, 30, 60]) {
        for (const workers of [1, 2, 3, 4, 8]) {
          const plan = planFarm(frames, fps, 4, workers);
          const ranges = chunkRanges(frames, plan.chunkFrames);
          expect(ranges).toHaveLength(plan.chunks);
          expect(ranges.reduce((n, r) => n + r.frames, 0)).toBe(frames);
        }
      }
    }
  });
});

describe('chunkSize', () => {
  it('never goes below four seconds of timeline', () => {
    for (const fps of [24, 30, 60]) {
      expect(chunkSize(100_000, fps, 8)).toBeGreaterThanOrEqual(fps * 4);
    }
  });

  it('grows with the render so the queue stays short', () => {
    expect(chunkSize(100_000, 30, 4)).toBeGreaterThan(chunkSize(10_000, 30, 4));
  });
});
