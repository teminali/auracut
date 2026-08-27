/* ═══════════════════════════════════════════════════════════════════
   Timeline store — the edit state, and the only place it mutates.

   Structural rules this file follows:
     • Every mutation goes through immer, so no hand-rolled deep clones.
     • History is transactional: a 200-frame drag is ONE undo step, opened
       with `beginTransaction()` and closed with `commitTransaction()`.
     • The playhead lives here but is deliberately cheap to write — nothing
       in it triggers a history snapshot or a structural clone.
     • Components subscribe through the selector hooks at the bottom rather
       than pulling the whole store, which is what keeps 60fps playback from
       re-rendering the entire editor.
   ═══════════════════════════════════════════════════════════════════ */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { current } from 'immer';
import { useShallow } from 'zustand/react/shallow';
import {
  Track,
  Clip,
  MediaAsset,
  TrackType,
  ClipType,
  SpeedCurvePreset,
  SpeedCurvePoint,
  KeyframePoint,
  AnimatableProperty,
  ClipMask,
  ClipTextStyle,
  ClipFilters,
  BlendMode,
  TimelineMarker,
  MarkerKind,
  TransitionType,
  ClipEffect,
  EffectKeyframe,
  ShapeStyle,
  ShapeKind,
  MotionPath,
  createClip,
  DEFAULT_TEXT_STYLE,
  DEFAULT_SHAPE_STYLE,
} from '../types/edl';
import { INITIAL_TRACKS, SAMPLE_MEDIA_ASSETS } from '../mcp/defaultMedia';
import { CaptionCue } from '../engine/captions';
import { createEffectInstance, getEffectDefinition } from '../engine/effectsRegistry';
import { getAnimatedProperties, interpolateKeyframes } from '../engine/keyframeMath';
import { validateProperty, applyClipProperty, resolvePropertyAlias, getClipProperty } from '../engine/propertyPath';

/* ── ids ────────────────────────────────────────────────────────── */

let idCounter = 0;
export const uid = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/* ── history ────────────────────────────────────────────────────── */

interface HistoryEntry {
  tracks: Track[];
  markers: TimelineMarker[];
  label: string;
  at: number;
}

const HISTORY_LIMIT = 80;

/* ── track colour identity ──────────────────────────────────────── */

/*
  Identity hues, matching the `lane.*` design tokens. These are worn as a
  2px rail and a low-alpha wash over a dark clip body — never as a fill —
  so they are picked to be BRIGHT and legible at 2px, not to be readable
  as a background.
*/
const CLIP_COLORS: Record<string, string> = {
  video: '#4a90ff',
  image: '#4a90ff',
  audio: '#33c98d',
  text: '#ee6fae',
  sticker: '#a081f5',
  shape: '#a081f5',
  adjustment: '#f0a92e',
};

export const clipColorFor = (type: ClipType): string => CLIP_COLORS[type] ?? '#2f6fb8';

/* ── state shape ────────────────────────────────────────────────── */

/**
 * What an edit that can decline reports back.
 *
 * A store method that returns `void` cannot be checked, and ten tools
 * reported success because the store bailed silently and gave them
 * nothing to test. These shapes exist so the refusal is a value.
 */
export interface Refusal {
  clipId: string;
  reason: string;
}

/** In/out points, and whether the change was taken. */
export interface InOutResult {
  ok: boolean;
  error?: string;
  inPointMs: number | null;
  outPointMs: number | null;
}

export interface TimelineState {
  tracks: Track[];
  mediaPool: MediaAsset[];
  markers: TimelineMarker[];

  playheadMs: number;
  isPlaying: boolean;
  playbackRate: number;
  loopEnabled: boolean;
  inPointMs: number | null;
  outPointMs: number | null;

  selectedClipIds: string[];
  selectedTrackId: string | null;

  zoomLevel: number;
  snappingEnabled: boolean;
  rippleEditMode: boolean;
  magneticCanvasGuides: boolean;

  history: HistoryEntry[];
  historyIndex: number;
  /** Depth counter so nested transactions collapse into one entry. */
  txDepth: number;
  txSnapshot: { tracks: Track[]; markers: TimelineMarker[] } | null;
}

/**
 * What a track edit did, or why it declined.
 *
 * These five actions all used to return `void` and bail silently — on an
 * id that was not there, on the last remaining track, on a move past the
 * end of the stack. A tool calling them had nothing to test, so it
 * reported success for every one of those, which is the failure this
 * repo has now found seven times.
 */
export interface TrackEdit {
  ok: boolean;
  error?: string;
}

export interface TimelineActions {
  /* transport */
  setPlayheadMs: (ms: number) => void;
  nudgePlayhead: (deltaMs: number) => void;
  setIsPlaying: (playing: boolean) => void;
  togglePlay: () => void;
  setPlaybackRate: (rate: number) => void;
  toggleLoop: () => void;
  /*
    In and out points are a PREVIEW range and nothing else.

    `PreviewPlayer` loops between them and the timeline draws the band,
    but `ExportConfig` has no in/out field and `runHardwareExport`
    always renders frame 0 to `durationMs`. The Export dialog even has a
    "range only" toggle whose computed duration is used for a label and
    never passed to the encoder. So setting a range and then exporting
    gives the whole sequence — the tools above these say so rather than
    implying a trim.

    They also used to accept an inverted range: an out point before the
    in point leaves `PreviewPlayer` seeking to a start that is already
    past its end, which is a stuck transport with no message. They now
    refuse it and say why.
  */
  setInPoint: (ms: number | null) => InOutResult;
  setOutPoint: (ms: number | null) => InOutResult;
  clearInOut: () => InOutResult;

  /* selection */
  selectClip: (clipId: string | null, additive?: boolean) => void;
  selectClips: (clipIds: string[]) => void;
  selectAllOnTrack: (trackId: string) => void;
  clearSelection: () => void;
  setSelectedTrackId: (trackId: string | null) => void;

  /* view */
  setZoomLevel: (zoom: number) => void;
  zoomToFit: (viewportPx: number, durationMs: number) => void;
  toggleSnapping: () => void;
  toggleRippleEdit: () => void;
  toggleCanvasGuides: () => void;

  /* structural edits */
  /*
    These five report whether they did anything.

    Each one bails silently on a locked clip, a locked track, or a time
    outside the clip — all ordinary situations — and every tool above
    them returned success regardless. Splitting at a playhead that is
    not over the clip is the common case, and it reported a cut that
    never happened.
  */
  splitClip: (clipId: string, splitTimeMs: number) => boolean;
  /**
   * How many clips the playhead actually cut.
   *
   * `attempted` is how many it aimed at; `cut` is how many `splitClip`
   * took. With the playhead over nothing and no selection, both are
   * zero — which used to look exactly like a successful razor.
   */
  splitAtPlayhead: () => { attempted: number; cut: number };
  trimClip: (clipId: string, newStartMs?: number, newEndMs?: number, ripple?: boolean) => boolean;
  moveClip: (clipId: string, targetTrackId: string, newStartTimeMs: number) => boolean;
  /** Which of the batch landed, and why each of the rest did not. */
  moveClips: (
    moves: { clipId: string; trackId: string; startTimeMs: number }[]
  ) => { moved: string[]; refused: Refusal[] };
  deleteClip: (clipId: string, ripple?: boolean) => boolean;
  /** Ids actually removed, and the locked or missing ones that were not. */
  deleteSelected: () => { deleted: string[]; refused: Refusal[] };
  /** The copy's id, or null when there was no such clip to copy. */
  duplicateClip: (clipId: string) => string | null;
  insertClip: (trackId: string, asset: MediaAsset, startTimeMs: number) => string;
  insertClipObject: (clip: Clip) => void;
  /**
   * Pack a track and say what moved.
   *
   * On a track with no gaps this is a no-op, and a tool that reported
   * success for it told the user it had tidied a timeline it had not
   * touched. `gapsClosed` counts the holes that were there before.
   */
  closeGapsOnTrack: (trackId: string) => {
    ok: boolean;
    error?: string;
    gapsClosed: number;
    clipsMoved: number;
    totalShiftMs: number;
  };

  /* creative edits */
  freezeFrame: (clipId: string, atMs: number, holdMs?: number) => boolean;
  /** Toggles, and reports the state it left the clip in. */
  reverseClip: (clipId: string) => { ok: boolean; error?: string; reversed: boolean };
  /**
   * Lift a video clip's sound onto an audio track.
   *
   * Refuses a clip with no media source (the old code made an audio clip
   * with no `mediaUrl`, which `collectAudioClips` skips — a detach that
   * produced silence and reported success) and refuses a second detach
   * of the same clip (which used to stack a duplicate copy of the same
   * sound into the mix).
   */
  detachAudio: (clipId: string) => {
    ok: boolean;
    error?: string;
    audioClipId?: string;
    audioTrackId?: string;
  };
  groupSelected: () => void;
  ungroupSelected: () => void;

  /* tracks */
  addTrack: (type: TrackType, name?: string) => string;
  removeTrack: (trackId: string) => TrackEdit;
  renameTrack: (trackId: string, name: string) => TrackEdit;
  reorderTrack: (trackId: string, direction: -1 | 1) => TrackEdit;
  /* Set-or-toggle: pass the value to set it, omit it to flip it.
     `true` means the track was found and now holds that value. */
  setTrackMute: (trackId: string, muted?: boolean) => boolean;
  setTrackSolo: (trackId: string, solo?: boolean) => boolean;
  setTrackLock: (trackId: string, locked?: boolean) => boolean;
  setTrackVolume: (trackId: string, volume: number) => boolean;
  setTrackHeight: (trackId: string, heightPx: number) => void;

  /* clip properties */
  updateClipTransform: (clipId: string, transform: Partial<Clip['transform']>) => void;
  updateClipsTransform: (updates: { clipId: string; transform: Partial<Clip['transform']> }[]) => void;
  updateClipMask: (clipId: string, mask: Partial<ClipMask>) => void;
  updateClipFilters: (clipId: string, filters: Partial<ClipFilters>) => void;
  updateClipChromaKey: (clipId: string, chroma: Partial<Clip['chromaKey']>) => void;
  updateClipAudio: (clipId: string, audio: Partial<Clip['audio']>) => void;
  updateClipSpeed: (clipId: string, patch: Partial<Clip['speed']>) => void;
  setSpeedCurvePoints: (clipId: string, points: SpeedCurvePoint[]) => void;
  updateClipText: (clipId: string, textStyle: Partial<ClipTextStyle>) => void;
  setClipBlendMode: (clipId: string, blendMode: BlendMode) => void;
  setClipFitMode: (clipId: string, fitMode: Clip['fitMode']) => void;
  toggleClipLock: (clipId: string) => void;
  /** False when there is no such clip. */
  renameClip: (clipId: string, name: string) => boolean;
  resetClipTransform: (clipId: string) => void;

  /* keyframes */
  /**
   * Every one of these reports instead of returning void, and the reason
   * is the same one `setEffectParam` records above: an unknown clip id or
   * an unknown keyframe id used to be a silent no-op, so the tool over
   * the top of it said "removed" and nothing had been removed.
   *
   * There is a second, sharper reason here. A keyframe id is not
   * something a caller can guess — it is minted inside the store — so a
   * caller working from a stale read is the NORMAL case, not the odd
   * one. `addKeyframe` returns the id it minted for exactly that reason.
   */
  /** Id of the keyframe added, or null when the clip does not exist. */
  addKeyframe: (clipId: string, keyframe: Omit<KeyframePoint, 'id'>) => string | null;
  /** `created` distinguishes an insert from an update of the key already there. */
  upsertKeyframeAt: (
    clipId: string, property: AnimatableProperty, timeOffsetMs: number, value: number
  ) => { ok: boolean; id?: string; created?: boolean; error?: string };
  /** False when the clip or the keyframe could not be found. */
  removeKeyframe: (clipId: string, keyframeId: string) => boolean;
  /** False when the clip or the keyframe could not be found. */
  moveKeyframe: (clipId: string, keyframeId: string, timeOffsetMs: number, value?: number) => boolean;
  /** False when the clip or the keyframe could not be found. */
  setKeyframeEasing: (clipId: string, keyframeId: string, easing: KeyframePoint['easing'], bezier?: [number, number, number, number]) => boolean;
  /** Number of keyframes removed. Zero means there was nothing to clear. */
  clearKeyframes: (clipId: string, property?: AnimatableProperty) => number;
  applyMotionPreset: (clipId: string, preset: MotionPresetId) => boolean;

  /* VFX effect stack */
  addEffect: (clipId: string, type: string, params?: Record<string, any>) => string | null;
  /** Number removed. Zero means the reference matched nothing. */
  removeEffect: (clipId: string, effectRef: string) => number;
  /**
   * Move one effect up or down the stack.
   *
   * The compositor runs the stack in array order, so this changes the
   * picture — and it silently did nothing for an unknown effect or an
   * index already at the end, while still pushing an undo entry.
   * `from`/`to` are the indices it actually moved between.
   */
  reorderEffect: (
    clipId: string, effectRef: string, direction: -1 | 1
  ) => { ok: boolean; error?: string; from: number; to: number };
  /** Toggles `enabled`, and reports the state it left it in. */
  toggleEffect: (
    clipId: string, effectRef: string
  ) => { ok: boolean; error?: string; enabled: boolean };
  /**
   * Why this reports instead of returning void: it used to no-op
   * silently on an unknown effect, an unknown param or a rejected
   * value, and the tool above it returned success every time. An agent
   * would tell the user it had changed a parameter that never moved.
   */
  setEffectParam: (
    clipId: string, effectRef: string, param: string, value: unknown
  ) => { ok: boolean; error?: string };
  setEffectIntensity: (clipId: string, effectRef: string, intensity: number) => void;
  /** False when the clip or the effect could not be found. */
  addEffectKeyframe: (
    clipId: string, effectRef: string, param: string, timeOffsetMs: number, value: number,
    easing?: KeyframePoint['easing'], bezier?: [number, number, number, number]
  ) => boolean;
  /** False when the clip, the effect or the keyframe could not be found. */
  removeEffectKeyframe: (clipId: string, effectRef: string, keyframeId: string) => boolean;
  /** How many effects came off. Zero on an already-clean clip. */
  clearEffects: (clipId: string) => { ok: boolean; error?: string; removed: number };
  copyEffectsTo: (sourceClipId: string, targetClipIds: string[]) => void;

  /* generic property addressing — powers the AI copilot */
  setClipProperty: (clipId: string, path: string, value: unknown) => { ok: boolean; error?: string };
  patchClip: (
    clipId: string,
    patch: Record<string, unknown>,
    /**
     * Write through a lock.
     *
     * `patchClip` used to ignore locks entirely, while `splitClip`,
     * `trimClip`, `moveClip` and `deleteClip` all refused a locked clip
     * — so what "locked" protected depended on which tool you reached
     * for. It refuses by default now, and the callers that genuinely
     * mean to override say so here.
     */
    opts?: { allowLocked?: boolean }
  ) => {
    applied: string[];
    errors: string[];
    /** Per-path before/after, so a caller can show or verify the change. */
    changes: { path: string; from: unknown; to: unknown }[];
  };

  /* graphics layers */
  addShapeLayer: (trackId: string, kind: ShapeKind, startTimeMs: number, durationMs?: number) => string;
  updateShapeStyle: (clipId: string, style: Partial<ShapeStyle>) => void;
  addTextLayer: (trackId: string, text: string, startTimeMs: number, durationMs?: number) => string;
  addAdjustmentLayer: (trackId: string, startTimeMs: number, durationMs?: number) => string;

  /* motion paths */
  setMotionPath: (clipId: string, path: Partial<MotionPath>) => void;
  /**
   * `index` is where the point ended up — an append lands at the end
   * whatever index you asked for, and a caller that assumed otherwise
   * would address the wrong point next.
   */
  addMotionPathPoint: (
    clipId: string, x: number, y: number, index?: number
  ) => { ok: boolean; index?: number; pointCount?: number; error?: string };
  /** False when the clip has no path, or the index is out of range. */
  updateMotionPathPoint: (clipId: string, index: number, x: number, y: number) => boolean;
  /** False when the clip has no path, or the index is out of range. */
  removeMotionPathPoint: (clipId: string, index: number) => boolean;

  /* transitions */
  applyTransitionToClip: (clipId: string, position: 'in' | 'out', type: TransitionType, durationMs: number) => void;
  /** False when the clip does not exist, or had no transition there to remove. */
  removeTransition: (clipId: string, position: 'in' | 'out') => { ok: boolean; error?: string };

  /* markers */
  addMarker: (timeMs: number, label?: string, kind?: MarkerKind, color?: string) => void;
  /** False when there is no marker with that id. */
  updateMarker: (markerId: string, patch: Partial<TimelineMarker>) => boolean;
  /** False when there is no marker with that id. */
  removeMarker: (markerId: string) => boolean;
  /** How many markers were removed. `kind` narrows it to one kind. */
  clearMarkers: (kind?: MarkerKind) => number;
  setBeatMarkers: (beatsMs: number[]) => void;

  /* AI-facing bulk operations */
  /**
   * Cut the given TIMELINE ranges out of a track and close the gaps.
   *
   * Replaces `sliceAndRemoveSilence`, which detected nothing: it trimmed
   * 200ms off the head and tail of every clip on the track regardless of
   * content and reported the total as silence it had found. The ranges
   * now come from ffmpeg's `silencedetect` via `analyze_audio`, so this
   * is pure surgery on measurements taken elsewhere.
   */
  removeRanges: (trackId: string, ranges: { startMs: number; endMs: number }[]) => {
    removedMs: number;
    clipsAffected: number;
  };
  importCaptions: (cues: CaptionCue[], options?: ImportCaptionOptions) => number;
  snapCutsToBeats: (trackId: string, toleranceMs?: number) => number;

  /* media pool */
  addMediaAsset: (asset: MediaAsset) => void;
  removeMediaAsset: (assetId: string) => void;
  setAssetPeaks: (assetId: string, peaks: number[]) => void;

  /* history */
  /* `true` when the stack actually moved. A caller that reports "undone: 3"
     without asking is guessing; there may only have been one step. */
  undo: () => boolean;
  redo: () => boolean;
  commit: (label: string) => void;
  beginTransaction: () => void;
  commitTransaction: (label: string) => void;
  cancelTransaction: () => void;

  /* project io */
  loadProject: (tracks: Track[], markers: TimelineMarker[]) => void;
}

export type TimelineStore = TimelineState & TimelineActions;

export interface ImportCaptionOptions {
  trackId?: string;
  offsetMs?: number;
  style?: Partial<ClipTextStyle>;
  replaceExisting?: boolean;
}

export type MotionPresetId =
  | 'fade_in'
  | 'fade_out'
  | 'ken_burns_in'
  | 'ken_burns_out'
  | 'slide_in_left'
  | 'slide_in_right'
  | 'pop_in'
  | 'shake'
  | 'float'
  | 'spin_in';

/* ── helpers that operate on an immer draft ─────────────────────── */

function findClip(tracks: Track[], clipId: string): { track: Track; clip: Clip; index: number } | null {
  for (const track of tracks) {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index !== -1) return { track, clip: track.clips[index], index };
  }
  return null;
}

/**
 * Why this clip may not be written to, or null when it may.
 *
 * `15b615b` was titled "A lock now means one thing" and it was not yet
 * true. It closed the property surface — `patchClip` and `addEffect`
 * both refuse — and left the ANIMATION surface wide open: measured on
 * the running app, a locked clip refused `patch_clip` with "Rectangle is
 * locked" and then accepted `add_keyframes`, `upsert_keyframe` and
 * `add_motion_path_point`, and the three keyframes really landed on it.
 *
 * That is the worse half of the bug, not the milder one. A no-op at
 * least leaves the project as the user left it; this wrote through a
 * lock the user had set, while a neighbouring tool told them the clip
 * was protected.
 */
function lockRefusal(found: { track: Track; clip: Clip }): string | null {
  if (found.clip.locked) return `"${found.clip.name}" is locked. Unlock it first.`;
  if (found.track.locked) {
    return `"${found.clip.name}" is on locked track "${found.track.name}". Unlock it first.`;
  }
  return null;
}

function sortClips(track: Track): void {
  track.clips.sort((a, b) => a.startTimeMs - b.startTimeMs);
}

/** Push every clip after `fromMs` on a track by `deltaMs`. */
function rippleShift(track: Track, fromMs: number, deltaMs: number, exceptId?: string): void {
  for (const clip of track.clips) {
    if (clip.id === exceptId) continue;
    if (clip.startTimeMs >= fromMs) clip.startTimeMs = Math.max(0, clip.startTimeMs + deltaMs);
  }
  sortClips(track);
}

/** Pack a track's clips end-to-end from its first clip's start. */
function packTrack(track: Track): void {
  if (track.clips.length === 0) return;
  sortClips(track);
  let cursor = track.clips[0].startTimeMs;
  for (const clip of track.clips) {
    clip.startTimeMs = cursor;
    cursor += clip.durationMs;
  }
}

/**
 * Deep copy of the edit state.
 *
 * MUST be called with the finalised store state from `get()`, never with an
 * immer draft — `structuredClone` throws on the draft's Proxy objects.
 */
/**
 * A point in history. NOT a copy — a reference.
 *
 * This used to `structuredClone` the entire timeline on every commit,
 * and every tool call commits. So building a project cost O(clips) per
 * call and O(clips^2) overall: 43ms for 25 clips against 2.4 SECONDS for
 * 400, measured by `tools/measure_scale.py`. The history also held up to
 * `HISTORY_LIMIT` complete copies, which is where +48MB of heap at 400
 * clips was going.
 *
 * The clone was redundant. This store is wrapped in `immer`, so every
 * `set` produces a NEW tracks array and leaves the old one untouched —
 * the previous state is already an immutable snapshot, with structural
 * sharing so the parts that did not change are not duplicated at all.
 * Cloning it threw that sharing away to produce a second copy of
 * something nothing could mutate.
 *
 * **The invariant this rests on:** every write to `tracks` or `markers`
 * goes through `set`. That is what immer is for and what the whole store
 * already does; a direct mutation outside `set` would corrupt undo, and
 * would already have been a bug for other reasons.
 */
function snapshot(state: Pick<TimelineState, 'tracks' | 'markers'>): { tracks: Track[]; markers: TimelineMarker[] } {
  return { tracks: state.tracks, markers: state.markers };
}

/* ── motion presets ─────────────────────────────────────────────── */

interface PresetKeyframe {
  property: AnimatableProperty;
  atPct: number;
  value: number;
  easing: KeyframePoint['easing'];
}

const MOTION_PRESETS: Record<MotionPresetId, PresetKeyframe[]> = {
  fade_in: [
    { property: 'opacity', atPct: 0, value: 0, easing: 'easeOut' },
    { property: 'opacity', atPct: 0.18, value: 1, easing: 'linear' },
  ],
  fade_out: [
    { property: 'opacity', atPct: 0.82, value: 1, easing: 'easeIn' },
    { property: 'opacity', atPct: 1, value: 0, easing: 'linear' },
  ],
  ken_burns_in: [
    { property: 'scaleX', atPct: 0, value: 1, easing: 'easeInOut' },
    { property: 'scaleY', atPct: 0, value: 1, easing: 'easeInOut' },
    { property: 'scaleX', atPct: 1, value: 1.18, easing: 'linear' },
    { property: 'scaleY', atPct: 1, value: 1.18, easing: 'linear' },
  ],
  ken_burns_out: [
    { property: 'scaleX', atPct: 0, value: 1.18, easing: 'easeInOut' },
    { property: 'scaleY', atPct: 0, value: 1.18, easing: 'easeInOut' },
    { property: 'scaleX', atPct: 1, value: 1, easing: 'linear' },
    { property: 'scaleY', atPct: 1, value: 1, easing: 'linear' },
  ],
  slide_in_left: [
    { property: 'positionX', atPct: 0, value: -600, easing: 'easeOut' },
    { property: 'positionX', atPct: 0.2, value: 0, easing: 'linear' },
  ],
  slide_in_right: [
    { property: 'positionX', atPct: 0, value: 600, easing: 'easeOut' },
    { property: 'positionX', atPct: 0.2, value: 0, easing: 'linear' },
  ],
  pop_in: [
    { property: 'scaleX', atPct: 0, value: 0.6, easing: 'easeOut' },
    { property: 'scaleY', atPct: 0, value: 0.6, easing: 'easeOut' },
    { property: 'scaleX', atPct: 0.14, value: 1.08, easing: 'easeInOut' },
    { property: 'scaleY', atPct: 0.14, value: 1.08, easing: 'easeInOut' },
    { property: 'scaleX', atPct: 0.24, value: 1, easing: 'linear' },
    { property: 'scaleY', atPct: 0.24, value: 1, easing: 'linear' },
  ],
  shake: [
    { property: 'positionX', atPct: 0, value: 0, easing: 'easeInOut' },
    { property: 'positionX', atPct: 0.08, value: -22, easing: 'easeInOut' },
    { property: 'positionX', atPct: 0.16, value: 20, easing: 'easeInOut' },
    { property: 'positionX', atPct: 0.24, value: -12, easing: 'easeInOut' },
    { property: 'positionX', atPct: 0.32, value: 0, easing: 'linear' },
  ],
  float: [
    { property: 'positionY', atPct: 0, value: 0, easing: 'easeInOut' },
    { property: 'positionY', atPct: 0.5, value: -26, easing: 'easeInOut' },
    { property: 'positionY', atPct: 1, value: 0, easing: 'easeInOut' },
  ],
  spin_in: [
    { property: 'rotation', atPct: 0, value: -180, easing: 'easeOut' },
    { property: 'rotation', atPct: 0.3, value: 0, easing: 'linear' },
    { property: 'scaleX', atPct: 0, value: 0.4, easing: 'easeOut' },
    { property: 'scaleY', atPct: 0, value: 0.4, easing: 'easeOut' },
    { property: 'scaleX', atPct: 0.3, value: 1, easing: 'linear' },
    { property: 'scaleY', atPct: 0.3, value: 1, easing: 'linear' },
  ],
};

export const MOTION_PRESET_LABELS: { id: MotionPresetId; label: string; hint: string }[] = [
  { id: 'fade_in', label: 'Fade In', hint: 'Opacity 0 → 100' },
  { id: 'fade_out', label: 'Fade Out', hint: 'Opacity 100 → 0' },
  { id: 'pop_in', label: 'Pop In', hint: 'Overshoot scale' },
  { id: 'ken_burns_in', label: 'Ken Burns In', hint: 'Slow push' },
  { id: 'ken_burns_out', label: 'Ken Burns Out', hint: 'Slow pull' },
  { id: 'slide_in_left', label: 'Slide ← ', hint: 'Enter from left' },
  { id: 'slide_in_right', label: 'Slide →', hint: 'Enter from right' },
  { id: 'spin_in', label: 'Spin In', hint: 'Rotate + scale' },
  { id: 'shake', label: 'Shake', hint: 'Impact jitter' },
  { id: 'float', label: 'Float', hint: 'Gentle drift' },
];

/* ── store ──────────────────────────────────────────────────────── */

export const useTimelineStore = create<TimelineStore>()(
  immer((set, get) => ({
    /* ── initial state ── */
    tracks: INITIAL_TRACKS,
    mediaPool: SAMPLE_MEDIA_ASSETS,
    markers: [],

    playheadMs: 0,
    isPlaying: false,
    playbackRate: 1,
    loopEnabled: false,
    inPointMs: null,
    outPointMs: null,

    selectedClipIds: ['clip_vid_1'],
    selectedTrackId: 'track_main_v1',

    zoomLevel: 1,
    snappingEnabled: true,
    rippleEditMode: false,
    magneticCanvasGuides: true,

    history: [{ tracks: INITIAL_TRACKS, markers: [], label: 'Open project', at: Date.now() }],
    historyIndex: 0,
    txDepth: 0,
    txSnapshot: null,

    /* ══ history ══ */

    /* Every history operation clones OUTSIDE the immer producer: `get()`
       returns the finalised state, whereas a draft is a Proxy and
       `structuredClone` refuses to clone those. */

    commit: (label) => {
      const state = get();
      // Inside a transaction the caller owns the snapshot boundary.
      if (state.txDepth > 0) return;

      const entry: HistoryEntry = { ...snapshot(state), label, at: Date.now() };
      const trimmed = [...state.history.slice(0, state.historyIndex + 1), entry].slice(-HISTORY_LIMIT);

      set((s) => {
        s.history = trimmed;
        s.historyIndex = trimmed.length - 1;
      });
    },

    beginTransaction: () => {
      const state = get();
      const opening = state.txDepth === 0 ? snapshot(state) : state.txSnapshot;
      set((s) => {
        s.txSnapshot = opening;
        s.txDepth += 1;
      });
    },

    commitTransaction: (label) => {
      const state = get();
      const depth = Math.max(0, state.txDepth - 1);

      if (depth > 0) {
        set((s) => { s.txDepth = depth; });
        return;
      }

      const before = state.txSnapshot;

      /*
        Nothing actually changed — don't pollute the undo stack.

        Reference equality, not `JSON.stringify`. immer returns the SAME
        array when a producer made no change, so this is exact rather
        than approximate — and it is O(1) where stringifying the whole
        timeline twice was O(clips) on every transaction.
      */
      const unchanged =
        before !== null &&
        before.tracks === state.tracks &&
        before.markers === state.markers;

      if (!before || unchanged) {
        set((s) => { s.txDepth = 0; s.txSnapshot = null; });
        return;
      }

      const entry: HistoryEntry = { ...snapshot(state), label, at: Date.now() };
      const trimmed = [...state.history.slice(0, state.historyIndex + 1), entry].slice(-HISTORY_LIMIT);

      set((s) => {
        s.txDepth = 0;
        s.txSnapshot = null;
        s.history = trimmed;
        s.historyIndex = trimmed.length - 1;
      });
    },

    cancelTransaction: () => {
      const state = get();
      const depth = Math.max(0, state.txDepth - 1);
      const restore = depth === 0 ? state.txSnapshot : null;

      set((s) => {
        s.txDepth = depth;
        if (restore) {
          s.tracks = restore.tracks;
          s.markers = restore.markers;
          s.txSnapshot = null;
        }
      });
    },

    undo: () => {
      const state = get();
      if (state.historyIndex <= 0) return false;

      const index = state.historyIndex - 1;
      const restored = snapshot(state.history[index]);

      set((s) => {
        s.historyIndex = index;
        s.tracks = restored.tracks;
        s.markers = restored.markers;
        s.selectedClipIds = s.selectedClipIds.filter((id) => findClip(restored.tracks, id));
      });
      return true;
    },

    redo: () => {
      const state = get();
      if (state.historyIndex >= state.history.length - 1) return false;

      const index = state.historyIndex + 1;
      const restored = snapshot(state.history[index]);

      set((s) => {
        s.historyIndex = index;
        s.tracks = restored.tracks;
        s.markers = restored.markers;
        s.selectedClipIds = s.selectedClipIds.filter((id) => findClip(restored.tracks, id));
      });
      return true;
    },

    /* ══ transport ══ */

    setPlayheadMs: (ms) =>
      set((s) => {
        s.playheadMs = Math.max(0, Math.round(ms));
      }),

    nudgePlayhead: (deltaMs) =>
      set((s) => {
        s.playheadMs = Math.max(0, Math.round(s.playheadMs + deltaMs));
      }),

    setIsPlaying: (isPlaying) => set((s) => { s.isPlaying = isPlaying; }),
    togglePlay: () => set((s) => { s.isPlaying = !s.isPlaying; }),
    setPlaybackRate: (rate) => set((s) => { s.playbackRate = Math.max(0.25, Math.min(4, rate)); }),
    toggleLoop: () => set((s) => { s.loopEnabled = !s.loopEnabled; }),
    setInPoint: (ms) => {
      const before = get();
      if (ms === null) {
        set((s) => { s.inPointMs = null; });
        return { ok: true, inPointMs: null, outPointMs: before.outPointMs };
      }
      const at = Math.max(0, Math.round(ms));
      if (before.outPointMs !== null && at >= before.outPointMs) {
        return {
          ok: false,
          error:
            `An in point at ${at}ms is not before the out point at ${before.outPointMs}ms. ` +
            'Move or clear the out point first.',
          inPointMs: before.inPointMs,
          outPointMs: before.outPointMs,
        };
      }
      set((s) => { s.inPointMs = at; });
      return { ok: true, inPointMs: at, outPointMs: before.outPointMs };
    },

    setOutPoint: (ms) => {
      const before = get();
      if (ms === null) {
        set((s) => { s.outPointMs = null; });
        return { ok: true, inPointMs: before.inPointMs, outPointMs: null };
      }
      const at = Math.max(0, Math.round(ms));
      const floor = before.inPointMs ?? 0;
      if (at <= floor) {
        return {
          ok: false,
          error:
            `An out point at ${at}ms is not after the in point at ${floor}ms, ` +
            'so the range would be empty. Move or clear the in point first.',
          inPointMs: before.inPointMs,
          outPointMs: before.outPointMs,
        };
      }
      set((s) => { s.outPointMs = at; });
      return { ok: true, inPointMs: before.inPointMs, outPointMs: at };
    },

    clearInOut: () => {
      set((s) => { s.inPointMs = null; s.outPointMs = null; });
      return { ok: true, inPointMs: null, outPointMs: null };
    },

    /* ══ selection ══ */

    selectClip: (clipId, additive = false) =>
      set((s) => {
        if (clipId === null) {
          s.selectedClipIds = [];
          return;
        }
        if (additive) {
          s.selectedClipIds = s.selectedClipIds.includes(clipId)
            ? s.selectedClipIds.filter((id) => id !== clipId)
            : [...s.selectedClipIds, clipId];
        } else {
          s.selectedClipIds = [clipId];
        }
        const found = findClip(s.tracks, clipId);
        if (found) s.selectedTrackId = found.track.id;
      }),

    selectClips: (clipIds) => set((s) => { s.selectedClipIds = [...clipIds]; }),

    selectAllOnTrack: (trackId) =>
      set((s) => {
        const track = s.tracks.find((t) => t.id === trackId);
        s.selectedClipIds = track ? track.clips.map((c) => c.id) : [];
      }),

    clearSelection: () => set((s) => { s.selectedClipIds = []; }),
    setSelectedTrackId: (trackId) => set((s) => { s.selectedTrackId = trackId; }),

    /* ══ view ══ */

    setZoomLevel: (zoom) => set((s) => { s.zoomLevel = Math.max(0.05, Math.min(20, zoom)); }),

    zoomToFit: (viewportPx, durationMs) =>
      set((s) => {
        if (durationMs <= 0 || viewportPx <= 0) return;
        // basePixelsPerMs is 0.05 in the timeline; solve for the zoom that fits.
        s.zoomLevel = Math.max(0.05, Math.min(20, viewportPx / (durationMs * 0.05)));
      }),

    toggleSnapping: () => set((s) => { s.snappingEnabled = !s.snappingEnabled; }),
    toggleRippleEdit: () => set((s) => { s.rippleEditMode = !s.rippleEditMode; }),
    toggleCanvasGuides: () => set((s) => { s.magneticCanvasGuides = !s.magneticCanvasGuides; }),

    /* ══ structural edits ══ */

    splitClip: (clipId, splitTimeMs) => {
      let didSplit = false;
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        const { track, clip, index } = found;
        if (clip.locked || track.locked) return;

        const clipEndMs = clip.startTimeMs + clip.durationMs;
        if (splitTimeMs <= clip.startTimeMs || splitTimeMs >= clipEndMs) return;

        const firstDuration = splitTimeMs - clip.startTimeMs;
        const secondDuration = clipEndMs - splitTimeMs;

        const second: Clip = structuredClone(current(clip)) as Clip;
        second.id = uid('clip');
        second.startTimeMs = splitTimeMs;
        second.durationMs = secondDuration;
        second.sourceStartMs = clip.sourceStartMs + firstDuration;
        second.sourceDurationMs = secondDuration;
        second.transitionIn = undefined;

        /*
          Sample the animation AT the cut before splitting the keyframes.

          Without this a razor destroyed the animation it cut through.
          The head kept only the keys BEFORE the cut and then held its
          last value; the tail kept only the keys after it and held its
          first. Measured on a shape keyframed -700 -> 700 over 4000ms
          and cut at 2000ms, the picture jumped 332px at the join — a
          split is supposed to leave the frame exactly as it found it,
          and this one moved it.

          The boundary key goes to BOTH halves (hence `<=` below), and
          inherits the easing of the key it was interpolated from, which
          is exact for linear segments and continuous for the rest — the
          join never jumps, which is the property that matters.
        */
        const boundary: KeyframePoint[] = [];
        for (const property of getAnimatedProperties(clip.keyframes)) {
          const forProp = clip.keyframes.filter((k) => k.property === property);
          const before = forProp.filter((k) => k.timeOffsetMs < firstDuration);
          const spans = before.length > 0 && forProp.some((k) => k.timeOffsetMs > firstDuration);
          const sittingOnIt = forProp.some((k) => k.timeOffsetMs === firstDuration);
          if (!spans || sittingOnIt) continue;

          const previous = before.reduce((a, b) => (b.timeOffsetMs > a.timeOffsetMs ? b : a));
          boundary.push({
            id: uid('kf'),
            property,
            timeOffsetMs: firstDuration,
            value: interpolateKeyframes(forProp, property, firstDuration, 0),
            easing: previous.easing,
            ...(previous.bezierPoints ? { bezierPoints: previous.bezierPoints } : {}),
          });
        }
        const allKeys = [...clip.keyframes, ...boundary].sort(
          (a, b) => a.timeOffsetMs - b.timeOffsetMs
        );

        // Keyframes rebase onto the new clip's own timeline.
        second.keyframes = allKeys
          .filter((k) => k.timeOffsetMs >= firstDuration)
          .map((k) => ({ ...k, id: uid('kf'), timeOffsetMs: k.timeOffsetMs - firstDuration }));

        clip.durationMs = firstDuration;
        clip.sourceDurationMs = firstDuration;
        clip.transitionOut = undefined;
        clip.keyframes = allKeys.filter((k) => k.timeOffsetMs <= firstDuration);

        track.clips.splice(index + 1, 0, second);
        s.selectedClipIds = [second.id];
        didSplit = true;
      });
      if (didSplit) get().commit('Split clip');
      return didSplit;
    },

    splitAtPlayhead: () => {
      const { selectedClipIds, playheadMs, tracks, splitClip } = get();
      // With nothing selected, cut every unlocked clip under the playhead.
      const targets = selectedClipIds.length
        ? selectedClipIds
        : tracks
            .filter((t) => !t.locked)
            .flatMap((t) =>
              t.clips
                .filter((c) => playheadMs > c.startTimeMs && playheadMs < c.startTimeMs + c.durationMs)
                .map((c) => c.id)
            );
      let cut = 0;
      for (const id of targets) if (splitClip(id, playheadMs)) cut += 1;
      return { attempted: targets.length, cut };
    },

    trimClip: (clipId, newStartMs, newEndMs, ripple = false) => {
      let trimmed = false;
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        const { track, clip } = found;
        if (clip.locked || track.locked) return;
        trimmed = true;

        const MIN_DURATION = 100;
        const oldStart = clip.startTimeMs;
        const oldEnd = clip.startTimeMs + clip.durationMs;

        if (newStartMs !== undefined) {
          const clamped = Math.max(0, Math.min(newStartMs, oldEnd - MIN_DURATION));
          const delta = clamped - oldStart;
          clip.startTimeMs = clamped;
          clip.durationMs = Math.max(MIN_DURATION, clip.durationMs - delta);
          clip.sourceStartMs = Math.max(0, clip.sourceStartMs + delta);
          // Keyframes are clip-relative, so a head trim shifts them.
          clip.keyframes = clip.keyframes.map((k) => ({ ...k, timeOffsetMs: k.timeOffsetMs - delta }));
        }

        if (newEndMs !== undefined) {
          const clamped = Math.max(clip.startTimeMs + MIN_DURATION, newEndMs);
          clip.durationMs = clamped - clip.startTimeMs;
          clip.sourceDurationMs = clip.durationMs;
        }

        if (ripple && s.rippleEditMode) {
          const delta = clip.startTimeMs + clip.durationMs - oldEnd;
          if (delta !== 0) rippleShift(track, oldEnd, delta, clip.id);
        }
        sortClips(track);
      });
      /*
        The timeline's trim handle opens its own transaction on
        pointerdown and commits on pointerup, and `commit` no-ops inside
        one — so a drag is still a single entry. This is for every other
        caller: `trim_clip` had no `asOneEdit` around it, so an agent
        that trimmed a clip left the user nothing to undo.
      */
      if (trimmed) get().commit('Trim clip');
      return trimmed;
    },

    moveClip: (clipId, targetTrackId, newStartTimeMs) => {
      let moved = false;
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        const { track, clip, index } = found;
        if (clip.locked || track.locked) return;

        const target = s.tracks.find((t) => t.id === targetTrackId);
        if (!target || target.locked) return;

        const lifted = track.clips.splice(index, 1)[0];
        lifted.trackId = targetTrackId;
        lifted.startTimeMs = Math.max(0, Math.round(newStartTimeMs));
        target.clips.push(lifted);
        sortClips(target);
        if (track !== target) sortClips(track);
        moved = true;
      });
      // Same as `trimClip` and `moveClips`: the drag owns a transaction,
      // every other caller had no undo entry at all.
      if (moved) get().commit('Move clip');
      return moved;
    },

    moveClips: (moves) => {
      /*
        A batch move used to drop the ones it could not do and say
        nothing, so a caller that moved five clips and landed three had
        no way to know which two stayed put.
      */
      const moved: string[] = [];
      const refused: Refusal[] = [];

      set((s) => {
        for (const move of moves) {
          const found = findClip(s.tracks, move.clipId);
          if (!found) {
            refused.push({ clipId: move.clipId, reason: 'no clip with that id' });
            continue;
          }
          const { track, clip, index } = found;
          if (clip.locked) {
            refused.push({ clipId: move.clipId, reason: `"${clip.name}" is locked` });
            continue;
          }
          if (track.locked) {
            refused.push({ clipId: move.clipId, reason: `its track "${track.name}" is locked` });
            continue;
          }

          const target = s.tracks.find((t) => t.id === move.trackId);
          if (!target) {
            refused.push({ clipId: move.clipId, reason: `no track "${move.trackId}"` });
            continue;
          }
          if (target.locked) {
            refused.push({ clipId: move.clipId, reason: `target track "${target.name}" is locked` });
            continue;
          }

          const lifted = track.clips.splice(index, 1)[0];
          lifted.trackId = move.trackId;
          lifted.startTimeMs = Math.max(0, Math.round(move.startTimeMs));
          target.clips.push(lifted);
          moved.push(move.clipId);
        }
        for (const t of s.tracks) sortClips(t);
      });

      /*
        The UI drag already owns its own transaction — it opens one on
        pointerdown and commits on pointerup — and `commit` no-ops inside
        it, so a drag is still ONE entry and not one per pointer move.
        This is for every other caller, which until now moved clips and
        left nothing to undo.
      */
      if (moved.length > 0) get().commit(
        moved.length > 1 ? `Move ${moved.length} clips` : 'Move clip'
      );
      return { moved, refused };
    },

    deleteClip: (clipId, ripple) => {
      let removed = false;
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        const { track, clip, index } = found;
        if (clip.locked || track.locked) return;

        const gapStart = clip.startTimeMs;
        const gapSize = clip.durationMs;
        track.clips.splice(index, 1);

        const shouldRipple = ripple ?? s.rippleEditMode;
        if (shouldRipple) rippleShift(track, gapStart, -gapSize);

        s.selectedClipIds = s.selectedClipIds.filter((id) => id !== clipId);
        removed = true;
      });
      if (removed) get().commit('Delete clip');
      return removed;
    },

    deleteSelected: () => {
      /*
        With nothing selected this is a no-op, and it committed one
        anyway — an undo entry for a deletion that never happened, and a
        tool above it that reported success. Both are now visible.
      */
      const ids = get().selectedClipIds;
      const deleted: string[] = [];
      const refused: Refusal[] = [];
      if (ids.length === 0) return { deleted, refused };

      set((s) => {
        const ripple = s.rippleEditMode;
        for (const id of ids) {
          const found = findClip(s.tracks, id);
          if (!found) {
            refused.push({ clipId: id, reason: 'no longer on the timeline' });
            continue;
          }
          const { track, clip, index } = found;
          if (clip.locked) {
            refused.push({ clipId: id, reason: `"${clip.name}" is locked` });
            continue;
          }
          if (track.locked) {
            refused.push({ clipId: id, reason: `its track "${track.name}" is locked` });
            continue;
          }
          const gapStart = clip.startTimeMs;
          const gapSize = clip.durationMs;
          track.clips.splice(index, 1);
          if (ripple) rippleShift(track, gapStart, -gapSize);
          deleted.push(id);
        }
        s.selectedClipIds = [];
      });

      if (deleted.length > 0) {
        get().commit(deleted.length > 1 ? `Delete ${deleted.length} clips` : 'Delete clip');
      }
      return { deleted, refused };
    },

    duplicateClip: (clipId) => {
      /* Id minted outside the producer so the caller can be handed it —
         returning nothing meant a tool could not tell the user WHICH
         clip it had just made, nor prove one had been made at all. */
      const copyId = uid('clip');
      let made = false;

      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        const { track, clip } = found;
        /*
          The TRACK lock, and deliberately not the clip lock. A lock
          protects a clip from being changed, and duplicating leaves the
          original untouched — copying a locked clip is a thing an
          editor should let you do. Adding to a locked TRACK is not, and
          `insertClip` already refuses exactly that.
        */
        if (track.locked) return;

        const copy = structuredClone(current(clip)) as Clip;
        copy.id = copyId;
        copy.startTimeMs = clip.startTimeMs + clip.durationMs;
        copy.keyframes = clip.keyframes.map((k) => ({ ...k, id: uid('kf') }));
        copy.groupId = undefined;

        track.clips.push(copy);
        sortClips(track);
        s.selectedClipIds = [copy.id];
        made = true;
      });

      if (!made) return null;
      get().commit('Duplicate clip');
      return copyId;
    },

    insertClip: (trackId, asset, startTimeMs) => {
      const newId = uid('clip');
      set((s) => {
        const track = s.tracks.find((t) => t.id === trackId) ?? s.tracks[0];
        if (!track || track.locked) return;

        const clip = createClip({
          id: newId,
          trackId: track.id,
          type: asset.type,
          name: asset.name,
          mediaUrl: asset.url || undefined,
          thumbnailUrl: asset.thumbnailUrl || undefined,
          color: clipColorFor(asset.type),
          startTimeMs: Math.max(0, Math.round(startTimeMs)),
          durationMs: asset.durationMs || 4000,
          sourceDurationMs: asset.durationMs || 4000,
          naturalWidth: asset.width,
          naturalHeight: asset.height,
          fitMode: track.type === 'overlay' || asset.type === 'sticker' || asset.type === 'image' ? 'contain' : 'cover',
        });

        track.clips.push(clip);
        sortClips(track);
        s.selectedClipIds = [clip.id];
        s.selectedTrackId = track.id;
      });
      get().commit(`Insert ${asset.name}`);
      return newId;
    },

    insertClipObject: (clip) => {
      set((s) => {
        const track = s.tracks.find((t) => t.id === clip.trackId) ?? s.tracks[0];
        if (!track) return;
        track.clips.push(clip);
        sortClips(track);
        s.selectedClipIds = [clip.id];
      });
      get().commit(`Insert ${clip.name}`);
    },

    closeGapsOnTrack: (trackId) => {
      const track = get().tracks.find((t) => t.id === trackId);
      if (!track) {
        return {
          ok: false,
          error: `No track "${trackId}".`,
          gapsClosed: 0,
          clipsMoved: 0,
          totalShiftMs: 0,
        };
      }

      /*
        A locked track is the whole reason someone locks a track: to
        stop its timing moving. This repacked it anyway, which is the
        most destructive of the lock inconsistencies — it does not edit
        one clip, it moves every clip on the track at once.
      */
      if (track.locked) {
        return {
          ok: false,
          error: `Track "${track.name}" is locked. Unlock it first.`,
          gapsClosed: 0,
          clipsMoved: 0,
          totalShiftMs: 0,
        };
      }

      /* Measure BEFORE packing: afterwards there is nothing left to
         count, and "closed the gaps" on a track that had none is the
         no-op that reported success. `packTrack` keeps the first clip
         where it is, so a leading gap is not one of these. */
      const ordered = [...track.clips].sort((a, b) => a.startTimeMs - b.startTimeMs);
      let gapsClosed = 0;
      let clipsMoved = 0;
      let totalShiftMs = 0;
      let cursor = ordered.length > 0 ? ordered[0].startTimeMs : 0;
      for (const clip of ordered) {
        const delta = clip.startTimeMs - cursor;
        if (delta > 0) gapsClosed += 1;
        if (delta !== 0) { clipsMoved += 1; totalShiftMs += Math.abs(delta); }
        cursor += clip.durationMs;
      }

      if (clipsMoved === 0) return { ok: true, gapsClosed: 0, clipsMoved: 0, totalShiftMs: 0 };

      set((s) => {
        const t = s.tracks.find((x) => x.id === trackId);
        if (t) packTrack(t);
      });
      get().commit('Close gaps');
      return { ok: true, gapsClosed, clipsMoved, totalShiftMs };
    },

    /* ══ creative edits ══ */

    freezeFrame: (clipId, atMs, holdMs = 2000) => {
      let held = false;
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        const { track, clip, index } = found;
        const clipEnd = clip.startTimeMs + clip.durationMs;
        if (atMs <= clip.startTimeMs || atMs >= clipEnd) return;
        held = true;

        const headDuration = atMs - clip.startTimeMs;
        const tailDuration = clipEnd - atMs;

        // Freeze: a zero-length source window held for `holdMs`.
        const frozen = structuredClone(current(clip)) as Clip;
        frozen.id = uid('clip');
        frozen.name = `${clip.name} · Freeze`;
        frozen.startTimeMs = atMs;
        frozen.durationMs = holdMs;
        frozen.sourceStartMs = clip.sourceStartMs + headDuration;
        frozen.sourceDurationMs = 0;
        frozen.speed = { ...clip.speed, multiplier: 0 };
        frozen.keyframes = [];
        frozen.transitionIn = undefined;
        frozen.transitionOut = undefined;

        const tail = structuredClone(current(clip)) as Clip;
        tail.id = uid('clip');
        tail.startTimeMs = atMs + holdMs;
        tail.durationMs = tailDuration;
        tail.sourceStartMs = clip.sourceStartMs + headDuration;
        tail.sourceDurationMs = tailDuration;
        tail.transitionIn = undefined;
        tail.keyframes = clip.keyframes
          .filter((k) => k.timeOffsetMs >= headDuration)
          .map((k) => ({ ...k, id: uid('kf'), timeOffsetMs: k.timeOffsetMs - headDuration }));

        clip.durationMs = headDuration;
        clip.sourceDurationMs = headDuration;
        clip.transitionOut = undefined;
        clip.keyframes = clip.keyframes.filter((k) => k.timeOffsetMs < headDuration);

        // Everything downstream shifts to make room for the hold.
        rippleShift(track, clipEnd, holdMs);
        track.clips.splice(index + 1, 0, frozen, tail);
        sortClips(track);
        s.selectedClipIds = [frozen.id];
      });
      if (held) get().commit('Freeze frame');
      return held;
    },

    reverseClip: (clipId) => {
      let outcome: { ok: boolean; error?: string; reversed: boolean } = {
        ok: false,
        error: `No clip "${clipId}".`,
        reversed: false,
      };
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        const why = lockRefusal(found);
        if (why) { outcome = { ok: false, error: why, reversed: found.clip.speed.reversed }; return; }
        found.clip.speed.reversed = !found.clip.speed.reversed;
        outcome = { ok: true, reversed: found.clip.speed.reversed };
      });
      if (outcome.ok) get().commit('Reverse clip');
      return outcome;
    },

    detachAudio: (clipId) => {
      const audioClipId = uid('clip');
      let outcome: {
        ok: boolean; error?: string; audioClipId?: string; audioTrackId?: string;
      } = { ok: false, error: `No clip "${clipId}".` };

      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        if (found.clip.type !== 'video') {
          outcome = {
            ok: false,
            error: `"${found.clip.name}" is a ${found.clip.type} clip; only video clips carry audio to detach.`,
          };
          return;
        }
        if (!found.clip.mediaUrl) {
          /* The old code happily built an audio clip with no source.
             `collectAudioClips` requires a mediaUrl, so that clip could
             never reach the mix: a detach that produced silence and
             reported success. */
          outcome = {
            ok: false,
            error: `"${found.clip.name}" has no media source, so there is no audio to detach.`,
          };
          return;
        }
        if (found.clip.audio.detached) {
          /* Detaching twice stacked a second copy of the same sound into
             the export. Clear `audio.detached` with patch_clip if you
             really do want another copy. */
          outcome = {
            ok: false,
            error:
              `"${found.clip.name}" has already been detached, detaching again would put a ` +
              'second copy of the same sound in the mix. Set audio.detached to false first if that is what you want.',
          };
          return;
        }

        let audioTrack = s.tracks.find((t) => t.type === 'audio' && !t.locked);
        if (!audioTrack) {
          audioTrack = {
            id: uid('track'),
            type: 'audio',
            name: 'Detached Audio',
            index: s.tracks.length,
            muted: false,
            locked: false,
            solo: false,
            volume: 1,
            heightPx: 44,
            collapsed: false,
            clips: [],
          };
          s.tracks.push(audioTrack);
        }

        const audioClip = structuredClone(current(found.clip)) as Clip;
        audioClip.id = audioClipId;
        audioClip.type = 'audio';
        audioClip.trackId = audioTrack.id;
        audioClip.name = `${found.clip.name} · Audio`;
        audioClip.color = clipColorFor('audio');
        audioClip.keyframes = [];
        audioClip.audio.detached = true;

        found.clip.audio.volume = 0;
        found.clip.audio.detached = true;

        audioTrack.clips.push(audioClip);
        sortClips(audioTrack);
        outcome = { ok: true, audioClipId, audioTrackId: audioTrack.id };
      });
      if (outcome.ok) get().commit('Detach audio');
      return outcome;
    },

    groupSelected: () => {
      const ids = get().selectedClipIds;
      if (ids.length < 2) return;
      set((s) => {
        const groupId = uid('grp');
        for (const id of ids) {
          const found = findClip(s.tracks, id);
          if (found) found.clip.groupId = groupId;
        }
      });
      get().commit('Group clips');
    },

    ungroupSelected: () => {
      set((s) => {
        for (const id of s.selectedClipIds) {
          const found = findClip(s.tracks, id);
          if (found) found.clip.groupId = undefined;
        }
      });
      get().commit('Ungroup clips');
    },

    /* ══ tracks ══ */

    addTrack: (type, name) => {
      const trackId = uid('track');
      set((s) => {
        const sameType = s.tracks.filter((t) => t.type === type).length;
        const prefix = type === 'audio' ? 'A' : type === 'text' ? 'T' : 'V';
        s.tracks.unshift({
          id: trackId,
          type,
          name: name || `${prefix}${sameType + 1} · ${type[0].toUpperCase()}${type.slice(1)}`,
          index: 0,
          muted: false,
          locked: false,
          solo: false,
          volume: 1,
          heightPx: type === 'audio' ? 44 : 52,
          collapsed: false,
          clips: [],
        });
        s.tracks.forEach((t, i) => { t.index = i; });
        s.selectedTrackId = trackId;
      });
      get().commit('Add track');
      return trackId;
    },

    /*
      Every guard below is checked BEFORE the producer runs, so the reason
      can be handed back. The old versions did the test inside `set` and
      returned from the producer, which throws the reason away — and then
      committed anyway, so a removal that refused because it was the last
      track still pushed an identical entry onto the undo stack. Pressing
      undo appeared to do nothing, twice.
    */
    removeTrack: (trackId) => {
      const state = get();
      const track = state.tracks.find((t) => t.id === trackId);
      if (!track) return { ok: false, error: `No track "${trackId}".` };
      if (state.tracks.length <= 1) {
        return { ok: false, error: 'The timeline must keep at least one track.' };
      }
      set((s) => {
        s.tracks = s.tracks.filter((t) => t.id !== trackId);
        s.tracks.forEach((t, i) => { t.index = i; });
        if (s.selectedTrackId === trackId) s.selectedTrackId = s.tracks[0]?.id ?? null;
        // Clips that went with the track must not stay selected: "selected"
        // is how most tools resolve a target, and a dead id there makes the
        // NEXT tool fail with a confusing message about a different clip.
        s.selectedClipIds = s.selectedClipIds.filter((id) => findClip(s.tracks, id));
      });
      get().commit('Remove track');
      return { ok: true };
    },

    renameTrack: (trackId, name) => {
      const track = get().tracks.find((t) => t.id === trackId);
      if (!track) return { ok: false, error: `No track "${trackId}".` };

      const next = name.trim();
      if (!next) return { ok: false, error: 'A track name cannot be empty.' };
      if (next === track.name) return { ok: true };

      set((s) => {
        const t = s.tracks.find((x) => x.id === trackId);
        if (t) t.name = next;
      });
      get().commit('Rename track');
      return { ok: true };
    },

    reorderTrack: (trackId, direction) => {
      const state = get();
      const idx = state.tracks.findIndex((t) => t.id === trackId);
      if (idx === -1) return { ok: false, error: `No track "${trackId}".` };

      const target = idx + direction;
      if (target < 0 || target >= state.tracks.length) {
        return {
          ok: false,
          error:
            `"${state.tracks[idx].name}" is already at the ${direction < 0 ? 'top' : 'bottom'} ` +
            `(index ${idx} of 0–${state.tracks.length - 1}).`,
        };
      }

      set((s) => {
        const [moved] = s.tracks.splice(idx, 1);
        s.tracks.splice(target, 0, moved);
        s.tracks.forEach((t, i) => { t.index = i; });
      });
      get().commit('Reorder track');
      return { ok: true };
    },

    /*
      Set-or-toggle, and these three now COMMIT.

      They did not, while `renameTrack` did — so the edit that changes the
      exported file was missing from the undo stack and the one that
      changes a label was on it. That was not a deliberate "view-ish
      toggle" exemption, because history snapshots the whole `tracks`
      array: a mutation that skips `commit` is not outside history, it is
      silently REVERTED by the next unrelated undo. Mute a track, rename
      another, undo the rename, and the mute came back on.

      They also take the value they want rather than only flipping. An
      agent that needs a track muted should not have to read the state,
      work out the current value and race whatever else is editing;
      omitting the argument still toggles, which is what the header
      button wants.
    */
    setTrackMute: (trackId, muted) => {
      const track = get().tracks.find((t) => t.id === trackId);
      if (!track) return false;
      const next = muted ?? !track.muted;
      if (next !== track.muted) {
        set((s) => {
          const t = s.tracks.find((x) => x.id === trackId);
          if (t) t.muted = next;
        });
        get().commit(next ? 'Mute track' : 'Unmute track');
      }
      return true;
    },

    setTrackSolo: (trackId, solo) => {
      const track = get().tracks.find((t) => t.id === trackId);
      if (!track) return false;
      const next = solo ?? !track.solo;
      if (next !== track.solo) {
        set((s) => {
          const t = s.tracks.find((x) => x.id === trackId);
          if (t) t.solo = next;
        });
        get().commit(next ? 'Solo track' : 'Un-solo track');
      }
      return true;
    },

    setTrackLock: (trackId, locked) => {
      const track = get().tracks.find((t) => t.id === trackId);
      if (!track) return false;
      const next = locked ?? !track.locked;
      if (next !== track.locked) {
        set((s) => {
          const t = s.tracks.find((x) => x.id === trackId);
          if (t) t.locked = next;
        });
        get().commit(next ? 'Lock track' : 'Unlock track');
      }
      return true;
    },

    /*
      No commit here, and that IS deliberate: both volume sliders write on
      every pointer move, so a commit per call would push one history
      entry per mouse pixel. The MCP tool wraps its single call in
      `asOneEdit`, which gives an agent exactly one undo step and leaves
      the slider alone.
    */
    setTrackVolume: (trackId, volume) => {
      if (!Number.isFinite(volume)) return false;
      const track = get().tracks.find((t) => t.id === trackId);
      if (!track) return false;
      const next = Math.max(0, Math.min(2, volume));
      if (next !== track.volume) {
        set((s) => {
          const t = s.tracks.find((x) => x.id === trackId);
          if (t) t.volume = next;
        });
      }
      return true;
    },

    /*
      Row height is the one track property that changes nothing about the
      render, and it is dragged rather than clicked — so it stays off the
      undo stack on purpose. The cost of that is real and is written down
      here rather than pretended away: because history holds whole tracks,
      an unrelated undo can snap a resized row back to its old height.
    */
    setTrackHeight: (trackId, heightPx) =>
      set((s) => {
        const t = s.tracks.find((x) => x.id === trackId);
        if (t) t.heightPx = Math.max(28, Math.min(160, heightPx));
      }),

    /* ══ clip properties ══ */

    updateClipTransform: (clipId, transform) =>
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (found && !found.clip.locked) Object.assign(found.clip.transform, transform);
      }),

    updateClipsTransform: (updates) =>
      set((s) => {
        for (const u of updates) {
          const found = findClip(s.tracks, u.clipId);
          if (found && !found.clip.locked) Object.assign(found.clip.transform, u.transform);
        }
      }),

    updateClipMask: (clipId, mask) =>
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (found) Object.assign(found.clip.mask, mask);
      }),

    updateClipFilters: (clipId, filters) =>
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (found) Object.assign(found.clip.filters, filters);
      }),

    updateClipChromaKey: (clipId, chroma) =>
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (found) Object.assign(found.clip.chromaKey, chroma);
      }),

    updateClipAudio: (clipId, audio) =>
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (found) Object.assign(found.clip.audio, audio);
      }),

    updateClipSpeed: (clipId, patch) =>
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        const { clip } = found;
        const prevMultiplier = clip.speed.multiplier || 1;
        Object.assign(clip.speed, patch);

        // A speed change re-times the clip on the timeline.
        if (patch.multiplier !== undefined && patch.multiplier > 0 && prevMultiplier > 0) {
          const ratio = prevMultiplier / patch.multiplier;
          clip.durationMs = Math.max(100, Math.round(clip.durationMs * ratio));
        }
      }),

    setSpeedCurvePoints: (clipId, points) =>
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        found.clip.speed.customPoints = [...points].sort((a, b) => a.timePct - b.timePct);
        found.clip.speed.curvePreset = 'custom';
      }),

    updateClipText: (clipId, textStyle) =>
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        found.clip.textStyle = { ...DEFAULT_TEXT_STYLE, ...found.clip.textStyle, ...textStyle };
        if (textStyle.text !== undefined) found.clip.name = textStyle.text.slice(0, 40) || 'Text';
      }),

    setClipBlendMode: (clipId, blendMode) => {
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (found) found.clip.blendMode = blendMode;
      });
      get().commit('Change blend mode');
    },

    setClipFitMode: (clipId, fitMode) => {
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (found) found.clip.fitMode = fitMode;
      });
      get().commit('Change fit mode');
    },

    toggleClipLock: (clipId) => {
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (found) found.clip.locked = !found.clip.locked;
      });
      get().commit('Toggle clip lock');
    },

    renameClip: (clipId, name) => {
      let renamed = false;
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found || lockRefusal(found)) return;
        found.clip.name = name;
        renamed = true;
      });
      if (renamed) get().commit('Rename clip');
      return renamed;
    },

    resetClipTransform: (clipId) => {
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        Object.assign(found.clip.transform, {
          x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, flipH: false, flipV: false,
        });
      });
      get().commit('Reset transform');
    },

    /* ══ keyframes ══ */

    addKeyframe: (clipId, keyframe) => {
      const id = uid('kf');
      let added = false;
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found || lockRefusal(found)) return;
        found.clip.keyframes.push({ ...keyframe, id });
        found.clip.keyframes.sort((a, b) => a.timeOffsetMs - b.timeOffsetMs);
        added = true;
      });
      if (!added) return null;
      get().commit('Add keyframe');
      return id;
    },

    upsertKeyframeAt: (clipId, property, timeOffsetMs, value) => {
      const fresh = uid('kf');
      let outcome: { ok: boolean; id?: string; created?: boolean; error?: string } = {
        ok: false, error: `Clip "${clipId}" does not exist.`,
      };
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        const why = lockRefusal(found);
        if (why) { outcome = { ok: false, error: why }; return; }
        const t = Math.max(0, Math.round(timeOffsetMs));
        // Within a frame of an existing key? Update it instead of stacking.
        const existing = found.clip.keyframes.find(
          (k) => k.property === property && Math.abs(k.timeOffsetMs - t) < 34
        );
        if (existing) {
          existing.value = value;
          outcome = { ok: true, id: existing.id, created: false };
        } else {
          found.clip.keyframes.push({ id: fresh, property, timeOffsetMs: t, value, easing: 'easeInOut' });
          found.clip.keyframes.sort((a, b) => a.timeOffsetMs - b.timeOffsetMs);
          outcome = { ok: true, id: fresh, created: true };
        }
      });
      if (outcome.ok) get().commit('Set keyframe');
      return outcome;
    },

    removeKeyframe: (clipId, keyframeId) => {
      let removed = false;
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found || lockRefusal(found)) return;
        const before = found.clip.keyframes.length;
        found.clip.keyframes = found.clip.keyframes.filter((k) => k.id !== keyframeId);
        removed = found.clip.keyframes.length < before;
      });
      // No commit on a miss: an unknown id used to push an identical
      // snapshot onto the undo stack, so undo did nothing visible once.
      if (removed) get().commit('Remove keyframe');
      return removed;
    },

    moveKeyframe: (clipId, keyframeId, timeOffsetMs, value) => {
      let moved = false;
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found || lockRefusal(found)) return;
        const kf = found.clip.keyframes.find((k) => k.id === keyframeId);
        if (!kf) return;
        kf.timeOffsetMs = Math.max(0, Math.min(found.clip.durationMs, Math.round(timeOffsetMs)));
        if (value !== undefined) kf.value = value;
        found.clip.keyframes.sort((a, b) => a.timeOffsetMs - b.timeOffsetMs);
        moved = true;
      });
      return moved;
    },

    setKeyframeEasing: (clipId, keyframeId, easing, bezier) => {
      let changed = false;
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found || lockRefusal(found)) return;
        const kf = found.clip.keyframes.find((k) => k.id === keyframeId);
        if (!kf) return;
        kf.easing = easing;
        if (bezier) kf.bezierPoints = bezier;
        changed = true;
      });
      if (changed) get().commit('Change easing');
      return changed;
    },

    clearKeyframes: (clipId, property) => {
      let cleared = 0;
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found || lockRefusal(found)) return;
        const before = found.clip.keyframes.length;
        found.clip.keyframes = property
          ? found.clip.keyframes.filter((k) => k.property !== property)
          : [];
        cleared = before - found.clip.keyframes.length;
      });
      if (cleared > 0) get().commit('Clear keyframes');
      return cleared;
    },

    applyMotionPreset: (clipId, preset) => {
      let applied = false;
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found || lockRefusal(found)) return;
        const { clip } = found;
        const spec = MOTION_PRESETS[preset];
        if (!spec) return;
        applied = true;

        const touched = new Set(spec.map((k) => k.property));
        clip.keyframes = clip.keyframes.filter((k) => !touched.has(k.property));

        for (const k of spec) {
          clip.keyframes.push({
            id: uid('kf'),
            property: k.property,
            timeOffsetMs: Math.round(clip.durationMs * k.atPct),
            value: k.value,
            easing: k.easing,
          });
        }
        clip.keyframes.sort((a, b) => a.timeOffsetMs - b.timeOffsetMs);
      });
      if (applied) get().commit(`Apply ${preset.replace(/_/g, ' ')}`);
      return applied;
    },

    /* ══ VFX effect stack ══ */

    addEffect: (clipId, type, params = {}) => {
      const def = getEffectDefinition(type);
      if (!def) return null;

      const effectId = uid('fx');
      let added = false;
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        /*
          A locked clip refuses an effect, the same way it refuses a
          split, a trim, a move, a delete and a patch. `add_effect`
          reported success and really did apply the effect, so "locked"
          meant different things depending on which tool you reached for.

          This comment used to call it "the last edit path that wrote
          through a lock". That was wrong: the whole ANIMATION surface
          still did, and building the keyframe tools is what surfaced it.
          See `lockRefusal`.

          `added` stays false, and the caller already treats that as the
          failure it is — the comment below is about exactly this.
        */
        const track = s.tracks.find((t) => t.clips.some((c) => c.id === clipId));
        if (found.clip.locked || track?.locked) return;
        const instance = createEffectInstance(type, effectId, params);
        if (!instance) return;
        found.clip.effects.push(instance);
        added = true;
      });
      /* Returning an id for an effect that was never pushed is how a tool
         reports success on a missing clip. */
      if (!added) return null;
      get().commit(`Add ${def.label}`);
      return effectId;
    },

    removeEffect: (clipId, effectRef) => {
      let removed = 0;
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        const before = found.clip.effects.length;
        found.clip.effects = found.clip.effects.filter(
          (e) => e.id !== effectRef && e.type !== effectRef
        );
        removed = before - found.clip.effects.length;
      });
      // Do not push a history entry for a removal that removed nothing.
      if (removed > 0) get().commit('Remove effect');
      return removed;
    },

    reorderEffect: (clipId, effectRef, direction) => {
      let outcome: { ok: boolean; error?: string; from: number; to: number } = {
        ok: false,
        error: `No clip "${clipId}".`,
        from: -1,
        to: -1,
      };
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        const why = lockRefusal(found);
        if (why) { outcome = { ok: false, error: why, from: -1, to: -1 }; return; }
        const list = found.clip.effects;
        const idx = list.findIndex((e) => e.id === effectRef || e.type === effectRef);
        if (idx === -1) {
          const have = list.map((e) => e.type).join(', ') || 'none';
          outcome = {
            ok: false,
            error: `"${found.clip.name}" has no effect "${effectRef}". On it: ${have}.`,
            from: -1,
            to: -1,
          };
          return;
        }
        const target = idx + direction;
        if (target < 0 || target >= list.length) {
          outcome = {
            ok: false,
            error:
              `"${effectRef}" is already at ${target < 0 ? 'the bottom' : 'the top'} of ` +
              `${found.clip.name}'s stack (index ${idx} of ${list.length}).`,
            from: idx,
            to: idx,
          };
          return;
        }
        const [moved] = list.splice(idx, 1);
        list.splice(target, 0, moved);
        outcome = { ok: true, from: idx, to: target };
      });
      if (outcome.ok) get().commit('Reorder effects');
      return outcome;
    },

    toggleEffect: (clipId, effectRef) => {
      let outcome: { ok: boolean; error?: string; enabled: boolean } = {
        ok: false,
        error: `No clip "${clipId}".`,
        enabled: false,
      };
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        const why = lockRefusal(found);
        if (why) { outcome = { ok: false, error: why, enabled: false }; return; }
        const fx = found.clip.effects.find((e) => e.id === effectRef || e.type === effectRef);
        if (!fx) {
          const have = found.clip.effects.map((e) => e.type).join(', ') || 'none';
          outcome = {
            ok: false,
            error: `"${found.clip.name}" has no effect "${effectRef}". On it: ${have}.`,
            enabled: false,
          };
          return;
        }
        fx.enabled = !fx.enabled;
        outcome = { ok: true, enabled: fx.enabled };
      });
      /*
        Bypassing an effect changes the picture, so it belongs on the
        undo stack — the inspector's bypass button was the last edit in
        the app that could not be taken back. Only on a real toggle: a
        refusal used to be worth an identical snapshot, which is how
        undo came to do nothing visible once.

        `commit` no-ops inside a transaction, so the tool's `asOneEdit`
        still produces exactly one entry rather than two.
      */
      if (outcome.ok) get().commit('Toggle effect');
      return outcome;
    },

    setEffectParam: (clipId, effectRef, param, value) => {
      let outcome: { ok: boolean; error?: string } = {
        ok: false,
        error: `No clip "${clipId}".`,
      };

      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;

        const fx = found.clip.effects.find((e) => e.id === effectRef || e.type === effectRef);
        if (!fx) {
          const have = found.clip.effects.map((e) => e.type).join(', ') || 'none';
          outcome = { ok: false, error: `"${found.clip.name}" has no effect "${effectRef}". On it: ${have}.` };
          return;
        }

        const path = `effects.${effectRef}.${param}`;
        const result = validateProperty(found.clip, path, value);
        if (!result.ok) {
          outcome = { ok: false, error: result.error ?? `Could not set ${path}.` };
          return;
        }

        applyClipProperty(found.clip, path, result.value);
        outcome = { ok: true };
      });

      return outcome;
    },

    setEffectIntensity: (clipId, effectRef, intensity) =>
      set((s) => {
        const found = findClip(s.tracks, clipId);
        const fx = found?.clip.effects.find((e) => e.id === effectRef || e.type === effectRef);
        if (fx) fx.intensity = Math.max(0, Math.min(1, intensity));
      }),

    addEffectKeyframe: (clipId, effectRef, param, timeOffsetMs, value, easing, bezier) => {
      let placed = false;
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found || lockRefusal(found)) return;
        const fx = found.clip.effects.find((e) => e.id === effectRef || e.type === effectRef);
        if (!fx) return;
        placed = true;
        if (!fx.keyframes) fx.keyframes = [];

        const t = Math.max(0, Math.round(timeOffsetMs));
        const existing = fx.keyframes.find((k) => k.param === param && Math.abs(k.timeOffsetMs - t) < 34);
        const curve = easing ?? 'easeInOut';
        if (existing) {
          existing.value = value;
          existing.easing = curve;
          if (bezier) existing.bezierPoints = bezier;
        } else {
          fx.keyframes.push({
            id: uid('efk'), param, timeOffsetMs: t, value, easing: curve,
            ...(bezier ? { bezierPoints: bezier } : {}),
          });
          fx.keyframes.sort((a, b) => a.timeOffsetMs - b.timeOffsetMs);
        }
      });
      if (placed) get().commit('Keyframe effect parameter');
      return placed;
    },

    removeEffectKeyframe: (clipId, effectRef, keyframeId) => {
      let removed = false;
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found || lockRefusal(found)) return;
        const fx = found.clip.effects.find((e) => e.id === effectRef || e.type === effectRef);
        if (!fx?.keyframes) return;
        const before = fx.keyframes.length;
        fx.keyframes = fx.keyframes.filter((k) => k.id !== keyframeId);
        removed = fx.keyframes.length < before;
      });
      if (removed) get().commit('Remove effect keyframe');
      return removed;
    },

    clearEffects: (clipId) => {
      let outcome: { ok: boolean; error?: string; removed: number } = {
        ok: false,
        error: `No clip "${clipId}".`,
        removed: 0,
      };
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        const why = lockRefusal(found);
        if (why) { outcome = { ok: false, error: why, removed: 0 }; return; }
        const removed = found.clip.effects.length;
        if (removed > 0) found.clip.effects = [];
        outcome = { ok: true, removed };
      });
      // No history entry for a clip that had nothing on it, the same way
      // `removeEffect` refuses to record a removal that removed nothing.
      if (outcome.removed > 0) get().commit('Clear effects');
      return outcome;
    },

    copyEffectsTo: (sourceClipId, targetClipIds) => {
      set((s) => {
        const source = findClip(s.tracks, sourceClipId);
        if (!source) return;
        const stack = structuredClone(current(source.clip.effects)) as ClipEffect[];

        for (const targetId of targetClipIds) {
          const target = findClip(s.tracks, targetId);
          if (!target || target.clip.id === sourceClipId) continue;
          target.clip.effects = stack.map((fx) => ({
            ...structuredClone(fx),
            id: uid('fx'),
            keyframes: (fx.keyframes ?? []).map((k) => ({ ...k, id: uid('efk') })),
          }));
        }
      });
      get().commit('Paste effects');
    },

    /* ══ generic property addressing ══ */

    setClipProperty: (clipId, path, value) => {
      const resolved = path.includes('.') || path === 'name' ? path : (resolvePropertyAlias(path) ?? path);
      let outcome: { ok: boolean; error?: string } = { ok: false, error: 'Clip not found' };

      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        const result = validateProperty(found.clip, resolved, value);
        if (!result.ok) {
          outcome = { ok: false, error: result.error };
          return;
        }
        applyClipProperty(found.clip, resolved, result.value);
        outcome = { ok: true };
      });

      if (outcome.ok) get().commit(`Set ${resolved}`);
      return outcome;
    },

    patchClip: (clipId, patch, opts) => {
      const applied: string[] = [];
      const errors: string[] = [];
      /*
        The value BEFORE the write, captured per path.

        Worth the extra read: "set saturation to 45" and "saturation was
        already 45" are the same result otherwise, and both the diff view
        and an agent checking its own work need to tell them apart.
      */
      const changes: { path: string; from: unknown; to: unknown }[] = [];

      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) {
          errors.push(`No clip with id "${clipId}"`);
          return;
        }

        /*
          Honour the lock, the way every other edit path does.

          `locked` is also a property this function can SET, so unlocking
          has to stay possible — a patch that only touches `locked` is
          allowed through, or a locked clip could never be unlocked
          through this path again.
        */
        const track = s.tracks.find((t) => t.clips.some((c) => c.id === clipId));
        const onlyUnlocking = Object.keys(patch).every((k) => k === 'locked');
        if (!opts?.allowLocked && !onlyUnlocking) {
          if (found.clip.locked) {
            errors.push(`"${found.clip.name}" is locked. Unlock it first.`);
            return;
          }
          if (track?.locked) {
            errors.push(`"${found.clip.name}" is on locked track "${track.name}". Unlock it first.`);
            return;
          }
        }

        for (const [rawPath, value] of Object.entries(patch)) {
          const path = rawPath.includes('.') || rawPath === 'name'
            ? rawPath
            : (resolvePropertyAlias(rawPath) ?? rawPath);
          const result = validateProperty(found.clip, path, value);
          if (result.ok) {
            const before = getClipProperty(found.clip, path);
            applyClipProperty(found.clip, path, result.value);
            applied.push(path);
            changes.push({ path, from: before, to: result.value });
          } else {
            errors.push(result.error ?? `Could not set ${rawPath}`);
          }
        }
      });

      if (applied.length > 0) get().commit(`Update ${applied.length} propert${applied.length === 1 ? 'y' : 'ies'}`);
      return { applied, errors, changes };
    },

    /* ══ graphics layers ══ */

    addShapeLayer: (trackId, kind, startTimeMs, durationMs = 3000) => {
      const id = uid('shape');
      set((s) => {
        const track = s.tracks.find((t) => t.id === trackId) ?? s.tracks[0];
        if (!track) return;
        track.clips.push(
          createClip({
            id,
            trackId: track.id,
            type: 'shape',
            name: `${kind[0].toUpperCase()}${kind.slice(1)}`,
            color: clipColorFor('shape'),
            startTimeMs: Math.max(0, Math.round(startTimeMs)),
            durationMs,
            sourceDurationMs: durationMs,
            fitMode: 'none',
            naturalWidth: 480,
            naturalHeight: 480,
            shapeStyle: { ...DEFAULT_SHAPE_STYLE, kind },
          })
        );
        sortClips(track);
        s.selectedClipIds = [id];
        s.selectedTrackId = track.id;
      });
      get().commit(`Add ${kind}`);
      return id;
    },

    updateShapeStyle: (clipId, style) =>
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        found.clip.shapeStyle = { ...DEFAULT_SHAPE_STYLE, ...found.clip.shapeStyle, ...style };
      }),

    addTextLayer: (trackId, text, startTimeMs, durationMs = 4000) => {
      const id = uid('txt');
      set((s) => {
        const track =
          s.tracks.find((t) => t.id === trackId) ??
          s.tracks.find((t) => t.type === 'text') ??
          s.tracks[0];
        if (!track) return;
        track.clips.push(
          createClip({
            id,
            trackId: track.id,
            type: 'text',
            name: text.slice(0, 40) || 'Text',
            color: clipColorFor('text'),
            startTimeMs: Math.max(0, Math.round(startTimeMs)),
            durationMs,
            sourceDurationMs: durationMs,
            fitMode: 'none',
            textStyle: { text },
          })
        );
        sortClips(track);
        s.selectedClipIds = [id];
        s.selectedTrackId = track.id;
      });
      get().commit('Add text layer');
      return id;
    },

    addAdjustmentLayer: (trackId, startTimeMs, durationMs = 5000) => {
      const id = uid('adj');
      set((s) => {
        const track = s.tracks.find((t) => t.id === trackId) ?? s.tracks[0];
        if (!track) return;
        track.clips.push(
          createClip({
            id,
            trackId: track.id,
            type: 'adjustment',
            name: 'Adjustment Layer',
            color: clipColorFor('adjustment'),
            startTimeMs: Math.max(0, Math.round(startTimeMs)),
            durationMs,
            sourceDurationMs: durationMs,
            fitMode: 'fill',
          })
        );
        sortClips(track);
        s.selectedClipIds = [id];
      });
      get().commit('Add adjustment layer');
      return id;
    },

    /* ══ motion paths ══ */

    setMotionPath: (clipId, path) => {
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found || lockRefusal(found)) return;
        found.clip.motionPath = {
          enabled: true,
          points: [],
          closed: false,
          orientToPath: false,
          easing: 'easeInOut',
          ...found.clip.motionPath,
          ...path,
        };
      });
      get().commit('Update motion path');
    },

    addMotionPathPoint: (clipId, x, y, index) => {
      let outcome: { ok: boolean; index?: number; pointCount?: number; error?: string } = {
        ok: false, error: `Clip "${clipId}" does not exist.`,
      };
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        const why = lockRefusal(found);
        if (why) { outcome = { ok: false, error: why }; return; }
        if (!found.clip.motionPath) {
          found.clip.motionPath = { enabled: true, points: [], closed: false, orientToPath: false, easing: 'easeInOut' };
        }
        const pts = found.clip.motionPath.points;
        const point = { x: Math.round(x), y: Math.round(y) };
        let at: number;
        if (index === undefined || index >= pts.length) {
          at = pts.length;
          pts.push(point);
        } else {
          at = Math.max(0, index);
          pts.splice(at, 0, point);
        }
        outcome = { ok: true, index: at, pointCount: pts.length };
      });
      if (outcome.ok) get().commit('Add path point');
      return outcome;
    },

    updateMotionPathPoint: (clipId, index, x, y) => {
      let moved = false;
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found || lockRefusal(found)) return;
        const pts = found.clip.motionPath?.points;
        if (!pts || index < 0 || index >= pts.length) return;
        pts[index].x = Math.round(x);
        pts[index].y = Math.round(y);
        moved = true;
      });
      return moved;
    },

    removeMotionPathPoint: (clipId, index) => {
      let removed = false;
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found || lockRefusal(found)) return;
        const pts = found.clip.motionPath?.points;
        if (!pts || index < 0 || index >= pts.length) return;
        pts.splice(index, 1);
        removed = true;
      });
      if (removed) get().commit('Remove path point');
      return removed;
    },

    /* ══ transitions ══ */

    applyTransitionToClip: (clipId, position, type, durationMs) => {
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        const capped = Math.min(durationMs, Math.floor(found.clip.durationMs / 2));
        if (position === 'in') found.clip.transitionIn = { type, durationMs: capped };
        else found.clip.transitionOut = { type, durationMs: capped };
      });
      get().commit(`Apply ${type} transition`);
    },

    removeTransition: (clipId, position) => {
      /*
        Reports, and commits only when it actually removed something.

        Both of the defects the track and keyframe lanes found are here
        in one action: it returned void, so a tool above it could only
        say "success" whether or not a transition existed; and it
        committed unconditionally, so declining still pushed an
        identical snapshot onto the undo stack and the user's next undo
        appeared to do nothing.
      */
      let outcome: { ok: boolean; error?: string } = {
        ok: false, error: `No clip "${clipId}".`,
      };
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        const had = position === 'in' ? found.clip.transitionIn : found.clip.transitionOut;
        if (!had) {
          outcome = {
            ok: false,
            error: `"${found.clip.name}" has no ${position} transition to remove.`,
          };
          return;
        }
        if (position === 'in') found.clip.transitionIn = undefined;
        else found.clip.transitionOut = undefined;
        outcome = { ok: true };
      });
      if (outcome.ok) get().commit('Remove transition');
      return outcome;
    },

    /* ══ markers ══ */

    addMarker: (timeMs, label, kind = 'generic', color = '#f5a524') => {
      set((s) => {
        s.markers.push({
          id: uid('mk'),
          timeMs: Math.max(0, Math.round(timeMs)),
          label: label || `Marker ${s.markers.length + 1}`,
          color,
          kind,
        });
        s.markers.sort((a, b) => a.timeMs - b.timeMs);
      });
      get().commit('Add marker');
    },

    updateMarker: (markerId, patch) => {
      let found = false;
      set((s) => {
        const m = s.markers.find((x) => x.id === markerId);
        if (!m) return;
        Object.assign(m, patch);
        /* An id in the patch would make the marker unaddressable by the
           id the caller just used. */
        if (patch.id !== undefined) m.id = markerId;
        if (patch.timeMs !== undefined) {
          m.timeMs = Math.max(0, Math.round(m.timeMs));
          // Markers are kept in time order; a moved one has to re-sort.
          s.markers.sort((a, b) => a.timeMs - b.timeMs);
        }
        found = true;
      });
      if (found) get().commit('Update marker');
      return found;
    },

    removeMarker: (markerId) => {
      let removed = false;
      set((s) => {
        const before = s.markers.length;
        s.markers = s.markers.filter((m) => m.id !== markerId);
        removed = s.markers.length < before;
      });
      if (removed) get().commit('Remove marker');
      return removed;
    },

    clearMarkers: (kind) => {
      let removed = 0;
      set((s) => {
        const before = s.markers.length;
        s.markers = kind ? s.markers.filter((m) => m.kind !== kind) : [];
        removed = before - s.markers.length;
      });
      if (removed > 0) get().commit('Clear markers');
      return removed;
    },

    setBeatMarkers: (beatsMs) => {
      set((s) => {
        s.markers = s.markers.filter((m) => m.kind !== 'beat');
        for (const t of beatsMs) {
          s.markers.push({
            id: uid('mk'),
            timeMs: Math.round(t),
            label: '',
            color: '#f472b6',
            kind: 'beat',
          });
        }
        s.markers.sort((a, b) => a.timeMs - b.timeMs);
      });
      get().commit('Detect beats');
    },

    /* ══ AI bulk operations ══ */

    removeRanges: (trackId, ranges) => {
      let removedMs = 0;
      let clipsAffected = 0;

      set((s) => {
        const track = s.tracks.find((t) => t.id === trackId);
        if (!track || track.clips.length === 0 || ranges.length === 0) return;

        // Merge overlapping ranges so a region is never removed twice.
        const merged: { startMs: number; endMs: number }[] = [];
        for (const r of [...ranges].sort((a, b) => a.startMs - b.startMs)) {
          if (r.endMs <= r.startMs) continue;
          const last = merged[merged.length - 1];
          if (last && r.startMs <= last.endMs) last.endMs = Math.max(last.endMs, r.endMs);
          else merged.push({ startMs: r.startMs, endMs: r.endMs });
        }
        if (merged.length === 0) return;

        sortClips(track);
        const rebuilt: Clip[] = [];

        for (const clip of track.clips) {
          const clipStart = clip.startTimeMs;
          const clipEnd = clipStart + clip.durationMs;

          /*
            What survives, in timeline coordinates. A range may split one
            clip into several pieces, so this is a list, not a pair.
          */
          let pieces: { startMs: number; endMs: number }[] = [{ startMs: clipStart, endMs: clipEnd }];

          for (const cut of merged) {
            const next: { startMs: number; endMs: number }[] = [];
            for (const piece of pieces) {
              if (cut.endMs <= piece.startMs || cut.startMs >= piece.endMs) {
                next.push(piece);
                continue;
              }
              if (cut.startMs > piece.startMs) next.push({ startMs: piece.startMs, endMs: cut.startMs });
              if (cut.endMs < piece.endMs) next.push({ startMs: cut.endMs, endMs: piece.endMs });
            }
            pieces = next;
          }

          const survivingMs = pieces.reduce((n, p) => n + (p.endMs - p.startMs), 0);
          if (survivingMs !== clip.durationMs) clipsAffected++;
          removedMs += clip.durationMs - survivingMs;

          // A clip entirely inside a removed range simply goes.
          if (pieces.length === 0) continue;

          pieces.forEach((piece, i) => {
            const copy: Clip = i === 0 ? clip : (structuredClone(current(clip)) as Clip);
            if (i > 0) copy.id = uid('clip');

            const headOffset = piece.startMs - clipStart;
            const duration = piece.endMs - piece.startMs;

            copy.startTimeMs = piece.startMs;
            copy.durationMs = duration;
            copy.sourceStartMs = clip.sourceStartMs + headOffset * (clip.speed?.multiplier ?? 1);
            copy.sourceDurationMs = duration * (clip.speed?.multiplier ?? 1);
            // Keyframes are clip-relative; rebase and drop the ones cut out.
            copy.keyframes = clip.keyframes
              .filter((k) => k.timeOffsetMs >= headOffset && k.timeOffsetMs < headOffset + duration)
              .map((k) => ({ ...k, id: uid('kf'), timeOffsetMs: k.timeOffsetMs - headOffset }));
            // A transition across a cut edge no longer has anything to cross.
            if (i > 0) copy.transitionIn = undefined;
            if (i < pieces.length - 1) copy.transitionOut = undefined;

            rebuilt.push(copy);
          });
        }

        /*
          Close the gaps. Each surviving piece slides left by the total
          removed time that lay before it.
        */
        rebuilt.sort((a, b) => a.startTimeMs - b.startTimeMs);
        for (const clip of rebuilt) {
          let shift = 0;
          for (const cut of merged) {
            if (cut.endMs <= clip.startTimeMs) shift += cut.endMs - cut.startMs;
            else break;
          }
          clip.startTimeMs = Math.max(0, clip.startTimeMs - shift);
        }

        track.clips = rebuilt;
        sortClips(track);
        s.selectedClipIds = s.selectedClipIds.filter((id) => rebuilt.some((c) => c.id === id));
      });

      if (removedMs > 0) get().commit('Remove silence');
      return { removedMs, clipsAffected };
    },

    importCaptions: (cues, options = {}) => {
      if (cues.length === 0) return 0;
      const offset = options.offsetMs ?? 0;

      set((s) => {
        let track = options.trackId
          ? s.tracks.find((t) => t.id === options.trackId)
          : s.tracks.find((t) => t.type === 'text');

        if (!track) {
          track = {
            id: uid('track'),
            type: 'text',
            name: 'Imported Captions',
            index: 0,
            muted: false,
            locked: false,
            solo: false,
            volume: 1,
            heightPx: 46,
            collapsed: false,
            clips: [],
          };
          s.tracks.unshift(track);
          s.tracks.forEach((t, i) => { t.index = i; });
        }

        if (options.replaceExisting) track.clips = [];

        const alignToTransformX = { left: -300, center: 0, right: 300 } as const;

        for (const cue of cues) {
          const start = Math.max(0, cue.startMs + offset);
          const duration = Math.max(200, cue.endMs - cue.startMs);
          track.clips.push(
            createClip({
              id: uid('cap'),
              trackId: track.id,
              type: 'text',
              name: cue.text.slice(0, 40),
              color: clipColorFor('text'),
              startTimeMs: start,
              durationMs: duration,
              sourceDurationMs: duration,
              transform: { y: 380, x: cue.align ? alignToTransformX[cue.align] : 0 },
              textStyle: {
                ...options.style,
                text: cue.text,
                align: cue.align ?? options.style?.align ?? 'center',
              },
            })
          );
        }
        sortClips(track);
        s.selectedTrackId = track.id;
      });

      get().commit(`Import ${cues.length} captions`);
      return cues.length;
    },

    snapCutsToBeats: (trackId, toleranceMs = 400) => {
      let moved = 0;
      set((s) => {
        const beats = s.markers.filter((m) => m.kind === 'beat').map((m) => m.timeMs);
        if (beats.length === 0) return;

        const track = s.tracks.find((t) => t.id === trackId);
        if (!track) return;

        sortClips(track);

        /*
          Two shapes of timeline, and this used to handle only one.

          In a MONTAGE the clips butt together, so moving a cut means the
          clip before it gets longer and this one shorter — the shift has
          to be absorbed or a gap opens in the middle of the sequence.

          On a track with GAPS there is nothing to absorb: the clip is
          free-standing and should simply move. The old version absorbed
          unconditionally, which had two consequences. Free-standing clips
          were refused whenever the previous one would drop under 200ms —
          and because each absorption SHRANK that previous clip, one snap
          made the next one likelier to be refused. Four cuts laid off the
          beat, all within tolerance, snapped exactly one.

          Starting at i=1 was the other half of it: the first clip on a
          track has no predecessor to absorb into, so it was never snapped
          at all, even sitting alone 30ms off the beat.
        */
        for (let i = 0; i < track.clips.length; i++) {
          const clip = track.clips[i];
          const prev = i > 0 ? track.clips[i - 1] : null;
          const next = i + 1 < track.clips.length ? track.clips[i + 1] : null;

          // Find the nearest beat to this cut point.
          let nearest = beats[0];
          for (const b of beats) {
            if (Math.abs(b - clip.startTimeMs) < Math.abs(nearest - clip.startTimeMs)) nearest = b;
          }
          const delta = nearest - clip.startTimeMs;
          if (delta === 0 || Math.abs(delta) > toleranceMs) continue;
          if (nearest < 0) continue;

          const butted =
            prev !== null && Math.abs(prev.startTimeMs + prev.durationMs - clip.startTimeMs) <= 2;

          if (butted && prev) {
            // Absorb the shift so the sequence stays continuous.
            if (prev.durationMs + delta < 200) continue;
            if (clip.durationMs - delta < 200) continue;
            prev.durationMs += delta;
            prev.sourceDurationMs = prev.durationMs;
            clip.startTimeMs = nearest;
            clip.durationMs -= delta;
          } else {
            // Free-standing: move it, and keep its length.
            if (prev && nearest < prev.startTimeMs + prev.durationMs) continue;
            if (next && nearest + clip.durationMs > next.startTimeMs) continue;
            clip.startTimeMs = nearest;
          }
          moved++;
        }
      });
      if (moved > 0) get().commit('Snap cuts to beats');
      return moved;
    },

    /* ══ media pool ══ */

    /*
      Replace by id rather than always prepending.

      This unshifted unconditionally, and several assets carry a FIXED
      id: the starter's music bed is `starter:kerf-film-bed` and every
      seeded sample in `defaultMedia` is `media_*`. So opening the
      starter twice put two entries with the same id in the pool, and
      the media panel rendered two React children with the same key,
      which React logs as "may cause children to be duplicated and/or
      omitted, the behavior is unsupported". Five opens, five copies.

      `open_starter_project` is a TOOL, so an agent can call it in a
      loop without anybody clicking anything.

      Fixed in the STORE and not at the call sites, for the same reason
      the lock was: a rule enforced where the data changes holds for
      the UI, the tools and anything written later. A re-added asset
      keeps its position rather than jumping to the front, because
      re-importing a file you already have is not a new import.
    */
    addMediaAsset: (asset) =>
      set((s) => {
        const at = s.mediaPool.findIndex((a) => a.id === asset.id);
        if (at === -1) s.mediaPool.unshift(asset);
        else s.mediaPool[at] = asset;
      }),
    removeMediaAsset: (assetId) =>
      set((s) => { s.mediaPool = s.mediaPool.filter((a) => a.id !== assetId); }),
    setAssetPeaks: (assetId, peaks) =>
      set((s) => {
        const a = s.mediaPool.find((x) => x.id === assetId);
        if (a) a.peaks = peaks;
      }),

    /* ══ project io ══ */

    loadProject: (tracks, markers) => {
      const initial: HistoryEntry = {
        ...snapshot({ tracks, markers }),
        label: 'Load project',
        at: Date.now(),
      };
      set((s) => {
        s.tracks = tracks;
        s.markers = markers;
        s.selectedClipIds = [];
        s.playheadMs = 0;
        s.history = [initial];
        s.historyIndex = 0;
      });
    },
  }))
);

/* ═══════════════════════════════════════════════════════════════════
   Selector hooks — subscribe to the narrowest slice possible.
   Playback writes `playheadMs` 60×/s, so anything that does NOT show a
   timecode must stay off that subscription.
   ═══════════════════════════════════════════════════════════════════ */

export const usePlayheadMs = () => useTimelineStore((s) => s.playheadMs);
export const useIsPlaying = () => useTimelineStore((s) => s.isPlaying);
export const useTracks = () => useTimelineStore((s) => s.tracks);
export const useMarkers = () => useTimelineStore((s) => s.markers);
export const useMediaPool = () => useTimelineStore((s) => s.mediaPool);
export const useZoomLevel = () => useTimelineStore((s) => s.zoomLevel);
export const useSelectedClipIds = () => useTimelineStore(useShallow((s) => s.selectedClipIds));

export function findClipById(tracks: Track[], clipId: string | null | undefined): Clip | null {
  if (!clipId) return null;
  for (const track of tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return clip;
  }
  return null;
}

export function useClipById(clipId: string | null): Clip | null {
  return useTimelineStore((s) => findClipById(s.tracks, clipId));
}

/** The primary (first) selected clip — what the inspector edits. */
export function useSelectedClip(): Clip | null {
  return useTimelineStore((s) => findClipById(s.tracks, s.selectedClipIds[0] ?? null));
}

export function useSelectedClips(): Clip[] {
  return useTimelineStore(
    useShallow((s) => s.selectedClipIds.map((id) => findClipById(s.tracks, id)).filter((c): c is Clip => c !== null))
  );
}

export function useTrackById(trackId: string | null): Track | null {
  return useTimelineStore((s) => s.tracks.find((t) => t.id === trackId) ?? null);
}

/** Clips visible at a given time on non-audio tracks, bottom layer first. */
export function getVisibleClipsAt(tracks: Track[], timeMs: number): { track: Track; clip: Clip }[] {
  const out: { track: Track; clip: Clip }[] = [];
  const ordered = [...tracks].sort((a, b) => b.index - a.index);
  for (const track of ordered) {
    if (track.type === 'audio' || track.muted) continue;
    for (const clip of track.clips) {
      if (clip.hidden) continue;
      if (timeMs >= clip.startTimeMs && timeMs < clip.startTimeMs + clip.durationMs) {
        out.push({ track, clip });
      }
    }
  }
  return out;
}

/** Furthest clip end on the timeline — used to auto-grow project duration. */
export function getContentEndMs(tracks: Track[]): number {
  let end = 0;
  for (const track of tracks) {
    for (const clip of track.clips) {
      end = Math.max(end, clip.startTimeMs + clip.durationMs);
    }
  }
  return end;
}
