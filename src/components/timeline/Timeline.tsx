/* ═══════════════════════════════════════════════════════════════════
   Multi-track timeline.

   The scroll container owns the horizontal scroll for both the ruler and
   the lanes, so they can never drift apart. Snapping candidates (clip
   edges, playhead, markers, in/out) are gathered once per drag rather
   than per pointer move.
   ═══════════════════════════════════════════════════════════════════ */

import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useProjectStore } from '../../store/projectStore';
import { TimelineToolbar } from './TimelineToolbar';
import { TimelineRuler } from './TimelineRuler';
import { TrackHeader } from './TrackHeader';
import { ClipBlock } from './ClipBlock';
import { Playhead, PlayheadHead } from './Playhead';
import { MarkerLane } from './MarkerLane';
import { MediaAsset } from '../../types/edl';

export const BASE_PX_PER_MS = 0.05;
export const HEADER_WIDTH = 204;
const RULER_HEIGHT = 28;
const MARKER_HEIGHT = 14;

export interface DragGhost {
  clipIds: string[];
  trackId: string;
  startTimeMs: number;
  /** Guide line to draw during the drag, in ms. */
  snapLineMs: number | null;
}

export const Timeline: React.FC = () => {
  const tracks = useTimelineStore((s) => s.tracks);
  const zoomLevel = useTimelineStore((s) => s.zoomLevel);
  const selectedTrackId = useTimelineStore((s) => s.selectedTrackId);
  const inPointMs = useTimelineStore((s) => s.inPointMs);
  const outPointMs = useTimelineStore((s) => s.outPointMs);

  const setPlayheadMs = useTimelineStore((s) => s.setPlayheadMs);
  const setSelectedTrackId = useTimelineStore((s) => s.setSelectedTrackId);
  const clearSelection = useTimelineStore((s) => s.clearSelection);
  const selectClips = useTimelineStore((s) => s.selectClips);
  const insertClip = useTimelineStore((s) => s.insertClip);
  const setZoomLevel = useTimelineStore((s) => s.setZoomLevel);

  const project = useProjectStore((s) => s.project);

  const scrollRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const [snapLineMs, setSnapLineMs] = useState<number | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [dropTargetTrack, setDropTargetTrack] = useState<string | null>(null);

  const pxPerMs = BASE_PX_PER_MS * zoomLevel;
  const contentWidth = Math.max(600, project.durationMs * pxPerMs + 240);

  /* ── Snap candidates ── */

  const collectSnapPoints = useCallback(
    (excludeClipIds: string[] = []): number[] => {
      const state = useTimelineStore.getState();
      if (!state.snappingEnabled) return [];

      const points = new Set<number>([0, state.playheadMs]);
      if (state.inPointMs !== null) points.add(state.inPointMs);
      if (state.outPointMs !== null) points.add(state.outPointMs);
      for (const m of state.markers) points.add(m.timeMs);
      for (const track of state.tracks) {
        for (const clip of track.clips) {
          if (excludeClipIds.includes(clip.id)) continue;
          points.add(clip.startTimeMs);
          points.add(clip.startTimeMs + clip.durationMs);
        }
      }
      return [...points];
    },
    []
  );

  /** Snap `ms` to the nearest candidate within ~9 screen px. */
  const snapTime = useCallback(
    (ms: number, candidates: number[]): { value: number; snappedTo: number | null } => {
      if (candidates.length === 0) return { value: ms, snappedTo: null };
      const toleranceMs = 9 / pxPerMs;

      let best: number | null = null;
      let bestDist = Infinity;
      for (const c of candidates) {
        const d = Math.abs(c - ms);
        if (d < bestDist && d <= toleranceMs) {
          bestDist = d;
          best = c;
        }
      }
      return best !== null ? { value: best, snappedTo: best } : { value: ms, snappedTo: null };
    },
    [pxPerMs]
  );

  /* ── Scrub / deselect on empty lane click ── */

  const laneTimeFromEvent = useCallback(
    (clientX: number): number => {
      const lanes = lanesRef.current;
      if (!lanes) return 0;
      const rect = lanes.getBoundingClientRect();
      return Math.max(0, (clientX - rect.left) / pxPerMs);
    },
    [pxPerMs]
  );

  const handleLaneBackgroundDown = useCallback(
    (e: React.PointerEvent, trackId: string) => {
      if (e.button !== 0) return;
      const lanes = lanesRef.current;
      if (!lanes) return;

      setSelectedTrackId(trackId);
      const rect = lanes.getBoundingClientRect();
      const originX = e.clientX - rect.left;
      const originY = e.clientY - rect.top;

      let didMarquee = false;

      const move = (ev: PointerEvent) => {
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        if (!didMarquee && Math.hypot(x - originX, y - originY) < 4) return;
        didMarquee = true;
        setMarquee({ x0: originX, y0: originY, x1: x, y1: y });
      };

      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);

        if (didMarquee) {
          // Rubber-band select every clip the box touches.
          const x = ev.clientX - rect.left;
          const y = ev.clientY - rect.top;
          const minX = Math.min(originX, x);
          const maxX = Math.max(originX, x);
          const minY = Math.min(originY, y);
          const maxY = Math.max(originY, y);

          const hits: string[] = [];
          let laneTop = 0;
          for (const track of tracks) {
            const laneBottom = laneTop + track.heightPx;
            if (laneBottom >= minY && laneTop <= maxY) {
              for (const clip of track.clips) {
                const clipLeft = clip.startTimeMs * pxPerMs;
                const clipRight = clipLeft + clip.durationMs * pxPerMs;
                if (clipRight >= minX && clipLeft <= maxX) hits.push(clip.id);
              }
            }
            laneTop = laneBottom;
          }
          selectClips(hits);
          setMarquee(null);
        } else {
          setPlayheadMs(Math.min(project.durationMs, laneTimeFromEvent(ev.clientX)));
          if (!ev.shiftKey) clearSelection();
        }
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [tracks, pxPerMs, project.durationMs, setSelectedTrackId, setPlayheadMs, clearSelection, selectClips, laneTimeFromEvent]
  );

  /* ── Ctrl/⌘ + wheel zooms around the cursor ── */

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const state = useTimelineStore.getState();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left + el.scrollLeft;
      const timeAtCursor = cursorX / (BASE_PX_PER_MS * state.zoomLevel);

      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const nextZoom = Math.max(0.05, Math.min(20, state.zoomLevel * factor));
      state.setZoomLevel(nextZoom);

      // Keep whatever was under the cursor under the cursor.
      requestAnimationFrame(() => {
        el.scrollLeft = timeAtCursor * BASE_PX_PER_MS * nextZoom - (e.clientX - rect.left);
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* ── Keep the playhead in view while playing ── */

  useEffect(() => {
    const unsub = useTimelineStore.subscribe((state, prev) => {
      if (!state.isPlaying || state.playheadMs === prev.playheadMs) return;
      const el = scrollRef.current;
      if (!el) return;

      const x = state.playheadMs * BASE_PX_PER_MS * state.zoomLevel;
      const viewLeft = el.scrollLeft;
      const viewRight = viewLeft + el.clientWidth;

      if (x > viewRight - 80 || x < viewLeft) {
        el.scrollLeft = Math.max(0, x - el.clientWidth * 0.35);
      }
    });
    return unsub;
  }, []);

  /* ── Media drop from the pool ── */

  const handleDrop = useCallback(
    (e: React.DragEvent, trackId: string) => {
      e.preventDefault();
      setDropTargetTrack(null);
      const raw = e.dataTransfer.getData('application/x-auracut-asset');
      if (!raw) return;
      try {
        const asset = JSON.parse(raw) as MediaAsset;
        const candidates = collectSnapPoints();
        const dropped = laneTimeFromEvent(e.clientX);
        const { value } = snapTime(dropped, candidates);
        insertClip(trackId, asset, Math.max(0, value));
      } catch {
        /* malformed payload — ignore */
      }
    },
    [collectSnapPoints, laneTimeFromEvent, snapTime, insertClip]
  );

  const lanesTotalHeight = useMemo(
    () => tracks.reduce((sum, t) => sum + t.heightPx, 0),
    [tracks]
  );

  return (
    <div className="flex flex-col h-full bg-spectrum-panel border-t border-line overflow-hidden select-none">
      <TimelineToolbar scrollRef={scrollRef} />

      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* ── Track headers ── */}
        <div
          className="flex-shrink-0 flex flex-col bg-spectrum-panelHeader border-r border-line z-20"
          style={{ width: HEADER_WIDTH }}
        >
          <div
            className="flex items-center px-3 border-b border-line bg-spectrum-panelHeader flex-shrink-0"
            style={{ height: RULER_HEIGHT + MARKER_HEIGHT }}
          >
            <span className="panel-title">Tracks</span>
          </div>

          <div className="flex-1 overflow-hidden">
            {tracks.map((track) => (
              <TrackHeader key={track.id} track={track} />
            ))}
          </div>
        </div>

        {/* ── Scrollable lanes ── */}
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto relative bg-spectrum-sunken min-w-0">
          <div style={{ width: contentWidth, minHeight: '100%' }} className="relative">
            {/* Ruler + markers pinned to the top of the scroll area */}
            <div className="sticky top-0 z-30 bg-spectrum-panelHeader border-b border-line">
              <TimelineRuler pxPerMs={pxPerMs} durationMs={project.durationMs} height={RULER_HEIGHT} />
              <MarkerLane pxPerMs={pxPerMs} height={MARKER_HEIGHT} />
              <PlayheadHead pxPerMs={pxPerMs} height={RULER_HEIGHT + MARKER_HEIGHT} />
            </div>

            {/* Lanes */}
            <div ref={lanesRef} className="relative">
              {/* In / out shading */}
              {(inPointMs !== null || outPointMs !== null) && (
                <div
                  className="absolute top-0 bg-spectrum-accent/[0.07] border-x border-spectrum-accent/40 pointer-events-none z-[1]"
                  style={{
                    left: (inPointMs ?? 0) * pxPerMs,
                    width: ((outPointMs ?? project.durationMs) - (inPointMs ?? 0)) * pxPerMs,
                    height: lanesTotalHeight,
                  }}
                />
              )}

              {tracks.map((track, idx) => (
                <div
                  key={track.id}
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) handleLaneBackgroundDown(e, track.id);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropTargetTrack(track.id);
                  }}
                  onDragLeave={() => setDropTargetTrack((t) => (t === track.id ? null : t))}
                  onDrop={(e) => handleDrop(e, track.id)}
                  style={{ height: track.heightPx }}
                  className={`relative w-full border-b border-line lane-stripe transition-colors ${
                    dropTargetTrack === track.id
                      ? 'bg-spectrum-accent/12 ring-1 ring-inset ring-spectrum-accent/50'
                      : selectedTrackId === track.id
                        ? 'bg-white/[0.028]'
                        : idx % 2 === 0
                          ? 'bg-white/[0.012]'
                          : 'bg-transparent'
                  } ${track.locked ? 'opacity-55' : ''}`}
                >
                  {track.clips.map((clip) => (
                    <ClipBlock
                      key={clip.id}
                      clip={clip}
                      track={track}
                      pxPerMs={pxPerMs}
                      trackHeightPx={track.heightPx}
                      collectSnapPoints={collectSnapPoints}
                      snapTime={snapTime}
                      onSnapLine={setSnapLineMs}
                    />
                  ))}
                </div>
              ))}

              {/* Snap guide */}
              {snapLineMs !== null && (
                <div
                  className="absolute top-0 w-px bg-spectrum-amber pointer-events-none z-40 shadow-[0_0_6px_rgba(245,165,36,0.7)]"
                  style={{ left: snapLineMs * pxPerMs, height: lanesTotalHeight }}
                />
              )}

              {/* Marquee */}
              {marquee && (
                <div
                  className="absolute border border-spectrum-accent bg-spectrum-accent/12 pointer-events-none z-40 rounded-[3px]"
                  style={{
                    left: Math.min(marquee.x0, marquee.x1),
                    top: Math.min(marquee.y0, marquee.y1),
                    width: Math.abs(marquee.x1 - marquee.x0),
                    height: Math.abs(marquee.y1 - marquee.y0),
                  }}
                />
              )}

              <Playhead pxPerMs={pxPerMs} height={lanesTotalHeight} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
