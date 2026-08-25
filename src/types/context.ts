/* ═══════════════════════════════════════════════════════════════════
   Copilot context model.

   The agent never guesses where "here" is. Every prompt travels with a
   ContextEnvelope: the exact frame, the exact timecode, what is under the
   playhead, what the user drew on the frame, and what each annotation is
   pointing at. This file is the shared vocabulary for that.
   ═══════════════════════════════════════════════════════════════════ */

import { Clip, ProjectSettings } from './edl';

/* ── Annotations the user draws on the shared frame ─────────────── */

export type AnnotationKind = 'arrow' | 'rect' | 'ellipse' | 'freehand' | 'text' | 'point';

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  /** Points in CANVAS coordinates (0,0 = top-left of the project frame). */
  points: { x: number; y: number }[];
  color: string;
  strokeWidth: number;
  /** Label for `text`, or an optional caption on any other shape. */
  text?: string;
  /** Layers this annotation lands on, resolved by hit-testing the frame. */
  targets: AnnotationTarget[];
}

export interface AnnotationTarget {
  clipId: string;
  clipName: string;
  clipType: Clip['type'];
  trackName: string;
  /** Where the annotation sits inside that layer, 0..1 — "upper-left of the logo". */
  localX: number;
  localY: number;
}

/* ── The captured frame ─────────────────────────────────────────── */

export interface CapturedFrame {
  /** PNG data URL of the composited frame, downscaled for transport. */
  dataUrl: string;
  width: number;
  height: number;
  /** Timeline position this frame was rendered at. */
  atMs: number;
  timecode: string;
  frameNumber: number;
  /** Set when the canvas could not be read (cross-origin media). */
  unavailableReason?: string;
}

/* ── What is on screen at the playhead ──────────────────────────── */

export interface VisibleLayer {
  clipId: string;
  name: string;
  type: Clip['type'];
  trackId: string;
  trackName: string;
  /** Stacking order — 0 is the backmost layer. */
  depth: number;
  /** On-canvas bounds in project pixels. */
  bounds: { x: number; y: number; width: number; height: number };
  rotation: number;
  opacity: number;
  /** How far into this clip the playhead sits. */
  clipOffsetMs: number;
  clipStartMs: number;
  clipEndMs: number;
  effects: string[];
  hasKeyframes: boolean;
  text?: string;
}

/* ── The envelope ───────────────────────────────────────────────── */

export interface ContextEnvelope {
  capturedAt: number;

  project: {
    name: string;
    width: number;
    height: number;
    fps: number;
    aspectRatio: string;
    durationMs: number;
  };

  playhead: {
    ms: number;
    timecode: string;
    frameNumber: number;
    isPlaying: boolean;
    /** Where the playhead sits relative to the sequence, 0..1. */
    progress: number;
  };

  /** The layer the command should act on, and why we believe that. */
  primaryTarget: {
    clipId: string;
    name: string;
    type: Clip['type'];
    reason: 'annotation' | 'selection' | 'topmost-visible' | 'only-visible' | 'none';
  } | null;

  selection: { clipId: string; name: string }[];
  visibleLayers: VisibleLayer[];

  /** Clip under the playhead on each track, including audio. */
  underPlayhead: { trackId: string; trackName: string; clipId: string; clipName: string }[];

  frame: CapturedFrame | null;
  annotations: Annotation[];

  markersNearby: { timeMs: number; label: string; kind: string; deltaMs: number }[];
  recentEdits: string[];
  mediaPool: { id: string; name: string; type: string; durationMs: number }[];
}

/* ── Command classification & the protocol contract ─────────────── */

export type CommandKind =
  | 'color_grade'
  | 'add_effect'
  | 'motion'
  | 'text'
  | 'shape'
  | 'cut_trim'
  | 'transition'
  | 'speed'
  | 'audio'
  | 'captions'
  | 'layout_transform'
  | 'export'
  | 'project_setting'
  | 'query'
  | 'unknown';

/** What a command family needs before it is safe to run. */
export interface ContextRequirement {
  kind: CommandKind;
  label: string;
  /** Playback must be stopped so "this frame" is unambiguous. */
  requiresPaused: boolean;
  /** A specific layer must be identified. */
  requiresTarget: boolean;
  /** The playhead must sit inside the target clip. */
  requiresPlayheadOnTarget: boolean;
  /** The frame image genuinely helps the agent — visual commands. */
  requiresFrame: boolean;
  /** Needs an audio track carrying media. */
  requiresAudio: boolean;
  /** Human explanation shown in the pre-flight card. */
  rationale: string;
}

export type IssueSeverity = 'blocker' | 'advisory';

export interface ReadinessIssue {
  id: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
  /** Label for the one-click remedy, when one exists. */
  fixLabel?: string;
  fix?: () => void;
}

export interface PreflightReport {
  kind: CommandKind;
  requirement: ContextRequirement;
  issues: ReadinessIssue[];
  /** True when nothing blocks dispatch. */
  ready: boolean;
  /** Checks that already pass, for the reassuring green ticks. */
  satisfied: string[];
}
