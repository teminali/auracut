/* ═══════════════════════════════════════════════════════════════════
   The editor follows the agent.

   When the Copilot works, the editor moves the way it would if you were
   doing the work yourself: the Transitions panel opens while it browses
   transitions, the clip it edits gets selected, the playhead goes to
   what it is looking at.

   NOTHING HERE IS SIMULATED, and that is the whole design constraint.
   There is no fake cursor and no artificial delay. Every movement is a
   real consequence of a tool that really ran — the effects panel opens
   because `add_effect` genuinely operated on the effects registry, the
   clip is selected because that is genuinely the clip that changed.

   A version of this that animated a pretend pointer around, or slept so
   the user could watch, would be exactly the kind of theatre the rest of
   this codebase has been having removed from it — and the sleeping kind
   would make every edit slower and more expensive, which is the opposite
   of the point.

   Cost: a few zustand writes per tool call. At the 3–20 calls a turn
   takes, that is nothing. The only real risk is strobing when a burst of
   calls each want a different panel, which `SETTLE_MS` handles by
   letting the last one win.
   ═══════════════════════════════════════════════════════════════════ */

import { useLayoutStore, SidebarTab } from '../store/layoutStore';
import { useTimelineStore, findClipById } from '../store/timelineStore';

/**
 * Rapid tab switches read as a flicker rather than as navigation, so a
 * burst settles on wherever the agent ended up rather than showing
 * every step of how it got there.
 */
const SETTLE_MS = 140;

let pendingTab: SidebarTab | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;

/** Which part of the editor a tool's work belongs to. */
const TOOL_PANEL: Record<string, SidebarTab> = {
  list_effects: 'effects',
  add_effect: 'effects',
  remove_effect: 'effects',
  set_effect_param: 'effects',
  animate_effect_param: 'effects',
  copy_effects: 'effects',

  apply_transition: 'transitions',

  add_text_layer: 'text',
  add_shape_layer: 'text',
  list_fonts: 'text',

  import_captions: 'captions',
  export_captions: 'captions',
  generate_auto_captions: 'captions',
  check_transcription_ready: 'captions',
  setup_transcription: 'captions',

  detect_beats: 'audio',
  remove_silence: 'audio',
  analyze_audio: 'audio',
  generate_sound_effect: 'audio',
  list_sound_effects: 'audio',

  import_media_from_path: 'media',
  list_media_pool: 'media',
  insert_clip: 'media',
  create_grid_layout: 'media',

  suggest_broll: 'ai',
  report_capability_gap: 'ai',
};

/** Tools whose first argument names a clip worth revealing. */
const REVEALS_CLIP = new Set([
  'patch_clip', 'add_effect', 'remove_effect', 'set_effect_param', 'animate_effect_param',
  'set_motion_path', 'apply_motion_preset', 'add_keyframes', 'set_motion_blur',
  'split_clip', 'trim_clip', 'move_clip', 'set_speed', 'freeze_frame',
  'apply_transition', 'copy_effects', 'add_text_layer', 'add_shape_layer',
  'add_adjustment_layer', 'insert_clip',
]);

function scheduleTab(tab: SidebarTab): void {
  pendingTab = tab;
  if (settleTimer) return;

  settleTimer = setTimeout(() => {
    settleTimer = null;
    const target = pendingTab;
    pendingTab = null;
    if (!target) return;

    const layout = useLayoutStore.getState();
    if (layout.activeTab !== target) layout.setActiveTab(target);
    // A panel the agent is working in is not much use collapsed.
    if (layout.isSidebarCollapsed) layout.toggleSidebar();
  }, SETTLE_MS);
}

/** Clip ids the agent touched most recently, for a brief highlight. */
let touched: string[] = [];
let touchedAt = 0;

export function getAgentTouched(): { ids: string[]; at: number } {
  return { ids: touched, at: touchedAt };
}

function revealClip(clipId: string): void {
  const state = useTimelineStore.getState();
  const clip = findClipById(state.tracks, clipId);
  if (!clip) return;

  touched = [clipId];
  touchedAt = Date.now();

  // Selecting is what puts it in the inspector, which is where the
  // change the agent just made is actually legible.
  if (state.selectedClipIds[0] !== clipId) state.selectClips([clipId]);

  /*
    Park the playhead ON the clip if it is not already, so the preview
    shows the thing that changed. Never move it while playing — that
    would fight the transport for control of the same value.
  */
  if (!state.isPlaying) {
    const start = clip.startTimeMs;
    const end = start + clip.durationMs;
    if (state.playheadMs < start || state.playheadMs >= end) {
      state.setPlayheadMs(Math.round(start + clip.durationMs / 2));
    }
  }
}

/**
 * Called after a tool runs. Never throws — a presentation concern must
 * not be able to fail a tool call that already succeeded.
 */
export function followToolCall(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown
): void {
  try {
    if (!useLayoutStore.getState().followAgent) return;

    const panel = TOOL_PANEL[toolName];
    if (panel) scheduleTab(panel);

    if (!REVEALS_CLIP.has(toolName)) return;

    /*
      Prefer the id the tool REPORTS over the one it was given. `clipId`
      in the arguments may be "selected", a name, or absent — the result
      carries the id that was actually resolved and acted on.
    */
    const data = result as { clipId?: unknown; seam?: unknown; clips?: unknown } | null;
    const reported =
      typeof data?.clipId === 'string'
        ? data.clipId
        : Array.isArray(data?.seam) && typeof data.seam[0] === 'string'
          ? (data.seam[0] as string)
          : Array.isArray(data?.clips) && data.clips.length > 0
            ? ((data.clips[0] as { clipId?: string })?.clipId ?? null)
            : null;

    const fallback = typeof args.clipId === 'string' ? args.clipId : null;
    const id = reported ?? fallback;
    if (id) revealClip(id);
  } catch {
    /* Following is decoration; never let it break the edit. */
  }
}

/** Drop any queued movement — used when a run is stopped. */
export function cancelFollowing(): void {
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = null;
  pendingTab = null;
  touched = [];
}
