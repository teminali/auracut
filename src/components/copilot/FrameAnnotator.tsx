/* ═══════════════════════════════════════════════════════════════════
   Frame annotator — draw on the frame you are about to send.

   Everything is stored in PROJECT coordinates, so an arrow drawn here
   resolves to "top-left of clip_plushie_1" no matter what size the
   annotator was displayed at.
   ═══════════════════════════════════════════════════════════════════ */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Annotation, AnnotationKind, CapturedFrame } from '../../types/context';
import { drawAnnotations, labelAnchor } from '../../engine/frameCapture';
import { resolveAnnotationTargets } from '../../engine/contextProtocol';
import { useProjectStore } from '../../store/projectStore';
import { useMeasure } from '../../hooks/useMeasure';
import {
  X, MousePointer2, ArrowUpRight, Square, Circle, Pencil, Type, Undo2, Trash2, Check, MapPin,
} from '../ui/icons';

interface FrameAnnotatorProps {
  frame: CapturedFrame;
  initial: Annotation[];
  onConfirm: (annotations: Annotation[]) => void;
  onClose: () => void;
}

type Tool = AnnotationKind | 'select';

const TOOLS: { id: Tool; label: string; icon: React.ElementType; hint: string }[] = [
  { id: 'arrow', label: 'Arrow', icon: ArrowUpRight, hint: 'Point at something' },
  { id: 'rect', label: 'Box', icon: Square, hint: 'Frame an area' },
  { id: 'ellipse', label: 'Circle', icon: Circle, hint: 'Circle a subject' },
  { id: 'freehand', label: 'Draw', icon: Pencil, hint: 'Freehand mark' },
  { id: 'point', label: 'Pin', icon: MapPin, hint: 'Drop a pin' },
  { id: 'text', label: 'Label', icon: Type, hint: 'Write a note' },
  { id: 'select', label: 'Select', icon: MousePointer2, hint: 'Pick or delete a mark' },
];

const COLORS = ['#ff2d78', '#f5d524', '#4c9dff', '#2fc98d', '#ffffff'];

let annotationSeq = 0;

export const FrameAnnotator: React.FC<FrameAnnotatorProps> = ({ frame, initial, onConfirm, onClose }) => {
  const project = useProjectStore((s) => s.project);
  const [stageRef, stageSize] = useMeasure<HTMLDivElement>();

  const [annotations, setAnnotations] = useState<Annotation[]>(initial);
  const [tool, setTool] = useState<Tool>('arrow');
  const [color, setColor] = useState(COLORS[0]);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingLabel, setPendingLabel] = useState<{ x: number; y: number } | null>(null);
  const [labelText, setLabelText] = useState('');

  const overlayRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  /* State updaters must stay pure, so the in-progress mark also lives in a
     ref — that is what the pointerup handler commits from. */
  const draftRef = useRef<Annotation | null>(null);

  /* ── Fit the frame into the available stage ── */
  const display = useMemo(() => {
    const maxW = Math.max(120, stageSize.width);
    const maxH = Math.max(120, stageSize.height);
    const scale = Math.min(maxW / project.width, maxH / project.height);
    return {
      scale,
      width: project.width * scale,
      height: project.height * scale,
    };
  }, [stageSize, project.width, project.height]);

  const toProject = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) => ({
      x: Math.round((clientX - rect.left) / display.scale),
      y: Math.round((clientY - rect.top) / display.scale),
    }),
    [display.scale]
  );

  /* ── Load the frame bitmap once ── */
  useEffect(() => {
    if (!frame.dataUrl) return;
    const img = new Image();
    img.onload = () => { imageRef.current = img; redraw(); };
    img.src = frame.dataUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame.dataUrl]);

  /* ── Repaint ── */
  const redraw = useCallback(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(display.width);
    const h = Math.round(display.height);
    if (w < 2 || h < 2) return;

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (imageRef.current) {
      ctx.drawImage(imageRef.current, 0, 0, w, h);
    } else {
      ctx.fillStyle = '#101216';
      ctx.fillRect(0, 0, w, h);
    }

    // Draw annotations in project space.
    ctx.setTransform(dpr * display.scale, 0, 0, dpr * display.scale, 0, 0);
    const all = draft ? [...annotations, draft] : annotations;
    drawAnnotations(ctx, all, project);

    // Highlight the selected mark.
    if (selectedId) {
      const sel = annotations.find((a) => a.id === selectedId);
      const anchor = sel && labelAnchor(sel);
      if (anchor) {
        const unit = Math.max(project.width, project.height) / 900;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 * unit;
        ctx.setLineDash([6 * unit, 4 * unit]);
        ctx.beginPath();
        ctx.arc(anchor.x, anchor.y, 26 * unit, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [annotations, draft, display, project, selectedId]);

  useEffect(() => { redraw(); }, [redraw]);

  /* ── Drawing ── */
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || pendingLabel) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const start = toProject(e.clientX, e.clientY, rect);

    if (tool === 'select') {
      const hit = hitTestAnnotation(annotations, start, project);
      setSelectedId(hit?.id ?? null);
      return;
    }

    if (tool === 'text') {
      setPendingLabel(start);
      setLabelText('');
      return;
    }

    const next: Annotation = {
      id: `an_${++annotationSeq}_${Date.now().toString(36)}`,
      kind: tool,
      points: tool === 'freehand' || tool === 'point' ? [start] : [start, start],
      color,
      strokeWidth: 3,
      targets: [],
    };
    draftRef.current = next;
    setDraft(next);
    setSelectedId(null);

    // A pin needs no drag — commit immediately.
    if (tool === 'point') {
      draftRef.current = null;
      commit({ ...next, targets: resolveAnnotationTargets(next) });
      setDraft(null);
      return;
    }

    const move = (ev: PointerEvent) => {
      const current = draftRef.current;
      if (!current) return;
      const p = toProject(ev.clientX, ev.clientY, rect);

      let updated: Annotation;
      if (current.kind === 'freehand') {
        const last = current.points[current.points.length - 1];
        // Thin the stroke so a long drag doesn't store thousands of points.
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < 6) return;
        updated = { ...current, points: [...current.points, p] };
      } else {
        updated = { ...current, points: [current.points[0], p] };
      }

      draftRef.current = updated;
      setDraft(updated);
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);

      const finished = draftRef.current;
      draftRef.current = null;
      setDraft(null);

      if (finished && !isDegenerate(finished)) {
        commit({ ...finished, targets: resolveAnnotationTargets(finished) });
      }
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const commit = (a: Annotation) => setAnnotations((prev) => [...prev, a]);

  const confirmLabel = () => {
    if (!pendingLabel) return;
    const text = labelText.trim();
    if (text) {
      const a: Annotation = {
        id: `an_${++annotationSeq}_${Date.now().toString(36)}`,
        kind: 'text',
        points: [pendingLabel],
        color,
        strokeWidth: 3,
        text,
        targets: [],
      };
      commit({ ...a, targets: resolveAnnotationTargets(a) });
    }
    setPendingLabel(null);
    setLabelText('');
  };

  const undoLast = () => setAnnotations((prev) => prev.slice(0, -1));
  const deleteSelected = () => {
    if (!selectedId) return;
    setAnnotations((prev) => prev.filter((a) => a.id !== selectedId));
    setSelectedId(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pendingLabel) return;
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); deleteSelected(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoLast(); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onConfirm(annotations); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, selectedId, pendingLabel]);

  /* ── What the marks resolve to ── */
  const resolvedSummary = useMemo(() => {
    const names = new Set<string>();
    for (const a of annotations) for (const t of a.targets) names.add(t.clipName);
    return [...names];
  }, [annotations]);

  return (
    <div className="scrim" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-shell w-[900px] max-w-[94vw] max-h-[92vh] flex flex-col"
      >
        {/* Header */}
        <div className="panel-header">
          <div className="flex items-center gap-2 min-w-0">
            <Pencil className="w-3.5 h-3.5 text-spectrum-accent flex-shrink-0" />
            <span className="text-ui font-semibold text-spectrum-text">Mark up the frame</span>
            <span className="chip font-mono flex-shrink-0">
              {frame.timecode} · frame {frame.frameNumber}
            </span>
          </div>
          <button onClick={onClose} className="pro-btn w-6 h-6">
            aria-label="Close the annotator"
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-3 py-2 border-b border-line flex items-center gap-2 flex-wrap flex-shrink-0">
          <div className="seg-group">
            {TOOLS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => { setTool(t.id); setSelectedId(null); }}
                  className={`seg-item ${tool === t.id ? 'seg-item-active' : ''}`}
                  title={t.hint}
                
            aria-label={t.hint}>
                  <Icon className="w-3 h-3" />
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1 ml-1">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-5 h-5 rounded-full border-2 transition-transform ${
                  color === c ? 'border-white scale-110' : 'border-transparent hover:scale-105'
                }`}
                style={{ background: c }}
                title={`Use ${c}`}
              
            aria-label={`Use ${c}`}
            />
            ))}
          </div>

          <div className="flex items-center gap-1 ml-auto">
            <button onClick={undoLast} disabled={annotations.length === 0} className="pro-btn w-6 h-6" title="Undo last mark (⌘Z)"
            aria-label="Undo last mark (⌘Z)">
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={deleteSelected} disabled={!selectedId} className="btn-ghost-danger w-6 h-6" title="Delete selected mark (⌫)"
            aria-label="Delete selected mark (⌫)">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => { setAnnotations([]); setSelectedId(null); }}
              disabled={annotations.length === 0}
              className="pro-btn h-6 px-2 text-micro"
            >
              Clear all
            </button>
          </div>
        </div>

        {/* Stage */}
        <div ref={stageRef} className="flex-1 min-h-[260px] p-3 flex items-center justify-center bg-spectrum-sunken relative overflow-hidden">
          {frame.unavailableReason ? (
            <div className="text-center px-8">
              <p className="text-ui font-medium text-spectrum-text">The frame could not be captured</p>
              <p className="text-ui-sm text-spectrum-textDim mt-1 max-w-[420px] leading-relaxed">
                {frame.unavailableReason}
              </p>
            </div>
          ) : (
            <div className="relative" style={{ width: display.width, height: display.height }}>
              <canvas
                ref={overlayRef}
                onPointerDown={handlePointerDown}
                className={`block rounded-[3px] ring-1 ring-line-strong ${
                  tool === 'select' ? 'cursor-pointer' : 'cursor-crosshair'
                }`}
              />

              {/* Inline label composer */}
              {pendingLabel && (
                <div
                  className="absolute z-10 flex items-center gap-1"
                  style={{
                    left: Math.min(display.width - 200, pendingLabel.x * display.scale),
                    top: Math.max(0, pendingLabel.y * display.scale - 16),
                  }}
                >
                  <input
                    autoFocus
                    value={labelText}
                    onChange={(e) => setLabelText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); confirmLabel(); }
                      if (e.key === 'Escape') { e.preventDefault(); setPendingLabel(null); }
                    }}
                    placeholder="Type a note…"
                    className="pro-input h-7 px-2 text-ui-sm w-44"
                  />
                  <button onClick={confirmLabel} className="btn-primary w-7 h-7" title="Add label"
            aria-label="Add label">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* What the marks resolve to */}
        <div className="px-3 py-2 border-t border-line flex-shrink-0 min-h-[52px]">
          {annotations.length === 0 ? (
            <p className="text-ui-sm text-spectrum-textDim">
              Draw an arrow at whatever you are talking about. I resolve each mark to the exact layer beneath it, so
              you can say “make <em>this</em> smaller” and I will know what you mean.
            </p>
          ) : (
            <div className="space-y-1 max-h-24 overflow-y-auto">
              {annotations.map((a, i) => (
                <div key={a.id} className="flex items-center gap-2 text-ui-sm">
                  <span
                    className="w-4 h-4 rounded-full flex items-center justify-center text-micro font-bold text-black flex-shrink-0"
                    style={{ background: a.color }}
                  >
                    {i + 1}
                  </span>
                  <span className="text-spectrum-textMuted capitalize flex-shrink-0">{a.kind}</span>
                  {a.text && <span className="text-spectrum-text truncate">“{a.text}”</span>}
                  <span className="text-spectrum-textFaint flex-shrink-0">→</span>
                  <span className="text-spectrum-accent truncate">
                    {a.targets.length > 0
                      ? a.targets.map((t) => t.clipName).join(', ')
                      : 'empty canvas area'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-2.5 border-t border-line flex items-center justify-between gap-3 flex-shrink-0">
          <p className="text-micro text-spectrum-textFaint">
            {resolvedSummary.length > 0
              ? `Resolves to: ${resolvedSummary.join(' · ')}`
              : 'Marks are stored in project pixels, so they stay accurate at any zoom.'}
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={onClose} className="pro-btn-filled h-7 px-3 text-ui-sm">Cancel</button>
            <button onClick={() => onConfirm(annotations)} className="btn-primary h-7 px-3 gap-1.5 text-ui-sm">
              <Check className="w-3.5 h-3.5" />
              Attach {annotations.length > 0 ? `with ${annotations.length} mark${annotations.length === 1 ? '' : 's'}` : 'frame'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ── Helpers ────────────────────────────────────────────────────── */

function isDegenerate(a: Annotation): boolean {
  if (a.kind === 'freehand') return a.points.length < 3;
  const [p1, p2] = a.points;
  if (!p1 || !p2) return true;
  return Math.hypot(p2.x - p1.x, p2.y - p1.y) < 8;
}

function hitTestAnnotation(
  annotations: Annotation[],
  point: { x: number; y: number },
  project: { width: number; height: number }
): Annotation | null {
  const tolerance = Math.max(project.width, project.height) * 0.03;
  // Topmost first so the most recent mark wins.
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i];
    const anchor = labelAnchor(a);
    if (anchor && Math.hypot(point.x - anchor.x, point.y - anchor.y) <= tolerance) return a;
    if (a.points.some((p) => Math.hypot(point.x - p.x, point.y - p.y) <= tolerance)) return a;
  }
  return null;
}
