/* ═══════════════════════════════════════════════════════════════════
   Sound design for a take.

   A click you can hear is the difference between watching a recording
   and watching someone use something. It is also the cheapest possible
   upgrade: the sounds are SYNTHESISED by `sfxEngine`, so there is
   nothing to license, nothing to download, and nothing to 404.

   Two layers, and they do different jobs:

     tick    one per real click, very quiet. Ambience. You should not
             notice it; you should notice its absence.
     whoosh  one per zoom push, quieter still and slightly ahead of the
             move. Air, not a sound effect. It is what makes a push feel
             like a camera rather than a scale transform.

   ── Real files, in the take's own folder ───────────────────────────

   `media:writeTemp` exists and would work and puts the file under
   os.tmpdir(), where it lives until the next reboot. Fine for a sound
   somebody auditioned; not fine for the click track of a recording they
   may open next month, which would come back with every sound relinked.
   A take is a folder, so `recorder:writeTakeAsset` puts them in it.

   ── Why individual clips rather than one rendered track ────────────

   Rendering every tick into a single WAV would be faster to export, one
   file and one clip. It would also be the one place in this whole
   feature where something arrives as a render rather than as an edit,
   and the ability to grab one sound and delete it is the point. The cap
   below is the price of that, and it is stated out loud rather than
   applied quietly.
   ═══════════════════════════════════════════════════════════════════ */

import { useTimelineStore } from '../store/timelineStore';
import { MediaAsset } from '../types/edl';
import { InputEvent } from '../types/electron';
import { renderSfx, SfxKind } from './sfxEngine';
import { ZoomMoment, ZoomShape } from './cursorZoom';

export interface SoundOptions {
  /** A tick on every real click. */
  clicks: boolean;
  /** Air under every zoom push. */
  whooshes: boolean;
  clickVolume: number;
  whooshVolume: number;
}

export const DEFAULT_SOUND: SoundOptions = {
  clicks: true,
  whooshes: true,
  clickVolume: 0.2,
  whooshVolume: 0.13,
};

/**
 * The ceiling on click ticks.
 *
 * Every clip becomes one `-i` and one `amix` input in the export
 * command, and a filtergraph with several hundred inputs is where
 * ffmpeg starts being slow and then stops being reliable. Eighty covers
 * a normal take; a take that exceeds it is told how many were dropped.
 */
const MAX_TICKS = 80;

const store = () => useTimelineStore.getState();

export interface SoundReport {
  placed: number;
  notes: string[];
}

export interface SoundKit {
  click?: MediaAsset;
  whoosh?: MediaAsset;
  notes: string[];
}

/**
 * Synthesise and write the two sounds, once each.
 *
 * Split from the placement below because it is the only ASYNC part of
 * building a project, and because it renders audio offline and writes
 * files — neither of which belongs inside the store transaction the rest
 * of the assembly runs in. Prepare first, place inside.
 *
 * Each kind is rendered ONCE and every placement re-uses that one asset.
 * Rendering per click would produce eighty identical files, eighty pool
 * entries, and eighty offline renders for no difference anybody could
 * hear.
 */
export async function prepareSoundKit(
  takeDir: string,
  need: { clicks: boolean; whooshes: boolean }
): Promise<SoundKit> {
  const notes: string[] = [];
  const api = window.electronAPI;
  if (!api?.recorder) {
    return { notes: ['Sound design needs the desktop app, so none was added.'] };
  }

  const provide = async (kind: SfxKind, seconds: number, label: string): Promise<MediaAsset | undefined> => {
    try {
      const rendered = await renderSfx(kind, seconds);
      const written = await api.recorder.writeTakeAsset(takeDir, `${kind}.wav`, rendered.wav);
      if (!written.ok || !written.url) {
        notes.push(`Could not write the ${label} sound: ${written.error ?? 'unknown error'}`);
        return undefined;
      }
      return {
        id: `media_sfx_${kind}_${Date.now().toString(36)}`,
        name: `${label}.wav`,
        type: 'audio',
        url: written.url,
        thumbnailUrl: '',
        durationMs: rendered.durationMs,
        fileSizeFormatted: `${Math.max(1, Math.round(rendered.wav.byteLength / 1024))} KB`,
        codec: 'WAV 48kHz · synthesised',
      };
    } catch (err) {
      notes.push(`Could not synthesise the ${label} sound: ${(err as Error).message}`);
      return undefined;
    }
  };

  return {
    click: need.clicks ? await provide('click', 0.1, 'Click') : undefined,
    whoosh: need.whooshes ? await provide('whoosh', 0.5, 'Zoom air') : undefined,
    notes,
  };
}

/** Lay the prepared kit onto a track. Synchronous, so it can run inside the transaction. */
export function placeSoundDesign(
  trackId: string,
  kit: SoundKit,
  events: InputEvent[],
  moments: ZoomMoment[],
  shape: ZoomShape,
  options: Partial<SoundOptions> = {}
): SoundReport {
  const o = { ...DEFAULT_SOUND, ...options };
  const notes = [...kit.notes];
  let placed = 0;

  /*
    Into the pool, HERE rather than in `prepareSoundKit`.
    `assembleRecording` empties the media pool right after `loadProject`,
    which happens between preparing the kit and placing it — so an asset
    registered during preparation is wiped before it is ever used, and
    the sounds end up on the timeline with no pool entry to relink from.
    Found by a pool that reported two assets while five sound clips were
    playing.
  */
  const used = new Set<string>();
  const place = (asset: MediaAsset, atMs: number, volume: number, name: string) => {
    if (!used.has(asset.id)) {
      store().addMediaAsset(asset);
      used.add(asset.id);
    }
    const clipId = store().insertClip(trackId, asset, Math.max(0, Math.round(atMs)));
    if (clipId) {
      store().patchClip(clipId, { name, 'audio.volume': volume });
      placed += 1;
    }
  };

  /* ── Ticks ── */
  if (o.clicks && kit.click) {
    const clicks = events.filter((e) => e.kind === 'click' || e.kind === 'rightclick');
    const ticked = clicks.slice(0, MAX_TICKS);
    for (const click of ticked) place(kit.click, click.tMs, o.clickVolume, 'Click');
    if (clicks.length > ticked.length) {
      notes.push(
        `${clicks.length - ticked.length} of ${clicks.length} clicks got no tick: `
        + `${MAX_TICKS} is the ceiling, because every one becomes an input to the export's `
        + 'audio mix. The zooms are unaffected.'
      );
    }
  }

  /* ── Air under the pushes ── */
  if (o.whooshes && kit.whoosh) {
    for (const moment of moments) {
      /*
        Slightly AHEAD of the push, not on it. A whoosh that starts when
        the frame starts moving arrives late — the ear leads the eye, and
        the sound has to be underway before the picture is.

        Unless there is no push. Under the cutting grammar the frame
        changes in one frame, and a sound that is already underway when
        it does reads as a mistake rather than as a lead — the transient
        wants to land ON the cut, which is how cuts have been scored
        since anybody scored one. So the lead is a property of there
        being a move to lead, not a constant.
      */
      const at = shape.cutIn
        ? moment.atMs - shape.leadMs
        : moment.atMs - shape.leadMs - 120;
      place(kit.whoosh, at, o.whooshVolume, 'Zoom air');
    }
  }

  return { placed, notes };
}
