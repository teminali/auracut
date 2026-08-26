/* ═══════════════════════════════════════════════════════════════════
   Frame capture — renders the exact composited frame at a timeline
   position into an offscreen canvas, independent of the DOM.

   Rendering fresh (rather than reading the visible canvas) means the
   capture is correct even when the monitor is scrolled away, zoomed, or
   partially covered by the gizmo.
   ═══════════════════════════════════════════════════════════════════ */

import { Track, ProjectSettings } from '../types/edl';
import { Annotation, CapturedFrame } from '../types/context';
import { renderTimelineFrame, hasTaintedMedia, lastFramePendingMedia } from './compositor';
import { formatTimecode } from '../utils/time';

/** Longest edge of a captured frame. Big enough to read, small enough to send. */
const MAX_CAPTURE_EDGE = 960;

/* JPEG rather than PNG: a photographic frame encodes ~15× smaller, which
   matters when the frame travels to a model on every prompt. */
const CAPTURE_MIME = 'image/jpeg';
const CAPTURE_QUALITY = 0.82;

/* Two canvases: the compositor always draws at full project size (it resets
   the transform internally, so pre-scaling its context does not work), then
   we downscale into the export canvas. */
let fullCanvas: HTMLCanvasElement | null = null;
let exportCanvas: HTMLCanvasElement | null = null;

function sizedCanvas(existing: HTMLCanvasElement | null, width: number, height: number): HTMLCanvasElement {
  const canvas = existing ?? document.createElement('canvas');
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return canvas;
}

/**
 * Render and export the frame at `atMs`.
 * Returns a `CapturedFrame` whose `unavailableReason` is set (rather than
 * throwing) when the canvas is tainted by cross-origin media.
 */
export function captureFrame(
  tracks: Track[],
  project: ProjectSettings,
  atMs: number
): CapturedFrame {
  const scale = Math.min(1, MAX_CAPTURE_EDGE / Math.max(project.width, project.height));
  const width = Math.round(project.width * scale);
  const height = Math.round(project.height * scale);

  const frameNumber = Math.round((atMs / 1000) * project.fps);
  const base: Omit<CapturedFrame, 'dataUrl'> = {
    width,
    height,
    atMs: Math.round(atMs),
    timecode: formatTimecode(atMs, project.fps),
    frameNumber,
    // Filled in after the draw — nothing has been rendered yet.
    mediaPending: [],
  };

  fullCanvas = sizedCanvas(fullCanvas, project.width, project.height);
  const fullCtx = fullCanvas.getContext('2d');
  if (!fullCtx) {
    return { ...base, dataUrl: '', unavailableReason: 'This browser could not open a 2D context.' };
  }

  renderTimelineFrame(fullCtx, tracks, project, atMs, project.width, project.height);
  /*
    Read immediately after the draw and before anything else can render.
    The compositor also paints the on-screen monitor every animation
    frame, and that would overwrite the record with ITS frame — which is
    at the playhead, not at `atMs`, and is exactly the sort of difference
    that turns a decode warning into a lie.
  */
  base.mediaPending = lastFramePendingMedia();

  exportCanvas = sizedCanvas(exportCanvas, width, height);
  const ctx = exportCanvas.getContext('2d');
  if (!ctx) {
    return { ...base, dataUrl: '', unavailableReason: 'This browser could not open a 2D context.' };
  }

  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(fullCanvas, 0, 0, width, height);

  try {
    return { ...base, dataUrl: exportCanvas.toDataURL(CAPTURE_MIME, CAPTURE_QUALITY) };
  } catch {
    // A tainted canvas throws on export — surface why, don't crash.
    return {
      ...base,
      dataUrl: '',
      unavailableReason: hasTaintedMedia()
        ? 'Some media loaded without CORS headers, so the frame cannot be exported. Re-import those files locally to share frames.'
        : 'The frame could not be exported from this canvas.',
    };
  }
}

/* ── Annotation rendering ───────────────────────────────────────── */

/**
 * Draw annotations over a frame and return a new data URL.
 * Coordinates are in project space, so this works at any capture scale.
 */
export function renderAnnotatedFrame(
  frame: CapturedFrame,
  annotations: Annotation[],
  project: ProjectSettings
): Promise<string> {
  return new Promise((resolve) => {
    if (!frame.dataUrl || annotations.length === 0) {
      resolve(frame.dataUrl);
      return;
    }

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = frame.width;
      canvas.height = frame.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(frame.dataUrl);
        return;
      }

      ctx.drawImage(img, 0, 0, frame.width, frame.height);

      const scale = frame.width / project.width;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawAnnotations(ctx, annotations, project);

      try {
        resolve(canvas.toDataURL(CAPTURE_MIME, CAPTURE_QUALITY));
      } catch {
        resolve(frame.dataUrl);
      }
    };
    img.onerror = () => resolve(frame.dataUrl);
    img.src = frame.dataUrl;
  });
}

/** Paint the annotation set in project coordinates onto any 2D context. */
export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: Annotation[],
  project: ProjectSettings
): void {
  // Scale line weights with the frame so they read the same at any size.
  const unit = Math.max(project.width, project.height) / 900;

  annotations.forEach((a, index) => {
    ctx.save();
    ctx.strokeStyle = a.color;
    ctx.fillStyle = a.color;
    ctx.lineWidth = a.strokeWidth * unit;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 6 * unit;

    switch (a.kind) {
      case 'arrow': {
        const [from, to] = a.points;
        if (!from || !to) break;
        drawArrow(ctx, from, to, a.strokeWidth * unit);
        break;
      }

      case 'rect': {
        const [p1, p2] = a.points;
        if (!p1 || !p2) break;
        ctx.strokeRect(
          Math.min(p1.x, p2.x), Math.min(p1.y, p2.y),
          Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y)
        );
        break;
      }

      case 'ellipse': {
        const [p1, p2] = a.points;
        if (!p1 || !p2) break;
        ctx.beginPath();
        ctx.ellipse(
          (p1.x + p2.x) / 2, (p1.y + p2.y) / 2,
          Math.abs(p2.x - p1.x) / 2, Math.abs(p2.y - p1.y) / 2,
          0, 0, Math.PI * 2
        );
        ctx.stroke();
        break;
      }

      case 'freehand': {
        if (a.points.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(a.points[0].x, a.points[0].y);
        for (let i = 1; i < a.points.length; i++) ctx.lineTo(a.points[i].x, a.points[i].y);
        ctx.stroke();
        break;
      }

      case 'point': {
        const p = a.points[0];
        if (!p) break;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7 * unit, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 14 * unit, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }

      case 'text':
        break; // the label below covers it
    }

    // Every annotation carries a numbered badge so prose can reference it.
    const anchor = labelAnchor(a);
    if (anchor) {
      drawBadge(ctx, anchor.x, anchor.y, String(index + 1), a.text, a.color, unit);
    }

    ctx.restore();
  });
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  width: number
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = Math.max(14, width * 4);

  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - head * Math.cos(angle - Math.PI / 7), to.y - head * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(to.x - head * Math.cos(angle + Math.PI / 7), to.y - head * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  number: string,
  label: string | undefined,
  color: string,
  unit: number
): void {
  const fontSize = 20 * unit;
  ctx.save();
  ctx.shadowBlur = 4 * unit;
  ctx.font = `700 ${fontSize}px Inter, sans-serif`;
  ctx.textBaseline = 'middle';

  const labelText = label ? ` ${label}` : '';
  const textWidth = ctx.measureText(number + labelText).width;
  const padX = 9 * unit;
  const boxH = fontSize * 1.6;
  const boxW = textWidth + padX * 2;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x - boxW / 2, y - boxH - 10 * unit, boxW, boxH, boxH / 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.fillStyle = '#0a0b0e';
  ctx.textAlign = 'center';
  ctx.fillText(number + labelText, x, y - boxH / 2 - 10 * unit);
  ctx.restore();
}

/** Where an annotation's badge should sit. */
export function labelAnchor(a: Annotation): { x: number; y: number } | null {
  if (a.points.length === 0) return null;

  switch (a.kind) {
    case 'arrow':
      return a.points[1] ?? a.points[0];
    case 'rect':
    case 'ellipse': {
      const [p1, p2] = a.points;
      if (!p2) return p1;
      return { x: (p1.x + p2.x) / 2, y: Math.min(p1.y, p2.y) };
    }
    case 'freehand': {
      // Top-most point keeps the badge clear of the stroke.
      let top = a.points[0];
      for (const p of a.points) if (p.y < top.y) top = p;
      return top;
    }
    default:
      return a.points[0];
  }
}
