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
import { STARTER_ID, STARTER_NAME, STARTER_DURATION_MS } from '../engine/starterProject';

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
  /**
   * A project the app can rebuild from code rather than reload from a
   * snapshot. Used for the bundled starter, so a first run has something
   * real on the wall without shipping a serialized blob that would go
   * stale the moment the EDL changes.
   */
  starter?: string;
}

interface RecentsState {
  recents: RecentProject[];
  remember: (entry: Omit<RecentProject, 'openedAt'>) => void;
  /**
   * Attach a rendered frame to an entry that had none.
   *
   * Separate from `remember` on purpose: a backfilled poster must not
   * move the project to the top of the list. Recency means "when you
   * last worked on it", and reordering the wall because a thumbnail
   * finished rendering would be the list lying about what you did.
   */
  setPoster: (id: string, posterUrl: string) => void;
  forget: (id: string) => void;
  clear: () => void;
}

const KEY = 'kerf.recents.v1';
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

/**
 * The starter entry, shown when there is nothing else.
 *
 * Not persisted and not counted as real work: it is dropped from the
 * list the moment the user has a project of their own, so it never
 * competes for space with something they actually made.
 */
const STARTER_ENTRY: RecentProject = {
  id: STARTER_ID,
  name: STARTER_NAME,
  durationMs: STARTER_DURATION_MS,
  aspectRatio: '16:9',
  // Counted from the built project, not estimated. It said 88 and the
  // builder makes 87 — invisible while this was a small tile, and now
  // it is the caption on the largest card on the screen.
  clipCount: 87,
  openedAt: 0,
  starter: 'kerf-brand-film',
};

function withStarter(recents: RecentProject[]): RecentProject[] {
  const real = recents.filter((r) => !r.starter);
  return real.length > 0 ? real : [STARTER_ENTRY];
}

export const useRecentsStore = create<RecentsState>((set, get) => ({
  recents: withStarter(load()),

  remember: (entry) => {
    const next = [
      { ...entry, openedAt: Date.now() },
      // Same project opened again moves to the front rather than duplicating.
      // Real work displaces the starter rather than sitting beside it.
      ...get().recents.filter((r) => r.id !== entry.id && !r.starter),
    ].slice(0, LIMIT);

    persist(next);
    set({ recents: next });
  },

  setPoster: (id, posterUrl) => {
    const next = get().recents.map((r) => (r.id === id ? { ...r, posterUrl } : r));
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
