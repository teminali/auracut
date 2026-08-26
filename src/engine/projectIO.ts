/* ═══════════════════════════════════════════════════════════════════
   Project serialisation.

   Object URLs from imported files cannot survive a reload, so the format
   records them and reports which assets need relinking rather than
   silently loading a project full of broken media.
   ═══════════════════════════════════════════════════════════════════ */

import { useTimelineStore } from '../store/timelineStore';
import { useProjectStore } from '../store/projectStore';
import { Track, TimelineMarker, MediaAsset, ProjectSettings, createClip, Clip } from '../types/edl';

export const FORMAT_VERSION = 2;

/* ═══════════════════════════════════════════════════════════════════
   Migration.

   `version` was written into every project file and read by nothing. Two
   different failures hid behind that:

   - An OLD file loaded as though it were current. That mostly worked
     because every clip is run through `createClip`, which fills in
     fields added since — but "mostly worked" is not a format policy, and
     it only covers fields, not changed meanings.
   - A NEWER file also loaded, silently, and was then interpreted by code
     that predates it. That is the dangerous one: the user opens a
     project made by a later Kerf, sees something subtly wrong, saves,
     and the newer data is gone.

   So: refuse the future, migrate the past, and say which happened.

   Each entry takes a file at version N and returns one at N+1. Add a
   step whenever the format changes meaning; adding a FIELD needs
   nothing, because `createClip` already backfills those.
   ═══════════════════════════════════════════════════════════════════ */

export type AnyFile = Record<string, unknown>;

const MIGRATIONS: Record<number, (file: AnyFile) => AnyFile> = {
  /*
    1 -> 2. Pre-versioning files, from before `version` was written at
    all. Nothing structural to change: the clip factory backfills the
    fields, and this step exists so the ladder is walked and the file is
    stamped rather than assumed current.
  */
  1: (file) => ({ ...file, version: 2 }),
};

/* Exported for the format tests: this is the whole ladder, and it is
   decidable without a store, a file or a running app. */
export function migrateProjectFile(file: AnyFile): { file: AnyFile; from: number; steps: number } {
  const from = typeof file.version === 'number' && file.version > 0 ? file.version : 1;
  let current: AnyFile = { ...file, version: from };
  let steps = 0;

  for (let v = from; v < FORMAT_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) break;
    current = step(current);
    steps++;
  }

  return { file: current, from, steps };
}

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
  /** Set when the file was written by an older Kerf and was upgraded. */
  migratedFrom?: number;
}

export function deserializeProject(json: string): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }

  /*
    `null` is valid JSON, so it clears the try/catch above and then
    throws a TypeError on the property read — the one input that could
    make this function raise instead of returning a LoadResult, which
    every caller assumes it never does. A four-byte truncated file, or an
    autosave slot written as "null", is enough. Found by the unit tests.
  */
  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, error: 'That is not a Kerf project file.' };
  }

  const raw = parsed as AnyFile;
  if (raw.format !== 'kerf.project') {
    return { ok: false, error: 'That is not a Kerf project file.' };
  }

  /*
    Refuse the future. A file from a later Kerf will usually parse, and
    that is the problem — it would load, be interpreted by older code,
    and be written back with whatever it did not understand dropped.
  */
  const declared = typeof raw.version === 'number' ? raw.version : 1;
  if (declared > FORMAT_VERSION) {
    return {
      ok: false,
      error:
        `This project was saved by a newer version of Kerf (project format ${declared}; ` +
        `this build reads up to ${FORMAT_VERSION}). Opening it here would quietly drop ` +
        'whatever that version added. Update Kerf and open it again.',
    };
  }

  const { file: upgraded, from, steps } = migrateProjectFile(raw);
  if (from < FORMAT_VERSION && steps === 0) {
    return {
      ok: false,
      error:
        `This project uses format ${from}, and this build has no upgrade path from it ` +
        `to ${FORMAT_VERSION}.`,
    };
  }

  const file = upgraded as unknown as Partial<ProjectFile>;
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

  return {
    ok: true,
    relinkNeeded: relinkNeeded.length > 0 ? relinkNeeded : undefined,
    ...(from < FORMAT_VERSION ? { migratedFrom: from } : {}),
  };
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
