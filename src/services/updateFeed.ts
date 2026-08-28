/* ═══════════════════════════════════════════════════════════════════
   Which file in the update feed is the one for THIS machine.

   Pulled out of `electron/updater.ts` so it can be tested without an
   app, for the same reason `trialPolicy.ts` was: it is a decision, it
   is the decision in the updater most able to be confidently wrong, and
   being wrong here does not throw. It hands back a real, verified,
   correctly-checksummed archive for the WRONG ARCHITECTURE, which
   installs cleanly and produces an app that will not launch.

   It is also the piece that constrains what release artifacts may be
   called, and that constraint reaches backwards: the version of this
   function inside every already-installed copy is the one that will
   read the NEXT release's feed. Renaming an artifact is therefore a
   change to code that has already shipped and cannot be updated.
   `electron-builder.yml` says the same thing next to the names.
   ═══════════════════════════════════════════════════════════════════ */

export interface FeedFile {
  name: string;
  sha512: string;
  version: string;
}

export function parseFeed(yaml: string, arch: string): FeedFile {
  const version = /^version:\s*(.+)$/m.exec(yaml)?.[1]?.trim();
  if (!version) throw new Error('latest-mac.yml has no version line.');

  const entries = [...yaml.matchAll(/-\s+url:\s*(\S+)[\s\S]*?sha512:\s*(\S+)/g)]
    .map((m) => ({ name: decodeURIComponent(m[1]), sha512: m[2] }));
  if (entries.length === 0) throw new Error('latest-mac.yml lists no files.');

  /*
    A zip, for this architecture: it is the artifact that can be
    extracted without mounting anything.

    ── Why this is an explicit token and not "the other one" ────────

    This used to read: arm64 takes the name containing `arm64`, and
    anything else takes a name NOT containing it. The second half is the
    dangerous half. It is not a test for Intel, it is a test for "not
    named arm64", and it silently returns the FIRST zip in the feed
    whenever the naming changes at all. Rename the artifacts and every
    Intel client installs an Apple Silicon build with no error.

    So each architecture now names itself, an unrecognised name matches
    nothing, and finding two candidates is refused rather than resolved
    by taking the first. A sideload that does not happen is a bad
    afternoon; a sideload of the wrong architecture is an app that will
    not launch and a user who cannot tell why.

    Old names are still matched, because a client may be reading a feed
    older than itself:

        Kerf-1.6.1-macOS-arm64.zip   / -x64.zip    (current)
        Kerf-1.6.0-arm64-mac.zip     / -mac.zip    (electron-builder default)
  */
  const zips = entries.filter((e) => e.name.endsWith('.zip'));
  const isArm = (n: string) => /(^|[-_.])(arm64|aarch64)([-_.]|$)/i.test(n);
  const isIntel = (n: string) => /(^|[-_.])(x64|x86[_-]?64|intel)([-_.]|$)/i.test(n);

  let candidates = zips.filter((e) => (arch === 'arm64' ? isArm : isIntel)(e.name));

  /*
    The one concession to the old naming, and it is narrow:
    electron-builder's default called the Intel zip `…-mac.zip` with no
    architecture at all. It is accepted ONLY when nothing named itself
    x64 and there is exactly one such file, so it can never win against
    a name that is explicit.
  */
  if (arch !== 'arm64' && candidates.length === 0) {
    candidates = zips.filter((e) => !isArm(e.name));
  }

  if (candidates.length === 0) {
    throw new Error(`latest-mac.yml has no ${arch} zip; saw ${zips.map((z) => z.name).join(', ') || 'none'}`);
  }
  if (candidates.length > 1) {
    throw new Error(
      `latest-mac.yml has ${candidates.length} zips that could be ${arch} `
      + `(${candidates.map((c) => c.name).join(', ')}), so none was chosen.`
    );
  }
  return { ...candidates[0], version };
}
