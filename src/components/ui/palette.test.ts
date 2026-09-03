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

/**
 * Read a Tailwind token, following the one level of indirection the
 * config uses.
 *
 * `tailwind.config.js` names each value once as a module constant and
 * then spends it in both naming families — `spectrum.accent` and the
 * canonical `accent.DEFAULT` are the same `ACCENT`. That is what stops
 * the two families drifting from each other, and it is worth the four
 * lines here: the alternative was writing every hex twice in the file
 * whose entire job is to not have a value written twice.
 */
function token(name: string): string {
  const direct = CONFIG.match(new RegExp(`\\b${name}:\\s*'(#[0-9a-fA-F]{6})'`));
  if (direct) return direct[1];

  const viaConst = CONFIG.match(new RegExp(`\\b${name}:\\s*([A-Z][A-Z0-9_]*)\\s*,`));
  if (viaConst) {
    const decl = CONFIG.match(
      new RegExp(`\\bconst ${viaConst[1]}\\s*=\\s*'(#[0-9a-fA-F]{6})'`)
    );
    if (decl) return decl[1];
    throw new Error(`${name} points at ${viaConst[1]}, which is not a hex constant`);
  }

  throw new Error(`${name} not found in tailwind.config.js`);
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
      ONE RULE, applied to all six roles: thirty degrees of hue, or a
      clear separation in saturation when hue is unavailable.

      That sentence has been the rule since the amber swap; what changed
      is that it used to be written as "hue for five roles, and red is
      a hard-coded exception". Which role needs which mechanism DEPENDS
      ON THE ACCENT, and hard-coding it meant the test described one
      particular accent rather than the rule:

        terracotta  red boxed in at 18 deg  -> red separated by saturation
        this orange gold at 26 deg          -> GOLD separates by saturation,
                                               and red gets 33 deg of hue back

      So the exception moved from red to gold when the accent moved, and
      a test naming `red` would have failed on a palette that is
      perfectly legible. Both mechanisms are checked for every role, and
      the failure message says which one each colour is relying on — so
      the next swap still fails loudly, and says why.
    */
    const roles = ['amber', 'blue', 'green', 'purple', 'pink', 'red'] as const;

    const how = roles.map((role) => {
      const hueDelta = hueGap(accent, token(role));
      const satDelta = Math.abs(saturation(token(role)) - saturation(accent));
      return {
        role,
        hue: Math.round(hueDelta),
        sat: Number(satDelta.toFixed(2)),
        separatedBy: hueDelta >= 30 ? 'hue' : satDelta >= 0.15 ? 'saturation' : 'NOTHING',
      };
    });

    // Reads in the failure output as a table, which is the point.
    expect(how.filter((r) => r.separatedBy === 'NOTHING')).toEqual([]);
  });
});

/*
  The ink ladder.

  This exists because the ladder DID drift, silently, and nothing
  caught it. `--text` in index.css and `text` in tailwind.config.js are
  two hand-maintained copies of one decision — the Tailwind side cannot
  read the CSS variable without breaking the `/50` alpha modifiers used
  across the app — so only a test can hold them together.

  The values are measured off the approved design by counting the
  characters each element PAINTS ITSELF. Counting `textContent` instead
  charges every wrapper for its entire subtree, and since <body> is
  white that method scored pure white at 8838 characters and promoted it
  to the body ink. Counted properly, white paints ZERO characters in the
  design. That specific mistake is asserted against below.
*/
describe('the ink ladder', () => {
  const RUNGS = [
    { css: 'text-bright', tw: 'textBright' },
    { css: 'text', tw: 'text' },
    { css: 'text-muted', tw: 'textMuted' },
    { css: 'text-dim', tw: 'textDim' },
    { css: 'text-faint', tw: 'textFaint' },
  ] as const;

  it('is the same in the CSS variables and the Tailwind tokens', () => {
    const drifted = RUNGS
      .map((r) => ({ rung: r.css, css: cssVar(r.css), tailwind: token(r.tw) }))
      .filter((r) => r.css.toLowerCase() !== r.tailwind.toLowerCase());
    expect(drifted).toEqual([]);
  });

  it('contains no pure white, which the design never paints', () => {
    const white = RUNGS
      .map((r) => ({ rung: r.css, value: cssVar(r.css) }))
      .filter((r) => r.value.toLowerCase() === '#ffffff');
    expect(white).toEqual([]);
  });

  it('gets dimmer at every step, so the roles stay distinguishable', () => {
    const steps = RUNGS.map((r) => ({ rung: r.css, luminance: luminance(cssVar(r.css)) }));
    const wrongWay = steps
      .slice(1)
      .map((s, i) => ({ from: steps[i].rung, to: s.rung, drop: steps[i].luminance - s.luminance }))
      .filter((s) => s.drop <= 0);
    expect(wrongWay).toEqual([]);
  });

  it('keeps body text readable on the panel it sits on', () => {
    // The forward plane most text is read against.
    expect(contrast(cssVar('text'), cssVar('surface'))).toBeGreaterThanOrEqual(4.5);
  });
});

/*
  Track height is the one geometry the live-design comparison cannot
  check, because a loaded project carries whatever heights it was saved
  with -- so a screenshot of somebody's old project says nothing about
  whether the app agrees with the reference. The DEFAULT is the thing
  the design fixes, and it is fixed here.

  The reference gives every lane the same ~40px, audio included. The app
  used to give audio 44 and video 52, which made its timeline a third
  taller than the design's for the same number of tracks.
*/
describe('the default track height', () => {
  const STORE = readFileSync(join('src', 'store', 'timelineStore.ts'), 'utf8');
  const MEDIA = readFileSync(join('src', 'mcp', 'defaultMedia.ts'), 'utf8');

  it('is 40 everywhere a track is created', () => {
    const heights = [...STORE.matchAll(/heightPx:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(heights.length).toBeGreaterThan(0);
    expect(heights.filter((h) => h !== 40)).toEqual([]);
  });

  it('is 40 on every lane of the bundled starter', () => {
    const heights = [...MEDIA.matchAll(/heightPx:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(heights.length).toBeGreaterThan(0);
    expect(heights.filter((h) => h !== 40)).toEqual([]);
  });
});
