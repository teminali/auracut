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

export type BackdropId =
  | 'daylight' | 'linen' | 'blossom' | 'lagoon' | 'dusk'
  | 'graphite' | 'midnight' | 'clay'
  | 'none';

export interface Backdrop {
  id: BackdropId;
  label: string;
  from: string;
  to: string;
  angle: number;
  /** Extra colours along the axis, 0..1. */
  stops?: { color: string; at: number }[];
  /** Soft radial washes over the base — what makes a MESH rather than a ramp. */
  blobs?: { color: string; x: number; y: number; radius: number; opacity: number }[];
  /** True for the light set, so the UI can group them and the picture can be told apart. */
  light?: boolean;
}

/*
  ── The light set, and why it is now the front half of the list ─────

  This list used to be three dark gradients and a paragraph explaining
  that a screen recording is mostly bright UI, so a backdrop with any
  real colour in it competes with the thing it is meant to be holding.
  That reasoning is still true and the dark set is still here for the
  cases it is right for — a dark-theme editor, a terminal, a demo shot
  at night.

  It was also, as a DEFAULT, wrong. Every tool people actually make
  screen tutorials with — Screen Studio, Recordly, Tella, Focusee — puts
  the picture on a soft light gradient, and that is not a coincidence of
  taste: a light backdrop reads as PAPER behind a screen, and a dark one
  reads as a video player with a small video in it. The rounded inset
  only looks like an object sitting on something when the something is
  lighter than the object's shadow would be.

  ── Mesh, not ramps ─────────────────────────────────────────────────

  Four of the five light backdrops carry `blobs`. A two-stop ramp always
  looks like a two-stop ramp: it has a visible direction and a flat
  middle. What those tools ship instead is two or three soft radial
  washes over a near-white base, so the colour pools in corners and
  fades to nothing in the centre, which is where the picture goes. The
  measurement behind the whole feature is on `daylight` below.

  Saturation is kept low on purpose and it is not only taste: the
  verification suites identify the recording by which channel dominates
  a pixel by 40 or more, so a backdrop that is strongly one colour would
  start being counted as footage. `verify.py` asserts the edges are NOT
  the recording, and a violently blue backdrop would quietly turn that
  check into a different check.
*/
export const BACKDROPS: Backdrop[] = [
  /*
    `daylight` is the measured one: the backdrop of the reference video
    in HANDOVER §7c, read off the 35% of its opening frame that the
    mockup does not cover. Indigo at the top left, coral at the top
    right, near-white across the whole bottom.

    The two-stop fit to that was 8.2% RMS wrong and shipped anyway,
    labelled, because `Backdrop` could not say anything else. It can
    now, and the fitted mesh is 1.5% — the same pixels, the same
    measurement, five and a half times closer. A third blob buys 0.1%
    and is not worth a preset that is harder to read.
  */
  {
    id: 'daylight',
    label: 'Daylight',
    light: true,
    from: '#eceefc',
    to: '#f6f2f0',
    angle: 90,
    blobs: [
      { color: '#8f9be8', x: 0.10, y: 0.06, radius: 0.62, opacity: 0.85 },
      { color: '#f4a99a', x: 0.94, y: 0.05, radius: 0.55, opacity: 0.80 },
    ],
  },
  /*
    The minimal one, and the safest default for footage nobody has seen.
    Barely a gradient at all — just enough separation for the inset's
    edge to read against it.
  */
  {
    id: 'linen',
    label: 'Linen',
    light: true,
    from: '#f7f8fa',
    to: '#e6e9ef',
    angle: 112,
  },
  {
    id: 'blossom',
    label: 'Blossom',
    light: true,
    from: '#fdf3ee',
    to: '#f7eef4',
    angle: 100,
    blobs: [
      { color: '#f6b8a4', x: 0.08, y: 0.12, radius: 0.58, opacity: 0.62 },
      { color: '#e7b6d4', x: 0.92, y: 0.88, radius: 0.60, opacity: 0.52 },
    ],
  },
  {
    id: 'lagoon',
    label: 'Lagoon',
    light: true,
    from: '#eef7f8',
    to: '#eaf1fb',
    angle: 80,
    blobs: [
      { color: '#9fd6d2', x: 0.12, y: 0.86, radius: 0.60, opacity: 0.58 },
      { color: '#a8c4ee', x: 0.90, y: 0.10, radius: 0.58, opacity: 0.58 },
    ],
  },
  {
    id: 'dusk',
    label: 'Dusk',
    light: true,
    from: '#eeecfa',
    to: '#f4eef6',
    angle: 120,
    blobs: [
      { color: '#a99ce4', x: 0.85, y: 0.14, radius: 0.66, opacity: 0.60 },
      { color: '#efc3b4', x: 0.14, y: 0.90, radius: 0.52, opacity: 0.45 },
    ],
  },

  /* Dark, low in saturation, and right when the subject is dark too. */
  { id: 'graphite', label: 'Graphite', from: '#232830', to: '#0a0c10', angle: 135 },
  { id: 'midnight', label: 'Midnight', from: '#16203a', to: '#05070d', angle: 135 },
  { id: 'clay', label: 'Clay', from: '#33201a', to: '#0d0806', angle: 135 },
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
  /**
   * How hard the picture sits on the backdrop, 0..100. 0 is flat.
   *
   * Blur and lift scale with the canvas, so the same number reads the
   * same at 720p and at 4K.
   */
  shadow: number;
  fadeInMs: number;
  fadeOutMs: number;
}

export const DEFAULT_LOOK: LookOptions = {
  backdrop: 'daylight',
  /*
    84, and it is measured: the mockup in the reference video fills
    84.1% of its frame's width, read off the largest bright low-saturation
    region of the opening frame.

    It was 92, which is a hairline. A backdrop nobody can see is not a
    backdrop, and 92 was chosen when the backdrop was near-black and the
    only job of the margin was to keep the picture off the edge. With a
    light backdrop the margin IS the look: it is what makes the picture
    read as an object resting on something rather than as a video with a
    border.
  */
  insetPct: 84,
  /*
    2.6% of the canvas height, so ~28px at 1080p.

    Not measured off the reference: its surface is in perspective in
    every frame where the outline shows, so the arc there is a projection
    of the tilt rather than a radius (HANDOVER §7c). This is set against
    the light backdrops instead, where the corner is now visible against
    something rather than lost against near-black, and 1.8% read as a
    square-cornered screenshot.
  */
  cornerPct: 2.6,
  /*
    Off by default, and this is a consequence of the light set.

    A vignette darkens the corners of the PICTURE, which on a dark
    backdrop is invisible and helpfully holds the eye in. On a light one
    it puts grey smudges in the corners of a white app window, and the
    frame either side of the inset stays bright, so it reads as a
    rendering fault rather than as framing.
  */
  vignette: 0,
  /*
    The last thing separating this from what Screen Studio, Recordly and
    Tella produce, and the thing that makes the inset read as an object
    resting on the backdrop rather than as a rectangle pasted onto it.

    Soft and low: 6% of the canvas height of blur, lifted 1.6%. A
    tighter, darker shadow reads as a UI card; this reads as a screen on
    a surface.
  */
  shadow: 34,
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
    gradient: {
      from: preset.from,
      to: preset.to,
      angle: preset.angle,
      ...(preset.stops ? { stops: preset.stops } : {}),
      ...(preset.blobs ? { blobs: preset.blobs } : {}),
    },
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
  const shadow = Math.max(0, Math.min(100, look.shadow));
  store().patchClip(clipId, {
    'mask.enabled': radius > 0 || shadow > 0,
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
  /*
    `updateClipMask` rather than a property path, for the same reason
    `addBackdrop` uses `updateShapeStyle`: the shadow is a nested object
    and the path validator addresses scalars.
  */
  store().updateClipMask(clipId, {
    shadow: shadow > 0
      ? {
        color: `rgba(24, 30, 48, ${(0.42 * shadow) / 100})`,
        blur: Math.round(project.height * 0.06 * (shadow / 100) * 2.4),
        offsetY: Math.round(project.height * 0.016 * (shadow / 100) * 2.4),
      }
      : undefined,
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

  /*
    Does the film OPEN full frame?

    An introduction starts on the first frame of the take, and the base
    track below settles the camera into its inset over `ENTER_MS`. Left
    alone, a take that opens on somebody saying hello would show the
    inset growing into place and then immediately expanding to fill the
    frame, which is a move in the wrong direction followed by a move to
    undo it. So the pose at time zero is the full frame instead, and the
    first stretch has nothing to arrive from.
  */
  const opensFull = motion.fullFrame.length > 0 && motion.fullFrame[0].startMs <= ENTER_MS;

  const track: Record<Prop, [number, number][]> = opensFull
    ? {
      opacity: [[0, 0], [ENTER_MS * 0.7, 1]],
      scaleX: [[0, motion.coverScale]],
      scaleY: [[0, motion.coverScale]],
      positionX: [[0, 0]],
      positionY: [[0, 0]],
      /* Square, because it is the whole frame. */
      'mask.roundness': [[0, 0]],
    }
    : {
      opacity: [[0, 0], [ENTER_MS * 0.7, 1]],
      scaleX: [[0, motion.pip.scale * 0.84], [ENTER_MS, motion.pip.scale]],
      scaleY: [[0, motion.pip.scale * 0.84], [ENTER_MS, motion.pip.scale]],
      positionX: [[0, motion.pip.x]],
      positionY: [[0, motion.pip.y]],
      'mask.roundness': [[0, motion.pip.roundness]],
    };

  for (let index = 0; index < motion.fullFrame.length; index++) {
    const stretch = motion.fullFrame[index];

    /* The opening stretch is already there and only has to leave. */
    if (opensFull && index === 0) {
      const held = Math.max(1, stretch.endMs);
      const outAt = Math.min(motion.durationMs, held + CAMERA_TAKEOVER_MS);
      track.scaleX.push([held, motion.coverScale], [outAt, motion.pip.scale]);
      track.scaleY.push([held, motion.coverScale], [outAt, motion.pip.scale]);
      track.positionX.push([held, 0], [outAt, motion.pip.x]);
      track.positionY.push([held, 0], [outAt, motion.pip.y]);
      track['mask.roundness'].push([held, 0], [outAt, motion.pip.roundness]);
      continue;
    }

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
