/* ═══════════════════════════════════════════════════════════════════
   Project serialisation.

   Object URLs from imported files cannot survive a reload, so the format
   records them and reports which assets need relinking rather than
   silently loading a project full of broken media.
   ═══════════════════════════════════════════════════════════════════ */

import { useTimelineStore } from '../store/timelineStore';
import { useProjectStore } from '../store/projectStore';
import { Track, TimelineMarker, MediaAsset, ProjectSettings, createClip, Clip } from '../types/edl';

const FORMAT_VERSION = 2;

export interface ProjectFile {
  format: 'kerf.project';
  version: number;
  savedAt: number;
  project: ProjectSettings;
  tracks: Track[];
  markers: TimelineMarker[];
  mediaPool: MediaAsset[];
}

export function serializeProject(): string {
  const timeline = useTimelineStore.getState();
  const project = useProjectStore.getState().project;

  const file: ProjectFile = {
    format: 'kerf.project',
    version: FORMAT_VERSION,
    savedAt: Date.now(),
    project,
    tracks: timeline.tracks,
    markers: timeline.markers,
    mediaPool: timeline.mediaPool,
  };

  return JSON.stringify(file, null, 2);
}

export interface LoadResult {
  ok: boolean;
  error?: string;
  /** Assets whose URL will not resolve after a reload. */
  relinkNeeded?: string[];
}

export function deserializeProject(json: string): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }

  const file = parsed as Partial<ProjectFile>;
  if (file.format !== 'kerf.project') {
    return { ok: false, error: 'That is not an Kerf project file.' };
  }
  if (!Array.isArray(file.tracks) || !file.project) {
    return { ok: false, error: 'The project file is missing its tracks or settings.' };
  }

  // Run every clip through the factory so older files gain any new fields.
  const tracks: Track[] = file.tracks.map((track) => ({
    ...track,
    collapsed: track.collapsed ?? false,
    clips: (track.clips ?? []).map((clip) => createClip(clip as unknown as Clip)),
  }));

  const relinkNeeded = (file.mediaPool ?? [])
    .filter((a) => a.url.startsWith('blob:'))
    .map((a) => a.name);

  useTimelineStore.getState().loadProject(tracks, file.markers ?? []);
  useProjectStore.getState().loadProjectSettings(file.project);

  // Restore the media pool alongside the timeline.
  useTimelineStore.setState((s) => ({ ...s, mediaPool: file.mediaPool ?? s.mediaPool }));

  return { ok: true, relinkNeeded: relinkNeeded.length > 0 ? relinkNeeded : undefined };
}

/* ── Autosave ───────────────────────────────────────────────────── */

const AUTOSAVE_KEY = 'kerf.autosave';
let autosaveTimer: number | null = null;

/** Debounced autosave to localStorage; returns a stop function. */
export function startAutosave(intervalMs = 20_000): () => void {
  const save = () => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serializeProject());
    } catch {
      // Quota exceeded on a heavy project — skip this cycle rather than throw.
    }
  };

  autosaveTimer = window.setInterval(save, intervalMs);
  return () => {
    if (autosaveTimer !== null) window.clearInterval(autosaveTimer);
    autosaveTimer = null;
  };
}

export function hasAutosave(): boolean {
  return localStorage.getItem(AUTOSAVE_KEY) !== null;
}

export function restoreAutosave(): LoadResult {
  const json = localStorage.getItem(AUTOSAVE_KEY);
  if (!json) return { ok: false, error: 'No autosave found.' };
  return deserializeProject(json);
}

export function clearAutosave(): void {
  localStorage.removeItem(AUTOSAVE_KEY);
}
