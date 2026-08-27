/* ═══════════════════════════════════════════════════════════════════
   Rendering a project's poster frame without opening it.

   The home screen's whole argument is that a project tile shows a
   frame from that project (§7 rule 1) — a wall of grey rectangles is a
   file dialog with extra steps. Until now the only frame that existed
   was the one captured on the way OUT of the editor, so a project you
   had never left had no poster and fell back to an icon on a gradient.

   `captureFrame` takes tracks and a project as ARGUMENTS and makes its
   own canvas, so a stored snapshot can be drawn without touching the
   live stores. That matters: the home screen still holds whatever
   project was last open, and a tool tile enters the editor with it, so
   deserialising into the stores to make a thumbnail would silently
   throw away the user's work.

   Two things this gets right that a naive version would not:

     · **It waits for decode.** `captureFrame` reports `mediaPending`,
       and the compositor draws a dark gradient for media that has not
       arrived. Capturing immediately produces a near-black thumbnail
       for every project with video in it — which looks like a
       correctly rendered dark shot and is the failure NEXT.md §3
       describes.
     · **It does not sample at zero.** The first frame of an edit is
       very often a title card, a fade-in from black, or nothing at
       all. It samples a third of the way in.
   ═══════════════════════════════════════════════════════════════════ */

import { migrateProjectFile } from './projectIO';
import { captureFrame } from './frameCapture';
import { getContentEndMs } from '../store/timelineStore';
import type { Track, ProjectSettings } from '../types/edl';

interface AnyProjectFile {
  format?: string;
  version?: number;
  project?: ProjectSettings;
  tracks?: Track[];
}

/** How long to let media decode before settling for what is there. */
const DECODE_BUDGET_MS = 2500;
const POLL_MS = 120;

export interface PosterResult {
  dataUrl: string | null;
  /** Why there is no poster, when there is not one. Never silent. */
  reason?: 'not-a-project' | 'empty' | 'no-canvas' | 'still-decoding';
}

export async function posterFromSnapshot(json: string): Promise<PosterResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { dataUrl: null, reason: 'not-a-project' };
  }
  if (!parsed || typeof parsed !== 'object') return { dataUrl: null, reason: 'not-a-project' };

  const raw = parsed as AnyProjectFile;
  if (raw.format !== 'kerf.project') return { dataUrl: null, reason: 'not-a-project' };

  /* Same migration ladder the loader uses. A poster rendered from a
     file this build cannot read would be a picture of a bug. */
  let tracks: Track[];
  let project: ProjectSettings;
  try {
    const { file } = migrateProjectFile(raw as never);
    const upgraded = file as unknown as AnyProjectFile;
    if (!upgraded.tracks || !upgraded.project) return { dataUrl: null, reason: 'not-a-project' };
    tracks = upgraded.tracks;
    project = upgraded.project;
  } catch {
    return { dataUrl: null, reason: 'not-a-project' };
  }

  const contentEnd = getContentEndMs(tracks);
  if (contentEnd <= 0) return { dataUrl: null, reason: 'empty' };

  const atMs = Math.round(contentEnd * 0.33);

  const deadline = Date.now() + DECODE_BUDGET_MS;
  let frame = captureFrame(tracks, project, atMs);

  /*
    Poll until the media the compositor wanted has arrived. The first
    call is what STARTS the decode — the media cache is populated as a
    side effect of the draw — so this loop is not merely waiting, it is
    redrawing with more of the picture available each time.
  */
  while (frame.mediaPending.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    frame = captureFrame(tracks, project, atMs);
  }

  if (!frame.dataUrl) return { dataUrl: null, reason: 'no-canvas' };

  /* Report a frame that never finished decoding rather than passing off
     a placeholder gradient as the project's own picture. */
  if (frame.mediaPending.length > 0) {
    return { dataUrl: frame.dataUrl, reason: 'still-decoding' };
  }
  return { dataUrl: frame.dataUrl };
}
