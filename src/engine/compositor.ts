/* ═══════════════════════════════════════════════════════════════════
   Canvas compositor — renders one timeline frame.

   Layer order is the track order (highest index paints first, so index 0
   ends up on top). Each clip is drawn through the SAME `getClipBox`
   the transform gizmo uses, which is what keeps handles glued to pixels.
   ═══════════════════════════════════════════════════════════════════ */

import {
  Track, Clip, ClipType, ProjectSettings, ClipTransition, ClipTextStyle, ShapeStyle,
  MotionPath, AnimatableProperty, ClipFilters, ClipMask,
} from '../types/edl';
import {
  getClipBox,
  getClipBaseSize,
  cacheTextMetrics,
  ClipBox,
} from './geometry';
import {
  getEffectDefinition,
  makeSeededRandom,
  EffectRenderContext,
} from './effectsRegistry';
import { interpolateKeyframes, applyEasing } from './keyframeMath';
import { toneFilterId } from './toneFilters';
import { runShader, hexToRgb01, ShaderKey } from './gpuStage';
import {
  likelyVideoUrl, getVideoFrame, getVideoNaturalSize, videoFailed, getVideoGeneration,
  preloadVideo,
} from './videoEngine';

/* ── Media cache ────────────────────────────────────────────────── */

interface CachedMedia {
  el: HTMLImageElement;
  loaded: boolean;
  failed: boolean;
  /** Whether the no-CORS fallback has already been attempted. */
  retried: boolean;
  /** True once loaded WITHOUT CORS — such media taints the canvas. */
  tainted: boolean;
}

const mediaCache = new Map<string, CachedMedia>();

/**
 * Bumped every time a media element finishes decoding. The preview loop
 * folds this into its cache key so a late-loading image forces a repaint
 * instead of leaving a black frame on screen.
 */
let mediaGeneration = 0;

export function getMediaGeneration(): number {
  // Video counts too: a completed seek produces a new frame with nothing
  // else in the store changed, and a paused preview must repaint for it.
  return mediaGeneration + getVideoGeneration();
}

export function getCachedImage(url: string): HTMLImageElement {
  const hit = mediaCache.get(url);
  if (hit) return hit.el;

  const el = new Image();
  el.crossOrigin = 'anonymous';
  const entry: CachedMedia = { el, loaded: false, failed: false, retried: false, tainted: false };
  el.onload = () => { entry.loaded = true; mediaGeneration++; };
  el.onerror = () => {
    // Retry once without CORS — plenty of CDNs serve the bytes but omit the header.
    // Such an image renders fine but taints the canvas, so record that.
    if (!entry.retried) {
      entry.retried = true;
      const retry = new Image();
      retry.onload = () => {
        entry.el = retry;
        entry.loaded = true;
        entry.tainted = true;
        mediaGeneration++;
      };
      retry.onerror = () => { entry.failed = true; mediaGeneration++; };
      retry.src = url;
      return;
    }
    entry.failed = true;
    mediaGeneration++;
  };
  el.src = url;
  mediaCache.set(url, entry);
  return el;
}

/** Natural dimensions of a clip's media once decoded, else null. */
export function getNaturalSize(clip: Clip): { width: number; height: number } | null {
  if (!clip.mediaUrl) return null;

  if (likelyVideoUrl(clip.mediaUrl, clip.type)) {
    const size = getVideoNaturalSize(clip.mediaUrl);
    if (size) return size;
    if (!videoFailed(clip.mediaUrl)) {
      // Metadata has not landed yet — fall back to what the import probed.
      return clip.naturalWidth && clip.naturalHeight
        ? { width: clip.naturalWidth, height: clip.naturalHeight }
        : null;
    }
  }

  getCachedImage(clip.mediaUrl);
  // Read through the cache entry — the CORS fallback can swap the element.
  const el = mediaCache.get(clip.mediaUrl)?.el;
  if (el && el.complete && el.naturalWidth > 0) {
    return { width: el.naturalWidth, height: el.naturalHeight };
  }
  return clip.naturalWidth && clip.naturalHeight
    ? { width: clip.naturalWidth, height: clip.naturalHeight }
    : null;
}

/** True when any loaded media would taint an exported canvas. */
export function hasTaintedMedia(): boolean {
  for (const entry of mediaCache.values()) {
    if (entry.tainted) return true;
  }
  return false;
}

/** Names of the media that cannot be exported, for a precise warning. */
export function getTaintedMediaUrls(): string[] {
  const out: string[] = [];
  for (const [url, entry] of mediaCache) {
    if (entry.tainted) out.push(url);
  }
  return out;
}

export function isMediaReady(url?: string): boolean {
  if (!url) return false;
  const entry = mediaCache.get(url);
  return !!entry && entry.loaded;
}

/* ── Which decoder draws this clip? ─────────────────────────────────

   Video and stills need different elements, and the declared clip type
   cannot be trusted on its own — the seed project shipped JPEGs typed
   `video` with `.mov` names. So: guess from the URL, and if the guess
   fails to decode, fall through to the other cache rather than paint a
   placeholder forever.                                               */

/* ── Which clips got a placeholder instead of their media ───────────

   `get_frame_context` handed back frames whose media had not finished
   decoding and said nothing about it. The compositor draws a dark
   gradient in that case, which reads as a legitimately dark frame — so
   measuring straight after an insert measured the placeholder. It
   produced ten false failures while `verify_keyframes.py` was being
   written, and the harness there now polls until the frame stops
   changing, which is a workaround in the caller for something only the
   renderer knows.

   Counted during the draw rather than re-derived afterwards: a separate
   pass asking "would this decode now?" can answer differently from what
   was actually painted, and then the report would be about a frame that
   was never returned.                                                  */

let pendingClipIds: string[] = [];

/** Clips that fell through to the placeholder in the last frame drawn. */
export function lastFramePendingMedia(): string[] {
  return [...pendingClipIds];
}

/** The drawable source for a clip's media, or null while it decodes. */
function resolveClipSource(clip: Clip): CanvasImageSource | null {
  const url = clip.mediaUrl;
  if (!url) return null;

  if (likelyVideoUrl(url, clip.type)) {
    const frame = getVideoFrame(url);
    if (frame) return frame;
    // Still decoding — hold the placeholder rather than mis-drawing.
    if (!videoFailed(url)) return null;
    // Decode failed: the label lied. Try it as a still.
  }

  getCachedImage(url);
  const img = mediaCache.get(url)?.el;
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

/**
 * Wait for every source the timeline references and report the ones
 * nothing can decode.
 *
 * Asked of the compositor rather than of either cache because the
 * answer depends on both: a clip typed `video` whose URL is really a
 * JPEG decodes through the image path, and must not be reported as
 * broken just because the video element refused it. Export uses this
 * to refuse to encode a placeholder gradient as if it were footage.
 */
export async function undecodableSources(tracks: Track[], timeoutMs = 15000): Promise<string[]> {
  const wanted = new Map<string, ClipType>();
  for (const track of tracks) {
    if (track.type === 'audio') continue;
    for (const clip of track.clips) {
      if (clip.hidden || !clip.mediaUrl) continue;
      if (clip.type === 'text' || clip.type === 'shape' || clip.type === 'adjustment') continue;
      wanted.set(clip.mediaUrl, clip.type);
    }
  }
  if (wanted.size === 0) return [];

  // Kick every decode off together rather than one at a time.
  for (const [url, type] of wanted) {
    if (likelyVideoUrl(url, type)) preloadVideo(url);
    else getCachedImage(url);
  }

  const deadline = Date.now() + timeoutMs;
  const broken: string[] = [];

  for (const [url, type] of wanted) {
    let ok = false;

    while (Date.now() < deadline) {
      if (likelyVideoUrl(url, type)) {
        if (getVideoNaturalSize(url)) { ok = true; break; }
        // Video decode failed — the label may be wrong, so try a still.
        if (videoFailed(url)) {
          getCachedImage(url);
          const entry = mediaCache.get(url);
          if (entry?.loaded) { ok = true; break; }
          if (entry?.failed) break;
        }
      } else {
        const entry = mediaCache.get(url);
        if (entry?.loaded) { ok = true; break; }
        if (entry?.failed) break;
      }
      await new Promise((r) => setTimeout(r, 40));
    }

    if (!ok) broken.push(url);
  }

  return broken;
}

/* ── Transitions ────────────────────────────────────────────────── */

interface TransitionState {
  /** 0..1 through the transition. */
  t: number;
  transition: ClipTransition;
  direction: 'in' | 'out';
}

function getTransitionState(clip: Clip, offsetMs: number): TransitionState | null {
  const tin = clip.transitionIn;
  if (tin && tin.type !== 'none' && offsetMs < tin.durationMs) {
    return { t: offsetMs / tin.durationMs, transition: tin, direction: 'in' };
  }

  const tout = clip.transitionOut;
  if (tout && tout.type !== 'none') {
    const startsAt = clip.durationMs - tout.durationMs;
    if (offsetMs >= startsAt) {
      return { t: (offsetMs - startsAt) / tout.durationMs, transition: tout, direction: 'out' };
    }
  }

  return null;
}

interface TransitionEffect {
  alpha: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  blurPx: number;
  /** Full-frame colour wash drawn after the clip. */
  flash?: { color: string; alpha: number };
  rgbSplitPx: number;
}

const NO_EFFECT: TransitionEffect = {
  alpha: 1, scale: 1, offsetX: 0, offsetY: 0, rotation: 0, blurPx: 0, rgbSplitPx: 0,
};

function resolveTransitionEffect(
  state: TransitionState | null,
  canvasWidth: number,
  canvasHeight: number
): TransitionEffect {
  if (!state) return NO_EFFECT;

  const incoming = state.direction === 'in';
  // `p` runs 0 → 1 as the clip becomes fully visible, in both directions.
  const p = incoming ? state.t : 1 - state.t;
  const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  const e = { ...NO_EFFECT };

  switch (state.transition.type) {
    case 'crossfade':
    case 'blur_dissolve':
      e.alpha = eased;
      if (state.transition.type === 'blur_dissolve') e.blurPx = (1 - eased) * 24;
      break;

    case 'dip_to_black':
      e.alpha = eased;
      e.flash = { color: '#000000', alpha: 1 - eased };
      break;

    case 'dip_to_white':
    case 'flash':
      e.alpha = 1;
      e.flash = { color: '#ffffff', alpha: Math.pow(1 - eased, 1.6) };
      break;

    case 'whip_pan':
      e.offsetX = (1 - eased) * canvasWidth * (incoming ? 0.85 : -0.85);
      e.blurPx = (1 - eased) * 22;
      e.alpha = Math.min(1, eased * 1.6);
      break;

    case 'push_left':
      e.offsetX = (1 - eased) * canvasWidth * (incoming ? 1 : -1);
      break;

    case 'push_right':
      e.offsetX = (1 - eased) * canvasWidth * (incoming ? -1 : 1);
      break;

    case 'slide_up':
      e.offsetY = (1 - eased) * canvasHeight * (incoming ? 1 : -1);
      break;

    case 'zoom_in':
      e.scale = 1 + (1 - eased) * 0.55;
      e.alpha = eased;
      break;

    case 'zoom_out':
      e.scale = 1 - (1 - eased) * 0.4;
      e.alpha = eased;
      break;

    case 'spin':
      e.rotation = (1 - eased) * 180 * (incoming ? 1 : -1);
      e.scale = 0.4 + eased * 0.6;
      e.alpha = eased;
      break;

    case 'glitch':
      e.alpha = 0.55 + eased * 0.45;
      e.rgbSplitPx = (1 - eased) * canvasWidth * 0.03;
      // Horizontal tearing driven by the transition phase, not wall-clock,
      // so a rendered frame is always reproducible.
      e.offsetX = Math.sin(p * 47) * (1 - eased) * 26;
      break;

    case 'diagonal_split':
      e.offsetX = (1 - eased) * canvasWidth * 0.6 * (incoming ? 1 : -1);
      e.offsetY = (1 - eased) * canvasHeight * 0.6 * (incoming ? 1 : -1);
      e.alpha = eased;
      break;

    default:
      break;
  }

  return e;
}

/* ── Colour filters ─────────────────────────────────────────────── */

/* ── Animated property resolution ───────────────────────────────────

   Every clip property that `list_properties` reports as animatable is
   resolved here, at the moment it is used, rather than being read
   straight off the clip. `interpolateKeyframes` returns the fallback
   after a single length check when a clip has no keyframes, so a static
   clip pays almost nothing for this.

   Before, only the seven transform properties were ever resolved. The
   rest were read as literals, which is why a keyframe on a filter or a
   stroke width was accepted, stored, drawn in the keyframe editor, and
   then ignored by the renderer.                                        */

function animated(
  clip: Clip,
  property: AnimatableProperty,
  offsetMs: number,
  fallback: number
): number {
  return interpolateKeyframes(clip.keyframes, property, offsetMs, fallback);
}

/** `clip.filters` with any keyframes applied. */
function resolvedFilters(clip: Clip, offsetMs: number): ClipFilters {
  const f = clip.filters;
  if (clip.keyframes.length === 0) return f;
  return {
    ...f,
    brightness: animated(clip, 'filters.brightness', offsetMs, f.brightness),
    contrast: animated(clip, 'filters.contrast', offsetMs, f.contrast),
    saturation: animated(clip, 'filters.saturation', offsetMs, f.saturation),
    exposure: animated(clip, 'filters.exposure', offsetMs, f.exposure),
    temperature: animated(clip, 'filters.temperature', offsetMs, f.temperature),
    tint: animated(clip, 'filters.tint', offsetMs, f.tint),
    highlights: animated(clip, 'filters.highlights', offsetMs, f.highlights),
    shadows: animated(clip, 'filters.shadows', offsetMs, f.shadows),
    sharpen: animated(clip, 'filters.sharpen', offsetMs, f.sharpen),
    vignette: animated(clip, 'filters.vignette', offsetMs, f.vignette),
    grain: animated(clip, 'filters.grain', offsetMs, f.grain),
    blur: animated(clip, 'filters.blur', offsetMs, f.blur),
    hueRotate: animated(clip, 'filters.hueRotate', offsetMs, f.hueRotate),
  };
}

function buildFilterString(clip: Clip, offsetMs: number): string {
  const f = resolvedFilters(clip, offsetMs);
  const parts: string[] = [];

  // Exposure and brightness both act on luminance; fold them together.
  const brightness = 100 + f.brightness + f.exposure * 0.8;
  if (Math.round(brightness) !== 100) parts.push(`brightness(${brightness.toFixed(1)}%)`);
  if (f.contrast !== 0) parts.push(`contrast(${(100 + f.contrast).toFixed(1)}%)`);
  if (f.saturation !== 0) parts.push(`saturate(${(100 + f.saturation).toFixed(1)}%)`);
  if (f.hueRotate !== 0) parts.push(`hue-rotate(${f.hueRotate}deg)`);
  if (f.blur > 0) parts.push(`blur(${f.blur}px)`);

  /*
    Highlights, shadows and sharpen need a tone curve and a convolution,
    which no CSS filter function can express — they were stored, shown
    as sliders, offered to the agent, and rendered by nothing. The SVG
    filter goes LAST so the curve reads the already-graded image, the
    same order a colourist would work in.
  */
  const tone = toneFilterId(f);
  if (tone) parts.push(`url(#${tone})`);

  return parts.length > 0 ? parts.join(' ') : 'none';
}

/** Warm/cool and green/magenta wash, which CSS filters can't express. */
function drawColorTemperature(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  width: number,
  height: number,
  offsetMs: number
): void {
  const { temperature, tint } = resolvedFilters(clip, offsetMs);
  if (temperature === 0 && tint === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = 'overlay';

  if (temperature !== 0) {
    const strength = Math.min(0.45, Math.abs(temperature) / 100);
    ctx.fillStyle = temperature > 0
      ? `rgba(255, 170, 80, ${strength})`
      : `rgba(80, 165, 255, ${strength})`;
    ctx.fillRect(-width / 2, -height / 2, width, height);
  }

  if (tint !== 0) {
    const strength = Math.min(0.4, Math.abs(tint) / 100);
    ctx.fillStyle = tint > 0
      ? `rgba(255, 90, 220, ${strength})`
      : `rgba(120, 255, 140, ${strength})`;
    ctx.fillRect(-width / 2, -height / 2, width, height);
  }

  ctx.restore();
}

/* ── Masking ────────────────────────────────────────────────────── */

/** The resolved mask for a clip at an instant, keyframes applied. */
function resolvedMask(clip: Clip, offsetMs: number): ClipMask {
  const base = clip.mask;
  if (clip.keyframes.length === 0) return base;
  return {
    ...base,
    sizeX: animated(clip, 'mask.sizeX', offsetMs, base.sizeX),
    sizeY: animated(clip, 'mask.sizeY', offsetMs, base.sizeY),
    offsetX: animated(clip, 'mask.offsetX', offsetMs, base.offsetX),
    offsetY: animated(clip, 'mask.offsetY', offsetMs, base.offsetY),
    rotation: animated(clip, 'mask.rotation', offsetMs, base.rotation),
    roundness: animated(clip, 'mask.roundness', offsetMs, base.roundness),
    featherPx: animated(clip, 'mask.featherPx', offsetMs, base.featherPx),
  };
}

/**
 * Trace the mask outline into the current path.
 *
 * Pulled out of `applyMask` because a feathered mask cannot use
 * `ctx.clip()` — clipping is binary, so the same outline has to be
 * FILLED into a separate layer and blurred instead. One tracer, two
 * consumers, so the hard and soft paths cannot describe different shapes.
 */
function traceMaskPath(ctx: CanvasRenderingContext2D, m: ClipMask, box: ClipBox): void {
  const w = (box.width * m.sizeX) / 100;
  const h = (box.height * m.sizeY) / 100;
  const ox = (box.width * m.offsetX) / 100;
  const oy = (box.height * m.offsetY) / 100;

  /*
    `mask.rotation` was stored, listed by `list_properties` with a
    -180..180 range, and read by nothing — every mask sat axis-aligned
    however it was set. A clipping region is kept in device space once
    applied, so the transform can be rotated for the trace and rotated
    back afterwards without disturbing it.
  */
  const rad = (m.rotation * Math.PI) / 180;
  if (rad !== 0) {
    ctx.translate(ox, oy);
    ctx.rotate(rad);
    ctx.translate(-ox, -oy);
  }

  ctx.beginPath();

  switch (m.type) {
    case 'circle': {
      const r = Math.min(w, h) / 2;
      ctx.arc(ox, oy, r, 0, Math.PI * 2);
      break;
    }
    case 'ellipse':
      ctx.ellipse(ox, oy, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;

    case 'split':
      ctx.rect(-box.width / 2 + ox, -box.height / 2, box.width / 2, box.height);
      break;

    case 'star': {
      const outer = Math.min(w, h) / 2;
      const inner = outer * 0.42;
      for (let i = 0; i < 10; i++) {
        const radius = i % 2 === 0 ? outer : inner;
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        const px = ox + Math.cos(angle) * radius;
        const py = oy + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }

    case 'heart': {
      const sz = Math.min(w, h) / 2;
      ctx.moveTo(ox, oy + sz * 0.6);
      ctx.bezierCurveTo(ox - sz * 1.4, oy - sz * 0.4, ox - sz * 0.5, oy - sz * 1.1, ox, oy - sz * 0.35);
      ctx.bezierCurveTo(ox + sz * 0.5, oy - sz * 1.1, ox + sz * 1.4, oy - sz * 0.4, ox, oy + sz * 0.6);
      ctx.closePath();
      break;
    }

    case 'film':
      ctx.roundRect(-w / 2 + ox, -h / 4 + oy, w, h / 2, h / 8);
      break;

    case 'rectangle':
    default:
      ctx.roundRect(-w / 2 + ox, -h / 2 + oy, w, h, Math.min(m.roundness, Math.min(w, h) / 2));
      break;
  }

  if (rad !== 0) {
    ctx.translate(ox, oy);
    ctx.rotate(-rad);
    ctx.translate(-ox, -oy);
  }
}

function applyMask(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  box: ClipBox,
  offsetMs: number
): void {
  const m = resolvedMask(clip, offsetMs);
  if (!m.enabled) return;

  traceMaskPath(ctx, m, box);

  if (m.inverted) {
    // Even-odd against the full box carves the shape out instead.
    ctx.rect(-box.width, -box.height, box.width * 2, box.height * 2);
    ctx.clip('evenodd');
  } else {
    ctx.clip();
  }
}

/* ── Text rendering ─────────────────────────────────────────────── */

function fontString(style: ClipTextStyle): string {
  const italic = style.italic ? 'italic ' : '';
  return `${italic}${style.fontWeight} ${style.fontSize}px ${style.fontFamily}, Inter, sans-serif`;
}

function measureLines(ctx: CanvasRenderingContext2D, style: ClipTextStyle): { lines: string[]; width: number; height: number } {
  const text = style.uppercase ? style.text.toUpperCase() : style.text;
  const lines = text.split('\n');
  ctx.font = fontString(style);

  let width = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width + style.letterSpacing * Math.max(0, line.length - 1);
    if (w > width) width = w;
  }

  return { lines, width, height: lines.length * style.fontSize * style.lineHeight };
}

/** Draw one line honouring letter-spacing, which canvas has no native support for. */
function drawTextLine(
  ctx: CanvasRenderingContext2D,
  line: string,
  x: number,
  y: number,
  style: ClipTextStyle,
  mode: 'fill' | 'stroke'
): void {
  if (style.letterSpacing === 0) {
    if (mode === 'stroke') ctx.strokeText(line, x, y);
    else ctx.fillText(line, x, y);
    return;
  }

  const spacing = style.letterSpacing;
  const total = ctx.measureText(line).width + spacing * Math.max(0, line.length - 1);

  let cursor = style.align === 'center' ? x - total / 2 : style.align === 'right' ? x - total : x;

  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const ch of line) {
    if (mode === 'stroke') ctx.strokeText(ch, cursor, y);
    else ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + spacing;
  }
  ctx.textAlign = prevAlign;
}

function renderTextClip(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  offsetMs: number
): void {
  const baseStyle = clip.textStyle;
  if (!baseStyle || !baseStyle.text) return;

  const style: ClipTextStyle = clip.keyframes.length === 0 ? baseStyle : {
    ...baseStyle,
    fontSize: animated(clip, 'textStyle.fontSize', offsetMs, baseStyle.fontSize),
    letterSpacing: animated(clip, 'textStyle.letterSpacing', offsetMs, baseStyle.letterSpacing),
  };

  const { lines, width, height } = measureLines(ctx, style);

  // Feed the true measurement back so the gizmo box matches the glyphs.
  cacheTextMetrics(clip, {
    width: width + style.backgroundPadding * 2,
    height: height + style.backgroundPadding * 2,
  });

  ctx.save();

  /* Kinetic entrance animations */
  const progress = clip.durationMs > 0 ? offsetMs / clip.durationMs : 0;
  switch (style.kineticAnimation) {
    case 'bounce': {
      const t = Math.min(1, offsetMs / 320);
      ctx.scale(1 + Math.sin(t * Math.PI) * 0.22, 1 + Math.sin(t * Math.PI) * 0.22);
      break;
    }
    case 'pop_in': {
      const t = Math.min(1, offsetMs / 260);
      const overshoot = 1 + Math.sin(t * Math.PI) * 0.14;
      const s = t < 1 ? 0.7 + t * 0.3 * overshoot : 1;
      ctx.scale(s, s);
      ctx.globalAlpha *= Math.min(1, offsetMs / 140);
      break;
    }
    case 'kinetic_stack': {
      const pulse = 1 + Math.sin(progress * Math.PI * 4) * 0.03;
      ctx.scale(pulse, pulse);
      break;
    }
    case 'fade_slide': {
      const t = Math.min(1, offsetMs / 320);
      ctx.translate(0, (1 - t) * 60);
      ctx.globalAlpha *= t;
      break;
    }
    case 'glitch_pop': {
      if (offsetMs < 240) {
        ctx.translate(Math.sin(offsetMs * 0.9) * 8, 0);
      }
      break;
    }
    default:
      break;
  }

  /* Background plate */
  if (style.background) {
    ctx.save();
    ctx.fillStyle = style.background;
    const bw = width + style.backgroundPadding * 2;
    const bh = height + style.backgroundPadding * 2;
    ctx.beginPath();
    ctx.roundRect(-bw / 2, -bh / 2, bw, bh, style.backgroundRadius);
    ctx.fill();
    ctx.restore();
  }

  ctx.font = fontString(style);
  ctx.textAlign = style.align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  const lineStep = style.fontSize * style.lineHeight;
  const startY = -((lines.length - 1) * lineStep) / 2;
  const anchorX = style.align === 'left' ? -width / 2 : style.align === 'right' ? width / 2 : 0;

  // Typewriter reveals characters over the first 60% of the clip.
  let visibleChars = Infinity;
  if (style.kineticAnimation === 'typewriter') {
    const totalChars = lines.join('').length;
    visibleChars = Math.ceil(Math.min(1, progress / 0.6) * totalChars);
  }

  let charsDrawn = 0;

  lines.forEach((rawLine, i) => {
    let line = rawLine;
    if (visibleChars !== Infinity) {
      const remaining = visibleChars - charsDrawn;
      if (remaining <= 0) return;
      line = rawLine.slice(0, remaining);
      charsDrawn += rawLine.length;
    }

    const y = startY + i * lineStep;

    if (style.shadowColor && style.shadowBlur > 0) {
      ctx.shadowColor = style.shadowColor;
      ctx.shadowBlur = style.shadowBlur;
      ctx.shadowOffsetX = style.shadowOffsetX;
      ctx.shadowOffsetY = style.shadowOffsetY;
    }

    /* Wave strokes each character at its own offset, so the flat
       whole-line stroke would sit behind it as a straight ghost. */
    const perCharacter = style.kineticAnimation === 'wave';

    if (!perCharacter && style.strokeColor && style.strokeWidth > 0) {
      ctx.strokeStyle = style.strokeColor;
      ctx.lineWidth = style.strokeWidth;
      drawTextLine(ctx, line, anchorX, y, style, 'stroke');
    }

    // Shadow already laid down by the stroke pass; don't double it on the fill.
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    /*
      Wave rides each character on a sine offset, phase-shifted along the
      line. It was offered by the type, by `list_properties` and by the
      inspector dropdown, and drawn by nothing — selecting it produced
      static text and no error.
    */
    if (style.kineticAnimation === 'wave') {
      const amplitude = style.fontSize * 0.18;
      const prevAlign = ctx.textAlign;
      ctx.textAlign = 'left';
      ctx.fillStyle = style.color;

      const lineWidth = ctx.measureText(line).width;
      let cursor =
        anchorX - (style.align === 'center' ? lineWidth / 2 : style.align === 'right' ? lineWidth : 0);

      for (const char of line) {
        // Two cycles across the line, one full cycle per second of clip.
        const phase = (cursor - anchorX) / Math.max(1, lineWidth) * Math.PI * 4;
        const offsetY = Math.sin(progress * Math.PI * 2 + phase) * amplitude;

        if (style.strokeColor && style.strokeWidth > 0) {
          ctx.strokeStyle = style.strokeColor;
          ctx.lineWidth = style.strokeWidth;
          ctx.strokeText(char, cursor, y + offsetY);
        }
        ctx.fillText(char, cursor, y + offsetY);
        cursor += ctx.measureText(char).width;
      }
      ctx.textAlign = prevAlign;
    } else if (style.kineticAnimation === 'karaoke_highlight' && style.highlightColor) {
      const words = line.split(' ');
      const activeIndex = Math.floor(progress * words.length);
      let cursor = anchorX - (style.align === 'center' ? ctx.measureText(line).width / 2 : 0);
      const prevAlign = ctx.textAlign;
      ctx.textAlign = 'left';
      words.forEach((word, wi) => {
        ctx.fillStyle = wi === activeIndex ? style.highlightColor! : style.color;
        ctx.fillText(word, cursor, y);
        cursor += ctx.measureText(`${word} `).width;
      });
      ctx.textAlign = prevAlign;
    } else {
      ctx.fillStyle = style.kineticAnimation === 'kinetic_stack' && style.highlightColor
        ? style.highlightColor
        : style.color;
      drawTextLine(ctx, line, anchorX, y, style, 'fill');
    }
  });

  ctx.restore();
}

/* ── Effect stack ───────────────────────────────────────────────── */

const randomCache = new Map<string, (n: number) => number>();

function randomFor(clipId: string): (n: number) => number {
  let fn = randomCache.get(clipId);
  if (!fn) {
    fn = makeSeededRandom(clipId);
    randomCache.set(clipId, fn);
    if (randomCache.size > 200) {
      const first = randomCache.keys().next().value;
      if (first !== undefined) randomCache.delete(first);
    }
  }
  return fn;
}

/** Resolve an effect's parameters, folding in its own keyframes. */
function resolveEffectParams(effect: Clip['effects'][number], offsetMs: number): Record<string, any> {
  const params: Record<string, any> = { ...effect.params };
  if (!effect.keyframes || effect.keyframes.length === 0) return params;

  // Group by param so each animated key gets its own interpolation.
  const byParam = new Map<string, typeof effect.keyframes>();
  for (const kf of effect.keyframes) {
    const list = byParam.get(kf.param) ?? [];
    list.push(kf);
    byParam.set(kf.param, list);
  }

  for (const [param, keys] of byParam) {
    const sorted = [...keys].sort((a, b) => a.timeOffsetMs - b.timeOffsetMs);
    if (sorted.length === 1) {
      params[param] = sorted[0].value;
      continue;
    }
    if (offsetMs <= sorted[0].timeOffsetMs) { params[param] = sorted[0].value; continue; }
    const last = sorted[sorted.length - 1];
    if (offsetMs >= last.timeOffsetMs) { params[param] = last.value; continue; }

    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (offsetMs >= a.timeOffsetMs && offsetMs <= b.timeOffsetMs) {
        const span = b.timeOffsetMs - a.timeOffsetMs;
        const t = span > 0 ? (offsetMs - a.timeOffsetMs) / span : 1;
        params[param] = a.value + (b.value - a.value) * applyEasing(t, a.easing);
        break;
      }
    }
  }

  return params;
}

function buildEffectContext(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  effect: Clip['effects'][number],
  box: ClipBox,
  offsetMs: number
): EffectRenderContext {
  return {
    ctx,
    width: box.width,
    height: box.height,
    offsetMs,
    progress: clip.durationMs > 0 ? Math.max(0, Math.min(1, offsetMs / clip.durationMs)) : 0,
    params: resolveEffectParams(effect, offsetMs),
    intensity: Math.max(0, Math.min(1, effect.intensity)),
    random: randomFor(clip.id),
  };
}

function runEffectHooks(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  box: ClipBox,
  offsetMs: number,
  phase: 'pre' | 'post'
): void {
  if (!clip.effects || clip.effects.length === 0) return;

  for (const effect of clip.effects) {
    if (!effect.enabled) continue;
    const def = getEffectDefinition(effect.type);
    const hook = def?.[phase];
    if (!hook) continue;

    const rc = buildEffectContext(ctx, clip, effect, box, offsetMs);
    try {
      hook(rc);
    } catch {
      // A misbehaving effect must never take the whole frame down.
    }
  }
}

/* ── Motion path ────────────────────────────────────────────────── */

/** Position (and optional heading) along a motion path at progress `t`. */
function samplePath(path: MotionPath, t: number): { x: number; y: number; angle: number } | null {
  const pts = path.points;
  if (!pts || pts.length < 2) return null;

  const eased = applyEasing(Math.max(0, Math.min(1, t)), path.easing);
  const segments = path.closed ? pts.length : pts.length - 1;
  const scaled = eased * segments;
  const index = Math.min(segments - 1, Math.floor(scaled));
  const local = scaled - index;

  const a = pts[index];
  const b = pts[(index + 1) % pts.length];

  // Quadratic through the outgoing handle keeps corners smooth.
  const cx = a.x + (a.hx ?? (b.x - a.x) / 2);
  const cy = a.y + (a.hy ?? (b.y - a.y) / 2);

  const inv = 1 - local;
  const x = inv * inv * a.x + 2 * inv * local * cx + local * local * b.x;
  const y = inv * inv * a.y + 2 * inv * local * cy + local * local * b.y;

  // Derivative gives the heading for orient-to-path.
  const dx = 2 * inv * (cx - a.x) + 2 * local * (b.x - cx);
  const dy = 2 * inv * (cy - a.y) + 2 * local * (b.y - cy);

  return { x, y, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/* ── Shape layers ───────────────────────────────────────────────── */

function traceShape(ctx: CanvasRenderingContext2D, style: ShapeStyle, w: number, h: number): void {
  const hw = w / 2;
  const hh = h / 2;
  ctx.beginPath();

  switch (style.kind) {
    case 'ellipse':
      ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
      break;

    case 'triangle':
      ctx.moveTo(0, -hh);
      ctx.lineTo(hw, hh);
      ctx.lineTo(-hw, hh);
      ctx.closePath();
      break;

    case 'polygon': {
      const n = Math.max(3, Math.round(style.points));
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(angle) * hw;
        const y = Math.sin(angle) * hh;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }

    case 'star': {
      const n = Math.max(3, Math.round(style.points));
      for (let i = 0; i < n * 2; i++) {
        const ratio = i % 2 === 0 ? 1 : style.innerRatio;
        const angle = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(angle) * hw * ratio;
        const y = Math.sin(angle) * hh * ratio;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }

    case 'line':
      ctx.moveTo(-hw, 0);
      ctx.lineTo(hw, 0);
      break;

    case 'arrow': {
      const head = Math.min(hw * 0.5, hh);
      ctx.moveTo(-hw, 0);
      ctx.lineTo(hw - head, 0);
      ctx.moveTo(hw, 0);
      ctx.lineTo(hw - head, -head * 0.6);
      ctx.moveTo(hw, 0);
      ctx.lineTo(hw - head, head * 0.6);
      break;
    }

    case 'heart': {
      const s = Math.min(hw, hh);
      ctx.moveTo(0, hh * 0.75);
      ctx.bezierCurveTo(-s * 2, -hh * 0.25, -s * 0.6, -hh * 1.3, 0, -hh * 0.35);
      ctx.bezierCurveTo(s * 0.6, -hh * 1.3, s * 2, -hh * 0.25, 0, hh * 0.75);
      ctx.closePath();
      break;
    }

    case 'blob': {
      // Organic rounded form built from four asymmetric bezier arcs.
      ctx.moveTo(0, -hh);
      ctx.bezierCurveTo(hw * 0.9, -hh * 0.9, hw, -hh * 0.1, hw * 0.75, hh * 0.45);
      ctx.bezierCurveTo(hw * 0.5, hh, -hw * 0.2, hh * 1.05, -hw * 0.7, hh * 0.55);
      ctx.bezierCurveTo(-hw * 1.05, hh * 0.05, -hw * 0.8, -hh * 0.75, 0, -hh);
      ctx.closePath();
      break;
    }

    case 'path':
      if (style.pathData) {
        try {
          const p = new Path2D(style.pathData);
          ctx.save();
          // Path data is authored in a 0..100 box; scale it to the layer.
          ctx.translate(-hw, -hh);
          ctx.scale(w / 100, h / 100);
          ctx.fillStyle = style.fill;
          ctx.fill(p);
          if (style.strokeWidth > 0) {
            ctx.strokeStyle = style.stroke;
            ctx.lineWidth = style.strokeWidth;
            ctx.stroke(p);
          }
          ctx.restore();
        } catch {
          /* invalid path data — draw nothing */
        }
        return;
      }
      break;

    case 'rectangle':
    default:
      ctx.roundRect(-hw, -hh, w, h, Math.min(style.cornerRadius, Math.min(hw, hh)));
      break;
  }
}

function renderShapeClip(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  box: ClipBox,
  offsetMs: number
): void {
  const base = clip.shapeStyle;
  if (!base) return;

  /* trimStart/trimEnd exist so a stroke can DRAW ON, which is the whole
     point of them and was impossible while they could not be keyframed.
     Same for strokeWidth: a mark built from strokes could be moved but
     never scaled, because its length came from the layout box and its
     weight was a literal. */
  const style: ShapeStyle = clip.keyframes.length === 0 ? base : {
    ...base,
    strokeWidth: animated(clip, 'shapeStyle.strokeWidth', offsetMs, base.strokeWidth),
    trimStart: animated(clip, 'shapeStyle.trimStart', offsetMs, base.trimStart),
    trimEnd: animated(clip, 'shapeStyle.trimEnd', offsetMs, base.trimEnd),
    cornerRadius: animated(clip, 'shapeStyle.cornerRadius', offsetMs, base.cornerRadius),
  };

  const isStrokeOnly = style.kind === 'line' || style.kind === 'arrow';

  ctx.save();

  if (style.shadow) {
    ctx.shadowColor = style.shadow.color;
    ctx.shadowBlur = style.shadow.blur;
    ctx.shadowOffsetX = style.shadow.offsetX;
    ctx.shadowOffsetY = style.shadow.offsetY;
  }

  traceShape(ctx, style, box.width, box.height);
  if (style.kind === 'path') { ctx.restore(); return; }

  if (!isStrokeOnly) {
    if (style.gradient) {
      const rad = (style.gradient.angle * Math.PI) / 180;
      const dx = (Math.cos(rad) * box.width) / 2;
      const dy = (Math.sin(rad) * box.height) / 2;
      const grad = ctx.createLinearGradient(-dx, -dy, dx, dy);
      grad.addColorStop(0, style.gradient.from);
      grad.addColorStop(1, style.gradient.to);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = style.fill;
    }
    ctx.fill();
  }

  if (style.strokeWidth > 0 || isStrokeOnly) {
    ctx.strokeStyle = style.stroke === 'transparent' && isStrokeOnly ? style.fill : style.stroke;
    ctx.lineWidth = Math.max(isStrokeOnly ? 2 : 0, style.strokeWidth);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Trim lets a stroke "draw on" when animated.
    if (style.trimStart > 0 || style.trimEnd < 1) {
      const perimeter = (box.width + box.height) * 2.4;
      const start = style.trimStart * perimeter;
      const length = Math.max(0, (style.trimEnd - style.trimStart) * perimeter);
      ctx.setLineDash([length, perimeter]);
      ctx.lineDashOffset = -start;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

/* ── Clip rendering ─────────────────────────────────────────────── */

/*
  Two scratch canvases, reused across every clip and every frame.

  A feathered mask needs the clip drawn in ISOLATION: the outline is
  filled into its own layer, blurred, and used as an alpha source with
  `destination-in`. Doing that on the main canvas would erase everything
  already composited under the clip, and blurring after the content is
  drawn would blur the CONTENT rather than the mask edge.

  Allocated once. A 1080p canvas pair is ~16MB and creating them per clip
  per frame is the difference between a soft mask being usable and being
  a reason not to use soft masks.
*/
let layerCanvas: HTMLCanvasElement | null = null;
let maskCanvas: HTMLCanvasElement | null = null;

function scratchPair(width: number, height: number) {
  if (!layerCanvas) layerCanvas = document.createElement('canvas');
  if (!maskCanvas) maskCanvas = document.createElement('canvas');
  for (const c of [layerCanvas, maskCanvas]) {
    if (c.width !== width || c.height !== height) {
      c.width = width;
      c.height = height;
    }
  }
  const lc = layerCanvas.getContext('2d');
  const mc = maskCanvas.getContext('2d');
  if (!lc || !mc) return null;
  lc.setTransform(1, 0, 0, 1, 0, 0);
  mc.setTransform(1, 0, 0, 1, 0, 0);
  lc.clearRect(0, 0, width, height);
  mc.clearRect(0, 0, width, height);
  return { layer: layerCanvas, layerCtx: lc, mask: maskCanvas, maskCtx: mc };
}

/**
 * Draw a clip through an isolated layer.
 *
 * Needed whenever the clip cannot be drawn straight onto the frame:
 *
 *   - **a feathered mask.** `ctx.clip()` is binary, so there is no soft
 *     clip. The alpha has to be built separately: fill the mask outline
 *     through a blur into a second layer and use it as the source of a
 *     `destination-in`. Blurring after the content is drawn would blur
 *     the CONTENT rather than the mask edge.
 *   - **a GPU pass.** A fragment shader needs the clip's own pixels as a
 *     texture, and running it against the main canvas would key or warp
 *     everything already composited underneath.
 *
 * Both end the same way — one canvas drawn onto the frame — so they
 * share the machinery and chain in the right order: shade first, then
 * feather, because the mask defines the clip's final shape.
 */
/** Enabled effects that want a shader rather than a 2D hook. */
function gpuEffects(clip: Clip): { key: ShaderKey; params: Record<string, number>; intensity: number }[] {
  if (!clip.effects || clip.effects.length === 0) return [];
  const out: { key: ShaderKey; params: Record<string, number>; intensity: number }[] = [];
  for (const effect of clip.effects) {
    if (!effect.enabled) continue;
    const def = getEffectDefinition(effect.type);
    if (!def?.gpu) continue;
    const params: Record<string, number> = {};
    for (const p of def.params) {
      const v = effect.params[p.key];
      params[p.key] = typeof v === 'number' ? v : (typeof p.default === 'number' ? p.default : 0);
    }
    out.push({ key: def.gpu as ShaderKey, params, intensity: effect.intensity ?? 1 });
  }
  return out;
}

function renderClipLayered(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  project: ProjectSettings,
  playheadMs: number,
  offsetMs: number,
  canvasWidth: number,
  canvasHeight: number,
  mask: ClipMask,
  needsFeather: boolean
): boolean {
  const pair = scratchPair(canvasWidth, canvasHeight);
  if (!pair) return false;

  // 1 — the clip. Its mask is suppressed when feathering, so the edge
  //     stays soft instead of being hard-clipped first.
  const source: Clip = needsFeather
    ? { ...clip, mask: { ...clip.mask, enabled: false } }
    : clip;
  renderClipPass(pair.layerCtx, source, project, playheadMs, offsetMs, canvasWidth, canvasHeight);

  // 2 — GPU passes, over the isolated layer.
  const key = clip.chromaKey;
  if (key?.enabled) {
    const shaded = runShader(
      pair.layer,
      'chroma_key',
      {
        u_keyColor: hexToRgb01(key.targetColorHex),
        /* The shader compares a straight RGB distance, which runs 0..~1.73.
           The stored values are the 0..100 the UI and the tools speak. */
        u_similarity: Math.max(0.01, (key.similarity / 100) * 0.9),
        u_smoothness: Math.max(0.001, (key.smoothness / 100) * 0.5),
        u_spill: key.spill / 100,
      },
      canvasWidth,
      canvasHeight
    );
    if (shaded) {
      pair.layerCtx.setTransform(1, 0, 0, 1, 0, 0);
      pair.layerCtx.clearRect(0, 0, canvasWidth, canvasHeight);
      pair.layerCtx.drawImage(shaded, 0, 0);
    }
    // No `shaded` means no WebGL on this machine. The clip still draws,
    // unkeyed, which is the honest fallback.
  }

  for (const fxPass of gpuEffects(clip)) {
    let uniforms: Record<string, number | [number, number, number]> = {};
    if (fxPass.key === 'displace') {
      uniforms = {
        u_amount: (fxPass.params.amount / 100) * 0.14 * fxPass.intensity,
        u_scale: fxPass.params.scale,
        u_time: (offsetMs / 1000) * (fxPass.params.speed / 100) * 2.2,
        u_angle: (fxPass.params.angle * Math.PI) / 180,
      };
    } else if (fxPass.key === 'rgb_glitch') {
      uniforms = { u_amount: (fxPass.params.amount ?? 20) / 100 * fxPass.intensity };
    }
    const out = runShader(pair.layer, fxPass.key, uniforms, canvasWidth, canvasHeight);
    if (!out) continue;
    pair.layerCtx.setTransform(1, 0, 0, 1, 0, 0);
    pair.layerCtx.clearRect(0, 0, canvasWidth, canvasHeight);
    pair.layerCtx.drawImage(out, 0, 0);
  }

  // 3 — the feathered alpha.
  if (needsFeather) {
    const box = getClipBox(clip, project, playheadMs, getNaturalSize(clip));
    const mctx = pair.maskCtx;
    mctx.save();
    mctx.translate(box.cx, box.cy);
    if (box.rotation !== 0) mctx.rotate((box.rotation * Math.PI) / 180);
    if (mask.inverted) {
      /* Inverted: opaque everywhere with a soft hole punched out. Filling
         an even-odd path would be right for a hard edge and wrong here —
         the blur has to apply to the hole, not to the union. */
      mctx.fillStyle = '#ffffff';
      mctx.fillRect(-canvasWidth, -canvasHeight, canvasWidth * 2, canvasHeight * 2);
      mctx.globalCompositeOperation = 'destination-out';
    }
    mctx.filter = `blur(${Math.max(0, mask.featherPx).toFixed(1)}px)`;
    mctx.fillStyle = '#ffffff';
    traceMaskPath(mctx, mask, box);
    mctx.fill();
    mctx.restore();

    pair.layerCtx.globalCompositeOperation = 'destination-in';
    pair.layerCtx.setTransform(1, 0, 0, 1, 0, 0);
    pair.layerCtx.drawImage(pair.mask, 0, 0);
    pair.layerCtx.globalCompositeOperation = 'source-over';
  }

  // 4 — composite in canvas space, whatever transform is currently set.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(pair.layer, 0, 0);
  ctx.restore();
  return true;
}

function renderClip(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  project: ProjectSettings,
  playheadMs: number,
  canvasWidth: number,
  canvasHeight: number
): void {
  const offsetMs = playheadMs - clip.startTimeMs;

  const mask = resolvedMask(clip, offsetMs);
  const needsFeather = mask.enabled && mask.featherPx > 0.5;
  const needsGpu = clip.chromaKey?.enabled === true || gpuEffects(clip).length > 0;
  if (needsFeather || needsGpu) {
    if (renderClipLayered(ctx, clip, project, playheadMs, offsetMs,
                          canvasWidth, canvasHeight, mask, needsFeather)) {
      return;
    }
  }

  // Motion blur renders the clip several times across the shutter interval.
  const mb = clip.motionBlur;
  if (mb?.enabled && mb.samples > 1) {
    const shutterMs = (mb.shutterAngle / 360) * (1000 / project.fps);
    const samples = Math.min(16, Math.max(2, Math.round(mb.samples)));
    ctx.save();
    ctx.globalAlpha = 1;
    for (let i = 0; i < samples; i++) {
      const t = playheadMs - shutterMs / 2 + (shutterMs * i) / (samples - 1);
      ctx.save();
      ctx.globalAlpha = 1 / samples;
      renderClipPass(ctx, clip, project, t, offsetMs + (t - playheadMs), canvasWidth, canvasHeight);
      ctx.restore();
    }
    ctx.restore();
    return;
  }

  renderClipPass(ctx, clip, project, playheadMs, offsetMs, canvasWidth, canvasHeight);
}

function renderClipPass(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  project: ProjectSettings,
  sampleMs: number,
  offsetMs: number,
  canvasWidth: number,
  canvasHeight: number
): void {
  const natural = getNaturalSize(clip);
  const box = getClipBox(clip, project, sampleMs, natural);

  const fx = resolveTransitionEffect(getTransitionState(clip, offsetMs), canvasWidth, canvasHeight);

  const alpha = Math.max(0, Math.min(1, box.opacity * fx.alpha));
  if (alpha <= 0.001) {
    // Still draw a colour wash even when the clip itself is invisible.
    if (fx.flash && fx.flash.alpha > 0.001) drawFlash(ctx, fx, canvasWidth, canvasHeight);
    return;
  }

  ctx.save();

  ctx.globalAlpha = ctx.globalAlpha * alpha;
  ctx.globalCompositeOperation = (clip.blendMode === 'normal' ? 'source-over' : clip.blendMode) as GlobalCompositeOperation;

  // A motion path overrides the transform's own translation.
  let originX = box.cx;
  let originY = box.cy;
  let pathAngle = 0;
  if (clip.motionPath?.enabled) {
    const progress = clip.durationMs > 0 ? offsetMs / clip.durationMs : 0;
    const sample = samplePath(clip.motionPath, progress);
    if (sample) {
      originX = sample.x;
      originY = sample.y;
      if (clip.motionPath.orientToPath) pathAngle = sample.angle;
    }
  }

  ctx.translate(originX + fx.offsetX, originY + fx.offsetY);
  if (box.rotation !== 0 || fx.rotation !== 0 || pathAngle !== 0) {
    ctx.rotate(((box.rotation + fx.rotation + pathAngle) * Math.PI) / 180);
  }

  /*
    The anchor. `transform.anchorX/anchorY` were settable, listed by
    `list_properties` with a 0..1 range, and read by NOTHING — every clip
    pivoted on its own centre no matter what they said. cx/cy locate the
    anchor, so once the context is rotated the content has to be pushed
    back by the distance from the anchor to the centre; a 0.5,0.5 anchor
    makes that zero, which is why nobody noticed.
  */
  if (box.anchorX !== 0.5 || box.anchorY !== 0.5) {
    ctx.translate((0.5 - box.anchorX) * box.width, (0.5 - box.anchorY) * box.height);
  }
  if (fx.scale !== 1) ctx.scale(fx.scale, fx.scale);
  if (clip.transform.flipH || clip.transform.flipV) {
    ctx.scale(clip.transform.flipH ? -1 : 1, clip.transform.flipV ? -1 : 1);
  }

  // `pre` hooks run before the mask so shake/pulse move the whole layer.
  runEffectHooks(ctx, clip, box, offsetMs, 'pre');

  applyMask(ctx, clip, box, offsetMs);

  const cssFilter = buildFilterString(clip, offsetMs);
  const transitionBlur = fx.blurPx > 0 ? ` blur(${fx.blurPx.toFixed(1)}px)` : '';
  const preFilter = ctx.filter && ctx.filter !== 'none' ? ctx.filter : '';
  const combined = [preFilter, cssFilter === 'none' ? '' : cssFilter, transitionBlur.trim()]
    .filter(Boolean)
    .join(' ');
  ctx.filter = combined || 'none';

  const halfW = box.width / 2;
  const halfH = box.height / 2;

  if (clip.type === 'shape') {
    renderShapeClip(ctx, clip, box, offsetMs);
  } else if (clip.type === 'text') {
    /*
      Text is drawn from its own font metrics, so unlike a shape or a
      media clip it does not get sized by the layout box — which meant
      `transform.scaleX` / `scaleY` did nothing at all to it. They were
      settable, keyframeable, listed by `list_properties` and reported
      back on read, and the transform gizmo drew a box that grew around
      glyphs that never moved. The bundled starter animated its wordmark
      from 0.92 to 1 on both axes and rendered identical frames.

      Measured before the fix: a 160px "KERF" keyframed 1 -> 2 rendered
      264x79 px of ink at both ends.
    */
    ctx.save();
    if (box.scaleX !== 1 || box.scaleY !== 1) ctx.scale(box.scaleX, box.scaleY);
    renderTextClip(ctx, clip, offsetMs);
    ctx.restore();
  } else if (clip.type === 'adjustment') {
    // Adjustment layers tint the frame rather than drawing media.
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(-halfW, -halfH, box.width, box.height);
  } else if (clip.mediaUrl) {
    const img = resolveClipSource(clip);
    if (img) {
      if (fx.rgbSplitPx > 0.5) {
        // Chromatic aberration: three offset passes through channel filters.
        const split = fx.rgbSplitPx;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha * 0.55;
        // `url(#none)` used to lead this list. It references a filter that
        // does not exist, which invalidates the ENTIRE filter string — so
        // the red channel pass was drawing untinted.
        ctx.filter = 'sepia(1) hue-rotate(-50deg) saturate(6)';
        ctx.drawImage(img, -halfW - split, -halfH, box.width, box.height);
        ctx.filter = 'sepia(1) hue-rotate(90deg) saturate(6)';
        ctx.drawImage(img, -halfW + split, -halfH, box.width, box.height);
        ctx.restore();
        ctx.globalAlpha = alpha * 0.8;
      }
      ctx.drawImage(img, -halfW, -halfH, box.width, box.height);
    } else {
      // Placeholder while the media decodes — and say which clip, so the
      // frame can report that it is not showing what was asked for.
      pendingClipIds.push(clip.id);
      const grad = ctx.createLinearGradient(-halfW, -halfH, halfW, halfH);
      grad.addColorStop(0, '#14161c');
      grad.addColorStop(1, '#1d222b');
      ctx.fillStyle = grad;
      ctx.fillRect(-halfW, -halfH, box.width, box.height);
    }
  }

  ctx.filter = 'none';

  if (clip.type !== 'text') {
    drawColorTemperature(ctx, clip, box.width, box.height, offsetMs);

    const rf = resolvedFilters(clip, offsetMs);
    if (rf.vignette > 0) {
      const radius = Math.max(box.width, box.height) * 0.62;
      const grad = ctx.createRadialGradient(0, 0, radius * 0.38, 0, 0, radius);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(0,0,0,${Math.min(0.95, rf.vignette / 100)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(-halfW, -halfH, box.width, box.height);
    }

    if (rf.grain > 0) drawGrain(ctx, box, rf.grain, sampleMs);
  }

  // `post` hooks composite on top of the drawn layer, still in clip space.
  runEffectHooks(ctx, clip, box, offsetMs, 'post');

  ctx.restore();

  if (fx.flash && fx.flash.alpha > 0.001) drawFlash(ctx, fx, canvasWidth, canvasHeight);
}

function drawFlash(
  ctx: CanvasRenderingContext2D,
  fx: TransitionEffect,
  canvasWidth: number,
  canvasHeight: number
): void {
  if (!fx.flash) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = Math.min(1, fx.flash.alpha);
  ctx.fillStyle = fx.flash.color;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.restore();
}

/* ── Film grain ─────────────────────────────────────────────────── */
/* One small noise tile, generated once and tiled — cheap enough for 60fps. */

let grainTile: HTMLCanvasElement | null = null;

function getGrainTile(): HTMLCanvasElement {
  if (grainTile) return grainTile;

  const size = 128;
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const tctx = tile.getContext('2d');
  if (tctx) {
    const data = tctx.createImageData(size, size);
    for (let i = 0; i < data.data.length; i += 4) {
      const v = 128 + (Math.random() - 0.5) * 255;
      data.data[i] = v;
      data.data[i + 1] = v;
      data.data[i + 2] = v;
      data.data[i + 3] = 255;
    }
    tctx.putImageData(data, 0, 0);
  }
  grainTile = tile;
  return tile;
}

function drawGrain(ctx: CanvasRenderingContext2D, box: ClipBox, amount: number, playheadMs: number): void {
  const tile = getGrainTile();
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return;

  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = Math.min(0.5, amount / 100);
  // Jitter the tile per frame so the grain moves like real film.
  const frame = Math.floor(playheadMs / 33);
  ctx.translate((frame * 37) % 128, (frame * 61) % 128);
  ctx.fillStyle = pattern;
  ctx.fillRect(-box.width, -box.height, box.width * 2 + 128, box.height * 2 + 128);
  ctx.restore();
}

/* ── Frame render ───────────────────────────────────────────────── */

export function renderTimelineFrame(
  ctx: CanvasRenderingContext2D,
  tracks: Track[],
  project: ProjectSettings,
  playheadMs: number,
  canvasWidth: number,
  canvasHeight: number
): void {
  // Reset before the draw, so `lastFramePendingMedia()` always describes
  // the frame that was just rendered and never the one before it.
  pendingClipIds = [];

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';

  ctx.fillStyle = project.backgroundColor || '#000000';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  /*
    Everything below lays out in PROJECT pixels: `getClipBox` centres on
    `project.width / 2`, and a clip's `transform.x` is an offset in those
    same units. So a canvas that is not the project's size needs a scale
    here, or the whole composition renders at project size in the corner
    of the frame — which is exactly what a 4K export of a 1080p sequence
    used to do. These two parameters existed and only the background fill
    was honouring them.
  */
  const scaleX = canvasWidth / project.width;
  const scaleY = canvasHeight / project.height;
  if (scaleX !== 1 || scaleY !== 1) ctx.scale(scaleX, scaleY);

  // Highest index paints first so track 0 ends up on top.
  const ordered = [...tracks].sort((a, b) => b.index - a.index);
  const anySolo = tracks.some((t) => t.solo);

  for (const track of ordered) {
    if (track.type === 'audio') continue;
    if (track.muted) continue;
    if (anySolo && !track.solo) continue;

    for (const clip of track.clips) {
      if (clip.hidden) continue;
      if (playheadMs < clip.startTimeMs) continue;
      if (playheadMs >= clip.startTimeMs + clip.durationMs) continue;
      renderClip(ctx, clip, project, playheadMs, canvasWidth, canvasHeight);
    }
  }

  ctx.restore();
}

/* ── Offscreen measurement context ──────────────────────────────── */
/* The gizmo needs text metrics before the compositor has drawn a frame. */

let measureCtx: CanvasRenderingContext2D | null = null;

export function primeTextMetrics(clip: Clip, project: ProjectSettings): void {
  if (clip.type !== 'text' || !clip.textStyle) return;

  if (!measureCtx) {
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 8;
    measureCtx = c.getContext('2d');
  }
  if (!measureCtx) return;

  const { width, height } = measureLines(measureCtx, clip.textStyle);
  cacheTextMetrics(clip, {
    width: width + clip.textStyle.backgroundPadding * 2,
    height: height + clip.textStyle.backgroundPadding * 2,
  });
  // Touch getClipBaseSize so a first-frame gizmo has a sized box.
  getClipBaseSize(clip, project, null);
}
