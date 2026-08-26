/* ═══════════════════════════════════════════════════════════════════
   Kerf Edit Decision List — canonical project data model.
   Everything that renders, exports or is mutated by an MCP tool is
   described here. Keep this file free of runtime logic.
   ═══════════════════════════════════════════════════════════════════ */

export type TrackType = 'video' | 'audio' | 'text' | 'overlay' | 'effect';
export type ClipType = 'video' | 'audio' | 'text' | 'image' | 'sticker' | 'shape' | 'adjustment';
export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5' | '4:3' | '21:9';

/**
 * Properties that can be animated with keyframes.
 *
 * There used to be seven of these while `propertyPath.ts` advertised
 * twenty-four as `animatable: true`. `list_properties` said a filter or a
 * stroke width could be keyframed, `add_keyframes` refused the name, and
 * nothing reconciled the two — so an agent was told to do something the
 * next call would reject. Every entry here is now resolved at render
 * time, and `PROPERTY_SCHEMA` is generated against this list rather than
 * hand-flagged, so the two cannot drift apart again.
 *
 * The first seven keep their bare names because projects already contain
 * them. Everything added since uses the same dotted path `list_properties`
 * reports, so there is one vocabulary instead of two.
 */
export type AnimatableProperty =
  | 'positionX'
  | 'positionY'
  | 'scaleX'
  | 'scaleY'
  | 'rotation'
  | 'opacity'
  | 'volume'
  | 'anchorX'
  | 'anchorY'
  | 'filters.brightness'
  | 'filters.contrast'
  | 'filters.saturation'
  | 'filters.exposure'
  | 'filters.temperature'
  | 'filters.tint'
  | 'filters.highlights'
  | 'filters.shadows'
  | 'filters.sharpen'
  | 'filters.vignette'
  | 'filters.grain'
  | 'filters.blur'
  | 'filters.hueRotate'
  | 'mask.sizeX'
  | 'mask.sizeY'
  | 'mask.offsetX'
  | 'mask.offsetY'
  | 'mask.rotation'
  | 'mask.roundness'
  | 'mask.featherPx'
  | 'textStyle.fontSize'
  | 'textStyle.letterSpacing'
  | 'shapeStyle.strokeWidth'
  | 'shapeStyle.trimStart'
  | 'shapeStyle.trimEnd'
  | 'shapeStyle.cornerRadius';

/**
 * Every animatable property, as data. The type above is the compile-time
 * view of this list; this is the one the tool layer validates against and
 * the property schema is generated from.
 */
export const ANIMATABLE_PROPERTIES = [
  'positionX', 'positionY', 'scaleX', 'scaleY', 'rotation', 'opacity', 'volume',
  'anchorX', 'anchorY',
  'filters.brightness', 'filters.contrast', 'filters.saturation', 'filters.exposure',
  'filters.temperature', 'filters.tint', 'filters.highlights', 'filters.shadows',
  'filters.sharpen', 'filters.vignette', 'filters.grain', 'filters.blur',
  'filters.hueRotate',
  'mask.sizeX', 'mask.sizeY', 'mask.offsetX', 'mask.offsetY', 'mask.rotation',
  'mask.roundness', 'mask.featherPx',
  'textStyle.fontSize', 'textStyle.letterSpacing',
  'shapeStyle.strokeWidth', 'shapeStyle.trimStart', 'shapeStyle.trimEnd',
  'shapeStyle.cornerRadius',
] as const satisfies readonly AnimatableProperty[];

/**
 * The dotted path a keyframe property corresponds to, for the seven that
 * predate the dotted vocabulary. Used to keep `patch_clip` and
 * `add_keyframes` talking about the same thing.
 */
export const KEYFRAME_PATH_ALIASES: Record<string, AnimatableProperty> = {
  'transform.x': 'positionX',
  'transform.y': 'positionY',
  'transform.scaleX': 'scaleX',
  'transform.scaleY': 'scaleY',
  'transform.rotation': 'rotation',
  'transform.opacity': 'opacity',
  'transform.anchorX': 'anchorX',
  'transform.anchorY': 'anchorY',
  'audio.volume': 'volume',
};

export type Easing = 'linear' | 'hold' | 'easeIn' | 'easeOut' | 'easeInOut' | 'bezier';

export interface KeyframePoint {
  id: string;
  property: AnimatableProperty;
  timeOffsetMs: number;
  value: number;
  easing: Easing;
  /** [p1x, p1y, p2x, p2y] control points for `bezier` easing. */
  bezierPoints?: [number, number, number, number];
}

/* ── Speed ──────────────────────────────────────────────────────── */

export interface SpeedCurvePoint {
  /** 0..1 position along the clip. */
  timePct: number;
  /** Playback rate multiplier at that position. */
  speedMult: number;
}

export type SpeedCurvePreset =
  | 'linear'
  | 'montage'
  | 'hero'
  | 'bullet_time'
  | 'jump_cut'
  | 'flash_in'
  | 'flash_out'
  | 'custom';

export interface ClipSpeed {
  multiplier: number;
  curvePreset: SpeedCurvePreset;
  customPoints?: SpeedCurvePoint[];
  /** Keep audio pitch constant while ramping. */
  preservePitch: boolean;
  reversed: boolean;
}

/* ── Geometry ───────────────────────────────────────────────────── */

export interface ClipTransform {
  /** Offset from canvas centre, in project pixels. */
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** Degrees, clockwise. */
  rotation: number;
  opacity: number;
  /** Normalised 0..1 anchor within the clip's own box. */
  anchorX: number;
  anchorY: number;
  flipH: boolean;
  flipV: boolean;
}

/** How a clip's source media is fitted into its layout box before transform. */
export type FitMode = 'cover' | 'contain' | 'fill' | 'none';

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export interface ClipMask {
  enabled: boolean;
  type: 'rectangle' | 'circle' | 'ellipse' | 'split' | 'star' | 'heart' | 'film';
  /** Percentages of the clip box. */
  sizeX: number;
  sizeY: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  roundness: number;
  featherPx: number;
  inverted: boolean;
}

/* ── Colour ─────────────────────────────────────────────────────── */

export interface ClipFilters {
  brightness: number;
  contrast: number;
  saturation: number;
  exposure: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
  sharpen: number;
  vignette: number;
  grain: number;
  blur: number;
  hueRotate: number;
  /*
    `lut` and `lutIntensity` used to live here. `lut` was a free-form
    string with no vocabulary, no UI, no preset list and no renderer —
    a property advertised to the agent that could never hold a correct
    value. Real .cube LUT support is a feature, not a field; it belongs
    in the gap log until someone builds it.
  */
}

export interface ClipChromaKey {
  enabled: boolean;
  targetColorHex: string;
  similarity: number;
  smoothness: number;
  spill: number;
}

/* ── Transitions ────────────────────────────────────────────────── */

export type TransitionType =
  | 'none'
  | 'crossfade'
  | 'dip_to_black'
  | 'dip_to_white'
  | 'whip_pan'
  | 'zoom_in'
  | 'zoom_out'
  | 'glitch'
  | 'diagonal_split'
  | 'flash'
  | 'push_left'
  | 'push_right'
  | 'slide_up'
  | 'spin'
  | 'blur_dissolve';

export interface ClipTransition {
  type: TransitionType;
  durationMs: number;
}

/* ── Audio ──────────────────────────────────────────────────────── */

export type VoiceEffect = 'none' | 'deep' | 'high' | 'robot' | 'echo' | 'telephone' | 'stadium';

export interface ClipAudioSettings {
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
  pitch: number;
  voiceEffect: VoiceEffect;
  noiseReduction: boolean;
  ducking: boolean;
  /** Detached from its video counterpart. */
  detached: boolean;
}

/* ── Text ───────────────────────────────────────────────────────── */

export type KineticAnimation =
  | 'none'
  | 'kinetic_stack'
  | 'typewriter'
  | 'bounce'
  | 'karaoke_highlight'
  | 'fade_slide'
  | 'glitch_pop'
  | 'pop_in'
  | 'wave';

export interface ClipTextStyle {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  color: string;
  strokeColor?: string;
  strokeWidth: number;
  shadowColor?: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  align: 'left' | 'center' | 'right';
  letterSpacing: number;
  lineHeight: number;
  uppercase: boolean;
  background?: string;
  backgroundPadding: number;
  backgroundRadius: number;
  kineticAnimation: KineticAnimation;
  /** Per-word highlight colour for karaoke captions. */
  highlightColor?: string;
}

export interface TranscriptWord {
  word: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

/* ── VFX effect stack ───────────────────────────────────────────── */

export type EffectCategory =
  | 'stylize'
  | 'blur'
  | 'distort'
  | 'light'
  | 'color'
  | 'generate'
  | 'transition'
  | 'motion'
  | 'utility';

/**
 * An effect instance on a clip. `params` is a free-form bag validated
 * against the effect's schema in the registry, which is what lets an agent
 * address any parameter by name without a per-effect tool.
 */
export interface ClipEffect {
  id: string;
  /** Registry key, e.g. `glow`, `rgb_split`, `light_leak`. */
  type: string;
  enabled: boolean;
  /** 0..1 wet/dry mix applied on top of the effect's own parameters. */
  intensity: number;
  params: Record<string, number | string | boolean>;
  /** Keyframes addressing `params.<name>` over the clip's own timeline. */
  keyframes?: EffectKeyframe[];
}

export interface EffectKeyframe {
  id: string;
  param: string;
  timeOffsetMs: number;
  value: number;
  easing: Easing;
}

/* ── Vector shape layers ────────────────────────────────────────── */

export type ShapeKind =
  | 'rectangle' | 'ellipse' | 'triangle' | 'polygon' | 'star'
  | 'line' | 'arrow' | 'heart' | 'blob' | 'path';

export interface ShapeStyle {
  kind: ShapeKind;
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** Corner radius for rectangles / polygons. */
  cornerRadius: number;
  /** Point count for polygon and star. */
  points: number;
  /** Inner-radius ratio for stars, 0..1. */
  innerRatio: number;
  /** Draw only part of the outline, 0..1 — animate for a "draw on" effect. */
  trimStart: number;
  trimEnd: number;
  /** Custom SVG path data when `kind` is `path`. */
  pathData?: string;
  gradient?: { from: string; to: string; angle: number };
  shadow?: { color: string; blur: number; offsetX: number; offsetY: number };
}

/* ── Motion path ────────────────────────────────────────────────── */

/**
 * A spatial path a layer travels along, independent of positionX/Y keys.
 * Points are in canvas space; `orientToPath` rotates the layer to follow.
 */
export interface MotionPath {
  enabled: boolean;
  points: { x: number; y: number; /** Bezier handle offsets. */ hx?: number; hy?: number }[];
  closed: boolean;
  orientToPath: boolean;
  /** Easing of travel along the path across the clip's duration. */
  easing: Easing;
}

/* ── Clip ───────────────────────────────────────────────────────── */

export interface Clip {
  id: string;
  trackId: string;
  type: ClipType;
  name: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  color: string;

  startTimeMs: number;
  durationMs: number;
  sourceStartMs: number;
  sourceDurationMs: number;

  /** Intrinsic pixel size of the source, when known. Drives layout. */
  naturalWidth?: number;
  naturalHeight?: number;
  fitMode: FitMode;
  blendMode: BlendMode;

  transform: ClipTransform;
  mask: ClipMask;
  speed: ClipSpeed;
  keyframes: KeyframePoint[];
  filters: ClipFilters;
  chromaKey: ClipChromaKey;
  /** Ordered VFX stack, applied bottom-to-top after the base render. */
  effects: ClipEffect[];
  motionPath?: MotionPath;
  motionBlur: { enabled: boolean; shutterAngle: number; samples: number };
  transitionIn?: ClipTransition;
  transitionOut?: ClipTransition;
  audio: ClipAudioSettings;
  textStyle?: ClipTextStyle;
  shapeStyle?: ShapeStyle;
  transcriptWords?: TranscriptWord[];

  locked: boolean;
  hidden: boolean;
  /** Clips sharing a groupId move and trim together. */
  groupId?: string;
}

/* ── Track ──────────────────────────────────────────────────────── */

export interface Track {
  id: string;
  type: TrackType;
  name: string;
  index: number;
  muted: boolean;
  locked: boolean;
  solo: boolean;
  volume: number;
  heightPx: number;
  collapsed: boolean;
  clips: Clip[];
}

/* ── Markers ────────────────────────────────────────────────────── */

export type MarkerKind = 'generic' | 'beat' | 'chapter' | 'comment' | 'todo';

export interface TimelineMarker {
  id: string;
  timeMs: number;
  label: string;
  color: string;
  kind: MarkerKind;
  note?: string;
}

/* ── Project ────────────────────────────────────────────────────── */

export interface ProjectSettings {
  id: string;
  name: string;
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  fps: 24 | 30 | 60;
  durationMs: number;
  backgroundColor: string;
  createdAt: number;
  updatedAt: number;
}

export interface MediaAsset {
  id: string;
  name: string;
  type: ClipType;
  url: string;
  thumbnailUrl: string;
  durationMs: number;
  width?: number;
  height?: number;
  fileSizeFormatted: string;
  codec?: string;
  transcript?: string;
  /** Cached normalised waveform peaks (0..1), one per bucket. */
  peaks?: number[];
}

/* ── Canonical dimensions per aspect ratio ──────────────────────── */

/* ═══════════════════════════════════════════════════════════════════
   Runtime value lists.

   The unions above vanish at compile time, so a tool taking one of them
   from an agent has nothing to check against — it can only cast and
   hope. These arrays are the checkable form, and they double as the
   "here is what I DO support" list in the error message, which is the
   difference between a dead end and a second attempt.
   ═══════════════════════════════════════════════════════════════════ */

export const TRANSITION_TYPES = [
  'none', 'crossfade', 'dip_to_black', 'dip_to_white', 'whip_pan',
  'zoom_in', 'zoom_out', 'glitch', 'diagonal_split', 'flash',
  'push_left', 'push_right', 'slide_up', 'spin', 'blur_dissolve',
] as const satisfies readonly TransitionType[];

/*
  Runtime lists for the unions above.

  A union alone cannot be checked at a boundary — an agent passing
  `easing: "bouncy"` type-checks nowhere and lands in the project, where
  the easing lookup misses and the animation quietly plays linear. These
  are what `oneOf()` validates against, and `satisfies` keeps them in
  step with the type.
*/
export const CLIP_TYPES = [
  'video', 'audio', 'text', 'image', 'sticker', 'shape', 'adjustment',
] as const satisfies readonly ClipType[];

export const EASINGS = [
  'linear', 'hold', 'easeIn', 'easeOut', 'easeInOut', 'bezier',
] as const satisfies readonly Easing[];

export const FPS_VALUES = [24, 30, 60] as const;

export const SHAPE_KINDS = [
  'rectangle', 'ellipse', 'triangle', 'polygon', 'star',
  'line', 'arrow', 'heart', 'blob', 'path',
] as const satisfies readonly ShapeKind[];

export const SPEED_CURVE_PRESETS = [
  'linear', 'montage', 'hero', 'bullet_time',
  'jump_cut', 'flash_in', 'flash_out', 'custom',
] as const satisfies readonly SpeedCurvePreset[];

export const ASPECT_DIMENSIONS: Record<AspectRatio, { width: number; height: number; label: string }> = {
  '16:9': { width: 1920, height: 1080, label: 'Landscape · YouTube' },
  '9:16': { width: 1080, height: 1920, label: 'Vertical · TikTok / Reels' },
  '1:1': { width: 1080, height: 1080, label: 'Square · Feed' },
  '4:5': { width: 1080, height: 1350, label: 'Portrait · Instagram' },
  '4:3': { width: 1440, height: 1080, label: 'Classic · 4:3' },
  '21:9': { width: 2560, height: 1080, label: 'Cinemascope' },
};

/* ── Factory defaults ───────────────────────────────────────────── */

export const DEFAULT_TRANSFORM: ClipTransform = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
  anchorX: 0.5,
  anchorY: 0.5,
  flipH: false,
  flipV: false,
};

export const DEFAULT_MASK: ClipMask = {
  enabled: false,
  type: 'rectangle',
  sizeX: 80,
  sizeY: 80,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  roundness: 12,
  featherPx: 0,
  inverted: false,
};

export const DEFAULT_FILTERS: ClipFilters = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  exposure: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  sharpen: 0,
  vignette: 0,
  grain: 0,
  blur: 0,
  hueRotate: 0,
};

export const DEFAULT_CHROMA: ClipChromaKey = {
  enabled: false,
  targetColorHex: '#00ff00',
  similarity: 40,
  smoothness: 10,
  spill: 10,
};

export const DEFAULT_AUDIO: ClipAudioSettings = {
  volume: 1,
  fadeInMs: 0,
  fadeOutMs: 0,
  pitch: 0,
  voiceEffect: 'none',
  noiseReduction: false,
  ducking: false,
  detached: false,
};

export const DEFAULT_SPEED: ClipSpeed = {
  multiplier: 1,
  curvePreset: 'linear',
  preservePitch: true,
  reversed: false,
};

export const DEFAULT_MOTION_BLUR = { enabled: false, shutterAngle: 180, samples: 6 };

export const DEFAULT_SHAPE_STYLE: ShapeStyle = {
  kind: 'rectangle',
  fill: '#4c9dff',
  stroke: 'transparent',
  strokeWidth: 0,
  cornerRadius: 16,
  points: 5,
  innerRatio: 0.45,
  trimStart: 0,
  trimEnd: 1,
};

export const DEFAULT_TEXT_STYLE: ClipTextStyle = {
  text: 'Your text here',
  fontFamily: 'Inter',
  fontSize: 72,
  fontWeight: 800,
  italic: false,
  color: '#ffffff',
  strokeColor: '#000000',
  strokeWidth: 6,
  shadowColor: 'rgba(0,0,0,0.75)',
  shadowBlur: 18,
  shadowOffsetX: 0,
  shadowOffsetY: 4,
  align: 'center',
  letterSpacing: 0,
  lineHeight: 1.15,
  uppercase: false,
  backgroundPadding: 18,
  backgroundRadius: 10,
  kineticAnimation: 'pop_in',
};

/** Recursively optional — lets factories take `{ transform: { y: 40 } }`. */
export type DeepPartial<T> = T extends (infer U)[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export type ClipSeed = DeepPartial<Omit<Clip, 'id' | 'trackId' | 'type' | 'name'>> &
  Pick<Clip, 'id' | 'trackId' | 'type' | 'name'>;

/** Build a fully-populated clip, filling every optional field with a default. */
export function createClip(partial: ClipSeed): Clip {
  return {
    color: '#4c9dff',
    startTimeMs: 0,
    durationMs: 4000,
    sourceStartMs: 0,
    sourceDurationMs: 4000,
    fitMode: 'cover',
    blendMode: 'normal',
    locked: false,
    hidden: false,
    ...(partial as Partial<Clip>),
    // Re-pin the required identity fields — the spread above widens them.
    id: partial.id,
    trackId: partial.trackId,
    type: partial.type,
    name: partial.name,
    transform: { ...DEFAULT_TRANSFORM, ...partial.transform },
    mask: { ...DEFAULT_MASK, ...partial.mask },
    speed: { ...DEFAULT_SPEED, ...partial.speed },
    keyframes: (partial.keyframes as KeyframePoint[]) ?? [],
    filters: { ...DEFAULT_FILTERS, ...partial.filters },
    chromaKey: { ...DEFAULT_CHROMA, ...partial.chromaKey },
    effects: (partial.effects as ClipEffect[]) ?? [],
    motionBlur: { ...DEFAULT_MOTION_BLUR, ...partial.motionBlur },
    audio: { ...DEFAULT_AUDIO, ...partial.audio },
    shapeStyle: partial.shapeStyle
      ? ({ ...DEFAULT_SHAPE_STYLE, ...partial.shapeStyle } as ShapeStyle)
      : partial.type === 'shape'
        ? { ...DEFAULT_SHAPE_STYLE }
        : undefined,
    textStyle: partial.textStyle
      ? ({ ...DEFAULT_TEXT_STYLE, ...partial.textStyle } as ClipTextStyle)
      : partial.type === 'text'
        ? { ...DEFAULT_TEXT_STYLE, text: partial.name }
        : undefined,
    transitionIn: partial.transitionIn as Clip['transitionIn'],
    transitionOut: partial.transitionOut as Clip['transitionOut'],
    motionPath: partial.motionPath as Clip['motionPath'],
    transcriptWords: partial.transcriptWords as Clip['transcriptWords'],
  };
}
