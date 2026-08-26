/* ═══════════════════════════════════════════════════════════════════
   Recent projects.

   The home screen needs to show real work, not a grid of grey
   rectangles. Every entry carries a poster frame rendered from the
   actual project, so the wall is recognisable at a glance — which is
   the entire reason a home screen exists rather than a file dialog.

   Persisted to localStorage rather than a file, because a recents list
   is per-machine state and losing it costs nothing.
   ═══════════════════════════════════════════════════════════════════ */

import { create } from 'zustand';

export interface RecentProject {
  id: string;
  name: string;
  /** Data URL of a frame rendered from the project itself. */
  posterUrl?: string;
  durationMs: number;
  aspectRatio: string;
  clipCount: number;
  openedAt: number;
  /** The saved file, when it came from or went to disk. */
  filePath?: string;
  /** The project itself, so it can be reopened without a file. */
  snapshot?: string;
}

interface RecentsState {
  recents: RecentProject[];
  remember: (entry: Omit<RecentProject, 'openedAt'>) => void;
  forget: (id: string) => void;
  clear: () => void;
}

const KEY = 'auracut.recents.v1';
/* Snapshots hold whole projects; a long list would blow the storage
   quota and take the autosave down with it. */
const LIMIT = 12;

function load(): RecentProject[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RecentProject[]) : [];
  } catch {
    return [];
  }
}

function persist(recents: RecentProject[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(recents));
  } catch {
    /*
      Quota exceeded. Drop the snapshots — they are the bulk — and keep
      the list itself, which is what the home screen actually needs.
    */
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify(recents.map((r) => ({ ...r, snapshot: undefined })))
      );
    } catch {
      /* give up rather than throw during a render */
    }
  }
}

export const useRecentsStore = create<RecentsState>((set, get) => ({
  recents: load(),

  remember: (entry) => {
    const next = [
      { ...entry, openedAt: Date.now() },
      // Same project opened again moves to the front rather than duplicating.
      ...get().recents.filter((r) => r.id !== entry.id),
    ].slice(0, LIMIT);

    persist(next);
    set({ recents: next });
  },

  forget: (id) => {
    const next = get().recents.filter((r) => r.id !== id);
    persist(next);
    set({ recents: next });
  },

  clear: () => {
    persist([]);
    set({ recents: [] });
  },
}));
