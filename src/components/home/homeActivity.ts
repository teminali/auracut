/* ═══════════════════════════════════════════════════════════════════
   The hero's activity list.

   The approved launcher shows four rows under `Resume editing`:
   unresolved cuts on a track, a skill that finished a pass, a Copilot
   suggestion awaiting review, and the last export.

   THREE OF THOSE FOUR HAVE NO SOURCE IN THIS PRODUCT. There is no
   skill-run history, no "suggestion awaiting review" queue, and no
   per-track review state. So this builds rows from what the app
   actually knows and RETURNS FEWER when it knows less — an activity
   feed is the easiest thing on a launcher to fake, and a faked one is
   the exact failure HANDOVER §3 is a catalogue of.

   What is real, and where it comes from:

     markers    `timelineStore.markers` — the ones you dropped
     copilot    `agentChatStore.messages` — the last thing it said
     export     `projectStore.lastExportPath` — where it went
     project    the recents entry itself — when you were last in it

   Each row says only what its source supports. If nothing has
   happened, the list is empty and the hero simply does not draw it.
   ═══════════════════════════════════════════════════════════════════ */

import type { RecentProject } from '../../store/recentsStore';
import type { TimelineMarker } from '../../types/edl';

export type ActivityTone = 'accent' | 'green' | 'blue' | 'dim';

export interface ActivityRow {
  id: string;
  tone: ActivityTone;
  text: string;
  /** The right-hand column. Short, and a fact. */
  meta: string;
}

function ago(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** The base name of a path, without pulling in `node:path`. */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export function buildActivity(input: {
  markers: TimelineMarker[];
  lastCopilotText: string | null;
  lastExportPath: string | null;
  recent?: RecentProject;
  now: number;
}): ActivityRow[] {
  const rows: ActivityRow[] = [];

  if (input.markers.length > 0) {
    rows.push({
      id: 'markers',
      tone: 'accent',
      text: `${input.markers.length} marker${input.markers.length === 1 ? '' : 's'} on the timeline`,
      meta: 'review',
    });
  }

  if (input.lastCopilotText) {
    /* One line, and it is the Copilot's own words rather than a
       summary this file invented for it. */
    const flat = input.lastCopilotText.replace(/\s+/g, ' ').trim();
    rows.push({
      id: 'copilot',
      tone: 'blue',
      text: flat.length > 64 ? `${flat.slice(0, 63)}…` : flat,
      meta: 'Copilot',
    });
  }

  if (input.lastExportPath) {
    rows.push({
      id: 'export',
      tone: 'green',
      text: `Last export · ${baseName(input.lastExportPath)}`,
      meta: 'done',
    });
  }

  if (input.recent) {
    /*
      `openedAt` is only a time if it is one. The bundled starter is
      rebuilt from code and can reach the wall with no timestamp, which
      printed "20694d ago" — 56 years, i.e. the epoch — under a heading
      that says "jump back in". A row is allowed to say less; it is not
      allowed to say something false.
    */
    const age = input.now - input.recent.openedAt;
    const plausible = Number.isFinite(input.recent.openedAt)
      && input.recent.openedAt > 0
      && age >= 0
      && age < 365 * 24 * 60 * 60 * 1000;
    rows.push({
      id: 'opened',
      tone: 'dim',
      text: `${input.recent.clipCount} clips · ${input.recent.aspectRatio}`,
      meta: plausible ? ago(age) : 'this project',
    });
  }

  return rows;
}

/** "4K" / "1080p" / "720p" / the raw height. What the chip says. */
export function resolutionLabel(width: number, height: number): string {
  const long = Math.max(width, height);
  if (long >= 3840) return '4K';
  if (long >= 2560) return '2K';
  if (long >= 1920) return '1080p';
  if (long >= 1280) return '720p';
  return `${Math.min(width, height)}p`;
}
