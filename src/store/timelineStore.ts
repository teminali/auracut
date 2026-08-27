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

export interface TimelineActions {
  /* transport */
  setPlayheadMs: (ms: number) => void;
  nudgePlayhead: (deltaMs: number) => void;
  setIsPlaying: (playing: boolean) => void;
  togglePlay: () => void;
  setPlaybackRate: (rate: number) => void;
  toggleLoop: () => void;
  setInPoint: (ms: number | null) => void;
  setOutPoint: (ms: number | null) => void;
  clearInOut: () => void;

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
  splitAtPlayhead: () => void;
  trimClip: (clipId: string, newStartMs?: number, newEndMs?: number, ripple?: boolean) => boolean;
  moveClip: (clipId: string, targetTrackId: string, newStartTimeMs: number) => boolean;
  moveClips: (moves: { clipId: string; trackId: string; startTimeMs: number }[]) => void;
  deleteClip: (clipId: string, ripple?: boolean) => boolean;
  deleteSelected: () => void;
  duplicateClip: (clipId: string) => void;
  insertClip: (trackId: string, asset: MediaAsset, startTimeMs: number) => string;
  insertClipObject: (clip: Clip) => void;
  closeGapsOnTrack: (trackId: string) => void;

  /* creative edits */
  freezeFrame: (clipId: string, atMs: number, holdMs?: number) => boolean;
  reverseClip: (clipId: string) => void;
  detachAudio: (clipId: string) => void;
  groupSelected: () => void;
  ungroupSelected: () => void;

  /* tracks */
  addTrack: (type: TrackType, name?: string) => string;
  removeTrack: (trackId: string) => void;
  renameTrack: (trackId: string, name: string) => void;
  reorderTrack: (trackId: string, direction: -1 | 1) => void;
  toggleTrackMute: (trackId: string) => void;
  toggleTrackSolo: (trackId: string) => void;
  toggleTrackLock: (trackId: string) => void;
  setTrackVolume: (trackId: string, volume: number) => void;
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
  renameClip: (clipId: string, name: string) => void;
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
  reorderEffect: (clipId: string, effectRef: string, direction: -1 | 1) => void;
  toggleEffect: (clipId: string, effectRef: string) => void;
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
    clipId: string, effectRef: string, param: string, timeOffsetMs: number, value: number
  ) => boolean;
  /** False when the clip, the effect or the keyframe could not be found. */
  removeEffectKeyframe: (clipId: string, effectRef: string, keyframeId: string) => boolean;
  clearEffects: (clipId: string) => void;
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
  removeTransition: (clipId: string, position: 'in' | 'out') => void;

  /* markers */
  addMarker: (timeMs: number, label?: string, kind?: MarkerKind, color?: string) => void;
  updateMarker: (markerId: string, patch: Partial<TimelineMarker>) => void;
  removeMarker: (markerId: string) => void;
  clearMarkers: (kind?: MarkerKind) => void;
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
  undo: () => void;
  redo: () => void;
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
      if (state.historyIndex <= 0) return;

      const index = state.historyIndex - 1;
      const restored = snapshot(state.history[index]);

      set((s) => {
        s.historyIndex = index;
        s.tracks = restored.tracks;
        s.markers = restored.markers;
        s.selectedClipIds = s.selectedClipIds.filter((id) => findClip(restored.tracks, id));
      });
    },

    redo: () => {
      const state = get();
      if (state.historyIndex >= state.history.length - 1) return;

      const index = state.historyIndex + 1;
      const restored = snapshot(state.history[index]);

      set((s) => {
        s.historyIndex = index;
        s.tracks = restored.tracks;
        s.markers = restored.markers;
        s.selectedClipIds = s.selectedClipIds.filter((id) => findClip(restored.tracks, id));
      });
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
    setInPoint: (ms) => set((s) => { s.inPointMs = ms; }),
    setOutPoint: (ms) => set((s) => { s.outPointMs = ms; }),
    clearInOut: () => set((s) => { s.inPointMs = null; s.outPointMs = null; }),

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
        // Keyframes rebase onto the new clip's own timeline.
        second.keyframes = clip.keyframes
          .filter((k) => k.timeOffsetMs >= firstDuration)
          .map((k) => ({ ...k, id: uid('kf'), timeOffsetMs: k.timeOffsetMs - firstDuration }));

        clip.durationMs = firstDuration;
        clip.sourceDurationMs = firstDuration;
        clip.transitionOut = undefined;
        clip.keyframes = clip.keyframes.filter((k) => k.timeOffsetMs < firstDuration);

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
      for (const id of targets) splitClip(id, playheadMs);
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
      return moved;
    },

    moveClips: (moves) =>
      set((s) => {
        for (const move of moves) {
          const found = findClip(s.tracks, move.clipId);
          if (!found) continue;
          const { track, clip, index } = found;
          if (clip.locked || track.locked) continue;

          const target = s.tracks.find((t) => t.id === move.trackId);
          if (!target || target.locked) continue;

          const moved = track.clips.splice(index, 1)[0];
          moved.trackId = move.trackId;
          moved.startTimeMs = Math.max(0, Math.round(move.startTimeMs));
          target.clips.push(moved);
        }
        for (const t of s.tracks) sortClips(t);
      }),

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
      const ids = get().selectedClipIds;
      if (ids.length === 0) return;
      set((s) => {
        const ripple = s.rippleEditMode;
        for (const id of ids) {
          const found = findClip(s.tracks, id);
          if (!found) continue;
          const { track, clip, index } = found;
          if (clip.locked || track.locked) continue;
          const gapStart = clip.startTimeMs;
          const gapSize = clip.durationMs;
          track.clips.splice(index, 1);
          if (ripple) rippleShift(track, gapStart, -gapSize);
        }
        s.selectedClipIds = [];
      });
      get().commit(ids.length > 1 ? `Delete ${ids.length} clips` : 'Delete clip');
    },

    duplicateClip: (clipId) => {
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        const { track, clip } = found;

        const copy = structuredClone(current(clip)) as Clip;
        copy.id = uid('clip');
        copy.startTimeMs = clip.startTimeMs + clip.durationMs;
        copy.keyframes = clip.keyframes.map((k) => ({ ...k, id: uid('kf') }));
        copy.groupId = undefined;

        track.clips.push(copy);
        sortClips(track);
        s.selectedClipIds = [copy.id];
      });
      get().commit('Duplicate clip');
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
      set((s) => {
        const track = s.tracks.find((t) => t.id === trackId);
        if (track) packTrack(track);
      });
      get().commit('Close gaps');
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
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        found.clip.speed.reversed = !found.clip.speed.reversed;
      });
      get().commit('Reverse clip');
    },

    detachAudio: (clipId) => {
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found || found.clip.type !== 'video') return;

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
        audioClip.id = uid('clip');
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
      });
      get().commit('Detach audio');
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

    removeTrack: (trackId) => {
      set((s) => {
        if (s.tracks.length <= 1) return;
        s.tracks = s.tracks.filter((t) => t.id !== trackId);
        s.tracks.forEach((t, i) => { t.index = i; });
        if (s.selectedTrackId === trackId) s.selectedTrackId = s.tracks[0]?.id ?? null;
      });
      get().commit('Remove track');
    },

    renameTrack: (trackId, name) => {
      set((s) => {
        const t = s.tracks.find((x) => x.id === trackId);
        if (t) t.name = name;
      });
      get().commit('Rename track');
    },

    reorderTrack: (trackId, direction) => {
      set((s) => {
        const idx = s.tracks.findIndex((t) => t.id === trackId);
        const target = idx + direction;
        if (idx === -1 || target < 0 || target >= s.tracks.length) return;
        const [moved] = s.tracks.splice(idx, 1);
        s.tracks.splice(target, 0, moved);
        s.tracks.forEach((t, i) => { t.index = i; });
      });
      get().commit('Reorder track');
    },

    toggleTrackMute: (trackId) =>
      set((s) => {
        const t = s.tracks.find((x) => x.id === trackId);
        if (t) t.muted = !t.muted;
      }),

    toggleTrackSolo: (trackId) =>
      set((s) => {
        const t = s.tracks.find((x) => x.id === trackId);
        if (t) t.solo = !t.solo;
      }),

    toggleTrackLock: (trackId) =>
      set((s) => {
        const t = s.tracks.find((x) => x.id === trackId);
        if (t) t.locked = !t.locked;
      }),

    setTrackVolume: (trackId, volume) =>
      set((s) => {
        const t = s.tracks.find((x) => x.id === trackId);
        if (t) t.volume = Math.max(0, Math.min(2, volume));
      }),

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
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (found) found.clip.name = name;
      });
      get().commit('Rename clip');
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
        if (!found) return;
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
        if (!found) return;
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
        if (!found) return;
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
        if (!found) return;
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
        if (!found) return;
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
        if (!found) return;
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
          split, a trim, a move, a delete and now a patch. This was the
          last edit path that wrote through a lock: `add_effect` reported
          success and really did apply the effect, so "locked" meant
          different things depending on which tool you reached for.

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
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        const list = found.clip.effects;
        const idx = list.findIndex((e) => e.id === effectRef || e.type === effectRef);
        const target = idx + direction;
        if (idx === -1 || target < 0 || target >= list.length) return;
        const [moved] = list.splice(idx, 1);
        list.splice(target, 0, moved);
      });
      get().commit('Reorder effects');
    },

    toggleEffect: (clipId, effectRef) => {
      set((s) => {
        const found = findClip(s.tracks, clipId);
        const fx = found?.clip.effects.find((e) => e.id === effectRef || e.type === effectRef);
        if (fx) fx.enabled = !fx.enabled;
      });
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

    addEffectKeyframe: (clipId, effectRef, param, timeOffsetMs, value) => {
      let placed = false;
      set((s) => {
        const found = findClip(s.tracks, clipId);
        const fx = found?.clip.effects.find((e) => e.id === effectRef || e.type === effectRef);
        if (!fx) return;
        placed = true;
        if (!fx.keyframes) fx.keyframes = [];

        const t = Math.max(0, Math.round(timeOffsetMs));
        const existing = fx.keyframes.find((k) => k.param === param && Math.abs(k.timeOffsetMs - t) < 34);
        if (existing) {
          existing.value = value;
        } else {
          fx.keyframes.push({ id: uid('efk'), param, timeOffsetMs: t, value, easing: 'easeInOut' });
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
        const fx = found?.clip.effects.find((e) => e.id === effectRef || e.type === effectRef);
        if (!fx?.keyframes) return;
        const before = fx.keyframes.length;
        fx.keyframes = fx.keyframes.filter((k) => k.id !== keyframeId);
        removed = fx.keyframes.length < before;
      });
      if (removed) get().commit('Remove effect keyframe');
      return removed;
    },

    clearEffects: (clipId) => {
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (found) found.clip.effects = [];
      });
      get().commit('Clear effects');
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
        if (!found) return;
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
        const pts = found?.clip.motionPath?.points;
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
        const pts = found?.clip.motionPath?.points;
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
      set((s) => {
        const found = findClip(s.tracks, clipId);
        if (!found) return;
        if (position === 'in') found.clip.transitionIn = undefined;
        else found.clip.transitionOut = undefined;
      });
      get().commit('Remove transition');
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

    updateMarker: (markerId, patch) =>
      set((s) => {
        const m = s.markers.find((x) => x.id === markerId);
        if (m) Object.assign(m, patch);
      }),

    removeMarker: (markerId) => {
      set((s) => { s.markers = s.markers.filter((m) => m.id !== markerId); });
      get().commit('Remove marker');
    },

    clearMarkers: (kind) => {
      set((s) => {
        s.markers = kind ? s.markers.filter((m) => m.kind !== kind) : [];
      });
      get().commit('Clear markers');
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

    addMediaAsset: (asset) => set((s) => { s.mediaPool.unshift(asset); }),
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
