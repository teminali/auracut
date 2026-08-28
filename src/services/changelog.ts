/* ═══════════════════════════════════════════════════════════════════
   What changed, and which of it this user has not seen yet.

   One list, in this file, newest first. It is the source for both the
   "What's new" sheet and the promotion that appears at the top of the
   home screen after an update.

   THE ONE RULE FOR EDITING THIS FILE: an entry may be written before its
   release. `visibleReleases` hides anything NEWER than the running
   build, so a 1.9.0 entry added while 1.8.1 is shipping stays invisible
   until the version bump reaches the user — at which point it appears on
   its own. That is why the entry for a feature can be written in the
   same commit as the feature, which is the only time anybody actually
   remembers what it does.

   `headline` is what the promotion says and has to stand alone in about
   forty characters. `detail` is the sentence under it. `items` is the
   list in the sheet, and it is the place for the specifics.
   ═══════════════════════════════════════════════════════════════════ */

import { compareVersions } from '../utils/version';

export interface Release {
  version: string;
  /** ISO date, so it sorts and formats without a parser. */
  date: string;
  /** Forty characters, give or take. It is a headline, not a summary. */
  headline: string;
  detail: string;
  items: string[];
}

/*
  Newest first. `visibleReleases` does not sort — it filters — so the
  order here is the order everywhere.
*/
export const CHANGELOG: Release[] = [
  {
    version: '1.9.0',
    date: '2026-08-28',
    headline: 'Renders that use the whole machine',
    detail:
      'Export encodes on the GPU and can render several parts of the timeline at once, ' +
      'instead of one frame at a time through a JPEG.',
    items: [
      'The frame goes straight from the canvas to the platform encoder, and ffmpeg copies '
        + 'the result rather than decoding and re-encoding it.',
      'A long render is cut into chunks rendered side by side in hidden windows and joined '
        + 'in order. The editor stays usable while they run.',
      'The export dialog shows the rate, the time remaining, the encoder in use, and one '
        + 'bar per render window.',
      'A finished export can be shown in the folder or opened straight from the dialog.',
      'The written file is checked against the render that produced it, so a frame lost at '
        + 'the mux is an error rather than a video that is quietly too short.',
    ],
  },
  {
    version: '1.8.1',
    date: '2026-08-28',
    headline: 'Updates that repair themselves',
    detail: 'The updater recovers from a failed install, and agent setup works on Windows.',
    items: [
      'A broken or half-applied update is repaired instead of leaving the app stranded.',
      'Agent installs work on Windows.',
    ],
  },
  {
    version: '1.8.0',
    date: '2026-08-28',
    headline: 'The cinematic frame',
    detail: 'A film look for the whole composition, and skills that keep themselves current.',
    items: [
      'Cinematic framing and grade across the composition.',
      'Skills notice their own updates and offer to install them.',
      'The home screen says when a newer Kerf is available.',
    ],
  },
  {
    version: '1.7.1',
    date: '2026-08-28',
    headline: 'Roll back to any release',
    detail: 'The version at the foot of the rail is a menu, and it goes backwards as well as forwards.',
    items: ['Pick any published release and switch to it, not only the newest.'],
  },
  {
    version: '1.7.0',
    date: '2026-08-28',
    headline: 'Stream the edit live',
    detail: 'Send the composition to an RTMP ingest, to the ingest’s own specification.',
    items: [
      'Live output built on the same compositor the editor and the export use.',
      'Verified against a real ingest rather than a mock.',
    ],
  },
  {
    version: '1.6.3',
    date: '2026-08-28',
    headline: 'The edit never waits for the agent',
    detail: 'Editing stays responsive while a language model is working, and writes report what they did.',
    items: [
      'No editing operation blocks on a model call.',
      'A write reports its result instead of assuming it succeeded.',
    ],
  },
  {
    version: '1.6.2',
    date: '2026-08-28',
    headline: 'Captions that read as subtitles',
    detail: 'Captions are typeset as subtitles rather than as text in a box.',
    items: ['Subtitle typography, spacing and safe areas.'],
  },
];

/**
 * The releases this build is allowed to talk about.
 *
 * Anything newer than what is running is somebody else's release: the
 * user has not got it, and telling them about a feature they cannot use
 * is worse than saying nothing. That case belongs to the update
 * promotion, which offers the version rather than describing it.
 */
export function visibleReleases(currentVersion: string): Release[] {
  if (!currentVersion) return [];
  return CHANGELOG.filter((r) => compareVersions(r.version, currentVersion) <= 0);
}

/** The newest release this build is running, or null before the version is known. */
export function currentRelease(currentVersion: string): Release | null {
  return visibleReleases(currentVersion)[0] ?? null;
}

/**
 * The release worth promoting, or null.
 *
 * Null when the version is not known yet, when there is no entry for it,
 * or when this user has already been shown it. `seen` is a version
 * rather than a boolean so that acknowledging 1.8.0 does not also
 * acknowledge the 1.9.0 the user has not been given yet.
 */
export function unseenRelease(currentVersion: string, seen: string | null): Release | null {
  const release = currentRelease(currentVersion);
  if (!release) return null;
  if (seen && compareVersions(seen, release.version) >= 0) return null;
  return release;
}

/** "28 August 2026" — long form, because a changelog is read, not scanned. */
export function formatReleaseDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/* ── Which release the user has already been shown ────────────────
   localStorage, following `recentsStore`: it is per machine, it is not
   worth a file, and losing it costs one extra look at a promotion.   */

const SEEN_KEY = 'kerf.changelog.seen.v1';

export function readSeenRelease(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    /* Private mode, or no storage at all. The promotion shows again,
       which is the harmless direction to fail in. */
    return null;
  }
}

export function writeSeenRelease(version: string): void {
  try {
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    /* Nothing to do; the promotion will appear again next launch. */
  }
}
