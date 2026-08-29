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
    version: '1.11.1',
    date: '2026-08-29',
    headline: 'Update feedback and dropdown layering',
    detail:
      'Fixed dropdown menu clipping in the home sidebar and added clear update notifications with a dedicated restart action.',
    items: [
      'Sidebar dropdown menu now layers cleanly on top of the main canvas with fixed z-index stacking.',
      'The update menu now stays open on completion and offers a prominent "Quit Kerf to finish update" button.',
      'A compact "Quit to apply" action button appears directly in the sidebar footer whenever an update is ready.',
      'Instant toast notifications announce when an update is successfully downloaded and installed to disk.',
    ],
  },
  {
    version: '1.11.0',
    date: '2026-08-29',
    headline: 'Kinetic captions and subtitle design',
    detail:
      'The tutorial skill now lays down kinetic emphasis typography and full-sentence subtitles, '
      + 'with pre-assembly transcript checks, offline fonts, and automatic subtitle sidecars.',
    items: [
      'The Tutorial skill transcribes narration twice: as whole-sentence subtitles on T1, and as '
        + 'kinetic emphasis type on T2 that puts a few large, animated words on screen at a time.',
      'Whole-sentence subtitle tracks are preserved for accessibility, timeline editing, and '
        + 'automatic .srt export sidecars beside video renders.',
      'The transcript is reviewed by the agent CLI before timeline placement, fixing typos and '
        + 'selecting hero words by meaning with fallback to length heuristics.',
      'Transcripts are audited before placement for repetition loops, stutters, and non-speech '
        + 'markers, and multilingual speech models (large-v3) are streamed automatically when needed.',
      'Camera framing moves on smooth 400ms glide curves instead of hard cuts for screen recordings.',
      'Bundled Poppins font files (700 and 800 weights) ensure offline kinetic rendering never falls '
        + 'back to system defaults during export.',
      'Export writes .srt subtitle files beside video renders and announces them in the export dialog.',
      'Fixed the fullscreen player\'s "Open timeline" action to properly dismiss the player overlay.',
    ],
  },
  {
    version: '1.10.0',
    date: '2026-08-29',
    headline: 'The interface, measured not eyeballed',
    detail:
      'Every screen was compared against the approved design by rendering both and reading the '
      + 'numbers off them, rather than by matching them by eye.',
    items: [
      'Home, the editor and the fullscreen player are now measured against the reference design '
        + 'automatically: `tools/design_diff.py` renders both, reads the computed geometry, type '
        + 'and colour off each, and prints only what differs. The design is the target and the '
        + 'app moves.',
      'The ink ladder was wrong. The body colour was pure white, which the design never paints '
        + 'anywhere. The earlier measurement counted every wrapper against its whole subtree, and '
        + 'since the page body is white, white scored 8838 characters and became the body ink. '
        + 'Counted by what each element actually paints, white paints nothing.',
      'The type scale had collapsed three of the design\'s sizes onto one, which is why dense '
        + 'areas read flatter than the reference.',
      'Timeline lanes are one height, 40px, audio included, as the design has them. The old '
        + '44/52 split made the timeline a third taller for the same number of tracks.',
      'A clip carries its lane colour as a border rather than a top rail, and the track header '
        + 'no longer reserves an empty column that was costing the track name a quarter of its '
        + 'width.',
      'One play control, 40px and near-white, the same in the editor and the player.',
      'The player\'s tools sit on a floating dock, and its chrome is the same solid bar the rest '
        + 'of the product wears.',
      'The player\'s blurred backdrop was blurring a 64x64 image across a 2000px stage every '
        + 'frame at a 64px radius, and pinned a GPU process at 120% for as long as the player was '
        + 'open. The upscale already does the smoothing, so the radius is now 16px and the wash is '
        + 'unchanged.',
      'The CSS variables and the Tailwind tokens are two hand-kept copies of one palette, and '
        + 'they had drifted. A test now fails if they disagree, and if the body ink is ever pure '
        + 'white again.',
    ],
  },
  {
    version: '1.9.1',
    date: '2026-08-29',
    headline: 'Exports stop hogging the machine',
    detail:
      'A render now uses one window instead of four. It is faster that way, and it leaves ' +
      'the computer usable while it works.',
    items: [
      'Splitting a render across several hidden windows was measured and is slower: video is '
        + 'decoded in one shared process however many windows ask for it, so the extra windows '
        + 'queue behind each other and take the machine down with them.',
      'The split is still available under Speed in the export dialog, and says plainly that it '
        + 'is slower.',
      'Hardware encoding, which is where the real gain is, is unchanged.',
    ],
  },
  {
    version: '1.9.0',
    date: '2026-08-29',
    headline: 'Renders that use the whole machine',
    detail:
      'Export encodes on the GPU and can render several parts of the timeline at once, ' +
      'instead of one frame at a time through a JPEG.',
    items: [
      'The frame goes straight from the canvas to the platform encoder, and ffmpeg copies '
        + 'the result rather than decoding and re-encoding it.',
      'A long render can be cut into chunks drawn side by side in hidden windows and joined '
        + 'in order. Measured afterwards and found slower than a single window, so 1.9.1 turns '
        + 'it off by default.',
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
