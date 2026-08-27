/* ═══════════════════════════════════════════════════════════════════
   Auto zoom, from the cursor track.

   ── Two detectors, and why there are two ───────────────────────────

   Every screen recorder that does this well is doing one thing: pushing
   the frame in on whatever the viewer is meant to be looking at, and
   pulling back out before it becomes exhausting. The animation is not
   the hard part. Knowing WHERE to look is.

   **`momentsFromEvents` is the good one.** Given real input — clicks,
   scrolls and keystrokes from `electron/inputEvents.ts` — it does not
   guess at all. It clusters: a run of clicks in one place is ONE
   moment that holds for as long as the run; typing that follows a click
   extends that click rather than starting a second zoom, which is what
   makes filling in a form read as one continuous idea; a scroll burst
   is its own kind of moment and gets a gentler push, because reading is
   not pointing.

   **`findZoomMoments` is the fallback, and it is not a bad one.** The
   input hook is a native module and, on macOS, an Accessibility
   permission, so it is not always there. Without it this measures
   ATTENTION from the only signal that is: the pointer, 30 times a
   second. Somebody about to act on something moves the pointer to it
   and stops, and the stop is the signal. That catches clicks, because a
   click is preceded by a settle, and it catches "moved here to point at
   this" too. It misses a click made without moving first, and the UI
   says which detector ran rather than letting the difference be
   invisible.

   The user can also mark a moment during the take, with the bar or the
   Alt+Shift+Z shortcut. Those are explicit, so they always survive and
   they suppress an inferred moment next to them.

   ── The animation ─────────────────────────────────────────────────

   Zooms CHAIN rather than bounce. If a second moment arrives before the
   first has pulled out, the frame travels straight from one to the
   other at zoom instead of snapping back to full frame in between.
   Bouncing out and in over a two-second gap is the single thing that
   makes an auto-zoomed recording unwatchable.

   The curve is an EXPO-OUT bezier, not an ease-in-out, and the
   difference is most of the feel. `easeInOut` spends as long arriving
   as it does leaving, which reads as a slow machine; expo-out is
   almost all of the way there in the first third and then glides, which
   reads as a camera operator who already knew where they were going.
   The pull-out is the mirror of it, slower to leave and decisive at the
   end.

   And a small OVERSHOOT: the push goes 3% past its target and settles
   back over 140ms. It is the difference between a zoom that stops and a
   zoom that arrives. Optional, because on very dense text it can read
   as a wobble.

   ── And a second grammar, which does not animate at all ────────────

   `cutIn` swaps all of the above for the way the reference video edits:
   hard CUTS between framings, a slow creep while each one is held, and
   one animated move in the whole film — the pull back to rest at the
   end. `planCuts` is that, `CUT_SHAPE` is its numbers, and every one of
   those numbers was measured off the reference rather than chosen.

   The two are different edits rather than two settings of one, which is
   why half of `ZoomShape` goes inert under `cutIn`: a push has a
   duration and a curve and an overshoot to settle, and a cut has none
   of the three.

   Everything lands as ordinary keyframes on the clip's own transform.
   No hidden state, no special clip type: the result is something the
   user can drag, retime, or delete key by key in the editor. That is
   the whole point of generating an EDIT rather than a rendered effect.
   A cut is no exception — it is two keyframes with `hold` easing on the
   first, which the format already had and nothing had yet emitted.
   ═══════════════════════════════════════════════════════════════════ */

import { CursorSample, InputEvent } from '../types/electron';
import { Easing } from '../types/edl';

/* ── Moments ────────────────────────────────────────────────────── */

/**
 * Where a moment came from, which decides how hard the frame pushes.
 *
 * `click` and `mark` are certain and get the full push. `type` is a
 * continuation of something you already looked at. `scroll` is reading,
 * and reading wants a wider frame than pointing does. `settle` is the
 * inference the fallback detector makes.
 */
export type MomentSource = 'click' | 'scroll' | 'type' | 'settle' | 'mark';

export interface ZoomMoment {
  /** Milliseconds into the recording. */
  atMs: number;
  /** Where to look, normalised 0..1 across the frame. */
  x: number;
  y: number;
  source: MomentSource;
  /**
   * How long the activity behind this moment ran.
   *
   * The reason a form fill does not pull out halfway through: the hold
   * covers the span, so eight clicks and forty keystrokes over six
   * seconds are one zoom that stays for six seconds, not three zooms
   * fighting each other.
   */
  spanMs: number;
  /** How many raw events folded into it. One for an inferred moment. */
  weight: number;
}

/**
 * How hard each kind of moment pushes, as a multiplier on the user's
 * chosen strength. Pointing at a button and reading a page want
 * different frames, and treating them the same is what makes an auto
 * zoom feel mechanical.
 */
export const SOURCE_STRENGTH: Record<MomentSource, number> = {
  click: 1,
  mark: 1,
  settle: 0.95,
  type: 0.88,
  scroll: 0.72,
};

export interface DetectOptions {
  /**
   * Normalised units per second above which the pointer counts as
   * travelling. 0.28 is roughly a quarter of the screen per second,
   * which is a deliberate move rather than a drift.
   */
  moveSpeed: number;
  /** And below which it counts as stopped. */
  stillSpeed: number;
  /** How long it has to stay stopped before the stop means anything. */
  dwellMs: number;
  /**
   * Ignore a settle the pointer barely travelled to get to. Measured
   * from where the travel STARTED, not from the previous moment: a
   * small correcting nudge at the end of a long move is not a second
   * thing to look at, and the first moment of a take has no previous
   * moment to be measured against at all.
   */
  minTravel: number;
  /** Never put two moments closer together than this. */
  minGapMs: number;
  /** Hard ceiling, whatever the take contains. */
  maxMoments: number;
}

export const DEFAULT_DETECT: DetectOptions = {
  moveSpeed: 0.28,
  stillSpeed: 0.045,
  dwellMs: 190,
  minTravel: 0.07,
  minGapMs: 1900,
  maxMoments: 40,
};
const inFrame = (p: { x: number; y: number }) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

/* ── The good detector: real input ──────────────────────────────── */

export interface ClusterOptions {
  /** Clicks this far apart in time belong to the same run. */
  clickGapMs: number;
  /** And this close together, normalised. Past it, you moved on. */
  clickRadius: number;
  /** Keystrokes this far apart belong to the same burst. */
  typeGapMs: number;
  /** Typing that begins this soon after a click extends it rather than interrupting. */
  typeJoinMs: number;
  /** Wheel events this far apart belong to the same scroll. */
  scrollGapMs: number;
}

export const DEFAULT_CLUSTER: ClusterOptions = {
  clickGapMs: 950,
  clickRadius: 0.11,
  typeGapMs: 950,
  typeJoinMs: 1400,
  scrollGapMs: 700,
};

/** Rank used when two moments are too close to keep both. */
const PRIORITY: Record<MomentSource, number> = {
  mark: 4, click: 3, scroll: 2, type: 1, settle: 0,
};

interface Cluster {
  kind: 'pointer' | 'scroll' | 'type';
  startMs: number;
  endMs: number;
  x: number;
  y: number;
  weight: number;
}

/**
 * Moments from real clicks, scrolls and keystrokes.
 *
 * Clustering is the whole job. A raw event stream would produce a zoom
 * per click, which on a form is eleven zooms in four seconds and is
 * unwatchable; the interesting unit is not the click but the RUN of
 * related activity around one place on screen.
 *
 * Three rules, in the order they are applied:
 *
 *   1. Clicks near each other in time AND space are one moment, held
 *      for as long as the run.
 *   2. Typing that starts soon after a click EXTENDS that click. You
 *      clicked a field and typed into it: one idea, one zoom. Typing
 *      out of nowhere gets its own, gentler moment.
 *   3. Scrolling is its own kind, and is never merged into a click. It
 *      is a different thing to look at and it wants a wider frame.
 */
export function momentsFromEvents(
  events: InputEvent[],
  marks: number[],
  options: Partial<DetectOptions & ClusterOptions> = {}
): ZoomMoment[] {
  const o = { ...DEFAULT_DETECT, ...DEFAULT_CLUSTER, ...options };
  const usable = events.filter(inFrame).sort((a, b) => a.tMs - b.tMs);

  const clusters: Cluster[] = [];

  for (const event of usable) {
    const kind: Cluster['kind'] =
      event.kind === 'scroll' ? 'scroll' : event.kind === 'key' ? 'type' : 'pointer';

    /* The most recent cluster of the same kind, and only if it is still
       the most recent cluster at all — a click between two scrolls ends
       the scroll rather than being absorbed by it. */
    const last = clusters[clusters.length - 1];

    if (last && last.kind === kind) {
      const gap = event.tMs - last.endMs;
      const withinTime =
        kind === 'pointer' ? gap <= o.clickGapMs
          : kind === 'type' ? gap <= o.typeGapMs
            : gap <= o.scrollGapMs;
      /* Space matters for clicks and not for the others: you can type
         with the pointer anywhere, and a scroll moves the page rather
         than the pointer. */
      const withinSpace =
        kind !== 'pointer' || Math.hypot(event.x - last.x, event.y - last.y) <= o.clickRadius;

      if (withinTime && withinSpace) {
        last.endMs = event.tMs;
        last.weight += 1;
        continue;
      }
    }

    /* Rule 2: typing right after a pointer run is part of that run. */
    if (kind === 'type' && last && last.kind === 'pointer' && event.tMs - last.endMs <= o.typeJoinMs) {
      last.endMs = event.tMs;
      last.weight += 1;
      continue;
    }

    clusters.push({ kind, startMs: event.tMs, endMs: event.tMs, x: event.x, y: event.y, weight: 1 });
  }

  const found: ZoomMoment[] = clusters.map((cluster) => ({
    atMs: cluster.startMs,
    x: cluster.x,
    y: cluster.y,
    source: cluster.kind === 'pointer' ? 'click' : cluster.kind === 'scroll' ? 'scroll' : 'type',
    spanMs: Math.max(0, cluster.endMs - cluster.startMs),
    weight: cluster.weight,
  }));

  return merge(found, marksToMoments(marks, usable), o);
}

/** The user's own marks, positioned from whatever was nearest in the stream. */
function marksToMoments(marks: number[], events: { tMs: number; x: number; y: number }[]): ZoomMoment[] {
  return marks.map((atMs) => {
    const nearest = nearestBy(events, atMs);
    return {
      atMs,
      x: nearest ? nearest.x : 0.5,
      y: nearest ? nearest.y : 0.5,
      source: 'mark' as const,
      spanMs: 0,
      weight: 1,
    };
  });
}

/**
 * Thin a set of moments down to something watchable.
 *
 * Two moments closer than the minimum gap cannot both survive, and which
 * one goes is decided by PRIORITY rather than by order: a mark beats an
 * inference, a click beats a scroll. Ordering alone would let a stray
 * wheel event a moment before a deliberate click take the click's place.
 */
function merge(found: ZoomMoment[], marked: ZoomMoment[], o: DetectOptions): ZoomMoment[] {
  const all = [...found, ...marked].sort((a, b) => a.atMs - b.atMs);

  const spaced: ZoomMoment[] = [];
  for (const moment of all) {
    const previous = spaced[spaced.length - 1];
    if (previous && moment.atMs - previous.atMs < o.minGapMs) {
      if (PRIORITY[moment.source] > PRIORITY[previous.source]) {
        // The loser's span still counts: the activity happened.
        spaced[spaced.length - 1] = {
          ...moment,
          spanMs: Math.max(moment.spanMs, previous.atMs + previous.spanMs - moment.atMs),
        };
      } else {
        previous.spanMs = Math.max(previous.spanMs, moment.atMs + moment.spanMs - previous.atMs);
        previous.weight += moment.weight;
      }
      continue;
    }
    spaced.push({ ...moment });
  }

  return spaced.slice(0, o.maxMoments);
}

/* ── The fallback: the cursor track alone ───────────────────────── */

/**
 * Travel-then-stillness, over the cursor track.
 *
 * Runs as a small state machine rather than a peak finder because the
 * thing being detected is a TRANSITION, not an extreme: the pointer
 * being slow is meaningless on its own (it is slow for most of a take),
 * and only becomes a signal after it was fast.
 */
export function findZoomMoments(
  samples: CursorSample[],
  marks: number[],
  options: Partial<DetectOptions> = {}
): ZoomMoment[] {
  const o = { ...DEFAULT_DETECT, ...options };
  const track = samples.filter(inFrame).sort((a, b) => a.tMs - b.tMs);

  const found: ZoomMoment[] = [];

  if (track.length >= 3) {
    let travelling = false;
    /** Where the current travel began, which is what `minTravel` measures. */
    let travelFrom: CursorSample | null = null;
    /** When the pointer most recently dropped below `stillSpeed`. */
    let stillSince = -1;
    let stillAt: CursorSample | null = null;
    let emitted = false;
    let lastEmit: ZoomMoment | null = null;

    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1];
      const b = track[i];
      const dt = (b.tMs - a.tMs) / 1000;
      if (dt <= 0) continue;

      const speed = Math.hypot(b.x - a.x, b.y - a.y) / dt;

      if (speed > o.moveSpeed) {
        // The sample BEFORE the first fast one is where the move began.
        if (!travelling) travelFrom = a;
        travelling = true;
        stillSince = -1;
        stillAt = null;
        emitted = false;
        continue;
      }

      if (speed > o.stillSpeed) {
        // Coasting: neither a deliberate move nor a stop. Hold the state.
        continue;
      }

      if (stillSince < 0) {
        stillSince = b.tMs;
        stillAt = b;
      }

      const dwelt = b.tMs - stillSince;
      if (!travelling || emitted || dwelt < o.dwellMs || !stillAt || !travelFrom) continue;

      const travelled = Math.hypot(stillAt.x - travelFrom.x, stillAt.y - travelFrom.y);
      const gap = lastEmit ? stillSince - lastEmit.atMs : Infinity;

      if (travelled >= o.minTravel && gap >= o.minGapMs) {
        lastEmit = {
          atMs: stillSince, x: stillAt.x, y: stillAt.y,
          source: 'settle', spanMs: 0, weight: 1,
        };
        found.push(lastEmit);
      }
      // Either way this settle is spent; the next one needs fresh travel.
      emitted = true;
      travelling = false;
    }
  }

  return merge(found, marksToMoments(marks, track), o);
}

/* ── Choosing between them ──────────────────────────────────────── */

export interface MomentInput {
  cursor: CursorSample[];
  /** Empty when the input hook could not run. */
  events: InputEvent[];
  marks: number[];
}

export interface MomentResult {
  moments: ZoomMoment[];
  /** Which detector produced them, for the report and the UI. */
  from: 'events' | 'cursor';
}

/**
 * Real input when there is any, the cursor track otherwise.
 *
 * The test is "did any event arrive", not "was the hook started". A hook
 * that started and delivered nothing — because the take was four seconds
 * of nobody touching anything — must not stop the fallback from having a
 * go at the cursor track.
 */
export function detectMoments(
  input: MomentInput,
  options: Partial<DetectOptions & ClusterOptions> = {}
): MomentResult {
  if (input.events.length > 0) {
    return { moments: momentsFromEvents(input.events, input.marks, options), from: 'events' };
  }
  return { moments: findZoomMoments(input.cursor, input.marks, options), from: 'cursor' };
}

function nearestBy<T extends { tMs: number }>(items: T[], tMs: number): T | null {
  if (items.length === 0) return null;
  let best = items[0];
  let bestGap = Math.abs(best.tMs - tMs);
  for (const item of items) {
    const gap = Math.abs(item.tMs - tMs);
    if (gap < bestGap) { best = item; bestGap = gap; }
    if (item.tMs > tMs && gap > bestGap) break;
  }
  return best;
}

/* ── Quiet stretches ────────────────────────────────────────────── */

export interface QuietStretch {
  startMs: number;
  endMs: number;
}

export interface QuietOptions {
  /** Shorter than this and there is nothing worth cutting away for. */
  minQuietMs: number;
  /** Wait this long after the last activity before leaving the screen. */
  leadInMs: number;
  /** And be back this long before the next thing happens. */
  leadOutMs: number;
  /** Never more than this many in one take. */
  maxStretches: number;
}

export const DEFAULT_QUIET: QuietOptions = {
  minQuietMs: 2600,
  leadInMs: 550,
  leadOutMs: 800,
  maxStretches: 8,
};

/**
 * The stretches where nothing is happening on screen.
 *
 * This is what lets the edit cut to the camera while you are talking
 * rather than explaining, which is the single biggest thing separating a
 * screen recording from a piece of film. A frozen screen with a voice
 * over it is dead air with a picture attached; a face is not.
 *
 * "Activity" is real input when there is any, and otherwise the moments
 * where the pointer was actually travelling. The distinction matters:
 * with no input hook, a pointer parked in one corner for a minute is
 * indistinguishable from a person reading, and both of those are quiet.
 *
 * `leadInMs` and `leadOutMs` are the whole reason this is not a naive
 * gap finder. Leaving the screen the instant somebody stops clicking
 * catches the end of what they were doing, and coming back the instant
 * they start again means the first click of the next thought happens
 * off screen. Both are conservative on purpose.
 */
export function findQuietStretches(
  input: MomentInput,
  durationMs: number,
  options: Partial<QuietOptions & DetectOptions> = {}
): QuietStretch[] {
  const o = { ...DEFAULT_QUIET, ...DEFAULT_DETECT, ...options };

  const activity: number[] = [];
  if (input.events.length > 0) {
    for (const event of input.events) activity.push(event.tMs);
  } else {
    const track = input.cursor.filter(inFrame).sort((a, b) => a.tMs - b.tMs);
    for (let i = 1; i < track.length; i++) {
      const dt = (track[i].tMs - track[i - 1].tMs) / 1000;
      if (dt <= 0) continue;
      const speed = Math.hypot(track[i].x - track[i - 1].x, track[i].y - track[i - 1].y) / dt;
      if (speed > o.moveSpeed) activity.push(track[i].tMs);
    }
  }

  /* A mark is the user saying "look here", which is the opposite of
     quiet — the screen has to be on when it lands. */
  for (const mark of input.marks) activity.push(mark);

  activity.push(0, durationMs);
  activity.sort((a, b) => a - b);

  const stretches: QuietStretch[] = [];
  for (let i = 1; i < activity.length; i++) {
    const startMs = activity[i - 1] + o.leadInMs;
    const endMs = activity[i] - o.leadOutMs;
    if (endMs - startMs < o.minQuietMs) continue;
    stretches.push({ startMs, endMs: Math.min(endMs, durationMs) });
  }

  /* Longest first when there are too many: if only some of them can be
     used, the ones worth using are the ones with room to breathe. */
  return stretches
    .sort((a, b) => (b.endMs - b.startMs) - (a.endMs - a.startMs))
    .slice(0, o.maxStretches)
    .sort((a, b) => a.startMs - b.startMs);
}

/**
 * Push quiet stretches clear of a zoom that is still held.
 *
 * Found by watching it: on a take with one click and then nine seconds
 * of nothing, the camera took the whole frame 700ms after the frame
 * pushed in on the click. The zoom was real, correct, and never seen.
 *
 * A quiet stretch begins when INPUT stops, and the picture keeps moving
 * for a second or two after that — the push is still arriving, then
 * holding, then pulling out. Cutting away during any of it throws away
 * the shot that the click was worth having.
 *
 * So each stretch is moved to start after the last zoom that began
 * before it has finished, and dropped if that leaves nothing.
 */
export function keepClearOfZooms(
  stretches: QuietStretch[],
  moments: ZoomMoment[],
  shape: ZoomShape,
  minMs: number
): QuietStretch[] {
  if (moments.length === 0) return stretches;

  const kept: QuietStretch[] = [];
  for (const stretch of stretches) {
    /* The zoom in flight when this stretch begins, if any. Its move ends
       a hold and a pull-out after the moment plus whatever it spanned. */
    let earliest = stretch.startMs;
    for (const moment of moments) {
      if (moment.atMs > stretch.endMs) break;
      const zoomEnds = moment.atMs + moment.spanMs + shape.holdMs + shape.outMs;
      if (zoomEnds > earliest) earliest = zoomEnds;
    }
    if (stretch.endMs - earliest >= minMs) kept.push({ startMs: earliest, endMs: stretch.endMs });
  }
  return kept;
}

/* ── The move ───────────────────────────────────────────────────── */

/**
 * The two curves, and they are most of the feel.
 *
 * `easeInOut` spends as long arriving as it does leaving, which reads as
 * a slow machine. Expo-out is most of the way there in the first third
 * and then glides, which reads as somebody who already knew where they
 * were going. The pull-out is its mirror: unhurried to leave, decisive
 * at the end.
 */
export const PUSH_CURVE: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const PULL_CURVE: [number, number, number, number] = [0.45, 0, 0.15, 1];
/** The overshoot settling back. Gentler than the push, or it snaps. */
export const SETTLE_CURVE: [number, number, number, number] = [0.33, 0, 0.2, 1];

/**
 * The closing move, and it is the one curve here that was MEASURED
 * rather than chosen.
 *
 * `~/Downloads/252d89a9da0a6a67df21c59e80013eb7.mp4` ends on one long
 * pull back from a close framing to the framing it opened on. Each of
 * its 564 frames was matched against the frame it settles on with
 * SIFT + RANSAC — an estimator checked first against synthetic zooms of
 * known scale, which it recovered exactly — and a cubic bezier fitted to
 * the resulting scale trajectory. This is that fit, over the full 2100ms
 * of the move:
 *
 *     measured          [0.53, 0.47, 0.00, 1.00]   RMS 0.053
 *     SETTLE_CURVE      [0.33, 0,    0.2,  1   ]   RMS 0.114
 *     PULL_CURVE        [0.45, 0,    0.15, 1   ]   RMS 0.135
 *     PUSH_CURVE        [0.16, 1,    0.3,  1   ]   RMS 0.164
 *
 * So none of the three already here is the same curve, and the shape is
 * why: expo-out is 90% done in its first third, whereas this move is 50%
 * done at 583ms, 90% at 917ms and 98% at 1717ms. It leaves unhurriedly,
 * covers most of the ground in the middle, and then has a long
 * asymptotic tail — a hand letting something coast to a stop rather than
 * an operator arriving.
 *
 * 20 consecutive frames in the middle of that move are too motion-blurred
 * for a feature matcher to place at all, which is the other half of why
 * it reads as fast: the fit is interpolated across them and the curve is
 * quoted with that stated rather than hidden.
 */
export const CLOSE_CURVE: [number, number, number, number] = [0.53, 0.47, 0, 1];

/**
 * One frame at 60fps, and it is NOT what makes a cut instantaneous.
 *
 * `hold` easing is: `applyEasing` returns 0 for the whole span, so the
 * value stays on the outgoing keyframe until the incoming one and then
 * jumps, whatever the gap. The gap exists so the two keyframes are
 * separately grabbable in the editor — a cut written as two keys at the
 * same millisecond is a cut nobody can take apart, which is the one
 * thing this whole file is built not to produce.
 */
export const CUT_GAP_MS = Math.ceil(1000 / 60);

/** Ceiling on what a single held framing may drift, as a fraction. */
const MAX_DRIFT = 0.12;

export interface ZoomShape {
  /** How far before the moment the push begins. */
  leadMs: number;
  /** How long the push takes. Ignored when `cutIn` is set. */
  inMs: number;
  /** How long it stays there, on top of whatever the moment spanned. */
  holdMs: number;
  /** How long the pull back out takes. Ignored when `cutIn` is set. */
  outMs: number;
  /** Multiplier on the clip's resting scale, before the per-source strength. */
  factor: number;
  /** How far past the target the push goes before settling. 0 turns it off. Ignored when `cutIn` is set. */
  overshoot: number;
  /** How long the settle back from the overshoot takes. Ignored when `cutIn` is set. */
  settleMs: number;
  /**
   * CUT to each framing instead of pushing into it.
   *
   * The two grammars are genuinely different edits rather than two
   * settings of one, which is why half the fields above go inert here.
   * A push is a move with a duration and a curve; a cut has neither, and
   * everything that follows from that — no overshoot to settle, no
   * pull-out between framings, one move in the whole film — changes with
   * it. See `planCuts`.
   */
  cutIn: boolean;
  /**
   * How fast a held framing creeps in, in per cent of scale per second.
   * 0 is locked off.
   */
  driftPctPerSec: number;
  /**
   * How long the one closing move back to rest takes. 0 falls back to
   * `outMs`, which is what the pushing grammar uses.
   */
  closeMs: number;
}

export const DEFAULT_SHAPE: ZoomShape = {
  leadMs: 220,
  inMs: 460,
  holdMs: 1500,
  outMs: 560,
  factor: 1.55,
  overshoot: 0.03,
  settleMs: 150,
  cutIn: false,
  driftPctPerSec: 0,
  closeMs: 0,
};

/**
 * The reference video's grammar, as numbers.
 *
 * Every field below that differs from `DEFAULT_SHAPE` was measured off
 * `~/Downloads/252d89a9da0a6a67df21c59e80013eb7.mp4` — 9.400s, 1280x960,
 * 60fps, 564 frames — rather than chosen. What the measurements were:
 *
 * · **Three cuts, at 1267 / 3600 / 5333ms, and every one is HARD.** The
 *   mean absolute frame difference goes 0.22 -> 47.05 -> 0.85 across the
 *   first, 0.01 -> 34.54 -> 0.34 across the second, 0.01 -> 24.73 -> 0.26
 *   across the third. One frame each. No blend, no dip through black or
 *   white, no directional smear, no flash: `analyze_reference_video`
 *   finds zero flashes and the only "dissolve" it reports is the
 *   motion-blurred closing move, whose frames SIFT confirms are the same
 *   content in flight. **Transition duration: 0 frames, all three.** So
 *   `inMs` is 0 and there is nothing for `overshoot` or `settleMs` to do.
 *
 * · **Not cut to music.** `detect_beats` finds 0 real onsets in the
 *   audio; 1 of 3 cuts sits on the interpolated grid, which is chance.
 *   The tool's own verdict: "the edit is not following this track". So
 *   nothing here is a tempo.
 *
 * · **`factor` 2.8**, and it is the same number twice. The wide-to-close
 *   cut is x2.797 (SIFT + RANSAC, 29 inliers), and the closing move
 *   travels from 2.85x closer than the ending out to it. A film that
 *   cuts in by 2.80 and pulls out by 2.85 is one framing decision, not
 *   two. The other two cuts are x0.75 and x0.86 — lateral, changing
 *   which thing is on screen rather than how close it is.
 *
 * · **`holdMs` 2030** is the MEDIAN shot: 1267 / 2333 / 1733 / 4067ms.
 *
 * · **`driftPctPerSec` 3.0 — nothing is ever locked off.** Scale drift
 *   measured within each of the four shots: -2.9, +2.7, +5.0, +3.4 %/s.
 *   Three of four creep IN, and the median magnitude is 3.0.
 *
 * · **`closeMs` 2100**, the one animated move in the film. See
 *   `CLOSE_CURVE` for its shape and how it was fitted.
 *
 * `leadMs` is the one field carried over unexamined, and deliberately:
 * the reference has no input events in it, so it has nothing to say
 * about how far ahead of a click to cut.
 */
export const CUT_SHAPE: ZoomShape = {
  ...DEFAULT_SHAPE,
  inMs: 0,
  outMs: 0,
  holdMs: 2030,
  factor: 2.8,
  overshoot: 0,
  settleMs: 0,
  cutIn: true,
  driftPctPerSec: 3.0,
  closeMs: 2100,
};

/** One point on the planned move, before it becomes keyframes. */
export interface Stop {
  tMs: number;
  /** Multiplier on the resting scale. 1 is full frame. */
  factor: number;
  /** Focus point, normalised. 0.5,0.5 is the centre. */
  x: number;
  y: number;
  easing: Easing;
  bezier?: [number, number, number, number];
}

/**
 * Plan the whole move as a list of stops.
 *
 * Separated from the keyframe emission below so the chaining logic —
 * which is the part with the judgement in it — can be read, and tested,
 * without any of the clip geometry.
 *
 * `restByMs` is when the frame must be back at rest, and it defaults to
 * the end of the take. It exists because the cutting grammar's closing
 * move is 2100ms long and the cinematic look's dip to black is the last
 * 620ms of the film: without it the film fades out in the middle of a
 * camera move, which is the one edit nobody makes on purpose.
 */
export function planZoom(
  moments: ZoomMoment[],
  durationMs: number,
  shape: ZoomShape = DEFAULT_SHAPE,
  restByMs: number = durationMs
): Stop[] {
  if (moments.length === 0) return [];
  if (shape.cutIn) return planCuts(moments, durationMs, shape, restByMs);

  const plan: Stop[] = [{ tMs: 0, factor: 1, x: 0.5, y: 0.5, easing: 'linear' }];
  const push = (stop: Stop) => {
    const last = plan[plan.length - 1];
    // Same instant twice: the later intent wins rather than stacking.
    if (stop.tMs <= last.tMs) plan[plan.length - 1] = { ...stop, tMs: last.tMs };
    else plan.push(stop);
  };

  for (let i = 0; i < moments.length; i++) {
    const moment = moments[i];
    const next = moments[i + 1];

    /* The push is the same length whatever the moment; the HOLD is what
       stretches, so a six-second form fill is one zoom that stays. */
    const target = shape.factor * SOURCE_STRENGTH[moment.source];
    const t0 = Math.max(0, moment.atMs - shape.leadMs);
    const t1 = t0 + shape.inMs;
    const nextT0 = next ? Math.max(0, next.atMs - shape.leadMs) : Infinity;

    // Hold whatever the frame is doing right up to the push.
    const last = plan[plan.length - 1];
    if (t0 > last.tMs) {
      push({ tMs: t0, factor: last.factor, x: last.x, y: last.y, easing: 'linear' });
    }

    if (shape.overshoot > 0 && t1 + shape.settleMs < nextT0) {
      push({
        tMs: t1, factor: target * (1 + shape.overshoot), x: moment.x, y: moment.y,
        easing: 'bezier', bezier: PUSH_CURVE,
      });
      push({
        tMs: t1 + shape.settleMs, factor: target, x: moment.x, y: moment.y,
        easing: 'bezier', bezier: SETTLE_CURVE,
      });
    } else {
      push({ tMs: t1, factor: target, x: moment.x, y: moment.y, easing: 'bezier', bezier: PUSH_CURVE });
    }

    const arrived = plan[plan.length - 1].tMs;
    const holdEnd = Math.min(arrived + shape.holdMs + moment.spanMs, nextT0);
    if (holdEnd > arrived) {
      push({ tMs: holdEnd, factor: target, x: moment.x, y: moment.y, easing: 'linear' });
    }

    /*
      Pull out only when there is room to finish before the next push
      starts. Otherwise the frame travels from this point to the next at
      zoom, which is what stops a dense take reading as a bounce.
    */
    if (nextT0 >= holdEnd + shape.outMs) {
      push({
        tMs: holdEnd + shape.outMs, factor: 1, x: 0.5, y: 0.5,
        easing: 'bezier', bezier: PULL_CURVE,
      });
    }
  }

  const last = plan[plan.length - 1];
  if (last.factor !== 1) {
    push({
      tMs: Math.min(Math.max(durationMs, last.tMs + 1), last.tMs + shape.outMs),
      factor: 1, x: 0.5, y: 0.5, easing: 'bezier', bezier: PULL_CURVE,
    });
  }

  return plan;
}

/* ── Cutting instead of pushing ─────────────────────────────────── */

/**
 * The reference video's grammar: hard cuts between framings, a slow
 * creep while each one is held, and ONE animated move — the pull back to
 * rest at the end.
 *
 * The three structural claims, and each is a measurement rather than a
 * preference. See `CUT_SHAPE` for the numbers and how they were taken.
 *
 * **A cut is two keyframes, and it is expressible in the EDL exactly.**
 * The outgoing framing carries `hold` easing, so `interpolateKeyframes`
 * returns it unchanged right up to the incoming keyframe and then the
 * value jumps. Nothing new was needed in the format for this; `planZoom`
 * simply never emitted it.
 *
 * **Nothing returns to rest in the middle unless there is a shot's worth
 * of room.** The reference never goes wide between its close framings —
 * it cuts close-to-close and only opens out at the end. So the rule here
 * is that cutting back to rest has to buy a REST SHOT, meaning a whole
 * `holdMs` of it, or the frame simply cuts on to the next framing. A
 * looser rule produces a one-second flash of wide between two close
 * shots, which is the cutting grammar's version of the bounce that
 * `planZoom` above exists to avoid.
 *
 * **Every held framing drifts.** All four of the reference's shots creep
 * — none is locked off — and the drift is what stops a cut edit reading
 * as a slideshow. It is capped at `MAX_DRIFT` so a long hold cannot
 * compound its way into a zoom nobody asked for.
 */
function planCuts(
  moments: ZoomMoment[],
  durationMs: number,
  shape: ZoomShape,
  restByMs: number
): Stop[] {
  const plan: Stop[] = [];
  const push = (stop: Stop) => {
    const last = plan[plan.length - 1];
    if (last && stop.tMs <= last.tMs) plan[plan.length - 1] = { ...stop, tMs: last.tMs };
    else plan.push(stop);
  };

  /** What a framing held for `spanMs` has crept to by the end of it. */
  const drifted = (factor: number, spanMs: number) =>
    factor * (1 + Math.min(MAX_DRIFT, Math.max(0, (shape.driftPctPerSec / 100) * (spanMs / 1000))));

  /**
   * Hold `from` until `untilMs`, drifting, and leave the last stop on
   * `hold` so whatever comes next is a cut rather than a ramp.
   */
  const holdUntil = (from: Stop, untilMs: number) => {
    if (untilMs <= from.tMs) return from;
    const end: Stop = {
      tMs: untilMs,
      factor: drifted(from.factor, untilMs - from.tMs),
      x: from.x, y: from.y,
      easing: 'hold',
    };
    push(end);
    return end;
  };

  /* The film opens at rest. `linear` so the drift below it interpolates. */
  let current: Stop = { tMs: 0, factor: 1, x: 0.5, y: 0.5, easing: 'linear' };
  push(current);

  for (let i = 0; i < moments.length; i++) {
    const moment = moments[i];
    const next = moments[i + 1];
    const target = shape.factor * SOURCE_STRENGTH[moment.source];

    const cutAt = Math.max(current.tMs + CUT_GAP_MS, moment.atMs - shape.leadMs);
    const nextCutAt = next ? Math.max(0, next.atMs - shape.leadMs) : Infinity;

    holdUntil(current, cutAt - CUT_GAP_MS);
    current = { tMs: cutAt, factor: target, x: moment.x, y: moment.y, easing: 'linear' };
    push(current);

    /* Cut back to rest only when the gap buys a whole rest shot. */
    const holdEnd = cutAt + shape.holdMs + moment.spanMs;
    if (nextCutAt - holdEnd >= shape.holdMs && holdEnd + CUT_GAP_MS < restByMs) {
      holdUntil(current, holdEnd);
      current = { tMs: holdEnd + CUT_GAP_MS, factor: 1, x: 0.5, y: 0.5, easing: 'linear' };
      push(current);
    }
  }

  /*
    The closing move, and the bookend it makes.

    The reference's last frame is its first frame: matched against each
    other they fit at scale 1.000, rotation 0.001 degrees and a
    translation of eight thousandths of a pixel, on 394 of 411 inlying
    features. That is not a coincidence of framing, it is the edit
    deciding to land where it started, and it is why this always ends at
    factor 1 on the canvas centre rather than wherever the last moment
    happened to leave it.
  */
  const closeMs = shape.closeMs > 0 ? shape.closeMs : shape.outMs;
  const end = Math.max(current.tMs + CUT_GAP_MS, Math.min(restByMs, durationMs));
  const startClose = Math.max(current.tMs, end - closeMs);

  if (startClose > current.tMs) {
    const held = holdUntil(current, startClose);
    /* `hold` would freeze the move that follows, so the launch stop
       carries the measured curve instead. */
    plan[plan.length - 1] = { ...held, easing: 'bezier', bezier: CLOSE_CURVE };
  } else {
    plan[plan.length - 1] = { ...current, easing: 'bezier', bezier: CLOSE_CURVE };
  }
  push({ tMs: end, factor: 1, x: 0.5, y: 0.5, easing: 'linear' });

  return plan;
}

/* ── Stops into keyframes ───────────────────────────────────────── */

export interface ZoomGeometry {
  /** The clip's content size at scale 1, from `getClipBaseSize`. */
  baseWidth: number;
  baseHeight: number;
  /** The scale the clip rests at, before any zoom. */
  restScale: number;
  canvasWidth: number;
  canvasHeight: number;
  /**
   * How far past its own edge the picture may travel, as a fraction of
   * the canvas. Zero unless there is something behind it.
   *
   * See `focusOffset` for why this exists. It is the difference between
   * a zoom that frames a toolbar button and one that merely gets bigger
   * near it.
   */
  edgeOverhang?: number;
}

export interface ZoomKeyframe {
  property: 'scaleX' | 'scaleY' | 'positionX' | 'positionY';
  timeOffsetMs: number;
  value: number;
  easing: Easing;
  bezierPoints?: [number, number, number, number];
}

/**
 * Where the clip has to sit for a given point of it to land on the
 * canvas centre.
 *
 * The clip's box is `baseWidth * scale` wide and centred at
 * `canvasWidth / 2 + transform.x`. The content point at normalised `px`
 * therefore lands at `canvasWidth/2 + x - w/2 + px*w`, and setting that
 * equal to the canvas centre gives `x = w * (0.5 - px)`.
 *
 * ── The clamp, and why it is not simply "never show the edge" ───────
 *
 * Pushed toward a corner, an unclamped offset walks the edge of the
 * footage into frame and the viewer sees whatever is behind it. So the
 * travel is limited to the overhang the zoom bought, which is
 * `(w - canvasWidth) / 2`.
 *
 * That rule, applied strictly, has a consequence worth stating because
 * it is not obvious and it was measured rather than reasoned about:
 * **centring a point 10% from the edge needs a scale of 5.** At any
 * sane zoom a click on a toolbar cannot be brought to the middle, and
 * the frame ends up merely bigger near it rather than aimed at it. On a
 * take where the clicked thing was 14% across the frame, a 1.55x zoom
 * moved it to 14%.
 *
 * `edgeOverhang` is what fixes that, and it is not a fudge: the clamp
 * exists to stop the project's BACKGROUND showing, and when the
 * cinematic look is on there is no background to show — the picture is
 * inset on a backdrop, and a backdrop is a thing you are allowed to see.
 * So the travel is extended by that fraction of the canvas, the corner
 * click is genuinely framed, and what fills the vacated edge is the
 * gradient that was always meant to be there.
 */
export function focusOffset(
  px: number,
  py: number,
  scale: number,
  geometry: ZoomGeometry
): { x: number; y: number } {
  const width = geometry.baseWidth * scale;
  const height = geometry.baseHeight * scale;
  const overhang = Math.max(0, geometry.edgeOverhang ?? 0);
  const limitX = Math.max(0, (width - geometry.canvasWidth) / 2) + geometry.canvasWidth * overhang;
  const limitY = Math.max(0, (height - geometry.canvasHeight) / 2) + geometry.canvasHeight * overhang;
  /* `|| 0` collapses negative zero, which `width * (0.5 - 0.5)` produces
     and which compares equal to zero everywhere except a deep equality
     check. Not worth a puzzled half hour in a test failure. */
  const clamp = (v: number, limit: number) =>
    (v < -limit ? -limit : v > limit ? limit : v) || 0;
  return {
    x: clamp(width * (0.5 - px), limitX),
    y: clamp(height * (0.5 - py), limitY),
  };
}

export function zoomKeyframes(
  moments: ZoomMoment[],
  durationMs: number,
  geometry: ZoomGeometry,
  shape: ZoomShape = DEFAULT_SHAPE,
  restByMs: number = durationMs
): ZoomKeyframe[] {
  const plan = planZoom(moments, durationMs, shape, restByMs);
  const keyframes: ZoomKeyframe[] = [];

  for (const stop of plan) {
    if (stop.tMs > durationMs) break;
    const scale = geometry.restScale * stop.factor;
    const offset = focusOffset(stop.x, stop.y, scale, geometry);
    const at = Math.max(0, Math.round(stop.tMs));
    const shared = {
      timeOffsetMs: at,
      easing: stop.easing,
      ...(stop.bezier ? { bezierPoints: stop.bezier } : {}),
    };

    keyframes.push({ property: 'scaleX', value: scale, ...shared });
    keyframes.push({ property: 'scaleY', value: scale, ...shared });
    keyframes.push({ property: 'positionX', value: offset.x, ...shared });
    keyframes.push({ property: 'positionY', value: offset.y, ...shared });
  }

  return keyframes;
}
