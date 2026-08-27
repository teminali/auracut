/* ═══════════════════════════════════════════════════════════════════
   Animated previews for effects and transitions.

   The effects and transitions panels used to show an EMOJI per entry:
   a magnifying glass for `zoom_in`, a space invader for `glitch`, a
   film reel for `crossfade`. None of that tells anyone what the thing
   looks like, and three of them were the same picture at a glance.

   So the preview is the real thing. These render through the actual
   compositor, on a real timeline, applying the real effect and the
   real transition, and hand back frames. There is no illustration and
   no approximation anywhere in this file: if a preview looks wrong,
   the feature IS wrong, which is the property worth having.

   The scene is built to make distortion legible. A flat colour swatch
   would show nothing at all for a warp, a split or a shake, so every
   preview renders a frame with structure in it: a full-bleed ground, a
   contrasting band, a disc and a glyph. A whip pan smears the band, a
   glitch tears the glyph, a zoom moves the disc off the edge.
   ═══════════════════════════════════════════════════════════════════ */

import { createClip, type Clip, type Track, type ProjectSettings, type TransitionType } from '../types/edl';
import type { ClipFilters, KineticAnimation } from '../types/edl';
import { captureFrame } from './frameCapture';
import { getEffectDefinition } from './effectsRegistry';

/* Small enough to render fast, large enough to read at 2x on a panel. */
const W = 320;
const H = 180;

/** Frames per preview. Twelve at ~12fps is a one-second loop. */
const FRAMES = 12;

const CLIP_MS = 1200;

function project(): ProjectSettings {
  return {
    id: 'preview', name: 'preview', aspectRatio: '16:9',
    width: W, height: H, fps: 30, durationMs: CLIP_MS * 2,
    backgroundColor: '#0a0b0e', createdAt: 0, updatedAt: 0,
  };
}

/**
 * One half of the scene: a ground, a band, a disc and a glyph.
 *
 * Two palettes, warm and cool, so a transition reads as A becoming B
 * even when the transition itself does nothing to geometry. `dip_to_black`
 * and `crossfade` are indistinguishable on a single-colour scene.
 */
function scene(
  side: 'a' | 'b',
  startTimeMs: number,
  opts: { transition?: TransitionType; effect?: string } = {}
): Clip[] {
  const warm = side === 'a';
  const ground = warm ? '#c07f1c' : '#136b83';
  const band = warm ? '#f2c46a' : '#5fd0e0';
  const disc = warm ? '#3a2405' : '#04303d';
  const glyph = warm ? '#3a2405' : '#eafbff';

  const t = opts.transition && opts.transition !== 'none'
    ? { transitionIn: { type: opts.transition, durationMs: 700 } }
    : {};

  const fx = (accepts: ('video' | 'image' | 'text' | 'shape' | 'audio' | 'adjustment')[]) => {
    if (!opts.effect) return {};
    const def = getEffectDefinition(opts.effect);
    if (!def) return {};
    // An effect declaring `appliesTo` is telling us it renders nothing
    // on other clip types. Attaching it anyway would produce a preview
    // of the effect doing nothing, which is worse than no preview.
    if (def.appliesTo && !def.appliesTo.some((a) => accepts.includes(a))) return {};
    const params: Record<string, number | string | boolean> = {};
    for (const p of def.params) params[p.key] = p.default as number | string | boolean;
    return {
      effects: [{ id: `fx_${side}`, type: opts.effect, enabled: true, intensity: 1, params, keyframes: [] }],
    };
  };

  const base = { startTimeMs, durationMs: CLIP_MS, sourceStartMs: 0, sourceDurationMs: CLIP_MS };

  return [
    createClip({
      id: `${side}_ground`, trackId: 'pv_base', type: 'shape', name: 'ground', ...base, ...t,
      shapeStyle: { kind: 'rectangle', fill: ground, strokeWidth: 0 },
      transform: { scaleX: 3, scaleY: 3 },
      ...fx(['shape']),
    }),
    createClip({
      id: `${side}_band`, trackId: 'pv_mid', type: 'shape', name: 'band', ...base, ...t,
      shapeStyle: { kind: 'rectangle', fill: band, strokeWidth: 0 },
      transform: { scaleX: 2.4, scaleY: 0.34, y: warm ? -34 : 34 },
      ...fx(['shape']),
    }),
    createClip({
      id: `${side}_disc`, trackId: 'pv_mid2', type: 'shape', name: 'disc', ...base, ...t,
      shapeStyle: { kind: 'ellipse', fill: disc, strokeWidth: 0 },
      transform: { scaleX: 0.5, scaleY: 0.5, x: warm ? 86 : -86, y: warm ? 30 : -30 },
      ...fx(['shape']),
    }),
    createClip({
      id: `${side}_glyph`, trackId: 'pv_top', type: 'text', name: warm ? 'A' : 'B', ...base, ...t,
      textStyle: { text: warm ? 'A' : 'B', fontSize: 92, fontWeight: 800, color: glyph, strokeWidth: 0 },
      transform: { x: warm ? -70 : 70 },
      ...fx(['text']),
    }),
  ];
}

function tracks(clips: Clip[]): Track[] {
  /*
    Bottom to top, and the INDEX runs the other way.

    `compositor.ts`: "Highest index paints first so track 0 ends up on
    top." Numbering these 0..3 in reading order put the full-bleed
    ground on top of everything, and every preview rendered as a flat
    amber rectangle — the band, the disc and the glyph were all drawn
    and then painted over. Caught by sampling pixels rather than by
    looking, because a flat swatch is exactly what a broken preview and
    a working `dip_to_black` both look like at 90px.
  */
  const ids = ['pv_base', 'pv_mid', 'pv_mid2', 'pv_top'];
  return ids.map((id, i) => ({
    id, type: 'video' as const, name: id, index: ids.length - 1 - i,
    muted: false, locked: false, solo: false, volume: 1,
    heightPx: 40, collapsed: false,
    clips: clips.filter((c) => c.trackId === id),
  }));
}

/*
  One render per key per session. A panel of 23 effects mounting would
  otherwise redraw 276 frames every time it opens, on the main thread,
  while somebody is trying to scroll it.
*/
const cache = new Map<string, string[]>();
const inflight = new Map<string, Promise<string[]>>();

async function render(key: string, clips: Clip[], from: number, to: number): Promise<string[]> {
  const cached = cache.get(key);
  if (cached) return cached;
  const running = inflight.get(key);
  if (running) return running;

  const job = (async () => {
    const proj = project();
    const tks = tracks(clips);
    const frames: string[] = [];

    for (let i = 0; i < FRAMES; i++) {
      const atMs = from + ((to - from) * i) / (FRAMES - 1);
      const f = captureFrame(tks, proj, atMs);
      if (f.dataUrl) frames.push(f.dataUrl);
      // Yield between frames. These are synchronous full composites and
      // a tight loop of twelve would drop input for the whole panel.
      await new Promise((r) => setTimeout(r, 0));
    }

    cache.set(key, frames);
    inflight.delete(key);
    return frames;
  })();

  inflight.set(key, job);
  return job;
}

/**
 * Frames across a transition, sampled over the window it actually runs in.
 *
 * Starts slightly before the cut so the first frame is unambiguously the
 * OUTGOING shot. A preview that opens mid-transition reads as a static
 * blend and tells you nothing about the direction.
 */
export function transitionPreview(type: TransitionType): Promise<string[]> {
  const clips = [...scene('a', 0), ...scene('b', CLIP_MS, { transition: type })];
  return render(`t:${type}`, clips, CLIP_MS - 160, CLIP_MS + 760);
}

/**
 * Frames across an effect's own cycle.
 *
 * Sampled over a full second rather than a single instant, because a
 * still of `zoom_pulse`, `shake` or `film_grain` is indistinguishable
 * from the clip with no effect on it at all.
 */
export function effectPreview(type: string): Promise<string[]> {
  const clips = scene('a', 0, { effect: type });
  return render(`e:${type}`, clips, 60, 1060);
}

/** The scene with nothing applied, for a side-by-side "before". */
export function neutralPreview(): Promise<string[]> {
  return render('neutral', scene('a', 0), 60, 1060);
}

/* ═══ Colour looks ══════════════════════════════════════════════════
   A grade needs something to grade.

   The looks panel used a hand-authored CSS gradient per look as a
   "swatch": three colours somebody guessed would suggest the result.
   That is the same problem the emoji were — an illustration standing in
   for the thing — and it is worse here, because the guess and the
   actual filter values can drift apart silently for ever.

   Grading the two-tone scene above would show almost nothing: a
   temperature shift needs both warm and cool in frame, and lifted
   blacks need a black to lift. So this scene carries a full range:
   a sky, a mid, a warm subject, a near-black foreground and a specular
   highlight.
   ═══════════════════════════════════════════════════════════════════ */

function gradeScene(filters: Partial<ClipFilters>): Clip[] {
  const base = { startTimeMs: 0, durationMs: CLIP_MS, sourceStartMs: 0, sourceDurationMs: CLIP_MS };
  const f = { filters } as { filters: Partial<ClipFilters> };

  const bar = (
    id: string, trackId: string, fill: string,
    t: { scaleX: number; scaleY: number; x?: number; y?: number }
  ) =>
    createClip({
      id, trackId, type: 'shape', name: id, ...base, ...f,
      shapeStyle: { kind: 'rectangle', fill, strokeWidth: 0 },
      transform: t,
    });

  return [
    // Sky, so a temperature shift has something cool to act on.
    bar('g_sky', 'pv_base', '#4d84c4', { scaleX: 3, scaleY: 3 }),
    // Mid ground.
    bar('g_mid', 'pv_mid', '#7a8a6a', { scaleX: 2.4, scaleY: 0.9, y: 34 }),
    // A warm subject, so skin does not go green under a heavy grade.
    createClip({
      id: 'g_subject', trackId: 'pv_mid2', type: 'shape', name: 'subject', ...base, ...f,
      shapeStyle: { kind: 'ellipse', fill: '#d79a6a', strokeWidth: 0 },
      transform: { scaleX: 0.62, scaleY: 0.78, x: -54, y: 10 },
    }),
    // Near-black, so lifted blacks and vignette are visible, and a
    // specular, so highlight rolloff and bleach are visible.
    createClip({
      id: 'g_dark', trackId: 'pv_top', type: 'shape', name: 'dark', ...base, ...f,
      shapeStyle: { kind: 'rectangle', fill: '#0c0f14', strokeWidth: 0 },
      transform: { scaleX: 0.9, scaleY: 0.5, x: 96, y: 44 },
    }),
  ];
}

/**
 * Frames of a colour look applied to a full-range scene.
 *
 * Several frames rather than one, because `grain` moves and a still of
 * a grainy look is indistinguishable from a clean one.
 */
export function lookPreview(id: string, filters: Partial<ClipFilters>): Promise<string[]> {
  return render(`l:${id}`, gradeScene(filters), 60, 700);
}

/* ═══ Kinetic text ══════════════════════════════════════════════════
   Nine text animations, previously offered as nine words in a
   segmented control. "Kinetic Stack", "Glitch Pop" and "Wave" are not
   self-describing, and the only way to find out what one did was to
   apply it to a real title, scrub, and undo.

   These run the animation itself. They are sampled over the FIRST part
   of the clip, because a kinetic animation is an entrance: by the time
   a title has settled, every one of them looks the same.
   ═══════════════════════════════════════════════════════════════════ */

export function textPreview(animation: KineticAnimation, sample = 'Title'): Promise<string[]> {
  const clips = [
    createClip({
      id: 'tx_ground', trackId: 'pv_base', type: 'shape', name: 'ground',
      startTimeMs: 0, durationMs: CLIP_MS, sourceStartMs: 0, sourceDurationMs: CLIP_MS,
      shapeStyle: { kind: 'rectangle', fill: '#14181f', strokeWidth: 0 },
      transform: { scaleX: 3, scaleY: 3 },
    }),
    createClip({
      id: 'tx_text', trackId: 'pv_top', type: 'text', name: sample,
      startTimeMs: 0, durationMs: CLIP_MS, sourceStartMs: 0, sourceDurationMs: CLIP_MS,
      textStyle: {
        text: sample, fontSize: 54, fontWeight: 800, color: '#ffffff',
        strokeWidth: 0, kineticAnimation: animation,
      },
    }),
  ];
  /*
    0 to 900ms. Entrances are typically under a second, and starting at
    exactly 0 matters here in a way it does not for a transition: frame
    zero IS the animation for `pop_in` and `typewriter`.
  */
  return render(`x:${animation}`, clips, 0, 900);
}
