/*
  Picking the right architecture out of the update feed.

  This is the one decision in the updater that does not fail loudly when
  it is wrong. Every other failure ends in an error message; this one
  ends in a real archive, with a matching checksum, extracted and
  installed successfully, containing an app for the wrong processor. The
  user gets a bundle that will not launch and nothing anywhere says why.

  The tests below are in two halves, and the second half is the point:

  · the CURRENT feed must resolve correctly, and
  · every feed a shipped client might ever read must resolve correctly
    or refuse, because the copy of this function that reads the next
    release is the copy inside the version somebody already installed.
    Renaming a release artifact is a change to code that has shipped.
*/
import { describe, it, expect } from 'vitest';
import { parseFeed } from './updateFeed';

/** A latest-mac.yml holding exactly these file names. */
const feed = (names: string[], version = '1.6.1') =>
  `version: ${version}\nfiles:\n`
  + names.map((n, i) => `  - url: ${n}\n    sha512: sha-${i}==\n    size: ${1000 + i}\n`).join('')
  + `path: ${names[0]}\nreleaseDate: '2026-08-28T13:00:43.997Z'\n`;

/* The naming this repo publishes now. */
const CURRENT = [
  'Kerf-1.6.1-macOS-arm64.zip',
  'Kerf-1.6.1-macOS-x64.zip',
  'Kerf-1.6.1-macOS-arm64.dmg',
  'Kerf-1.6.1-macOS-x64.dmg',
];

/* electron-builder's default, which is what v1.6.0 and earlier shipped.
   Note the Intel zip carries no architecture at all: it is the one that
   reads as "the Mac one" and is the reason the names changed. */
const LEGACY = [
  'Kerf-1.6.0-mac.zip',
  'Kerf-1.6.0-arm64-mac.zip',
  'Kerf-1.6.0-x64.dmg',
  'Kerf-1.6.0-arm64.dmg',
];

describe('the current feed', () => {
  it('gives Apple Silicon the arm64 zip', () => {
    expect(parseFeed(feed(CURRENT), 'arm64').name).toBe('Kerf-1.6.1-macOS-arm64.zip');
  });

  it('gives Intel the x64 zip', () => {
    expect(parseFeed(feed(CURRENT), 'x64').name).toBe('Kerf-1.6.1-macOS-x64.zip');
  });

  it('never hands back a dmg, which cannot be extracted without mounting', () => {
    for (const arch of ['arm64', 'x64']) {
      expect(parseFeed(feed(CURRENT), arch).name).toMatch(/\.zip$/);
    }
  });

  it('carries the version and the checksum of the file it chose', () => {
    const chosen = parseFeed(feed(CURRENT), 'arm64');
    expect(chosen.version).toBe('1.6.1');
    expect(chosen.sha512).toBe('sha-0==');
  });
});

describe('a feed written by an older release', () => {
  /*
    A client updating from a version whose feed predates the rename, and
    the reason the unnamed-Intel fallback is kept at all.
  */
  it('still finds arm64 under the old `-arm64-mac.zip` spelling', () => {
    expect(parseFeed(feed(LEGACY), 'arm64').name).toBe('Kerf-1.6.0-arm64-mac.zip');
  });

  it('still finds Intel under the old unlabelled `-mac.zip`', () => {
    expect(parseFeed(feed(LEGACY), 'x64').name).toBe('Kerf-1.6.0-mac.zip');
  });
});

describe('what it refuses rather than guesses', () => {
  /*
    THE regression this whole file exists for.

    The previous implementation asked "does the name contain arm64?" and
    treated NO as proof of Intel. Against a feed named in words it would
    hand an Intel machine the Apple Silicon build: a correct download, a
    matching checksum, a successful install, and an app that cannot run.

    Renaming the artifacts to `AppleSilicon`/`Intel` with no arch token
    is exactly the change that would have done it, so it is the case
    that is pinned.
  */
  const WORDS = [
    'Kerf-1.7.0-macOS-AppleSilicon.zip',
    'Kerf-1.7.0-macOS-Intel.zip',
  ];

  it('does not hand an Apple Silicon build to an Intel machine', () => {
    const chosen = parseFeed(feed(WORDS), 'x64');
    expect(chosen.name).not.toContain('AppleSilicon');
    expect(chosen.name).toBe('Kerf-1.7.0-macOS-Intel.zip');
  });

  it('refuses when two files could both be this architecture', () => {
    expect(() => parseFeed(feed([
      'Kerf-1.7.0-macOS-x64.zip',
      'Kerf-1.7.0-macOS-x64-rosetta.zip',
    ]), 'x64')).toThrow(/could be x64/);
  });

  it('refuses a feed with nothing for this architecture', () => {
    expect(() => parseFeed(feed(['Kerf-1.7.0-macOS-x64.zip']), 'arm64'))
      .toThrow(/no arm64 zip/);
  });

  it('refuses a feed with no files at all', () => {
    expect(() => parseFeed('version: 1.7.0\nfiles:\n', 'arm64')).toThrow(/lists no files/);
  });

  it('refuses a feed with no version', () => {
    expect(() => parseFeed('files:\n  - url: a.zip\n    sha512: x==\n', 'arm64'))
      .toThrow(/no version/);
  });

  it('does not mistake a substring for an architecture token', () => {
    /*
      `arm64` inside a longer word is not this build's architecture.
      A boundary-less `includes` would take it.
    */
    expect(() => parseFeed(feed(['Kerf-1.7.0-macOS-notarm64ish.zip']), 'arm64'))
      .toThrow(/no arm64 zip/);
  });
});
