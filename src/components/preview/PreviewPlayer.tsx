/* ═══════════════════════════════════════════════════════════════════
   Program monitor.

   Performance notes:
     • The render loop reads the store imperatively via `getState()` and
       only re-paints the canvas when the frame actually changed. It does
       NOT subscribe to `playheadMs`, so playback never re-renders React.
     • The viewport is computed from a measured stage size, so the canvas,
       the gizmo and the overlays all share one coordinate system.
   ═══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTimelineStore, getContentEndMs } from '../../store/timelineStore';
import { useProjectStore } from '../../store/projectStore';
import { useLayoutStore } from '../../store/layoutStore';
import { computeViewport, viewToCanvas, hitTestBox, getClipBox } from '../../engine/geometry';
import { getNaturalSize } from '../../engine/compositor';
import { getVisibleClipsAt } from '../../store/timelineStore';
import { TransformGizmo } from '../canvas/TransformGizmo';
import { AlignmentBar } from '../canvas/AlignmentBar';
import { PlaybackControls } from './PlaybackControls';
import { useMeasure } from '../../hooks/useMeasure';
import { useProgramLoop } from '../../hooks/useProgramLoop';
import { audioEngine } from '../../engine/audioEngine';
import {
  Grid3x3, Ratio, Film, Magnet, ZoomIn, ZoomOut, Maximize2, Gauge,
} from '../ui/icons';

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

export const PreviewPlayer: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stageRef, stageSize] = useMeasure<HTMLDivElement>();

  const project = useProjectStore((s) => s.project);
  const setDurationMs = useProjectStore((s) => s.setDurationMs);

  const {
    showSafeAreas, showRuleOfThirds, showCinemaLetterbox, showScopes,
    toggleSafeAreas, toggleRuleOfThirds, toggleCinemaLetterbox, toggleScopes,
  } = useLayoutStore();

  const guidesEnabled = useTimelineStore((s) => s.magneticCanvasGuides);
  const toggleCanvasGuides = useTimelineStore((s) => s.toggleCanvasGuides);
  const selectClip = useTimelineStore((s) => s.selectClip);
  const hasSelection = useTimelineStore((s) => s.selectedClipIds.length > 0);

  /* ── Zoom / fit ── */
  const [zoomMode, setZoomMode] = useState<'fit' | number>('fit');
  /* The monitor's fullscreen button opens the SHARED Player — the same
     one Home opens — rather than the `position: fixed` div this used to
     grow into. That div was fullscreen-looking and nothing else: no
     receding overlays, no Copilot, and a second copy of the transport. */
  const isPlayerOpen = useLayoutStore((s) => s.isPlayerOpen);
  const openPlayer = useLayoutStore((s) => s.openPlayer);
  const [meters, setMeters] = useState({ l: 0.04, r: 0.04, peak: 0 });

  // Match the approved monitor's optical inset. The gizmo is an overlay and
  // must not shrink the picture by a second, hidden 44px margin.
  const STAGE_PAD_X = 18;
  const STAGE_PAD_TOP = 16;
  const STAGE_PAD_BOTTOM = 12;
  const MAX_CANVAS_WIDTH = 720;
  const stageInner = useMemo(
    () => ({
      width: Math.max(1, stageSize.width - STAGE_PAD_X * 2),
      height: Math.max(1, stageSize.height - STAGE_PAD_TOP - STAGE_PAD_BOTTOM),
    }),
    [stageSize.width, stageSize.height]
  );

  const fitScale = useMemo(
    () => Math.min(stageInner.width / project.width, stageInner.height / project.height, MAX_CANVAS_WIDTH / project.width),
    [stageInner, project.width, project.height]
  );

  const zoomFactor = zoomMode === 'fit' ? 1 : zoomMode / Math.max(0.0001, fitScale);

  const viewport = useMemo(() => {
    // Fit within the padded box, but centre against the true stage bounds.
    const fitted = computeViewport(stageInner.width, stageInner.height, project, zoomFactor);
    return {
      ...fitted,
      offsetX: STAGE_PAD_X + (stageInner.width - fitted.displayWidth) / 2,
      offsetY: STAGE_PAD_TOP + (stageInner.height - fitted.displayHeight) / 2,
    };
  }, [stageInner, stageSize.width, stageSize.height, project, zoomFactor]);

  const effectiveScale = viewport.scale;

  /* ── Render loop ──────────────────────────────────────────────
     Owned by `useProgramLoop`, and yielded while the fullscreen
     Player is open. The loop drives the audio graph and every <video>
     element as well as the canvas, so exactly one of the two may run:
     two would sync the same media twice per frame from two callers. */
  useProgramLoop({
    canvasRef,
    project,
    active: !isPlayerOpen,
    onMeters: setMeters,
  });

  const tracksSignature = useTimelineStore((s) => s.tracks);

  /* ── Keep project duration >= content ── */
  useEffect(() => {
    const end = getContentEndMs(tracksSignature);
    if (end > project.durationMs) setDurationMs(Math.ceil(end / 1000) * 1000);
  }, [tracksSignature, project.durationMs, setDurationMs]);

  /* ── Click-to-select on the canvas ── */

  const handleStagePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const stage = stageRef.current;
      if (!stage) return;

      const rect = stage.getBoundingClientRect();
      const point = viewToCanvas({ x: e.clientX - rect.left, y: e.clientY - rect.top }, viewport);

      const state = useTimelineStore.getState();
      const visible = getVisibleClipsAt(state.tracks, state.playheadMs);

      // Topmost first: the visible list is bottom-up, so walk it backwards.
      for (let i = visible.length - 1; i >= 0; i--) {
        const { clip } = visible[i];
        if (clip.type === 'audio') continue;
        const box = getClipBox(clip, project, state.playheadMs, getNaturalSize(clip));
        if (hitTestBox(point, box)) {
          selectClip(clip.id, e.shiftKey);
          return;
        }
      }

      if (!e.shiftKey) selectClip(null);
    },
    [stageRef, viewport, project, selectClip]
  );

  /* ── Zoom controls ── */

  const stepZoom = (direction: 1 | -1) => {
    const current = zoomMode === 'fit' ? fitScale : zoomMode;
    const idx = ZOOM_STEPS.findIndex((z) => z > current + 0.001);
    const next =
      direction === 1
        ? ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, idx === -1 ? ZOOM_STEPS.length - 1 : idx)]
        : ZOOM_STEPS[Math.max(0, (idx === -1 ? ZOOM_STEPS.length : idx) - 2)];
    setZoomMode(next);
  };

  const zoomLabel = zoomMode === 'fit' ? 'Fit' : `${Math.round(zoomMode * 100)}%`;

  return (
    /* The monitor column sits on chrome, not on the app backdrop —
       measured off the approved editor, where this plane is the single
       largest surface on the screen. */
    <div className="editor-program-inner flex-1 flex flex-col min-h-0 bg-spectrum-panelHeader relative">
      {/* ── Monitor bar ──────────────────────────────────────────────
          Overlay toggles are icon-only: they are glanced at constantly
          and named rarely, so a label on each is pure noise.            */}
      <div className="editor-program-header h-[42px] flex items-center justify-between gap-3 px-[13px] flex-shrink-0 border-b border-line bg-spectrum-panelHeader">
        <div className="flex items-center gap-2 min-w-0">
          {/* The shared panel title, not a hand-typed copy of it: the
              library and the monitor wear the same label control in the
              reference, and re-typing it is how they drifted apart. */}
          <span className="panel-title flex-shrink-0">Program</span>
          <span className="w-px h-3 bg-line flex-shrink-0" />
          <span className="text-ui-xs text-spectrum-textDim font-mono truncate tabular">
            {project.width}×{project.height} · {project.fps} fps · Rec.709
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="seg-group">
            <OverlayToggle active={showSafeAreas} onClick={toggleSafeAreas} icon={Ratio} title="Action & title safe margins" />
            <OverlayToggle active={showRuleOfThirds} onClick={toggleRuleOfThirds} icon={Grid3x3} title="Rule-of-thirds grid" />
            <OverlayToggle active={showCinemaLetterbox} onClick={toggleCinemaLetterbox} icon={Film} title="2.39:1 letterbox matte" />
            <OverlayToggle active={guidesEnabled} onClick={toggleCanvasGuides} icon={Magnet} title="Smart alignment guides" />
            <OverlayToggle active={showScopes} onClick={toggleScopes} icon={Gauge} title="Video scopes" />
          </div>

          <div className="seg-group">
            <button onClick={() => stepZoom(-1)} className="seg-item !px-1.5" title="Zoom out"
            aria-label="Zoom out">
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setZoomMode(zoomMode === 'fit' ? 1 : 'fit')}
              className="seg-item font-mono min-w-[42px]"
              title="Toggle fit / 100%"
            
            aria-label="Toggle fit / 100%">
              {zoomLabel}
            </button>
            <button onClick={() => stepZoom(1)} className="seg-item !px-1.5" title="Zoom in"
            aria-label="Zoom in">
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={openPlayer}
            className="pro-btn w-6 h-6"
            title="Play fullscreen"
            aria-label="Play fullscreen">
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Stage ── */}
      <div
        ref={stageRef}
        onPointerDown={(e) => { audioEngine.resume(); handleStagePointerDown(e); }}
        className="editor-program-stage flex-1 relative min-h-0 overflow-hidden stage-bed"
      >
        {/* Canvas + overlays, positioned exactly on the computed viewport */}
        <div
          className="absolute"
          style={{
            left: viewport.offsetX,
            top: viewport.offsetY,
            width: viewport.displayWidth,
            height: viewport.displayHeight,
          }}
        >
          {/* The picture floats above the bed, as the approved editor
              draws it: an 11px corner, a long soft drop and a single
              hairline. It was a hard-edged rectangle on a vignette. */}
          <div className="absolute inset-0 overflow-hidden bg-black rounded-squircle-md shadow-stage">
            <canvas
              ref={canvasRef}
              width={project.width}
              height={project.height}
              className="w-full h-full block"
            />
          </div>

          {/* Rule of thirds */}
          {showRuleOfThirds && (
            <div className="absolute inset-0 pointer-events-none z-10">
              {[1, 2].map((i) => (
                <div key={`v${i}`} className="absolute top-0 bottom-0 w-px bg-white/20" style={{ left: `${(i * 100) / 3}%` }} />
              ))}
              {[1, 2].map((i) => (
                <div key={`h${i}`} className="absolute left-0 right-0 h-px bg-white/20" style={{ top: `${(i * 100) / 3}%` }} />
              ))}
            </div>
          )}

          {/* Safe areas */}
          {showSafeAreas && (
            <div className="absolute inset-0 pointer-events-none z-10">
              <div className="absolute border border-spectrum-amber/40" style={{ inset: '5%' }} />
              <div className="absolute border border-spectrum-accent/40" style={{ inset: '10%' }} />
              <div className="absolute left-1/2 top-1/2 w-4 h-px bg-white/35 -translate-x-1/2" />
              <div className="absolute left-1/2 top-1/2 w-px h-4 bg-white/35 -translate-y-1/2" />
            </div>
          )}

          {/* Cinemascope mattes */}
          {showCinemaLetterbox && (
            <div className="absolute inset-0 pointer-events-none z-10 flex flex-col justify-between">
              <div className="w-full bg-black/92" style={{ height: '11.6%' }} />
              <div className="w-full bg-black/92" style={{ height: '11.6%' }} />
            </div>
          )}
        </div>

        {/*
          The gizmo and its guides live at STAGE level, not inside the canvas
          wrapper: they position themselves with `canvasToView`, which already
          adds the viewport offset. Nesting them would apply it twice.
        */}
        <div className="absolute inset-0 pointer-events-none">
          <TransformGizmo viewport={viewport} stageRef={stageRef} />
        </div>

        {/* Scopes */}
        {showScopes && <ScopesOverlay canvasRef={canvasRef} />}

        {/* Zoom readout — only when the view is not simply fitted. */}
        {zoomMode !== 'fit' && (
          <div className="absolute top-2.5 left-2.5 glass rounded-squircle-xs px-2 h-6 flex items-center text-ui-xs font-mono text-spectrum-textMuted tabular z-30 pointer-events-none">
            {Math.round(effectiveScale * 100)}%
          </div>
        )}

        {/*
          Layer tools float over the stage instead of claiming a permanent
          bar: they are only meaningful while something is selected, and a
          row that appears and disappears would shift the picture each time.
        */}
        {hasSelection && (
          <div className="editor-align-shelf absolute bottom-3 left-1/2 -translate-x-1/2 z-30 animate-slide-up">
            <div className="glass rounded-squircle-md shadow-pop px-1.5 py-1">
              <AlignmentBar />
            </div>
          </div>
        )}
      </div>

      {/* ── Transport ── */}
      <div className="editor-program-transport flex-shrink-0 px-[14px] pt-[10px] pb-[11px] border-t border-line bg-spectrum-panel flex items-stretch gap-3">
        <div className="flex-1 min-w-0">
          <PlaybackControls />
        </div>
        <LevelMeters left={meters.l} right={meters.r} peak={meters.peak} />
      </div>
    </div>
  );
};

/* ── Small pieces ───────────────────────────────────────────────── */

/**
 * Master output meters.
 *
 * Channel letters and a fixed clip mark are what turn two coloured bars
 * into an instrument you can actually read: without them you can see that
 * something is loud, but not which side, or how close to clipping.
 */
const LevelMeters: React.FC<{ left: number; right: number; peak: number }> = ({ left, right, peak }) => (
  <div className="flex items-center gap-2 flex-shrink-0 pl-3 border-l border-line" title="Master output level">
    <div className="flex flex-col gap-[3px] justify-center">
      {(['L', 'R'] as const).map((ch) => (
        <span key={ch} className="text-micro font-mono font-semibold text-spectrum-textFaint leading-[7px]">
          {ch}
        </span>
      ))}
    </div>
    <div className="flex flex-col justify-center gap-[3px] w-[92px]">
      {[left, right].map((value, i) => (
        <div key={i} className="relative h-[7px] rounded-squircle-2xs bg-spectrum-sunken border border-line overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 transition-[width] duration-75"
            style={{
              width: `${Math.min(100, value * 100)}%`,
              background: value > 0.88
                ? 'linear-gradient(to right,#33c98d,#f0a92e 70%,#ee5a63)'
                : 'linear-gradient(to right,#2aa876,#33c98d)',
            }}
          />
          {/* 0 dBFS */}
          <div className="absolute inset-y-0 w-px bg-white/20" style={{ left: '88%' }} />
          {peak > 0.05 && (
            <div className="absolute top-0 bottom-0 w-px bg-white/85" style={{ left: `${Math.min(99, peak * 100)}%` }} />
          )}
        </div>
      ))}
    </div>
  </div>
);

/** Icon-only overlay switch. Its `on` state is accent-tinted, not just filled,
    because these read as "the monitor is showing something extra". */
const OverlayToggle: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  title: string;
}> = ({ active, onClick, icon: Icon, title }) => (
  <button onClick={onClick} className={`seg-item !px-1.5 ${active ? 'seg-item-on' : ''}`} title={title}
            aria-label={title}>
    <Icon className="w-3.5 h-3.5" />
  </button>
);

/**
 * Luma waveform + RGB parade sampled straight from the program canvas.
 * Throttled to ~8fps — scopes don't need frame parity and reading pixels
 * back off the GPU is the expensive part.
 */
const ScopesOverlay: React.FC<{ canvasRef: React.RefObject<HTMLCanvasElement | null> }> = ({ canvasRef }) => {
  const scopeRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let frame = 0;
    let lastRun = 0;

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - lastRun < 120) return;
      lastRun = now;

      const source = canvasRef.current;
      const target = scopeRef.current;
      if (!source || !target) return;

      const sctx = source.getContext('2d', { willReadFrequently: true });
      const tctx = target.getContext('2d');
      if (!sctx || !tctx) return;

      const SAMPLE_W = 160;
      const SAMPLE_H = 90;

      let data: ImageData;
      try {
        // Downsample by reading a strided slice rather than the full frame.
        data = sctx.getImageData(0, 0, source.width, source.height);
      } catch {
        return; // tainted canvas (cross-origin media). Scopes unavailable
      }

      const W = target.width;
      const H = target.height;
      tctx.clearRect(0, 0, W, H);
      tctx.fillStyle = 'rgba(8,9,12,0.88)';
      tctx.fillRect(0, 0, W, H);

      const stepX = Math.max(1, Math.floor(source.width / SAMPLE_W));
      const stepY = Math.max(1, Math.floor(source.height / SAMPLE_H));

      tctx.globalCompositeOperation = 'lighter';

      for (let y = 0; y < source.height; y += stepY) {
        for (let x = 0; x < source.width; x += stepX) {
          const i = (y * source.width + x) * 4;
          const r = data.data[i];
          const g = data.data[i + 1];
          const b = data.data[i + 2];
          const px = (x / source.width) * W;

          const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          tctx.fillStyle = 'rgba(120,220,160,0.14)';
          tctx.fillRect(px, H - luma * H, 1, 1.4);

          tctx.fillStyle = 'rgba(255,70,70,0.09)';
          tctx.fillRect(px, H - (r / 255) * H, 1, 1);
          tctx.fillStyle = 'rgba(70,255,120,0.09)';
          tctx.fillRect(px, H - (g / 255) * H, 1, 1);
          tctx.fillStyle = 'rgba(80,150,255,0.09)';
          tctx.fillRect(px, H - (b / 255) * H, 1, 1);
        }
      }

      tctx.globalCompositeOperation = 'source-over';

      // IRE reference lines.
      tctx.strokeStyle = 'rgba(255,255,255,0.12)';
      tctx.lineWidth = 1;
      for (const ire of [0, 0.25, 0.5, 0.75, 1]) {
        tctx.beginPath();
        tctx.moveTo(0, H - ire * H + 0.5);
        tctx.lineTo(W, H - ire * H + 0.5);
        tctx.stroke();
      }
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [canvasRef]);

  return (
    <div className="absolute top-2.5 right-2.5 z-30 rounded-squircle-sm overflow-hidden shadow-pop">
      <div className="px-2 h-5 flex items-center bg-spectrum-panelHeader border-b border-line text-micro font-semibold text-spectrum-textDim uppercase tracking-[0.08em]">
        Waveform / Parade
      </div>
      <canvas ref={scopeRef} width={200} height={110} className="block bg-spectrum-sunken" />
    </div>
  );
};
