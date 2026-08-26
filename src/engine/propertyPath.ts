/* ═══════════════════════════════════════════════════════════════════
   Property addressing — a typed, validated path system over the EDL.

   This is the layer that lets an agent (or a script, or a macro) change
   ANY property of ANY clip without a bespoke tool per property:

     setClipProperty(clip, 'transform.rotation', 45)
     setClipProperty(clip, 'textStyle.color', '#ff0000')
     setClipProperty(clip, 'effects.glow.radius', 60)
     setClipProperty(clip, 'shapeStyle.fill', '#4c9dff')

   Every path is checked against a schema, so a bad path or an out-of-range
   value returns a helpful error instead of corrupting the project.
   ═══════════════════════════════════════════════════════════════════ */

import { Clip, ClipEffect, ANIMATABLE_PROPERTIES, KEYFRAME_PATH_ALIASES } from '../types/edl';
import { getEffectDefinition, coerceParam } from './effectsRegistry';

export type PropertyValueType = 'number' | 'boolean' | 'string' | 'color' | 'enum';

export interface PropertySchema {
  path: string;
  label: string;
  type: PropertyValueType;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  enumValues?: string[];
  animatable?: boolean;
  /** Which clip types expose this path. Empty = all. */
  appliesTo?: Clip['type'][];
  description?: string;
}

/* ── The addressable surface ────────────────────────────────────── */

const PROPERTY_SCHEMA_BASE: PropertySchema[] = [
  /* Timing */
  { path: 'startTimeMs', label: 'Start time', type: 'number', min: 0, unit: 'ms', description: 'Position on the timeline' },
  { path: 'durationMs', label: 'Duration', type: 'number', min: 100, unit: 'ms' },
  { path: 'sourceStartMs', label: 'Source in-point', type: 'number', min: 0, unit: 'ms' },
  { path: 'name', label: 'Layer name', type: 'string' },
  { path: 'locked', label: 'Locked', type: 'boolean' },
  { path: 'hidden', label: 'Hidden', type: 'boolean' },
  { path: 'color', label: 'Timeline colour', type: 'color' },

  /* Transform */
  { path: 'transform.x', label: 'Position X', type: 'number', min: -6000, max: 6000, unit: 'px' },
  { path: 'transform.y', label: 'Position Y', type: 'number', min: -6000, max: 6000, unit: 'px' },
  { path: 'transform.scaleX', label: 'Scale X', type: 'number', min: 0.01, max: 12, step: 0.01 },
  { path: 'transform.scaleY', label: 'Scale Y', type: 'number', min: 0.01, max: 12, step: 0.01 },
  { path: 'transform.rotation', label: 'Rotation', type: 'number', min: -3600, max: 3600, unit: '°' },
  { path: 'transform.opacity', label: 'Opacity', type: 'number', min: 0, max: 1, step: 0.01 },
  { path: 'transform.anchorX', label: 'Anchor X', type: 'number', min: 0, max: 1, step: 0.01 },
  { path: 'transform.anchorY', label: 'Anchor Y', type: 'number', min: 0, max: 1, step: 0.01 },
  { path: 'transform.flipH', label: 'Flip horizontal', type: 'boolean' },
  { path: 'transform.flipV', label: 'Flip vertical', type: 'boolean' },

  /* Layout */
  { path: 'fitMode', label: 'Fit mode', type: 'enum', enumValues: ['cover', 'contain', 'fill', 'none'] },
  {
    path: 'blendMode', label: 'Blend mode', type: 'enum',
    enumValues: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge',
      'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'],
  },

  /* Colour */
  { path: 'filters.brightness', label: 'Brightness', type: 'number', min: -100, max: 100 },
  { path: 'filters.contrast', label: 'Contrast', type: 'number', min: -100, max: 100 },
  { path: 'filters.saturation', label: 'Saturation', type: 'number', min: -100, max: 200 },
  { path: 'filters.exposure', label: 'Exposure', type: 'number', min: -100, max: 100 },
  { path: 'filters.temperature', label: 'Temperature', type: 'number', min: -100, max: 100 },
  { path: 'filters.tint', label: 'Tint', type: 'number', min: -100, max: 100 },
  { path: 'filters.highlights', label: 'Highlights', type: 'number', min: -100, max: 100 },
  { path: 'filters.shadows', label: 'Shadows', type: 'number', min: -100, max: 100 },
  { path: 'filters.sharpen', label: 'Sharpen', type: 'number', min: 0, max: 100 },
  { path: 'filters.vignette', label: 'Vignette', type: 'number', min: 0, max: 100 },
  { path: 'filters.grain', label: 'Grain', type: 'number', min: 0, max: 100 },
  { path: 'filters.blur', label: 'Blur', type: 'number', min: 0, max: 100, unit: 'px' },
  { path: 'filters.hueRotate', label: 'Hue rotate', type: 'number', min: -180, max: 180, unit: '°' },

  /* Mask */
  { path: 'mask.enabled', label: 'Mask enabled', type: 'boolean' },
  { path: 'mask.type', label: 'Mask shape', type: 'enum', enumValues: ['rectangle', 'circle', 'ellipse', 'split', 'star', 'heart', 'film'] },
  { path: 'mask.sizeX', label: 'Mask width', type: 'number', min: 1, max: 200, unit: '%' },
  { path: 'mask.sizeY', label: 'Mask height', type: 'number', min: 1, max: 200, unit: '%' },
  { path: 'mask.offsetX', label: 'Mask offset X', type: 'number', min: -100, max: 100, unit: '%' },
  { path: 'mask.offsetY', label: 'Mask offset Y', type: 'number', min: -100, max: 100, unit: '%' },
  /*
    `mask.rotation` was in ANIMATABLE_PROPERTIES, resolved every frame by
    `resolvedMask`, drawn by `traceMaskPath`, and keyframeable — and it
    had no row HERE, so `list_properties` never mentioned it and
    `patch_clip` answered `Unknown property path "mask.rotation"`. The
    compositor's own comment says it was "listed by list_properties with
    a -180..180 range", which was not true of any build in this tree.
    Animatable but not settable is the mirror image of the usual bug and
    just as invisible: `verify_keyframes` patches it in `scene_masked`,
    gets a warning nobody reads, then keyframes it through the OTHER
    vocabulary and passes.
  */
  { path: 'mask.rotation', label: 'Mask rotation', type: 'number', min: -180, max: 180, unit: '°' },
  { path: 'mask.roundness', label: 'Mask roundness', type: 'number', min: 0, max: 400 },
  { path: 'mask.featherPx', label: 'Mask feather', type: 'number', min: 0, max: 200, unit: 'px' },
  { path: 'mask.inverted', label: 'Mask inverted', type: 'boolean' },

  /* Speed */
  { path: 'speed.multiplier', label: 'Speed', type: 'number', min: 0.05, max: 20, step: 0.05, unit: '×' },
  { path: 'speed.curvePreset', label: 'Speed ramp', type: 'enum', enumValues: ['linear', 'montage', 'hero', 'bullet_time', 'jump_cut', 'flash_in', 'flash_out', 'custom'] },
  { path: 'speed.reversed', label: 'Reversed', type: 'boolean' },
  { path: 'speed.preservePitch', label: 'Preserve pitch', type: 'boolean' },

  /* Motion blur */
  { path: 'motionBlur.enabled', label: 'Motion blur', type: 'boolean' },
  { path: 'motionBlur.shutterAngle', label: 'Shutter angle', type: 'number', min: 0, max: 720, unit: '°' },
  { path: 'motionBlur.samples', label: 'Blur samples', type: 'number', min: 2, max: 16 },

  /* Audio */
  { path: 'audio.volume', label: 'Volume', type: 'number', min: 0, max: 4, step: 0.01 },
  { path: 'audio.fadeInMs', label: 'Fade in', type: 'number', min: 0, max: 20000, unit: 'ms' },
  { path: 'audio.fadeOutMs', label: 'Fade out', type: 'number', min: 0, max: 20000, unit: 'ms' },
  { path: 'audio.pitch', label: 'Pitch', type: 'number', min: -24, max: 24, unit: 'st' },
  { path: 'audio.voiceEffect', label: 'Voice effect', type: 'enum', enumValues: ['none', 'deep', 'high', 'robot', 'echo', 'telephone', 'stadium'] },
  { path: 'audio.noiseReduction', label: 'Noise reduction', type: 'boolean' },
  { path: 'audio.ducking', label: 'Auto ducking', type: 'boolean' },

  /* Chroma key */
  { path: 'chromaKey.enabled', label: 'Chroma key', type: 'boolean' },
  { path: 'chromaKey.targetColorHex', label: 'Key colour', type: 'color' },
  { path: 'chromaKey.similarity', label: 'Key similarity', type: 'number', min: 0, max: 100 },
  { path: 'chromaKey.smoothness', label: 'Key smoothness', type: 'number', min: 0, max: 100 },
  { path: 'chromaKey.spill', label: 'Spill suppression', type: 'number', min: 0, max: 100 },

  /* Text */
  { path: 'textStyle.text', label: 'Text content', type: 'string', appliesTo: ['text'] },
  { path: 'textStyle.fontFamily', label: 'Font family', type: 'string', appliesTo: ['text'] },
  { path: 'textStyle.fontSize', label: 'Font size', type: 'number', min: 6, max: 500, unit: 'px', appliesTo: ['text'] },
  { path: 'textStyle.fontWeight', label: 'Font weight', type: 'number', min: 100, max: 900, step: 100, appliesTo: ['text'] },
  { path: 'textStyle.italic', label: 'Italic', type: 'boolean', appliesTo: ['text'] },
  { path: 'textStyle.uppercase', label: 'Uppercase', type: 'boolean', appliesTo: ['text'] },
  { path: 'textStyle.color', label: 'Text colour', type: 'color', appliesTo: ['text'] },
  { path: 'textStyle.strokeColor', label: 'Stroke colour', type: 'color', appliesTo: ['text'] },
  { path: 'textStyle.strokeWidth', label: 'Stroke width', type: 'number', min: 0, max: 60, appliesTo: ['text'] },
  { path: 'textStyle.shadowColor', label: 'Shadow colour', type: 'color', appliesTo: ['text'] },
  { path: 'textStyle.shadowBlur', label: 'Shadow blur', type: 'number', min: 0, max: 120, appliesTo: ['text'] },
  { path: 'textStyle.shadowOffsetX', label: 'Shadow offset X', type: 'number', min: -100, max: 100, appliesTo: ['text'] },
  { path: 'textStyle.shadowOffsetY', label: 'Shadow offset Y', type: 'number', min: -100, max: 100, appliesTo: ['text'] },
  { path: 'textStyle.align', label: 'Text align', type: 'enum', enumValues: ['left', 'center', 'right'], appliesTo: ['text'] },
  { path: 'textStyle.letterSpacing', label: 'Letter spacing', type: 'number', min: -50, max: 200, appliesTo: ['text'] },
  { path: 'textStyle.lineHeight', label: 'Line height', type: 'number', min: 0.5, max: 4, step: 0.05, appliesTo: ['text'] },
  { path: 'textStyle.background', label: 'Text background', type: 'color', appliesTo: ['text'] },
  { path: 'textStyle.backgroundPadding', label: 'Background padding', type: 'number', min: 0, max: 200, appliesTo: ['text'] },
  { path: 'textStyle.backgroundRadius', label: 'Background radius', type: 'number', min: 0, max: 200, appliesTo: ['text'] },
  { path: 'textStyle.highlightColor', label: 'Highlight colour', type: 'color', appliesTo: ['text'] },
  {
    path: 'textStyle.kineticAnimation', label: 'Text animation', type: 'enum',
    enumValues: ['none', 'kinetic_stack', 'typewriter', 'bounce', 'karaoke_highlight', 'fade_slide', 'glitch_pop', 'pop_in', 'wave'],
    appliesTo: ['text'],
  },

  /* Shapes */
  {
    path: 'shapeStyle.kind', label: 'Shape', type: 'enum',
    enumValues: ['rectangle', 'ellipse', 'triangle', 'polygon', 'star', 'line', 'arrow', 'heart', 'blob', 'path'],
    appliesTo: ['shape'],
  },
  { path: 'shapeStyle.fill', label: 'Fill', type: 'color', appliesTo: ['shape'] },
  { path: 'shapeStyle.stroke', label: 'Stroke', type: 'color', appliesTo: ['shape'] },
  { path: 'shapeStyle.strokeWidth', label: 'Stroke width', type: 'number', min: 0, max: 100, appliesTo: ['shape'] },
  { path: 'shapeStyle.cornerRadius', label: 'Corner radius', type: 'number', min: 0, max: 500, appliesTo: ['shape'] },
  { path: 'shapeStyle.points', label: 'Point count', type: 'number', min: 3, max: 24, appliesTo: ['shape'] },
  { path: 'shapeStyle.innerRatio', label: 'Star inner ratio', type: 'number', min: 0.05, max: 1, step: 0.01, appliesTo: ['shape'] },
  { path: 'shapeStyle.trimStart', label: 'Trim start', type: 'number', min: 0, max: 1, step: 0.01, appliesTo: ['shape'] },
  { path: 'shapeStyle.trimEnd', label: 'Trim end', type: 'number', min: 0, max: 1, step: 0.01, appliesTo: ['shape'] },
  { path: 'shapeStyle.pathData', label: 'SVG path data', type: 'string', appliesTo: ['shape'] },

  /* Motion path */
  { path: 'motionPath.enabled', label: 'Motion path', type: 'boolean' },
  { path: 'motionPath.orientToPath', label: 'Orient to path', type: 'boolean' },
  { path: 'motionPath.closed', label: 'Closed path', type: 'boolean' },
  { path: 'motionPath.easing', label: 'Path easing', type: 'enum', enumValues: ['linear', 'hold', 'easeIn', 'easeOut', 'easeInOut', 'bezier'] },
];

/*
  `animatable` used to be a hand-written flag on each entry, and it drifted:
  twenty-four properties claimed it while exactly seven could be keyframed,
  so `list_properties` told an agent to animate a filter and `add_keyframes`
  then refused the name. Deriving it from ANIMATABLE_PROPERTIES means the
  claim and the capability are the same fact.
*/
const ANIMATABLE_PATHS = new Set<string>([
  ...ANIMATABLE_PROPERTIES,
  ...Object.keys(KEYFRAME_PATH_ALIASES),
]);

export const PROPERTY_SCHEMA: PropertySchema[] = PROPERTY_SCHEMA_BASE.map((p) =>
  ANIMATABLE_PATHS.has(p.path) ? { ...p, animatable: true } : p
);


const SCHEMA_BY_PATH = new Map(PROPERTY_SCHEMA.map((s) => [s.path, s]));

/* ── Reading ────────────────────────────────────────────────────── */

/** Read any dotted path off a clip; `undefined` when it doesn't exist. */
export function getClipProperty(clip: Clip, path: string): unknown {
  // `effects.<type|id>.<param>` addresses the effect stack.
  if (path.startsWith('effects.')) {
    const [, ref, param] = path.split('.');
    const effect = findEffect(clip, ref);
    if (!effect) return undefined;
    if (!param) return effect;
    if (param === 'enabled') return effect.enabled;
    if (param === 'intensity') return effect.intensity;
    return effect.params[param];
  }

  let cursor: any = clip;
  for (const segment of path.split('.')) {
    if (cursor === null || cursor === undefined) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function findEffect(clip: Clip, ref: string): ClipEffect | undefined {
  return clip.effects?.find((e) => e.id === ref || e.type === ref);
}

/* ── Validation ─────────────────────────────────────────────────── */

export interface ValidationResult {
  ok: boolean;
  value?: unknown;
  error?: string;
  /** Set when the value was clamped rather than rejected. */
  adjusted?: boolean;
}

/** Check and coerce a value for a path. Returns a clear error when invalid. */
export function validateProperty(clip: Clip, path: string, value: unknown): ValidationResult {
  /* Effect parameters validate against the effect registry. */
  if (path.startsWith('effects.')) {
    const [, ref, param] = path.split('.');
    const effect = findEffect(clip, ref);
    if (!effect) {
      return { ok: false, error: `No effect "${ref}" on clip "${clip.name}". Add it first with add_effect.` };
    }
    if (param === 'enabled') return { ok: true, value: Boolean(value) };
    if (param === 'intensity') {
      const n = Number(value);
      if (Number.isNaN(n)) return { ok: false, error: 'intensity must be a number between 0 and 1' };
      return { ok: true, value: Math.max(0, Math.min(1, n)), adjusted: n < 0 || n > 1 };
    }

    const def = getEffectDefinition(effect.type);
    const schema = def?.params.find((p) => p.key === param);
    if (!schema) {
      const available = def?.params.map((p) => p.key).join(', ') ?? '';
      return { ok: false, error: `Effect "${effect.type}" has no parameter "${param}". Available: ${available}` };
    }
    return { ok: true, value: coerceParam(schema, value) };
  }

  const schema = SCHEMA_BY_PATH.get(path);
  if (!schema) {
    return { ok: false, error: `Unknown property path "${path}". Call list_properties to see what this clip exposes.` };
  }

  if (schema.appliesTo && !schema.appliesTo.includes(clip.type)) {
    return { ok: false, error: `"${path}" applies to ${schema.appliesTo.join('/')} clips, but "${clip.name}" is a ${clip.type} clip.` };
  }

  switch (schema.type) {
    case 'boolean':
      return { ok: true, value: Boolean(value) };

    case 'string':
      return { ok: true, value: String(value ?? '') };

    case 'color': {
      const str = String(value ?? '').trim();
      if (str === '' || str === 'transparent') return { ok: true, value: str };
      const normalised = str.startsWith('#') ? str : `#${str}`;
      if (!/^#[0-9a-fA-F]{3,8}$/.test(normalised) && !str.startsWith('rgb')) {
        return { ok: false, error: `"${value}" is not a valid colour. Use a hex value like #ff8800.` };
      }
      return { ok: true, value: str.startsWith('rgb') ? str : normalised };
    }

    case 'enum': {
      const str = String(value);
      if (!schema.enumValues?.includes(str)) {
        return { ok: false, error: `"${str}" is not valid for ${path}. Allowed: ${schema.enumValues?.join(', ')}` };
      }
      return { ok: true, value: str };
    }

    case 'number':
    default: {
      const n = Number(value);
      if (Number.isNaN(n)) return { ok: false, error: `${path} expects a number, got "${value}".` };
      const min = schema.min ?? -Infinity;
      const max = schema.max ?? Infinity;
      const clamped = Math.max(min, Math.min(max, n));
      return { ok: true, value: clamped, adjusted: clamped !== n };
    }
  }
}

/* ── Writing (operates on an immer draft) ───────────────────────── */

/**
 * Apply a validated value onto a clip draft. Creates intermediate objects
 * where the model allows them (textStyle / shapeStyle / motionPath).
 */
export function applyClipProperty(clip: Clip, path: string, value: unknown): void {
  if (path.startsWith('effects.')) {
    const [, ref, param] = path.split('.');
    const effect = findEffect(clip, ref);
    if (!effect) return;
    if (param === 'enabled') effect.enabled = Boolean(value);
    else if (param === 'intensity') effect.intensity = Number(value);
    else effect.params[param] = value as any;
    return;
  }

  const segments = path.split('.');
  let cursor: any = clip;

  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i];
    if (cursor[key] === undefined || cursor[key] === null) {
      // Only auto-create the containers the schema knows about.
      if (key === 'motionPath') {
        cursor[key] = { enabled: false, points: [], closed: false, orientToPath: false, easing: 'easeInOut' };
      } else {
        cursor[key] = {};
      }
    }
    cursor = cursor[key];
  }

  cursor[segments[segments.length - 1]] = value;
}

/* ── Introspection (what the agent calls to discover the surface) ─ */

export interface PropertyDescriptor extends PropertySchema {
  currentValue: unknown;
}

/** Every path this specific clip exposes, with current values. */
export function describeClipProperties(clip: Clip): PropertyDescriptor[] {
  const out: PropertyDescriptor[] = [];

  for (const schema of PROPERTY_SCHEMA) {
    if (schema.appliesTo && !schema.appliesTo.includes(clip.type)) continue;
    out.push({ ...schema, currentValue: getClipProperty(clip, schema.path) });
  }

  // Effect parameters are per-instance, so they're appended dynamically.
  for (const effect of clip.effects ?? []) {
    const def = getEffectDefinition(effect.type);
    if (!def) continue;

    out.push({
      path: `effects.${effect.type}.enabled`,
      label: `${def.label} · enabled`,
      type: 'boolean',
      currentValue: effect.enabled,
    });
    out.push({
      path: `effects.${effect.type}.intensity`,
      label: `${def.label} · intensity`,
      type: 'number',
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
      currentValue: effect.intensity,
    });

    for (const p of def.params) {
      out.push({
        path: `effects.${effect.type}.${p.key}`,
        label: `${def.label} · ${p.label}`,
        type: p.type === 'angle' ? 'number' : (p.type as PropertyValueType),
        min: p.min,
        max: p.max,
        step: p.step,
        unit: p.unit,
        enumValues: p.options?.map((o) => o.value),
        animatable: p.animatable,
        currentValue: effect.params[p.key],
        description: p.hint,
      });
    }
  }

  return out;
}

/** Fuzzy-match a natural-language property name onto a real path. */
export function resolvePropertyAlias(input: string): string | null {
  const needle = input.trim().toLowerCase().replace(/[\s_-]+/g, '');

  const ALIASES: Record<string, string> = {
    x: 'transform.x',
    y: 'transform.y',
    posx: 'transform.x',
    posy: 'transform.y',
    position: 'transform.x',
    scale: 'transform.scaleX',
    size: 'transform.scaleX',
    zoom: 'transform.scaleX',
    rotate: 'transform.rotation',
    rotation: 'transform.rotation',
    angle: 'transform.rotation',
    opacity: 'transform.opacity',
    alpha: 'transform.opacity',
    transparency: 'transform.opacity',
    volume: 'audio.volume',
    speed: 'speed.multiplier',
    text: 'textStyle.text',
    font: 'textStyle.fontFamily',
    fontsize: 'textStyle.fontSize',
    textcolor: 'textStyle.color',
    colour: 'textStyle.color',
    brightness: 'filters.brightness',
    contrast: 'filters.contrast',
    saturation: 'filters.saturation',
    blur: 'filters.blur',
    vignette: 'filters.vignette',
    grain: 'filters.grain',
    temperature: 'filters.temperature',
    blend: 'blendMode',
    blendmode: 'blendMode',
  };

  if (ALIASES[needle]) return ALIASES[needle];

  // Exact path match, ignoring case and separators.
  const exact = PROPERTY_SCHEMA.find(
    (s) => s.path.toLowerCase().replace(/[.\s_-]+/g, '') === needle
  );
  if (exact) return exact.path;

  // Label match.
  const byLabel = PROPERTY_SCHEMA.find(
    (s) => s.label.toLowerCase().replace(/[\s_-]+/g, '') === needle
  );
  return byLabel?.path ?? null;
}
