/* ═══════════════════════════════════════════════════════════════════
   Smart guides — Canva/Figma-style alignment while dragging on canvas.

   Two independent systems, both resolved per axis:
     1. Alignment snapping — edges & centres of the moving box line up with
        the canvas, its guides, or any other visible clip.
     2. Spacing snapping — the moving box takes on the same gap as an
        existing pair of neighbours (the "equal distance" pink bars).

   Everything is computed in CANVAS space; the caller converts to view.
   ═══════════════════════════════════════════════════════════════════ */

import { ClipBox, Rect, getBoxAABB } from './geometry';
import { ProjectSettings } from '../types/edl';

export type GuideAxis = 'x' | 'y';

export type GuideKind =
  | 'canvas-center'
  | 'canvas-edge'
  | 'canvas-third'
  | 'safe-area'
  | 'object-edge'
  | 'object-center'
  | 'spacing';

export interface AlignmentGuide {
  axis: GuideAxis;
  /** Canvas coordinate of the guide line. */
  position: number;
  kind: GuideKind;
  /** Extent of the line along the other axis, so guides don't span forever. */
  from: number;
  to: number;
  /** Id of the clip that produced the guide, when applicable. */
  sourceId?: string;
  label?: string;
}

/** A pair of equal gaps discovered during a drag. */
export interface SpacingIndicator {
  axis: GuideAxis;
  /** Rendered bars, in canvas space. */
  segments: { start: number; end: number; cross: number }[];
  distance: number;
}

export interface SnapCandidate {
  axis: GuideAxis;
  /** Where the guide sits. */
  guide: number;
  /** Which feature of the moving box aligns to it. */
  moving: number;
  kind: GuideKind;
  from: number;
  to: number;
  sourceId?: string;
}

export interface SnapResult {
  /** Correction to apply to the moving box's centre, in canvas px. */
  dx: number;
  dy: number;
  guides: AlignmentGuide[];
  spacing: SpacingIndicator[];
}

export interface SnapContext {
  project: ProjectSettings;
  /** AABBs of every other visible clip, keyed by clip id. */
  others: { id: string; rect: Rect }[];
  /** Snap distance in CANVAS px (derive from view px ÷ viewport scale). */
  threshold: number;
  enabled: boolean;
  /** Include rule-of-thirds and safe-area lines as snap targets. */
  includeGuides?: boolean;
}

/* ── Feature extraction ─────────────────────────────────────────── */

interface AxisFeatures {
  start: number;
  center: number;
  end: number;
}

const featuresX = (r: Rect): AxisFeatures => ({
  start: r.x,
  center: r.x + r.width / 2,
  end: r.x + r.width,
});

const featuresY = (r: Rect): AxisFeatures => ({
  start: r.y,
  center: r.y + r.height / 2,
  end: r.y + r.height,
});

/* ── Target construction ────────────────────────────────────────── */

interface Target {
  position: number;
  kind: GuideKind;
  from: number;
  to: number;
  sourceId?: string;
  /** Higher wins ties — canvas centre beats an arbitrary object edge. */
  priority: number;
}

function buildTargets(ctx: SnapContext, axis: GuideAxis): Target[] {
  const { project, others, includeGuides } = ctx;
  const size = axis === 'x' ? project.width : project.height;
  const cross = axis === 'x' ? project.height : project.width;
  const targets: Target[] = [];

  // Canvas centre — the strongest magnet.
  targets.push({ position: size / 2, kind: 'canvas-center', from: 0, to: cross, priority: 100 });

  // Canvas edges.
  targets.push({ position: 0, kind: 'canvas-edge', from: 0, to: cross, priority: 80 });
  targets.push({ position: size, kind: 'canvas-edge', from: 0, to: cross, priority: 80 });

  if (includeGuides) {
    targets.push({ position: size / 3, kind: 'canvas-third', from: 0, to: cross, priority: 40 });
    targets.push({ position: (size * 2) / 3, kind: 'canvas-third', from: 0, to: cross, priority: 40 });
    // Title-safe inset (10%).
    targets.push({ position: size * 0.1, kind: 'safe-area', from: 0, to: cross, priority: 50 });
    targets.push({ position: size * 0.9, kind: 'safe-area', from: 0, to: cross, priority: 50 });
  }

  // Every other clip contributes three lines per axis.
  for (const other of others) {
    const f = axis === 'x' ? featuresX(other.rect) : featuresY(other.rect);
    const from = axis === 'x' ? other.rect.y : other.rect.x;
    const to = axis === 'x' ? other.rect.y + other.rect.height : other.rect.x + other.rect.width;

    targets.push({ position: f.center, kind: 'object-center', from, to, sourceId: other.id, priority: 70 });
    targets.push({ position: f.start, kind: 'object-edge', from, to, sourceId: other.id, priority: 60 });
    targets.push({ position: f.end, kind: 'object-edge', from, to, sourceId: other.id, priority: 60 });
  }

  return targets;
}

/* ── Alignment resolution ───────────────────────────────────────── */

function resolveAxis(
  moving: AxisFeatures,
  movingFrom: number,
  movingTo: number,
  targets: Target[],
  threshold: number
): { delta: number; guides: AlignmentGuide[] } | null {
  const movingFeatures: { value: number; weight: number }[] = [
    { value: moving.center, weight: 3 },
    { value: moving.start, weight: 2 },
    { value: moving.end, weight: 2 },
  ];

  let best: { delta: number; score: number; target: Target; movingValue: number } | null = null;

  for (const mf of movingFeatures) {
    for (const t of targets) {
      const delta = t.position - mf.value;
      const dist = Math.abs(delta);
      if (dist > threshold) continue;

      // Prefer close snaps, then strong targets, then centre-to-centre.
      const score = (threshold - dist) * 10 + t.priority + mf.weight * 5;
      if (!best || score > best.score) {
        best = { delta, score, target: t, movingValue: mf.value };
      }
    }
  }

  if (!best) return null;

  // Once the axis is committed, surface EVERY target that now lines up so the
  // user sees the full set of relationships, not just the winner.
  const snappedFeatures = [
    moving.start + best.delta,
    moving.center + best.delta,
    moving.end + best.delta,
  ];

  const guides: AlignmentGuide[] = [];
  const seen = new Set<string>();

  for (const t of targets) {
    for (const sf of snappedFeatures) {
      if (Math.abs(t.position - sf) > 0.5) continue;
      const key = `${t.kind}:${Math.round(t.position)}:${t.sourceId ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      guides.push({
        axis: 'x',
        position: t.position,
        kind: t.kind,
        from: Math.min(t.from, movingFrom),
        to: Math.max(t.to, movingTo),
        sourceId: t.sourceId,
      });
    }
  }

  return { delta: best.delta, guides };
}

/* ── Spacing (equal-gap) detection ──────────────────────────────── */

function detectSpacing(
  movingRect: Rect,
  others: { id: string; rect: Rect }[],
  axis: GuideAxis,
  threshold: number
): { delta: number; indicator: SpacingIndicator } | null {
  if (others.length < 2) return null;

  const startOf = (r: Rect) => (axis === 'x' ? r.x : r.y);
  const endOf = (r: Rect) => (axis === 'x' ? r.x + r.width : r.y + r.height);
  const crossStart = (r: Rect) => (axis === 'x' ? r.y : r.x);
  const crossEnd = (r: Rect) => (axis === 'x' ? r.y + r.height : r.x + r.width);

  // Only consider clips that overlap the moving clip on the other axis —
  // otherwise "equal spacing" is meaningless.
  const overlapping = others.filter(
    (o) => crossEnd(o.rect) > crossStart(movingRect) && crossStart(o.rect) < crossEnd(movingRect)
  );
  if (overlapping.length < 2) return null;

  const sorted = [...overlapping].sort((a, b) => startOf(a.rect) - startOf(b.rect));

  let best: { delta: number; indicator: SpacingIndicator; dist: number } | null = null;

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i].rect;
    const b = sorted[i + 1].rect;
    const gap = startOf(b) - endOf(a);
    if (gap <= 0) continue;

    // Candidate 1: moving clip sits after `b`, same gap.
    const afterStart = endOf(b) + gap;
    const deltaAfter = afterStart - startOf(movingRect);
    if (Math.abs(deltaAfter) <= threshold) {
      const dist = Math.abs(deltaAfter);
      if (!best || dist < best.dist) {
        best = {
          delta: deltaAfter,
          dist,
          indicator: {
            axis,
            distance: Math.round(gap),
            segments: [
              { start: endOf(a), end: startOf(b), cross: crossStart(b) + (crossEnd(b) - crossStart(b)) / 2 },
              { start: endOf(b), end: afterStart, cross: crossStart(b) + (crossEnd(b) - crossStart(b)) / 2 },
            ],
          },
        };
      }
    }

    // Candidate 2: moving clip sits before `a`, same gap.
    const beforeEnd = startOf(a) - gap;
    const deltaBefore = beforeEnd - endOf(movingRect);
    if (Math.abs(deltaBefore) <= threshold) {
      const dist = Math.abs(deltaBefore);
      if (!best || dist < best.dist) {
        best = {
          delta: deltaBefore,
          dist,
          indicator: {
            axis,
            distance: Math.round(gap),
            segments: [
              { start: beforeEnd, end: startOf(a), cross: crossStart(a) + (crossEnd(a) - crossStart(a)) / 2 },
              { start: endOf(a), end: startOf(b), cross: crossStart(a) + (crossEnd(a) - crossStart(a)) / 2 },
            ],
          },
        };
      }
    }

    // Candidate 3: moving clip lands centred between `a` and `b`.
    const movingSize = axis === 'x' ? movingRect.width : movingRect.height;
    const innerGap = (gap - movingSize) / 2;
    if (innerGap > 0) {
      const centeredStart = endOf(a) + innerGap;
      const deltaCenter = centeredStart - startOf(movingRect);
      if (Math.abs(deltaCenter) <= threshold) {
        const dist = Math.abs(deltaCenter);
        if (!best || dist < best.dist) {
          const cross = crossStart(movingRect) + (crossEnd(movingRect) - crossStart(movingRect)) / 2;
          best = {
            delta: deltaCenter,
            dist,
            indicator: {
              axis,
              distance: Math.round(innerGap),
              segments: [
                { start: endOf(a), end: centeredStart, cross },
                { start: centeredStart + movingSize, end: startOf(b), cross },
              ],
            },
          };
        }
      }
    }
  }

  return best ? { delta: best.delta, indicator: best.indicator } : null;
}

/* ── Public API ─────────────────────────────────────────────────── */

/**
 * Resolve snapping for a box being dragged/resized.
 * Returns the correction to apply plus the guides worth drawing.
 */
export function resolveSnap(box: ClipBox, ctx: SnapContext): SnapResult {
  const empty: SnapResult = { dx: 0, dy: 0, guides: [], spacing: [] };
  if (!ctx.enabled || ctx.threshold <= 0) return empty;

  const rect = getBoxAABB(box);

  const targetsX = buildTargets(ctx, 'x');
  const targetsY = buildTargets(ctx, 'y');

  const resX = resolveAxis(featuresX(rect), rect.y, rect.y + rect.height, targetsX, ctx.threshold);
  const resY = resolveAxis(featuresY(rect), rect.x, rect.x + rect.width, targetsY, ctx.threshold);

  const guides: AlignmentGuide[] = [];
  const spacing: SpacingIndicator[] = [];

  let dx = 0;
  let dy = 0;

  if (resX) {
    dx = resX.delta;
    guides.push(...resX.guides.map((g) => ({ ...g, axis: 'x' as GuideAxis })));
  }
  if (resY) {
    dy = resY.delta;
    guides.push(...resY.guides.map((g) => ({ ...g, axis: 'y' as GuideAxis })));
  }

  // Spacing only steps in where alignment left the axis free — an explicit
  // edge match should always win over an inferred equal gap.
  if (!resX) {
    const sp = detectSpacing(rect, ctx.others, 'x', ctx.threshold);
    if (sp) {
      dx = sp.delta;
      spacing.push(sp.indicator);
    }
  }
  if (!resY) {
    const sp = detectSpacing(rect, ctx.others, 'y', ctx.threshold);
    if (sp) {
      dy = sp.delta;
      spacing.push(sp.indicator);
    }
  }

  return { dx, dy, guides, spacing };
}

/* ── Align & distribute (toolbar actions) ───────────────────────── */

export type AlignAction =
  | 'left' | 'center-h' | 'right'
  | 'top'  | 'center-v' | 'bottom';

/** Where a box's centre must move to satisfy an align action against the canvas. */
export function alignToCanvas(
  box: ClipBox,
  project: ProjectSettings,
  action: AlignAction
): { cx: number; cy: number } {
  const rect = getBoxAABB(box);
  // Offset between the AABB centre and the true centre (non-zero when rotated).
  const offX = box.cx - (rect.x + rect.width / 2);
  const offY = box.cy - (rect.y + rect.height / 2);

  let cx = box.cx;
  let cy = box.cy;

  switch (action) {
    case 'left':     cx = rect.width / 2 + offX; break;
    case 'center-h': cx = project.width / 2 + offX; break;
    case 'right':    cx = project.width - rect.width / 2 + offX; break;
    case 'top':      cy = rect.height / 2 + offY; break;
    case 'center-v': cy = project.height / 2 + offY; break;
    case 'bottom':   cy = project.height - rect.height / 2 + offY; break;
  }

  return { cx, cy };
}
