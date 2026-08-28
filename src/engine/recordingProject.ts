/* ═══════════════════════════════════════════════════════════════════
   A finished take, turned into a project.

   The point of this file is a claim that has to be true for the whole
   feature to be worth anything: **a recording arrives as an EDIT, not
   as a render.** Everything below is built out of the same store
   actions the UI and the MCP tools use — tracks, clips, a transform, a
   mask, keyframes, markers, captions — so there is nothing here a user
   or an agent cannot then take apart.

   That rules out the shortcut every screen recorder takes, which is to
   composite the camera into the picture while recording and hand over
   one flattened file. It is much less code and it is a dead end: you
   cannot move the bubble, resize it, mute the narration under the
   beeps, cut the camera away, or change a zoom you disagree with.

   ── Two ways in ────────────────────────────────────────────────────

   `RAW_ASSEMBLE` lays the take down and stops: screen, camera, voice.
   Nothing interpreted, nothing to undo.

   `TUTORIAL_ASSEMBLE` is the skill. Zooms on real clicks, the cinematic
   frame, the camera taking over while nobody is doing anything, click
   ticks, and captions. Every one of them is a normal edit on a normal
   track, so "apply the skill" and "then change your mind about half of
   it" are both possible.

   ── The stack, bottom to top ───────────────────────────────────────

     A · Sound design   click ticks and zoom air
     A · Narration      the microphone, split off the camera clip
     V · Backdrop       a gradient, so the picture is inset INTO
                        something rather than floating on black
     V · Screen         the display, rounded and inset, carrying the zoom
     V · Camera         the webcam, an inset that grows to fill the frame
                        while nothing is happening on screen
     V · Captions       the narration, in Inter Bold
     V · Grade          the dip from black and the dip to black

   Tracks are added bottom-first because `addTrack` unshifts and the
   compositor paints highest index first. Get that backwards and the
   backdrop covers the film.

   ── Why the camera clip starts late ────────────────────────────────

   Two MediaRecorders started in the same tick do not begin at the same
   instant. `screenCapture.ts` measures the gap from both `onstart`
   events and it lands here as `cameraOffsetMs`; the camera clip is
   pushed that far along the timeline. Skip it and the take is
   permanently out of sync by a few frames, in the direction nobody
   thinks to check.
   ═══════════════════════════════════════════════════════════════════ */

import { useTimelineStore } from '../store/timelineStore';
import { useProjectStore } from '../store/projectStore';
import {
  AspectRatio, ASPECT_DIMENSIONS, Clip, ClipTextStyle, MediaAsset, ProjectSettings,
} from '../types/edl';
import { getClipBaseSize } from './geometry';
import { computePipGeometry, buildPipPatch, PIP_FIT_MODE } from './pictureInPicture';
import { Take } from './screenCapture';
import {
  detectMoments, findQuietStretches, keepClearOfZooms, zoomKeyframes,
  ZoomMoment, ZoomShape, QuietStretch, DEFAULT_SHAPE, CUT_SHAPE,
} from './cursorZoom';
import {
  LookOptions, DEFAULT_LOOK, addBackdrop, applyScreenLook, addFades,
  addCameraMotion, cameraCanFillFrame, CAMERA_TAKEOVER_MS,
} from './cinematicLook';
import { prepareSoundKit, placeSoundDesign, SoundOptions, DEFAULT_SOUND } from './recordingSound';
import { formatFileSize } from '../utils/time';

/* ── Speech ─────────────────────────────────────────────────────── */

/**
 * One line of transcribed narration, in TAKE time.
 *
 * It is here rather than in a captions module because it does two jobs,
 * and the second is the less obvious one: the words are what tell the
 * edit where the sentences are. A cut to the camera that lands mid-word
 * is a mistake you can hear, and no amount of looking at the picture
 * would have found it.
 */
export interface SpeechCue {
  startMs: number;
  endMs: number;
  text: string;
}

/* ── Options ────────────────────────────────────────────────────── */

export interface AssembleOptions {
  /* arrangement */
  detachNarration: boolean;
  cameraSizePct: number;
  cameraCorner: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

  /* motion */
  autoZoom: boolean;
  zoomShape: ZoomShape;
  motionBlur: boolean;
  markMoments: boolean;

  /* look */
  cinematic: boolean;
  look: LookOptions;
  /** Let the camera take the whole frame while nothing is happening. */
  cameraOnPauses: boolean;
  /**
   * Open on the face when the take opens with an introduction.
   *
   * Separate from `cameraOnPauses` because it is a different decision
   * with a different test: a pause is found in the POINTER track, an
   * introduction is found in the WORDS, and somebody may well want one
   * without the other. See `detectIntroduction`.
   */
  cameraOnIntro: boolean;

  /* sound */
  sound: boolean;
  soundOptions: SoundOptions;

  /* words */
  captions: boolean;
  captionStyle: Partial<ClipTextStyle>;
  /** Transcribed narration, in take time. Empty when it was not run. */
  speech: SpeechCue[];
}

/**
 * Captions in Inter Bold, on a chip.
 *
 * A stroke is what Kerf's default caption style uses and it is the right
 * choice over footage. Over a SCREEN it is not: screen content is mostly
 * flat light greys with thin dark type, and an outlined white caption
 * sitting on it competes with the text underneath. A solid chip
 * separates the two planes, which is what every tutorial that is
 * readable does.
 */
export const CAPTION_STYLE: Partial<ClipTextStyle> = {
  fontFamily: 'Inter',
  fontWeight: 700,
  fontSize: 46,
  color: '#ffffff',
  strokeWidth: 0,
  shadowBlur: 0,
  shadowOffsetY: 0,
  shadowColor: 'rgba(0,0,0,0)',
  background: 'rgba(8,10,14,0.82)',
  backgroundPadding: 22,
  backgroundRadius: 12,
  align: 'center',
  letterSpacing: -0.2,
  lineHeight: 1.25,
  uppercase: false,
  kineticAnimation: 'none',
};

/** Lay the take down and stop. */
export const RAW_ASSEMBLE: AssembleOptions = {
  detachNarration: true,
  cameraSizePct: 24,
  cameraCorner: 'bottom-right',
  autoZoom: false,
  zoomShape: DEFAULT_SHAPE,
  motionBlur: false,
  markMoments: false,
  cinematic: false,
  look: DEFAULT_LOOK,
  cameraOnPauses: false,
  cameraOnIntro: false,
  sound: false,
  soundOptions: DEFAULT_SOUND,
  captions: false,
  captionStyle: CAPTION_STYLE,
  speech: [],
};

/**
 * The skill: everything on, and cutting rather than pushing.
 *
 * `zoomShape` is the one field here that is not simply a switch, and it
 * is the whole difference between this and what the skill used to build.
 * `CUT_SHAPE` is the reference video's grammar — hard cuts between
 * framings, a slow creep under each one, and one long move back to rest
 * at the end — with every number in it measured off that file. The
 * comment on `CUT_SHAPE` is where the measurements are.
 */
export const TUTORIAL_ASSEMBLE: AssembleOptions = {
  ...RAW_ASSEMBLE,
  autoZoom: true,
  zoomShape: CUT_SHAPE,
  motionBlur: true,
  markMoments: true,
  cinematic: true,
  cameraOnPauses: true,
  cameraOnIntro: true,
  sound: true,
  captions: true,
};

export const DEFAULT_ASSEMBLE = TUTORIAL_ASSEMBLE;

/* ── The report ─────────────────────────────────────────────────── */

export interface AssembleReport {
  projectName: string;
  /**
   * The screen clip this build produced.
   *
   * The anchor a background pass checks before writing anything. A
   * project ID is NOT enough: `buildStarterProject` replaces every track
   * in place without minting a new one, so an id comparison says "same
   * project" about a timeline that has been entirely swapped. A clip id
   * is minted per build and cannot survive that.
   */
  screenClipId: string;
  durationMs: number;
  width: number;
  height: number;
  fps: 24 | 30 | 60;
  clips: number;
  tracks: number;
  zoomMoments: number;
  /** Which detector the moments came from. */
  momentsFrom: 'events' | 'cursor' | 'none';
  keyframes: number;
  cameraTakeovers: number;
  /**
   * How long the film opens on the face, when it was found to open with
   * an introduction. 0 when it did not.
   */
  introductionMs: number;
  soundClips: number;
  captionLines: number;
  narrationDetached: boolean;
  /**
   * True when the transcript could not be waited for, so the camera cuts
   * were placed from activity and the captions arrive later.
   */
  transcribedInBackground?: boolean;
  notes: string[];
}

/* ── Canvas ─────────────────────────────────────────────────────── */

/** H.264 refuses odd dimensions, and every export path here ends in it. */
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

const LONG_EDGE_CAP = 2560;

/**
 * The canvas for a recording of this size.
 *
 * The source keeps its full resolution on disk — this only decides what
 * the SEQUENCE is, and a 5K display in a 5K sequence means every preview
 * frame composites 14.7 million pixels for a video that will be watched
 * at 1080p. Capping the long edge keeps the editor responsive; the
 * footage is still there to zoom into, which is the one thing the extra
 * resolution is actually good for.
 */
export function canvasFor(width: number, height: number): {
  width: number; height: number; aspectRatio: AspectRatio;
} {
  const longEdge = Math.max(width, height);
  const scale = longEdge > LONG_EDGE_CAP ? LONG_EDGE_CAP / longEdge : 1;
  const w = even(width * scale);
  const h = even(height * scale);

  /*
    A LABEL, and only a label. The canvas dimensions are set explicitly
    above and nothing derives them from this; `ASPECT_DIMENSIONS` is read
    only when a user picks a ratio from the header menu, at which point
    they have asked for that shape.

    Nearest is measured on the LOG of the ratio rather than on the ratio
    itself, because a plain difference is not symmetric — it is biased
    toward the smaller ratios, so 2:1 looks "further" from 16:9 than 4:3
    is by the same factor.

    It will still sometimes read oddly, and that is worth saying rather
    than tuning away: the six ratios Kerf offers have nothing between
    1.333 and 1.778, and a great many real displays live in that gap. A
    3024x1964 laptop is 1.539, almost exactly halfway, and comes out
    labelled 4:3 by a margin of 0.0005. Putting a thumb on the scale to
    make one machine read better would be a fudge dressed as arithmetic.
  */
  const ratio = w / h;
  let aspectRatio: AspectRatio = '16:9';
  let best = Infinity;
  for (const key of Object.keys(ASPECT_DIMENSIONS) as AspectRatio[]) {
    const dims = ASPECT_DIMENSIONS[key];
    const gap = Math.abs(Math.log(dims.width / dims.height) - Math.log(ratio));
    if (gap < best) { best = gap; aspectRatio = key; }
  }

  return { width: w, height: h, aspectRatio };
}

/* ── Speech-aware cutting ───────────────────────────────────────── */

/** Minimum length of a camera segment once the words have had their say. */
const MIN_TAKEOVER_MS = 1600;

/**
 * Move a quiet stretch off the words.
 *
 * The pointer says when nothing is happening on screen. It says nothing
 * at all about whether somebody is mid-sentence, and cutting to a face
 * halfway through a word is the one edit everybody notices. So when a
 * transcript exists the stretch is trimmed inward to the nearest gap
 * BETWEEN cues, and dropped entirely if there is no room left.
 *
 * There is a second, less obvious rule here, and it is why the camera
 * does not simply appear whenever the screen is idle: a stretch with no
 * speech in it is dead air, and a static face over dead air is worse
 * than a static screen. The camera takes over when somebody is TALKING
 * and not doing — which is exactly the moment a face is the most
 * interesting thing available.
 */
export function alignToSpeech(
  stretch: QuietStretch,
  speech: SpeechCue[]
): QuietStretch | null {
  if (speech.length === 0) return stretch;

  const covering = speech.filter((cue) => cue.endMs > stretch.startMs && cue.startMs < stretch.endMs);
  if (covering.length === 0) return null;

  /* Start after whichever cue was already running, end before whichever
     one has begun by the far edge. Both are no-ops when the stretch
     already sits in a gap. */
  const first = covering[0];
  const last = covering[covering.length - 1];
  const startMs = first.startMs < stretch.startMs ? Math.max(stretch.startMs, first.endMs) : stretch.startMs;
  const endMs = last.endMs > stretch.endMs ? Math.min(stretch.endMs, last.startMs) : stretch.endMs;

  if (endMs - startMs < MIN_TAKEOVER_MS) return null;

  /* And require the stretch to actually contain speech. */
  const spoken = speech
    .filter((cue) => cue.endMs > startMs && cue.startMs < endMs)
    .reduce((sum, cue) => sum + (Math.min(cue.endMs, endMs) - Math.max(cue.startMs, startMs)), 0);
  if (spoken < (endMs - startMs) * 0.45) return null;

  return { startMs, endMs };
}

/* ── The introduction ───────────────────────────────────────────── */

/**
 * A spoken opening, with the camera on it.
 *
 * Somebody who starts a tutorial by saying who they are and what they
 * are about to show you is not narrating a screen — the screen is
 * usually sitting there doing nothing — and an inset webcam in the
 * corner of a static desktop is the worst framing available for it.
 * Every good tutorial opens on the face and cuts to the screen when the
 * work starts.
 *
 * ── The whole difficulty is being SURE ──────────────────────────────
 *
 * Getting this wrong in the other direction is worse than not having it:
 * a take that opens with "right, so first click on Settings" and gets a
 * full-frame face over it has hidden the thing the viewer came for. So
 * the test is deliberately hard to pass, and it is three independent
 * kinds of evidence rather than one:
 *
 *   1. **BEHAVIOUR, and it is the one that can veto on its own.** An
 *      introduction is a stretch where nothing is happening on screen.
 *      If there is a click, a keystroke or a scroll, the person is
 *      working, whatever they are saying. This does not depend on the
 *      transcript being any good.
 *   2. **SHAPE.** It starts at the start, it runs continuously, and it
 *      is long enough to be a thing rather than a stray word.
 *   3. **WORDS.** Greeting, self-identification, and framing of what is
 *      to come. Two of the three kinds, because any one of them alone is
 *      ordinary speech: "today" is not an introduction, "hi" is not an
 *      introduction, and both together nearly always are. Saying your
 *      own name counts as two, because nothing else in a screen
 *      recording sounds like that.
 *
 * And one veto on the words: pointing at the screen. "Here you can see",
 * "as you can see", "over on the left" — somebody doing that is looking
 * at the picture even if they have not touched the mouse yet, and the
 * camera must not be covering it.
 *
 * Every marker below is a phrase somebody would say out loud, so this
 * fails on a language it has never been given markers for rather than
 * guessing. That is the right failure: no introduction detected means
 * the camera stays an inset, which is what the skill did before.
 */
const INTRO_MARKERS = {
  greeting: /\b(hi|hey|hello|good (morning|afternoon|evening)|welcome (to|back)|what'?s up)\b/i,
  /*
    Two patterns, and the split is the point: the phrase markers are
    case-insensitive, and the ones that lean on a CAPITALISED name
    cannot be. Written as one case-sensitive alternation, "My name is"
    at the start of a sentence did not match its own marker, the
    introduction was still accepted through `NAMED`, and the evidence
    came back empty. Whisper capitalises sentences and names, so both
    halves are worth having.
  */
  self: [
    /\b(my name(?:'s| is)|i work (?:at|on|with)|i'?m the )/i,
    /\b(i'?m [A-Z][a-z]+|this is [A-Z][a-z]+ (?:here|from|with))/,
  ],
  framing: new RegExp(
    "\\b(today|in this (video|tutorial|demo|walkthrough|one)"
    + "|i'?m going to (show|walk|take|talk)|i'?m gonna (show|walk|take)"
    + "|we'?re going to|we'?ll be|let me show you|let'?s (take a look|walk|dive)"
    + "|i'?ll (show|walk)|i want(ed)? to show|quick (demo|tour|walkthrough|look)"
    + "|walk you through|give you a (quick )?(tour|look)"
    + "|in the next few minutes)\\b",
    'i'
  ),
} as const;

/** Somebody pointing at the screen is not introducing themselves. */
const POINTING_AT_SCREEN =
  /\b(here you (can )?see|as you can see|you'?ll see (here|there)|over (here|there)|on the (left|right)|down (here|there)|up (here|there)|this (screen|page|window|button|tab)|right here)\b/i;

/** The self-identification marker is worth two on its own. */
const NAMED = /\b(my name(?:'s| is))/i;

export interface IntroDetectOptions {
  /** The first cue has to start this soon, or the take opens with something else. */
  leadMs: number;
  /** A silence longer than this ends it. */
  gapMs: number;
  /** Shorter than this is a stray remark, not an opening. */
  minMs: number;
  /** Longer than this is truncated, and said so. */
  maxMs: number;
  /** Share of the span that has to be spoken over. */
  minCoverage: number;
}

export const DEFAULT_INTRO: IntroDetectOptions = {
  leadMs: 2000,
  gapMs: 1200,
  minMs: 2500,
  maxMs: 45000,
  minCoverage: 0.6,
};

export interface IntroductionVerdict {
  /** The stretch to put the camera over, in TAKE time. Null when there is none. */
  intro: QuietStretch | null;
  /** Which markers fired. Empty when it was refused. */
  evidence: string[];
  /** Always set, and it says why either way. */
  reason: string;
}

export function detectIntroduction(
  speech: SpeechCue[],
  events: { tMs: number; kind: string }[],
  options: Partial<IntroDetectOptions> = {}
): IntroductionVerdict {
  const o = { ...DEFAULT_INTRO, ...options };
  const none = (reason: string): IntroductionVerdict => ({ intro: null, evidence: [], reason });

  const cues = [...speech].sort((a, b) => a.startMs - b.startMs);
  if (cues.length === 0) {
    return none('There is no transcript, so nothing here can tell an introduction from a demo.');
  }
  if (cues[0].startMs > o.leadMs) {
    return none(
      `The first words are ${Math.round(cues[0].startMs)}ms in, past the ${o.leadMs}ms an opening `
      + 'has to start within, so the take does not begin by talking.'
    );
  }

  /* 1 — behaviour. The first thing done on screen ends any opening,
         and something done immediately means there was not one. */
  const firstAction = events
    .filter((e) => e.kind === 'click' || e.kind === 'rightclick' || e.kind === 'scroll' || e.kind === 'key')
    .reduce((min, e) => Math.min(min, e.tMs), Infinity);

  /* 2 — shape. Extend through the cues while they keep coming and
         nothing has been done on screen. */
  let endMs = cues[0].endMs;
  let spoken = cues[0].endMs - cues[0].startMs;
  const text: string[] = [cues[0].text];
  for (let i = 1; i < cues.length; i++) {
    const cue = cues[i];
    if (cue.startMs - endMs > o.gapMs) break;
    if (cue.startMs >= firstAction) break;
    endMs = cue.endMs;
    spoken += cue.endMs - cue.startMs;
    text.push(cue.text);
  }

  const startMs = Math.min(cues[0].startMs, 0) === 0 ? 0 : cues[0].startMs;
  endMs = Math.min(endMs, firstAction);

  const lengthMs = endMs - startMs;
  if (lengthMs < o.minMs) {
    return none(
      `The opening runs ${Math.round(lengthMs)}ms before ${
        Number.isFinite(firstAction) ? 'something is done on screen' : 'the talking stops'
      }, which is under the ${o.minMs}ms an introduction has to last.`
    );
  }

  const coverage = spoken / Math.max(1, lengthMs);
  if (coverage < o.minCoverage) {
    return none(
      `Only ${Math.round(coverage * 100)}% of the opening ${Math.round(lengthMs)}ms is spoken over, `
      + `under the ${Math.round(o.minCoverage * 100)}% an introduction needs. That is a pause, not a talk.`
    );
  }

  /* 3 — words. */
  const said = text.join(' ');
  if (POINTING_AT_SCREEN.test(said)) {
    return none(
      'The opening points at the screen, so whatever else it is doing it is showing '
      + 'something, and the camera must not cover it.'
    );
  }

  const evidence: string[] = [];
  if (INTRO_MARKERS.greeting.test(said)) evidence.push('a greeting');
  if (INTRO_MARKERS.self.some((re) => re.test(said))) evidence.push('naming themselves');
  if (INTRO_MARKERS.framing.test(said)) evidence.push('framing what is coming');

  const decisive = NAMED.test(said);
  if (!decisive && evidence.length < 2) {
    return none(
      evidence.length === 0
        ? 'The opening does not read as an introduction: no greeting, no name, and nothing '
          + 'framing what is about to be shown.'
        : `The opening only ${evidence[0]}, and one marker on its own is ordinary speech. `
          + 'Two kinds are needed, or somebody saying their own name.'
    );
  }

  const capped = Math.min(endMs, startMs + o.maxMs);
  const truncated = capped < endMs;

  return {
    intro: { startMs, endMs: capped },
    evidence,
    reason:
      `The take opens with ${evidence.join(' and ')} over ${Math.round((capped - startMs) / 100) / 10}s `
      + 'with nothing happening on screen, so the camera takes the frame for it.'
      + (truncated
        ? ` It ran longer than the ${o.maxMs / 1000}s ceiling and was cut back to it.`
        : ''),
  };
}

/* ── Building it ────────────────────────────────────────────────── */

let takeSeq = 0;

function clipById(clipId: string): Clip | null {
  for (const track of useTimelineStore.getState().tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return clip;
  }
  return null;
}

function stampName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Screen recording · ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    + ` ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export async function assembleRecording(
  take: Take,
  options: Partial<AssembleOptions> = {}
): Promise<AssembleReport> {
  const o = { ...DEFAULT_ASSEMBLE, ...options };
  const notes = [...take.warnings];

  const screen = take.screen;
  if (!screen) {
    throw new Error('The take has no screen file, so there is nothing to build a project from.');
  }

  /* ── 1. Decide everything before touching the store ─────────────
     Detection is pure, and doing it first means the tracks that get
     created are only the ones that will hold something. */

  const canvas = canvasFor(screen.width, screen.height);
  const detected = o.autoZoom && take.cursorTracked
    ? detectMoments({ cursor: take.cursor, events: take.events, marks: take.marks })
    : { moments: [] as ZoomMoment[], from: 'cursor' as const };
  /* Not `const`: an introduction takes the frame, and any zoom underneath
     it is dropped rather than left playing where nobody can see it. */
  let moments = detected.moments;

  let takeovers: QuietStretch[] = [];
  let introMs = 0;
  const cameraFill = take.camera
    ? cameraCanFillFrame(take.camera, canvas)
    : { ok: false, upscale: Infinity };

  /*
    The introduction, decided BEFORE the pauses and merged in after them.

    It is not a quiet stretch and must not go through their filters:
    `findQuietStretches` reads the pointer and would not find this at
    all when somebody sits still and talks, `alignToSpeech` trims a
    stretch inward to a gap between sentences, which is exactly wrong for
    an opening that should start on the first frame, and
    `keepClearOfZooms` pushes a stretch past a zoom that is still in
    flight, of which there are none at t=0.
  */
  const intro = o.cameraOnIntro && take.camera && cameraFill.ok
    ? detectIntroduction(o.speech, take.events)
    : null;

  if (o.cameraOnIntro && take.camera && cameraFill.ok && intro && !intro.intro && o.speech.length > 0) {
    notes.push(`The film does not open on the camera. ${intro.reason}`);
  }

  if (o.cameraOnPauses && take.camera) {
    if (!cameraFill.ok) {
      if (cameraFill.reason) notes.push(cameraFill.reason);
    } else {
      takeovers = keepClearOfZooms(
        findQuietStretches(
          { cursor: take.cursor, events: take.events, marks: take.marks },
          take.durationMs
        ),
        moments,
        o.zoomShape,
        MIN_TAKEOVER_MS
      )
        .map((stretch) => alignToSpeech(stretch, o.speech))
        .filter((stretch): stretch is QuietStretch => stretch !== null);

      if (takeovers.length === 0 && o.speech.length > 0 && !intro?.intro) {
        notes.push(
          'No pause was both long enough and spoken over, so the camera stays an inset. '
          + 'It takes the frame when you are talking and not doing, not merely when the '
          + 'screen is still.'
        );
      }
    }
  }

  /*
    Merge the introduction in, absorbing any pause that runs into it.

    Two adjoining full-frame stretches would otherwise pull the camera
    back to its inset and straight out again for a few frames, which is
    the same bounce `planZoom` exists to avoid, in the other track.
  */
  if (intro?.intro) {
    const opening = intro.intro;
    const overlapping = takeovers.filter((t) => t.startMs <= opening.endMs + MIN_TAKEOVER_MS);
    const merged: QuietStretch = {
      startMs: opening.startMs,
      endMs: Math.max(opening.endMs, ...overlapping.map((t) => t.endMs)),
    };
    takeovers = [merged, ...takeovers.filter((t) => t.startMs > opening.endMs + MIN_TAKEOVER_MS)];
    introMs = merged.endMs - merged.startMs;
    notes.push(intro.reason);

    /*
      And drop any zoom that would play under it. It would be invisible,
      but it would still put a marker on the timeline and a whoosh on the
      sound track for a move nobody can see.
    */
    const before = moments.length;
    moments = moments.filter((m) => m.atMs >= merged.endMs);
    if (moments.length < before) {
      notes.push(
        `${before - moments.length} zoom${before - moments.length === 1 ? '' : 's'} fell inside the `
        + 'introduction and were dropped: the camera is covering the screen there.'
      );
    }
  }

  /* The only slow, file-writing part, and it happens before the
     transaction opens rather than inside it. */
  const soundKit = o.sound && take.events.length + moments.length > 0
    ? await prepareSoundKit(take.dir, {
      clicks: o.soundOptions.clicks && take.events.some((e) => e.kind === 'click' || e.kind === 'rightclick'),
      whooshes: o.soundOptions.whooshes && moments.length > 0,
    })
    : null;

  /* ── 2. The project ─────────────────────────────────────────────── */

  const now = Date.now();
  const projectName = stampName();
  const settings: ProjectSettings = {
    id: `proj_rec_${now.toString(36)}`,
    name: projectName,
    aspectRatio: canvas.aspectRatio,
    width: canvas.width,
    height: canvas.height,
    /* The EDL allows three frame rates and the capture offers two of
       them, so this is the recorded rate rather than a default. A 60fps
       take shown at 30 throws away half the frames it paid for. */
    fps: take.fps,
    durationMs: Math.max(1000, take.durationMs),
    backgroundColor: '#000000',
    createdAt: now,
    updatedAt: now,
  };

  // Start from nothing, so recording twice does not stack two takes.
  useTimelineStore.getState().loadProject([], []);
  useProjectStore.getState().loadProjectSettings(settings);

  /*
    And empty the media pool, which `loadProject` does not touch.

    Without this the Media panel of a brand new recording opens on the
    seed project's six demo stills plus whatever the last project
    imported, with the take somewhere among them. The panel is where a
    user goes to find the camera file to drag onto a second track, and
    burying it under unrelated media is the difference between "here is
    your take" and "your take is in here somewhere".
  */
  for (const asset of [...useTimelineStore.getState().mediaPool]) {
    useTimelineStore.getState().removeMediaAsset(asset.id);
  }

  const store = () => useTimelineStore.getState();

  /*
    One history entry for the whole build.

    Every store action commits on its own, and a take with twenty zoom
    moments writes over three hundred keyframes — three hundred full
    clones of the timeline pushed onto the undo stack, which is both
    slow and useless, since undoing a recording one keyframe at a time
    is nobody's intent.
  */
  store().beginTransaction();

  const seq = ++takeSeq;

  /* ── 3. Tracks, bottom of the stack first ───────────────────────── */

  const soundTrack = soundKit && (soundKit.click || soundKit.whoosh)
    ? store().addTrack('audio', 'A2 · Sound design')
    : null;
  const backdropTrack = o.cinematic && o.look.backdrop !== 'none'
    ? store().addTrack('video', 'V1 · Backdrop')
    : null;
  const screenTrack = store().addTrack('video', 'V2 · Screen');
  const cameraTrack = take.camera && take.camera.url
    ? store().addTrack('video', 'V3 · Camera')
    : null;
  const captionTrack = o.captions && o.speech.length > 0
    ? store().addTrack('text', 'T1 · Captions')
    : null;
  const gradeTrack = o.cinematic && (o.look.fadeInMs > 0 || o.look.fadeOutMs > 0)
    ? store().addTrack('video', 'V4 · Grade')
    : null;

  /* ── 4. The backdrop ────────────────────────────────────────────── */

  if (backdropTrack) addBackdrop(backdropTrack, settings, take.durationMs, o.look.backdrop);

  /* ── 5. The screen ──────────────────────────────────────────────── */

  const screenAsset: MediaAsset = {
    id: `media_rec_screen_${seq}_${now.toString(36)}`,
    name: 'Screen.mp4',
    type: 'video',
    url: screen.url,
    thumbnailUrl: '',
    durationMs: take.durationMs,
    width: screen.width,
    height: screen.height,
    fileSizeFormatted: formatFileSize(screen.bytes),
    codec: screen.raw ? 'WebM' : 'H.264',
  };
  store().addMediaAsset(screenAsset);
  const screenClipId = store().insertClip(screenTrack, screenAsset, 0);
  store().patchClip(screenClipId, { name: 'Screen', fitMode: 'cover' });

  /*
    The scale the picture RESTS at.

    `fitScale` is what makes the whole frame visible with nothing
    cropped: the canvas is cut to the take's aspect ratio so this is
    normally 1, but it is computed rather than assumed — the even-number
    rounding in `canvasFor` can shift the ratio by a fraction of a
    percent, and a zoom built on the assumption would leave a hairline of
    background down one edge.

    The inset is then a fraction of that, and it is the same number the
    zoom is built on top of, which is why it is decided here and nowhere
    else.
  */
  let restScale = 1;
  let keyframeCount = 0;
  {
    const clip = clipById(screenClipId);
    if (clip) {
      const base = getClipBaseSize(clip, settings, { width: screen.width, height: screen.height });
      const fitScale = Math.min(settings.width / base.width, settings.height / base.height);
      restScale = o.cinematic ? fitScale * (o.look.insetPct / 100) : fitScale;

      if (o.cinematic) applyScreenLook(screenClipId, settings, o.look);
      if (restScale !== 1) {
        store().patchClip(screenClipId, {
          'transform.scaleX': restScale,
          'transform.scaleY': restScale,
        });
      }

      if (moments.length > 0) {
        const keyframes = zoomKeyframes(
          moments,
          take.durationMs,
          {
            baseWidth: base.width,
            baseHeight: base.height,
            restScale,
            canvasWidth: settings.width,
            canvasHeight: settings.height,
            /* Only with a backdrop behind the picture. Without one the
               vacated edge would show the project's black background,
               which reads as a rendering fault rather than as framing. */
            edgeOverhang: o.cinematic && o.look.backdrop !== 'none' ? 0.16 : 0,
          },
          o.zoomShape,
          /*
            The frame has to be back at rest before the dip to black
            starts, not by the last frame of the film.

            With the pushing grammar this never mattered — the pull-out
            is 560ms and lands long before the tail. The cutting
            grammar's closing move is 2100ms, which is more than three
            times the fade, so without this the film dips to black in the
            middle of a camera move. It is the kind of thing that reads
            as "the render broke" rather than as a choice.
          */
          Math.max(1, take.durationMs - (o.cinematic ? o.look.fadeOutMs : 0))
        );
        for (const keyframe of keyframes) {
          store().addKeyframe(screenClipId, {
            property: keyframe.property,
            timeOffsetMs: keyframe.timeOffsetMs,
            value: keyframe.value,
            easing: keyframe.easing,
            ...(keyframe.bezierPoints ? { bezierPoints: keyframe.bezierPoints } : {}),
          });
        }
        keyframeCount = keyframes.length;

        /*
          Motion blur, and only when there is motion to blur.

          It renders the clip once per sample, so it is `samples` times
          the fill rate for every frame of the take — including the
          ninety percent where nothing is moving and all the samples draw
          the same picture. Four is enough to smear a zoom and cheap
          enough to scrub through; it is off entirely when there are no
          zooms, where it would cost that much for no visible difference
          at all.
        */
        if (o.motionBlur) {
          store().patchClip(screenClipId, {
            'motionBlur.enabled': true,
            'motionBlur.shutterAngle': 180,
            'motionBlur.samples': 4,
          });
        }
      } else if (o.autoZoom) {
        notes.push(
          take.events.length > 0
            ? 'Nothing was clicked, scrolled or typed in this take, so no zooms were added.'
            : 'No moments stood out in the cursor track, so no zooms were added. '
              + 'The take is on the timeline exactly as it was recorded.'
        );
      }
    }
  }

  /* ── 6. The camera ──────────────────────────────────────────────── */

  let cameraClipId: string | null = null;
  if (cameraTrack && take.camera) {
    const camera = take.camera;
    const cameraAsset: MediaAsset = {
      id: `media_rec_camera_${seq}_${now.toString(36)}`,
      name: 'Camera.mp4',
      type: 'video',
      url: camera.url,
      thumbnailUrl: '',
      durationMs: Math.max(200, take.durationMs - take.cameraOffsetMs),
      width: camera.width,
      height: camera.height,
      fileSizeFormatted: formatFileSize(camera.bytes),
      codec: camera.raw ? 'WebM' : 'H.264',
    };
    store().addMediaAsset(cameraAsset);
    cameraClipId = store().insertClip(cameraTrack, cameraAsset, take.cameraOffsetMs);

    const inserted = clipById(cameraClipId);
    if (inserted) {
      /*
        `computePipGeometry` rather than an eyeballed scale. It sizes the
        inset from the SOURCE's aspect ratio and scales both axes by the
        same factor, which is the whole reason it exists: a 4:3 webcam
        given `scaleX = w/canvasW, scaleY = h/canvasH` comes out visibly
        stretched, and nothing in the project reports it.
      */
      const geometry = computePipGeometry({
        project: settings,
        clip: inserted,
        natural: { width: camera.width, height: camera.height },
        sizePct: o.cameraSizePct,
        marginPct: 3.5,
        corner: o.cameraCorner,
        maxHeightPct: 44,
      });
      notes.push(...geometry.warnings);

      const cornerRadius = Math.round(settings.height * (o.cinematic ? 0.022 : 0));
      const patch = buildPipPatch(
        geometry,
        { cornerRadiusPx: cornerRadius },
        { name: 'Camera', startTimeMs: take.cameraOffsetMs, muteAudio: false }
      );
      notes.push(...patch.warnings);
      store().patchClip(cameraClipId, patch.properties);

      /*
        Everything the camera does, as ONE keyframe track.

        `interpolateKeyframes` falls back to the static transform only
        when a property has no keyframes at all, so a clip with a
        keyframed scale and a static position would snap its position to
        whatever the first position key happened to be. `addCameraMotion`
        pins every property that ever moves at time zero for exactly that
        reason.
      */
      if (o.cinematic || takeovers.length > 0) {
        /* Take time to clip time: the camera clip does not start at zero. */
        const base = getClipBaseSize(
          { ...inserted, fitMode: PIP_FIT_MODE },
          settings,
          { width: camera.width, height: camera.height }
        );
        addCameraMotion(cameraClipId, {
          pip: {
            scale: geometry.scaleX,
            x: geometry.transformX,
            y: geometry.transformY,
            roundness: cornerRadius,
          },
          coverScale: Math.max(settings.width / base.width, settings.height / base.height),
          fullFrame: takeovers.map((stretch) => ({
            startMs: stretch.startMs - take.cameraOffsetMs,
            endMs: stretch.endMs - take.cameraOffsetMs,
          })),
          durationMs: cameraAsset.durationMs,
        });
      }
    }

    /* ── The narration, on its own track ── */
    if (o.detachNarration && camera.hasAudio) {
      const detached = store().detachAudio(cameraClipId);
      if (detached.ok && detached.audioTrackId) {
        store().renameTrack(detached.audioTrackId, 'A1 · Narration');
      } else if (detached.error) {
        notes.push(detached.error);
      }
    }
  }

  /* ── 7. Sound design ────────────────────────────────────────────── */

  let soundClips = 0;
  if (soundTrack && soundKit) {
    const report = placeSoundDesign(
      soundTrack, soundKit, take.events, moments, o.zoomShape, o.soundOptions
    );
    soundClips = report.placed;
    notes.push(...report.notes);
  } else if (soundKit) {
    notes.push(...soundKit.notes);
  }

  /* ── 8. Captions ────────────────────────────────────────────────── */

  let captionLines = 0;
  if (captionTrack) {
    captionLines = store().importCaptions(
      o.speech.map((cue, index) => ({
        index: index + 1,
        startMs: cue.startMs,
        endMs: cue.endMs,
        text: cue.text,
      })),
      { trackId: captionTrack, style: o.captionStyle, replaceExisting: true }
    );
  }

  /* ── 9. Opening and closing ─────────────────────────────────────── */

  if (gradeTrack) addFades(gradeTrack, settings, take.durationMs, o.look);

  /* ── 10. Markers ────────────────────────────────────────────────── */

  if (o.markMoments) {
    for (let i = 0; i < moments.length; i++) {
      const moment = moments[i];
      store().addMarker(
        Math.round(moment.atMs),
        moment.source === 'mark' ? `Marked ${i + 1}` : `${moment.source} ${i + 1}`,
        'generic',
        moment.source === 'mark' ? '#d97757' : '#4a90ff'
      );
    }
    for (let i = 0; i < takeovers.length; i++) {
      store().addMarker(Math.round(takeovers[i].startMs), `Camera ${i + 1}`, 'chapter', '#3ddc97');
    }
  }

  store().setPlayheadMs(0);
  store().commitTransaction('Screen recording');

  const finalState = useTimelineStore.getState();
  const clipCount = finalState.tracks.reduce((n, track) => n + track.clips.length, 0);

  return {
    projectName,
    screenClipId,
    durationMs: take.durationMs,
    width: canvas.width,
    height: canvas.height,
    fps: settings.fps,
    clips: clipCount,
    tracks: finalState.tracks.length,
    zoomMoments: moments.length,
    momentsFrom: moments.length === 0 ? 'none' : detected.from,
    keyframes: keyframeCount,
    cameraTakeovers: takeovers.length,
    introductionMs: introMs,
    soundClips,
    captionLines,
    narrationDetached: Boolean(o.detachNarration && take.camera?.hasAudio && cameraClipId),
    notes,
  };
}

/** How long the camera takes to grow into the frame, re-exported for the UI. */
export { CAMERA_TAKEOVER_MS };
