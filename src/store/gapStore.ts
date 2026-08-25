/* ═══════════════════════════════════════════════════════════════════
   Capability gaps.

   When the agent is asked for something the editor genuinely cannot do,
   saying "I can't" is only half an answer. The other half is that this
   is the single most valuable signal a product gets: a real user asking
   for a real thing, in their own words, at the moment they wanted it.

   Spoken refusals evaporate. These are written down, survive restarts,
   and export as a list you can work from.
   ═══════════════════════════════════════════════════════════════════ */

import { create } from 'zustand';

export interface CapabilityGap {
  id: string;
  /** What the user actually asked for, in their words where possible. */
  request: string;
  /** Why the editor could not do it. */
  reason: string;
  /** The tool or feature that would close the gap, if the agent could name one. */
  suggestion?: string;
  /** What was done instead, when a workaround was possible. */
  workaround?: string;
  /** Raised more than once? That is the prioritisation signal. */
  count: number;
  firstSeen: number;
  lastSeen: number;
  resolved: boolean;
}

interface GapState {
  gaps: CapabilityGap[];
  record: (gap: Omit<CapabilityGap, 'id' | 'count' | 'firstSeen' | 'lastSeen' | 'resolved'>) => CapabilityGap;
  toggleResolved: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  exportMarkdown: () => string;
}

const STORAGE_KEY = 'auracut.capability-gaps.v1';

function load(): CapabilityGap[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CapabilityGap[]) : [];
  } catch {
    return [];
  }
}

function save(gaps: CapabilityGap[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gaps));
  } catch {
    /* quota or private mode — the in-memory list still works this session */
  }
}

/** Loose match so "page curl transition" and "page-curl transition" merge. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export const useGapStore = create<GapState>((set, get) => ({
  gaps: load(),

  record: (input) => {
    const key = normalise(input.request);
    const existing = get().gaps.find((g) => normalise(g.request) === key);
    const now = Date.now();

    if (existing) {
      // Same ask again: bump the count rather than adding a duplicate row.
      const updated: CapabilityGap = { ...existing, count: existing.count + 1, lastSeen: now };
      const gaps = get().gaps.map((g) => (g.id === existing.id ? updated : g));
      set({ gaps });
      save(gaps);
      return updated;
    }

    const gap: CapabilityGap = {
      id: `gap_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      ...input,
      count: 1,
      firstSeen: now,
      lastSeen: now,
      resolved: false,
    };
    const gaps = [gap, ...get().gaps];
    set({ gaps });
    save(gaps);
    return gap;
  },

  toggleResolved: (id) => {
    const gaps = get().gaps.map((g) => (g.id === id ? { ...g, resolved: !g.resolved } : g));
    set({ gaps });
    save(gaps);
  },

  remove: (id) => {
    const gaps = get().gaps.filter((g) => g.id !== id);
    set({ gaps });
    save(gaps);
  },

  clear: () => {
    set({ gaps: [] });
    save([]);
  },

  /** A backlog you can paste straight into an issue tracker. */
  exportMarkdown: () => {
    const gaps = [...get().gaps].sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);
    if (gaps.length === 0) return '# AuraCut capability gaps\n\nNothing recorded yet.\n';

    const lines = ['# AuraCut capability gaps', ''];
    for (const g of gaps) {
      lines.push(`## ${g.request}${g.count > 1 ? `  _(asked ${g.count}×)_` : ''}`);
      lines.push('');
      lines.push(`- **Blocked by:** ${g.reason}`);
      if (g.suggestion) lines.push(`- **Would need:** ${g.suggestion}`);
      if (g.workaround) lines.push(`- **Worked around with:** ${g.workaround}`);
      lines.push(`- **Last asked:** ${new Date(g.lastSeen).toISOString().slice(0, 10)}`);
      if (g.resolved) lines.push('- **Status:** resolved');
      lines.push('');
    }
    return lines.join('\n');
  },
}));
