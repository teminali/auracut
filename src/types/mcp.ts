import { ClipTransform, ClipFilters, ClipChromaKey, SpeedCurvePreset, AspectRatio, ClipType } from './edl';

export interface McpToolLogEntry {
  id: string;
  toolName: string;
  parameters: Record<string, any>;
  result: Record<string, any>;
  status: 'success' | 'error' | 'in_progress';
  timestamp: number;
  durationMs?: number;
  agentName?: string;
}

export interface McpServerStatus {
  isRunning: boolean;
  transport: 'stdio' | 'sse' | 'both';
  ssePort: number;
  connectedClientsCount: number;
  activeAgents: Array<{ id: string; name: string; connectedAt: number }>;
  totalToolCalls: number;
  uptimeSeconds: number;
}

// Complete Catalog of 50+ AuraCut MCP Tools
export const AURACUT_MCP_TOOL_NAMES = [
  // 1. Timeline & Track Operations
  'insert_clip',
  'split_clip',
  'trim_clip',
  'move_clip',
  'delete_clip',
  'ripple_delete',
  'duplicate_clip',
  'add_track',
  'remove_track',
  'reorder_tracks',
  'set_track_properties',
  'slice_and_remove_silence',
  'beat_sync_cuts',
  'close_all_gaps',

  // 2. Transform, Keyframes & Animation
  'set_clip_transform',
  'reset_clip_transform',
  'add_keyframe',
  'remove_keyframe',
  'clear_keyframes',
  'set_speed_curve',
  'reverse_clip',
  'freeze_frame',

  // 3. Shaders, Filters, Chroma Key & Transitions
  'apply_transition',
  'remove_transition',
  'apply_color_grade',
  'apply_lut',
  'apply_chroma_key',
  'apply_ai_portrait_cutout',
  'apply_video_effect',
  'remove_video_effect',

  // 4. Captions, Typography & TTS
  'generate_auto_captions',
  'create_text_clip',
  'style_captions',
  'apply_kinetic_text_animation',
  'generate_tts_voiceover',
  'translate_captions',

  // 5. Audio Processing & Sound FX
  'set_audio_parameters',
  'apply_audio_fade',
  'apply_voice_effect',
  'apply_audio_ducking',
  'add_sound_effect',
  'extract_audio_to_track',

  // 6. Project, Canvas & Export
  'set_project_aspect_ratio',
  'set_project_fps',
  'scrub_timeline',
  'play_timeline',
  'pause_timeline',
  'render_export',
  'get_export_status',
  'cancel_export',

  // 7. Media Pool & Assets
  'import_media_files',
  'delete_media_asset',
  'generate_video_proxy',
] as const;

export type AuraCutMcpToolName = typeof AURACUT_MCP_TOOL_NAMES[number];
