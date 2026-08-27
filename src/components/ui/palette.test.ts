/*
 * The accent has changed four times: blue, amber, green, terracotta.
 *
 * Each time, two things had to be re-checked by hand, and each time it
 * was only luck that they were. This makes both mechanical, so a fifth
 * accent cannot ship with white text nobody can read on it, or wearing
 * the same hue as "error".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(join('src', 'index.css'), 'utf8');
const CONFIG = readFileSync('tailwind.config.js', 'utf8');

function cssVar(name: string): string {
  const m = CSS.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`--${name} not found in index.css`);
  return m[1];
}

function token(name: string): string {
  const m = CONFIG.match(new RegExp(`\\b${name}:\\s*'(#[0-9a-fA-F]{6})'`));
  if (!m) throw new Error(`${name} not found in tailwind.config.js`);
  return m[1];
}

const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function hue(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function saturation(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return 0;
  return (max - min) / (1 - Math.abs(2 * l - 1));
}

const hueGap = (a: string, b: string) => {
  const d = Math.abs(hue(a) - hue(b)) % 360;
  return Math.min(d, 360 - d);
};

describe('the accent', () => {
  const accent = cssVar('accent');

  it('is the same colour in the CSS variables and the Tailwind tokens', () => {
    // Two sources of truth for one colour is how a button ends up a
    // different shade from the playhead beside it.
    expect(token('accent').toLowerCase()).toBe(accent.toLowerCase());
  });

  it('has type on it that passes AA', () => {
    /*
      White on the accent has FAILED for three accents running: 3.1:1 on
      amber, 2.2:1 on green, 3.1:1 on this terracotta. The check belongs
      to the role, not to any one colour.
    */
    expect(contrast(accent, cssVar('on-accent'))).toBeGreaterThanOrEqual(4.5);
    // And the reason `--on-accent` exists at all.
    expect(contrast(accent, '#ffffff')).toBeLessThan(4.5);
  });

  it('is distinguishable from every colour that carries a different meaning', () => {
    /*
      Thirty degrees of hue, or a clear separation in saturation when hue
      is unavailable. `red` is the documented exception: a terracotta is
      an orange-red, and every hue between the accent and the pink text
      lane is within 30 degrees of one or the other, so error red is
      separated as a VIVID red against a muted clay instead.
    */
    const roles = ['amber', 'blue', 'green', 'purple', 'pink'] as const;
    for (const role of roles) {
      expect(
        { role, gap: Math.round(hueGap(accent, token(role))) }
      ).toEqual({ role, gap: expect.any(Number) });
      expect(hueGap(accent, token(role))).toBeGreaterThanOrEqual(30);
    }

    const red = token('red');
    const saturationGap = saturation(red) - saturation(accent);
    expect(saturationGap).toBeGreaterThan(0.15);
  });
});
