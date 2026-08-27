/*
 * The iconography rules, as checks rather than as a note somebody reads.
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
