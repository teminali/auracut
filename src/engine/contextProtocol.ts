/* ═══════════════════════════════════════════════════════════════════
   Context protocol.

   Every prompt runs the same three stages before it reaches an agent:

     1. CLASSIFY   — what family of edit is this?
     2. PREFLIGHT  — does the editor state satisfy that family's contract?
                     Blockers stop dispatch and offer a one-click remedy.
     3. ENVELOPE   — build the exact, unambiguous context: timecode, frame
                     number, the composited frame, every visible layer with
                     its bounds, and what the user's annotations point at.

   The point is to remove guesswork. The agent is never told "make this
   pop" without also being told which frame "this" is, which layer sits
   under the user's arrow, and where that layer's box is in project pixels.
   ═══════════════════════════════════════════════════════════════════ */

import { useTimelineStore, getVisibleClipsAt, getContentEndMs } from '../store/timelineStore';
import { useProjectStore } from '../store/projectStore';
import { Clip } from '../types/edl';
import {
  Annotation, AnnotationTarget, CapturedFrame, CommandKind, ContextEnvelope,
  ContextRequirement, PreflightReport, ReadinessIssue, VisibleLayer,
} from '../types/context';
import { getClipBox, getBoxAABB, hitTestBox, rotatePoint } from './geometry';
import { getNaturalSize } from './compositor';
import { captureFrame, labelAnchor } from './frameCapture';
import { formatTimecode } from '../utils/time';

/* ═══════════════════════════════════════════════════════════════════
   1. CLASSIFY
   ═══════════════════════════════════════════════════════════════════ */

interface Classifier {
  kind: CommandKind;
  patterns: RegExp[];
}

/* Order matters: the first match wins, so put specific families first. */
const CLASSIFIERS: Classifier[] = [
  { kind: 'query', patterns: [
    /^\s*(what|which|where|how many|how much|show me|list|tell me|describe|explain|why)\b/i,
    /\?\s*$/,
  ] },
  /* Explicit animation verbs win outright — otherwise "animate a fade in"
     is captured by the audio rule, which also owns the words "fade in". */
  { kind: 'motion', patterns: [/\b(animate|animating|animations?|keyframes?|ken ?burns)\b/i] },
  { kind: 'captions', patterns: [/\b(captions?|subtitles?|transcri|srt|vtt|maneno)\w*/i] },
  { kind: 'audio', patterns: [/\b(audio|volume|loud|quiet|mute|beats?|bpm|tempo|music|silence|pauses?|fade (in|out)|duck(ing)?|mix)\b/i] },
  { kind: 'speed', patterns: [/\b(speed|slow ?mo|slow it|fast ?forward|time ?ramp|bullet ?time|reverse|\d+(\.\d+)?\s*x)\b/i] },
  { kind: 'transition', patterns: [/\b(transitions?|cross ?fade|dissolve|whip ?pan|wipes?|dip to)\b/i] },
  { kind: 'cut_trim', patterns: [/\b(cuts?|split|trim|razor|shorten|lengthen|delete|remove (this|that|the) clip|freeze)\b/i] },
  { kind: 'add_effect', patterns: [/\b(effects?|vfx|glow|grain|glitch|particles?|snow|embers?|bokeh|light ?leaks?|flares?|god ?rays?|shake|blur|vignette|vhs|scanlines?|halftone|pixelate|duotone|letterbox|outline|shadow)\b/i] },
  { kind: 'color_grade', patterns: [/\b(colou?r|grade|grading|saturat|contrast|bright|dark|expos|warm|cool|temperature|tint|lut|cinematic|filmic|teal|orange|look)\b/i] },
  { kind: 'motion', patterns: [/\b(animate|animations?|keyframes?|ken ?burns|fade in|fade out|slide in|pop in|spin|float|drift|motion|pan across|zoom (in|out) on|move .* from .* to)\b/i] },
  { kind: 'text', patterns: [/\b(text|title|caption card|headline|lower ?third|font|word|type|says?|label|write)\b/i] },
  { kind: 'shape', patterns: [/\b(shapes?|rectangles?|circles?|ellipses?|squares?|stars?|triangles?|arrows?|lines?|box|highlight)\b/i] },
  { kind: 'layout_transform', patterns: [/\b(move|position|place|centre|center|align|resize|scale|bigger|smaller|rotate|flip|crop|mask|corner|left|right|top|bottom|this|that|here|there)\b/i] },
  { kind: 'export', patterns: [/\b(export|render|save (the )?(video|file)|publish)\b/i] },
  { kind: 'project_setting', patterns: [/\b(aspect|9:16|16:9|1:1|vertical|square|tiktok|reel|shorts|canvas|resolution|fps|frame ?rate|background)\b/i] },
];

export function classifyCommand(prompt: string): CommandKind {
  for (const c of CLASSIFIERS) {
    if (c.patterns.some((p) => p.test(prompt))) return c.kind;
  }
  return 'unknown';
}

/* ═══════════════════════════════════════════════════════════════════
   2. THE CONTRACT
   ═══════════════════════════════════════════════════════════════════ */

const CONTRACTS: Record<CommandKind, ContextRequirement> = {
  color_grade: {
    kind: 'color_grade', label: 'Colour & grading',
    requiresPaused: true, requiresTarget: true, requiresPlayheadOnTarget: true,
    requiresFrame: true, requiresAudio: false,
    rationale: 'Grading is judged by eye, so I need the exact frame you are looking at and the layer it belongs to.',
  },
  add_effect: {
    kind: 'add_effect', label: 'Visual effects',
    requiresPaused: true, requiresTarget: true, requiresPlayheadOnTarget: true,
    requiresFrame: true, requiresAudio: false,
    rationale: 'Effects attach to one layer. Pausing on the shot tells me which layer and how it currently looks.',
  },
  motion: {
    kind: 'motion', label: 'Animation & keyframes',
    requiresPaused: true, requiresTarget: true, requiresPlayheadOnTarget: true,
    requiresFrame: false, requiresAudio: false,
    rationale: 'Keyframes are written relative to the clip start, so the playhead must sit inside the clip being animated.',
  },
  layout_transform: {
    kind: 'layout_transform', label: 'Position, size & framing',
    requiresPaused: true, requiresTarget: true, requiresPlayheadOnTarget: true,
    requiresFrame: true, requiresAudio: false,
    rationale: 'Words like "here", "this" and "a bit left" only mean something against a specific frame.',
  },
  cut_trim: {
    kind: 'cut_trim', label: 'Cutting & trimming',
    requiresPaused: true, requiresTarget: false, requiresPlayheadOnTarget: false,
    requiresFrame: false, requiresAudio: false,
    rationale: 'Cuts land on the playhead, so it must be parked exactly where you want the edit.',
  },
  transition: {
    kind: 'transition', label: 'Transitions',
    requiresPaused: true, requiresTarget: true, requiresPlayheadOnTarget: false,
    requiresFrame: false, requiresAudio: false,
    rationale: 'A transition sits on a seam between two clips — I need to know which clip you mean.',
  },
  speed: {
    kind: 'speed', label: 'Speed & time',
    requiresPaused: true, requiresTarget: true, requiresPlayheadOnTarget: false,
    requiresFrame: false, requiresAudio: false,
    rationale: 'Retiming rewrites one clip’s duration, so the target has to be unambiguous.',
  },
  audio: {
    kind: 'audio', label: 'Audio',
    requiresPaused: false, requiresTarget: false, requiresPlayheadOnTarget: false,
    requiresFrame: false, requiresAudio: true,
    rationale: 'I need an audio clip on the timeline to analyse or adjust.',
  },
  captions: {
    kind: 'captions', label: 'Captions',
    requiresPaused: false, requiresTarget: false, requiresPlayheadOnTarget: false,
    requiresFrame: false, requiresAudio: true,
    rationale: 'Captions come from the dialogue, so there has to be audio to read.',
  },
  text: {
    kind: 'text', label: 'Text & titles',
    requiresPaused: true, requiresTarget: false, requiresPlayheadOnTarget: false,
    requiresFrame: true, requiresAudio: false,
    rationale: 'New text is placed at the playhead, and the frame tells me where there is room for it.',
  },
  shape: {
    kind: 'shape', label: 'Shapes & graphics',
    requiresPaused: true, requiresTarget: false, requiresPlayheadOnTarget: false,
    requiresFrame: true, requiresAudio: false,
    rationale: 'Shapes are placed against the picture, so I need to see the frame.',
  },
  export: {
    kind: 'export', label: 'Export',
    requiresPaused: false, requiresTarget: false, requiresPlayheadOnTarget: false,
    requiresFrame: false, requiresAudio: false,
    rationale: 'Export works on the whole sequence — no frame context needed.',
  },
  project_setting: {
    kind: 'project_setting', label: 'Canvas & project',
    requiresPaused: false, requiresTarget: false, requiresPlayheadOnTarget: false,
    requiresFrame: false, requiresAudio: false,
    rationale: 'Project settings apply globally.',
  },
  query: {
    kind: 'query', label: 'Question',
    requiresPaused: false, requiresTarget: false, requiresPlayheadOnTarget: false,
    requiresFrame: false, requiresAudio: false,
    rationale: 'I will read the timeline and answer without changing anything.',
  },
  unknown: {
    kind: 'unknown', label: 'General edit',
    /*
      An unclassified prompt must never be BLOCKED. "hello", "what can you
      do?", or any phrasing the classifiers miss would otherwise demand an
      attached frame before the send button would light up — a dead end
      with no way out. Not recognising a request is our uncertainty, not
      the user's problem: send it, and attach whatever context is free.
    */
    requiresPaused: false, requiresTarget: false, requiresPlayheadOnTarget: false,
    requiresFrame: false, requiresAudio: false,
    rationale: 'I could not tell exactly what this touches, so I will send it with whatever context is already to hand.',
  },
};

export function getContract(kind: CommandKind): ContextRequirement {
  return CONTRACTS[kind];
}

/* ═══════════════════════════════════════════════════════════════════
   Target resolution
   ═══════════════════════════════════════════════════════════════════ */

export interface ResolvedTarget {
  clipId: string;
  name: string;
  type: Clip['type'];
  reason: 'annotation' | 'selection' | 'topmost-visible' | 'only-visible' | 'none';
}

/**
 * Decide which layer a command means, in priority order:
 *   what the user drew on  →  what is selected  →  what is on screen.
 */
export function resolveTarget(annotations: Annotation[]): ResolvedTarget | null {
  const state = useTimelineStore.getState();

  // 1. An annotation is the strongest possible signal.
  for (const a of annotations) {
    if (a.targets.length > 0) {
      const t = a.targets[0];
      return { clipId: t.clipId, name: t.clipName, type: t.clipType, reason: 'annotation' };
    }
  }

  // 2. An explicit selection.
  const selectedId = state.selectedClipIds[0];
  if (selectedId) {
    for (const track of state.tracks) {
      const clip = track.clips.find((c) => c.id === selectedId);
      if (clip) return { clipId: clip.id, name: clip.name, type: clip.type, reason: 'selection' };
    }
  }

  // 3. Whatever is on screen right now.
  const visible = getVisibleClipsAt(state.tracks, state.playheadMs).filter(
    ({ clip }) => clip.type !== 'audio'
  );
  if (visible.length === 1) {
    const clip = visible[0].clip;
    return { clipId: clip.id, name: clip.name, type: clip.type, reason: 'only-visible' };
  }
  if (visible.length > 1) {
    const clip = visible[visible.length - 1].clip; // topmost
    return { clipId: clip.id, name: clip.name, type: clip.type, reason: 'topmost-visible' };
  }

  return null;
}

/* ═══════════════════════════════════════════════════════════════════
   3. PREFLIGHT
   ═══════════════════════════════════════════════════════════════════ */

export interface PreflightInput {
  prompt: string;
  annotations: Annotation[];
  frame: CapturedFrame | null;
  /** Whether the user has chosen to attach the frame. */
  frameAttached: boolean;
  onAttachFrame: () => void;
}

export function runPreflight(input: PreflightInput): PreflightReport {
  const kind = classifyCommand(input.prompt);
  const requirement = CONTRACTS[kind];

  const timeline = useTimelineStore.getState();
  const project = useProjectStore.getState().project;

  const issues: ReadinessIssue[] = [];
  const satisfied: string[] = [];

  const target = resolveTarget(input.annotations);
  const visible = getVisibleClipsAt(timeline.tracks, timeline.playheadMs)
    .filter(({ clip }) => clip.type !== 'audio');

  /* ── Playback must be stopped ── */
  if (requirement.requiresPaused) {
    if (timeline.isPlaying) {
      issues.push({
        id: 'playing',
        severity: 'blocker',
        title: 'Pause on the scene you want changed',
        detail:
          'Playback is running, so "this shot" keeps moving. Scrub to the exact moment you want edited and pause — I will read that frame.',
        fixLabel: 'Pause here',
        fix: () => useTimelineStore.getState().setIsPlaying(false),
      });
    } else {
      satisfied.push(`Paused at ${formatTimecode(timeline.playheadMs, project.fps)}`);
    }
  }

  /* ── Something must actually be on screen ── */
  const contentEnd = getContentEndMs(timeline.tracks);
  if (requirement.requiresFrame || requirement.requiresTarget) {
    if (visible.length === 0) {
      issues.push({
        id: 'empty-frame',
        severity: 'blocker',
        title: 'Nothing is visible at the playhead',
        detail:
          timeline.playheadMs > contentEnd
            ? `The playhead sits past the end of the edit (${formatTimecode(contentEnd, project.fps)}). Move it back onto the footage.`
            : 'Move the playhead onto a shot so I can see what you are describing.',
        fixLabel: 'Jump to the first shot',
        fix: () => {
          const first = firstVisualClip();
          if (first) useTimelineStore.getState().setPlayheadMs(first.startTimeMs + Math.min(500, first.durationMs / 2));
        },
      });
    }
  }

  /* ── A target layer must be identifiable ── */
  if (requirement.requiresTarget) {
    if (!target) {
      if (visible.length > 0) {
        issues.push({
          id: 'no-target',
          severity: 'blocker',
          title: 'Tell me which layer to change',
          detail: `There are ${visible.length} layers on this frame. Select one, or circle it on the frame.`,
          fixLabel: 'Use the top layer',
          fix: () => {
            const topmost = visible[visible.length - 1];
            useTimelineStore.getState().selectClip(topmost.clip.id);
          },
        });
      }
    } else if (target.reason === 'topmost-visible' && visible.length > 1) {
      // Not a blocker, but say out loud what we assumed.
      issues.push({
        id: 'assumed-target',
        severity: 'advisory',
        title: `Assuming you mean "${target.name}"`,
        detail: `It is the top layer of ${visible.length} on this frame. Select a different clip or annotate the frame to override.`,
      });
      satisfied.push(`Target: ${target.name}`);
    } else {
      const how =
        target.reason === 'annotation' ? 'from your annotation'
        : target.reason === 'selection' ? 'selected'
        : 'the only layer on screen';
      satisfied.push(`Target: ${target.name} (${how})`);
    }
  }

  /* ── The playhead must sit inside the target ── */
  if (requirement.requiresPlayheadOnTarget && target) {
    const clip = findClip(target.clipId);
    if (clip) {
      const inside =
        timeline.playheadMs >= clip.startTimeMs &&
        timeline.playheadMs < clip.startTimeMs + clip.durationMs;

      if (!inside) {
        issues.push({
          id: 'playhead-off-target',
          severity: 'blocker',
          title: `The playhead is not on "${clip.name}"`,
          detail: `That clip runs ${formatTimecode(clip.startTimeMs, project.fps)} → ${formatTimecode(clip.startTimeMs + clip.durationMs, project.fps)}. Park the playhead inside it so I can see what I am changing.`,
          fixLabel: 'Move playhead onto it',
          fix: () => useTimelineStore.getState().setPlayheadMs(clip.startTimeMs + clip.durationMs / 2),
        });
      } else {
        satisfied.push(`Playhead ${Math.round(timeline.playheadMs - clip.startTimeMs)}ms into the clip`);
      }
    }
  }

  /* ── A frame should be attached for visual work ── */
  if (requirement.requiresFrame) {
    if (input.frame?.unavailableReason) {
      issues.push({
        id: 'frame-unavailable',
        severity: 'advisory',
        title: 'The frame could not be captured',
        detail: input.frame.unavailableReason,
      });
    } else if (!input.frameAttached) {
      issues.push({
        id: 'no-frame',
        severity: 'blocker',
        title: 'Share the frame you are looking at',
        detail:
          'This is a visual change. Attaching the frame lets me see exactly what you see — and you can draw on it to point at things.',
        fixLabel: 'Attach this frame',
        fix: input.onAttachFrame,
      });
    } else {
      satisfied.push(
        input.annotations.length > 0
          ? `Frame attached with ${input.annotations.length} annotation${input.annotations.length === 1 ? '' : 's'}`
          : 'Frame attached'
      );
    }
  }

  /* ── Audio work needs audio ── */
  if (requirement.requiresAudio) {
    const audioClip = timeline.tracks
      .filter((t) => t.type === 'audio')
      .flatMap((t) => t.clips)
      .find((c) => c.mediaUrl);

    if (!audioClip) {
      issues.push({
        id: 'no-audio',
        severity: 'blocker',
        title: 'There is no audio to work with',
        detail: 'Drop a music or dialogue clip onto an audio track first, then ask me again.',
      });
    } else {
      satisfied.push(`Audio: ${audioClip.name}`);
    }
  }

  /* ── Locked targets ── */
  if (target) {
    const clip = findClip(target.clipId);
    if (clip?.locked) {
      issues.push({
        id: 'locked',
        severity: 'blocker',
        title: `"${clip.name}" is locked`,
        detail: 'Locked layers ignore every edit. Unlock it and I will continue.',
        fixLabel: 'Unlock it',
        fix: () => useTimelineStore.getState().toggleClipLock(clip.id),
      });
    }
  }

  return {
    kind,
    requirement,
    issues,
    ready: !issues.some((i) => i.severity === 'blocker'),
    satisfied,
  };
}

function findClip(clipId: string): Clip | null {
  for (const track of useTimelineStore.getState().tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return clip;
  }
  return null;
}

function firstVisualClip(): Clip | null {
  const tracks = [...useTimelineStore.getState().tracks].sort((a, b) => b.index - a.index);
  for (const track of tracks) {
    if (track.type === 'audio') continue;
    const sorted = [...track.clips].sort((a, b) => a.startTimeMs - b.startTimeMs);
    if (sorted[0]) return sorted[0];
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════════
   Annotation hit-testing
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Work out which layers an annotation is pointing at, and where within
 * each one. This is what turns "fix this" into "set clip_x scale to 0.8".
 */
export function resolveAnnotationTargets(annotation: Annotation): AnnotationTarget[] {
  const timeline = useTimelineStore.getState();
  const project = useProjectStore.getState().project;

  const anchor = annotationAnchorPoint(annotation);
  if (!anchor) return [];

  const targets: AnnotationTarget[] = [];
  const visible = getVisibleClipsAt(timeline.tracks, timeline.playheadMs);

  // Walk topmost-first so the frontmost layer is reported first.
  for (let i = visible.length - 1; i >= 0; i--) {
    const { clip, track } = visible[i];
    if (clip.type === 'audio') continue;

    const box = getClipBox(clip, project, timeline.playheadMs, getNaturalSize(clip));
    if (!hitTestBox(anchor, box)) continue;

    // Express the hit in the layer's own space so "top-left of the logo" works.
    const local = rotatePoint(anchor, { x: box.cx, y: box.cy }, -box.rotation);
    targets.push({
      clipId: clip.id,
      clipName: clip.name,
      clipType: clip.type,
      trackName: track.name,
      localX: Number(clampUnit((local.x - (box.cx - box.width / 2)) / box.width).toFixed(3)),
      localY: Number(clampUnit((local.y - (box.cy - box.height / 2)) / box.height).toFixed(3)),
    });
  }

  return targets;
}

const clampUnit = (v: number) => Math.max(0, Math.min(1, v));

/** The single point that best represents where an annotation is aimed. */
function annotationAnchorPoint(a: Annotation): { x: number; y: number } | null {
  if (a.points.length === 0) return null;

  switch (a.kind) {
    case 'arrow':
      return a.points[1] ?? a.points[0]; // the tip
    case 'rect':
    case 'ellipse': {
      const [p1, p2] = a.points;
      if (!p2) return p1;
      return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    }
    case 'freehand': {
      // Centroid of the stroke.
      const sum = a.points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
      return { x: sum.x / a.points.length, y: sum.y / a.points.length };
    }
    default:
      return a.points[0];
  }
}

/* ═══════════════════════════════════════════════════════════════════
   4. ENVELOPE
   ═══════════════════════════════════════════════════════════════════ */

export interface EnvelopeOptions {
  annotations: Annotation[];
  frame: CapturedFrame | null;
  includeFrame: boolean;
}

export function buildEnvelope(options: EnvelopeOptions): ContextEnvelope {
  const timeline = useTimelineStore.getState();
  const project = useProjectStore.getState().project;
  const playheadMs = timeline.playheadMs;

  const visible = getVisibleClipsAt(timeline.tracks, playheadMs);

  const visibleLayers: VisibleLayer[] = visible
    .filter(({ clip }) => clip.type !== 'audio')
    .map(({ clip, track }, depth) => {
      const box = getClipBox(clip, project, playheadMs, getNaturalSize(clip));
      const rect = getBoxAABB(box);
      return {
        clipId: clip.id,
        name: clip.name,
        type: clip.type,
        trackId: track.id,
        trackName: track.name,
        depth,
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        rotation: Math.round(box.rotation * 10) / 10,
        opacity: Math.round(box.opacity * 100) / 100,
        clipOffsetMs: Math.round(playheadMs - clip.startTimeMs),
        clipStartMs: clip.startTimeMs,
        clipEndMs: clip.startTimeMs + clip.durationMs,
        effects: clip.effects.filter((e) => e.enabled).map((e) => e.type),
        hasKeyframes: clip.keyframes.length > 0,
        text: clip.textStyle?.text,
      };
    });

  const underPlayhead = timeline.tracks
    .map((track) => {
      const clip = track.clips.find(
        (c) => playheadMs >= c.startTimeMs && playheadMs < c.startTimeMs + c.durationMs
      );
      return clip
        ? { trackId: track.id, trackName: track.name, clipId: clip.id, clipName: clip.name }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const target = resolveTarget(options.annotations);

  const markersNearby = timeline.markers
    .map((m) => ({ timeMs: m.timeMs, label: m.label, kind: m.kind, deltaMs: m.timeMs - playheadMs }))
    .filter((m) => Math.abs(m.deltaMs) <= 3000)
    .sort((a, b) => Math.abs(a.deltaMs) - Math.abs(b.deltaMs))
    .slice(0, 6);

  return {
    capturedAt: Date.now(),

    project: {
      name: project.name,
      width: project.width,
      height: project.height,
      fps: project.fps,
      aspectRatio: project.aspectRatio,
      durationMs: project.durationMs,
    },

    playhead: {
      ms: Math.round(playheadMs),
      timecode: formatTimecode(playheadMs, project.fps),
      frameNumber: Math.round((playheadMs / 1000) * project.fps),
      isPlaying: timeline.isPlaying,
      progress: project.durationMs > 0 ? Math.round((playheadMs / project.durationMs) * 1000) / 1000 : 0,
    },

    primaryTarget: target,
    selection: timeline.selectedClipIds
      .map((id) => {
        const clip = findClip(id);
        return clip ? { clipId: clip.id, name: clip.name } : null;
      })
      .filter((x): x is { clipId: string; name: string } => x !== null),

    visibleLayers,
    underPlayhead,

    frame: options.includeFrame ? options.frame : null,
    annotations: options.annotations,

    markersNearby,
    recentEdits: timeline.history
      .slice(Math.max(0, timeline.historyIndex - 4), timeline.historyIndex + 1)
      .map((h) => h.label)
      .reverse(),

    mediaPool: timeline.mediaPool.map((a) => ({
      id: a.id, name: a.name, type: a.type, durationMs: a.durationMs,
    })),
  };
}

/** Capture the frame at the current playhead. */
export function captureCurrentFrame(): CapturedFrame {
  const timeline = useTimelineStore.getState();
  const project = useProjectStore.getState().project;
  return captureFrame(timeline.tracks, project, timeline.playheadMs);
}

/* ═══════════════════════════════════════════════════════════════════
   5. SERIALISATION — what the model actually reads
   ═══════════════════════════════════════════════════════════════════ */

export function serializeEnvelope(env: ContextEnvelope, kind: CommandKind): string {
  const lines: string[] = [];

  lines.push('╭─ EDITOR CONTEXT ─────────────────────────────────────────');
  lines.push(`│ Command family : ${kind}`);
  lines.push(`│ Project        : ${env.project.name} · ${env.project.width}×${env.project.height} (${env.project.aspectRatio}) @ ${env.project.fps}fps`);
  lines.push(`│ Sequence length: ${(env.project.durationMs / 1000).toFixed(2)}s`);
  lines.push('├─ PLAYHEAD ───────────────────────────────────────────────');
  lines.push(`│ Timecode : ${env.playhead.timecode}  (${env.playhead.ms}ms, frame ${env.playhead.frameNumber})`);
  lines.push(`│ Transport: ${env.playhead.isPlaying ? 'PLAYING' : 'paused'} · ${Math.round(env.playhead.progress * 100)}% through the sequence`);

  if (env.primaryTarget) {
    lines.push('├─ PRIMARY TARGET ─────────────────────────────────────────');
    lines.push(`│ ${env.primaryTarget.clipId}  "${env.primaryTarget.name}"  (${env.primaryTarget.type})`);
    lines.push(`│ Chosen because: ${describeReason(env.primaryTarget.reason)}`);
    lines.push('│ When a tool omits clipId, it acts on THIS clip.');
  } else {
    lines.push('├─ PRIMARY TARGET ─────────────────────────────────────────');
    lines.push('│ (none resolved — ask, or name a clip id explicitly)');
  }

  lines.push('├─ ON SCREEN AT THE PLAYHEAD ──────────────────────────────');
  if (env.visibleLayers.length === 0) {
    lines.push('│ (nothing visible)');
  } else {
    // Frontmost first — that is the order a human reads the picture in.
    for (const layer of [...env.visibleLayers].reverse()) {
      const b = layer.bounds;
      lines.push(
        `│ ${layer.clipId}  "${layer.name}" (${layer.type}) on ${layer.trackName}`
      );
      lines.push(
        `│    bounds ${b.x},${b.y} ${b.width}×${b.height}px · rot ${layer.rotation}° · opacity ${layer.opacity}` +
        `${layer.effects.length ? ` · fx[${layer.effects.join(',')}]` : ''}${layer.hasKeyframes ? ' · animated' : ''}`
      );
      lines.push(
        `│    clip spans ${layer.clipStartMs}–${layer.clipEndMs}ms · playhead is ${layer.clipOffsetMs}ms into it`
      );
      if (layer.text) lines.push(`│    text: "${layer.text.replace(/\n/g, ' / ')}"`);
    }
  }

  if (env.annotations.length > 0) {
    lines.push('├─ USER ANNOTATIONS ON THE FRAME ──────────────────────────');
    lines.push('│ The user drew these ON the shared frame. Numbers match the badges.');
    env.annotations.forEach((a, i) => {
      const anchor = labelAnchor(a);
      const where = anchor ? `at ${Math.round(anchor.x)},${Math.round(anchor.y)}px` : '';
      lines.push(`│ [${i + 1}] ${a.kind}${a.text ? ` — "${a.text}"` : ''} ${where}`);
      if (a.targets.length === 0) {
        lines.push('│      points at: (empty canvas area)');
      } else {
        for (const t of a.targets) {
          const h = t.localX < 0.33 ? 'left' : t.localX > 0.66 ? 'right' : 'centre';
          const v = t.localY < 0.33 ? 'top' : t.localY > 0.66 ? 'bottom' : 'middle';
          lines.push(`│      points at: ${t.clipId} "${t.clipName}" — ${v}-${h} of that layer`);
        }
      }
    });
  }

  if (env.underPlayhead.length > 0) {
    lines.push('├─ EVERY TRACK AT THIS MOMENT ─────────────────────────────');
    for (const u of env.underPlayhead) {
      lines.push(`│ ${u.trackName}: ${u.clipId} "${u.clipName}"`);
    }
  }

  if (env.markersNearby.length > 0) {
    lines.push('├─ MARKERS NEARBY ─────────────────────────────────────────');
    for (const m of env.markersNearby) {
      const rel = m.deltaMs === 0 ? 'on the playhead' : `${m.deltaMs > 0 ? '+' : ''}${m.deltaMs}ms`;
      lines.push(`│ ${m.kind}${m.label ? ` "${m.label}"` : ''} ${rel}`);
    }
  }

  if (env.recentEdits.length > 0) {
    lines.push('├─ RECENT EDITS (newest first) ────────────────────────────');
    lines.push(`│ ${env.recentEdits.join(' ← ')}`);
  }

  lines.push('├─ MEDIA POOL ─────────────────────────────────────────────');
  lines.push(`│ ${env.mediaPool.map((m) => `${m.id}("${m.name}")`).join(', ') || '(empty)'}`);

  if (env.frame) {
    lines.push('├─ FRAME ──────────────────────────────────────────────────');
    lines.push(
      env.frame.unavailableReason
        ? `│ Not attached: ${env.frame.unavailableReason}`
        : `│ Attached: ${env.frame.width}×${env.frame.height} ${describeImageFormat(env.frame.dataUrl)} of ${env.frame.timecode} (frame ${env.frame.frameNumber}).`
    );
    lines.push(
      `│ Frame is ${(env.project.width / Math.max(1, env.frame.width)).toFixed(2)}× smaller than the project;` +
      ' multiply frame pixels by that to get project coords.'
    );
  }

  lines.push('╰──────────────────────────────────────────────────────────');

  return lines.join('\n');
}

function describeImageFormat(dataUrl: string): string {
  const match = /^data:image\/([a-z]+)/.exec(dataUrl);
  return match ? match[1].toUpperCase() : 'image';
}

function describeReason(reason: ResolvedTarget['reason']): string {
  switch (reason) {
    case 'annotation': return 'the user drew on it';
    case 'selection': return 'it is selected in the editor';
    case 'only-visible': return 'it is the only layer on screen';
    case 'topmost-visible': return 'it is the frontmost layer on screen';
    default: return 'no signal';
  }
}

/** A one-line summary for the chat transcript. */
export function summariseEnvelope(env: ContextEnvelope): string {
  const bits = [`${env.playhead.timecode} · frame ${env.playhead.frameNumber}`];
  if (env.primaryTarget) bits.push(env.primaryTarget.name);
  if (env.annotations.length > 0) bits.push(`${env.annotations.length} annotation${env.annotations.length === 1 ? '' : 's'}`);
  if (env.frame && !env.frame.unavailableReason) bits.push('frame attached');
  return bits.join(' · ');
}
