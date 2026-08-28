import { describe, it, expect } from 'vitest';
import {
  CHANGELOG, visibleReleases, currentRelease, unseenRelease, formatReleaseDate,
} from './changelog';

/*
  The rule this file exists to protect: a build never advertises a
  feature it does not have. An entry may be written before its release,
  so "newer than me is invisible" is the property, not a side effect.
*/

describe('CHANGELOG', () => {
  it('is ordered newest first', () => {
    const versions = CHANGELOG.map((r) => r.version);
    const sorted = [...versions].sort((a, b) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
      return 0;
    });
    expect(versions).toEqual(sorted);
  });

  it('gives every release a headline short enough for the promotion bar', () => {
    for (const r of CHANGELOG) {
      expect(r.headline.length, `${r.version}: "${r.headline}"`).toBeLessThanOrEqual(48);
      expect(r.items.length, `${r.version} has no items`).toBeGreaterThan(0);
    }
  });

  it('names each version once', () => {
    const seen = new Set(CHANGELOG.map((r) => r.version));
    expect(seen.size).toBe(CHANGELOG.length);
  });
});

describe('visibleReleases', () => {
  it('hides releases newer than the running build', () => {
    const shown = visibleReleases('1.8.0').map((r) => r.version);
    expect(shown).not.toContain('1.9.0');
    expect(shown).not.toContain('1.8.1');
    expect(shown[0]).toBe('1.8.0');
  });

  it('shows everything on the newest build', () => {
    expect(visibleReleases('99.0.0')).toHaveLength(CHANGELOG.length);
  });

  it('shows nothing before the version is known', () => {
    /* `useUpdater` reports '' until main answers. An empty string must
       not read as "older than everything" and show the whole list. */
    expect(visibleReleases('')).toEqual([]);
  });

  it('shows nothing on a build older than every entry', () => {
    expect(visibleReleases('1.0.0')).toEqual([]);
    expect(currentRelease('1.0.0')).toBeNull();
  });
});

describe('unseenRelease', () => {
  it('offers the running release when nothing has been seen', () => {
    expect(unseenRelease('1.8.0', null)?.version).toBe('1.8.0');
  });

  it('says nothing once that release has been seen', () => {
    expect(unseenRelease('1.8.0', '1.8.0')).toBeNull();
  });

  it('offers a newer release even when an older one was seen', () => {
    expect(unseenRelease('1.8.1', '1.8.0')?.version).toBe('1.8.1');
  });

  it('does not un-see a release because a newer one was acknowledged', () => {
    /* Somebody who saw 1.9.0 on another machine, then ran 1.8.0 here,
       must not be shown 1.8.0's news as though it were new. */
    expect(unseenRelease('1.8.0', '1.9.0')).toBeNull();
  });

  it('stays quiet before the version is known', () => {
    expect(unseenRelease('', null)).toBeNull();
  });
});

describe('formatReleaseDate', () => {
  it('reads as a date', () => {
    expect(formatReleaseDate('2026-08-28')).toBe('28 August 2026');
  });

  it('hands back anything it cannot parse rather than showing NaN', () => {
    expect(formatReleaseDate('not a date')).toBe('not a date');
  });
});
