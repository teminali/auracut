/* ═══════════════════════════════════════════════════════════════════
   The look a screen recording needs to stop looking like a screen
   recording.

   A raw capture is a rectangle of someone's desktop, edge to edge, at
   whatever brightness their theme happens to be. Four things turn that
   into something that reads as shot rather than grabbed, and all four
   are cheap:

     1. **The frame is inset and rounded.** Pulling the picture off the
        edges and rounding its corners is what stops it reading as a
        window and starts it reading as a subject. It is also what makes
        the zoom legible: at rest you can see the whole thing sitting in
        space, and when it pushes in the padding collapses and the
        content fills the frame, which is a MOVE rather than a crop.

     2. **Something behind it.** A gradient, dark, off-axis. The frame
        needs to be inset INTO something; inset into black it just looks
        like a smaller video.

     3. **It opens and closes.** A dip from black at the head and to
        black at the tail. Two half-second clips, and they do more for
        "finished" than anything else here.

     4. **A vignette, barely.** Ten percent. Enough to hold the eye off
        the corners, not enough to darken anything anybody has to read.

   ── The one thing deliberately NOT here ────────────────────────────

   A drop shadow under the frame. It is the obvious fifth item and it
   cannot be had at the same time as the rounded corners: `applyMask`
   calls `ctx.clip()` before the layer is drawn, so a shadow cast by the
   same clip is clipped away — `buildPipPatch` documents exactly this
   trade and refuses to claim both. A shadow could be faked with a
   rounded shape behind the picture, but that shape would then need
   every one of the zoom's keyframes copied onto it to stay under the
   frame, and two copies of a keyframe track drift the moment anybody
   edits one. On a dark backdrop the corners carry the shape and the
   shadow would barely be visible anyway. Corners win.
   ═══════════════════════════════════════════════════════════════════ */

import { useTimelineStore } from '../store/timelineStore';
import { Easing, ProjectSettings } from '../types/edl';

/* ── Backdrops ──────────────────────────────────────────────────── */

export type BackdropId = 'graphite' | 'midnight' | 'clay' | 'daylight' | 'none';

export interface Backdrop {
  id: BackdropId;
  label: string;
  from: string;
  to: string;
  angle: number;
}

/*
  Dark, all of them, and low in saturation. A screen recording is mostly
  bright UI, and a backdrop with any real colour in it competes with the
  thing it is meant to be holding.
*/
export const BACKDROPS: Backdrop[] = [
  { id: 'graphite', label: 'Graphite', from: '#232830', to: '#0a0c10', angle: 135 },
  { id: 'midnight', label: 'Midnight', from: '#16203a', to: '#05070d', angle: 135 },
  { id: 'clay', label: 'Clay', from: '#33201a', to: '#0d0806', angle: 135 },
  /*
    `daylight` is the odd one out and it is measured rather than chosen.

    It is the backdrop of the reference video the cutting grammar came
    from, fitted by least squares over the 35% of that frame the mockup
    does not cover: a 2-stop linear gradient at 70.5 degrees from
    #a492c6 to #fcf5f7.

    **The fit is 8.2% RMS wrong and it is offered anyway, labelled.** The
    real backdrop is a three-corner mesh — indigo #95a0e8 top-left, coral
    #f1b3aa top-right, near-white #e9ebfa the whole way across the bottom
    — and no two-stop linear gradient holds that. `Backdrop` has `from`,
    `to` and `angle` and nothing else, so this is the closest thing the
    format can say. A mesh gradient is in the capability log rather than
    faked here.

    It is not the DEFAULT, and the reason is written in the paragraph at
    the top of this list: a screen recording is mostly bright UI and a
    bright backdrop competes with it. The reference gets away with it
    because its subject is a mockup rendered on that gradient rather than
    a window captured off somebody's desktop. One reference video is not
    evidence that this is the better choice for arbitrary footage.
  */
  { id: 'daylight', label: 'Daylight', from: '#a492c6', to: '#fcf5f7', angle: 70.5 },
];

/* ── Options ────────────────────────────────────────────────────── */

export interface LookOptions {
  backdrop: BackdropId;
  /** The picture's width as a percentage of the frame at rest. 100 is edge to edge. */
  insetPct: number;
  /** Corner radius, as a percentage of the canvas height. */
  cornerPct: number;
  /** 0..100, on the picture's own filter stack. */
  vignette: number;
  fadeInMs: number;
  fadeOutMs: number;
}

export const DEFAULT_LOOK: LookOptions = {
  backdrop: 'graphite',
  insetPct: 92,
  cornerPct: 1.8,
  vignette: 10,
  fadeInMs: 450,
  fadeOutMs: 620,
};

/**
 * A shape layer's box is 480x480 whatever the canvas is, so every size
 * below is derived from that rather than from the project dimensions.
 * Straight out of `starterProject.ts`, for the same reason.
 */
const SHAPE_BASE = 480;

/** 1.02 so a shape that is meant to bleed never shows an edge. */
const BLEED = 1.02;

const store = () => useTimelineStore.getState();

/* ── The backdrop ───────────────────────────────────────────────── */

/** Full-bleed gradient behind everything. Returns the clip id, or null. */
export function addBackdrop(
  trackId: string,
  project: ProjectSettings,
  durationMs: number,
  backdrop: BackdropId
): string | null {
  const preset = BACKDROPS.find((b) => b.id === backdrop);
  if (!preset) return null;

  const id = store().addShapeLayer(trackId, 'rectangle', 0, Math.round(durationMs));
  /*
    `updateShapeStyle` rather than `patchClip`. A gradient is a nested
    object, and the property-path validator addresses scalars — writing
    `shapeStyle.gradient` as a path would either be refused or, worse,
    accepted and dropped.
  */
  store().updateShapeStyle(id, {
    fill: preset.to,
    gradient: { from: preset.from, to: preset.to, angle: preset.angle },
    strokeWidth: 0,
    cornerRadius: 0,
  });
  store().patchClip(id, {
    name: `Backdrop · ${preset.label}`,
    'transform.scaleX': (project.width / SHAPE_BASE) * BLEED,
    'transform.scaleY': (project.height / SHAPE_BASE) * BLEED,
  });
  return id;
}

/* ── The picture ────────────────────────────────────────────────── */

/**
 * Round the picture's corners and take the edge off it.
 *
 * The INSET itself is not applied here: it is a scale, and the scale is
 * the same number the zoom is built on top of. Handing it back rather
 * than writing it means there is exactly one place that decides how big
 * the picture is, which is `recordingProject`.
 */
export function applyScreenLook(clipId: string, project: ProjectSettings, look: LookOptions): void {
  const radius = Math.round((look.cornerPct / 100) * project.height);
  store().patchClip(clipId, {
    'mask.enabled': radius > 0,
    'mask.type': 'rectangle',
    'mask.sizeX': 100,
    'mask.sizeY': 100,
    'mask.offsetX': 0,
    'mask.offsetY': 0,
    'mask.rotation': 0,
    'mask.roundness': radius,
    'mask.featherPx': 0,
    'mask.inverted': false,
    'filters.vignette': look.vignette,
  });
}

/* ── Opening and closing ────────────────────────────────────────── */

/**
 * A dip from black and a dip to black, as two short clips.
 *
 * Two clips rather than one full-length one that is transparent in the
 * middle: a full-frame rectangle at opacity 0 still costs a whole-canvas
 * composite on every frame of the take, for nothing. These cost nothing
 * for the ninety-odd percent of the film they are not on.
 */
export function addFades(
  trackId: string,
  project: ProjectSettings,
  durationMs: number,
  look: LookOptions
): string[] {
  const made: string[] = [];

  const slab = (startMs: number, lengthMs: number, name: string, keys: [number, number][], easing: Easing) => {
    const id = store().addShapeLayer(trackId, 'rectangle', Math.round(startMs), Math.round(lengthMs));
    store().updateShapeStyle(id, { fill: '#000000', strokeWidth: 0, cornerRadius: 0 });
    store().patchClip(id, {
      name,
      'transform.scaleX': (project.width / SHAPE_BASE) * BLEED,
      'transform.scaleY': (project.height / SHAPE_BASE) * BLEED,
    });
    for (const [ms, value] of keys) {
      store().addKeyframe(id, { property: 'opacity', timeOffsetMs: Math.round(ms), value, easing });
    }
    made.push(id);
    return id;
  };

  if (look.fadeInMs > 0) {
    slab(0, look.fadeInMs, 'Open', [[0, 1], [look.fadeInMs, 0]], 'easeOut');
  }
  if (look.fadeOutMs > 0 && durationMs > look.fadeOutMs) {
    slab(
      durationMs - look.fadeOutMs, look.fadeOutMs, 'Close',
      [[0, 0], [look.fadeOutMs, 1]], 'easeIn'
    );
  }

  return made;
}

/* ── The camera ─────────────────────────────────────────────────── */

/** The same expo-out the zoom uses, so every move feels like one hand. */
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export interface PipPose {
  scale: number;
  x: number;
  y: number;
  /** Corner radius in project pixels. */
  roundness: number;
}

export interface CameraMotion {
  /** Where the inset sits for most of the take. */
  pip: PipPose;
  /** The scale that makes the camera cover the whole canvas. */
  coverScale: number;
  /** Stretches, in CLIP time, where the camera takes the whole frame. */
  fullFrame: { startMs: number; endMs: number }[];
  /** How long the clip runs, so the last hold has somewhere to end. */
  durationMs: number;
}

/** How long the camera takes to grow into the frame, and to leave it. */
export const CAMERA_TAKEOVER_MS = 620;
const ENTER_MS = 420;

/**
 * Everything the camera clip does, written as one keyframe track.
 *
 * It has to be one function rather than an entrance here and a takeover
 * there, and the reason is a property of the interpolator rather than a
 * matter of taste: `interpolateKeyframes` falls back to a clip's STATIC
 * transform only when a property has no keyframes at all. Add an
 * entrance that keyframes scale and leave position static, then add a
 * takeover that keyframes position, and the position track suddenly
 * starts at whatever the takeover wrote — the inset jumps to the middle
 * of the frame for the first half of the take. Every property that moves
 * at any point must therefore be pinned at time zero, and the only way
 * to be sure of that is to emit them together.
 */
export function addCameraMotion(clipId: string, motion: CameraMotion): void {
  type Prop = 'opacity' | 'scaleX' | 'scaleY' | 'positionX' | 'positionY' | 'mask.roundness';
  const track: Record<Prop, [number, number][]> = {
    opacity: [[0, 0], [ENTER_MS * 0.7, 1]],
    scaleX: [[0, motion.pip.scale * 0.84], [ENTER_MS, motion.pip.scale]],
    scaleY: [[0, motion.pip.scale * 0.84], [ENTER_MS, motion.pip.scale]],
    positionX: [[0, motion.pip.x]],
    positionY: [[0, motion.pip.y]],
    'mask.roundness': [[0, motion.pip.roundness]],
  };

  for (const stretch of motion.fullFrame) {
    const inAt = Math.max(ENTER_MS + 1, stretch.startMs);
    const held = Math.max(inAt + 1, stretch.endMs);
    const outAt = Math.min(motion.durationMs, held + CAMERA_TAKEOVER_MS);

    /* Four points per property: leave the inset, arrive full frame, hold
       there, come back. The leaving point repeats the inset pose so the
       move starts from where the frame actually is rather than from
       wherever the previous segment left off. */
    const from = Math.max(0, inAt - CAMERA_TAKEOVER_MS);
    track.scaleX.push([from, motion.pip.scale], [inAt, motion.coverScale],
      [held, motion.coverScale], [outAt, motion.pip.scale]);
    track.scaleY.push([from, motion.pip.scale], [inAt, motion.coverScale],
      [held, motion.coverScale], [outAt, motion.pip.scale]);
    track.positionX.push([from, motion.pip.x], [inAt, 0], [held, 0], [outAt, motion.pip.x]);
    track.positionY.push([from, motion.pip.y], [inAt, 0], [held, 0], [outAt, motion.pip.y]);
    /* Square at full frame. A rounded corner is what says "this is an
       inset"; edge to edge it would just look like a mistake. */
    track['mask.roundness'].push(
      [from, motion.pip.roundness], [inAt, 0], [held, 0], [outAt, motion.pip.roundness]
    );
  }

  for (const [property, points] of Object.entries(track) as [Prop, [number, number][]][]) {
    for (const [ms, value] of points) {
      store().addKeyframe(clipId, {
        property,
        timeOffsetMs: Math.max(0, Math.round(ms)),
        value,
        easing: 'bezier',
        bezierPoints: EASE,
      });
    }
  }
}

/* ── Is the camera good enough to fill the frame? ───────────────── */

/**
 * Past this much enlargement a webcam blown up to full frame is visibly
 * soft, and a soft full-frame shot is worse than a sharp small one.
 *
 * 1.35 is deliberately strict. A 720p camera in a 1080p sequence needs
 * 1.5 and does not pass, which is the right answer: it looks like a
 * webcam blown up, because it is.
 */
export const MAX_CAMERA_UPSCALE = 1.35;

export interface CameraFillVerdict {
  ok: boolean;
  /** How much the camera has to be enlarged to cover the canvas. */
  upscale: number;
  /** Written for the person reading the studio, when it is not ok. */
  reason?: string;
}

export function cameraCanFillFrame(
  camera: { width: number; height: number },
  project: { width: number; height: number }
): CameraFillVerdict {
  if (camera.width <= 0 || camera.height <= 0) {
    return { ok: false, upscale: Infinity, reason: 'The camera did not report a size.' };
  }

  const upscale = Math.max(project.width / camera.width, project.height / camera.height);
  if (upscale > MAX_CAMERA_UPSCALE) {
    return {
      ok: false,
      upscale,
      reason:
        `The camera records at ${camera.width}x${camera.height} and the sequence is `
        + `${project.width}x${project.height}, so filling the frame would enlarge it `
        + `${upscale.toFixed(2)} times and it would look soft. It stays an inset. `
        + 'Recording the camera at 1080p is what fixes this.',
    };
  }
  return { ok: true, upscale };
}
