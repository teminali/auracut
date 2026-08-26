/* ═══════════════════════════════════════════════════════════════════
   Look presets — a named grade, applied across clips in one call.

   Improvised, a grade is: read the clip list, decide eight filter
   numbers, patch each clip, render a frame, look at it, adjust, patch
   again. Six calls before anything is verified and a different answer
   every run. As a preset it is one call and the same answer every time.

   ── Why these particular properties ────────────────────────────────

   Every value below is a `filters.*` path that the compositor DEMONSTRABLY
   renders. That is not an assumption; `tools/verify_keyframes.py` proves
   all thirteen on rendered pixels, and this module deliberately uses
   nothing else. `chromaKey` had five properties and zero references in
   the compositor for months, and `transform.scaleX` rendered nothing for
   text while reporting itself set — a preset built out of properties
   nobody had traced to the picture would be the same bug wearing a
   friendlier name.

   Three of the thirteen are NOT available on every clip type, and that
   is the reason `renderableFilters()` exists rather than a blanket apply:

     · `temperature`, `tint`, `vignette` and `grain` are drawn in
       `renderClipPass` under `if (clip.type !== 'text')`. On a text clip
       they are stored, reported back on read, and render nothing.
     · An `adjustment` clip draws `rgba(0,0,0,0)` — a transparent fill.
       `ctx.filter` is set before it, so every CSS-filter and tone-curve
       property has literally nothing to act on. Only the overlay-drawn
       ones (vignette, grain, temperature, tint) mark the frame.
     · `audio` clips draw nothing at all.

   So the catalogue declares what each look needs, and the applier
   reports every clip it declined and WHY, instead of writing numbers
   into a clip that will never show them.

   ── Why `expect` is part of the data ───────────────────────────────

   Each preset states, in the picture, what must change when it lands.
   That claim is returned by the tool and asserted on rendered pixels by
   `tools/verify_altitude.py`. A look that reports success and leaves the
   frame alone is exactly the failure this codebase exists to prevent, and
   the only defence is a claim specific enough to fail.
   ═══════════════════════════════════════════════════════════════════ */

import { Clip, ClipFilters, ClipType, DEFAULT_FILTERS } from '../types/edl';

/* ── What a look claims about the picture ───────────────────────── */

/**
 * Frame metrics a verification pass can measure without knowing anything
 * about the grade. Names match the helpers in `tools/verify_altitude.py`.
 */
export type LookMetric =
  | 'warmth'      // mean(R) − mean(B)
  | 'greenMagenta'// mean(G) − (mean(R)+mean(B))/2
  | 'saturation'  // mean(max channel − min channel)
  | 'contrast'    // std(luma)
  | 'meanLuma'
  | 'blackLevel'  // 2nd percentile of luma
  | 'edges'       // mean |∇luma|
  | 'hueAngle';

export interface LookExpectation {
  metric: LookMetric;
  direction: 'up' | 'down';
  /** How far it must move on a mid-grey-averaged chart before it counts. */
  minChange: number;
  why: string;
}

export interface LookPreset {
  id: string;
  label: string;
  description: string;
  /** Only the filters this look deliberately sets. */
  filters: Partial<ClipFilters>;
  expect: LookExpectation[];
}

/* ── The catalogue ──────────────────────────────────────────────── */

/*
  Six looks, chosen so no two move the same metrics in the same
  direction — a catalogue where two entries are indistinguishable on the
  frame is a catalogue with one entry and a typo.

    warm_filmic         warmth ↑   saturation ↑
    cold_teal           warmth ↓   contrast ↑
    high_contrast_mono  saturation → 0   contrast ↑
    faded_lift          contrast ↓  black level ↑
    punchy              saturation ↑  edges ↑
    neon_shift          hue angle rotates   saturation ↑
*/
export const LOOK_PRESETS: LookPreset[] = [
  {
    id: 'warm_filmic',
    label: 'Warm Filmic',
    description: 'Golden-hour 35mm. Warm wash, gentle highlight roll-off, lifted blacks, light grain.',
    filters: {
      temperature: 34,
      saturation: 14,
      contrast: 12,
      highlights: -16,
      shadows: 12,
      grain: 14,
      vignette: 18,
    },
    expect: [
      { metric: 'warmth', direction: 'up', minChange: 8,
        why: 'the temperature wash paints amber over the frame' },
      { metric: 'saturation', direction: 'up', minChange: 3,
        why: '+14 saturation on top of the wash' },
    ],
  },
  {
    id: 'cold_teal',
    label: 'Cold Teal',
    description: 'Moonlit blue-green. Cold wash, crushed midtones, strong contrast, heavy vignette.',
    filters: {
      temperature: -40,
      tint: -14,
      contrast: 26,
      saturation: 10,
      shadows: -10,
      vignette: 30,
    },
    expect: [
      { metric: 'warmth', direction: 'down', minChange: 8,
        why: 'the cold wash paints blue over the frame' },
      { metric: 'contrast', direction: 'up', minChange: 3,
        why: '+26 contrast widens the luma spread' },
    ],
  },
  {
    id: 'high_contrast_mono',
    label: 'High-Contrast Mono',
    description: 'Black and white with hard blacks and clean whites. No colour survives this.',
    filters: {
      saturation: -100,
      contrast: 40,
      brightness: -4,
      highlights: 14,
      shadows: -18,
      vignette: 42,
    },
    expect: [
      { metric: 'saturation', direction: 'down', minChange: 20,
        why: 'saturation -100 must leave the frame achromatic' },
      { metric: 'contrast', direction: 'up', minChange: 3,
        why: '+40 contrast widens the luma spread' },
    ],
  },
  {
    id: 'faded_lift',
    label: 'Faded / Lifted Black',
    description: 'Matte, washed-out print look. Blacks lift off zero, contrast drops, grain sits on top.',
    filters: {
      shadows: 40,
      contrast: -26,
      saturation: -24,
      brightness: 10,
      highlights: -8,
      grain: 22,
    },
    expect: [
      { metric: 'blackLevel', direction: 'up', minChange: 6,
        why: 'shadows +40 lifts the bottom of the tone curve off zero' },
      { metric: 'contrast', direction: 'down', minChange: 4,
        why: '-26 contrast narrows the luma spread' },
    ],
  },
  {
    id: 'punchy',
    label: 'Punchy',
    description: 'Social-ready snap. Saturation and contrast up, sharpened, slight exposure lift.',
    filters: {
      saturation: 48,
      contrast: 24,
      exposure: 10,
      sharpen: 45,
      vignette: 12,
    },
    expect: [
      { metric: 'saturation', direction: 'up', minChange: 8,
        why: '+48 saturation' },
      { metric: 'edges', direction: 'up', minChange: 0.3,
        why: 'sharpen 45 runs an unsharp-mask convolution over the layer' },
    ],
  },
  {
    id: 'neon_shift',
    label: 'Neon Shift',
    description: 'Magenta/cyan hue rotation with the saturation to carry it. Nothing keeps its original hue.',
    filters: {
      hueRotate: 130,
      saturation: 46,
      contrast: 20,
      tint: 22,
      vignette: 26,
    },
    expect: [
      { metric: 'hueAngle', direction: 'up', minChange: 0.4,
        why: 'a 130° rotation moves the frame\'s mean hue angle' },
      { metric: 'saturation', direction: 'up', minChange: 6,
        why: '+46 saturation' },
    ],
  },
];

const BY_ID = new Map(LOOK_PRESETS.map((p) => [p.id, p]));

export function getLookPreset(id: string): LookPreset | undefined {
  return BY_ID.get(id);
}

export function lookPresetIds(): string[] {
  return LOOK_PRESETS.map((p) => p.id);
}

/* ── What each clip type can actually show ──────────────────────── */

/**
 * The filter properties the compositor draws for a clip of this type.
 *
 * Derived by reading `renderClipPass`, not by hope:
 *   · CSS filter string + SVG tone curve — every clip type that draws
 *     something (`brightness contrast saturation exposure hueRotate blur
 *     highlights shadows sharpen`).
 *   · Overlay passes — `temperature tint vignette grain` — guarded by
 *     `clip.type !== 'text'`.
 *   · `adjustment` fills a fully transparent rect, so the filter string
 *     has nothing to act on and only the overlay passes mark the frame.
 *   · `audio` draws nothing.
 */
const CSS_AND_TONE: (keyof ClipFilters)[] = [
  'brightness', 'contrast', 'saturation', 'exposure',
  'hueRotate', 'blur', 'highlights', 'shadows', 'sharpen',
];
const OVERLAY: (keyof ClipFilters)[] = ['temperature', 'tint', 'vignette', 'grain'];

export function renderableFilters(type: ClipType): (keyof ClipFilters)[] {
  switch (type) {
    case 'audio':
      return [];
    case 'text':
      return [...CSS_AND_TONE];
    case 'adjustment':
      return [...OVERLAY];
    default:
      return [...CSS_AND_TONE, ...OVERLAY];
  }
}

/** Clip types a look is worth applying to unless the caller insists. */
const DEFAULT_GRADABLE: ClipType[] = ['video', 'image', 'sticker'];

/* ── Resolving a look onto one clip ─────────────────────────────── */

export interface LookResolution {
  /** Property paths and values to hand `patchClip`. */
  patch: Record<string, number>;
  /** Requested properties this clip type will not draw. */
  inertProperties: (keyof ClipFilters)[];
}

/**
 * Turn a preset into a concrete patch for one clip.
 *
 * `mode: 'replace'` writes ALL THIRTEEN filters — the preset's values
 * where it has an opinion, `DEFAULT_FILTERS` everywhere else. Writing only
 * the seven a look mentions leaves the other six wherever the last look
 * left them, so applying two looks in sequence produces a third thing that
 * matches neither and no call reports the difference.
 *
 * `mode: 'additive'` adds the preset's values to what is there, clamped by
 * the property schema at write time.
 */
export function resolveLook(
  preset: LookPreset,
  clip: Clip,
  opts: { strength: number; mode: 'replace' | 'additive' }
): LookResolution {
  const drawable = new Set(renderableFilters(clip.type));
  const patch: Record<string, number> = {};
  const inert: (keyof ClipFilters)[] = [];

  const keys = Object.keys(DEFAULT_FILTERS) as (keyof ClipFilters)[];
  for (const key of keys) {
    const target = preset.filters[key];
    const base = DEFAULT_FILTERS[key];

    if (opts.mode === 'additive') {
      if (target === undefined) continue;
      const current = clip.filters[key] ?? base;
      patch[`filters.${key}`] = round(current + (target - base) * opts.strength);
    } else {
      const value = target === undefined ? base : base + (target - base) * opts.strength;
      patch[`filters.${key}`] = round(value);
    }

    if (target !== undefined && target !== base && !drawable.has(key)) inert.push(key);
  }

  return { patch, inertProperties: inert };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/* ── Applying it across a set of clips ──────────────────────────── */

export interface LookTargetOutcome {
  clipId: string;
  name: string;
  type: ClipType;
  trackName: string;
  /** Paths whose value actually moved. */
  changed: { path: string; from: unknown; to: unknown }[];
  /** Paths already at the target value. */
  unchangedCount: number;
  /** Requested properties this clip type will not render. */
  inertProperties?: string[];
  warnings?: string[];
}

export type LookSkipCategory = 'clip-type' | 'draws-nothing' | 'locked-clip' | 'locked-track';

export interface LookSkip {
  clipId: string;
  name: string;
  type: ClipType;
  trackName: string;
  category: LookSkipCategory;
  reason: string;
}

export interface ApplyLookResult {
  preset: string;
  label: string;
  strength: number;
  mode: 'replace' | 'additive';
  /** The grade itself, so a caller can see exactly what landed. */
  filters: Record<string, number>;
  /** What must change in the rendered frame if this worked. */
  expect: LookExpectation[];
  appliedTo: number;
  clips: LookTargetOutcome[];
  skipped: LookSkip[];
  skippedSummary: Record<string, number>;
  notes: string[];
}

export interface ClipWithContext {
  clip: Clip;
  trackName: string;
  trackLocked: boolean;
}

/**
 * Apply a preset to a resolved set of clips.
 *
 * `patch` is injected so this module stays free of the store: it is the
 * store's `patchClip`, and it is the ONLY thing here that mutates.
 */
export function applyLookToClips(
  preset: LookPreset,
  candidates: ClipWithContext[],
  opts: {
    strength: number;
    mode: 'replace' | 'additive';
    includeLocked: boolean;
    gradableTypes?: ClipType[];
  },
  patch: (clipId: string, values: Record<string, unknown>) => {
    applied: string[];
    errors: string[];
    changes: { path: string; from: unknown; to: unknown }[];
  }
): ApplyLookResult {
  const gradable = new Set(opts.gradableTypes ?? DEFAULT_GRADABLE);
  const clips: LookTargetOutcome[] = [];
  const skipped: LookSkip[] = [];
  const notes: string[] = [];

  for (const { clip, trackName, trackLocked } of candidates) {
    const row = { clipId: clip.id, name: clip.name, type: clip.type, trackName };

    if (!gradable.has(clip.type)) {
      const drawable = renderableFilters(clip.type);
      const wanted = [...gradable].join('/');
      skipped.push({
        ...row,
        category: drawable.length === 0 ? 'draws-nothing' : 'clip-type',
        reason: drawable.length === 0
          ? `${clip.type} clips draw no picture, so a grade on this clip could never show`
          : opts.gradableTypes
            ? `is a ${clip.type} clip and you asked for ${wanted}`
            : `${clip.type} clips are not graded by default (the compositor draws only `
              + `${drawable.join(', ')} for them). Pass clipTypes: ["${clip.type}"] to include it anyway.`,
      });
      continue;
    }

    if (clip.locked && !opts.includeLocked) {
      skipped.push({ ...row, category: 'locked-clip',
        reason: 'clip is locked; pass includeLocked to grade it anyway' });
      continue;
    }
    if (trackLocked && !opts.includeLocked) {
      skipped.push({ ...row, category: 'locked-track',
        reason: `track "${trackName}" is locked; pass includeLocked to grade it anyway` });
      continue;
    }

    const { patch: values, inertProperties } = resolveLook(preset, clip, opts);
    const result = patch(clip.id, values);
    const changed = result.changes.filter((c) => !Object.is(c.from, c.to));

    clips.push({
      ...row,
      changed: changed.map((c) => ({ path: c.path, from: c.from, to: c.to })),
      unchangedCount: result.changes.length - changed.length,
      ...(inertProperties.length ? { inertProperties: inertProperties.map((k) => `filters.${k}`) } : {}),
      ...(result.errors.length ? { warnings: [...new Set(result.errors)] } : {}),
    });

    if (inertProperties.length) {
      notes.push(
        `"${clip.name}" is a ${clip.type} clip: ${inertProperties.map((k) => `filters.${k}`).join(', ')} `
        + 'were written but the compositor does not draw them for this clip type, so they will not show.'
      );
    }
  }

  const skippedSummary: Record<string, number> = {};
  for (const s of skipped) {
    skippedSummary[s.category] = (skippedSummary[s.category] ?? 0) + 1;
  }

  /* A reference resolution against a neutral clip, so the caller can see
     the grade itself rather than inferring it from per-clip diffs. */
  const reference: Record<string, number> = {};
  const keys = Object.keys(DEFAULT_FILTERS) as (keyof ClipFilters)[];
  for (const key of keys) {
    const target = preset.filters[key];
    const base = DEFAULT_FILTERS[key];
    const value = target === undefined ? base : base + (target - base) * opts.strength;
    if (value !== base || opts.mode === 'replace') reference[`filters.${key}`] = round(value);
  }

  return {
    preset: preset.id,
    label: preset.label,
    strength: opts.strength,
    mode: opts.mode,
    filters: reference,
    expect: preset.expect,
    appliedTo: clips.length,
    clips,
    skipped,
    skippedSummary,
    notes,
  };
}
