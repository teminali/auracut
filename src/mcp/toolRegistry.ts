/* ═══════════════════════════════════════════════════════════════════
   MCP tool surface.

   Design principle: a SMALL number of GENERIC tools beats a large number
   of narrow ones. The agent discovers what exists (`describe_timeline`,
   `list_properties`, `list_effects`) and then edits anything through
   `patch_clip` / `set_effect_param`, validated by the property schema.

   Every tool declares a Zod schema, so bad arguments produce an actionable
   message instead of a silent no-op.
   ═══════════════════════════════════════════════════════════════════ */

import { z } from 'zod';
import { useTimelineStore, findClipById, getContentEndMs } from '../store/timelineStore';
import { useProjectStore } from '../store/projectStore';
import { useMcpStore } from '../store/mcpStore';
import { useGapStore } from '../store/gapStore';
import {
  AspectRatio, TransitionType, ShapeKind, SpeedCurvePreset, MediaAsset, ClipType,
  TRANSITION_TYPES, SHAPE_KINDS, SPEED_CURVE_PRESETS, ASPECT_DIMENSIONS,
} from '../types/edl';
import { describeClipProperties, getClipProperty, PROPERTY_SCHEMA } from '../engine/propertyPath';
import { EFFECT_REGISTRY, getEffectDefinition } from '../engine/effectsRegistry';
import { MOTION_PRESET_LABELS, MotionPresetId } from '../store/timelineStore';
import { parseCaptions, serializeCaptions, reflowCues } from '../engine/captions';
import {
  buildEnvelope, captureCurrentFrame, serializeEnvelope, classifyCommand,
  runPreflight, resolveTarget, resolveAnnotationTargets,
} from '../engine/contextProtocol';
import { detectBeats } from '../engine/beatDetect';
import { runHardwareExport } from '../engine/exportPipeline';
import { analyzeTranscriptForBroll } from '../engine/brollEngine';
import { transcribeAudioOnDevice } from '../engine/whisperLocal';

/* ── Tool definition ────────────────────────────────────────────── */

export interface ToolContext {
  agentName: string;
}

export interface AuraTool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  category: 'discovery' | 'timeline' | 'properties' | 'effects' | 'graphics' | 'audio' | 'ai' | 'project' | 'media';
  schema: S;
  handler: (args: z.infer<S>, ctx: ToolContext) => Promise<unknown> | unknown;
}

const tools: AuraTool[] = [];

function defineTool<S extends z.ZodTypeAny>(tool: AuraTool<S>): void {
  tools.push(tool as unknown as AuraTool);
}

/* ── Helpers ────────────────────────────────────────────────────── */

const timeline = () => useTimelineStore.getState();
const project = () => useProjectStore.getState();

/** Resolve a clip reference: an id, "selected", or a fuzzy name match. */
function resolveClipId(ref?: string): string {
  const state = timeline();

  if (!ref || ref === 'selected' || ref === 'current') {
    const id = state.selectedClipIds[0];
    if (!id) throw new Error('No clip is selected. Pass clipId explicitly, or select a clip first.');
    return id;
  }

  if (findClipById(state.tracks, ref)) return ref;

  // Fall back to a name match so the agent can say "the mascot layer".
  const needle = ref.toLowerCase();
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      if (clip.name.toLowerCase().includes(needle)) return clip.id;
    }
  }

  throw new Error(`No clip matching "${ref}". Call describe_timeline to list the clips.`);
}

function resolveTrackId(ref?: string): string {
  const state = timeline();
  if (!ref) return state.selectedTrackId ?? state.tracks[0].id;
  if (state.tracks.some((t) => t.id === ref)) return ref;

  const needle = ref.toLowerCase();
  const byName = state.tracks.find(
    (t) => t.name.toLowerCase().includes(needle) || t.type === needle
  );
  if (byName) return byName.id;

  throw new Error(`No track matching "${ref}". Call describe_timeline to list the tracks.`);
}

function requireClip(ref?: string) {
  const id = resolveClipId(ref);
  const clip = findClipById(timeline().tracks, id);
  if (!clip) throw new Error(`Clip "${id}" disappeared mid-operation.`);
  return { id, clip };
}

/* ═══════════════════════════════════════════════════════════════════
   DISCOVERY — how the agent learns what it can touch
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Check a value against the set the editor actually supports.
 *
 * Casting an unrecognised string through `as SomeUnion` is worse than
 * useless: the tool reports success, the value lands in the project, and
 * the compositor quietly renders nothing — so an agent tells the user it
 * did the thing, and the user sees no change and no error. Failing loudly
 * WITH the list of valid values is what lets a caller pick again instead
 * of guessing.
 */
function oneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  label: string
): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(
    `AuraCut has no ${label} called "${value}". Supported: ${allowed.join(', ')}.`
  );
}

defineTool({
  name: 'describe_timeline',
  category: 'discovery',
  description:
    'Read the full project state: tracks, clips (with ids, timing, type, effects), markers, playhead and canvas settings. Call this FIRST so later edits target real ids.',
  schema: z.object({
    includeProperties: z.boolean().optional().describe('Include every editable property of each clip (verbose)'),
  }),
  handler: ({ includeProperties }) => {
    const state = timeline();
    const proj = project().project;

    return {
      project: {
        name: proj.name,
        aspectRatio: proj.aspectRatio,
        width: proj.width,
        height: proj.height,
        fps: proj.fps,
        durationMs: proj.durationMs,
        contentEndMs: getContentEndMs(state.tracks),
      },
      playheadMs: state.playheadMs,
      selectedClipIds: state.selectedClipIds,
      selectedTrackId: state.selectedTrackId,
      markers: state.markers.map((m) => ({ id: m.id, timeMs: m.timeMs, kind: m.kind, label: m.label })),
      tracks: state.tracks.map((track) => ({
        id: track.id,
        name: track.name,
        type: track.type,
        index: track.index,
        muted: track.muted,
        locked: track.locked,
        clips: track.clips.map((clip) => ({
          id: clip.id,
          name: clip.name,
          type: clip.type,
          startMs: clip.startTimeMs,
          endMs: clip.startTimeMs + clip.durationMs,
          durationMs: clip.durationMs,
          effects: clip.effects.map((e) => ({ id: e.id, type: e.type, enabled: e.enabled, intensity: e.intensity })),
          keyframeCount: clip.keyframes.length,
          speed: clip.speed.multiplier,
          blendMode: clip.blendMode,
          text: clip.textStyle?.text,
          ...(includeProperties ? { properties: describeClipProperties(clip) } : {}),
        })),
      })),
      mediaPool: state.mediaPool.map((a) => ({ id: a.id, name: a.name, type: a.type, durationMs: a.durationMs })),
    };
  },
});

defineTool({
  name: 'list_properties',
  category: 'discovery',
  description:
    'List every editable property path for a clip, with its type, range and current value. Use these paths with patch_clip.',
  schema: z.object({
    clipId: z.string().optional().describe('Clip id, clip name, or "selected"'),
    filter: z.string().optional().describe('Only return paths containing this substring'),
  }),
  handler: ({ clipId, filter }) => {
    const { clip } = requireClip(clipId);
    let props = describeClipProperties(clip);
    if (filter) {
      const needle = filter.toLowerCase();
      props = props.filter((p) => p.path.toLowerCase().includes(needle) || p.label.toLowerCase().includes(needle));
    }
    return {
      clipId: clip.id,
      clipName: clip.name,
      clipType: clip.type,
      count: props.length,
      properties: props.map((p) => ({
        path: p.path,
        label: p.label,
        type: p.type,
        value: p.currentValue,
        ...(p.min !== undefined ? { min: p.min } : {}),
        ...(p.max !== undefined ? { max: p.max } : {}),
        ...(p.unit ? { unit: p.unit } : {}),
        ...(p.enumValues ? { allowed: p.enumValues } : {}),
        ...(p.animatable ? { animatable: true } : {}),
      })),
    };
  },
});

defineTool({
  name: 'list_effects',
  category: 'discovery',
  description: 'Browse the VFX catalogue: every effect type, its category and its parameter schema.',
  schema: z.object({
    category: z.string().optional().describe('Filter by category: stylize, blur, distort, light, color, generate, motion, utility'),
  }),
  handler: ({ category }) => {
    const list = category ? EFFECT_REGISTRY.filter((e) => e.category === category) : EFFECT_REGISTRY;
    return {
      count: list.length,
      effects: list.map((e) => ({
        type: e.type,
        label: e.label,
        category: e.category,
        description: e.description,
        params: e.params.map((p) => ({
          key: p.key,
          label: p.label,
          type: p.type,
          default: p.default,
          ...(p.min !== undefined ? { min: p.min } : {}),
          ...(p.max !== undefined ? { max: p.max } : {}),
          ...(p.options ? { options: p.options.map((o) => o.value) } : {}),
          ...(p.animatable ? { animatable: true } : {}),
        })),
      })),
    };
  },
});

defineTool({
  name: 'get_frame_context',
  category: 'discovery',
  description:
    'The single most useful call before any visual edit. Returns the exact playhead timecode and frame number, ' +
    'every layer visible at that instant with its on-canvas bounds in project pixels, the resolved primary target, ' +
    'and (optionally) a PNG of the composited frame. Use this instead of guessing what "this" or "here" refers to.',
  schema: z.object({
    includeImage: z.boolean().optional().describe('Attach a base64 PNG of the frame (default true)'),
    atMs: z.number().optional().describe('Inspect a different moment without moving the playhead'),
  }),
  handler: ({ includeImage, atMs }) => {
    const state = timeline();
    const restore = state.playheadMs;

    // Peek at another moment by moving, capturing, then restoring.
    if (atMs !== undefined && atMs !== restore) state.setPlayheadMs(atMs);

    const frame = captureCurrentFrame();
    const envelope = buildEnvelope({
      annotations: [],
      frame,
      includeFrame: includeImage !== false,
    });

    if (atMs !== undefined && atMs !== restore) state.setPlayheadMs(restore);

    return {
      ...envelope,
      // The image is large; hand it over separately and describe it plainly.
      frame: envelope.frame
        ? {
            width: envelope.frame.width,
            height: envelope.frame.height,
            timecode: envelope.frame.timecode,
            frameNumber: envelope.frame.frameNumber,
            atMs: envelope.frame.atMs,
            imageDataUrl: includeImage === false ? undefined : envelope.frame.dataUrl,
            unavailableReason: envelope.frame.unavailableReason,
          }
        : null,
      readable: serializeEnvelope(envelope, 'query'),
    };
  },
});

defineTool({
  name: 'check_command_readiness',
  category: 'discovery',
  description:
    'Run the context protocol against a proposed instruction WITHOUT executing it. Returns the command family, ' +
    'what that family requires, and any blockers (playback running, no target layer, playhead off the clip). ' +
    'Call this when an instruction is vague — it tells you precisely what to ask the user for.',
  schema: z.object({
    instruction: z.string().describe('The user instruction you are about to act on'),
  }),
  handler: ({ instruction }) => {
    const report = runPreflight({
      prompt: instruction,
      annotations: [],
      frame: null,
      frameAttached: false,
      onAttachFrame: () => {},
    });

    return {
      commandFamily: report.kind,
      requires: {
        pausedPlayback: report.requirement.requiresPaused,
        targetLayer: report.requirement.requiresTarget,
        playheadOnTarget: report.requirement.requiresPlayheadOnTarget,
        frame: report.requirement.requiresFrame,
        audio: report.requirement.requiresAudio,
      },
      rationale: report.requirement.rationale,
      ready: report.ready,
      satisfied: report.satisfied,
      blockers: report.issues
        .filter((i) => i.severity === 'blocker')
        .map((i) => ({ id: i.id, title: i.title, detail: i.detail, suggestedFix: i.fixLabel })),
      advisories: report.issues
        .filter((i) => i.severity === 'advisory')
        .map((i) => ({ id: i.id, title: i.title, detail: i.detail })),
    };
  },
});

defineTool({
  name: 'resolve_target',
  category: 'discovery',
  description:
    'Which layer does an unqualified instruction act on right now, and why? Resolution order is ' +
    'user annotation → editor selection → frontmost visible layer.',
  schema: z.object({}),
  handler: () => {
    const target = resolveTarget([]);
    if (!target) {
      return {
        resolved: false,
        reason: 'Nothing is selected and nothing is visible at the playhead.',
        suggestion: 'Ask the user to park the playhead on the shot and select the layer.',
      };
    }
    const clip = findClipById(timeline().tracks, target.clipId);
    return {
      resolved: true,
      clipId: target.clipId,
      name: target.name,
      type: target.type,
      because: target.reason,
      clipSpanMs: clip ? [clip.startTimeMs, clip.startTimeMs + clip.durationMs] : null,
    };
  },
});

defineTool({
  name: 'describe_layer_at_point',
  category: 'discovery',
  description:
    'What is at this pixel on the current frame? Give canvas coordinates (0,0 = top-left of the project frame) ' +
    'and get back the stack of layers under that point, frontmost first, with where the point falls inside each.',
  schema: z.object({
    x: z.number().describe('Canvas X in project pixels'),
    y: z.number().describe('Canvas Y in project pixels'),
  }),
  handler: ({ x, y }) => {
    const probe = {
      id: 'probe',
      kind: 'point' as const,
      points: [{ x, y }],
      color: '#ffffff',
      strokeWidth: 1,
      targets: [],
    };
    const targets = resolveAnnotationTargets(probe);

    return {
      point: { x, y },
      hits: targets.length,
      layers: targets.map((t) => ({
        clipId: t.clipId,
        name: t.clipName,
        type: t.clipType,
        track: t.trackName,
        withinLayer: {
          x: t.localX,
          y: t.localY,
          description:
            `${t.localY < 0.33 ? 'top' : t.localY > 0.66 ? 'bottom' : 'middle'}-` +
            `${t.localX < 0.33 ? 'left' : t.localX > 0.66 ? 'right' : 'centre'}`,
        },
      })),
    };
  },
});

/* ═══════════════════════════════════════════════════════════════════
   PROPERTIES — the universal editing verb
   ═══════════════════════════════════════════════════════════════════ */

defineTool({
  name: 'patch_clip',
  category: 'properties',
  description:
    'Set any number of properties on a clip in one call, addressed by dotted path. ' +
    'Examples: {"transform.rotation": 45, "filters.saturation": 30, "textStyle.color": "#ff0000", "effects.glow.radius": 60}. ' +
    'This is the primary editing tool — prefer it over narrow per-property tools.',
  schema: z.object({
    clipId: z.string().optional().describe('Clip id, clip name, or "selected"'),
    properties: z.record(z.any()).describe('Map of property path → new value'),
  }),
  handler: ({ clipId, properties }) => {
    const id = resolveClipId(clipId);
    const result = timeline().patchClip(id, properties);
    if (result.applied.length === 0 && result.errors.length > 0) {
      throw new Error(result.errors.join('; '));
    }
    return {
      clipId: id,
      applied: result.applied,
      ...(result.errors.length > 0 ? { warnings: result.errors } : {}),
    };
  },
});

defineTool({
  name: 'patch_clips',
  category: 'properties',
  description: 'Apply the same property patch to many clips at once — e.g. grade every clip on a track identically.',
  schema: z.object({
    clipIds: z.array(z.string()).optional().describe('Explicit clip ids; omit to use the current selection'),
    trackId: z.string().optional().describe('Target every clip on this track instead'),
    clipType: z.string().optional().describe('Only clips of this type (video, text, audio, image, shape)'),
    properties: z.record(z.any()),
    relative: z
      .boolean()
      .optional()
      .describe('Treat numeric values as deltas added to the current value, not absolutes'),
  }),
  handler: ({ clipIds, trackId, clipType, properties, relative }) => {
    const state = timeline();

    let targets: string[];
    if (clipIds && clipIds.length > 0) {
      targets = clipIds.map((r) => resolveClipId(r));
    } else if (trackId) {
      const tid = resolveTrackId(trackId);
      targets = state.tracks.find((t) => t.id === tid)?.clips.map((c) => c.id) ?? [];
    } else if (state.selectedClipIds.length > 0) {
      targets = state.selectedClipIds;
    } else {
      targets = state.tracks.flatMap((t) => t.clips.map((c) => c.id));
    }

    if (clipType) {
      targets = targets.filter((id) => findClipById(state.tracks, id)?.type === clipType);
    }

    const applied: string[] = [];
    const errors: string[] = [];
    for (const id of targets) {
      /*
        Relative mode resolves against each clip individually, which is the
        whole point: "make it warmer" applied to five clips that start at
        five different temperatures should warm each of them by the same
        amount, not flatten them all to one value.
      */
      let patch = properties;
      if (relative) {
        const clip = findClipById(state.tracks, id);
        if (!clip) continue;
        patch = Object.fromEntries(
          Object.entries(properties).map(([path, value]) => {
            if (typeof value !== 'number') return [path, value];
            const current = getClipProperty(clip, path);
            return [path, (typeof current === 'number' ? current : 0) + value];
          })
        );
      }

      const r = state.patchClip(id, patch);
      if (r.applied.length > 0) applied.push(id);
      errors.push(...r.errors);
    }

    return { updatedClips: applied.length, clipIds: applied, ...(errors.length ? { warnings: [...new Set(errors)] } : {}) };
  },
});

/* ═══════════════════════════════════════════════════════════════════
   EFFECTS
   ═══════════════════════════════════════════════════════════════════ */

defineTool({
  name: 'add_effect',
  category: 'effects',
  description:
    'Add a VFX effect to a clip. Call list_effects for the catalogue. ' +
    'Params are optional — anything omitted uses the effect default.',
  schema: z.object({
    clipId: z.string().optional(),
    effectType: z.string().describe('Registry key, e.g. glow, rgb_split, film_grain, particles, light_leak, shake'),
    params: z.record(z.any()).optional(),
    intensity: z.number().min(0).max(1).optional(),
  }),
  handler: ({ clipId, effectType, params, intensity }) => {
    const def = getEffectDefinition(effectType);
    if (!def) {
      throw new Error(
        `Unknown effect "${effectType}". Available: ${EFFECT_REGISTRY.map((e) => e.type).join(', ')}`
      );
    }
    const id = resolveClipId(clipId);
    const effectId = timeline().addEffect(id, effectType, params ?? {});
    if (effectId && intensity !== undefined) timeline().setEffectIntensity(id, effectId, intensity);
    return { clipId: id, effectId, effectType, label: def.label };
  },
});

defineTool({
  name: 'remove_effect',
  category: 'effects',
  description: 'Remove an effect from a clip by effect id or effect type.',
  schema: z.object({
    clipId: z.string().optional(),
    effect: z.string().describe('Effect id or effect type'),
  }),
  handler: ({ clipId, effect }) => {
    const id = resolveClipId(clipId);
    timeline().removeEffect(id, effect);
    return { clipId: id, removed: effect };
  },
});

defineTool({
  name: 'set_effect_param',
  category: 'effects',
  description: 'Change one parameter of an effect already on a clip.',
  schema: z.object({
    clipId: z.string().optional(),
    effect: z.string().describe('Effect id or effect type'),
    param: z.string(),
    value: z.any(),
  }),
  handler: ({ clipId, effect, param, value }) => {
    const id = resolveClipId(clipId);
    timeline().setEffectParam(id, effect, param, value);
    return { clipId: id, effect, param, value };
  },
});

defineTool({
  name: 'animate_effect_param',
  category: 'effects',
  description: 'Keyframe an effect parameter — pass two or more {timeOffsetMs, value} stops to animate it over the clip.',
  schema: z.object({
    clipId: z.string().optional(),
    effect: z.string(),
    param: z.string(),
    keyframes: z.array(z.object({ timeOffsetMs: z.number(), value: z.number() })).min(1),
  }),
  handler: ({ clipId, effect, param, keyframes }) => {
    const id = resolveClipId(clipId);
    for (const kf of keyframes) {
      timeline().addEffectKeyframe(id, effect, param, kf.timeOffsetMs, kf.value);
    }
    return { clipId: id, effect, param, keyframeCount: keyframes.length };
  },
});

defineTool({
  name: 'copy_effects',
  category: 'effects',
  description: 'Copy the whole effect stack from one clip onto others — the fastest way to make a sequence look consistent.',
  schema: z.object({
    sourceClipId: z.string().optional(),
    targetClipIds: z.array(z.string()).optional().describe('Omit to target every other clip on the same track'),
  }),
  handler: ({ sourceClipId, targetClipIds }) => {
    const state = timeline();
    const sourceId = resolveClipId(sourceClipId);

    let targets: string[];
    if (targetClipIds?.length) {
      targets = targetClipIds.map((r) => resolveClipId(r));
    } else {
      const track = state.tracks.find((t) => t.clips.some((c) => c.id === sourceId));
      targets = track?.clips.filter((c) => c.id !== sourceId).map((c) => c.id) ?? [];
    }

    state.copyEffectsTo(sourceId, targets);
    return { sourceClipId: sourceId, appliedTo: targets.length };
  },
});

/* ═══════════════════════════════════════════════════════════════════
   GRAPHICS & MOTION
   ═══════════════════════════════════════════════════════════════════ */

defineTool({
  name: 'add_text_layer',
  category: 'graphics',
  description: 'Create an animated text layer. Style it afterwards with patch_clip using textStyle.* paths.',
  schema: z.object({
    text: z.string(),
    trackId: z.string().optional(),
    startTimeMs: z.number().optional(),
    durationMs: z.number().optional(),
    style: z.record(z.any()).optional().describe('textStyle overrides, e.g. {"fontSize": 96, "color": "#ff0"}'),
  }),
  handler: ({ text, trackId, startTimeMs, durationMs, style }) => {
    const state = timeline();
    const tid = trackId ? resolveTrackId(trackId) : (state.tracks.find((t) => t.type === 'text')?.id ?? state.tracks[0].id);
    const id = state.addTextLayer(tid, text, startTimeMs ?? state.playheadMs, durationMs ?? 4000);

    if (style) {
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(style)) patch[k.startsWith('textStyle.') ? k : `textStyle.${k}`] = v;
      state.patchClip(id, patch);
    }
    return { clipId: id, text };
  },
});

defineTool({
  name: 'add_shape_layer',
  category: 'graphics',
  description: 'Create a vector shape layer (rectangle, ellipse, triangle, polygon, star, line, arrow, heart, blob, path).',
  schema: z.object({
    kind: z.string().describe(`Shape kind. One of: ${SHAPE_KINDS.join(', ')}`),
    trackId: z.string().optional(),
    startTimeMs: z.number().optional(),
    durationMs: z.number().optional(),
    style: z.record(z.any()).optional().describe('shapeStyle overrides, e.g. {"fill": "#4c9dff", "cornerRadius": 40}'),
  }),
  handler: ({ kind, trackId, startTimeMs, durationMs, style }) => {
    const state = timeline();
    const tid = trackId ? resolveTrackId(trackId) : (state.selectedTrackId ?? state.tracks[0].id);
    const id = state.addShapeLayer(
      tid,
      oneOf(kind, SHAPE_KINDS, 'shape'),
      startTimeMs ?? state.playheadMs,
      durationMs ?? 3000
    );

    if (style) {
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(style)) patch[k.startsWith('shapeStyle.') ? k : `shapeStyle.${k}`] = v;
      state.patchClip(id, patch);
    }
    return { clipId: id, kind };
  },
});

defineTool({
  name: 'add_adjustment_layer',
  category: 'graphics',
  description: 'Add an adjustment layer — effects on it grade every layer beneath it for its duration.',
  schema: z.object({
    trackId: z.string().optional(),
    startTimeMs: z.number().optional(),
    durationMs: z.number().optional(),
  }),
  handler: ({ trackId, startTimeMs, durationMs }) => {
    const state = timeline();
    const tid = trackId ? resolveTrackId(trackId) : state.tracks[0].id;
    const id = state.addAdjustmentLayer(tid, startTimeMs ?? 0, durationMs ?? 5000);
    return { clipId: id };
  },
});

defineTool({
  name: 'set_motion_path',
  category: 'graphics',
  description:
    'Make a layer travel along a spatial path. Points are canvas coordinates (0,0 is top-left; the centre is width/2, height/2).',
  schema: z.object({
    clipId: z.string().optional(),
    points: z.array(z.object({ x: z.number(), y: z.number() })).min(2),
    orientToPath: z.boolean().optional().describe('Rotate the layer to follow the path direction'),
    closed: z.boolean().optional(),
    easing: z.string().optional(),
  }),
  handler: ({ clipId, points, orientToPath, closed, easing }) => {
    const id = resolveClipId(clipId);
    timeline().setMotionPath(id, {
      enabled: true,
      points,
      orientToPath: orientToPath ?? false,
      closed: closed ?? false,
      easing: (easing as any) ?? 'easeInOut',
    });
    return { clipId: id, pointCount: points.length };
  },
});

defineTool({
  name: 'apply_motion_preset',
  category: 'graphics',
  description: `Apply a ready-made keyframe animation. Presets: ${MOTION_PRESET_LABELS.map((p) => p.id).join(', ')}.`,
  schema: z.object({
    clipId: z.string().optional(),
    preset: z.string(),
  }),
  handler: ({ clipId, preset }) => {
    const valid = MOTION_PRESET_LABELS.map((p) => p.id);
    if (!valid.includes(preset as MotionPresetId)) {
      throw new Error(`Unknown preset "${preset}". Available: ${valid.join(', ')}`);
    }
    const id = resolveClipId(clipId);
    timeline().applyMotionPreset(id, preset as MotionPresetId);
    return { clipId: id, preset };
  },
});

defineTool({
  name: 'add_keyframes',
  category: 'graphics',
  description:
    'Animate any transform property with explicit keyframes. Property must be one of positionX, positionY, scaleX, scaleY, rotation, opacity, volume.',
  schema: z.object({
    clipId: z.string().optional(),
    property: z.string(),
    keyframes: z.array(
      z.object({
        timeOffsetMs: z.number().describe('Milliseconds from the clip start'),
        value: z.number(),
        easing: z.string().optional(),
      })
    ).min(1),
  }),
  handler: ({ clipId, property, keyframes }) => {
    const valid = ['positionX', 'positionY', 'scaleX', 'scaleY', 'rotation', 'opacity', 'volume'];
    if (!valid.includes(property)) {
      throw new Error(`"${property}" is not animatable. Use one of: ${valid.join(', ')}`);
    }
    const id = resolveClipId(clipId);
    const state = timeline();
    for (const kf of keyframes) {
      state.addKeyframe(id, {
        property: property as any,
        timeOffsetMs: kf.timeOffsetMs,
        value: kf.value,
        easing: (kf.easing as any) ?? 'easeInOut',
      });
    }
    return { clipId: id, property, count: keyframes.length };
  },
});

defineTool({
  name: 'set_motion_blur',
  category: 'graphics',
  description: 'Enable per-layer motion blur, sampled across the shutter interval.',
  schema: z.object({
    clipId: z.string().optional(),
    enabled: z.boolean(),
    shutterAngle: z.number().min(0).max(720).optional(),
    samples: z.number().min(2).max(16).optional(),
  }),
  handler: ({ clipId, enabled, shutterAngle, samples }) => {
    const id = resolveClipId(clipId);
    const patch: Record<string, unknown> = { 'motionBlur.enabled': enabled };
    if (shutterAngle !== undefined) patch['motionBlur.shutterAngle'] = shutterAngle;
    if (samples !== undefined) patch['motionBlur.samples'] = samples;
    timeline().patchClip(id, patch);
    return { clipId: id, enabled };
  },
});

/* ═══════════════════════════════════════════════════════════════════
   TIMELINE STRUCTURE
   ═══════════════════════════════════════════════════════════════════ */

defineTool({
  name: 'insert_clip',
  category: 'timeline',
  description: 'Place a media-pool asset onto a track.',
  schema: z.object({
    assetId: z.string().describe('Media asset id or name'),
    trackId: z.string().optional(),
    startTimeMs: z.number().optional(),
  }),
  handler: ({ assetId, trackId, startTimeMs }) => {
    const state = timeline();
    const asset =
      state.mediaPool.find((a) => a.id === assetId) ??
      state.mediaPool.find((a) => a.name.toLowerCase().includes(assetId.toLowerCase()));
    if (!asset) {
      throw new Error(`No media asset "${assetId}". Available: ${state.mediaPool.map((a) => a.name).join(', ')}`);
    }
    const tid = trackId ? resolveTrackId(trackId) : (asset.type === 'audio' ? resolveTrackId('audio') : state.tracks[0].id);
    const id = state.insertClip(tid, asset, startTimeMs ?? state.playheadMs);
    return { clipId: id, assetName: asset.name, trackId: tid };
  },
});

defineTool({
  name: 'split_clip',
  category: 'timeline',
  description: 'Razor a clip at a timeline position.',
  schema: z.object({
    clipId: z.string().optional(),
    atMs: z.number().optional().describe('Timeline position; defaults to the playhead'),
  }),
  handler: ({ clipId, atMs }) => {
    const state = timeline();
    const id = resolveClipId(clipId);
    state.splitClip(id, atMs ?? state.playheadMs);
    return { clipId: id, splitAtMs: atMs ?? state.playheadMs };
  },
});

defineTool({
  name: 'trim_clip',
  category: 'timeline',
  description: 'Set a clip\'s in and/or out point on the timeline.',
  schema: z.object({
    clipId: z.string().optional(),
    newStartMs: z.number().optional(),
    newEndMs: z.number().optional(),
    ripple: z.boolean().optional(),
  }),
  handler: ({ clipId, newStartMs, newEndMs, ripple }) => {
    const id = resolveClipId(clipId);
    timeline().trimClip(id, newStartMs, newEndMs, ripple);
    return { clipId: id, newStartMs, newEndMs };
  },
});

defineTool({
  name: 'move_clip',
  category: 'timeline',
  description: 'Move a clip in time and/or to a different track.',
  schema: z.object({
    clipId: z.string().optional(),
    targetTrackId: z.string().optional(),
    startTimeMs: z.number(),
  }),
  handler: ({ clipId, targetTrackId, startTimeMs }) => {
    const state = timeline();
    const id = resolveClipId(clipId);
    const clip = findClipById(state.tracks, id)!;
    const tid = targetTrackId ? resolveTrackId(targetTrackId) : clip.trackId;
    state.moveClip(id, tid, startTimeMs);
    state.commit('Move clip');
    return { clipId: id, trackId: tid, startTimeMs };
  },
});

defineTool({
  name: 'delete_clip',
  category: 'timeline',
  description: 'Remove a clip from the timeline.',
  schema: z.object({
    clipId: z.string().optional(),
    ripple: z.boolean().optional().describe('Close the gap left behind'),
  }),
  handler: ({ clipId, ripple }) => {
    const id = resolveClipId(clipId);
    timeline().deleteClip(id, ripple);
    return { deletedClipId: id };
  },
});

defineTool({
  name: 'add_track',
  category: 'timeline',
  description: 'Create a new track.',
  schema: z.object({
    type: z.enum(['video', 'audio', 'text', 'overlay', 'effect']),
    name: z.string().optional(),
  }),
  handler: ({ type, name }) => ({ trackId: timeline().addTrack(type, name) }),
});

defineTool({
  name: 'apply_transition',
  category: 'timeline',
  description: 'Apply a transition to a clip edge, or to the seam between two adjacent clips.',
  schema: z.object({
    clipId: z.string().optional(),
    toClipId: z.string().optional().describe('When given, the transition is placed across the seam'),
    transitionType: z.string().describe(`One of: ${TRANSITION_TYPES.join(', ')}`),
    durationMs: z.number().optional(),
    position: z.enum(['in', 'out']).optional(),
  }),
  handler: ({ clipId, toClipId, transitionType, durationMs, position }) => {
    const state = timeline();
    const id = resolveClipId(clipId);
    const dur = durationMs ?? 400;

    if (toClipId) {
      const target = resolveClipId(toClipId);
      const kind = oneOf(transitionType, TRANSITION_TYPES, 'transition');
      state.applyTransitionToClip(id, 'out', kind, dur);
      state.applyTransitionToClip(target, 'in', kind, dur);
      return { seam: [id, target], transitionType, durationMs: dur };
    }

    state.applyTransitionToClip(
      id,
      position ?? 'out',
      oneOf(transitionType, TRANSITION_TYPES, 'transition'),
      dur
    );
    return { clipId: id, transitionType, durationMs: dur, position: position ?? 'out' };
  },
});

defineTool({
  name: 'set_speed',
  category: 'timeline',
  description: 'Change a clip\'s playback speed, optionally with a ramp preset or custom curve points.',
  schema: z.object({
    clipId: z.string().optional(),
    multiplier: z.number().min(0.05).max(20).optional(),
    curvePreset: z.string().optional().describe(`One of: ${SPEED_CURVE_PRESETS.join(', ')}`),
    reversed: z.boolean().optional(),
    customPoints: z.array(z.object({ timePct: z.number(), speedMult: z.number() })).optional(),
  }),
  handler: ({ clipId, multiplier, curvePreset, reversed, customPoints }) => {
    const state = timeline();
    const id = resolveClipId(clipId);

    if (customPoints?.length) {
      state.setSpeedCurvePoints(id, customPoints);
    }
    state.updateClipSpeed(id, {
      ...(multiplier !== undefined ? { multiplier } : {}),
      ...(curvePreset ? { curvePreset: oneOf(curvePreset, SPEED_CURVE_PRESETS, 'speed curve') } : {}),
      ...(reversed !== undefined ? { reversed } : {}),
    });
    state.commit('Set speed');
    return { clipId: id, multiplier, curvePreset, reversed };
  },
});

defineTool({
  name: 'freeze_frame',
  category: 'timeline',
  description: 'Hold a single frame for a given duration, splitting the clip around it.',
  schema: z.object({
    clipId: z.string().optional(),
    atMs: z.number().optional(),
    holdMs: z.number().optional(),
  }),
  handler: ({ clipId, atMs, holdMs }) => {
    const state = timeline();
    const id = resolveClipId(clipId);
    state.freezeFrame(id, atMs ?? state.playheadMs, holdMs ?? 2000);
    return { clipId: id, holdMs: holdMs ?? 2000 };
  },
});

/* ═══════════════════════════════════════════════════════════════════
   AUDIO & CAPTIONS
   ═══════════════════════════════════════════════════════════════════ */

defineTool({
  name: 'import_captions',
  category: 'ai',
  description: 'Import subtitles from SRT, WebVTT, SBV, ASS/SSA or Whisper JSON content and lay them out as text clips.',
  schema: z.object({
    content: z.string().describe('Raw subtitle file contents'),
    filename: z.string().optional(),
    offsetMs: z.number().optional(),
    maxCharsPerLine: z.number().optional().describe('Reflow long cues to this width'),
    replaceExisting: z.boolean().optional(),
    style: z.record(z.any()).optional(),
  }),
  handler: ({ content, filename, offsetMs, maxCharsPerLine, replaceExisting, style }) => {
    const report = parseCaptions(content, filename);
    if (report.cues.length === 0) {
      throw new Error(`No cues found. ${report.warnings.join(' ')}`);
    }
    const cues = maxCharsPerLine ? reflowCues(report.cues, maxCharsPerLine) : report.cues;
    const count = timeline().importCaptions(cues, {
      offsetMs,
      replaceExisting,
      style: style as Record<string, any> | undefined,
    });
    return { format: report.format, imported: count, warnings: report.warnings };
  },
});

defineTool({
  name: 'export_captions',
  category: 'ai',
  description: 'Serialise the text track back out as SRT, VTT, ASS, SBV or JSON.',
  schema: z.object({
    format: z.enum(['srt', 'vtt', 'ass', 'sbv', 'json']).optional(),
    trackId: z.string().optional(),
  }),
  handler: ({ format, trackId }) => {
    const state = timeline();
    const track = trackId
      ? state.tracks.find((t) => t.id === resolveTrackId(trackId))
      : state.tracks.find((t) => t.type === 'text');
    if (!track) throw new Error('No text track found to export.');

    const cues = track.clips
      .filter((c) => c.type === 'text' && c.textStyle?.text)
      .sort((a, b) => a.startTimeMs - b.startTimeMs)
      .map((c, i) => ({
        index: i + 1,
        startMs: c.startTimeMs,
        endMs: c.startTimeMs + c.durationMs,
        text: c.textStyle!.text,
        align: c.textStyle!.align,
      }));

    return { format: format ?? 'srt', cueCount: cues.length, content: serializeCaptions(cues, format ?? 'srt') };
  },
});

defineTool({
  name: 'generate_auto_captions',
  category: 'ai',
  description: 'Run on-device speech-to-text and build a synced caption track.',
  schema: z.object({
    language: z.string().optional(),
    style: z.record(z.any()).optional(),
  }),
  handler: async ({ language, style }) => {
    const result = await transcribeAudioOnDevice('audio-track', language ?? 'sw');
    const state = timeline();
    state.generateAutoCaptions(undefined, language ?? 'sw');

    if (style) {
      // Apply the requested styling to every caption clip that was just made.
      const textTrack = state.tracks.find((t) => t.type === 'text');
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(style as Record<string, unknown>)) {
        patch[k.startsWith('textStyle.') ? k : `textStyle.${k}`] = v;
      }
      for (const clip of textTrack?.clips ?? []) state.patchClip(clip.id, patch);
    }

    return { language: language ?? 'sw', words: result.words.length };
  },
});

defineTool({
  name: 'detect_beats',
  category: 'audio',
  description: 'Analyse the music track, estimate BPM and drop beat markers on the timeline.',
  schema: z.object({
    clipId: z.string().optional().describe('Audio clip to analyse; defaults to the first music clip'),
    snapCuts: z.boolean().optional().describe('Also nudge the video cuts onto the nearest beat'),
  }),
  handler: async ({ clipId, snapCuts }) => {
    const state = timeline();
    const clip = clipId
      ? findClipById(state.tracks, resolveClipId(clipId))
      : state.tracks.filter((t) => t.type === 'audio').flatMap((t) => t.clips).find((c) => c.mediaUrl);

    if (!clip?.mediaUrl) throw new Error('No audio clip with media found to analyse.');

    const result = await detectBeats(clip.mediaUrl, clip.startTimeMs);
    state.setBeatMarkers(result.beatsMs);

    let snapped = 0;
    if (snapCuts) {
      const videoTrack = state.tracks.find((t) => t.type === 'video');
      if (videoTrack) snapped = state.snapCutsToBeats(videoTrack.id);
    }

    return { bpm: Math.round(result.bpm), beats: result.beatsMs.length, cutsSnapped: snapped };
  },
});

defineTool({
  name: 'remove_silence',
  category: 'audio',
  description: 'Detect and cut dialogue pauses on a track, closing the gaps.',
  schema: z.object({ trackId: z.string().optional() }),
  handler: ({ trackId }) => {
    const tid = trackId ? resolveTrackId(trackId) : resolveTrackId('audio');
    const removedMs = timeline().sliceAndRemoveSilence(tid);
    return { trackId: tid, removedMs, removedSeconds: Number((removedMs / 1000).toFixed(2)) };
  },
});

defineTool({
  name: 'suggest_broll',
  category: 'ai',
  description: 'Scan the dialogue for keywords and propose contextual B-roll cutaways.',
  schema: z.object({ insert: z.boolean().optional().describe('Also place the suggestions on the overlay track') }),
  handler: ({ insert }) => {
    const state = timeline();
    const suggestions = analyzeTranscriptForBroll(state.tracks);

    if (insert) {
      const overlay = state.tracks.find((t) => t.type === 'overlay') ?? state.tracks[0];
      for (const s of suggestions) state.insertClip(overlay.id, s.mediaAsset, s.startTimeMs);
    }

    return {
      count: suggestions.length,
      inserted: Boolean(insert),
      suggestions: suggestions.map((s) => ({ asset: s.mediaAsset.name, atMs: s.startTimeMs, reason: (s as any).keyword ?? undefined })),
    };
  },
});

/* ═══════════════════════════════════════════════════════════════════
   PROJECT
   ═══════════════════════════════════════════════════════════════════ */

defineTool({
  name: 'set_canvas',
  category: 'project',
  description: 'Change the output aspect ratio, frame rate or background colour.',
  schema: z.object({
    aspectRatio: z.string().optional(),
    fps: z.number().optional(),
    backgroundColor: z.string().optional(),
    name: z.string().optional(),
  }),
  handler: ({ aspectRatio, fps, backgroundColor, name }) => {
    const proj = project();
    if (aspectRatio) {
      proj.setAspectRatio(
        oneOf(aspectRatio, Object.keys(ASPECT_DIMENSIONS) as AspectRatio[], 'aspect ratio')
      );
    }
    if (fps) proj.setFps(fps as 24 | 30 | 60);
    if (backgroundColor) proj.setBackgroundColor(backgroundColor);
    if (name) proj.setProjectName(name);
    return { aspectRatio: proj.project.aspectRatio, fps: proj.project.fps };
  },
});

defineTool({
  name: 'seek',
  category: 'project',
  description: 'Move the playhead, optionally to a named marker.',
  schema: z.object({
    timeMs: z.number().optional(),
    marker: z.string().optional(),
  }),
  handler: ({ timeMs, marker }) => {
    const state = timeline();
    if (marker) {
      const m = state.markers.find((x) => x.label.toLowerCase().includes(marker.toLowerCase()));
      if (!m) throw new Error(`No marker matching "${marker}".`);
      state.setPlayheadMs(m.timeMs);
      return { playheadMs: m.timeMs, marker: m.label };
    }
    state.setPlayheadMs(timeMs ?? 0);
    return { playheadMs: timeMs ?? 0 };
  },
});

defineTool({
  name: 'add_marker',
  category: 'project',
  description: 'Drop a labelled marker on the timeline.',
  schema: z.object({
    timeMs: z.number().optional(),
    label: z.string().optional(),
    kind: z.enum(['generic', 'beat', 'chapter', 'comment', 'todo']).optional(),
  }),
  handler: ({ timeMs, label, kind }) => {
    const state = timeline();
    state.addMarker(timeMs ?? state.playheadMs, label, kind);
    return { timeMs: timeMs ?? state.playheadMs, label };
  },
});

defineTool({
  name: 'select_clips',
  category: 'project',
  description: 'Change the editor selection so subsequent tools that omit clipId act on these clips.',
  schema: z.object({
    clipIds: z.array(z.string()).optional(),
    trackId: z.string().optional().describe('Select every clip on this track'),
  }),
  handler: ({ clipIds, trackId }) => {
    const state = timeline();
    if (trackId) {
      const tid = resolveTrackId(trackId);
      state.selectAllOnTrack(tid);
      return { selected: state.selectedClipIds.length, trackId: tid };
    }
    const ids = (clipIds ?? []).map((r) => resolveClipId(r));
    state.selectClips(ids);
    return { selected: ids.length, clipIds: ids };
  },
});

defineTool({
  name: 'undo',
  category: 'project',
  description: 'Undo the last edit.',
  schema: z.object({ steps: z.number().optional() }),
  handler: ({ steps }) => {
    const n = Math.max(1, Math.min(20, steps ?? 1));
    for (let i = 0; i < n; i++) timeline().undo();
    return { undone: n };
  },
});

defineTool({
  name: 'render_export',
  category: 'project',
  description: 'Render the sequence to a video file.',
  schema: z.object({
    resolution: z.enum(['720p', '1080p', '4k']).optional(),
    fps: z.number().optional(),
    codec: z.enum(['h264', 'hevc', 'prores']).optional(),
  }),
  handler: async ({ resolution, fps, codec }) => {
    const proj = project();
    proj.setExportModalOpen(true);
    proj.setIsExporting(true);
    try {
      const outputPath = await runHardwareExport(
        timeline().tracks,
        proj.project,
        { resolution: resolution ?? '1080p', fps: (fps ?? proj.project.fps) as 30 | 60, codec: codec ?? 'h264' },
        (progress, statusText) => proj.setExportProgress(progress, statusText)
      );
      proj.setLastExportPath(outputPath);
      return { outputPath };
    } finally {
      proj.setIsExporting(false);
    }
  },
});

/* ═══════════════════════════════════════════════════════════════════
   Dispatch
   ═══════════════════════════════════════════════════════════════════ */

export const AURA_TOOLS: readonly AuraTool[] = tools;

export function getTool(name: string): AuraTool | undefined {
  return tools.find((t) => t.name === name);
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
}

/** Validate, execute and log a tool call. Never throws. */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  agentName = 'External Agent'
): Promise<ToolResult> {
  const started = performance.now();
  const tool = getTool(name);

  if (!tool) {
    const suggestion = tools
      .map((t) => t.name)
      .filter((t) => t.includes(name.split('_')[0]))
      .slice(0, 3);
    const error = `Unknown tool "${name}".${suggestion.length ? ` Did you mean: ${suggestion.join(', ')}?` : ''}`;
    useMcpStore.getState().logToolExecution({
      toolName: name, parameters: args, result: { error }, status: 'error', durationMs: 0, agentName,
    });
    return { success: false, error, durationMs: 0 };
  }

  const parsed = tool.schema.safeParse(args ?? {});
  if (!parsed.success) {
    const error = `Invalid arguments for ${name}: ${parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'} — ${i.message}`)
      .join('; ')}`;
    useMcpStore.getState().logToolExecution({
      toolName: name, parameters: args, result: { error }, status: 'error', durationMs: 0, agentName,
    });
    return { success: false, error, durationMs: 0 };
  }

  try {
    const data = await tool.handler(parsed.data, { agentName });
    const durationMs = Math.round(performance.now() - started);
    useMcpStore.getState().logToolExecution({
      toolName: name,
      parameters: parsed.data as Record<string, unknown>,
      result: data as Record<string, unknown>,
      status: 'success',
      durationMs,
      agentName,
    });
    return { success: true, data, durationMs };
  } catch (err) {
    const durationMs = Math.round(performance.now() - started);
    const error = err instanceof Error ? err.message : String(err);
    useMcpStore.getState().logToolExecution({
      toolName: name,
      parameters: parsed.data as Record<string, unknown>,
      result: { error },
      status: 'error',
      durationMs,
      agentName,
    });
    return { success: false, error, durationMs };
  }
}

/** JSON-Schema style listing for an MCP `tools/list` response. */
export function getToolManifest() {
  return AURA_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    category: t.category,
    inputSchema: zodToJsonSchema(t.schema),
  }));
}

/** Minimal Zod → JSON Schema conversion covering the shapes used here. */
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as any)._def;

  if (schema instanceof z.ZodObject) {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!value.isOptional()) required.push(key);
    }
    return { type: 'object', properties, ...(required.length ? { required } : {}) };
  }

  if (schema instanceof z.ZodOptional) {
    return { ...zodToJsonSchema(def.innerType), optional: true };
  }
  if (schema instanceof z.ZodArray) {
    return { type: 'array', items: zodToJsonSchema(def.type) };
  }
  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: def.values };
  }
  if (schema instanceof z.ZodRecord) {
    return { type: 'object', additionalProperties: true };
  }
  if (schema instanceof z.ZodNumber) return { type: 'number' };
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  if (schema instanceof z.ZodString) {
    return { type: 'string', ...(def.description ? { description: def.description } : {}) };
  }
  return {};
}

/* ═══════════════════════════════════════════════════════════════════
   MEDIA INGEST

   The bridge between "a file exists on disk" and "it is in the project".
   An external agent can fetch, download or generate a file with its own
   tools; this is how that file becomes something the editor can cut.
   ═══════════════════════════════════════════════════════════════════ */

/** Probe a media file in the renderer to learn its real duration/size. */
function probeMedia(url: string, type: ClipType): Promise<{
  durationMs: number;
  width?: number;
  height?: number;
  thumbnailUrl: string;
}> {
  return new Promise((resolve) => {
    // Images have no duration and decode as an <img>.
    if (type === 'image') {
      const img = new Image();
      img.onload = () =>
        resolve({ durationMs: 5000, width: img.naturalWidth, height: img.naturalHeight, thumbnailUrl: url });
      img.onerror = () => resolve({ durationMs: 5000, thumbnailUrl: '' });
      img.src = url;
      return;
    }

    const el = document.createElement(type === 'audio' ? 'audio' : 'video');
    el.preload = 'metadata';

    const done = (ok: boolean) => {
      if (!ok) { resolve({ durationMs: 5000, thumbnailUrl: '' }); return; }
      const video = el as HTMLVideoElement;
      resolve({
        durationMs: Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : 5000,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
        thumbnailUrl: type === 'audio' ? '' : url,
      });
    };

    el.onloadedmetadata = () => done(true);
    el.onerror = () => done(false);
    // Never hang the tool call on a codec the browser cannot open.
    setTimeout(() => done(Number.isFinite(el.duration)), 4000);
    el.src = url;
  });
}

function classifyByExtension(filePath: string): ClipType {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic'].includes(ext)) return 'image';
  return 'video';
}

defineTool({
  name: 'import_media_from_path',
  category: 'media',
  description:
    'Import a media file from an absolute path on disk into the project media pool. ' +
    'Use after downloading or locating a file. Returns the new asset id, which insert_clip accepts.',
  schema: z.object({
    path: z.string().describe('Absolute path to a video, audio or image file'),
    name: z.string().optional().describe('Display name; defaults to the file name'),
  }),
  handler: async ({ path: filePath, name }) => {
    if (!filePath.startsWith('/')) {
      throw new Error(`Path must be absolute, got "${filePath}"`);
    }

    const fileName = name ?? filePath.split('/').pop() ?? 'Imported media';
    const type = classifyByExtension(filePath);

    /*
      file:// works here because the window runs with webSecurity disabled;
      the URL is kept as the asset's source so the compositor and the
      exporter read the original file rather than a copy in memory.
    */
    const url = `file://${encodeURI(filePath).replace(/#/g, '%23')}`;
    const probed = await probeMedia(url, type);

    const asset: MediaAsset = {
      id: `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      name: fileName,
      type,
      url,
      thumbnailUrl: probed.thumbnailUrl,
      durationMs: probed.durationMs,
      width: probed.width,
      height: probed.height,
      fileSizeFormatted: '—',
    };

    timeline().addMediaAsset(asset);
    return {
      assetId: asset.id,
      name: asset.name,
      type: asset.type,
      durationMs: asset.durationMs,
      ...(asset.width ? { dimensions: `${asset.width}×${asset.height}` } : {}),
    };
  },
});

defineTool({
  name: 'list_media_pool',
  category: 'media',
  description: 'List every media asset currently imported, with ids usable by insert_clip.',
  schema: z.object({}),
  handler: () => ({
    assets: timeline().mediaPool.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      durationMs: a.durationMs,
      ...(a.width ? { dimensions: `${a.width}×${a.height}` } : {}),
    })),
  }),
});

/* ═══════════════════════════════════════════════════════════════════
   CAPABILITY GAPS
   ═══════════════════════════════════════════════════════════════════ */

defineTool({
  name: 'report_capability_gap',
  category: 'discovery',
  description:
    'Record that the user asked for something AuraCut cannot do. Call this WHENEVER you ' +
    'have to tell the user no, or had to substitute something different from what they ' +
    'asked for — including when you found a workaround. This is how missing features ' +
    'reach the developer; a refusal you only speak aloud is lost the moment the panel ' +
    'scrolls. Then still tell the user plainly what you could not do and what you suggest.',
  schema: z.object({
    request: z.string().describe("What the user asked for, in their words where possible"),
    reason: z.string().describe('Why AuraCut cannot do it'),
    suggestion: z.string().optional().describe('The tool or feature that would close the gap'),
    workaround: z.string().optional().describe('What you did instead, if anything'),
  }),
  handler: ({ request, reason, suggestion, workaround }) => {
    const gap = useGapStore.getState().record({ request, reason, suggestion, workaround });
    return {
      recorded: true,
      gapId: gap.id,
      timesRequested: gap.count,
      note: 'Logged for the developer. Tell the user what you could not do and what you suggest instead.',
    };
  },
});

defineTool({
  name: 'list_capability_gaps',
  category: 'discovery',
  description: 'List everything previously recorded as missing from AuraCut.',
  schema: z.object({}),
  handler: () => ({
    gaps: useGapStore.getState().gaps.map((g) => ({
      request: g.request,
      reason: g.reason,
      suggestion: g.suggestion,
      timesRequested: g.count,
      resolved: g.resolved,
    })),
  }),
});
