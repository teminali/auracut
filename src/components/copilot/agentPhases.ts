/* ═══════════════════════════════════════════════════════════════════
   Reading a run as work, not as a log.

   A turn is a flat list of tool calls. Shown flat it is a wall of names
   that tells you an agent is busy and nothing about what it is doing.
   Grouped, the same list reads as a sentence: it looked at the timeline,
   made three edits, then checked the frame.

   The grouping is positional as well as categorical — `get_frame_context`
   before any edit is the agent orienting itself; the same call after an
   edit is the agent checking its own work. Same tool, different meaning,
   and the difference is the interesting part.
   ═══════════════════════════════════════════════════════════════════ */

import { AgentToolCall } from '../../store/claudeAgentStore';

export type PhaseKind = 'understand' | 'edit' | 'verify' | 'render' | 'shell' | 'note';

export interface PhaseGroup {
  id: string;
  kind: PhaseKind;
  label: string;
  calls: AgentToolCall[];
}

/** TeminaliCut tools that only read. */
const READ_TOOLS = new Set([
  'describe_timeline', 'list_properties', 'list_effects', 'get_frame_context',
  'check_command_readiness', 'resolve_target', 'describe_layer_at_point',
  'list_media_pool', 'list_capability_gaps', 'check_transcription_ready',
  'analyze_audio', 'export_captions',
]);

/** Claude Code's own tools, split by whether they change anything. */
const SHELL_READ = new Set([
  'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'NotebookRead', 'TodoWrite', 'ToolSearch',
]);
const SHELL_WRITE = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']);

const PHASE_LABEL: Record<PhaseKind, string> = {
  understand: 'Understanding',
  edit: 'Editing',
  verify: 'Checking the result',
  render: 'Rendering',
  shell: 'Working on your computer',
  note: 'Noting a gap',
};

export function phaseLabel(kind: PhaseKind): string {
  return PHASE_LABEL[kind];
}

/** Strip the MCP prefix so a name can be matched and shown. */
export function bareToolName(name: string): string {
  return name.replace(/^mcp__kerf__/, '');
}

export function isEditorTool(name: string): boolean {
  return name.startsWith('mcp__kerf__');
}

function classify(name: string, hasEdited: boolean): PhaseKind {
  const bare = bareToolName(name);

  if (bare === 'render_export') return 'render';
  if (bare === 'report_capability_gap') return 'note';

  if (isEditorTool(name)) {
    // A read after an edit is the agent verifying, not orienting.
    if (READ_TOOLS.has(bare)) return hasEdited ? 'verify' : 'understand';
    return 'edit';
  }

  if (SHELL_READ.has(bare)) return hasEdited ? 'verify' : 'understand';
  if (SHELL_WRITE.has(bare)) return 'shell';
  return 'shell';
}

/** Fold a turn's calls into consecutive same-phase groups, in order. */
export function groupCalls(calls: AgentToolCall[]): PhaseGroup[] {
  const groups: PhaseGroup[] = [];
  let hasEdited = false;

  for (const call of calls) {
    const kind = classify(call.name, hasEdited);
    /*
      Only work that CHANGES something flips the run into "checking".
      Counting every shell call meant a lookup like ToolSearch relabelled
      every later read as verification of an edit that never happened.
    */
    if (kind === 'edit' || kind === 'render' || kind === 'shell') hasEdited = true;

    const last = groups[groups.length - 1];
    if (last && last.kind === kind) {
      last.calls.push(call);
    } else {
      groups.push({ id: `${kind}_${groups.length}`, kind, label: PHASE_LABEL[kind], calls: [call] });
    }
  }

  return groups;
}

/* ── Reading one call ───────────────────────────────────────────── */

/**
 * The one thing this call was about — a clip name, a file, a query —
 * so a collapsed row says `patch_clip · Opening shot` rather than just
 * the verb. This is the whole difference between a log and a summary.
 */
export function callSubject(call: AgentToolCall): string | null {
  const input = call.input ?? {};
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = input[key];
      if (typeof value === 'string' && value.trim()) return value;
      if (typeof value === 'number') return String(value);
    }
    return null;
  };

  const bare = bareToolName(call.name);

  if (bare === 'Bash') {
    const cmd = pick('command');
    return cmd ? cmd.split('\n')[0].slice(0, 60) : null;
  }
  if (bare === 'Read' || bare === 'Write' || bare === 'Edit') {
    const file = pick('file_path', 'path');
    return file ? file.split('/').pop()! : null;
  }

  const direct = pick(
    'clipId', 'effectType', 'effect', 'text', 'transitionType', 'preset',
    'kind', 'assetId', 'path', 'query', 'instruction', 'name', 'label'
  );
  if (direct) return direct.length > 48 ? `${direct.slice(0, 46)}…` : direct;

  const ids = input.clipIds ?? input.assetIds;
  if (Array.isArray(ids) && ids.length > 0) return `${ids.length} clips`;

  return null;
}

export interface CallChange {
  path: string;
  from: unknown;
  to: unknown;
}

/**
 * Property changes this call made, read out of its result.
 *
 * `patch_clip` reports before/after per path, which is what lets a
 * collapsed row expand into `filters.saturation  20 → 45` instead of a
 * dump of the arguments that were sent. Arguments say what was asked
 * for; this says what happened.
 */
export function callChanges(call: AgentToolCall): CallChange[] {
  if (!call.resultPreview) return [];

  try {
    const start = call.resultPreview.indexOf('{');
    if (start < 0) return [];
    const parsed = JSON.parse(call.resultPreview.slice(start)) as {
      changes?: CallChange[];
      data?: { changes?: CallChange[] };
    };
    const changes = parsed.changes ?? parsed.data?.changes;
    return Array.isArray(changes) ? changes.slice(0, 8) : [];
  } catch {
    // A truncated preview is normal — no diff is better than a wrong one.
    return [];
  }
}

/** Compact display for a property value. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
  }
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'string') return value.length > 24 ? `${value.slice(0, 22)}…` : value;
  return JSON.stringify(value).slice(0, 24);
}

/** `filters.saturation` → `saturation`, keeping a group hint. */
export function formatPath(path: string): string {
  const parts = path.split('.');
  return parts.length > 1 ? parts.slice(-2).join('.') : path;
}
