/*
 * The house rules for what ships in the interface, as checks rather than
 * as notes somebody reads.
 *
 * Both of these were true once, drifted, and were fixed by hand. A rule
 * that has already been broken once will be broken again unless
 * something fails when it is.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const FILES = sourceFiles('src');

describe('iconography', () => {
  it('ships no emoji anywhere in the source', () => {
    /*
      Emoji were the effect and transition "previews" for a long time: a
      magnifying glass for zoom, a spiral for spin, a film reel for
      dissolve. Beyond telling nobody anything, an emoji is drawn by the
      OS font, so it is a different picture on every platform, at a
      different optical weight from every real icon beside it, and it
      cannot be coloured, sized or aligned with the rest of the set.
    */
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
    const offenders = FILES.filter((f) => emoji.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('uses the SINGLE-shine AI mark, never the multi-star', () => {
    /*
      HANDOVER, Iconography: one AI mark across the platform, the single
      four-point shine. It replaced the multi-star once already because
      that is the glyph on every AI product of the last few years.

      Phosphor's icon actually NAMED `Sparkle` is the multi-star (three
      to four shapes per weight against StarFour's one), so migrating to
      that set put back exactly what had been removed. The shim maps the
      name to `StarFour`, and this pins it.
    */
    const shim = readFileSync(join('src', 'components', 'ui', 'icons.ts'), 'utf8');
    expect(shim).toMatch(/StarFour as Sparkle/);
    expect(shim).not.toMatch(/^export \{ Sparkle \}/m);
  });

  it('imports icons only through the platform set', () => {
    /*
      One file decides what an icon is. The last set swap touched 52
      files; the next one should touch `ui/icons.ts` and nothing else,
      and that is only true while nothing imports a package directly.
    */
    const direct = FILES.filter(
      (f) => !f.endsWith(join('ui', 'icons.ts')) &&
        /from '(lucide-react|@phosphor-icons\/react)'/.test(readFileSync(f, 'utf8'))
    );
    expect(direct).toEqual([]);
  });
});

/* ── Copy ────────────────────────────────────────────────────────── */

/**
 * Comments are allowed to contain anything; strings are not.
 *
 * Stripping them here rather than filtering line-by-line, because a
 * block comment's continuation lines carry no marker of their own and a
 * naive check reports every one of them as user-facing text.
 */
function stripComments(t: string): string {
  return t
    .replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) ?? []).length))
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('copy', () => {
  it('uses no em dashes in anything the user or the agent reads', () => {
    /*
      Swept once, 220 of them across 39 files, and it will drift back
      the first time somebody writes a tool description in a hurry.
      Comments are exempt; string literals and JSX text are not.
    */
    const offenders = FILES
      .map((f) => [f, stripComments(readFileSync(f, 'utf8'))] as const)
      .filter(([, code]) => code.includes('\u2014'))
      .map(([f]) => f);
    expect(offenders).toEqual([]);
  });
});

/* ── Type ────────────────────────────────────────────────────────── */

describe('type scale', () => {
  it('uses no size outside the scale', () => {
    /*
      tailwind.config.js: "ONE TYPE SCALE, 10 / 11 / 12 / 13 / 15.
      Nothing in between. Half-pixel sizes are what make an interface
      look improvised."

      It had drifted to 285 raw pixel declarations, EIGHTY-TWO of them
      at 9px, which is below the scale entirely and is most of what made
      the panels feel cramped next to the home screen. Snapped back and
      pinned here.

      The allowed exceptions are the home screen's display sizes, which
      the config declares for exactly that surface, and one 8.5px badge.
    */
    const ALLOWED = new Set(['8.5px', '17px', '26px', '30px']);
    const offenders: string[] = [];

    for (const f of FILES) {
      for (const m of readFileSync(f, 'utf8').matchAll(/text-\[([0-9.]+px)\]/g)) {
        if (!ALLOWED.has(m[1])) offenders.push(`${f}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
