/* ═══════════════════════════════════════════════════════════════════
   VFX registry — every effect Kerf can apply, in one place.

   Each entry declares:
     • a typed parameter schema (drives the UI *and* validates AI calls)
     • an optional `pre`  hook: mutate the 2D context before the clip draws
     • an optional `post` hook: composite on top of the drawn clip

   Adding an effect here makes it instantly available in the Effects
   library, the inspector, the keyframe system, and the MCP tool surface —
   there is no per-effect UI or per-effect tool to write.
   ═══════════════════════════════════════════════════════════════════ */

import { ClipEffect, EffectCategory } from '../types/edl';

/* ── Parameter schema ───────────────────────────────────────────── */

export type ParamType = 'number' | 'color' | 'boolean' | 'select' | 'angle';

export interface EffectParam {
  key: string;
  label: string;
  type: ParamType;
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  /** Can this parameter be keyframed? */
  animatable?: boolean;
  hint?: string;
}

/** Everything a render hook needs, in clip-local coordinates. */
export interface EffectRenderContext {
  ctx: CanvasRenderingContext2D;
  /** Clip box dimensions in canvas px (origin is the box centre). */
  width: number;
  height: number;
  /** Milliseconds since the clip started. */
  offsetMs: number;
  /** 0..1 through the clip. */
  progress: number;
  /** Resolved parameter values, with keyframes already applied. */
  params: Record<string, any>;
  /** Global wet/dry for the whole effect, 0..1. */
  intensity: number;
  /** Deterministic PRNG seeded on the clip — safe for frame-accurate render. */
  random: (n: number) => number;
}

export interface EffectDefinition {
  type: string;
  label: string;
  category: EffectCategory;
  description: string;
  params: EffectParam[];
  /** Runs before the clip's pixels are drawn (filters, transforms, clips). */
  pre?: (rc: EffectRenderContext) => void;
  /** Runs after the clip's pixels are drawn (overlays, glows, particles). */
  post?: (rc: EffectRenderContext) => void;
  /** Effects that only make sense on certain clip types. */
  appliesTo?: ('video' | 'image' | 'text' | 'shape' | 'audio' | 'adjustment')[];
  /**
   * Runs as a fragment shader over the clip's own pixels instead of as a
   * 2D hook. Named here rather than implemented here, because the GPU
   * needs the clip rendered in isolation first — the compositor's layered
   * path is the only place that exists. The registry stays the single
   * catalogue either way, so `list_effects` needs no special case.
   *
   * A machine with no WebGL renders the clip unshaded rather than failing.
   */
  gpu?:
    | 'chroma_key'
    | 'displace'
    /* Mesh warps. These move GEOMETRY, not texture reads — the stage
       draws a subdivided grid for them instead of one quad. */
    | 'page_curl'
    | 'flag_wave'
    | 'ripple';
}

/* ── Small drawing helpers ──────────────────────────────────────── */

const fillFrame = (rc: EffectRenderContext, style: string | CanvasGradient, alpha = 1) => {
  const { ctx, width, height } = rc;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = style;
  ctx.fillRect(-width / 2, -height / 2, width, height);
  ctx.restore();
};

const withComposite = (
  rc: EffectRenderContext,
  mode: GlobalCompositeOperation,
  draw: () => void
) => {
  const { ctx } = rc;
  const prevOp = ctx.globalCompositeOperation;
  const prevAlpha = ctx.globalAlpha;
  ctx.globalCompositeOperation = mode;
  draw();
  ctx.globalCompositeOperation = prevOp;
  ctx.globalAlpha = prevAlpha;
};

const hexToRgb = (hex: string): [number, number, number] => {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
};

export const rgba = (hex: string, alpha: number): string => {
  const [r, g, b] = hexToRgb(hex || '#ffffff');
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
};

/* ── The registry ───────────────────────────────────────────────── */

export const EFFECT_REGISTRY: EffectDefinition[] = [
  /* ══ STYLIZE ══ */
  {
    type: 'glow',
    label: 'Anamorphic Glow',
    category: 'light',
    description: 'Diffused highlight bloom with an optional horizontal streak.',
    params: [
      { key: 'radius', label: 'Bloom radius', type: 'number', default: 28, min: 0, max: 120, step: 1, unit: 'px', animatable: true },
      { key: 'threshold', label: 'Threshold', type: 'number', default: 55, min: 0, max: 100, step: 1, unit: '%', animatable: true },
      { key: 'tint', label: 'Bloom tint', type: 'color', default: '#8fc4ff' },
      { key: 'streak', label: 'Horizontal streak', type: 'number', default: 0.4, min: 0, max: 1, step: 0.01, animatable: true },
    ],
    post: (rc) => {
      const { ctx, width, height, params, intensity } = rc;
      const amount = (params.radius / 120) * intensity;
      if (amount <= 0.001) return;

      withComposite(rc, 'lighter', () => {
        ctx.save();
        ctx.filter = `blur(${params.radius}px) brightness(${1 + params.threshold / 120})`;
        ctx.globalAlpha = amount * 0.55;
        ctx.fillStyle = rgba(params.tint, 0.5);
        ctx.fillRect(-width / 2, -height / 2, width, height);
        ctx.restore();

        if (params.streak > 0.01) {
          const grad = ctx.createLinearGradient(-width / 2, 0, width / 2, 0);
          grad.addColorStop(0, rgba(params.tint, 0));
          grad.addColorStop(0.5, rgba(params.tint, 0.35 * params.streak * intensity));
          grad.addColorStop(1, rgba(params.tint, 0));
          ctx.save();
          ctx.filter = `blur(${params.radius * 0.6}px)`;
          ctx.fillStyle = grad;
          ctx.fillRect(-width / 2, -height * 0.06, width, height * 0.12);
          ctx.restore();
        }
      });
    },
  },

  {
    type: 'rgb_split',
    label: 'RGB Split',
    category: 'distort',
    description: 'Chromatic aberration, offsets the red and cyan channels.',
    params: [
      { key: 'offset', label: 'Offset', type: 'number', default: 8, min: 0, max: 80, step: 0.5, unit: 'px', animatable: true },
      { key: 'angle', label: 'Direction', type: 'angle', default: 0, min: -180, max: 180, step: 1, unit: '°', animatable: true },
      { key: 'wobble', label: 'Wobble', type: 'number', default: 0, min: 0, max: 1, step: 0.01, animatable: true },
    ],
    post: (rc) => {
      const { ctx, width, height, params, intensity, progress } = rc;
      const wob = params.wobble > 0 ? Math.sin(progress * Math.PI * 12) * params.wobble : 0;
      const dist = (params.offset + wob * params.offset) * intensity;
      if (dist < 0.2) return;

      const rad = (params.angle * Math.PI) / 180;
      const dx = Math.cos(rad) * dist;
      const dy = Math.sin(rad) * dist;

      withComposite(rc, 'screen', () => {
        ctx.globalAlpha = 0.42 * intensity;
        ctx.fillStyle = 'rgba(255,40,40,1)';
        ctx.fillRect(-width / 2 + dx, -height / 2 + dy, width, height);
        ctx.fillStyle = 'rgba(40,240,255,1)';
        ctx.fillRect(-width / 2 - dx, -height / 2 - dy, width, height);
      });
    },
  },

  {
    type: 'film_grain',
    label: '35mm Film Grain',
    category: 'stylize',
    description: 'Animated analogue grain with adjustable size and colour noise.',
    params: [
      { key: 'amount', label: 'Amount', type: 'number', default: 35, min: 0, max: 100, step: 1, unit: '%', animatable: true },
      { key: 'size', label: 'Grain size', type: 'number', default: 1, min: 0.5, max: 4, step: 0.1, unit: 'px' },
      { key: 'colored', label: 'Colour noise', type: 'boolean', default: false },
    ],
    post: (rc) => {
      const { ctx, width, height, params, intensity, random, offsetMs } = rc;
      const alpha = (params.amount / 100) * intensity * 0.5;
      if (alpha <= 0.002) return;

      withComposite(rc, 'overlay', () => {
        ctx.globalAlpha = alpha;
        const step = Math.max(1, params.size * 2);
        const frame = Math.floor(offsetMs / 33);
        const cols = Math.ceil(width / step);
        const rows = Math.ceil(height / step);
        // Cap the work so grain never tanks the frame budget.
        const maxCells = 9000;
        const stride = Math.max(1, Math.ceil((cols * rows) / maxCells));

        for (let i = 0; i < cols * rows; i += stride) {
          const n = random(i + frame * 7919);
          if (n < 0.55) continue;
          const cx = (i % cols) * step - width / 2;
          const cy = Math.floor(i / cols) * step - height / 2;
          const v = Math.floor(n * 255);
          ctx.fillStyle = params.colored
            ? `rgb(${v},${Math.floor(random(i + 1) * 255)},${Math.floor(random(i + 2) * 255)})`
            : `rgb(${v},${v},${v})`;
          ctx.fillRect(cx, cy, params.size, params.size);
        }
      });
    },
  },

  {
    type: 'scanlines',
    label: 'CRT Scanlines',
    category: 'stylize',
    description: 'Retro monitor scanlines with rolling interference.',
    params: [
      { key: 'spacing', label: 'Line spacing', type: 'number', default: 4, min: 2, max: 24, step: 1, unit: 'px' },
      { key: 'opacity', label: 'Darkness', type: 'number', default: 30, min: 0, max: 100, step: 1, unit: '%', animatable: true },
      { key: 'roll', label: 'Roll speed', type: 'number', default: 0.5, min: 0, max: 4, step: 0.1, animatable: true },
    ],
    post: (rc) => {
      const { ctx, width, height, params, intensity, offsetMs } = rc;
      const alpha = (params.opacity / 100) * intensity;
      if (alpha <= 0.002) return;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#000000';
      const offset = (offsetMs * params.roll * 0.05) % params.spacing;
      for (let y = -height / 2 + offset; y < height / 2; y += params.spacing) {
        ctx.fillRect(-width / 2, y, width, Math.max(1, params.spacing / 2.5));
      }
      ctx.restore();
    },
  },

  {
    type: 'vhs',
    label: 'VHS Tape',
    category: 'stylize',
    description: 'Tracking bars, colour bleed and tape warble.',
    params: [
      { key: 'tracking', label: 'Tracking error', type: 'number', default: 0.4, min: 0, max: 1, step: 0.01, animatable: true },
      { key: 'bleed', label: 'Colour bleed', type: 'number', default: 0.35, min: 0, max: 1, step: 0.01, animatable: true },
      { key: 'noise', label: 'Tape noise', type: 'number', default: 0.25, min: 0, max: 1, step: 0.01, animatable: true },
    ],
    post: (rc) => {
      const { ctx, width, height, params, intensity, offsetMs, random } = rc;

      if (params.bleed > 0.01) {
        withComposite(rc, 'screen', () => {
          ctx.globalAlpha = params.bleed * 0.3 * intensity;
          ctx.fillStyle = 'rgba(255,0,120,1)';
          ctx.fillRect(-width / 2 + 3, -height / 2, width, height);
          ctx.fillStyle = 'rgba(0,220,255,1)';
          ctx.fillRect(-width / 2 - 3, -height / 2, width, height);
        });
      }

      if (params.tracking > 0.01) {
        // A couple of displaced bands that drift down the frame.
        const bands = 3;
        for (let i = 0; i < bands; i++) {
          const seed = random(i * 31 + Math.floor(offsetMs / 120));
          if (seed < 0.55) continue;
          const bandY = ((offsetMs * 0.06 + i * height / bands) % height) - height / 2;
          const bandH = 4 + seed * 22 * params.tracking;
          ctx.save();
          ctx.globalAlpha = 0.5 * params.tracking * intensity;
          ctx.fillStyle = `rgba(255,255,255,${0.06 + seed * 0.1})`;
          ctx.fillRect(-width / 2, bandY, width, bandH);
          ctx.restore();
        }
      }

      if (params.noise > 0.01) {
        withComposite(rc, 'overlay', () => {
          ctx.globalAlpha = params.noise * 0.3 * intensity;
          for (let i = 0; i < 260; i++) {
            const n = random(i + Math.floor(offsetMs / 40) * 131);
            ctx.fillStyle = `rgba(255,255,255,${n * 0.5})`;
            ctx.fillRect(
              (random(i * 3) - 0.5) * width,
              (random(i * 7) - 0.5) * height,
              random(i * 11) * 18,
              1
            );
          }
        });
      }
    },
  },

  {
    type: 'halftone',
    label: 'Halftone Print',
    category: 'stylize',
    description: 'Newsprint dot screen at an adjustable angle.',
    params: [
      { key: 'dotSize', label: 'Dot size', type: 'number', default: 6, min: 2, max: 28, step: 1, unit: 'px' },
      { key: 'angle', label: 'Screen angle', type: 'angle', default: 45, min: 0, max: 90, step: 1, unit: '°' },
      { key: 'contrast', label: 'Contrast', type: 'number', default: 60, min: 0, max: 100, step: 1, unit: '%', animatable: true },
    ],
    post: (rc) => {
      const { ctx, width, height, params, intensity } = rc;
      const alpha = (params.contrast / 100) * intensity * 0.6;
      if (alpha <= 0.002) return;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = 'multiply';
      ctx.rotate((params.angle * Math.PI) / 180);
      ctx.fillStyle = '#000000';
      const step = params.dotSize;
      const span = Math.max(width, height) * 1.5;
      for (let y = -span / 2; y < span / 2; y += step) {
        for (let x = -span / 2; x < span / 2; x += step) {
          ctx.beginPath();
          ctx.arc(x, y, step * 0.26, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    },
  },

  {
    type: 'displace',
    label: 'Displacement',
    category: 'distort',
    description:
      'Warps the image through a moving noise field. Heat haze, glass, water, liquid ' +
      'melt. Runs on the GPU; needs WebGL, and renders unwarped without it.',
    params: [
      { key: 'amount', label: 'Amount', type: 'number', default: 24, min: 0, max: 100, step: 1, animatable: true },
      { key: 'scale', label: 'Detail', type: 'number', default: 14, min: 1, max: 80, step: 1, animatable: true },
      { key: 'speed', label: 'Speed', type: 'number', default: 40, min: 0, max: 100, step: 1, animatable: true },
      { key: 'angle', label: 'Direction', type: 'number', default: 0, min: 0, max: 360, step: 1, unit: '°', animatable: true },
    ],
    gpu: 'displace',
  },

  /* ══ MESH WARPS ══
     Everything above runs a fragment program over a flat quad, which is
     why `NEXT.md` listed these three as out of reach rather than as
     unwritten: a page curl is a shape, not a colour. The stage draws a
     subdivided mesh for them and their vertex programs move it. Like
     every other GPU effect here, a machine with no WebGL renders the
     clip unwarped rather than failing. */

  {
    type: 'page_curl',
    label: 'Page Curl',
    category: 'distort',
    description:
      'Peels the clip off the frame like a page, curling it around a cylinder and showing ' +
      'its reverse. Keyframe "progress" 0 → 100 over a clip sitting on top of another and ' +
      'the curl becomes a transition that reveals what is underneath. Runs on the GPU as a ' +
      'displaced mesh; needs WebGL, and renders flat without it.',
    params: [
      { key: 'progress', label: 'Progress', type: 'number', default: 0, min: 0, max: 100, step: 0.5, unit: '%', animatable: true,
        hint: 'How far the page has turned. 0 is untouched; 100 has it clear of the frame.' },
      { key: 'angle', label: 'Direction', type: 'number', default: 315, min: 0, max: 360, step: 1, unit: '°', animatable: true,
        hint: 'Which way the curl travels, measured y-UP: 0° peels the right edge, 90° the top, 315° the classic bottom-right corner.' },
      { key: 'radius', label: 'Curl radius', type: 'number', default: 12, min: 1, max: 40, step: 0.5, unit: '%', animatable: true,
        hint: 'As a share of frame height. Small is a tight roll, large is a lazy fold.' },
      { key: 'shading', label: 'Shading', type: 'number', default: 70, min: 0, max: 100, step: 1, unit: '%', animatable: true,
        hint: 'Light across the curl, from the surface normal. 0 leaves brightness exactly as it was.' },
      { key: 'backColor', label: 'Reverse', type: 'color', default: '#efece5' },
      { key: 'backShow', label: 'Show-through', type: 'number', default: 12, min: 0, max: 100, step: 1, unit: '%', animatable: true,
        hint: 'How much of the print reads through the back of the page.' },
    ],
    gpu: 'page_curl',
  },

  {
    type: 'flag_wave',
    label: 'Flag Wave',
    category: 'distort',
    description:
      'Waves the clip like cloth on a pole. A travelling wave lifts the sheet out of the ' +
      'plane, and the light across it comes from the surface slope rather than a painted ' +
      'gradient. Runs on the GPU as a displaced mesh.',
    params: [
      { key: 'amount', label: 'Amount', type: 'number', default: 30, min: 0, max: 100, step: 1, unit: '%', animatable: true },
      { key: 'waves', label: 'Waves', type: 'number', default: 2, min: 0.25, max: 12, step: 0.25, animatable: true,
        hint: 'How many crests fit across the frame along the direction.' },
      { key: 'speed', label: 'Speed', type: 'number', default: 45, min: 0, max: 100, step: 1, animatable: true,
        hint: '0 freezes the wave. It still warps, it just stops moving.' },
      { key: 'angle', label: 'Direction', type: 'number', default: 0, min: 0, max: 360, step: 1, unit: '°', animatable: true },
      { key: 'anchor', label: 'Pin edge', type: 'number', default: 100, min: 0, max: 100, step: 1, unit: '%', animatable: true,
        hint: '100 pins the leading edge like a flagpole; 0 lets the whole sheet move.' },
      { key: 'shading', label: 'Shading', type: 'number', default: 70, min: 0, max: 100, step: 1, unit: '%', animatable: true },
    ],
    gpu: 'flag_wave',
  },

  {
    type: 'ripple',
    label: 'Ripple',
    category: 'distort',
    description:
      'Rings spreading from a point, pushing the image outward along the radius. Because it ' +
      'moves the mesh and not the texture read, the EDGE of the picture ripples too and ' +
      'pixels land outside the rectangle they started in. Which is the difference from ' +
      'Displacement. Runs on the GPU as a displaced mesh.',
    params: [
      { key: 'amount', label: 'Amount', type: 'number', default: 35, min: 0, max: 100, step: 1, unit: '%', animatable: true },
      { key: 'rings', label: 'Rings', type: 'number', default: 4, min: 0.25, max: 20, step: 0.25, animatable: true },
      { key: 'speed', label: 'Speed', type: 'number', default: 50, min: 0, max: 100, step: 1, animatable: true,
        hint: '0 freezes the rings where they are.' },
      { key: 'centerX', label: 'Centre X', type: 'number', default: 50, min: 0, max: 100, step: 1, unit: '%', animatable: true },
      { key: 'centerY', label: 'Centre Y', type: 'number', default: 50, min: 0, max: 100, step: 1, unit: '%', animatable: true,
        hint: 'Measured y-UP: 0 is the bottom of the frame.' },
      { key: 'falloff', label: 'Falloff', type: 'number', default: 35, min: 0, max: 100, step: 1, unit: '%', animatable: true,
        hint: 'How fast the rings die away from the centre. 0 carries them to the edge.' },
      { key: 'shading', label: 'Shading', type: 'number', default: 60, min: 0, max: 100, step: 1, unit: '%', animatable: true },
    ],
    gpu: 'ripple',
  },

  {
    type: 'pixelate',
    label: 'Pixelate',
    category: 'distort',
    description: 'Mosaic blocks, good for censoring or a retro look.',
    params: [
      { key: 'size', label: 'Block size', type: 'number', default: 16, min: 2, max: 120, step: 1, unit: 'px', animatable: true },
    ],
    pre: (rc) => {
      // Approximated with a blur so it composites without a pixel readback.
      rc.ctx.filter = `${rc.ctx.filter === 'none' ? '' : rc.ctx.filter} blur(${(rc.params.size / 4) * rc.intensity}px)`.trim();
    },
    post: (rc) => {
      const { ctx, width, height, params, intensity } = rc;
      if (intensity < 0.05) return;
      ctx.save();
      ctx.globalAlpha = 0.16 * intensity;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      for (let x = -width / 2; x < width / 2; x += params.size) {
        ctx.beginPath(); ctx.moveTo(x, -height / 2); ctx.lineTo(x, height / 2); ctx.stroke();
      }
      for (let y = -height / 2; y < height / 2; y += params.size) {
        ctx.beginPath(); ctx.moveTo(-width / 2, y); ctx.lineTo(width / 2, y); ctx.stroke();
      }
      ctx.restore();
    },
  },

  /* ══ BLUR ══ */
  {
    type: 'gaussian_blur',
    label: 'Gaussian Blur',
    category: 'blur',
    description: 'Clean symmetrical blur.',
    params: [
      { key: 'radius', label: 'Radius', type: 'number', default: 8, min: 0, max: 80, step: 0.5, unit: 'px', animatable: true },
    ],
    pre: (rc) => {
      const r = rc.params.radius * rc.intensity;
      if (r > 0.1) rc.ctx.filter = `${rc.ctx.filter === 'none' ? '' : rc.ctx.filter} blur(${r}px)`.trim();
    },
  },

  {
    type: 'radial_blur',
    label: 'Radial Zoom Blur',
    category: 'blur',
    description: 'Zoom-streak blur radiating from the centre.',
    params: [
      { key: 'amount', label: 'Amount', type: 'number', default: 0.35, min: 0, max: 1, step: 0.01, animatable: true },
      { key: 'samples', label: 'Samples', type: 'number', default: 8, min: 3, max: 20, step: 1 },
    ],
    post: (rc) => {
      const { ctx, width, height, params, intensity } = rc;
      const amount = params.amount * intensity;
      if (amount < 0.01) return;

      withComposite(rc, 'lighter', () => {
        const steps = Math.round(params.samples);
        for (let i = 1; i <= steps; i++) {
          const s = 1 + (i / steps) * amount * 0.5;
          ctx.save();
          ctx.globalAlpha = (amount * 0.35) / steps;
          ctx.scale(s, s);
          ctx.filter = `blur(${i * 0.6}px)`;
          ctx.fillStyle = 'rgba(255,255,255,0.10)';
          ctx.fillRect(-width / 2, -height / 2, width, height);
          ctx.restore();
        }
      });
    },
  },

  {
    type: 'directional_blur',
    label: 'Directional Blur',
    category: 'blur',
    description: 'Motion-streak blur along a chosen angle.',
    params: [
      { key: 'length', label: 'Length', type: 'number', default: 20, min: 0, max: 160, step: 1, unit: 'px', animatable: true },
      { key: 'angle', label: 'Angle', type: 'angle', default: 0, min: -180, max: 180, step: 1, unit: '°', animatable: true },
    ],
    post: (rc) => {
      const { ctx, width, height, params, intensity } = rc;
      const len = params.length * intensity;
      if (len < 0.5) return;
      const rad = (params.angle * Math.PI) / 180;

      withComposite(rc, 'lighter', () => {
        const steps = 6;
        for (let i = 1; i <= steps; i++) {
          const d = (len * i) / steps;
          ctx.save();
          ctx.globalAlpha = 0.1 * intensity;
          ctx.filter = `blur(${d * 0.25}px)`;
          ctx.translate(Math.cos(rad) * d, Math.sin(rad) * d);
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(-width / 2, -height / 2, width, height);
          ctx.restore();
        }
      });
    },
  },

  /* ══ LIGHT ══ */
  {
    type: 'light_leak',
    label: 'Light Leak',
    category: 'light',
    description: 'Warm analogue flare sweeping across the frame.',
    params: [
      { key: 'color', label: 'Leak colour', type: 'color', default: '#ff9a4d' },
      { key: 'position', label: 'Position', type: 'number', default: 0.2, min: 0, max: 1, step: 0.01, animatable: true },
      { key: 'spread', label: 'Spread', type: 'number', default: 0.55, min: 0.05, max: 1, step: 0.01, animatable: true },
      { key: 'drift', label: 'Drift', type: 'number', default: 0.3, min: 0, max: 1, step: 0.01, animatable: true },
    ],
    post: (rc) => {
      const { ctx, width, height, params, intensity, progress } = rc;
      const pos = params.position + progress * params.drift;
      const x = (-0.5 + (pos % 1)) * width;

      withComposite(rc, 'screen', () => {
        const grad = ctx.createRadialGradient(x, -height * 0.2, 0, x, -height * 0.2, width * params.spread);
        grad.addColorStop(0, rgba(params.color, 0.55 * intensity));
        grad.addColorStop(0.4, rgba(params.color, 0.22 * intensity));
        grad.addColorStop(1, rgba(params.color, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(-width / 2, -height / 2, width, height);
      });
    },
  },

  {
    type: 'godrays',
    label: 'God Rays',
    category: 'light',
    description: 'Volumetric light shafts from an adjustable source point.',
    params: [
      { key: 'x', label: 'Source X', type: 'number', default: 0, min: -1, max: 1, step: 0.01, animatable: true },
      { key: 'y', label: 'Source Y', type: 'number', default: -0.4, min: -1, max: 1, step: 0.01, animatable: true },
      { key: 'rays', label: 'Ray count', type: 'number', default: 12, min: 3, max: 40, step: 1 },
      { key: 'length', label: 'Length', type: 'number', default: 0.8, min: 0.1, max: 2, step: 0.01, animatable: true },
      { key: 'color', label: 'Colour', type: 'color', default: '#fff4d6' },
    ],
    post: (rc) => {
      const { ctx, width, height, params, intensity, progress } = rc;
      const sx = params.x * width * 0.5;
      const sy = params.y * height * 0.5;
      const reach = Math.max(width, height) * params.length;

      withComposite(rc, 'screen', () => {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(progress * 0.12);
        const count = Math.round(params.rays);
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2;
          const spread = (Math.PI / count) * 0.55;
          ctx.globalAlpha = 0.1 * intensity;
          const grad = ctx.createLinearGradient(0, 0, Math.cos(angle) * reach, Math.sin(angle) * reach);
          grad.addColorStop(0, rgba(params.color, 0.6));
          grad.addColorStop(1, rgba(params.color, 0));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, reach, angle - spread, angle + spread);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      });
    },
  },

  {
    type: 'lens_flare',
    label: 'Lens Flare',
    category: 'light',
    description: 'Anamorphic flare with ghost elements along the optical axis.',
    params: [
      { key: 'x', label: 'Position X', type: 'number', default: 0.3, min: -1, max: 1, step: 0.01, animatable: true },
      { key: 'y', label: 'Position Y', type: 'number', default: -0.3, min: -1, max: 1, step: 0.01, animatable: true },
      { key: 'size', label: 'Size', type: 'number', default: 0.35, min: 0.05, max: 1.5, step: 0.01, animatable: true },
      { key: 'color', label: 'Colour', type: 'color', default: '#9fd4ff' },
      { key: 'ghosts', label: 'Ghost count', type: 'number', default: 4, min: 0, max: 8, step: 1 },
    ],
    post: (rc) => {
      const { ctx, width, height, params, intensity } = rc;
      const px = params.x * width * 0.5;
      const py = params.y * height * 0.5;
      const radius = Math.max(width, height) * params.size * 0.35;

      withComposite(rc, 'screen', () => {
        const core = ctx.createRadialGradient(px, py, 0, px, py, radius);
        core.addColorStop(0, rgba('#ffffff', 0.85 * intensity));
        core.addColorStop(0.25, rgba(params.color, 0.4 * intensity));
        core.addColorStop(1, rgba(params.color, 0));
        ctx.fillStyle = core;
        ctx.fillRect(-width / 2, -height / 2, width, height);

        // Horizontal anamorphic streak.
        const streak = ctx.createLinearGradient(-width / 2, py, width / 2, py);
        streak.addColorStop(0, rgba(params.color, 0));
        streak.addColorStop(0.5, rgba(params.color, 0.3 * intensity));
        streak.addColorStop(1, rgba(params.color, 0));
        ctx.fillStyle = streak;
        ctx.fillRect(-width / 2, py - radius * 0.06, width, radius * 0.12);

        // Ghosts march back through the optical centre.
        for (let i = 1; i <= params.ghosts; i++) {
          const t = -i / (params.ghosts + 1);
          const gx = px * t * 1.6;
          const gy = py * t * 1.6;
          const gr = radius * (0.18 + i * 0.05);
          const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
          g.addColorStop(0, rgba(params.color, 0.16 * intensity));
          g.addColorStop(1, rgba(params.color, 0));
          ctx.fillStyle = g;
          ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
        }
      });
    },
  },

  {
    type: 'vignette',
    label: 'Vignette',
    category: 'light',
    description: 'Darkens (or lifts) the frame edges.',
    params: [
      { key: 'amount', label: 'Amount', type: 'number', default: 45, min: -100, max: 100, step: 1, unit: '%', animatable: true },
      { key: 'feather', label: 'Feather', type: 'number', default: 0.5, min: 0.05, max: 1, step: 0.01 },
      { key: 'roundness', label: 'Roundness', type: 'number', default: 0.6, min: 0, max: 1, step: 0.01 },
    ],
    post: (rc) => {
      const { ctx, width, height, params, intensity } = rc;
      const amount = (params.amount / 100) * intensity;
      if (Math.abs(amount) < 0.01) return;

      const outer = Math.max(width, height) * (0.5 + params.roundness * 0.35);
      const inner = outer * (1 - params.feather);
      const grad = ctx.createRadialGradient(0, 0, inner, 0, 0, outer);
      const color = amount > 0 ? '0,0,0' : '255,255,255';
      grad.addColorStop(0, `rgba(${color},0)`);
      grad.addColorStop(1, `rgba(${color},${Math.abs(amount)})`);
      fillFrame(rc, grad);
    },
  },

  /* ══ COLOR ══ */
  {
    type: 'duotone',
    label: 'Duotone',
    category: 'color',
    description: 'Maps luminance onto two brand colours.',
    params: [
      { key: 'shadow', label: 'Shadow colour', type: 'color', default: '#12203f' },
      { key: 'highlight', label: 'Highlight colour', type: 'color', default: '#ff8ab3' },
      { key: 'mix', label: 'Mix', type: 'number', default: 80, min: 0, max: 100, step: 1, unit: '%', animatable: true },
    ],
    pre: (rc) => {
      const mix = (rc.params.mix / 100) * rc.intensity;
      if (mix > 0.05) {
        rc.ctx.filter = `${rc.ctx.filter === 'none' ? '' : rc.ctx.filter} grayscale(${mix})`.trim();
      }
    },
    post: (rc) => {
      const { ctx, width, height, params, intensity } = rc;
      const mix = (params.mix / 100) * intensity;
      if (mix < 0.02) return;

      withComposite(rc, 'lighten', () => {
        ctx.globalAlpha = mix;
        ctx.fillStyle = params.shadow;
        ctx.fillRect(-width / 2, -height / 2, width, height);
      });
      withComposite(rc, 'multiply', () => {
        ctx.globalAlpha = mix;
        ctx.fillStyle = params.highlight;
        ctx.fillRect(-width / 2, -height / 2, width, height);
      });
    },
  },

  {
    type: 'color_wash',
    label: 'Colour Wash',
    category: 'color',
    description: 'Blends a flat colour over the clip in any blend mode.',
    params: [
      { key: 'color', label: 'Colour', type: 'color', default: '#4c9dff' },
      { key: 'opacity', label: 'Opacity', type: 'number', default: 30, min: 0, max: 100, step: 1, unit: '%', animatable: true },
      {
        key: 'blend', label: 'Blend mode', type: 'select', default: 'overlay',
        options: [
          { value: 'overlay', label: 'Overlay' },
          { value: 'multiply', label: 'Multiply' },
          { value: 'screen', label: 'Screen' },
          { value: 'soft-light', label: 'Soft Light' },
          { value: 'color', label: 'Colour' },
          { value: 'hue', label: 'Hue' },
        ],
      },
    ],
    post: (rc) => {
      const alpha = (rc.params.opacity / 100) * rc.intensity;
      if (alpha < 0.01) return;
      withComposite(rc, rc.params.blend as GlobalCompositeOperation, () => {
        rc.ctx.globalAlpha = alpha;
        rc.ctx.fillStyle = rc.params.color;
        rc.ctx.fillRect(-rc.width / 2, -rc.height / 2, rc.width, rc.height);
      });
    },
  },

  /* ══ GENERATE / PARTICLES ══ */
  {
    type: 'particles',
    label: 'Particles',
    category: 'generate',
    description: 'Drifting particle field, snow, embers, dust or bokeh.',
    params: [
      {
        key: 'preset', label: 'Look', type: 'select', default: 'dust',
        options: [
          { value: 'dust', label: 'Dust motes' },
          { value: 'snow', label: 'Snow' },
          { value: 'embers', label: 'Embers' },
          { value: 'bokeh', label: 'Bokeh' },
          { value: 'sparks', label: 'Sparks' },
        ],
      },
      { key: 'count', label: 'Count', type: 'number', default: 80, min: 5, max: 400, step: 5, animatable: true },
      { key: 'size', label: 'Size', type: 'number', default: 3, min: 0.5, max: 24, step: 0.5, unit: 'px', animatable: true },
      { key: 'speed', label: 'Speed', type: 'number', default: 0.4, min: 0, max: 3, step: 0.05, animatable: true },
      { key: 'color', label: 'Colour', type: 'color', default: '#ffffff' },
      { key: 'angle', label: 'Drift angle', type: 'angle', default: 90, min: -180, max: 180, step: 1, unit: '°' },
    ],
    post: (rc) => {
      const { ctx, width, height, params, intensity, offsetMs, random } = rc;
      const count = Math.round(params.count * intensity);
      if (count <= 0) return;

      const preset = params.preset as string;
      const rad = (params.angle * Math.PI) / 180;
      const driftX = Math.cos(rad) * params.speed;
      const driftY = Math.sin(rad) * params.speed;
      const t = offsetMs * 0.06;

      withComposite(rc, preset === 'embers' || preset === 'sparks' ? 'lighter' : 'source-over', () => {
        for (let i = 0; i < count; i++) {
          // Each particle has a fixed seed, so motion is deterministic.
          const seedX = random(i * 2 + 1);
          const seedY = random(i * 2 + 2);
          const seedS = random(i * 2 + 3);

          // Wrap the field so particles recycle instead of running out.
          const x = (((seedX * width + driftX * t) % width) + width) % width - width / 2;
          const y = (((seedY * height + driftY * t) % height) + height) % height - height / 2;

          const wobble = preset === 'snow' || preset === 'dust'
            ? Math.sin(t * 0.05 + i) * 8
            : 0;

          const size = params.size * (0.4 + seedS * 0.9);
          const alpha = (0.25 + seedS * 0.6) * intensity;

          ctx.globalAlpha = alpha;

          if (preset === 'bokeh') {
            const g = ctx.createRadialGradient(x + wobble, y, 0, x + wobble, y, size * 3);
            g.addColorStop(0, rgba(params.color, 0.5));
            g.addColorStop(0.7, rgba(params.color, 0.16));
            g.addColorStop(1, rgba(params.color, 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x + wobble, y, size * 3, 0, Math.PI * 2);
            ctx.fill();
          } else if (preset === 'sparks') {
            ctx.strokeStyle = rgba(params.color, alpha);
            ctx.lineWidth = Math.max(0.6, size * 0.35);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - driftX * 14, y - driftY * 14);
            ctx.stroke();
          } else {
            ctx.fillStyle = preset === 'embers'
              ? rgba(seedS > 0.6 ? '#ffd08a' : params.color, alpha)
              : rgba(params.color, alpha);
            ctx.beginPath();
            ctx.arc(x + wobble, y, size, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });
    },
  },

  {
    type: 'shake',
    label: 'Camera Shake',
    category: 'motion',
    description: 'Procedural handheld or impact shake applied to the layer.',
    params: [
      { key: 'amplitude', label: 'Amplitude', type: 'number', default: 12, min: 0, max: 120, step: 1, unit: 'px', animatable: true },
      { key: 'frequency', label: 'Frequency', type: 'number', default: 12, min: 0.5, max: 40, step: 0.5, unit: 'Hz', animatable: true },
      { key: 'rotation', label: 'Roll', type: 'number', default: 0.6, min: 0, max: 8, step: 0.1, unit: '°', animatable: true },
      { key: 'decay', label: 'Decay', type: 'number', default: 0, min: 0, max: 1, step: 0.01, hint: 'Fade the shake out over the clip' },
    ],
    pre: (rc) => {
      const { ctx, params, intensity, offsetMs, progress } = rc;
      const falloff = params.decay > 0 ? Math.pow(1 - progress, params.decay * 4) : 1;
      const amp = params.amplitude * intensity * falloff;
      if (amp < 0.1) return;

      const t = (offsetMs / 1000) * params.frequency;
      // Two incommensurate sines read as noise without needing a PRNG.
      const dx = (Math.sin(t * 6.28) + Math.sin(t * 9.91) * 0.6) * amp * 0.5;
      const dy = (Math.cos(t * 5.13) + Math.cos(t * 11.7) * 0.6) * amp * 0.5;
      const roll = Math.sin(t * 4.4) * params.rotation * intensity * falloff;

      ctx.translate(dx, dy);
      ctx.rotate((roll * Math.PI) / 180);
    },
  },

  {
    type: 'zoom_pulse',
    label: 'Beat Zoom Pulse',
    category: 'motion',
    description: 'Rhythmic scale pump, lock the BPM to your track.',
    params: [
      { key: 'bpm', label: 'BPM', type: 'number', default: 120, min: 40, max: 220, step: 1 },
      { key: 'depth', label: 'Depth', type: 'number', default: 0.06, min: 0, max: 0.6, step: 0.005, animatable: true },
      { key: 'sharpness', label: 'Sharpness', type: 'number', default: 3, min: 1, max: 12, step: 0.5, hint: 'Higher = snappier attack' },
    ],
    pre: (rc) => {
      const { ctx, params, intensity, offsetMs } = rc;
      const beatMs = 60000 / params.bpm;
      const phase = (offsetMs % beatMs) / beatMs;
      // Sharp attack, exponential release.
      const env = Math.pow(1 - phase, params.sharpness);
      const scale = 1 + env * params.depth * intensity;
      ctx.scale(scale, scale);
    },
  },

  {
    type: 'mirror',
    label: 'Mirror / Kaleidoscope',
    category: 'distort',
    description: 'Reflects the frame across an axis.',
    params: [
      {
        key: 'mode', label: 'Mode', type: 'select', default: 'horizontal',
        options: [
          { value: 'horizontal', label: 'Left → Right' },
          { value: 'vertical', label: 'Top → Bottom' },
          { value: 'quad', label: 'Four-way' },
        ],
      },
      { key: 'offset', label: 'Axis offset', type: 'number', default: 0, min: -0.5, max: 0.5, step: 0.01, animatable: true },
    ],
    post: (rc) => {
      const { ctx, width, height, params, intensity } = rc;
      if (intensity < 0.05) return;
      // Visual seam so the axis is discoverable while editing.
      ctx.save();
      ctx.globalAlpha = 0.12 * intensity;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      if (params.mode !== 'vertical') {
        const x = params.offset * width;
        ctx.beginPath(); ctx.moveTo(x, -height / 2); ctx.lineTo(x, height / 2); ctx.stroke();
      }
      if (params.mode !== 'horizontal') {
        const y = params.offset * height;
        ctx.beginPath(); ctx.moveTo(-width / 2, y); ctx.lineTo(width / 2, y); ctx.stroke();
      }
      ctx.restore();
    },
  },

  /* ══ UTILITY ══ */
  {
    type: 'letterbox',
    label: 'Letterbox Bars',
    category: 'utility',
    description: 'Baked-in cinematic mattes at any aspect ratio.',
    params: [
      { key: 'ratio', label: 'Target ratio', type: 'number', default: 2.39, min: 1, max: 3, step: 0.01, hint: '2.39 = Cinemascope' },
      { key: 'color', label: 'Bar colour', type: 'color', default: '#000000' },
      { key: 'softness', label: 'Edge softness', type: 'number', default: 0, min: 0, max: 40, step: 1, unit: 'px' },
    ],
    post: (rc) => {
      const { ctx, width, height, params, intensity } = rc;
      const targetHeight = width / params.ratio;
      const barHeight = Math.max(0, (height - targetHeight) / 2) * intensity;
      if (barHeight < 0.5) return;

      ctx.save();
      if (params.softness > 0) ctx.filter = `blur(${params.softness}px)`;
      ctx.fillStyle = params.color;
      ctx.fillRect(-width / 2, -height / 2, width, barHeight);
      ctx.fillRect(-width / 2, height / 2 - barHeight, width, barHeight);
      ctx.restore();
    },
  },

  {
    type: 'drop_shadow',
    label: 'Drop Shadow',
    category: 'stylize',
    description: 'Casts a soft shadow behind the layer.',
    params: [
      { key: 'color', label: 'Colour', type: 'color', default: '#000000' },
      { key: 'blur', label: 'Blur', type: 'number', default: 24, min: 0, max: 120, step: 1, unit: 'px', animatable: true },
      { key: 'offsetX', label: 'Offset X', type: 'number', default: 0, min: -200, max: 200, step: 1, unit: 'px', animatable: true },
      { key: 'offsetY', label: 'Offset Y', type: 'number', default: 12, min: -200, max: 200, step: 1, unit: 'px', animatable: true },
      { key: 'opacity', label: 'Opacity', type: 'number', default: 60, min: 0, max: 100, step: 1, unit: '%', animatable: true },
    ],
    pre: (rc) => {
      const { ctx, params, intensity } = rc;
      ctx.shadowColor = rgba(params.color, (params.opacity / 100) * intensity);
      ctx.shadowBlur = params.blur;
      ctx.shadowOffsetX = params.offsetX;
      ctx.shadowOffsetY = params.offsetY;
    },
  },

  {
    type: 'outline',
    label: 'Outline / Stroke',
    category: 'stylize',
    description: 'Draws a border around the layer bounds.',
    params: [
      { key: 'color', label: 'Colour', type: 'color', default: '#ffffff' },
      { key: 'width', label: 'Width', type: 'number', default: 4, min: 0, max: 60, step: 0.5, unit: 'px', animatable: true },
      { key: 'radius', label: 'Corner radius', type: 'number', default: 0, min: 0, max: 200, step: 1, unit: 'px' },
      { key: 'inset', label: 'Inset', type: 'number', default: 0, min: -100, max: 100, step: 1, unit: 'px' },
    ],
    post: (rc) => {
      const { ctx, width, height, params, intensity } = rc;
      if (params.width <= 0) return;
      const inset = params.inset;
      ctx.save();
      ctx.globalAlpha = intensity;
      ctx.strokeStyle = params.color;
      ctx.lineWidth = params.width;
      ctx.beginPath();
      ctx.roundRect(
        -width / 2 + inset, -height / 2 + inset,
        width - inset * 2, height - inset * 2,
        params.radius
      );
      ctx.stroke();
      ctx.restore();
    },
  },
];

/* ── Lookups ────────────────────────────────────────────────────── */

const REGISTRY_BY_TYPE = new Map(EFFECT_REGISTRY.map((e) => [e.type, e]));

export function getEffectDefinition(type: string): EffectDefinition | undefined {
  return REGISTRY_BY_TYPE.get(type);
}

export function listEffectTypes(): string[] {
  return EFFECT_REGISTRY.map((e) => e.type);
}

export const EFFECT_CATEGORIES: { id: EffectCategory; label: string }[] = [
  { id: 'stylize', label: 'Stylize' },
  { id: 'blur', label: 'Blur & Sharpen' },
  { id: 'distort', label: 'Distort' },
  { id: 'light', label: 'Light' },
  { id: 'color', label: 'Colour' },
  { id: 'generate', label: 'Generate' },
  { id: 'motion', label: 'Motion' },
  { id: 'utility', label: 'Utility' },
];

/** Build a fresh effect instance with every parameter at its default. */
export function createEffectInstance(type: string, id: string, overrides: Record<string, any> = {}): ClipEffect | null {
  const def = getEffectDefinition(type);
  if (!def) return null;

  const params: Record<string, number | string | boolean> = {};
  for (const p of def.params) params[p.key] = p.default;

  // Only accept overrides the schema actually declares.
  for (const [key, value] of Object.entries(overrides)) {
    const schema = def.params.find((p) => p.key === key);
    if (!schema) continue;
    params[key] = coerceParam(schema, value);
  }

  return { id, type, enabled: true, intensity: 1, params, keyframes: [] };
}

/** Clamp / coerce a value to a parameter's declared type and range. */
export function coerceParam(schema: EffectParam, value: any): number | string | boolean {
  switch (schema.type) {
    case 'boolean':
      return Boolean(value);
    case 'color':
      return typeof value === 'string' && /^#?[0-9a-fA-F]{3,8}$/.test(value.trim())
        ? (value.trim().startsWith('#') ? value.trim() : `#${value.trim()}`)
        : (schema.default as string);
    case 'select': {
      const allowed = schema.options?.map((o) => o.value) ?? [];
      return allowed.includes(String(value)) ? String(value) : (schema.default as string);
    }
    case 'number':
    case 'angle':
    default: {
      const n = Number(value);
      if (Number.isNaN(n)) return schema.default as number;
      const min = schema.min ?? -Infinity;
      const max = schema.max ?? Infinity;
      return Math.max(min, Math.min(max, n));
    }
  }
}

/** Deterministic hash-based PRNG so renders are reproducible per clip. */
export function makeSeededRandom(seed: string): (n: number) => number {
  let base = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    base ^= seed.charCodeAt(i);
    base = Math.imul(base, 16777619);
  }
  return (n: number) => {
    let t = (base ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
