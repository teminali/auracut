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
    version: '1.12.14',
    date: '2026-09-01',
    headline: 'Groq Console UI Design & Modal System',
    detail:
      'Refined design system featuring exact Groq console aesthetics across action cards, announcement carousel banners, glowing orange action buttons, and frosted dark dialog modals.',
    items: [
      'Groq Console Action Cards: Start Something grid redesigned with vibrant individual border glows (Cyan, Amber, Blue, Slate), top-left line icons, keyboard shortcut tags, and animated chevrons.',
      'Groq Announcement Banner: Replica of Google Workspace Connectors announcement banner styling with deep sapphire gradient backdrop, icon squircle, and right-aligned link chevron.',
      'Groq Dialog Modal System: Completely overhauled all modals and dialogs (New Project, Sign In, Packages, Shortcuts, Export, MCP, and Agent Picker) with 16px rounded corners, deep slate surfaces, and glowing orange action buttons.',
    ],
  },
  {
    version: '1.12.13',
    date: '2026-08-31',
    headline: 'Speech Model Prompts & Live Update Bars',
    detail:
      'Interactive speech model install prompts during recording review, 1-click auto-transcribe workflow, and real-time update download progress bars.',
    items: [
      'Interactive Speech Model Prompts: when finishing a recording with narration without an installed Whisper model, FrontierCut prompts with 1-click install & transcribe or skip options instead of silently omitting subtitles.',
      'Real-Time Update Progress Display: live download percentage and progress bars across the launcher promotion banner, left navigation rail, and version footer.',
      'Auto-Edit Integration: seamlessly downloads the recommended local model and proceeds directly into transcription, polishing, and speech-synced camera framing.',
    ],
  },
  {
    version: '1.12.12',
    date: '2026-08-31',
    headline: 'Unified Dialogs & Hardware-Smart Packages',
    detail:
      'Unified StandardModal architecture shared with the MCP dialog, intelligent device hardware detection with tailored Whisper model recommendations, and HomeScreen package alerts.',
    items: [
      'StandardModal Reusable Dialog: extracted a unified standard dialog container featuring live metrics banners, categorized views, and search filters.',
      'Hardware-Smart AI Model Recommendations: automatically profiles CPU architecture, core counts, and RAM to recommend optimal Whisper models (Tiny, Base, Small, Medium, Large v3).',
      'HomeScreen Reachability & Alerts: Packages manager is accessible from anywhere with interactive recommendation banners and notification dots.',
      'Strict Z-Index Hierarchy: established layer stacking levels preventing canvas transform bounding boxes and gizmos from overlapping modals.',
    ],
  },
  {
    version: '1.12.11',
    date: '2026-08-31',
    headline: 'Semantic Speech Camera & Subtitle AI Polish',
    detail:
      'Intelligent speech semantics and mouse telemetry veto to switch between full-screen webcam and demonstration screen views, with mandatory pre-assembly Whisper transcription and LLM subtitle polish.',
    items: [
      'Mouse Movement & Click Telemetry Veto: pointer activity and clicks strictly prevent full-screen webcam takeover, keeping the screen in focus when interacting.',
      'Semantic Speech Classification: demonstration markers ("click here", "open settings", "in terminal") keep camera in PiP inset, while conceptual talks and intros smoothly expand the webcam.',
      'Mandatory Pre-Assembly Transcription: speech is always transcribed and analyzed before layout decisions, preventing accidental full-screen overlays over silence.',
      'AI & Deterministic Subtitle Cleanup: automated repetition loop removal, stutter collapse, and LLM text polishing with word-level hero emphasis sync.',
      'Outro Wrap-up Detection: closing remarks with idle screen automatically switch to full-screen webcam for a clean finish.',
    ],
  },
  {
    version: '1.12.10',
    date: '2026-08-31',
    headline: 'Camera Mirroring, Bounds & A/V Sync',
    detail:
      'Native camera horizontal mirroring toggle, strict screen boundary preservation during auto-zoom across compact and high-DPI displays, and frame-accurate audio/video synchronization on Windows.',
    items: [
      'Webcam Horizontal Mirroring: added natural selfie-mode mirroring by default in live preview, recording pipeline, and stream composer with user toggle switch.',
      'Screen Edge Clamping: clamped auto-zoom translations strictly to footage boundaries, preventing left/right window text and tabs from clipping off-screen on laptops (1366x768 and above).',
      'Windows Voiceover Sync: added PTS normalization (-avoid_negative_ts make_zero, -af aresample=async=1) and CFR encoding to eliminate startup audio drift.',
      'AudioContext Auto-Resume: ensured Web Audio initialization unblocks immediately without input delay.',
      'Clean Dynamic Inset: optimized default cinematic inset and corner radius for crisp framing across all screen sizes.',
    ],
  },
  {
    version: '1.12.9',
    date: '2026-08-31',
    headline: 'Package Manager & 1-Click Auto Install',
    detail:
      'In-app standalone package and AI model manager with 1-click automatic downloading of FFmpeg, FFprobe, and Whisper speech models across Windows, macOS, and Linux.',
    items: [
      'In-App Packages & Models Manager: survey, download, and manage FFmpeg, FFprobe, and Whisper speech models with 1-click.',
      'Auto-Download on Export: interactive 1-click installer inside the Export dialog when FFmpeg is missing, resuming export instantly.',
      'Cross-Platform Binary Isolation: binaries install to internal user directory without requiring brew, chocolatey, or root permissions.',
      'Native Windows Branding: fixed window titles and system menu bars to display FrontierCut.',
      'Eliminated platform-specific brew install error messages across export, screen recording, and transcription.',
    ],
  },
  {
    version: '1.12.8',
    date: '2026-08-31',
    headline: 'Background Export, Cancellation & Speed Overhaul',
    detail:
      'Live background rendering with header progress pill, instant export cancellation, zero-delay microtask yield speed boost, and completion chime.',
    items: [
      'Instant export cancellation with AbortController, process SIGKILL, and temp file cleanup.',
      'Background rendering support with interactive status and live progress pill in the top header.',
      'Zero-delay MessageChannel event-loop yielding (fastYield) cutting render yield latency by over 90%.',
      'Harmonic Web Audio API chime and desktop notifications upon render completion.',
      'PowerSaveBlocker integration preventing OS CPU throttling and sleep during exports.',
    ],
  },
  {
    version: '1.12.7',
    date: '2026-08-31',
    headline: 'Classic Clean Captions & FrontierCut Brand',
    detail:
      'Tutorial skill now defaults to clean classic subtitle typography, and in-app branding is fully updated to FrontierCut.',
    items: [
      'Removed distracting kinetic typography from tutorial skill assembly, preserving pristine classic subtitle legibility.',
      'Updated in-app header, home view, and navigation identity to official FrontierCut branding and F logo mark.',
      'Streamlined caption tracks and speech alignment for clean video production.',
    ],
  },
  {
    version: '1.12.6',
    date: '2026-08-31',
    headline: 'Windows & Playback Performance Overhaul',
    detail:
      'Hardware GPU rasterization, zero-copy video decoding, eliminated drag lag, and decoupled 60 FPS playback re-renders.',
    items: [
      'Configured Chromium GPU hardware acceleration switches and OOP rasterization on Windows to eliminate software rendering lag.',
      'Scoped titlebar drag regions to macOS, eliminating continuous mousemove hit-testing lag on Windows.',
      'Decoupled React component tree from 60 FPS playback loop, preventing full-tree reconciliation during timeline playback.',
      'Optimized backend binary survey with fast asynchronous filesystem scanning.',
    ],
  },
  {
    version: '1.12.5',
    date: '2026-08-30',
    headline: 'Native OpenCode Copilot & Brand Demo',
    detail:
      'Native OpenCode AI backend integration with local-first Devstral routing and reverse-engineered brand demo project.',
    items: [
      'Added OpenCode as a native first-class backend in the Copilot engine with automatic binary detection.',
      'Support for local-first Devstral 24B execution at zero token cost with cloud escalation.',
      'Bundled reverse-engineered Sample Brand Demo project timeline with multi-layer keyframed motion and audio tracks.',
      'MCP stdio bridge resilience improvements for offline and detached editor states.',
    ],
  },
  {
    version: '1.11.5',
    date: '2026-08-29',
    headline: 'Antigravity starter prompts & instant launch',
    detail:
      'Launch Antigravity IDE directly with rich starter messages, custom prompt input, and instant clipboard transfer.',
    items: [
      'Interactive starter prompts (Describe timeline, Cut silence, Add kinetic captions, Cinematic grade, Beat sync) launch Antigravity in 1 click.',
      'Type custom instructions directly in the Copilot drawer to copy them to the clipboard and focus Antigravity immediately.',
      'Toast notification confirms message copying and provides ⌘V pasting guidance.',
    ],
  },
  {
    version: '1.11.4',
    date: '2026-08-29',
    headline: 'Antigravity IDE connected view & 1-click launch',
    detail:
      'Replaced the Copilot chat drawer with an Antigravity IDE Connected banner when Antigravity is active, with 1-click launch right from Kerf.',
    items: [
      'Copilot drawer presents a dedicated Antigravity IDE Connected banner with live status when Antigravity backend is active.',
      'One-click "Open in Antigravity IDE" button automatically brings Antigravity to the foreground.',
      'Seamless timeline editing over MCP without running local CLI commands or configuring API keys.',
    ],
  },
  {
    version: '1.11.3',
    date: '2026-08-29',
    headline: 'Direct agent connection & free API key access',
    detail:
      'Added direct MCP status indicator for Antigravity IDE and 1-click links to obtain free API keys directly from model providers.',
    items: [
      'Agent Picker displays real-time Antigravity IDE connection over MCP on port 3888.',
      'Added direct 1-click links to get free Gemini API keys from Google AI Studio and console keys for OpenAI, Anthropic, and Cursor.',
      'Added shell.openExternal IPC support for reliable in-browser link navigation from the desktop app.',
    ],
  },
  {
    version: '1.11.2',
    date: '2026-08-29',
    headline: 'Sidebar rail update tile and layering',
    detail:
      'Converted update notices in the 76px sidebar rail into sleek icon tiles to prevent text squishing and clipping.',
    items: [
      'Update and restart notices in the narrow sidebar rail now render as native rail tiles that fit the 76px column.',
      'Full update descriptions continue to be featured on the top promo carousel without distortion.',
      'Refined dropdown menu z-index and border styling in the version footer for clean layering over all surfaces.',
    ],
  },
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
