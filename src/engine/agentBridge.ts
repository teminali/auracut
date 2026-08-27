/* ═══════════════════════════════════════════════════════════════════
   Agent bridge — turns a natural-language instruction into a validated
   plan of MCP tool calls, executes it, and streams progress back.

   How it works:
     1. Snapshot the timeline so the planner reasons about real ids.
     2. Build a plan. If a live model endpoint is configured, ask it and
        validate the JSON it returns; otherwise fall back to the built-in
        intent planner, which covers the common editing verbs offline.
     3. Execute step by step through `executeTool`, which validates every
        argument, so a bad plan degrades into a readable error rather than
        a corrupted project.
     4. Every step is cancellable — the abort signal is checked between
        steps and awaited alongside each call.
   ═══════════════════════════════════════════════════════════════════ */

import { executeTool, KERF_TOOLS, getTool } from '../mcp/toolRegistry';
import { useTimelineStore, findClipById } from '../store/timelineStore';
import { useProjectStore } from '../store/projectStore';
import { EFFECT_REGISTRY } from './effectsRegistry';
import { ContextEnvelope, CommandKind } from '../types/context';
import { serializeEnvelope, classifyCommand, summariseEnvelope } from './contextProtocol';
import { formatTimecode } from '../utils/time';

/* ── Types ──────────────────────────────────────────────────────── */

/*
  There is one planner. This used to name four — antigravity,
  claude_code, codex_sonnet, local_llm — which were the options in a
  dropdown that selected nothing; the value only ever became a label.
  With the dropdown gone, the label was still announcing "ANTIGRAVITY"
  over answers written by a regex matcher.
*/
export type AgentModel = 'builtin';

export interface AgentThoughtStep {
  id: string;
  type: 'thinking' | 'tool_call' | 'status' | 'error';
  content: string;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  toolResult?: unknown;
  durationMs?: number;
  ok?: boolean;
  timestamp: number;
}

export interface AgentExecutionRun {
  runId: string;
  prompt: string;
  agentModel: AgentModel;
  /** The exact editor state this run was dispatched against. */
  context?: ContextEnvelope;
  commandKind?: CommandKind;
  status: 'idle' | 'planning' | 'executing' | 'completed' | 'error' | 'cancelled';
  progressPct: number;
  currentActivity: string;
  thoughts: AgentThoughtStep[];
  finalResponse: string;
  createdAt: number;
}

export interface PlannedStep {
  tool: string;
  args: Record<string, unknown>;
  /** Human-readable rationale shown in the thought stream. */
  why: string;
}

export type AgentBridgeListener = (run: AgentExecutionRun) => void;

/* ── Planner configuration ──────────────────────────────────────── */

export interface ModelEndpoint {
  /** Chat-completions-compatible URL. */
  url: string;
  apiKey?: string;
  model: string;
}

let modelEndpoint: ModelEndpoint | null = null;

export function configureModelEndpoint(endpoint: ModelEndpoint | null): void {
  modelEndpoint = endpoint;
}

export function hasModelEndpoint(): boolean {
  return modelEndpoint !== null;
}

/* ── The system prompt the planner works from ───────────────────── */

function buildSystemPrompt(): string {
  const toolList = KERF_TOOLS.map((t) => `- ${t.name}(${describeArgs(t.name)}), ${t.description}`).join('\n');
  const effectList = EFFECT_REGISTRY.map((e) => `${e.type} (${e.category})`).join(', ');

  return [
    'You are the editing engine inside Kerf, a non-linear video editor.',
    'Translate the user instruction into a JSON plan of tool calls.',
    '',
    'Respond with ONLY a JSON object of the form:',
    '{"steps":[{"tool":"tool_name","args":{...},"why":"short reason"}],"summary":"what you did"}',
    '',
    'CONTEXT PROTOCOL, read this before planning:',
    '- The EDITOR CONTEXT block below is authoritative. It gives the exact timecode,',
    '  frame number, and every visible layer with its bounds in project pixels.',
    '- PRIMARY TARGET is the layer the user means. Steps that omit clipId act on it.',
    '  Only name a different clipId when the instruction clearly points elsewhere.',
    '- USER ANNOTATIONS are marks the user drew ON the attached frame. Each one is',
    '  already resolved to the layer beneath it. Treat "this", "that" and "here" as',
    '  referring to those marks, in order.',
    '- If the context is missing something you need, do NOT guess: return a single',
    '  step calling check_command_readiness, and the editor will ask the user.',
    '',
    'Rules:',
    '- Prefer patch_clip for property changes; it accepts any dotted path.',
    '- Timings are milliseconds. Canvas coordinates have (0,0) at the top-left,',
    '  so the frame centre is (width/2, height/2).',
    '- Keyframe times are relative to the CLIP start, not the timeline.',
    '- Call get_frame_context when you need to look at a different moment.',
    '',
    'TOOLS:',
    toolList,
    '',
    `VFX EFFECT TYPES: ${effectList}`,
  ].join('\n');
}

function describeArgs(toolName: string): string {
  const tool = getTool(toolName);
  if (!tool) return '';
  try {
    const shape = (tool.schema as any)?.shape ?? {};
    return Object.keys(shape).join(', ');
  } catch {
    return '';
  }
}

/* ── Timeline snapshot for the planner ──────────────────────────── */

/**
 * Fallback description used when no envelope was supplied. The envelope is
 * strictly better — it carries the frame, the annotations and the resolved
 * target — so this only covers programmatic callers.
 */
function snapshotContext(): string {
  const state = useTimelineStore.getState();
  const proj = useProjectStore.getState().project;

  const lines = [
    `Canvas: ${proj.width}x${proj.height} (${proj.aspectRatio}) @ ${proj.fps}fps, duration ${proj.durationMs}ms`,
    `Playhead: ${Math.round(state.playheadMs)}ms`,
    `Selected: ${state.selectedClipIds.join(', ') || '(nothing)'}`,
    'Tracks:',
  ];

  for (const track of state.tracks) {
    lines.push(`  ${track.id} "${track.name}" (${track.type})`);
    for (const clip of track.clips) {
      const fx = clip.effects.length > 0 ? ` fx=[${clip.effects.map((e) => e.type).join(',')}]` : '';
      lines.push(
        `    ${clip.id} "${clip.name}" ${clip.type} ${clip.startTimeMs}-${clip.startTimeMs + clip.durationMs}ms${fx}`
      );
    }
  }

  lines.push(`Media pool: ${state.mediaPool.map((a) => `${a.id}("${a.name}")`).join(', ')}`);
  return lines.join('\n');
}

/* ═══════════════════════════════════════════════════════════════════
   Built-in intent planner (no network required)
   ═══════════════════════════════════════════════════════════════════ */

interface IntentRule {
  id: string;
  /** Every pattern that should trigger this rule. */
  match: RegExp;
  plan: (prompt: string) => PlannedStep[];
}

/** Pull the first number out of a phrase, e.g. "rotate 45 degrees" → 45. */
const num = (prompt: string, fallback: number): number => {
  const m = prompt.match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : fallback;
};

/** Extract a quoted string, for text content. */
const quoted = (prompt: string): string | null => {
  const m = prompt.match(/["“']([^"”']{1,200})["”']/);
  return m ? m[1] : null;
};

const COLOR_WORDS: Record<string, string> = {
  red: '#ff4d4d', blue: '#4c9dff', green: '#2fc98d', yellow: '#f5d524',
  orange: '#ff9a4d', purple: '#a78bfa', pink: '#f472b6', white: '#ffffff',
  black: '#000000', cyan: '#2dd4bf', gold: '#e8b64c', teal: '#14b8a6',
};

const findColor = (prompt: string): string | null => {
  for (const [word, hex] of Object.entries(COLOR_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(prompt)) return hex;
  }
  const hex = prompt.match(/#[0-9a-fA-F]{3,8}/);
  return hex ? hex[0] : null;
};

const INTENT_RULES: IntentRule[] = [
  {
    id: 'cut-silence',
    match: /\b(silence|dead ?air|pauses?|kata|tighten)\b/i,
    plan: () => [{ tool: 'remove_silence', args: {}, why: 'Detect and remove dialogue pauses' }],
  },

  {
    id: 'captions',
    match: /\b(caption|subtitle|manenos?|maneno|transcri)\w*\b/i,
    plan: (p) => [
      {
        tool: 'generate_auto_captions',
        args: { language: /swahili|kiswahili|\bsw\b/i.test(p) ? 'sw' : 'en' },
        why: 'Transcribe the audio and build a synced caption track',
      },
    ],
  },

  {
    id: 'beats',
    match: /\b(beats?|bpm|tempo|rhythm|sync to (the )?music|on beat)\b/i,
    plan: (p) => [
      {
        tool: 'detect_beats',
        args: { snapCuts: /\b(cut|snap|sync|lock)\b/i.test(p) },
        why: 'Analyse the music track and place beat markers',
      },
    ],
  },

  {
    id: 'broll',
    match: /\b(b-?roll|cutaways?|overlay footage)\b/i,
    plan: (p) => [
      { tool: 'suggest_broll', args: { insert: !/suggest|propose|show me/i.test(p) }, why: 'Find contextual B-roll for the dialogue' },
    ],
  },

  {
    id: 'vertical',
    match: /\b(tiktok|reels?|shorts?|vertical|9:16|portrait)\b/i,
    plan: () => [{ tool: 'set_canvas', args: { aspectRatio: '9:16' }, why: 'Reformat the canvas for vertical delivery' }],
  },

  {
    id: 'square',
    match: /\b(square|1:1|instagram feed)\b/i,
    plan: () => [{ tool: 'set_canvas', args: { aspectRatio: '1:1' }, why: 'Reformat the canvas to square' }],
  },

  {
    /*
      Plain colour adjustments.

      This was the biggest hole in the planner: "make this warmer", "boost
      the saturation" and "cool the temperature" are all printed in the
      Copilot's own help text, and none of them matched a rule — only the
      whole-hog "cinematic" grade did. These are the adjustments people
      reach for constantly, so they get direct, additive control.

      Deltas are relative and signed, so "warmer" nudges rather than
      slamming to an absolute value, and saying it twice warms it twice.
    */
    id: 'colour-adjust',
    match: /\b(warm(er|th)?|cool(er)?|temperature|saturat\w*|vibran\w*|contrast|bright(er|ness)?|dark(er)?|expos\w*|shadows?|highlights?|sharpen|sharper|tint|washed|flat|punch\w*)\b/i,
    plan: (p) => {
      const properties: Record<string, number> = {};

      // "less", "reduce", "down" flip the direction of everything asked for.
      const down = /\b(less|reduce|lower|drop|down|de-?saturat\w*|remove)\b/i.test(p);
      const strong = /\b(a lot|much|way|very|really|heavily|max)\b/i.test(p);
      const slight = /\b(slightly|a (little|touch|bit)|subtle|gently)\b/i.test(p);
      const step = strong ? 30 : slight ? 8 : 18;
      const dir = (positive: boolean) => (positive !== down ? step : -step);

      if (/\bwarm(er|th)?\b/i.test(p)) properties['filters.temperature'] = dir(true);
      if (/\bcool(er)?\b/i.test(p)) properties['filters.temperature'] = dir(false);
      if (/\btemperature\b/i.test(p) && properties['filters.temperature'] === undefined) {
        properties['filters.temperature'] = dir(true);
      }
      if (/\b(saturat\w*|vibran\w*)\b/i.test(p)) properties['filters.saturation'] = dir(true);
      if (/\bcontrast\b/i.test(p)) properties['filters.contrast'] = dir(true);
      if (/\bbright(er|ness)?\b/i.test(p)) properties['filters.brightness'] = dir(true);
      if (/\bdark(er)?\b/i.test(p)) properties['filters.brightness'] = dir(false);
      if (/\bexpos\w*\b/i.test(p)) properties['filters.exposure'] = dir(true);
      if (/\bshadows?\b/i.test(p)) properties['filters.shadows'] = dir(true);
      if (/\bhighlights?\b/i.test(p)) properties['filters.highlights'] = dir(true);
      if (/\b(sharpen|sharper)\b/i.test(p)) properties['filters.sharpen'] = dir(true);
      if (/\btint\b/i.test(p)) properties['filters.tint'] = dir(true);

      /* "washed out", "flat" and "punchier" describe a RESULT, not a knob.
         Translate them into the combination a colourist would actually reach
         for rather than guessing at a single slider. */
      if (/\b(washed|flat)\b/i.test(p) || /\bpunch\w*\b/i.test(p)) {
        properties['filters.contrast'] = (properties['filters.contrast'] ?? 0) + 20;
        properties['filters.saturation'] = (properties['filters.saturation'] ?? 0) + 16;
      }

      if (Object.keys(properties).length === 0) return [];

      const named = Object.keys(properties)
        .map((k) => k.replace('filters.', ''))
        .join(', ');

      return [
        {
          tool: 'patch_clips',
          args: { clipType: 'video', properties, relative: true },
          why: `Adjust ${named}`,
        },
      ];
    },
  },

  {
    id: 'cinematic-grade',
    match: /\b(cinematic|teal and orange|film ?look|movie ?look|colou?r ?grade|grade it)\b/i,
    plan: () => [
      {
        tool: 'patch_clips',
        args: {
          clipType: 'video',
          properties: {
            'filters.contrast': 22,
            'filters.saturation': 18,
            'filters.temperature': -12,
            'filters.tint': 8,
            'filters.vignette': 32,
          },
        },
        why: 'Apply a teal-and-orange grade across the video clips',
      },
      { tool: 'add_effect', args: { effectType: 'letterbox', params: { ratio: 2.39 } }, why: 'Add cinemascope mattes' },
      { tool: 'add_effect', args: { effectType: 'film_grain', params: { amount: 22 } }, why: 'Add subtle film grain' },
    ],
  },

  {
    /* `film_grain` existed only inside the cinematic grade, so the "Film
       grain" quick action — and the help text that advertises it — mapped
       to nothing at all. It needs a rule of its own. */
    id: 'grain',
    match: /\b(grain|grainy|film ?stock|16 ?mm|35 ?mm|super ?8|noise)\b/i,
    plan: (p) => [
      {
        tool: 'add_effect',
        args: {
          effectType: 'film_grain',
          /*
            Intensity comes from adjectives only, never from digits in the
            prompt: "35mm" and "16mm" name a film stock, not an amount, and
            reading them as one would make "add 35mm grain" 3× heavier than
            "add 16mm grain" for no reason a user could guess.
          */
          params: {
            amount: /\b(heavy|strong|lots|coarse|thick)\b/i.test(p) ? 45
              : /\b(subtle|light|touch|slight|fine)\b/i.test(p) ? 12
              : 24,
          },
        },
        why: 'Add film grain',
      },
    ],
  },

  {
    id: 'glow',
    match: /\b(glow|bloom|dreamy|halation)\b/i,
    plan: (p) => [
      {
        tool: 'add_effect',
        args: { effectType: 'glow', params: { radius: num(p, 32), tint: findColor(p) ?? '#8fc4ff' } },
        why: 'Add an anamorphic bloom',
      },
    ],
  },

  {
    id: 'glitch',
    match: /\b(glitch|rgb ?split|chromatic|datamosh|vhs|retro tape)\b/i,
    plan: (p) => [
      {
        tool: 'add_effect',
        args: /\bvhs|tape\b/i.test(p)
          ? { effectType: 'vhs', params: {} }
          : { effectType: 'rgb_split', params: { offset: num(p, 10) } },
        why: 'Apply the requested glitch treatment',
      },
    ],
  },

  {
    id: 'particles',
    match: /\b(particles?|snow|embers?|dust|bokeh|sparks?|confetti)\b/i,
    plan: (p) => {
      const preset =
        /snow/i.test(p) ? 'snow' :
        /ember|fire/i.test(p) ? 'embers' :
        /bokeh/i.test(p) ? 'bokeh' :
        /spark/i.test(p) ? 'sparks' : 'dust';
      return [{
        tool: 'add_effect',
        args: { effectType: 'particles', params: { preset, color: findColor(p) ?? '#ffffff' } },
        why: `Add a ${preset} particle field`,
      }];
    },
  },

  {
    id: 'light-leak',
    match: /\b(light ?leaks?|flares?|sun ?rays?|god ?rays?|lens ?flares?)\b/i,
    plan: (p) => [{
      tool: 'add_effect',
      args: /god ?ray|sun ?ray/i.test(p)
        ? { effectType: 'godrays', params: {} }
        : /lens ?flare/i.test(p)
          ? { effectType: 'lens_flare', params: {} }
          : { effectType: 'light_leak', params: { color: findColor(p) ?? '#ff9a4d' } },
      why: 'Add the requested lighting effect',
    }],
  },

  {
    id: 'shake',
    match: /\b(shake|handheld|camera ?movement|impact|earthquake)\b/i,
    plan: (p) => [{
      tool: 'add_effect',
      args: { effectType: 'shake', params: { amplitude: num(p, 14), decay: /impact|hit|punch/i.test(p) ? 0.6 : 0 } },
      why: 'Add procedural camera shake',
    }],
  },

  {
    id: 'blur',
    match: /\b(blur|out of focus|soften|bokeh background)\b/i,
    plan: (p) => [{
      tool: 'add_effect',
      args: { effectType: 'gaussian_blur', params: { radius: num(p, 12) } },
      why: 'Apply a gaussian blur',
    }],
  },

  {
    id: 'vignette',
    match: /\b(vignette|darken (the )?edges?)\b/i,
    plan: (p) => [{ tool: 'add_effect', args: { effectType: 'vignette', params: { amount: num(p, 45) } }, why: 'Darken the frame edges' }],
  },

  {
    id: 'zoom-pulse',
    match: /\b(pulse|pump|bounce to the beat|zoom (to|on) (the )?beat)\b/i,
    plan: (p) => [{ tool: 'add_effect', args: { effectType: 'zoom_pulse', params: { bpm: num(p, 120) } }, why: 'Add a beat-locked zoom pulse' }],
  },

  {
    id: 'motion-blur',
    match: /\bmotion ?blur\b/i,
    plan: () => [{ tool: 'set_motion_blur', args: { enabled: true }, why: 'Enable per-layer motion blur' }],
  },

  {
    id: 'speed',
    match: /\b(speed|slow ?mo(tion)?|fast ?forward|time ?ramp|bullet ?time|\d+(\.\d+)?x)\b/i,
    plan: (p) => {
      if (/bullet ?time/i.test(p)) {
        return [{ tool: 'set_speed', args: { curvePreset: 'bullet_time' }, why: 'Apply a bullet-time ramp' }];
      }
      if (/slow ?mo/i.test(p)) {
        return [{ tool: 'set_speed', args: { multiplier: 0.4 }, why: 'Slow the clip down' }];
      }
      const mult = p.match(/(\d+(\.\d+)?)\s*x/i);
      return [{
        tool: 'set_speed',
        args: { multiplier: mult ? parseFloat(mult[1]) : 2 },
        why: 'Change the clip playback speed',
      }];
    },
  },

  {
    id: 'reverse',
    match: /\b(reverse|backwards|rewind)\b/i,
    plan: () => [{ tool: 'set_speed', args: { reversed: true }, why: 'Reverse the clip' }],
  },

  {
    id: 'freeze',
    match: /\b(freeze|hold (the )?frame|still frame)\b/i,
    plan: (p) => [{ tool: 'freeze_frame', args: { holdMs: num(p, 2) < 100 ? num(p, 2) * 1000 : num(p, 2000) }, why: 'Hold the current frame' }],
  },

  {
    id: 'transition',
    match: /\b(transitions?|whip ?pans?|cross ?fades?|dissolves?|wipes?|zoom transition)\b/i,
    plan: (p) => {
      const type =
        /whip/i.test(p) ? 'whip_pan' :
        /dissolve|cross ?fade|fade/i.test(p) ? 'crossfade' :
        /zoom/i.test(p) ? 'zoom_in' :
        /glitch/i.test(p) ? 'glitch' :
        /flash/i.test(p) ? 'flash' : 'crossfade';
      return [{ tool: 'apply_transition', args: { transitionType: type, durationMs: 400 }, why: `Apply a ${type} transition` }];
    },
  },

  {
    id: 'add-text',
    match: /\b(add|create|put|insert)\b.*\b(text|title|caption|headline|lower ?third)\b/i,
    plan: (p) => {
      const text = quoted(p) ?? 'Your headline';
      const color = findColor(p);
      return [{
        tool: 'add_text_layer',
        args: { text, style: { ...(color ? { color } : {}), fontSize: /\bbig|large|huge\b/i.test(p) ? 120 : 72 } },
        why: `Create a text layer reading "${text}"`,
      }];
    },
  },

  {
    id: 'add-shape',
    match: /\b(add|create|draw)\b.*\b(shape|rectangle|circle|square|star|triangle|arrow|line|box)\b/i,
    plan: (p) => {
      const kind =
        /circle|ellipse|round/i.test(p) ? 'ellipse' :
        /star/i.test(p) ? 'star' :
        /triangle/i.test(p) ? 'triangle' :
        /arrow/i.test(p) ? 'arrow' :
        /\bline\b/i.test(p) ? 'line' : 'rectangle';
      const color = findColor(p);
      return [{
        tool: 'add_shape_layer',
        args: { kind, style: color ? { fill: color } : {} },
        why: `Add a ${kind} shape layer`,
      }];
    },
  },

  {
    id: 'animate',
    match: /\b(animate|fade in|fade out|slide in|pop in|ken ?burns|spin|float|zoom in on)\b/i,
    plan: (p) => {
      const preset =
        /fade ?out/i.test(p) ? 'fade_out' :
        /fade/i.test(p) ? 'fade_in' :
        /slide.*(left|from the left)/i.test(p) ? 'slide_in_left' :
        /slide/i.test(p) ? 'slide_in_right' :
        /ken ?burns|slow (push|zoom)/i.test(p) ? 'ken_burns_in' :
        /spin|rotate in/i.test(p) ? 'spin_in' :
        /float|drift/i.test(p) ? 'float' :
        /shake/i.test(p) ? 'shake' : 'pop_in';
      return [{ tool: 'apply_motion_preset', args: { preset }, why: `Animate the layer with ${preset.replace(/_/g, ' ')}` }];
    },
  },

  {
    id: 'rotate',
    match: /\brotate\b/i,
    plan: (p) => [{ tool: 'patch_clip', args: { properties: { 'transform.rotation': num(p, 45) } }, why: 'Rotate the layer' }],
  },

  {
    id: 'scale',
    /* The context protocol resolves "this"/"that" to a concrete layer before
       we ever get here, so demonstratives are safe to accept. */
    match: /\b(scale|resize|bigger|smaller|larger|tinier|shrink|enlarge|zoom (it|this|that) (in|out))\b/i,
    plan: (p) => {
      const pct = p.match(/(\d+)\s*%/);
      const times = p.match(/(\d+(?:\.\d+)?)\s*(?:x|times)\b/i);

      let factor: number;
      if (pct) factor = parseInt(pct[1], 10) / 100;
      else if (times) factor = parseFloat(times[1]);
      else if (/\b(much|way|a lot|far)\b/i.test(p)) factor = /smaller|shrink|tinier/i.test(p) ? 0.5 : 1.6;
      else if (/\b(bit|slightly|little|touch)\b/i.test(p)) factor = /smaller|shrink|tinier/i.test(p) ? 0.9 : 1.1;
      else factor = /smaller|shrink|tinier/i.test(p) ? 0.75 : 1.25;

      return [{
        tool: 'patch_clip',
        args: { properties: { 'transform.scaleX': factor, 'transform.scaleY': factor } },
        why: `Scale the layer to ${Math.round(factor * 100)}%`,
      }];
    },
  },

  {
    id: 'nudge',
    match: /\b(move|nudge|shift|push|put|place)\b.*\b(left|right|up|down|corner|centre|center|top|bottom|side)\b/i,
    plan: (p) => {
      const distance = /\b(much|way|a lot|far)\b/i.test(p) ? 480
        : /\b(bit|slightly|little|touch)\b/i.test(p) ? 80
        : 220;

      const properties: Record<string, number> = {};

      // Corners are an absolute placement, not a nudge.
      const corner = /\b(top|upper)[- ]?(left|right)|\b(bottom|lower)[- ]?(left|right)/i.exec(p);
      if (corner || /\bcorner\b/i.test(p)) {
        const top = /top|upper/i.test(p);
        const left = /left/i.test(p);
        properties['transform.x'] = left ? -600 : 600;
        properties['transform.y'] = top ? -300 : 300;
      } else {
        if (/\bleft\b/i.test(p)) properties['transform.x'] = -distance;
        if (/\bright\b/i.test(p)) properties['transform.x'] = distance;
        if (/\bup\b|\btop\b/i.test(p)) properties['transform.y'] = -distance;
        if (/\bdown\b|\bbottom\b/i.test(p)) properties['transform.y'] = distance;
      }

      if (Object.keys(properties).length === 0) return [];
      return [{ tool: 'patch_clip', args: { properties }, why: 'Reposition the layer' }];
    },
  },

  {
    id: 'opacity',
    match: /\b(fade|opacity|transparent|translucent|see.?through|dim it)\b/i,
    plan: (p) => {
      const pct = p.match(/(\d+)\s*%/);
      const value = pct ? parseInt(pct[1], 10) / 100 : /more|increase/i.test(p) ? 0.5 : 0.75;
      return [{
        tool: 'patch_clip',
        args: { properties: { 'transform.opacity': value } },
        why: `Set opacity to ${Math.round(value * 100)}%`,
      }];
    },
  },

  {
    id: 'pop',
    /* "make it pop" is vague on purpose — treat it as a contrast/saturation lift. */
    match: /\b(pop|punchy?|punchier|vibrant|stand out|more alive|less flat)\b/i,
    plan: () => [{
      tool: 'patch_clip',
      args: {
        properties: {
          'filters.contrast': 24,
          'filters.saturation': 30,
          'filters.sharpen': 18,
        },
      },
      why: 'Lift contrast, saturation and sharpness so the shot reads stronger',
    }],
  },

  {
    id: 'center',
    match: /\b(cent(er|re)|middle of (the )?(frame|screen|canvas))\b/i,
    plan: () => [{ tool: 'patch_clip', args: { properties: { 'transform.x': 0, 'transform.y': 0 } }, why: 'Centre the layer in the frame' }],
  },

  {
    id: 'export',
    match: /\b(export|render|save (the )?video|make (the )?file)\b/i,
    plan: (p) => [{
      tool: 'render_export',
      args: { resolution: /4k/i.test(p) ? '4k' : /720/i.test(p) ? '720p' : '1080p' },
      why: 'Render the sequence to a file',
    }],
  },
];

/** Match the prompt against every rule and concatenate the plans. */
function planWithIntents(prompt: string): PlannedStep[] {
  const steps: PlannedStep[] = [];
  const seen = new Set<string>();

  for (const rule of INTENT_RULES) {
    if (!rule.match.test(prompt)) continue;
    if (seen.has(rule.id)) continue;
    seen.add(rule.id);
    steps.push(...rule.plan(prompt));
  }

  return steps;
}

/* ═══════════════════════════════════════════════════════════════════
   Model-backed planner
   ═══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════
   Conversation

   Not every prompt is an edit. "hello", "what can you do?", "why does
   this look washed out?" are all reasonable things to say to an agent
   sitting inside an editor, and answering "Nothing to do" to them makes
   the Copilot feel broken rather than careful.

   This is a plain chat turn: same endpoint, same timeline context, but
   the model is asked for prose instead of a tool plan, and no tool is
   ever executed as a result.
   ═══════════════════════════════════════════════════════════════════ */

const CHAT_SYSTEM_PROMPT = [
  'You are the assistant inside Kerf, a desktop non-linear video editor.',
  'You are talking to the person editing the project described below.',
  '',
  'You can both discuss the edit AND change it. This particular turn is a',
  'conversation, not an edit: answer in prose, do not emit JSON or tool calls.',
  'If the user is asking you to change something, say briefly what you would',
  'do and invite them to confirm. The edit runs on the next turn.',
  '',
  'Be concise and concrete. You can see their timeline, so refer to their',
  'actual clips, tracks and timecodes by name rather than speaking in general',
  'terms. Never invent clips, effects or durations that are not in the state',
  'you were given.',
].join('\n');

async function chatWithModel(
  prompt: string,
  signal: AbortSignal,
  context?: ContextEnvelope,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): Promise<string> {
  if (!modelEndpoint) throw new Error('No model endpoint configured');

  const stateText = context
    ? serializeEnvelope(context, classifyCommand(prompt))
    : snapshotContext();

  const frame = context?.frame;
  const hasImage = Boolean(frame?.dataUrl && !frame.unavailableReason);

  const userContent = hasImage
    ? [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: frame!.dataUrl.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png',
            data: frame!.dataUrl.replace(/^data:image\/[a-z]+;base64,/, ''),
          },
        },
        { type: 'text', text: `${stateText}\n\n${prompt}` },
      ]
    : `${stateText}\n\n${prompt}`;

  const response = await fetch(modelEndpoint.url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(modelEndpoint.apiKey ? { Authorization: `Bearer ${modelEndpoint.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: modelEndpoint.model,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        // Recent turns only — the timeline state is re-sent every time, so
        // older turns add tokens without adding accuracy.
        ...history.slice(-6),
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Model returned ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const text =
    typeof data?.content?.[0]?.text === 'string' ? data.content[0].text
    : typeof data?.choices?.[0]?.message?.content === 'string' ? data.choices[0].message.content
    : typeof data?.message?.content === 'string' ? data.message.content
    : '';

  if (!text.trim()) throw new Error('Model returned an empty reply');
  return text.trim();
}

async function planWithModel(
  prompt: string,
  signal: AbortSignal,
  context?: ContextEnvelope
): Promise<{ steps: PlannedStep[]; summary?: string }> {
  if (!modelEndpoint) throw new Error('No model endpoint configured');

  const kind = classifyCommand(prompt);
  const stateText = context ? serializeEnvelope(context, kind) : snapshotContext();

  /* When a frame is attached, send it as an image part so a vision model can
     actually look at the shot. Text-only models ignore the extra part. */
  const frame = context?.frame;
  const hasImage = Boolean(frame?.dataUrl && !frame.unavailableReason);

  const userContent = hasImage
    ? [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: frame!.dataUrl.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png',
            data: frame!.dataUrl.replace(/^data:image\/[a-z]+;base64,/, ''),
          },
        },
        { type: 'text', text: `${stateText}\n\nINSTRUCTION: ${prompt}` },
      ]
    : `${stateText}\n\nINSTRUCTION: ${prompt}`;

  const response = await fetch(modelEndpoint.url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(modelEndpoint.apiKey ? { Authorization: `Bearer ${modelEndpoint.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: modelEndpoint.model,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Planner returned ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const text: string =
    payload.choices?.[0]?.message?.content ??
    payload.content?.[0]?.text ??
    payload.message?.content ??
    '';

  // Models often wrap JSON in prose or a fence — take the first object.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Planner did not return a JSON plan');

  const parsed = JSON.parse(match[0]);
  const steps: PlannedStep[] = Array.isArray(parsed.steps) ? parsed.steps : [];

  // Drop anything that isn't a real tool rather than failing the whole run.
  const valid = steps.filter((s) => s && typeof s.tool === 'string' && getTool(s.tool));
  return { steps: valid, summary: parsed.summary };
}

/* ═══════════════════════════════════════════════════════════════════
   The bridge
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Conversation without a model.
 *
 * With no endpoint configured the Copilot still has something no chatbot
 * has: the actual project. So rather than apologising, it answers from
 * the timeline — what is loaded, how long it runs, what is selected —
 * which is what most opening questions are really asking anyway.
 */
function localConversationReply(prompt: string): string {
  const state = useTimelineStore.getState();
  const project = useProjectStore.getState().project;
  const p = prompt.trim().toLowerCase();

  const clipCount = state.tracks.reduce((n, t) => n + t.clips.length, 0);
  const selected = findClipById(state.tracks, state.selectedClipIds[0]);

  const projectLine =
    `You have **${project.name}** open, ${state.tracks.length} track${state.tracks.length === 1 ? '' : 's'}, ` +
    `${clipCount} clip${clipCount === 1 ? '' : 's'}, ${formatTimecode(project.durationMs, project.fps)} at ` +
    `${project.width}×${project.height} ${project.fps}fps.`;

  if (/^(hi|hey|hello|yo|hola|habari|mambo|sup|good (morning|afternoon|evening))\b/.test(p)) {
    return [
      `Hey. ${projectLine}`,
      '',
      selected ? `You have "${selected.name}" selected.` : 'Nothing is selected right now.',
      '',
      'Ask me about the edit, or tell me what to change, "make this shot warmer", "cut the silence", "add captions". Try one of the chips above if you want a starting point.',
    ].join('\n');
  }

  if (/(what can you do|help|capabilities|how do (i|you)|what are you)/.test(p)) {
    return [
      'I can read your timeline and change it. Concretely:',
      '',
      '• **Grade and colour**, "warmer", "more contrast", "cinematic teal-orange"',
      '• **Effects**, glow, grain, blur, vignette, shake, light leaks',
      '• **Cutting**, split at the playhead, trim, close gaps, remove silence',
      '• **Motion**, keyframed moves, Ken Burns, fades',
      '• **Audio**, levels, ducking, beat detection',
      '• **Captions**, transcribe and style',
      '• **Text and shapes**, titles, lower thirds, highlights',
      '',
      projectLine,
      '',
      'For anything visual, attach the frame you are looking at. Then I act on what you actually see rather than guessing.',
    ].join('\n');
  }

  if (/(what.*(timeline|project|have i|is on|loaded)|status|summar)/.test(p)) {
    const lines = state.tracks
      .filter((t) => t.clips.length > 0)
      .map((t) => `• **${t.name}** (${t.type}), ${t.clips.length} clip${t.clips.length === 1 ? '' : 's'}`);
    return [projectLine, '', ...(lines.length ? lines : ['No clips on any track yet.'])].join('\n');
  }

  // Anything else: be honest that this is the offline planner, and useful anyway.
  return [
    'No model endpoint is linked, so I am answering from the built-in planner. I can still run edits, but I cannot hold an open-ended conversation.',
    '',
    projectLine,
    '',
    'Tell me what to change and I will do it. "what can you do" lists the families I understand.',
  ].join('\n');
}

class AgentBridgeService {
  private activeRun: AgentExecutionRun | null = null;
  private listeners = new Set<AgentBridgeListener>();
  private abortController: AbortController | null = null;

  subscribe(listener: AgentBridgeListener): () => void {
    this.listeners.add(listener);
    if (this.activeRun) listener(structuredClone(this.activeRun));
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    if (!this.activeRun) return;
    const snapshot = structuredClone(this.activeRun);
    for (const listener of this.listeners) listener(snapshot);
  }

  get isRunning(): boolean {
    return this.activeRun !== null && (this.activeRun.status === 'planning' || this.activeRun.status === 'executing');
  }

  cancelActiveRun(): void {
    this.abortController?.abort();
    this.abortController = null;

    if (this.activeRun && this.isRunning) {
      this.activeRun.status = 'cancelled';
      this.activeRun.currentActivity = 'Cancelled';
      this.activeRun.finalResponse = this.activeRun.finalResponse || 'Run cancelled before it finished.';
      this.notify();
    }
  }

  async dispatchPrompt(
    prompt: string,
    agentModel: AgentModel = 'builtin',
    context?: ContextEnvelope,
    /** Prior turns, so a conversation can actually follow on. */
    chatHistory: { role: 'user' | 'assistant'; content: string }[] = []
  ): Promise<AgentExecutionRun> {
    // A second dispatch always supersedes an in-flight one.
    if (this.isRunning) this.cancelActiveRun();

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const commandKind = classifyCommand(prompt);

    this.activeRun = {
      runId: `run_${Date.now().toString(36)}`,
      prompt,
      agentModel,
      context,
      commandKind,
      status: 'planning',
      progressPct: 4,
      currentActivity: 'Reading the timeline…',
      thoughts: [],
      finalResponse: '',
      createdAt: Date.now(),
    };
    this.notify();

    try {
      /* ── Plan ── */
      if (context) {
        this.addThought(
          'status',
          `Context locked: ${summariseEnvelope(context)}.`
        );
        if (context.annotations.length > 0) {
          for (const [i, a] of context.annotations.entries()) {
            const at = a.targets[0];
            this.addThought(
              'thinking',
              `Mark ${i + 1} (${a.kind}${a.text ? ` "${a.text}"` : ''}) → ${at ? `${at.clipName}` : 'empty canvas'}.`
            );
          }
        }
      } else {
        this.addThought('thinking', 'Inspecting tracks, clips, effects and the current selection.');
      }

      let steps: PlannedStep[] = [];
      let plannerSummary: string | undefined;
      let plannerLabel = 'built-in planner';

      if (modelEndpoint) {
        this.update(14, `Planning with ${modelEndpoint.model}…`);
        try {
          const result = await planWithModel(prompt, signal, context);
          steps = result.steps;
          plannerSummary = result.summary;
          plannerLabel = modelEndpoint.model;
        } catch (err) {
          if (signal.aborted) throw err;
          this.addThought('error', `Model planner unavailable (${(err as Error).message}). Using the built-in planner.`);
        }
      }

      if (steps.length === 0) {
        this.update(18, 'Matching the instruction against known editing intents…');
        steps = planWithIntents(prompt);
      }

      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      /*
        No plan came back. What that means depends entirely on what was asked.

          • "hello", "what can you do?", "how long is this?" — the user was
            talking to us. Converse.
          • "make this warmer" — a real grading instruction we failed to
            plan. Say so, specifically. Answering that with small talk
            would be worse than the old "Nothing to do", not better.

        So the conversation path is scoped to prompts that were never edit
        instructions in the first place.
      */
      const isConversational = commandKind === 'query' || commandKind === 'unknown';

      if (steps.length === 0 && !isConversational) {
        this.activeRun.status = 'completed';
        this.activeRun.progressPct = 100;
        this.activeRun.currentActivity = 'Nothing to do';
        this.activeRun.finalResponse = this.buildNoMatchResponse(prompt, context);
        this.notify();
        return this.activeRun;
      }

      if (steps.length === 0) {
        this.update(60, 'Answering…');

        let reply: string;
        if (modelEndpoint) {
          try {
            reply = await chatWithModel(prompt, signal, context, chatHistory);
          } catch (err) {
            if (signal.aborted) throw err;
            this.addThought('error', `Chat unavailable (${(err as Error).message}). Answering locally.`);
            reply = localConversationReply(prompt);
          }
        } else {
          reply = localConversationReply(prompt);
        }

        this.activeRun.status = 'completed';
        this.activeRun.progressPct = 100;
        this.activeRun.currentActivity = 'Replied';
        this.activeRun.finalResponse = reply;
        this.notify();
        return this.activeRun;
      }

      /* The protocol already resolved which layer the user means. Stamp it
         onto any step that did not name one, so a plan can never drift onto
         the wrong clip just because the selection changed mid-run. */
      const targetId = context?.primaryTarget?.clipId;
      if (targetId) {
        steps = steps.map((step) => {
          const tool = getTool(step.tool);
          const takesClipId = tool ? 'clipId' in ((tool.schema as any)?.shape ?? {}) : false;
          if (!takesClipId || step.args.clipId !== undefined) return step;
          return { ...step, args: { ...step.args, clipId: targetId } };
        });
      }

      this.addThought(
        'thinking',
        `Planned ${steps.length} step${steps.length === 1 ? '' : 's'} via the ${plannerLabel}` +
          (targetId ? `, targeting ${context!.primaryTarget!.name}.` : '.')
      );

      /* ── Execute ── */
      this.activeRun.status = 'executing';
      const results: { step: PlannedStep; ok: boolean; data?: unknown; error?: string }[] = [];

      for (let i = 0; i < steps.length; i++) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const step = steps[i];
        const pct = 20 + Math.round(((i + 1) / steps.length) * 72);
        this.update(pct, `${step.tool.replace(/_/g, ' ')}…`);

        const result = await executeTool(step.tool, step.args, `${agentModel.toUpperCase()} Agent`);

        this.activeRun.thoughts.push({
          id: `th_${Date.now()}_${i}`,
          type: result.success ? 'tool_call' : 'error',
          content: step.why,
          toolName: step.tool,
          toolParams: step.args,
          toolResult: result.success ? result.data : result.error,
          durationMs: result.durationMs,
          ok: result.success,
          timestamp: Date.now(),
        });
        this.notify();

        results.push({ step, ok: result.success, data: result.data, error: result.error });

        // A failed step is reported but does not abandon the rest of the plan.
      }

      /* ── Summarise ── */
      const succeeded = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);

      this.activeRun.status = failed.length === results.length ? 'error' : 'completed';
      this.activeRun.progressPct = 100;
      this.activeRun.currentActivity = failed.length === 0 ? 'Done' : `Done with ${failed.length} issue${failed.length === 1 ? '' : 's'}`;
      this.activeRun.finalResponse = this.buildSummary(succeeded, failed, plannerSummary);
      this.notify();

      return this.activeRun;
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError' || signal.aborted;
      if (this.activeRun) {
        this.activeRun.status = aborted ? 'cancelled' : 'error';
        this.activeRun.currentActivity = aborted ? 'Cancelled' : 'Failed';
        this.activeRun.finalResponse = aborted
          ? 'Run cancelled. Nothing further was changed. Use ⌘Z to undo anything already applied.'
          : `Could not finish: ${(err as Error).message}`;
        this.notify();
      }
      return this.activeRun!;
    } finally {
      this.abortController = null;
    }
  }

  /* ── Response building ── */

  private buildSummary(
    succeeded: { step: PlannedStep; data?: unknown }[],
    failed: { step: PlannedStep; error?: string }[],
    plannerSummary?: string
  ): string {
    const lines: string[] = [];

    if (plannerSummary) lines.push(plannerSummary, '');

    if (succeeded.length > 0) {
      lines.push(`Applied ${succeeded.length} change${succeeded.length === 1 ? '' : 's'}:`);
      for (const r of succeeded) {
        lines.push(`• ${r.step.why}`);
      }
    }

    if (failed.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push(failed.length === 1 ? 'One step did not apply:' : `${failed.length} steps did not apply:`);
      for (const r of failed) lines.push(`• ${r.step.tool}: ${r.error}`);
    }

    if (succeeded.length > 0) {
      lines.push('', 'Everything is on the timeline now, ⌘Z undoes the whole run.');
    }

    return lines.join('\n');
  }

  private buildNoMatchResponse(prompt: string, context?: ContextEnvelope): string {
    const state = useTimelineStore.getState();
    const selected = findClipById(state.tracks, state.selectedClipIds[0]);

    // With a locked context we can be specific about what we were looking at.
    const contextLine = context
      ? `I was looking at ${context.playhead.timecode}` +
        (context.primaryTarget ? ` with "${context.primaryTarget.name}" as the target` : '') +
        (context.annotations.length > 0 ? ` and your ${context.annotations.length} mark(s) on the frame` : '') +
        '.'
      : null;

    return [
      ...(contextLine ? [contextLine] : []),
      `I could not map "${prompt}" onto an edit I know how to make.`,
      '',
      'Things I can do right now:',
      '• Colour, "make it cinematic", "boost the saturation", "cool the temperature"',
      '• VFX, "add glow", "add film grain", "snow particles", "camera shake", "VHS look"',
      '• Motion, "fade in", "ken burns", "pop in", "animate a zoom", "enable motion blur"',
      '• Structure, "cut the silence", "split here", "reverse this clip", "2x speed"',
      '• Graphics, \'add text "SALE ENDS FRIDAY"\', "add a red circle"',
      '• Audio, "detect beats and snap the cuts", "generate captions"',
      '• Delivery, "make it vertical for TikTok", "export in 4K"',
      '',
      selected
        ? `Selected layer: "${selected.name}" (${selected.type}). Ask me to change any property of it.`
        : 'Tip: select a clip first and I will act on it directly.',
    ].join('\n');
  }

  /* ── Stream helpers ── */

  private addThought(type: AgentThoughtStep['type'], content: string): void {
    if (!this.activeRun) return;
    this.activeRun.thoughts.push({
      id: `th_${Date.now()}_${this.activeRun.thoughts.length}`,
      type,
      content,
      timestamp: Date.now(),
    });
    this.notify();
  }

  private update(progressPct: number, currentActivity: string): void {
    if (!this.activeRun) return;
    this.activeRun.progressPct = progressPct;
    this.activeRun.currentActivity = currentActivity;
    this.notify();
  }
}

export const agentBridge = new AgentBridgeService();

/**
 * Exposed for the quick-action chips in the copilot drawer.
 *
 * `icon` is a NAME, not a glyph. It used to be an emoji, which meant
 * the chip's icon was whatever the OS font decided — a different
 * drawing on every platform, at a different optical weight from every
 * real icon beside it, and unstylable. The renderer maps this name to
 * the platform icon set.
 */
export const QUICK_ACTIONS: { label: string; prompt: string; icon: string }[] = [
  { label: 'Cinematic grade', prompt: 'Give it a cinematic teal and orange film look', icon: 'Film' },
  { label: 'Cut silence', prompt: 'Cut all the silence out of the dialogue', icon: 'Scissors' },
  { label: 'Beat sync', prompt: 'Detect the beats and snap the cuts to them', icon: 'Music4' },
  { label: 'Captions', prompt: 'Generate Kiswahili captions for the audio', icon: 'Subtitles' },
  { label: 'Glow', prompt: 'Add an anamorphic glow to the selected clip', icon: 'Sparkle' },
  { label: 'Ken Burns', prompt: 'Animate a slow ken burns push on this clip', icon: 'Video' },
  { label: 'Vertical', prompt: 'Reformat this for TikTok vertical 9:16', icon: 'Smartphone' },
  { label: 'Film grain', prompt: 'Add 35mm film grain', icon: 'Clapperboard' },
];
