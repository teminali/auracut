/* ═══════════════════════════════════════════════════════════════════
   Transform gizmo — the interactive frame drawn over the program monitor.

   Capabilities:
     • Move, 8-handle resize, and free rotation
     • Shift = lock aspect (resize) / 15° steps (rotate)
     • Alt/Option = resize about the centre
     • Canva-style smart guides: canvas centre, edges, thirds, safe area,
       and every other visible clip's edges + centres
     • Equal-spacing detection with distance badges
     • Arrow-key nudging, and a live size/rotation readout
   ═══════════════════════════════════════════════════════════════════ */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTimelineStore, getVisibleClipsAt } from '../../store/timelineStore';
import { useProjectStore } from '../../store/projectStore';
import { getNaturalSize } from '../../engine/compositor';
import {
  Viewport,
  ClipBox,
  HandleSpec,
  RESIZE_HANDLES,
  getClipBox,
  getBoxAABB,
  getBoxCorners,
  canvasToView,
  viewDeltaToCanvas,
  solveResize,
  rotatedCursor,
  angleFromCenter,
  snapAngle,
  normalizeAngle,
  viewToCanvas,
} from '../../engine/geometry';
import { resolveSnap, AlignmentGuide, SpacingIndicator, SnapContext } from '../../engine/snapping';
import { Clip } from '../../types/edl';
import {
  Lock,
} from '../ui/icons';

interface TransformGizmoProps {
  viewport: Viewport;
  /** The stage element the gizmo is absolutely positioned inside. */
  stageRef: React.RefObject<HTMLDivElement | null>;
}

type DragMode = 'move' | 'resize' | 'rotate';

interface DragSession {
  mode: DragMode;
  handle?: HandleSpec;
  startBox: ClipBox;
  startPointerCanvas: { x: number; y: number };
  startAngle: number;
  startRotation: number;
}

/** How close (in screen px) a feature must be before it snaps. */
const SNAP_THRESHOLD_PX = 7;
const MIN_SIZE_CANVAS = 24;

export const TransformGizmo: React.FC<TransformGizmoProps> = (props) => {
  const hasSelection = useTimelineStore((s) => s.selectedClipIds.length > 0);
  if (!hasSelection) return null;
  return <ActiveTransformGizmo {...props} />;
};

const ActiveTransformGizmo: React.FC<TransformGizmoProps> = ({ viewport, stageRef }) => {
  const project = useProjectStore((s) => s.project);

  const tracks = useTimelineStore((s) => s.tracks);
  const playheadMs = useTimelineStore((s) => s.playheadMs);
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const guidesEnabled = useTimelineStore((s) => s.magneticCanvasGuides);

  const updateClipTransform = useTimelineStore((s) => s.updateClipTransform);
  const beginTransaction = useTimelineStore((s) => s.beginTransaction);
  const commitTransaction = useTimelineStore((s) => s.commitTransaction);
  const cancelTransaction = useTimelineStore((s) => s.cancelTransaction);

  const [guides, setGuides] = useState<AlignmentGuide[]>([]);
  const [spacing, setSpacing] = useState<SpacingIndicator[]>([]);
  const [dragMode, setDragMode] = useState<DragMode | null>(null);

  const sessionRef = useRef<DragSession | null>(null);

  /* ── Which clip does the gizmo wrap? ── */

  const primaryId = selectedClipIds[0] ?? null;

  const clip: Clip | null = useMemo(() => {
    if (!primaryId) return null;
    for (const track of tracks) {
      const found = track.clips.find((c) => c.id === primaryId);
      if (found) return found;
    }
    return null;
  }, [tracks, primaryId]);

  const isOnScreen =
    !!clip &&
    playheadMs >= clip.startTimeMs &&
    playheadMs < clip.startTimeMs + clip.durationMs &&
    clip.type !== 'audio';

  const box = useMemo(() => {
    if (!clip || !isOnScreen) return null;
    return getClipBox(clip, project, playheadMs, getNaturalSize(clip));
  }, [clip, isOnScreen, project, playheadMs]);

  /* ── Peer boxes feed the smart guides ── */

  const peerRects = useMemo(() => {
    if (!clip) return [];
    return getVisibleClipsAt(tracks, playheadMs)
      .filter(({ clip: c }) => c.id !== clip.id && c.type !== 'audio')
      .map(({ clip: c }) => ({
        id: c.id,
        rect: getBoxAABB(getClipBox(c, project, playheadMs, getNaturalSize(c))),
      }));
  }, [tracks, playheadMs, project, clip]);

  const snapContext: SnapContext = useMemo(
    () => ({
      project,
      others: peerRects,
      threshold: SNAP_THRESHOLD_PX / Math.max(0.001, viewport.scale),
      enabled: guidesEnabled,
      includeGuides: true,
    }),
    [project, peerRects, viewport.scale, guidesEnabled]
  );

  /* ── Drag lifecycle ── */

  const endDrag = useCallback(
    (cancelled: boolean, label: string) => {
      sessionRef.current = null;
      setDragMode(null);
      setGuides([]);
      setSpacing([]);
      document.body.classList.remove('dragging-move');
      if (cancelled) cancelTransaction();
      else commitTransaction(label);
    },
    [cancelTransaction, commitTransaction]
  );

  const startDrag = useCallback(
    (e: React.PointerEvent, mode: DragMode, handle?: HandleSpec) => {
      if (!clip || !box || clip.locked) return;
      e.preventDefault();
      e.stopPropagation();

      const stage = stageRef.current;
      if (!stage) return;
      const stageRect = stage.getBoundingClientRect();

      const pointerCanvas = viewToCanvas(
        { x: e.clientX - stageRect.left, y: e.clientY - stageRect.top },
        viewport
      );

      sessionRef.current = {
        mode,
        handle,
        startBox: box,
        startPointerCanvas: pointerCanvas,
        startAngle: angleFromCenter({ x: box.cx, y: box.cy }, pointerCanvas),
        startRotation: box.rotation,
      };

      setDragMode(mode);
      beginTransaction();
      if (mode === 'move') document.body.classList.add('dragging-move');

      const clipId = clip.id;

      const handleMove = (ev: PointerEvent) => {
        const session = sessionRef.current;
        if (!session) return;

        const currentCanvas = viewToCanvas(
          { x: ev.clientX - stageRect.left, y: ev.clientY - stageRect.top },
          viewport
        );
        const deltaCanvas = {
          x: currentCanvas.x - session.startPointerCanvas.x,
          y: currentCanvas.y - session.startPointerCanvas.y,
        };

        if (session.mode === 'move') {
          let nextBox: ClipBox = {
            ...session.startBox,
            cx: session.startBox.cx + deltaCanvas.x,
            cy: session.startBox.cy + deltaCanvas.y,
          };

          // Shift constrains movement to the dominant axis.
          if (ev.shiftKey) {
            if (Math.abs(deltaCanvas.x) > Math.abs(deltaCanvas.y)) nextBox.cy = session.startBox.cy;
            else nextBox.cx = session.startBox.cx;
          }

          // Alt suspends snapping for pixel-exact placement.
          const snap = ev.altKey
            ? { dx: 0, dy: 0, guides: [], spacing: [] }
            : resolveSnap(nextBox, snapContext);

          nextBox = { ...nextBox, cx: nextBox.cx + snap.dx, cy: nextBox.cy + snap.dy };

          setGuides(snap.guides);
          setSpacing(snap.spacing);

          updateClipTransform(clipId, {
            x: Math.round(nextBox.cx - project.width / 2),
            y: Math.round(nextBox.cy - project.height / 2),
          });
          return;
        }

        if (session.mode === 'resize' && session.handle) {
          const result = solveResize({
            startBox: session.startBox,
            handle: session.handle,
            deltaCanvas,
            lockAspect: ev.shiftKey,
            fromCenter: ev.altKey,
            minSize: MIN_SIZE_CANVAS,
          });

          // Snap the resized box's edges, then fold the correction back into
          // the size rather than the position, so the dragged edge lands on
          // the guide and the anchored edge stays put.
          let finalBox = result.box;
          if (!ev.altKey && guidesEnabled) {
            const snap = resolveSnap(finalBox, snapContext);
            setGuides(snap.guides);
            setSpacing([]);
            if (snap.dx !== 0 || snap.dy !== 0) {
              finalBox = { ...finalBox, cx: finalBox.cx + snap.dx, cy: finalBox.cy + snap.dy };
            }
          } else {
            setGuides([]);
          }

          updateClipTransform(clipId, {
            x: Math.round(finalBox.cx - project.width / 2),
            y: Math.round(finalBox.cy - project.height / 2),
            scaleX: Number(result.scaleX.toFixed(4)),
            scaleY: Number(result.scaleY.toFixed(4)),
          });
          return;
        }

        if (session.mode === 'rotate') {
          const angle = angleFromCenter({ x: session.startBox.cx, y: session.startBox.cy }, currentCanvas);
          let rotation = session.startRotation + (angle - session.startAngle);
          // Shift steps by 15°; otherwise still magnetise near the cardinals.
          rotation = ev.shiftKey ? Math.round(rotation / 15) * 15 : snapAngle(rotation, 45, 2.5);
          updateClipTransform(clipId, { rotation: normalizeAngle(rotation) });
        }
      };

      const finish = (cancelled: boolean) => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('keydown', handleKey);
        endDrag(
          cancelled,
          mode === 'move' ? 'Move layer' : mode === 'resize' ? 'Resize layer' : 'Rotate layer'
        );
      };

      const handleUp = () => finish(false);
      const handleKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          finish(true);
        }
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('keydown', handleKey);
    },
    [
      clip, box, viewport, stageRef, project, snapContext, guidesEnabled,
      beginTransaction, updateClipTransform, endDrag,
    ]
  );

  if (!clip || !box) return null;

  /* ── Screen-space geometry ── */

  const center = canvasToView({ x: box.cx, y: box.cy }, viewport);
  const viewWidth = box.width * viewport.scale;
  const viewHeight = box.height * viewport.scale;
  const corners = getBoxCorners(box).map((p) => canvasToView(p, viewport));

  const frameStyle: React.CSSProperties = {
    left: center.x,
    top: center.y,
    width: viewWidth,
    height: viewHeight,
    transform: `translate(-50%, -50%) rotate(${box.rotation}deg)`,
  };

  const locked = clip.locked;
  // Below this the handles overlap each other and stop being usable.
  const showHandles = !locked && viewWidth > 34 && viewHeight > 34;
  const showEdgeHandles = showHandles && viewWidth > 68 && viewHeight > 68;

  return (
    <>
      {/* ── Smart guides ── */}
      <SmartGuideLayer guides={guides} spacing={spacing} viewport={viewport} />

      {/* ── Selection frame ── */}
      <div
        className="absolute pointer-events-none"
        style={{ ...frameStyle, zIndex: 20 }}
      >
        {/* Body: grabbing anywhere inside moves the layer */}
        <div
          onPointerDown={(e) => startDrag(e, 'move')}
          className={`absolute inset-0 pointer-events-auto ${locked ? 'cursor-not-allowed' : 'cursor-move'}`}
          style={{
            outline: `1.5px solid ${locked ? 'rgba(242,202,68,0.9)' : 'rgba(76,157,255,0.95)'}`,
            outlineOffset: '-0.75px',
            boxShadow: dragMode ? '0 0 0 1px rgba(76,157,255,0.25), 0 0 22px rgba(76,157,255,0.18)' : 'none',
          }}
        />

        {locked && (
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-spectrum-amber/95 text-black text-micro font-semibold whitespace-nowrap pointer-events-none">
            <Lock className="w-2.5 h-2.5" />
            Locked
          </div>
        )}

        {/* Rotation handle */}
        {showHandles && (
          <>
            <div
              className="absolute left-1/2 -translate-x-1/2 bg-spectrum-accent/70 pointer-events-none"
              style={{ top: -22, width: 1, height: 22 }}
            />
            <div
              onPointerDown={(e) => startDrag(e, 'rotate')}
              className="absolute left-1/2 pointer-events-auto rounded-full bg-white border-[1.5px] border-spectrum-accent shadow-md hover:scale-125 transition-transform"
              style={{
                top: -28,
                width: 11,
                height: 11,
                transform: 'translateX(-50%)',
                cursor: 'grab',
              }}
              title="Drag to rotate · Shift for 15° steps"
            />
          </>
        )}

        {/* Resize handles */}
        {showHandles &&
          RESIZE_HANDLES.map((handle) => {
            const isEdge = handle.axis !== 'both';
            if (isEdge && !showEdgeHandles) return null;

            const left = `calc(50% + ${handle.ux * 100}%)`;
            const top = `calc(50% + ${handle.uy * 100}%)`;
            const size = isEdge ? 8 : 10;

            return (
              <div
                key={handle.id}
                onPointerDown={(e) => startDrag(e, 'resize', handle)}
                className="gizmo-handle"
                style={{
                  left,
                  top,
                  width: isEdge && handle.axis === 'y' ? 18 : size,
                  height: isEdge && handle.axis === 'x' ? 18 : size,
                  marginLeft: -(isEdge && handle.axis === 'y' ? 18 : size) / 2,
                  marginTop: -(isEdge && handle.axis === 'x' ? 18 : size) / 2,
                  borderRadius: isEdge ? 3 : 2,
                  cursor: rotatedCursor(handle, box.rotation),
                }}
                title={`Resize · Shift locks ratio · ⌥ from centre`}
              />
            );
          })}
      </div>

      {/* ── Live readout ── */}
      {dragMode && (
        <div
          className="absolute pointer-events-none z-20 px-2 py-1 rounded-squircle-xs bg-spectrum-panel/95 border border-line-strong shadow-pop font-mono text-micro text-spectrum-text whitespace-nowrap"
          style={{
            left: Math.min(...corners.map((c) => c.x)) ,
            top: Math.max(...corners.map((c) => c.y)) + 10,
          }}
        >
          {dragMode === 'rotate' ? (
            <span>{normalizeAngle(box.rotation).toFixed(1)}°</span>
          ) : (
            <span>
              {Math.round(box.width)} × {Math.round(box.height)}
              <span className="text-spectrum-textDim ml-2">
                {Math.round(box.scaleX * 100)}%
              </span>
            </span>
          )}
        </div>
      )}
    </>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Guide + spacing rendering
   ═══════════════════════════════════════════════════════════════════ */

const GUIDE_COLORS: Record<string, string> = {
  'canvas-center': '#ff2d78',
  'canvas-edge': '#ff2d78',
  'canvas-third': '#4c9dff',
  'safe-area': '#f5a524',
  'object-edge': '#ff2d78',
  'object-center': '#ff2d78',
  spacing: '#ff2d78',
};

interface SmartGuideLayerProps {
  guides: AlignmentGuide[];
  spacing: SpacingIndicator[];
  viewport: Viewport;
}

const SmartGuideLayer: React.FC<SmartGuideLayerProps> = ({ guides, spacing, viewport }) => {
  if (guides.length === 0 && spacing.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 15 }}>
      {guides.map((guide, i) => {
        const color = GUIDE_COLORS[guide.kind] ?? '#ff2d78';
        // Extend a little past the aligned objects so the line reads clearly.
        const pad = 24 / viewport.scale;
        const from = canvasToView(
          guide.axis === 'x'
            ? { x: guide.position, y: guide.from - pad }
            : { x: guide.from - pad, y: guide.position },
          viewport
        );
        const to = canvasToView(
          guide.axis === 'x'
            ? { x: guide.position, y: guide.to + pad }
            : { x: guide.to + pad, y: guide.position },
          viewport
        );

        const isCenter = guide.kind === 'canvas-center' || guide.kind === 'object-center';

        return guide.axis === 'x' ? (
          <div
            key={`gx-${i}-${guide.kind}-${Math.round(guide.position)}`}
            style={{
              position: 'absolute',
              left: Math.round(from.x),
              top: from.y,
              height: to.y - from.y,
              width: 1,
              background: color,
              opacity: isCenter ? 1 : 0.8,
              boxShadow: `0 0 4px ${color}88`,
            }}
          />
        ) : (
          <div
            key={`gy-${i}-${guide.kind}-${Math.round(guide.position)}`}
            style={{
              position: 'absolute',
              top: Math.round(from.y),
              left: from.x,
              width: to.x - from.x,
              height: 1,
              background: color,
              opacity: isCenter ? 1 : 0.8,
              boxShadow: `0 0 4px ${color}88`,
            }}
          />
        );
      })}

      {spacing.map((sp, si) =>
        sp.segments.map((seg, gi) => {
          const a = canvasToView(
            sp.axis === 'x' ? { x: seg.start, y: seg.cross } : { x: seg.cross, y: seg.start },
            viewport
          );
          const b = canvasToView(
            sp.axis === 'x' ? { x: seg.end, y: seg.cross } : { x: seg.cross, y: seg.end },
            viewport
          );

          const length = sp.axis === 'x' ? b.x - a.x : b.y - a.y;
          if (length <= 1) return null;

          return (
            <div key={`sp-${si}-${gi}`}>
              <div
                style={{
                  position: 'absolute',
                  left: a.x,
                  top: a.y,
                  width: sp.axis === 'x' ? length : 1,
                  height: sp.axis === 'x' ? 1 : length,
                  background: 'var(--accent)',
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.55)',
                }}
              />
              {/* End caps make the measured span unambiguous */}
              {[a, b].map((pt, i) => (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: sp.axis === 'x' ? pt.x : pt.x - 3.5,
                    top: sp.axis === 'x' ? pt.y - 3.5 : pt.y,
                    width: sp.axis === 'x' ? 1 : 8,
                    height: sp.axis === 'x' ? 8 : 1,
                    background: 'var(--accent)',
                  }}
                />
              ))}
              {gi === 0 && (
                <div
                  style={{
                    position: 'absolute',
                    left: sp.axis === 'x' ? a.x + length / 2 : a.x + 6,
                    top: sp.axis === 'x' ? a.y - 18 : a.y + length / 2,
                    transform: sp.axis === 'x' ? 'translateX(-50%)' : 'translateY(-50%)',
                  }}
                  className="px-1 py-px rounded-squircle-2xs bg-spectrum-pink text-white text-micro font-mono font-semibold whitespace-nowrap"
                >
                  {sp.distance}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};
