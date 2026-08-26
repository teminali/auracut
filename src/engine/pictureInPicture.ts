/* ═══════════════════════════════════════════════════════════════════
   Picture-in-picture — one clip as an inset over another.

   Improvised this is: add a track, insert the clip, guess a scale, patch
   x and y, render a frame, discover the inset is squashed because the
   source is portrait and the frame is landscape, patch again, discover it
   is BEHIND the background because the track went on the wrong side, move
   it, render again. Seven calls and a visual check, and the aspect bug
   only shows up on sources whose shape differs from the canvas — so it
   ships.

   ── Aspect ratio is the whole problem ──────────────────────────────

   The tempting arithmetic is `scaleX = targetW / canvasW`,
   `scaleY = targetH / canvasH`. It is correct arithmetic and the wrong
   picture: a 9:16 phone clip in a 16:9 sequence comes out stretched flat,
   and nothing in the project reports it, because both numbers were
   written exactly as asked. `create_grid_layout` says the same thing in
   its own comment, and it is the same trap here.

   So the inset is sized from the SOURCE's aspect ratio and scaled
   UNIFORMLY — `scaleX === scaleY`, always — with the width honoured and
   the height falling out of it, or the other way round when the height
   would otherwise leave the frame.

   ── And the aspect ratio may not be known yet ──────────────────────

   `getNaturalSize` returns null until the media decodes, and
   `getClipBaseSize` then falls back to the CANVAS aspect — which silently
   produces exactly the squashed-looking result the uniform scale was
   meant to avoid, except it looks correct because it matches the frame.
   Unknown is not the same as absent: the geometry reports
   `aspectSource`, and `canvas-fallback` comes back with a warning telling
   the caller to call again once `get_frame_context` reports
   `mediaPending: 0`.
   ═══════════════════════════════════════════════════════════════════ */

import { Clip, ProjectSettings } from '../types/edl';
import { getClipBaseSize } from './geometry';

/* ── Placement ──────────────────────────────────────────────────── */

export const PIP_CORNERS = [
  'top-left', 'top-center', 'top-right',
  'left-center', 'center', 'right-center',
  'bottom-left', 'bottom-center', 'bottom-right',
] as const;

export type PipCorner = typeof PIP_CORNERS[number];

/** Normalised anchor inside the safe area, 0 = left/top, 1 = right/bottom. */
const CORNER_ANCHORS: Record<PipCorner, { ax: number; ay: number }> = {
  'top-left': { ax: 0, ay: 0 },
  'top-center': { ax: 0.5, ay: 0 },
  'top-right': { ax: 1, ay: 0 },
  'left-center': { ax: 0, ay: 0.5 },
  center: { ax: 0.5, ay: 0.5 },
  'right-center': { ax: 1, ay: 0.5 },
  'bottom-left': { ax: 0, ay: 1 },
  'bottom-center': { ax: 0.5, ay: 1 },
  'bottom-right': { ax: 1, ay: 1 },
};

/* ── Geometry ───────────────────────────────────────────────────── */

export interface PipGeometryInput {
  project: ProjectSettings;
  /** The clip as it will be AFTER fitMode is set — see `pipFitMode`. */
  clip: Clip;
  natural: { width: number; height: number } | null;
  /** Inset width as a percentage of the frame width. */
  sizePct: number;
  /** Gap from the frame edge, as a percentage of the frame's SHORT edge. */
  marginPct: number;
  corner?: PipCorner;
  /** Explicit centre, percentage of frame width/height. Overrides `corner`. */
  positionPct?: { x: number; y: number };
  /** Ceiling on the inset height, percentage of frame height. */
  maxHeightPct: number;
}

export interface PipGeometry {
  /** Rendered box, in project pixels. */
  width: number;
  height: number;
  /** Box centre in canvas space. */
  centerX: number;
  centerY: number;
  /** What goes into transform.x / transform.y (offset from canvas centre). */
  transformX: number;
  transformY: number;
  /** Always equal — that is the point. */
  scaleX: number;
  scaleY: number;
  sourceAspect: number;
  renderedAspect: number;
  aspectSource: 'decoded' | 'imported' | 'canvas-fallback';
  marginPx: number;
  /** Set when the requested width had to give way to the height ceiling. */
  constrainedBy?: 'maxHeight';
  warnings: string[];
}

/**
 * The fit mode a PiP inset must use.
 *
 * `contain` is the only mode in `getClipBaseSize` that both preserves the
 * source aspect AND stays a bounded fraction of the frame. `cover` fills
 * the frame (a 4K portrait source measured 1609px tall in a 540px cell
 * once, per `create_grid_layout`), `fill` distorts by definition, and
 * `none` hands back raw source pixels, which for a 4K plate means a scale
 * factor of 0.03 and a transform gizmo nobody can grab.
 */
export const PIP_FIT_MODE = 'contain' as const;

export function computePipGeometry(input: PipGeometryInput): PipGeometry {
  const { project, clip, natural, sizePct, marginPct, maxHeightPct } = input;
  const warnings: string[] = [];

  /* Where the aspect ratio came from, said out loud. */
  let aspectSource: PipGeometry['aspectSource'];
  let sourceAspect: number;
  if (natural && natural.width > 0 && natural.height > 0) {
    aspectSource = 'decoded';
    sourceAspect = natural.width / natural.height;
  } else if (clip.naturalWidth && clip.naturalHeight) {
    aspectSource = 'imported';
    sourceAspect = clip.naturalWidth / clip.naturalHeight;
  } else {
    aspectSource = 'canvas-fallback';
    sourceAspect = project.width / project.height;
    warnings.push(
      'The inset source has not reported its dimensions yet, so its aspect ratio was assumed to '
      + `match the canvas (${sourceAspect.toFixed(3)}). If the source is not that shape the inset `
      + 'will be the wrong shape. Wait until get_frame_context reports mediaPending: 0 and call again.'
    );
  }

  /* The box `getClipBaseSize` will hand the compositor at scale 1. The
     scale is derived from THIS, not from the canvas, because 'contain'
     already picked a size for us and we are adjusting it. */
  const base = getClipBaseSize({ ...clip, fitMode: PIP_FIT_MODE }, project, natural);
  if (base.width <= 0 || base.height <= 0) {
    throw new Error(`The inset clip measured ${base.width}×${base.height} at scale 1; cannot size a PiP from that.`);
  }

  let width = (sizePct / 100) * project.width;
  let height = width / sourceAspect;
  let constrainedBy: PipGeometry['constrainedBy'];

  const heightCap = (maxHeightPct / 100) * project.height;
  if (height > heightCap) {
    /* A tall source at 40% of the frame WIDTH can be taller than the frame.
       Honouring the width request there produces an inset that runs off the
       top and bottom edges, so the height wins and the caller is told. */
    constrainedBy = 'maxHeight';
    height = heightCap;
    width = height * sourceAspect;
    warnings.push(
      `A ${sourceAspect.toFixed(3)}:1 source at ${sizePct}% of the frame width would be `
      + `${Math.round((sizePct / 100) * project.width / sourceAspect)}px tall, past the `
      + `${maxHeightPct}% height ceiling. Sized to the ceiling instead: `
      + `${Math.round(width)}×${Math.round(height)}px (${(width / project.width * 100).toFixed(1)}% of frame width).`
    );
  }

  /* ONE scale factor for both axes. If these ever differ the inset is
     being squashed, which is the bug this module was written against. */
  const scale = width / base.width;

  /* `base` came out of 'contain', which preserves the aspect it was given
     — so base.height * scale should equal `height`. Assert it rather than
     assume it: if the two disagree the box on screen is not the box this
     function reported, and every measurement downstream is against the
     wrong number. */
  const impliedHeight = base.height * scale;
  if (Math.abs(impliedHeight - height) > Math.max(1, height * 0.01)) {
    warnings.push(
      `The clip's base box is ${(base.width / base.height).toFixed(3)}:1 but the source is `
      + `${sourceAspect.toFixed(3)}:1, so the inset will render ${Math.round(impliedHeight)}px tall, `
      + `not ${Math.round(height)}px. Scale is still uniform, so nothing is squashed.`
    );
    height = impliedHeight;
  }

  const marginPx = (marginPct / 100) * Math.min(project.width, project.height);

  let centerX: number;
  let centerY: number;
  if (input.positionPct) {
    centerX = (input.positionPct.x / 100) * project.width;
    centerY = (input.positionPct.y / 100) * project.height;
  } else {
    const anchor = CORNER_ANCHORS[input.corner ?? 'top-right'];
    /* Travel between the two extreme centres. Goes negative when the inset
       is wider than the safe area, which puts it back on the centre line
       rather than off the far edge. */
    const spanX = project.width - 2 * marginPx - width;
    const spanY = project.height - 2 * marginPx - height;
    centerX = spanX >= 0
      ? marginPx + width / 2 + anchor.ax * spanX
      : project.width / 2;
    centerY = spanY >= 0
      ? marginPx + height / 2 + anchor.ay * spanY
      : project.height / 2;
    if (spanX < 0 || spanY < 0) {
      warnings.push(
        `At ${sizePct}% the inset is larger than the safe area inside a ${marginPct}% margin, `
        + 'so it was centred on the axis that would not fit rather than pushed off the frame.'
      );
    }
  }

  return {
    width,
    height,
    centerX,
    centerY,
    transformX: Math.round((centerX - project.width / 2) * 100) / 100,
    transformY: Math.round((centerY - project.height / 2) * 100) / 100,
    scaleX: scale,
    scaleY: scale,
    sourceAspect,
    renderedAspect: width / height,
    aspectSource,
    marginPx,
    ...(constrainedBy ? { constrainedBy } : {}),
    warnings,
  };
}

/* ── The patch the geometry turns into ──────────────────────────── */

export interface PipStyle {
  /** Corner radius in project pixels, applied as a rounded rectangle mask. */
  cornerRadiusPx?: number;
  border?: { widthPx: number; color: string };
  shadow?: { blurPx: number; opacity: number; offsetX?: number; offsetY?: number; color?: string };
}

export interface PipPatch {
  properties: Record<string, unknown>;
  effects: { type: string; params: Record<string, unknown> }[];
  warnings: string[];
}

/**
 * Turn geometry + style into the property patch and effect stack.
 *
 * The two style features fight each other and the tool has to say so
 * rather than quietly drop one. `cornerRadiusPx` is a rounded-rectangle
 * MASK, and `applyMask` calls `ctx.clip()` — a hard clipping region, set
 * before the layer is drawn. `drop_shadow` is a `pre` hook that sets
 * `ctx.shadowBlur` on the same context. The shadow is cast OUTSIDE the
 * box, the clip region ends AT the box, so with both on the shadow is
 * clipped away and the tool would report two features and render one.
 */
export function buildPipPatch(
  geometry: PipGeometry,
  style: PipStyle,
  extras: { name?: string; durationMs?: number; startTimeMs?: number; muteAudio: boolean }
): PipPatch {
  const warnings: string[] = [];
  const properties: Record<string, unknown> = {
    fitMode: PIP_FIT_MODE,
    'transform.scaleX': geometry.scaleX,
    'transform.scaleY': geometry.scaleY,
    'transform.x': geometry.transformX,
    'transform.y': geometry.transformY,
    'transform.rotation': 0,
    'transform.opacity': 1,
  };
  if (extras.name !== undefined) properties.name = extras.name;
  if (extras.startTimeMs !== undefined) properties.startTimeMs = extras.startTimeMs;
  if (extras.durationMs !== undefined) properties.durationMs = extras.durationMs;
  if (extras.muteAudio) properties['audio.volume'] = 0;

  const radius = style.cornerRadiusPx ?? 0;
  if (radius > 0) {
    properties['mask.enabled'] = true;
    properties['mask.type'] = 'rectangle';
    properties['mask.sizeX'] = 100;
    properties['mask.sizeY'] = 100;
    properties['mask.offsetX'] = 0;
    properties['mask.offsetY'] = 0;
    properties['mask.rotation'] = 0;
    /* `traceMaskPath` clamps to min(w,h)/2, so anything past a half-height
       is a pill, not an error. */
    properties['mask.roundness'] = radius;
    properties['mask.featherPx'] = 0;
    properties['mask.inverted'] = false;
  } else {
    properties['mask.enabled'] = false;
  }

  const effects: { type: string; params: Record<string, unknown> }[] = [];

  if (style.shadow && style.shadow.blurPx > 0 && style.shadow.opacity > 0) {
    if (radius > 0) {
      warnings.push(
        'cornerRadiusPx and shadow cannot both render: the rounded-corner mask is a hard '
        + 'ctx.clip() applied before the layer is drawn, and it clips the drop shadow away. '
        + 'The shadow was NOT added. Drop cornerRadiusPx for a shadow, or keep the radius '
        + 'and use a border instead.'
      );
    } else {
      effects.push({
        type: 'drop_shadow',
        params: {
          color: style.shadow.color ?? '#000000',
          blur: style.shadow.blurPx,
          offsetX: style.shadow.offsetX ?? 0,
          offsetY: style.shadow.offsetY ?? Math.round(style.shadow.blurPx / 2),
          opacity: style.shadow.opacity,
        },
      });
    }
  }

  if (style.border && style.border.widthPx > 0) {
    /*
      `outline` is a `post` hook. Its render context is built with
      `width: box.width` — the box AFTER `transform.scale*` — and the
      compositor never scales the 2D context by the clip's own scale for
      media clips (the scale is baked into the drawImage destination
      rectangle). So the stroke is in PROJECT pixels and needs no
      conversion: a widthPx of 4 paints 4 project pixels.

      `inset` is half the stroke width so the stroke sits fully inside the
      box rather than straddling its edge — a straddling stroke on a
      corner inset is half off-frame, and it also survives the rounded
      mask, which clips exactly at the box edge.
    */
    effects.push({
      type: 'outline',
      params: {
        color: style.border.color,
        width: style.border.widthPx,
        radius,
        inset: style.border.widthPx / 2,
      },
    });
  }

  return { properties, effects, warnings };
}
