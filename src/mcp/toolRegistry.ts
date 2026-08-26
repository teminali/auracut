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
  AspectRatio, TransitionType, ShapeKind, SpeedCurvePreset, MediaAsset, ClipType, AnimatableProperty,
  Clip, Track,
  ANIMATABLE_PROPERTIES, KEYFRAME_PATH_ALIASES,
  TRANSITION_TYPES, SHAPE_KINDS, SPEED_CURVE_PRESETS, ASPECT_DIMENSIONS,
  EASINGS, FPS_VALUES, CLIP_TYPES,
} from '../types/edl';
import { describeClipProperties, getClipProperty, PROPERTY_SCHEMA } from '../engine/propertyPath';
import { EFFECT_REGISTRY, EFFECT_CATEGORIES, getEffectDefinition } from '../engine/effectsRegistry';
import { MOTION_PRESET_LABELS, MotionPresetId } from '../store/timelineStore';
import { parseCaptions, serializeCaptions, reflowCues, CaptionCue } from '../engine/captions';
import {
  buildEnvelope, captureCurrentFrame, serializeEnvelope, classifyCommand,
  runPreflight, resolveTarget, resolveAnnotationTargets,
} from '../engine/contextProtocol';
import { detectBeats } from '../engine/beatDetect';
import { analyzeReferenceVideo } from '../engine/referenceAnalysis';
import { getClipBaseSize } from '../engine/geometry';
import { getNaturalSize } from '../engine/compositor';
import { runHardwareExport, unsupportedAudioSettings } from '../engine/exportPipeline';
import { unpreviewableAudio, measureChain } from '../engine/audioEffects';
import { analyzeTranscriptForBroll } from '../engine/brollEngine';
import { loadFonts, isFontAvailable, fontsAreEnumerated } from '../engine/systemFonts';
import { renderSfx, SFX_CATALOGUE } from '../engine/sfxEngine';
import { followToolCall } from '../engine/agentPresence';
import { buildStarterProject, STARTER_NAME } from '../engine/starterProject';
import { deserializeProject } from '../engine/projectIO';
import { autoMontageToBeats } from '../engine/montage';
import { assembleFromFolder } from '../engine/folderAssembly';
import {
  LOOK_PRESETS, getLookPreset, lookPresetIds, applyLookToClips,
} from '../engine/lookPresets';
import { selectClips, runBatchApply } from '../engine/batchApply';
import {
  PIP_CORNERS, PIP_FIT_MODE, computePipGeometry, buildPipPatch,
} from '../engine/pictureInPicture';

/* ── Tool definition ────────────────────────────────────────────── */

export interface ToolContext {
  agentName: string;
}

export interface KerfTool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  category: 'discovery' | 'timeline' | 'properties' | 'effects' | 'graphics' | 'audio' | 'ai' | 'project' | 'media';
  schema: S;
  handler: (args: z.infer<S>, ctx: ToolContext) => Promise<unknown> | unknown;
}

const tools: KerfTool[] = [];

function defineTool<S extends z.ZodTypeAny>(tool: KerfTool<S>): void {
  tools.push(tool as unknown as KerfTool);
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
    `Kerf has no ${label} called "${value}". Supported: ${allowed.join(', ')}.`
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
    category: z
      .string()
      .optional()
      .describe(`Filter by category. One of: ${EFFECT_CATEGORIES.map((c) => c.id).join(', ')}`),
  }),
  handler: ({ category }) => {
    /* A typo used to return `{count: 0, effects: []}` — indistinguishable
       from "that category is empty", which sent the agent looking for an
       effect catalogue that does not exist. */
    const wanted = category
      ? oneOf(category, EFFECT_CATEGORIES.map((c) => c.id), 'effect category')
      : undefined;
    const list = wanted ? EFFECT_REGISTRY.filter((e) => e.category === wanted) : EFFECT_REGISTRY;
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
            /*
              How much of this frame is a placeholder.

              The compositor draws a dark gradient for media that has not
              decoded yet, and that reads as a legitimately dark shot. An
              agent measuring a frame right after an insert was measuring
              nothing and could not have known.
            */
            mediaPending: envelope.frame.mediaPending.length,
            ...(envelope.frame.mediaPending.length > 0
              ? {
                  mediaPendingClipIds: envelope.frame.mediaPending,
                  mediaPendingNote:
                    `${envelope.frame.mediaPending.length} visible layer(s) had not finished ` +
                    'decoding, so this frame shows the placeholder gradient for them, not their ' +
                    'media. Do not measure it. Call again until mediaPending is 0.',
                }
              : {}),
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
    /* Report what actually moved. A path that was already at the target
       value comes back as `unchanged`, which is the difference between
       "I set it" and "it was already like that". */
    const changed = result.changes.filter((c) => !Object.is(c.from, c.to));
    const unchanged = result.changes.filter((c) => Object.is(c.from, c.to)).map((c) => c.path);

    return {
      clipId: id,
      applied: result.applied,
      changes: changed.map((c) => ({ path: c.path, from: c.from, to: c.to })),
      ...(unchanged.length ? { unchanged } : {}),
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
    clipType: z.string().optional().describe(`Only clips of this type. One of: ${CLIP_TYPES.join(', ')}`),
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
      /* An unrecognised type used to filter everything out and report
         "0 clips updated" — success, with nothing done and no clue why. */
      const wanted = oneOf(clipType, CLIP_TYPES, 'clip type');
      const before = targets.length;
      targets = targets.filter((id) => findClipById(state.tracks, id)?.type === wanted);
      if (targets.length === 0) {
        throw new Error(
          `None of the ${before} candidate clip${before === 1 ? '' : 's'} is of type "${wanted}", ` +
          'so nothing was changed.'
        );
      }
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
    if (!effectId) {
      throw new Error(`Could not add "${effectType}" to clip ${id} — the clip was not found.`);
    }
    if (intensity !== undefined) timeline().setEffectIntensity(id, effectId, intensity);
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
    const removed = timeline().removeEffect(id, effect);
    if (removed === 0) {
      const clip = findClipById(timeline().tracks, id);
      const have = clip?.effects.map((e) => `${e.type} (${e.id})`).join(', ') || 'none';
      throw new Error(`No effect "${effect}" on that clip, so nothing was removed. On it: ${have}.`);
    }
    return { clipId: id, removed: effect, count: removed };
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
    const result = timeline().setEffectParam(id, effect, param, value);
    if (!result.ok) throw new Error(result.error ?? `Could not set ${param} on "${effect}".`);
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
    let placed = 0;
    for (const kf of keyframes) {
      if (timeline().addEffectKeyframe(id, effect, param, kf.timeOffsetMs, kf.value)) placed++;
    }
    if (placed === 0) {
      const clip = findClipById(timeline().tracks, id);
      const have = clip?.effects.map((e) => e.type).join(', ') || 'none';
      throw new Error(
        `No effect "${effect}" on that clip, so no keyframes were placed. On it: ${have}. ` +
        'Add the effect first with add_effect.'
      );
    }
    return { clipId: id, effect, param, keyframeCount: placed };
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
  description:
    'Create an animated text layer. Style it afterwards with patch_clip using textStyle.* paths. '
    + 'NOTE: a new layer defaults to CAPTION styling — a 6px black outline (textStyle.strokeWidth) '
    + 'and an 18px drop shadow — because that is what keeps burned-in text legible over footage. On a '
    + 'clean background it is wrong, and at small sizes the outline thickens the letterforms enough to '
    + 'look like a different typeface. Set strokeWidth and shadowBlur to 0 for titles and brand type.',
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

    const warnings: string[] = [];
    if (style) {
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(style)) patch[k.startsWith('textStyle.') ? k : `textStyle.${k}`] = v;

      /* An unavailable family is accepted by the browser and rendered in
         the default face, so the agent would report a font it did not get. */
      const family = patch['textStyle.fontFamily'];
      if (typeof family === 'string' && !isFontAvailable(family)) {
        warnings.push(
          `"${family}" is not installed on this machine, so the text will render in the default face. ` +
          'Call list_fonts to see what is available.'
        );
      }
      state.patchClip(id, patch);
    }
    return { clipId: id, text, ...(warnings.length ? { warnings } : {}) };
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
    easing: z.string().optional().describe(`One of: ${EASINGS.join(', ')}`),
  }),
  handler: ({ clipId, points, orientToPath, closed, easing }) => {
    const id = resolveClipId(clipId);
    timeline().setMotionPath(id, {
      enabled: true,
      points,
      orientToPath: orientToPath ?? false,
      closed: closed ?? false,
      easing: easing ? oneOf(easing, EASINGS, 'easing') : 'easeInOut',
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
    if (!timeline().applyMotionPreset(id, preset as MotionPresetId)) throw new Error(refuseReason(id));
    return { clipId: id, preset };
  },
});

defineTool({
  name: 'add_keyframes',
  category: 'graphics',
  description:
    'Animate a clip property with explicit keyframes. Accepts the transform names ' +
    '(positionX, positionY, scaleX, scaleY, rotation, opacity, anchorX, anchorY, volume) and the ' +
    'dotted paths list_properties reports as animatable — filters.* (brightness, contrast, ' +
    'saturation, exposure, temperature, tint, highlights, shadows, sharpen, vignette, grain, ' +
    'blur, hueRotate), mask.* (sizeX, sizeY, offsetX, offsetY, rotation, roundness, featherPx), ' +
    'textStyle.fontSize, textStyle.letterSpacing, and shapeStyle.* (strokeWidth, trimStart, ' +
    'trimEnd, cornerRadius). transform.x / transform.y and the other patch_clip paths are ' +
    'accepted as aliases. NOTE: this APPENDS — calling it twice on one property stacks both ' +
    'sets and reports success both times.',
  schema: z.object({
    clipId: z.string().optional(),
    property: z.string(),
    keyframes: z.array(
      z.object({
        timeOffsetMs: z.number().describe('Milliseconds from the clip start'),
        value: z.number(),
        easing: z.string().optional().describe(`One of: ${EASINGS.join(', ')}`),
      })
    ).min(1),
  }),
  handler: ({ clipId, property, keyframes }) => {
    /*
      `patch_clip` addresses `transform.x`; keyframes have always called
      the same thing `positionX`. Two names for one property is a trap
      whichever one you learned first, so both are accepted here and
      normalised to the stored name.
    */
    const resolved = KEYFRAME_PATH_ALIASES[property] ?? (property as AnimatableProperty);
    if (!(ANIMATABLE_PROPERTIES as readonly string[]).includes(resolved)) {
      throw new Error(
        `"${property}" is not animatable. Use one of: ${ANIMATABLE_PROPERTIES.join(', ')}`
      );
    }
    const id = resolveClipId(clipId);
    const state = timeline();
    for (const kf of keyframes) {
      state.addKeyframe(id, {
        property: resolved,
        timeOffsetMs: kf.timeOffsetMs,
        value: kf.value,
        easing: kf.easing ? oneOf(kf.easing, EASINGS, 'easing') : 'easeInOut',
      });
    }
    return { clipId: id, property: resolved, count: keyframes.length };
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

/**
 * Why an edit that looked valid did nothing.
 *
 * The store bails silently on a locked clip, a locked track, or a time
 * outside the clip. Those are ordinary situations, not bugs — but every
 * tool here used to return success for them, so an agent reported cuts
 * and deletions that never happened.
 */
function refuseReason(clipId: string, atMs?: number): string {
  const clip = findClipById(timeline().tracks, clipId);
  if (!clip) return `Clip "${clipId}" no longer exists.`;

  const track = timeline().tracks.find((t) => t.id === clip.trackId);
  if (clip.locked) return `"${clip.name}" is locked. Unlock it first.`;
  if (track?.locked) return `Track "${track.name}" is locked. Unlock it first.`;

  if (atMs !== undefined) {
    const start = clip.startTimeMs;
    const end = start + clip.durationMs;
    if (atMs <= start || atMs >= end) {
      return (
        `${atMs}ms is not inside "${clip.name}" (${start}–${end}ms). ` +
        'Move the playhead over the clip, or pass an explicit atMs within it.'
      );
    }
  }
  return 'The editor declined the edit.';
}

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
    const at = atMs ?? state.playheadMs;
    if (!state.splitClip(id, at)) throw new Error(refuseReason(id, at));
    return { clipId: id, splitAtMs: at };
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
    if (!timeline().trimClip(id, newStartMs, newEndMs, ripple)) throw new Error(refuseReason(id));

    /* Report where the clip ACTUALLY landed. Trims are clamped to a
       minimum duration and to zero, so echoing the request back would
       claim a start of -400ms that the store refused. */
    const clip = findClipById(timeline().tracks, id);
    return {
      clipId: id,
      startMs: clip?.startTimeMs,
      endMs: clip ? clip.startTimeMs + clip.durationMs : undefined,
      durationMs: clip?.durationMs,
      ...(newStartMs !== undefined && clip && clip.startTimeMs !== newStartMs
        ? { note: `Start was clamped to ${clip.startTimeMs}ms.` }
        : {}),
    };
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
    if (!state.moveClip(id, tid, startTimeMs)) {
      const target = state.tracks.find((t) => t.id === tid);
      throw new Error(
        target?.locked ? `Track "${target.name}" is locked. Unlock it first.` : refuseReason(id)
      );
    }
    state.commit('Move clip');
    const moved = findClipById(timeline().tracks, id);
    return { clipId: id, trackId: tid, startTimeMs: moved?.startTimeMs ?? startTimeMs };
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
    if (!timeline().deleteClip(id, ripple)) throw new Error(refuseReason(id));
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
    const at = atMs ?? state.playheadMs;
    if (!state.freezeFrame(id, at, holdMs ?? 2000)) throw new Error(refuseReason(id, at));
    return { clipId: id, atMs: at, holdMs: holdMs ?? 2000 };
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
  description:
    'Transcribe the timeline audio with on-device Whisper and lay the result out as a ' +
    'synced caption track. Requires ffmpeg and openai-whisper installed locally — call ' +
    'check_transcription_ready first if you want to know before trying. Never returns ' +
    'invented text: if transcription is unavailable it fails and says why.',
  schema: z.object({
    clipId: z.string().optional().describe('Audio or video clip to transcribe; defaults to the first clip with audio'),
    language: z.string().optional().describe("ISO code such as en, sw, fr. Omit to auto-detect"),
    model: z.string().optional().describe('Whisper model name; defaults to the best one already downloaded'),
    maxCharsPerCue: z.number().optional().describe('Split long sentences to this width; default 42'),
    style: z.record(z.any()).optional(),
  }),
  handler: async ({ clipId, language, model, maxCharsPerCue, style }) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.stt) {
      throw new Error(
        'Transcription needs the desktop app — it shells out to ffmpeg and Whisper, which a browser cannot reach.'
      );
    }

    const state = timeline();

    /* Pick a source: an explicit clip, else the first audio clip, else any
       video clip (its own audio track is what gets transcribed). */
    const source = clipId
      ? findClipById(state.tracks, resolveClipId(clipId))
      : state.tracks
          .filter((t) => t.type === 'audio')
          .flatMap((t) => t.clips)
          .find((c) => c.mediaUrl) ??
        state.tracks
          .filter((t) => t.type === 'video')
          .flatMap((t) => t.clips)
          .find((c) => c.mediaUrl);

    if (!source?.mediaUrl) {
      throw new Error('No clip with audio found on the timeline to transcribe.');
    }

    const result = await api.stt.transcribe({ mediaUrl: source.mediaUrl, language, model });

    if (!result.ok) {
      /*
        Record the miss rather than only reporting it. A missing local
        dependency is exactly the kind of thing that should show up in the
        backlog as "captions did not work for this user", not evaporate.
      */
      useGapStore.getState().record({
        request: 'Automatic captions from speech',
        reason: result.message,
        suggestion:
          result.reason === 'no-whisper' || result.reason === 'no-model'
            ? 'Bundle a Whisper model with Kerf, or ship whisper.cpp, so captions work with no setup'
            : result.reason === 'no-ffmpeg'
              ? 'Bundle an ffmpeg binary with Kerf'
              : undefined,
      });
      throw new Error(result.message);
    }

    if (result.segments.length === 0) {
      throw new Error(
        `No speech was found in "${source.name}". The audio may be music or silence.`
      );
    }

    /* Whisper segments are sentence-ish; split the long ones so a caption
       never overflows the frame. */
    const limit = maxCharsPerCue ?? 42;
    const cues: CaptionCue[] = [];

    for (const seg of result.segments) {
      const text = seg.text.trim();
      if (!text) continue;

      if (text.length <= limit) {
        cues.push({ index: cues.length + 1, startMs: seg.startMs, endMs: seg.endMs, text });
        continue;
      }

      // Split on words, apportioning time by character share.
      const words = text.split(/\s+/);
      const lines: string[] = [];
      let line = '';
      for (const w of words) {
        if ((line + ' ' + w).trim().length > limit && line) {
          lines.push(line.trim());
          line = w;
        } else {
          line = (line + ' ' + w).trim();
        }
      }
      if (line) lines.push(line.trim());

      const span = seg.endMs - seg.startMs;
      const totalChars = lines.reduce((n, l) => n + l.length, 0) || 1;
      let cursor = seg.startMs;
      for (const l of lines) {
        const share = Math.round((l.length / totalChars) * span);
        cues.push({ index: cues.length + 1, startMs: cursor, endMs: cursor + share, text: l });
        cursor += share;
      }
    }

    // Cues are absolute to the media, so offset by where the clip sits.
    const count = state.importCaptions(cues, {
      offsetMs: source.startTimeMs,
      replaceExisting: true,
      style: style as Record<string, unknown> | undefined,
    });

    return {
      cues: count,
      language: result.language,
      model: result.model,
      words: result.words.length,
      elapsedMs: result.elapsedMs,
      source: source.name,
      transcript: result.text.slice(0, 400),
    };
  },
});

defineTool({
  name: 'check_transcription_ready',
  category: 'discovery',
  description:
    'Report whether on-device transcription can run: whether ffmpeg and Whisper are ' +
    'installed and which models are downloaded. Cheap; call before promising captions.',
  schema: z.object({}),
  handler: async () => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.stt) return { ready: false, reason: 'Not running in the desktop app.' };

    const status = await api.stt.status();
    return {
      ready: status.ready,
      ffmpeg: status.ffmpeg ?? 'not found',
      whisper: status.whisper ?? 'not found',
      modelsDownloaded: status.models,
      ...(status.ready
        ? {}
        : {
            fix: !status.ffmpeg
              ? 'brew install ffmpeg'
              : !status.whisper
                ? 'pip install -U openai-whisper'
                : 'Run `whisper --model small <audio file>` once while online to download a model.',
          }),
    };
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

    /* Say how much of this is measurement and how much is the tempo
       estimate filling gaps — a grid that anchored to nothing is a
       metronome, and the caller should be able to tell. */
    const anchoredPct = result.beatsMs.length
      ? Math.round((result.beatsAnchored / result.beatsMs.length) * 100)
      : 0;

    return {
      bpm: Number(result.bpm.toFixed(1)),
      beats: result.beatsMs.length,
      onsetsDetected: result.onsetsDetected,
      beatsOnRealOnsets: result.beatsAnchored,
      confidence: `${anchoredPct}% of the beats sit on a detected onset; the rest are interpolated at the estimated tempo.`,
      cutsSnapped: snapped,
    };
  },
});

defineTool({
  name: 'remove_silence',
  category: 'audio',
  description:
    'Measure the dead air on a track with ffmpeg and cut it out, closing the gaps. ' +
    'The silence is detected from the audio itself, not estimated — call with dryRun ' +
    'first to see what it would cut before it cuts anything.',
  schema: z.object({
    trackId: z.string().optional(),
    silenceThresholdDb: z.number().optional().describe('Below this counts as silence; default -35'),
    minSilenceMs: z.number().optional().describe('Ignore pauses shorter than this; default 400'),
    keepPaddingMs: z
      .number()
      .optional()
      .describe('Leave this much of each pause so speech does not sound clipped; default 120'),
    dryRun: z.boolean().optional().describe('Report what would be cut without changing anything'),
  }),
  handler: async ({ trackId, silenceThresholdDb, minSilenceMs, keepPaddingMs, dryRun }) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.stt) {
      throw new Error('Removing silence needs the desktop app — it measures the audio with ffmpeg.');
    }

    const state = timeline();
    const tid = trackId ? resolveTrackId(trackId) : resolveTrackId('audio');
    const track = state.tracks.find((t) => t.id === tid);
    if (!track) throw new Error(`No track "${tid}".`);

    const sourced = track.clips.filter((c) => c.mediaUrl);
    if (sourced.length === 0) {
      throw new Error(`Track "${track.name}" has no clips with audio to measure.`);
    }

    const padding = keepPaddingMs ?? 120;
    const ranges: { startMs: number; endMs: number }[] = [];
    const measured: { clip: string; silences: number }[] = [];

    for (const clip of sourced) {
      const result = await api.stt.analyze({
        mediaUrl: clip.mediaUrl!,
        silenceThresholdDb,
        minSilenceMs,
      });
      if (!result.ok) throw new Error(result.message);

      const speed = clip.speed?.multiplier ?? 1;
      const clipEnd = clip.startTimeMs + clip.durationMs;
      let kept = 0;

      for (const region of result.silences as { startMs: number; endMs: number }[]) {
        /*
          ffmpeg measures the SOURCE file. Map into timeline time through
          the clip's in-point and speed, then clamp to the clip — a clip
          is usually a window onto a longer recording, and the silence
          outside that window is not on the timeline at all.
        */
        const toTimeline = (sourceMs: number) =>
          clip.startTimeMs + (sourceMs - clip.sourceStartMs) / speed;

        const startMs = Math.max(clip.startTimeMs, toTimeline(region.startMs) + padding);
        const endMs = Math.min(clipEnd, toTimeline(region.endMs) - padding);
        if (endMs - startMs <= 0) continue;

        ranges.push({ startMs, endMs });
        kept++;
      }
      measured.push({ clip: clip.name, silences: kept });
    }

    const wouldRemoveMs = ranges.reduce((n, r) => n + (r.endMs - r.startMs), 0);

    if (dryRun) {
      return {
        dryRun: true,
        trackId: tid,
        track: track.name,
        measured,
        cuts: ranges.length,
        wouldRemoveMs: Math.round(wouldRemoveMs),
        wouldRemoveSeconds: Number((wouldRemoveMs / 1000).toFixed(2)),
        ranges: ranges.slice(0, 40).map((r) => ({ startMs: Math.round(r.startMs), endMs: Math.round(r.endMs) })),
      };
    }

    if (ranges.length === 0) {
      return {
        trackId: tid,
        track: track.name,
        measured,
        removedMs: 0,
        removedSeconds: 0,
        note: 'No silence long enough to cut was found. Try a higher silenceThresholdDb or a shorter minSilenceMs.',
      };
    }

    const { removedMs, clipsAffected } = state.removeRanges(tid, ranges);
    return {
      trackId: tid,
      track: track.name,
      measured,
      cuts: ranges.length,
      clipsAffected,
      removedMs: Math.round(removedMs),
      removedSeconds: Number((removedMs / 1000).toFixed(2)),
    };
  },
});

defineTool({
  name: 'suggest_broll',
  category: 'ai',
  description:
    'Match the caption text against the names and transcripts of the media already in the ' +
    'project, and propose cutaways where a line and an asset agree. Only ever suggests media ' +
    'the project actually contains — Kerf has no stock library — and says which word matched ' +
    'what, so the basis is checkable. Returns nothing rather than guessing.',
  schema: z.object({ insert: z.boolean().optional().describe('Also place the suggestions on the overlay track') }),
  handler: ({ insert }) => {
    const state = timeline();
    const report = analyzeTranscriptForBroll(state.tracks, state.mediaPool);

    if (report.suggestions.length === 0) {
      /* A tool that cannot do the job says so and records why, instead of
         returning a confident list of irrelevant stock footage. */
      useGapStore.getState().record({
        request: 'Suggest B-roll cutaways for the dialogue',
        reason: report.note ?? 'Nothing in the media pool matched the captions.',
        suggestion: 'A searchable stock library, or embedding-based matching instead of word overlap',
      });
      return { count: 0, inserted: false, suggestions: [], note: report.note, unmatchedWords: report.unmatched };
    }

    let inserted = 0;
    if (insert) {
      const overlay = state.tracks.find((t) => t.type === 'overlay') ?? state.tracks[0];
      for (const suggestion of report.suggestions) {
        const clipId = state.insertClip(overlay.id, suggestion.mediaAsset, suggestion.startTimeMs);
        if (clipId) {
          state.patchClip(clipId, { durationMs: suggestion.durationMs });
          inserted++;
        }
      }
    }

    return {
      count: report.suggestions.length,
      inserted,
      suggestions: report.suggestions.map((x) => ({
        asset: x.mediaAsset.name,
        atMs: x.startTimeMs,
        durationMs: x.durationMs,
        matchedWord: x.keyword,
        reason: x.reason,
      })),
      ...(report.unmatched.length ? { unmatchedWords: report.unmatched } : {}),
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
    if (fps !== undefined) {
      /*
        `fps as 24 | 30 | 60` accepted 25, 29.97, anything. It landed in
        the project, and every consumer that switches on the three
        supported rates then fell through its cases.
      */
      if (!(FPS_VALUES as readonly number[]).includes(fps)) {
        throw new Error(`Kerf renders at ${FPS_VALUES.join(', ')} fps. "${fps}" is not one of them.`);
      }
      proj.setFps(fps as (typeof FPS_VALUES)[number]);
    }
    if (backgroundColor) proj.setBackgroundColor(backgroundColor);
    if (name) proj.setProjectName(name);

    /*
      Read the state AFTER the writes. `proj` is a snapshot taken before
      them, so returning `proj.project` reported the values the canvas
      used to have — asking for 9:16 answered "16:9" while the preview
      correctly went vertical.
    */
    const after = project().project;
    return {
      aspectRatio: after.aspectRatio,
      fps: after.fps,
      width: after.width,
      height: after.height,
      backgroundColor: after.backgroundColor,
      name: after.name,
    };
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

/**
 * Bring a file on disk into the media pool.
 *
 * Shared by `import_media_from_path` and `ffmpeg_process`, which would
 * otherwise each have their own copy of the URL encoding and the probe —
 * and the encoding is the sort of detail that gets fixed in one of two
 * places.
 */
async function importMediaFromPath(
  filePath: string,
  name?: string
): Promise<MediaAsset & { decoded: boolean; undecodableReason?: string }> {
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
  /*
    The asset is still added when it could not be decoded — refusing it
    outright would be worse, since the file may be perfectly good and only
    unsupported by Chromium, and `ffmpeg_process` can still transcode it
    into something that plays. What must not happen is reporting a clean
    import. The flag rides along so the tool can say so.
  */
  return { ...asset, decoded: probed.decoded, undecodableReason: probed.reason };
}

const FFMPEG_OPERATIONS = [
  'stabilize', 'interpolate', 'denoise', 'sharpen', 'deflicker',
  'reverse', 'speed', 'lut', 'extract_audio', 'custom',
] as const;

defineTool({
  name: 'ffmpeg_process',
  category: 'media',
  description:
    'Pre-render a media file through ffmpeg and import the result as a new asset. This is how ' +
    'Kerf does the things the real-time compositor cannot: stabilise shaky footage, interpolate ' +
    'to a higher frame rate, denoise, reverse, apply a .cube LUT. It writes a new file and leaves ' +
    'the original untouched, so it is safe to try. Slower than real time on long clips — say so ' +
    'before starting one. Operations: ' + FFMPEG_OPERATIONS.join(', ') + '. `custom` takes a raw ' +
    'ffmpeg filtergraph in `filtergraph`, which is the escape hatch for anything not listed.',
  schema: z.object({
    source: z.string().optional()
      .describe('Clip id, media asset id or name, or an absolute path. Defaults to the selected clip.'),
    operation: z.string().describe(`One of: ${FFMPEG_OPERATIONS.join(', ')}`),
    filtergraph: z.string().optional().describe('For operation "custom": a raw -vf filtergraph'),
    audioFiltergraph: z.string().optional().describe('For operation "custom": a raw -af filtergraph'),
    fps: z.number().optional().describe('Target rate for "interpolate"'),
    amount: z.number().optional().describe('0..100 strength, where the operation takes one'),
    speed: z.number().optional().describe('Multiplier for "speed"; 0.5 is half, 2 is double'),
    lutPath: z.string().optional().describe('Absolute path to a .cube file for "lut"'),
    replaceClip: z.boolean().optional()
      .describe('Point the source clip at the processed file instead of only importing it'),
  }),
  handler: async ({ source, operation, filtergraph, audioFiltergraph, fps, amount, speed, lutPath, replaceClip }) => {
    const api = (window as any).electronAPI;
    if (!api?.ffmpeg?.process) throw new Error('ffmpeg processing needs the desktop bridge.');

    const op = oneOf(operation, FFMPEG_OPERATIONS as unknown as string[], 'operation');
    const state = timeline();

    /* Resolve the source to a URL: a clip, a pool asset, or a path. */
    let input: string | null = null;
    let label = 'processed';
    let sourceClipId: string | null = null;

    if (source && /^(\/|file:|https?:)/.test(source)) {
      input = source;
      label = source.split('/').pop() ?? 'processed';
    } else {
      const clip = source
        ? findClipById(state.tracks, resolveClipId(source))
        : findClipById(state.tracks, resolveClipId(undefined));
      if (clip?.mediaUrl) {
        input = clip.mediaUrl;
        label = clip.name;
        sourceClipId = clip.id;
      } else if (source) {
        const asset = state.mediaPool.find((a) => a.id === source)
          ?? state.mediaPool.find((a) => a.name.toLowerCase().includes(source.toLowerCase()));
        if (asset) { input = asset.url; label = asset.name; }
      }
    }
    if (!input) throw new Error('No media source to process. Pass a clip id, an asset name, or an absolute path.');

    const strength = Math.max(0, Math.min(100, amount ?? 50)) / 100;
    let vf: string | undefined;
    let af: string | undefined;
    let audioOnly = false;
    let outFps: number | undefined;

    switch (op) {
      case 'stabilize': {
        /* libvidstab is not in every ffmpeg build; `deshake` is, and it
           needs no analysis pass.

           `rx` and `ry` MUST be multiples of 16. ffmpeg's own help says
           "from 0 to 64" and says nothing about the step, so the filter
           accepts the value and then refuses to initialise with
           "Error opening output files: Not yet implemented in FFmpeg,
           patches welcome" — which names neither the filter nor the
           parameter. */
        const search = Math.max(16, Math.min(64, Math.round((16 + strength * 48) / 16) * 16));
        vf = `deshake=rx=${search}:ry=${search}:edge=3`;
        break;
      }
      case 'interpolate':
        outFps = fps ?? 60;
        vf = `minterpolate=fps=${outFps}:mi_mode=mci:mc_mode=aobmc:vsbmc=1`;
        break;
      case 'denoise':
        vf = `hqdn3d=${(strength * 8).toFixed(1)}:${(strength * 6).toFixed(1)}:${(strength * 12).toFixed(1)}:${(strength * 9).toFixed(1)}`;
        af = 'afftdn=nf=-25';
        break;
      case 'sharpen':
        vf = `unsharp=5:5:${(strength * 2).toFixed(2)}:5:5:0`;
        break;
      case 'deflicker':
        vf = 'deflicker=mode=pm:size=10';
        break;
      case 'reverse':
        vf = 'reverse';
        af = 'areverse';
        break;
      case 'speed': {
        const mult = Math.max(0.1, Math.min(10, speed ?? 2));
        vf = `setpts=${(1 / mult).toFixed(5)}*PTS`;
        /* atempo only spans 0.5..2.0 per stage, so a bigger change chains. */
        const stages: number[] = [];
        let remaining = mult;
        while (remaining > 2) { stages.push(2); remaining /= 2; }
        while (remaining < 0.5) { stages.push(0.5); remaining /= 0.5; }
        stages.push(remaining);
        af = stages.map((x) => `atempo=${x.toFixed(5)}`).join(',');
        break;
      }
      case 'lut': {
        if (!lutPath) throw new Error('operation "lut" needs `lutPath` — an absolute path to a .cube file.');
        /* `lut` used to be a free-form string on ClipFilters with no
           vocabulary, no UI and no renderer, and was removed for it.
           This is the version that actually applies one. */
        vf = `lut3d=file='${lutPath.replace(/'/g, "\\'")}'`;
        break;
      }
      case 'extract_audio':
        audioOnly = true;
        break;
      case 'custom':
        if (!filtergraph && !audioFiltergraph) {
          throw new Error('operation "custom" needs `filtergraph` and/or `audioFiltergraph`.');
        }
        vf = filtergraph;
        af = audioFiltergraph;
        break;
    }

    const result = await api.ffmpeg.process({
      input, vf, af, fps: outFps, audioOnly, name: `${label}-${op}`,
    });
    if (!result.ok) throw new Error(`ffmpeg could not process it: ${result.error}`);

    const imported = await importMediaFromPath(result.path, `${label} (${op})`);

    if (replaceClip && sourceClipId) {
      state.patchClip(sourceClipId, { mediaUrl: imported.url });
      timeline().commit(`Process ${label} (${op})`);
    }

    return {
      operation: op,
      outputPath: result.path,
      bytes: result.bytes,
      sizeMb: Number(((result.bytes ?? 0) / 1024 / 1024).toFixed(2)),
      assetId: imported.id,
      name: imported.name,
      durationMs: imported.durationMs,
      filtergraph: vf ?? af ?? '(none)',
      ...(replaceClip && sourceClipId ? { replacedClip: sourceClipId } : {}),
    };
  },
});

defineTool({
  name: 'open_project',
  category: 'project',
  description:
    'Open a Kerf project file (.kerf / .json) from an absolute path, replacing whatever is ' +
    'currently open. Reports whether the file had to be upgraded from an older project format, ' +
    'and which media could not be relinked. Refuses a file written by a NEWER Kerf rather than ' +
    'loading it partially. Destructive to the current project.',
  schema: z.object({
    path: z.string().describe('Absolute path to the project file'),
  }),
  handler: async ({ path: filePath }) => {
    const api = (window as any).electronAPI;
    if (!api?.project?.read) throw new Error('Reading project files needs the desktop bridge.');
    const read = await api.project.read(filePath);
    if (!read.ok) throw new Error(read.error ?? 'Could not read that file.');

    const result = deserializeProject(read.json);
    if (!result.ok) throw new Error(result.error ?? 'Could not open that project.');

    const t = timeline();
    const p = project().project;
    return {
      opened: filePath,
      name: p.name,
      tracks: t.tracks.length,
      clips: t.tracks.reduce((n, tr) => n + tr.clips.length, 0),
      durationMs: p.durationMs,
      width: p.width,
      height: p.height,
      fps: p.fps,
      ...(result.migratedFrom !== undefined ? { migratedFromFormat: result.migratedFrom } : {}),
      ...(result.relinkNeeded?.length ? { relinkNeeded: result.relinkNeeded } : {}),
    };
  },
});

defineTool({
  name: 'reset_project',
  category: 'project',
  description:
    'Clear the timeline back to an empty project — every track, clip and marker — and ' +
    'optionally set the canvas in the same call. Use before building a sequence from scratch, ' +
    'so an agent starts from a known state rather than on top of whatever was already open. ' +
    'This is destructive and is NOT undoable past the commit it makes; ask first unless the ' +
    'user asked for a new project.',
  schema: z.object({
    name: z.string().optional(),
    aspectRatio: z.string().optional(),
    fps: z.number().optional(),
    backgroundColor: z.string().optional(),
    durationMs: z.number().optional(),
  }),
  handler: ({ name, aspectRatio, fps, backgroundColor, durationMs }) => {
    const before = timeline();
    const clearedTracks = before.tracks.length;
    const clearedClips = before.tracks.reduce((n, t) => n + t.clips.length, 0);

    before.loadProject([], []);

    const proj = project();
    if (name) proj.setProjectName(name);
    if (aspectRatio) {
      proj.setAspectRatio(
        oneOf(aspectRatio, Object.keys(ASPECT_DIMENSIONS) as AspectRatio[], 'aspect ratio')
      );
    }
    if (fps !== undefined) {
      if (!(FPS_VALUES as readonly number[]).includes(fps)) {
        throw new Error(`Kerf renders at ${FPS_VALUES.join(', ')} fps. "${fps}" is not one of them.`);
      }
      proj.setFps(fps as (typeof FPS_VALUES)[number]);
    }
    if (backgroundColor) proj.setBackgroundColor(backgroundColor);
    if (durationMs !== undefined) proj.setDurationMs(Math.max(100, durationMs));

    timeline().setPlayheadMs(0);
    timeline().commit('Reset project');

    const p = project().project;
    return {
      clearedTracks,
      clearedClips,
      project: {
        name: p.name,
        aspectRatio: p.aspectRatio,
        width: p.width,
        height: p.height,
        fps: p.fps,
        backgroundColor: p.backgroundColor,
        durationMs: p.durationMs,
      },
    };
  },
});

defineTool({
  name: 'open_starter_project',
  category: 'project',
  description:
    "Build Kerf's bundled starter project — the brand film — into the timeline, replacing " +
    'whatever is open. It is constructed in code from ordinary shapes, text and keyframes, so ' +
    'it is also a worked example to read and edit. Destructive to the current project.',
  schema: z.object({}),
  handler: () => {
    buildStarterProject();
    const t = timeline();
    const p = project().project;
    return {
      name: STARTER_NAME,
      tracks: t.tracks.length,
      clips: t.tracks.reduce((n, tr) => n + tr.clips.length, 0),
      durationMs: p.durationMs,
      width: p.width,
      height: p.height,
      fps: p.fps,
    };
  },
});

/* ═══════════════════════════════════════════════════════════════════
   ALTITUDE — one call where the agent used to improvise six and check

   Rule of thumb from HANDOVER §5: if the agent needed more than six
   calls and a verification step, it should have been one tool. All the
   logic lives in `src/engine/{lookPresets,batchApply,pictureInPicture}.ts`;
   these blocks are argument validation and reporting.
   ═══════════════════════════════════════════════════════════════════ */

defineTool({
  name: 'apply_look_preset',
  category: 'effects',
  description:
    'Apply a named colour grade across many clips in one call. Presets: '
    + LOOK_PRESETS.map((p) => `${p.id} (${p.description})`).join(' · ')
    + '. Every value is a filters.* path the compositor is proven to render — nothing here is '
    + 'stored-but-inert. Returns the exact grade, which clips got it, which were skipped and why, '
    + 'and what must change in the rendered frame if it worked, so you can check it with '
    + 'get_frame_context instead of trusting this result.',
  schema: z.object({
    preset: z.string().describe(`One of: ${lookPresetIds().join(', ')}`),
    strength: z.number().min(0).max(2).optional()
      .describe('Scales the whole grade. 1 = as designed, 0.5 = half, 0 = neutral. Default 1.'),
    mode: z.enum(['replace', 'additive']).optional()
      .describe('replace (default) writes all 13 filters so two looks cannot compound invisibly; '
        + 'additive adds the preset on top of whatever grade is already there'),
    clipIds: z.array(z.string()).optional().describe('Explicit clips; overrides every other selector'),
    tracks: z.array(z.string()).optional().describe('Track ids or names'),
    clipTypes: z.array(z.string()).optional()
      .describe(`Override the default (video, image, sticker). One of: ${CLIP_TYPES.join(', ')}`),
    nameMatch: z.string().optional().describe('Substring, or /regex/ with slashes'),
    startMs: z.number().optional(),
    endMs: z.number().optional(),
    selectedOnly: z.boolean().optional(),
    includeLocked: z.boolean().optional().describe('Grade locked clips too. Default false.'),
  }),
  handler: (a) => {
    const preset = getLookPreset(a.preset);
    if (!preset) {
      throw new Error(
        `Kerf has no look preset called "${a.preset}". Available: `
        + LOOK_PRESETS.map((p) => `${p.id} — ${p.label}`).join(', ') + '.'
      );
    }
    const strength = a.strength ?? 1;
    const gradableTypes = a.clipTypes?.map((t) => oneOf(t, CLIP_TYPES, 'clip type'));

    const state = timeline();
    const selection = selectClips(state.tracks, state.selectedClipIds, {
      clipIds: a.clipIds?.map((r) => resolveClipId(r)),
      tracks: a.tracks,
      /* The type filter is applied by the GRADER, not by the selector:
         a clip excluded by the selector is reported as "did not match",
         which is true but useless when the real answer is "a text clip
         cannot draw a temperature wash". */
      nameMatch: a.nameMatch,
      startMs: a.startMs,
      endMs: a.endMs,
      selectedOnly: a.selectedOnly,
    });

    if (selection.matched.length === 0) {
      throw new Error(
        `No clip matched, so nothing was graded. ${selection.totalClips} clip(s) were examined; `
        + selection.predicates.map((p) => `${p.predicate}="${p.value}" excluded ${p.excluded}`).join(', ')
        + '.'
      );
    }

    const result = applyLookToClips(
      preset,
      selection.matched,
      { strength, mode: a.mode ?? 'replace', includeLocked: a.includeLocked === true, gradableTypes },
      (id, values) => timeline().patchClip(id, values)
    );

    if (result.appliedTo === 0) {
      throw new Error(
        `"${preset.id}" reached no clip. ${result.skipped.length} candidate(s) were skipped: `
        + result.skipped.map((s) => `${s.name} — ${s.reason}`).join('; ')
      );
    }

    return {
      ...result,
      examined: selection.totalClips,
      matched: selection.matched.length,
      rejectedByPredicate: selection.rejected.length,
      predicates: selection.predicates,
      verifyWith:
        'get_frame_context({ includeImage: true }) — wait for mediaPending: 0, then check the '
        + '`expect` rows above against the picture.',
    };
  },
});

defineTool({
  name: 'batch_apply',
  category: 'properties',
  description:
    'Apply the same property patch to every clip matching a predicate — track, type, name, time '
    + 'range or selection — in one call. Unlike patch_clips it reports EVERY clip individually: '
    + 'the ones it changed with before/after values, the ones it matched but did not write and why '
    + '(locked clip, locked track, no valid property for that clip type), and the ones the predicate '
    + 'excluded with the predicate that did it. Locked clips are skipped by default; patch_clip '
    + 'writes straight through a lock. Use dryRun to see the plan before committing to it.',
  schema: z.object({
    properties: z.record(z.any()).describe('Map of property path → value, same paths as patch_clip'),
    clipIds: z.array(z.string()).optional().describe('Explicit clips; overrides every other selector'),
    tracks: z.array(z.string()).optional().describe('Track ids or names'),
    clipTypes: z.array(z.string()).optional().describe(`One of: ${CLIP_TYPES.join(', ')}`),
    nameMatch: z.string().optional().describe('Substring (case-insensitive), or /regex/ with slashes'),
    startMs: z.number().optional().describe('Start of the time window, ms'),
    endMs: z.number().optional().describe('End of the time window, ms'),
    timeMode: z.enum(['overlap', 'contained']).optional()
      .describe('overlap (default) takes any clip touching the window; contained needs it wholly inside'),
    selectedOnly: z.boolean().optional().describe('Restrict to the current selection'),
    relative: z.boolean().optional().describe('Treat numbers as deltas on each clip\'s current value'),
    dryRun: z.boolean().optional().describe('Report what WOULD change without writing anything'),
    includeLocked: z.boolean().optional().describe('Write through locks. Default false.'),
    includeHidden: z.boolean().optional().describe('Default true — hidden clips are still edited.'),
    limit: z.number().int().min(1).optional().describe('Stop after this many clips; the rest are reported as skipped'),
  }),
  handler: (a) => {
    if (Object.keys(a.properties).length === 0) {
      throw new Error('batch_apply needs at least one property. Nothing was changed.');
    }
    const state = timeline();
    const selection = selectClips(state.tracks, state.selectedClipIds, {
      clipIds: a.clipIds?.map((r) => resolveClipId(r)),
      tracks: a.tracks,
      clipTypes: a.clipTypes?.map((t) => oneOf(t, CLIP_TYPES, 'clip type')),
      nameMatch: a.nameMatch,
      startMs: a.startMs,
      endMs: a.endMs,
      timeMode: a.timeMode,
      selectedOnly: a.selectedOnly,
    });

    if (selection.matched.length === 0) {
      /* "0 clips updated" with no reason is the failure mode this whole
         tool is a reaction to, so an empty match is an error carrying the
         arithmetic that produced it. */
      throw new Error(
        `No clip matched, so nothing was changed. ${selection.totalClips} clip(s) examined; `
        + (selection.predicates.length
          ? selection.predicates.map((p) => `${p.predicate}="${p.value}" excluded ${p.excluded}`).join(', ')
          : 'the project has no clips')
        + '.'
      );
    }

    return runBatchApply(selection, a.properties, {
      relative: a.relative,
      dryRun: a.dryRun,
      includeLocked: a.includeLocked,
      includeHidden: a.includeHidden,
      limit: a.limit,
    }, (id, values) => timeline().patchClip(id, values));
  },
});

defineTool({
  name: 'create_picture_in_picture',
  category: 'graphics',
  description:
    'Place one clip as an inset over another — corner or explicit position, size as a fraction of '
    + 'the frame, optional border, corner radius and drop shadow. The inset is scaled UNIFORMLY from '
    + 'its own source aspect ratio, so a portrait source in a landscape sequence is letterboxed by '
    + 'size rather than squashed to fit. Returns the measured box in project pixels and as a '
    + 'percentage of the frame, plus where the aspect ratio came from — if the media has not decoded '
    + 'yet that is said out loud rather than guessed.',
  schema: z.object({
    insetClipId: z.string().optional().describe('An existing clip to turn into the inset'),
    insetAssetId: z.string().optional().describe('Media-pool asset id or name; inserted on a new top track'),
    backgroundClipId: z.string().optional()
      .describe('The clip the inset sits over. Omit to detect the bottom-most visible clip at the inset\'s start.'),
    corner: z.enum(PIP_CORNERS).optional().describe('Default top-right'),
    positionPct: z.object({ x: z.number(), y: z.number() }).optional()
      .describe('Inset CENTRE as a percentage of frame width/height. Overrides corner.'),
    sizePct: z.number().min(2).max(100).optional().describe('Inset width as % of frame width. Default 30.'),
    marginPct: z.number().min(0).max(45).optional()
      .describe('Gap from the frame edge as % of the frame\'s short edge. Default 4.'),
    maxHeightPct: z.number().min(5).max(100).optional()
      .describe('Ceiling on inset height as % of frame height. Default 80 — a tall source honours this over sizePct.'),
    startTimeMs: z.number().optional().describe('Defaults to the background clip\'s start, else the playhead'),
    durationMs: z.number().optional().describe('Defaults to the background clip\'s duration'),
    cornerRadiusPx: z.number().min(0).optional().describe('Rounded corners, in project pixels'),
    border: z.object({
      widthPx: z.number().min(0),
      color: z.string().optional(),
    }).optional(),
    shadow: z.object({
      blurPx: z.number().min(0),
      opacity: z.number().min(0).max(100).optional(),
      offsetX: z.number().optional(),
      offsetY: z.number().optional(),
      color: z.string().optional(),
    }).optional().describe('Cannot be combined with cornerRadiusPx — the mask clips the shadow away'),
    muteInsetAudio: z.boolean().optional().describe('Default true; two beds at once is almost never wanted'),
    name: z.string().optional(),
  }),
  handler: (a) => {
    const proj = project().project;
    let state = timeline();

    if (!a.insetClipId && !a.insetAssetId) {
      throw new Error('Pass insetClipId (an existing clip) or insetAssetId (a media-pool asset). Nothing was changed.');
    }
    if (a.insetClipId && a.insetAssetId) {
      throw new Error('Pass either insetClipId or insetAssetId, not both.');
    }

    /* ── the background, resolved BEFORE anything is inserted ──────
       Once the inset exists it is itself a candidate, and "the clip
       under the playhead" would happily return the inset. */
    const wantedStart = a.startTimeMs;
    let background: { clip: Clip; trackIndex: number; trackName: string } | null = null;
    if (a.backgroundClipId) {
      const id = resolveClipId(a.backgroundClipId);
      for (const t of state.tracks) {
        const c = t.clips.find((x) => x.id === id);
        if (c) background = { clip: c, trackIndex: t.index, trackName: t.name };
      }
    } else {
      const at = wantedStart ?? state.playheadMs;
      const candidates: { clip: Clip; trackIndex: number; trackName: string }[] = [];
      for (const t of state.tracks) {
        if (t.type === 'audio') continue;
        for (const c of t.clips) {
          if (c.type === 'audio' || c.hidden) continue;
          if (at >= c.startTimeMs && at < c.startTimeMs + c.durationMs) {
            candidates.push({ clip: c, trackIndex: t.index, trackName: t.name });
          }
        }
      }
      /* Highest track index paints FIRST, so it is the bottom layer —
         which is the one a PiP sits over. */
      candidates.sort((x, y) => y.trackIndex - x.trackIndex);
      background = candidates[0] ?? null;
    }

    const startTimeMs = a.startTimeMs ?? background?.clip.startTimeMs ?? state.playheadMs;

    /* ── the inset ─────────────────────────────────────────────── */
    let insetId: string;
    let insetTrackId: string;
    let createdTrack = false;
    if (a.insetAssetId) {
      const ref = a.insetAssetId;
      const asset =
        state.mediaPool.find((m) => m.id === ref) ??
        state.mediaPool.find((m) => m.name.toLowerCase().includes(ref.toLowerCase()));
      if (!asset) {
        throw new Error(
          `No media asset "${ref}". In the pool: ${state.mediaPool.map((m) => m.name).join(', ') || 'nothing'}.`
        );
      }
      if (asset.type === 'audio') {
        throw new Error(`"${asset.name}" is an audio asset and cannot be a picture-in-picture inset.`);
      }
      // A new track unshifts to index 0, which is the top of the stack.
      insetTrackId = state.addTrack('video', a.name ?? 'PiP');
      createdTrack = true;
      insetId = timeline().insertClip(insetTrackId, asset, startTimeMs);
    } else {
      insetId = resolveClipId(a.insetClipId);
      const found = timeline().tracks.find((t) => t.clips.some((c) => c.id === insetId));
      if (!found) throw new Error(`Clip "${insetId}" disappeared mid-operation.`);
      insetTrackId = found.id;
    }

    state = timeline();
    if (background && background.clip.id === insetId) {
      throw new Error('The inset and the background resolved to the same clip. Pass backgroundClipId explicitly.');
    }

    const insetTrack = state.tracks.find((t) => t.id === insetTrackId)!;
    let clip = findClipById(state.tracks, insetId);
    if (!clip) throw new Error(`Clip "${insetId}" disappeared mid-operation.`);

    const warnings: string[] = [];
    if (clip.locked || insetTrack.locked) {
      throw new Error(
        `The inset clip${insetTrack.locked ? '\'s track' : ''} is locked, so nothing was moved. Unlock it first.`
      );
    }

    /* ── geometry ──────────────────────────────────────────────── */
    const geometry = computePipGeometry({
      project: proj,
      clip,
      natural: getNaturalSize(clip),
      sizePct: a.sizePct ?? 30,
      marginPct: a.marginPct ?? 4,
      maxHeightPct: a.maxHeightPct ?? 80,
      corner: a.corner,
      positionPct: a.positionPct,
    });
    warnings.push(...geometry.warnings);

    const durationMs = a.durationMs ?? background?.clip.durationMs;
    const patch = buildPipPatch(geometry, {
      cornerRadiusPx: a.cornerRadiusPx,
      border: a.border ? { widthPx: a.border.widthPx, color: a.border.color ?? '#ffffff' } : undefined,
      shadow: a.shadow
        ? {
            blurPx: a.shadow.blurPx,
            opacity: a.shadow.opacity ?? 60,
            offsetX: a.shadow.offsetX,
            offsetY: a.shadow.offsetY,
            color: a.shadow.color,
          }
        : undefined,
    }, {
      name: a.name,
      startTimeMs,
      durationMs,
      muteAudio: a.muteInsetAudio !== false,
    });
    warnings.push(...patch.warnings);

    const applied = timeline().patchClip(insetId, patch.properties);
    if (applied.applied.length === 0) {
      throw new Error(`Nothing could be written to the inset: ${applied.errors.join('; ')}`);
    }
    if (applied.errors.length > 0) warnings.push(...new Set(applied.errors));

    /* Re-running the tool must not stack a second border on the first. */
    const removedEffects: string[] = [];
    for (const type of ['outline', 'drop_shadow']) {
      if (timeline().removeEffect(insetId, type) > 0) removedEffects.push(type);
    }
    const addedEffects: string[] = [];
    for (const fx of patch.effects) {
      const id = timeline().addEffect(insetId, fx.type, fx.params);
      if (id) addedEffects.push(fx.type);
      else warnings.push(`Could not add the ${fx.type} effect to the inset.`);
    }

    /* ── z-order, measured rather than assumed ─────────────────── */
    const finalState = timeline();
    const finalInsetTrack = finalState.tracks.find((t) => t.id === insetTrackId)!;
    let bgIndex: number | null = null;
    if (background) {
      for (const t of finalState.tracks) {
        if (t.clips.some((c) => c.id === background!.clip.id)) bgIndex = t.index;
      }
    }
    const insetOnTop = bgIndex === null ? null : finalInsetTrack.index < bgIndex;
    if (insetOnTop === false) {
      warnings.push(
        `The inset is on track index ${finalInsetTrack.index} and the background is on ${bgIndex}. `
        + 'Lower indices paint on top, so the inset will render BEHIND the background. '
        + 'Move it to a track above, or pass insetAssetId to have one made.'
      );
    }
    if (background === null) {
      warnings.push(
        'No background clip was visible at the inset\'s start time, so the inset is over the project '
        + 'background colour and its timing was not aligned to anything.'
      );
    }

    clip = findClipById(finalState.tracks, insetId)!;

    return {
      clipId: insetId,
      trackId: insetTrackId,
      trackCreated: createdTrack,
      name: clip.name,
      backgroundClipId: background?.clip.id ?? null,
      backgroundName: background?.clip.name ?? null,
      insetOnTop,
      startTimeMs,
      durationMs: clip.durationMs,
      placement: a.positionPct ? 'explicit' : (a.corner ?? 'top-right'),
      /* Everything a caller needs to check the picture without a second
         round trip — the same numbers `get_frame_context` reports as
         layer bounds. */
      box: {
        widthPx: Math.round(geometry.width),
        heightPx: Math.round(geometry.height),
        centerXPx: Math.round(geometry.centerX),
        centerYPx: Math.round(geometry.centerY),
        leftPx: Math.round(geometry.centerX - geometry.width / 2),
        topPx: Math.round(geometry.centerY - geometry.height / 2),
        widthPctOfFrame: Math.round((geometry.width / proj.width) * 1000) / 10,
        heightPctOfFrame: Math.round((geometry.height / proj.height) * 1000) / 10,
        marginPx: Math.round(geometry.marginPx),
      },
      aspect: {
        source: Math.round(geometry.sourceAspect * 1000) / 1000,
        rendered: Math.round(geometry.renderedAspect * 1000) / 1000,
        knownFrom: geometry.aspectSource,
        uniformScale: geometry.scaleX === geometry.scaleY,
      },
      transform: {
        x: geometry.transformX, y: geometry.transformY,
        scaleX: Math.round(geometry.scaleX * 10000) / 10000,
        scaleY: Math.round(geometry.scaleY * 10000) / 10000,
        fitMode: PIP_FIT_MODE,
      },
      ...(geometry.constrainedBy ? { constrainedBy: geometry.constrainedBy } : {}),
      effects: addedEffects,
      ...(removedEffects.length ? { replacedEffects: removedEffects } : {}),
      cornerRadiusPx: a.cornerRadiusPx ?? 0,
      /* Every path this call wrote, so "it reported a box" and "it moved
         the clip" are separable facts. `mask.enabled` is always written —
         to false when there is no corner radius — because a PiP must not
         inherit a mask the clip happened to be carrying. */
      propertiesWritten: applied.applied,
      ...(warnings.length ? { warnings } : {}),
    };
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
  description:
    'Render the sequence to a real video file on disk with ffmpeg, picture and sound. Returns ' +
    'the path, the byte size and the frame count measured from the file that was written, so a ' +
    'successful result means a file exists. Roughly real-time or better; 4K is several times ' +
    'that. Tell the user before starting a long one.',
  schema: z.object({
    resolution: z.enum(['720p', '1080p', '1440p', '4k']).optional()
      .describe('Short edge of the output; the aspect follows the project. 1440p is "2K".'),
    fps: z.number().optional(),
    codec: z.enum(['h264', 'hevc', 'prores']).optional(),
    outputPath: z
      .string()
      .optional()
      .describe('Absolute destination path, or a bare filename placed in ~/Movies'),
    durationMs: z
      .number()
      .optional()
      .describe('Render only this much of the timeline; defaults to the whole sequence'),
    hardware: z
      .boolean()
      .optional()
      .describe('Use Apple VideoToolbox where the codec supports it — much faster, slightly larger'),
  }),
  handler: async ({ resolution, fps, codec, outputPath, hardware, durationMs }) => {
    const proj = project();
    proj.setExportModalOpen(true);
    proj.setIsExporting(true);
    try {
      const result = await runHardwareExport(
        timeline().tracks,
        proj.project,
        {
          resolution: resolution ?? '1080p',
          fps: (fps ?? proj.project.fps) as 30 | 60,
          codec: codec ?? 'h264',
          outputPath,
          durationMs,
          hardware,
        },
        (progress, statusText) => proj.setExportProgress(progress, statusText)
      );
      proj.setLastExportPath(result.outputPath);

      const notApplied = unsupportedAudioSettings(timeline().tracks);
      for (const note of notApplied) {
        useGapStore.getState().record({
          request: 'Apply per-clip audio processing to the exported render',
          reason: note,
          suggestion: 'Extend the export filtergraph with the per-clip audio chain',
        });
      }

      /*
        A source ffmpeg could not open is dropped so the render still
        completes — but the caller MUST be told, or it reports a silent
        file to the user as a finished job.
      */
      const dropped = result.audio?.dropped ?? [];
      for (const d of dropped) {
        useGapStore.getState().record({
          request: 'Include this audio source in the render',
          reason: `${d.source} could not be read by ffmpeg: ${d.reason}`,
          suggestion: 'Import remote audio to a local file before rendering',
        });
      }

      const warnings = [
        ...notApplied,
        ...(result.audioError ? [result.audioError] : []),
      ];

      return {
        outputPath: result.outputPath,
        bytes: result.bytes,
        sizeMb: Number((result.bytes / 1024 / 1024).toFixed(2)),
        frames: result.frames,
        hasAudio: result.hasAudio,
        audio: result.audio
          ? { requested: result.audio.requested, included: result.audio.included }
          : undefined,
        elapsedMs: result.elapsedMs,
        ...(result.timing ? { timing: result.timing } : {}),
        ...(warnings.length ? { warnings } : {}),
        ...(warnings.length
          ? { tellTheUser: 'This render is not exactly what was asked for — repeat the warnings above to the user.' }
          : {}),
      };
    } finally {
      proj.setIsExporting(false);
    }
  },
});

/* ═══════════════════════════════════════════════════════════════════
   Dispatch
   ═══════════════════════════════════════════════════════════════════ */

export const KERF_TOOLS: readonly KerfTool[] = tools;

export function getTool(name: string): KerfTool | undefined {
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

    /* Let the editor follow the work — real UI state, no simulation. */
    followToolCall(name, parsed.data as Record<string, unknown>, data);
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
  return KERF_TOOLS.map((t) => ({
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

/**
 * Probe a media file in the renderer to learn its real duration/size.
 *
 * `decoded` is the part that matters. Every failure path here used to
 * resolve `{ durationMs: 5000 }` — the same shape a success returns — so
 * a file the browser could not open came back looking like a perfectly
 * ordinary five-second clip. `import_media_from_path` then reported
 * success, the asset went into the pool, and it rendered the
 * compositor's placeholder gradient forever. An agent told a user their
 * footage was imported, and nothing anywhere could have contradicted it.
 *
 * Two values could not express this: a duration is either measured or
 * invented, and the caller has to be able to tell which. Unknown is not
 * the same as absent — the same rule §3 records for every status in this
 * codebase with a loading state.
 */
function probeMedia(url: string, type: ClipType): Promise<{
  durationMs: number;
  width?: number;
  height?: number;
  thumbnailUrl: string;
  /** False when nothing could decode this, so durationMs is a guess. */
  decoded: boolean;
  /** Why it could not be decoded, when it could not. */
  reason?: string;
}> {
  return new Promise((resolve) => {
    // Images have no duration and decode as an <img>.
    if (type === 'image') {
      const img = new Image();
      img.onload = () =>
        resolve({
          durationMs: 5000, width: img.naturalWidth, height: img.naturalHeight,
          thumbnailUrl: url, decoded: true,
        });
      img.onerror = () =>
        resolve({
          durationMs: 5000, thumbnailUrl: '', decoded: false,
          reason: 'the image decoder refused it — wrong extension, or the file is corrupt',
        });
      img.src = url;
      return;
    }

    const el = document.createElement(type === 'audio' ? 'audio' : 'video');
    el.preload = 'metadata';

    let settled = false;
    const done = (ok: boolean, reason?: string) => {
      if (settled) return;
      settled = true;
      /*
        Release the element either way. A failed <video> holds its decoder
        open, and scanning a folder of them leaks one per file — Chromium
        starts logging "Unsupported pixel format" on a loop.
      */
      const release = () => { el.removeAttribute('src'); el.load(); };

      if (!ok) {
        release();
        resolve({ durationMs: 5000, thumbnailUrl: '', decoded: false, reason });
        return;
      }
      const video = el as HTMLVideoElement;
      const measured = Number.isFinite(el.duration);
      const out = {
        durationMs: measured ? Math.round(el.duration * 1000) : 5000,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
        thumbnailUrl: type === 'audio' ? '' : url,
        decoded: true,
        // Metadata arrived but carried no duration — a real case for
        // streams and some fragmented files. Still not a measurement.
        ...(measured ? {} : { decoded: false, reason: 'metadata carried no duration' }),
      };
      release();
      resolve(out);
    };

    el.onloadedmetadata = () => done(true);
    el.onerror = () => done(false, 'the media decoder refused it — unsupported codec, or the file is corrupt');
    // Never hang the tool call on a codec the browser cannot open.
    setTimeout(
      () => done(Number.isFinite(el.duration), 'timed out after 4s without metadata'),
      4000
    );
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
    const asset = await importMediaFromPath(filePath, name);
    return {
      assetId: asset.id,
      name: asset.name,
      type: asset.type,
      durationMs: asset.durationMs,
      ...(asset.width ? { dimensions: `${asset.width}×${asset.height}` } : {}),
      decoded: asset.decoded,
      ...(asset.decoded
        ? {}
        : {
            warning:
              `Nothing could decode this file: ${asset.undecodableReason}. It is in the media ` +
              'pool, but durationMs is a 5s placeholder rather than a measurement, and any clip ' +
              'from it renders the placeholder gradient. Run it through ffmpeg_process to ' +
              'transcode it, or check the path.',
          }),
    };
  },
});

/* ═══════════════════════════════════════════════════════════════════
   ALTITUDE — one call in place of a loop the agent would improvise

   The test for whether something belongs here: if doing it by hand takes
   more than about six calls and a verification step, it should have been
   a tool. Both of these were measured at fifteen to forty.

   The logic lives in `src/engine/montage.ts` and
   `src/engine/folderAssembly.ts`; what is below is only the schema and
   the description.
   ═══════════════════════════════════════════════════════════════════ */

defineTool({
  name: 'auto_montage_to_beats',
  category: 'timeline',
  description:
    'Lay a montage whose cuts land on the beats of a music track. Detects the tempo and the ' +
    'beat grid from the audio itself, then places each shot from one beat to another — this ' +
    'BUILDS the edit, where detect_beats({snapCuts:true}) only nudges cuts that already exist. ' +
    'Takes media-pool assets, or re-lays the clips already on the target track. Every choice it ' +
    'is forced to make comes back in the result: which beats it cut on and how many of those ' +
    'were detected rather than interpolated, what it did when the material ran out before the ' +
    'music did, and what it did with any clip shorter than the shot it had to fill. Call with ' +
    'dryRun first to see the shot list before it touches the timeline.',
  schema: z.object({
    audioClipId: z.string().optional()
      .describe('Music clip on the timeline; defaults to the first audio clip with media'),
    audioAssetId: z.string().optional()
      .describe('Media-pool id or name for the music. Placed at 0ms on an audio track if it is not on the timeline yet.'),
    assetIds: z.array(z.string()).optional()
      .describe('Media-pool ids or names, in the order you want them. Omit to re-cut the clips already on the track.'),
    trackId: z.string().optional().describe('Video track to lay the montage on; defaults to the first video track'),
    cutEveryBeats: z.number().min(0.25).max(16).optional()
      .describe('Shot length in beats; default 2. Every beat (1) is a cut every half second at 120 BPM. ' +
                'Values below 1 cut on positions interpolated between detected beats, and the result says how many.'),
    startMs: z.number().optional().describe('Where the montage starts; defaults to the start of the music'),
    endMs: z.number().optional().describe('Where it stops; defaults to the end of the music'),
    order: z.enum(['as-given', 'reverse', 'shuffle']).optional().describe('Default as-given'),
    seed: z.number().optional().describe('Makes shuffle reproducible; default 1'),
    whenMaterialRunsOut: z.enum(['loop', 'stop', 'stretch']).optional()
      .describe('Fewer sources than shots: loop them (default), stop the montage early, or stretch the shot length so they span the music'),
    whenClipIsShort: z.enum(['slow', 'gap', 'skip']).optional()
      .describe('A source shorter than its shot: slow it to fit (default), let it play out and leave the rest empty, or pass it over'),
    reuse: z.enum(['advance', 'restart']).optional()
      .describe('A looped source starts later in itself each pass (default advance) or restarts from its head'),
    clearTrack: z.boolean().optional().describe('Remove what is on the track first; default true'),
    muteSourceAudio: z.boolean().optional().describe('Silence each shot so only the music plays; default true'),
    fitMode: z.enum(['cover', 'contain']).optional().describe('Default cover'),
    minShotMs: z.number().optional()
      .describe('Refuse a grid finer than this; default 120. Kerf clamps a clip to 100ms, so a finer grid drifts off the beat.'),
    maxCuts: z.number().optional().describe('Safety cap on the number of shots; default 400'),
    dryRun: z.boolean().optional().describe('Report the shot list and every decision without changing anything'),
  }),
  handler: async (args) => autoMontageToBeats(args),
});

defineTool({
  name: 'assemble_from_folder',
  category: 'media',
  description:
    'Import a folder of media and build a sequence from it, in one call. Reports what it did ' +
    'with EVERY file it found: the order it chose and why, the files it could not decode — by ' +
    'name, with the reason, and they are not imported — the ones that were not media at all, ' +
    'and how each clip got its duration. The counts are checked against the number of files ' +
    'seen, so a folder of twelve cannot silently become a nine-clip sequence. Stills and video ' +
    'go on one track together; audio goes to an audio track. Follow it with ' +
    'auto_montage_to_beats to put the cuts on the music.',
  schema: z.object({
    folder: z.string().describe('Absolute path to a directory'),
    recursive: z.boolean().optional().describe('Descend into subfolders (max 4 deep); default false, and the subfolder names are reported either way'),
    orderBy: z.enum(['name', 'modified', 'created', 'duration', 'as-listed']).optional()
      .describe('Default name, compared naturally so clip2 precedes clip10. "created" is the filesystem creation time, NOT EXIF capture time.'),
    trackId: z.string().optional().describe('Video track to build on; defaults to the first video track'),
    startMs: z.number().optional().describe('Where the sequence starts; default 0'),
    stillDurationMs: z.number().optional().describe('How long each still is held; default 3000. A still has no duration, so this is a choice.'),
    uniformDurationMs: z.number().optional().describe('Give every clip this length instead of its measured one'),
    maxClipMs: z.number().optional().describe('Trim any clip longer than this'),
    minClipMs: z.number().optional().describe('Extend any clip shorter than this'),
    audio: z.enum(['bed', 'sequence', 'ignore']).optional()
      .describe('bed (default) lays the first audio file at the start; sequence lays them all end to end; ignore imports but places none'),
    clearTrack: z.boolean().optional().describe('Remove what is on the video track first; default true'),
    fitMode: z.enum(['cover', 'contain']).optional().describe('Default cover'),
    limit: z.number().optional().describe('Use only the first N files in the chosen order'),
    dryRun: z.boolean().optional().describe('Report the whole plan, including the undecodable files, without importing anything'),
  }),
  handler: async (args) => assembleFromFolder(args),
});

defineTool({
  name: 'list_fonts',
  category: 'discovery',
  description:
    'List the font families this machine can actually render, measured rather than assumed. ' +
    'Call before setting textStyle.fontFamily — it is a free-form string, so an unavailable ' +
    'name is accepted, silently falls back to the default, and the text renders in the wrong face.',
  schema: z.object({
    filter: z.string().optional().describe('Only families containing this text'),
  }),
  handler: async ({ filter }) => {
    const fonts = await loadFonts();
    const needle = filter?.trim().toLowerCase();
    const shown = needle ? fonts.filter((f) => f.family.toLowerCase().includes(needle)) : fonts;

    const complete = fontsAreEnumerated();

    return {
      count: shown.length,
      total: fonts.length,
      /* Bundled ones ship with Kerf and are present on every machine;
         system ones are whatever this computer happens to have. */
      bundled: shown.filter((f) => f.source === 'bundled').map((f) => f.family),
      system: shown.filter((f) => f.source === 'system').map((f) => f.family),
      /* Say which list this is. A probed list is a common-family subset,
         so absence from it is not evidence the machine lacks the font —
         reporting it as the whole truth is how the agent ends up certain
         about a font that is actually installed. */
      source: complete ? 'enumerated' : 'probed',
      ...(complete ? {} : {
        note:
          'This is a probed fallback, not the full system list — the machine almost ' +
          'certainly has more. A family missing here may still exist; check it with a ' +
          'later call once the window has been shown.',
      }),
    };
  },
});

defineTool({
  name: 'generate_sound_effect',
  category: 'audio',
  description:
    'Synthesise a sound effect and add it to the media pool as a real WAV file — whoosh, ' +
    'impact, boom, riser, sub drop, click, pop, beep, glitch and more. They are GENERATED, ' +
    'not recordings, so they are always available, need no download, and carry no licensing ' +
    'question. Duration is a parameter, so the same kind at 0.3s and 1.5s are different sounds. ' +
    'Pass insert to drop it straight onto the timeline.',
  schema: z.object({
    kind: z.string().describe(`One of: ${SFX_CATALOGUE.map((s) => s.kind).join(', ')}`),
    seconds: z.number().min(0.05).max(15).optional().describe('Overrides the default length'),
    insert: z.boolean().optional().describe('Also place it on an audio track'),
    atMs: z.number().optional().describe('Where to place it; defaults to the playhead'),
    volume: z.number().min(0).max(2).optional(),
  }),
  handler: async ({ kind, seconds, insert, atMs, volume }) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.media) {
      throw new Error('Generating audio needs the desktop app — the file has to reach the disk.');
    }

    const wanted = oneOf(kind, SFX_CATALOGUE.map((s) => s.kind), 'sound effect');
    const rendered = await renderSfx(wanted, seconds);

    /*
      Written to a real file rather than kept as a blob URL: ffmpeg cannot
      read `blob:`, so an in-memory sound would play in the preview and be
      missing from the export with nothing to indicate why.
    */
    const filePath = await api.media.writeTemp(`${wanted}_${rendered.durationMs}ms.wav`, rendered.wav);

    const state = timeline();
    const asset: MediaAsset = {
      id: `asset_sfx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: `${rendered.label} ${(rendered.durationMs / 1000).toFixed(2)}s`,
      type: 'audio',
      url: `file://${encodeURI(filePath)}`,
      thumbnailUrl: '',
      durationMs: rendered.durationMs,
      fileSizeFormatted: `${Math.round(rendered.wav.byteLength / 1024)} KB`,
      codec: 'WAV 48kHz 16-bit · synthesised',
    };
    state.addMediaAsset(asset);

    let clipId: string | undefined;
    if (insert) {
      const trackId = resolveTrackId('audio');
      clipId = state.insertClip(trackId, asset, atMs ?? state.playheadMs);
      if (clipId && volume !== undefined) state.patchClip(clipId, { 'audio.volume': volume });
    }

    return {
      assetId: asset.id,
      name: asset.name,
      kind: wanted,
      durationMs: rendered.durationMs,
      path: filePath,
      synthesised: true,
      ...(clipId ? { clipId } : {}),
    };
  },
});

defineTool({
  name: 'list_sound_effects',
  category: 'discovery',
  description:
    'The sound effects Kerf can synthesise, with what each is for. Kerf ships no ' +
    'recorded audio library — these are generated on demand. For recorded music or SFX, ' +
    'find a file on disk and use import_media_from_path.',
  schema: z.object({}),
  handler: () => ({
    count: SFX_CATALOGUE.length,
    note: 'Generated, not recordings. Duration is adjustable per call.',
    effects: SFX_CATALOGUE.map((s) => ({
      kind: s.kind,
      label: s.label,
      usedFor: s.hint,
      defaultSeconds: s.seconds,
    })),
  }),
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
    'Record that the user asked for something Kerf cannot do. Call this WHENEVER you ' +
    'have to tell the user no, or had to substitute something different from what they ' +
    'asked for — including when you found a workaround. This is how missing features ' +
    'reach the developer; a refusal you only speak aloud is lost the moment the panel ' +
    'scrolls. Then still tell the user plainly what you could not do and what you suggest.',
  schema: z.object({
    request: z.string().describe("What the user asked for, in their words where possible"),
    reason: z.string().describe('Why Kerf cannot do it'),
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
  name: 'resolve_capability_gap',
  category: 'discovery',
  description:
    'Mark a logged capability gap as resolved, once the thing it describes actually works. ' +
    'Gaps could be recorded and never closed, so the log accumulated entries for things that had ' +
    'since been built — and the next person to read it cannot tell those apart from the real ' +
    'backlog. Only close one you have verified.',
  schema: z.object({
    gapId: z.string().optional().describe('Gap id from list_capability_gaps'),
    match: z.string().optional().describe('Substring of the request or reason, when the id is not to hand'),
    note: z.string().optional().describe('What fixed it'),
  }),
  handler: ({ gapId, match, note }) => {
    const store = useGapStore.getState();
    const needle = (match ?? '').toLowerCase();
    const target = gapId
      ? store.gaps.find((g) => g.id === gapId)
      : store.gaps.find(
          (g) =>
            !g.resolved &&
            needle.length > 0 &&
            (g.request.toLowerCase().includes(needle) || g.reason.toLowerCase().includes(needle))
        );

    if (!target) {
      throw new Error(
        gapId
          ? `No capability gap with id "${gapId}".`
          : `No unresolved capability gap matching "${match ?? ''}". Call list_capability_gaps.`
      );
    }
    if (target.resolved) return { gapId: target.id, alreadyResolved: true, request: target.request };

    store.toggleResolved(target.id);
    return {
      gapId: target.id,
      request: target.request,
      resolved: true,
      ...(note ? { note } : {}),
      remainingOpen: useGapStore.getState().gaps.filter((g) => !g.resolved).length,
    };
  },
});

defineTool({
  name: 'list_capability_gaps',
  category: 'discovery',
  description: 'List everything previously recorded as missing from Kerf.',
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

/* ═══════════════════════════════════════════════════════════════════
   COMPOSITE LAYOUTS

   Tools at the altitude people actually ask at.

   An agent CAN build a grid out of tracks, transforms and masks — we
   watched one do it in about twenty-two calls, and it only got the
   framing right because it rendered a frame, looked at it, and caught
   its own overflow bug. That is impressive and completely wasteful: it
   costs tokens and wall-clock every single time, and it can fail
   differently on any run.

   This is the same result in one deterministic call, with the geometry
   that agent had to discover baked in — including the crop that stops
   mismatched source aspect ratios spilling out of their cell.
   ═══════════════════════════════════════════════════════════════════ */

defineTool({
  name: 'create_grid_layout',
  category: 'graphics',
  description:
    'Arrange several clips into a grid (collage / split-screen / picture-in-picture wall) ' +
    'showing them on screen at once. Handles the tracks, scaling, positioning and per-cell ' +
    'cropping. Prefer this over building a grid by hand from add_track + patch_clip.',
  schema: z.object({
    assetIds: z.array(z.string()).describe('Media asset ids or names, in reading order (left to right, top to bottom)'),
    rows: z.number().int().min(1).max(6),
    columns: z.number().int().min(1).max(6),
    startTimeMs: z.number().optional().describe('Defaults to the playhead'),
    durationMs: z.number().optional().describe('Defaults to 5000'),
    gapPx: z.number().optional().describe('Gutter between cells in project pixels; default 0'),
    /** Which cell keeps its sound. Stacked audio beds are almost never wanted. */
    audioFromCell: z.number().int().optional().describe('1-based cell index that keeps audio; omit to mute all'),
  }),
  handler: ({ assetIds, rows, columns, startTimeMs, durationMs, gapPx, audioFromCell }) => {
    const state = timeline();
    const proj = project().project;

    const cells = rows * columns;
    if (assetIds.length === 0) throw new Error('Give at least one asset for the grid.');
    if (assetIds.length > cells) {
      throw new Error(
        `${assetIds.length} assets will not fit a ${rows}×${columns} grid (${cells} cells). ` +
        `Increase rows/columns or pass fewer assets.`
      );
    }

    const start = startTimeMs ?? state.playheadMs;
    const dur = durationMs ?? 5000;
    const gap = gapPx ?? 0;

    /*
      Scale UNIFORMLY by the larger of the two ratios so each clip covers
      its cell, then crop the overflow with a mask. Scaling x and y
      independently would fit the cell exactly and squash every face in
      the shot — correct arithmetic, wrong picture.
    */
    const scale = Math.max(1 / columns, 1 / rows);
    const cellW = proj.width / columns;
    const cellH = proj.height / rows;

    const placed: {
      cell: number; clipId: string; assetName: string;
      cropPct: { x: number; y: number };
    }[] = [];
    const cellWarnings: string[] = [];

    assetIds.forEach((ref, index) => {
      const asset =
        state.mediaPool.find((a) => a.id === ref) ??
        state.mediaPool.find((a) => a.name.toLowerCase().includes(ref.toLowerCase()));
      if (!asset) {
        throw new Error(`No media asset "${ref}". Available: ${state.mediaPool.map((a) => a.name).join(', ')}`);
      }

      const row = Math.floor(index / columns);
      const col = index % columns;

      const trackId = state.addTrack('video', `Grid ${row + 1}·${col + 1}`);
      const clipId = state.insertClip(trackId, asset, start);

      /*
        The crop has to come from THIS clip's real box, not from the canvas.
        `cover` fills the frame without distorting, so a portrait source in a
        landscape project ends up far taller than the frame — assume the box
        is canvas-sized and the mask does nothing, and that cell spills over
        its neighbours. (Observed: a 4K portrait clip rendered 1609px tall in
        a 540px cell.)
      */
      const placedClip = findClipById(timeline().tracks, clipId);

      /*
        Measure the box the clip will have AFTER this patch, not the one
        it has now. `insertClip` gives image assets `fitMode: 'contain'`
        (55% of the frame) and the patch below switches them to 'cover'
        (which fills it). Measuring first meant the crop was computed
        against a box roughly half the final size, so it came out over
        100%, clamped to 100 — no crop at all — and then the clip grew
        and spilled across its neighbours.

        It was invisible for as long as the sample assets were mislabelled
        as video, because video already took the 'cover' path.
      */
      const base = placedClip
        ? getClipBaseSize({ ...placedClip, fitMode: 'cover' }, proj, getNaturalSize(placedClip))
        : { width: proj.width, height: proj.height };

      const boxW = base.width * scale;
      const boxH = base.height * scale;
      const maskX = Math.min(100, ((cellW - gap) / boxW) * 100);
      const maskY = Math.min(100, ((cellH - gap) / boxH) * 100);

      const patched = state.patchClip(clipId, {
        name: `Grid ${row + 1}·${col + 1} · ${asset.name}`,
        durationMs: dur,
        fitMode: 'cover',
        'transform.scaleX': scale,
        'transform.scaleY': scale,
        // Cell centre, expressed as an offset from the canvas centre.
        'transform.x': Math.round((col + 0.5) * cellW - proj.width / 2),
        'transform.y': Math.round((row + 0.5) * cellH - proj.height / 2),
        'mask.enabled': true,
        'mask.type': 'rectangle',
        'mask.sizeX': maskX,
        'mask.sizeY': maskY,
        'mask.offsetX': 0,
        'mask.offsetY': 0,
        'audio.volume': audioFromCell === index + 1 ? 1 : 0,
      });

      /* This used to discard patchClip's errors entirely, so a cell that
         failed to crop reported the same success as one that worked. */
      if (patched.errors.length > 0) {
        cellWarnings.push(`Cell ${index + 1} (${asset.name}): ${patched.errors.join('; ')}`);
      }

      placed.push({
        cell: index + 1,
        clipId,
        assetName: asset.name,
        // Reporting the crop makes the framing checkable without a render.
        cropPct: { x: Number(maskX.toFixed(1)), y: Number(maskY.toFixed(1)) },
      });
    });

    return {
      layout: `${rows}×${columns}`,
      cellsFilled: placed.length,
      cellsEmpty: cells - placed.length,
      startTimeMs: start,
      durationMs: dur,
      clips: placed,
      audio: audioFromCell ? `cell ${audioFromCell}` : 'all muted',
      ...(cellWarnings.length ? { warnings: cellWarnings } : {}),
    };
  },
});

/* ═══════════════════════════════════════════════════════════════════
   AUDIO UNDERSTANDING
   ═══════════════════════════════════════════════════════════════════ */

defineTool({
  name: 'analyze_audio',
  category: 'audio',
  description:
    'Measure a clip\'s audio: loudness (LUFS), true peak, noise floor, dynamic range, ' +
    'clipping, and every silent region with timestamps. Fast (a second or two), needs no ' +
    'model. Call this BEFORE promising anything about audio — it answers "is it too quiet", ' +
    '"is it clipping", "where are the dead patches", which transcription cannot.',
  schema: z.object({
    clipId: z.string().optional().describe('Defaults to the first clip with audio'),
    silenceThresholdDb: z.number().optional().describe('Below this counts as silence; default -35'),
    minSilenceMs: z.number().optional().describe('Ignore gaps shorter than this; default 400'),
  }),
  handler: async ({ clipId, silenceThresholdDb, minSilenceMs }) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.stt) throw new Error('Audio analysis needs the desktop app (it shells out to ffmpeg).');

    const state = timeline();
    const clip = clipId
      ? findClipById(state.tracks, resolveClipId(clipId))
      : state.tracks.filter((t) => t.type === 'audio').flatMap((t) => t.clips).find((c) => c.mediaUrl) ??
        state.tracks.filter((t) => t.type === 'video').flatMap((t) => t.clips).find((c) => c.mediaUrl);

    if (!clip?.mediaUrl) throw new Error('No clip with audio found on the timeline.');

    const result = await api.stt.analyze({ mediaUrl: clip.mediaUrl, silenceThresholdDb, minSilenceMs });
    if (!result.ok) throw new Error(result.message);

    return {
      clip: clip.name,
      clipId: clip.id,
      loudness: {
        integratedLufs: result.integratedLufs,
        loudnessRangeLu: result.loudnessRangeLu,
        truePeakDbfs: result.truePeakDbfs,
        rmsDbfs: result.rmsDbfs,
      },
      noiseFloorDbfs: result.noiseFloorDbfs,
      dynamicRangeDb: result.dynamicRangeDb,
      clippedSamples: result.clippedSamples,
      // Timeline-absolute, so these can be fed straight to cut tools.
      silences: result.silences.map((s: { startMs: number; endMs: number; durationMs: number }) => ({
        startMs: s.startMs + clip.startTimeMs,
        endMs: s.endMs + clip.startTimeMs,
        durationMs: s.durationMs,
      })),
      silentPercent: Math.round(result.silentFraction * 100),
      notes: result.notes,
    };
  },
});

defineTool({
  name: 'describe_audio_preview',
  category: 'audio',
  description:
    'Say which per-clip audio settings PLAYBACK reproduces and which it cannot, so the preview ' +
    'is never quietly different from the render. pitch, voice effects, noise reduction and ' +
    'ducking are all applied by render_export; playback runs a WebAudio graph and cannot do ' +
    'all of them. Call before telling a user their edit sounds right — what you hear in the ' +
    'app is not automatically what the file will contain. Returns a MEASURED fingerprint of ' +
    'the preview chain (band gains and echo taps, rendered offline) rather than a claim.',
  schema: z.object({
    clipId: z.string().optional().describe('Just this clip; defaults to every audible clip'),
    measure: z.boolean().optional().describe('Render and measure the chain; default true'),
  }),
  handler: async ({ clipId, measure }) => {
    const state = timeline();

    const audible: { clip: Clip; track: Track }[] = [];
    for (const track of state.tracks) {
      for (const clip of track.clips) {
        if (!clip.mediaUrl || clip.hidden) continue;
        if (track.type !== 'audio' && clip.type !== 'video') continue;
        audible.push({ clip, track });
      }
    }

    const wanted = clipId ? resolveClipId(clipId) : null;
    const chosen = wanted ? audible.filter((x) => x.clip.id === wanted) : audible;
    if (wanted && chosen.length === 0) throw new Error(`Clip "${clipId}" has no audio.`);

    /*
      Ducking is a property of the MIX, not of a clip: it needs something
      to duck against. Both the export filtergraph and the preview fall
      back to a plain mix when every audible clip is marked, so saying
      "ducking: applied" per clip would be wrong in exactly the case that
      matters.
    */
    const duckedCount = audible.filter((x) => x.clip.audio.ducking).length;
    const duckingActive = duckedCount > 0 && duckedCount < audible.length;

    const clips = [];
    for (const { clip, track } of chosen) {
      const a = clip.audio;
      const notPreviewed = unpreviewableAudio(a).map((u) => `${u.short} ${u.why}`);
      const applied: string[] = [];
      if (a.voiceEffect && a.voiceEffect !== 'none' && a.voiceEffect !== 'deep' && a.voiceEffect !== 'high') {
        applied.push(a.voiceEffect);
      }
      if (a.ducking && duckingActive) applied.push('ducking');
      if (a.ducking && !duckingActive) {
        notPreviewed.push(
          duckedCount === audible.length
            ? 'ducking — every audible clip is set to duck, so there is nothing to duck ' +
              'against. The export does the same thing: a plain mix'
            : 'ducking — no other audible clip to key it from'
        );
      }

      clips.push({
        clipId: clip.id,
        name: clip.name,
        track: track.name,
        settings: {
          pitch: a.pitch,
          voiceEffect: a.voiceEffect,
          noiseReduction: a.noiseReduction,
          ducking: a.ducking,
        },
        previewApplies: applied,
        previewCannotApply: notPreviewed,
        previewMatchesRender: notPreviewed.length === 0,
        ...(measure === false
          ? {}
          : { measured: (await measureChain(a)) ?? 'no OfflineAudioContext in this environment' }),
      });
    }

    const differing = clips.filter((c) => !c.previewMatchesRender);

    return {
      clips,
      previewMatchesRender: differing.length === 0,
      summary:
        differing.length === 0
          ? 'Playback reproduces every audio setting on the timeline; the preview matches the render.'
          : `${differing.length} of ${clips.length} clip(s) will sound different in the preview than ` +
            'in the exported file. Render a test export before judging those by ear.',
      /* The approximations are named too. They ARE previewed, so they do
         not belong in previewCannotApply, but "matches" would be too
         strong a word for either of them. */
      approximations: [
        'robot — the render uses ffmpeg vibrato; the preview sweeps a delay line. Same rate ' +
        'and depth, not the same samples',
        'ducking — the render sidechains per sample; the preview measures the key bus once ' +
        'per frame. Same threshold and ratio, coarser envelope',
      ],
    };
  },
});

/* ═══════════════════════════════════════════════════════════════════
   REFERENCE UNDERSTANDING
   ═══════════════════════════════════════════════════════════════════ */

defineTool({
  name: 'analyze_reference_video',
  category: 'ai',
  description:
    'Measure HOW a reference video is edited and return it as numbers: where every cut is, how ' +
    'those cuts sit against the music\'s beat grid and at what subdivision, the grade (luminance, ' +
    'contrast, saturation, black point, colour temperature, dominant hues), how much the frame ' +
    'moves in each shot, any burnt-in overlay regions, and the format. Every figure is measured ' +
    'off extracted frames — the cut list comes from comparing pixels, not from container ' +
    'metadata, and the beat grid comes from the same detector detect_beats uses. Use this before ' +
    'trying to match a reference: it replaces a dozen improvised ffmpeg calls with one ' +
    'deterministic answer. It reads no text: overlay regions are reported as regions that hold ' +
    'still, never as words. Takes a few seconds per ten seconds of source.',
  schema: z.object({
    source: z.string().optional()
      .describe('Absolute path to a video file, or a clip id / media asset name already in the project. Defaults to the selected clip.'),
    cutSensitivity: z.number().optional()
      .describe('0..100; higher finds more (and weaker) cuts. Default 50.'),
    analysisFps: z.number().optional()
      .describe('Force the sampling rate. Leave unset to measure the source rate and use it.'),
    maxFrames: z.number().optional()
      .describe('Ceiling on analysed frames; the rate is reduced to fit. Default 3600.'),
    includeGrade: z.boolean().optional(),
    includeMotion: z.boolean().optional(),
    includeOverlays: z.boolean().optional(),
    includeCadence: z.boolean().optional().describe('Extract the audio and measure the cuts against its beat grid. Default true.'),
  }),
  handler: async ({ source, cutSensitivity, analysisFps, maxFrames, includeGrade, includeMotion, includeOverlays, includeCadence }) => {
    const api = (window as any).electronAPI;
    if (!api?.ffmpeg?.process) {
      throw new Error('Analysing a reference needs the desktop app — it extracts frames with ffmpeg.');
    }

    /* Same resolution order as ffmpeg_process, so "the clip I am looking
       at" and "a file I just downloaded" both work without the caller
       having to know which one this is. */
    const state = timeline();
    let url: string | null = null;
    let name = 'reference';

    if (source && /^(\/|file:|https?:)/.test(source)) {
      url = source;
      name = decodeURIComponent(source.split('/').pop() ?? 'reference');
    } else {
      const clip = source
        ? findClipById(state.tracks, resolveClipId(source))
        : findClipById(state.tracks, resolveClipId(undefined));
      if (clip?.mediaUrl) { url = clip.mediaUrl; name = clip.name; }
      else if (source) {
        const asset = state.mediaPool.find((a) => a.id === source)
          ?? state.mediaPool.find((a) => a.name.toLowerCase().includes(source.toLowerCase()));
        if (asset) { url = asset.url; name = asset.name; }
      }
    }
    if (!url) {
      throw new Error('No video to analyse. Pass an absolute path, a clip id, or a media asset name.');
    }

    return await analyzeReferenceVideo(
      {
        url, name, cutSensitivity, analysisFps, maxFrames,
        includeGrade, includeMotion, includeOverlays, includeCadence,
      },
      {
        ffmpegProcess: (opts) => api.ffmpeg.process(opts),
        detectBeats,
      }
    );
  },
});

defineTool({
  name: 'setup_transcription',
  category: 'ai',
  description:
    'Install what transcription needs (ffmpeg via Homebrew, openai-whisper via pip, and one ' +
    'Whisper model). Only call this after check_transcription_ready says something is missing, ' +
    'and tell the user first — it installs software and can take several minutes.',
  schema: z.object({
    model: z.string().optional().describe('Whisper model to fetch; default "small" (~500MB)'),
  }),
  handler: async ({ model }) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.stt) throw new Error('Setup needs the desktop app.');

    const result = await api.stt.setup({ model });
    if (!result.ok) {
      useGapStore.getState().record({
        request: 'Set up transcription automatically',
        reason: `${result.step}: ${result.message}`,
        suggestion: 'Ship whisper.cpp with a small bundled model so captions need no setup at all',
      });
    }
    return result;
  },
});
