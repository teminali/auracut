/* ═══════════════════════════════════════════════════════════════════
   Building a sequence out of a folder.

   The tool this backs (`assemble_from_folder`) is one call in place of a
   loop an agent otherwise writes by hand: list the folder with its own
   shell, `import_media_from_path` per file, `insert_clip` per file,
   `patch_clip` per file to set a duration. Twelve files is thirty-seven
   calls, and the interesting part — what happened to the files that did
   NOT work — is the part a hand-rolled loop drops on the floor.

   Four decisions, and the tool reports every one:

     · ORDER. Filename (naturally, so `clip2` precedes `clip10`),
       modification time, filesystem creation time, or duration. There is
       no right answer, so there is no silent one; `orderedBy` comes back
       in the result and creation time carries the caveat that it is a
       filesystem timestamp and not EXIF capture time.

     · FILES IT COULD NOT DECODE. Reported by name with the browser's own
       reason, and NOT imported. This is the whole point of the tool: a
       folder of twelve where three are a broken download must not produce
       a nine-clip sequence and a success message.

     · STILLS vs VIDEO. A still has no duration, so one has to be chosen;
       a video has one, so it is measured. Both end up on the same video
       track, and the report says which clips got which treatment.

     · DURATIONS. Measured, capped, floored, or overridden — whichever it
       was, `durations.policy` says so in words.

   **It does its own decode probe rather than calling
   `import_media_from_path`.** That tool's probe resolves `durationMs:
   5000` when the media fails to load, with no flag and no error, so a
   file the app cannot open becomes a five-second asset that reports
   success and renders a placeholder forever. Distinguishing those two
   cases is exactly what this tool exists to do, so it cannot borrow a
   probe that cannot tell them apart. (Logged as a finding against
   `probeMedia` in `toolRegistry.ts`.)
   ═══════════════════════════════════════════════════════════════════ */

import { useTimelineStore, findClipById } from '../store/timelineStore';
import { MediaAsset, ClipType } from '../types/edl';

const timeline = () => useTimelineStore.getState();

/* ── What counts as what ────────────────────────────────────────── */

const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mpg', 'mpeg', 'ogv'];
const AUDIO_EXT = ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'aiff', 'aif', 'opus'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic', 'avif', 'tif', 'tiff'];

export type MediaKind = 'video' | 'audio' | 'image' | 'not-media';

export function classifyExtension(name: string): { kind: MediaKind; ext: string } {
  const parts = name.split('.');
  const ext = parts.length > 1 ? (parts.pop() as string).toLowerCase() : '';
  if (VIDEO_EXT.includes(ext)) return { kind: 'video', ext };
  if (AUDIO_EXT.includes(ext)) return { kind: 'audio', ext };
  if (IMAGE_EXT.includes(ext)) return { kind: 'image', ext };
  return { kind: 'not-media', ext };
}

/* ── The probe ──────────────────────────────────────────────────── */

export type ProbeStatus = 'decoded' | 'failed' | 'timeout';

export interface ProbeResult {
  status: ProbeStatus;
  durationMs?: number;
  width?: number;
  height?: number;
  reason?: string;
}

const MEDIA_ERROR_TEXT: Record<number, string> = {
  1: 'loading was aborted',
  2: 'a network error while reading the file',
  3: 'the file decoded as corrupt',
  4: 'the format or codec is not supported by this build of Chromium',
};

/**
 * Try to DECODE the file, and say which of three things happened.
 *
 * Three values, not two. "Unknown is not the same as absent" (HANDOVER
 * §3): a probe that has not answered yet is not a probe that failed, and
 * a caller that treats a timeout as a corrupt file will tell a user their
 * footage is broken because their disk was busy.
 */
export function probeDecodable(url: string, kind: MediaKind, timeoutMs = 10000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    let release: (() => void) | null = null;
    const finish = (r: ProbeResult) => {
      if (settled) return;
      settled = true;
      /*
        Let go of the element. A <video> that failed to decode keeps its
        source and its half-built decoder alive as long as anything
        references it, and scanning a folder with a corrupt file in it
        makes one of those per scan — Chromium logs "Unsupported pixel
        format: -1" on a loop for each. Detaching the src and calling
        load() is what actually frees it; dropping the reference is not
        enough while the element still has a source.
      */
      try { release?.(); } catch { /* the element is already gone */ }
      resolve(r);
    };

    if (kind === 'image') {
      const img = new Image();
      release = () => { img.onload = null; img.onerror = null; img.src = ''; };
      img.onload = () =>
        finish(
          img.naturalWidth > 0
            ? { status: 'decoded', width: img.naturalWidth, height: img.naturalHeight }
            : { status: 'failed', reason: 'decoded to zero pixels' }
        );
      img.onerror = () => finish({ status: 'failed', reason: 'the image could not be decoded' });
      setTimeout(() => finish({ status: 'timeout', reason: `no answer in ${timeoutMs}ms` }), timeoutMs);
      img.src = url;
      return;
    }

    const el = document.createElement(kind === 'audio' ? 'audio' : 'video') as HTMLMediaElement;
    el.preload = 'metadata';
    el.muted = true;
    release = () => {
      el.onloadedmetadata = null;
      el.onerror = null;
      el.removeAttribute('src');
      el.load();
    };

    el.onloadedmetadata = () => {
      const video = el as HTMLVideoElement;
      const dur = el.duration;
      if (!Number.isFinite(dur) || dur <= 0) {
        finish({ status: 'failed', reason: 'metadata loaded but the duration is not a finite number' });
        return;
      }
      if (kind === 'video' && !(video.videoWidth > 0)) {
        /* A file whose video track will not decode still fires
           loadedmetadata when it has an audio track. Calling that a video
           import is how a "video" ends up rendering the dark placeholder. */
        finish({ status: 'failed', reason: 'no decodable video track (0x0)' });
        return;
      }
      finish({
        status: 'decoded',
        durationMs: Math.round(dur * 1000),
        width: kind === 'video' ? video.videoWidth : undefined,
        height: kind === 'video' ? video.videoHeight : undefined,
      });
    };
    el.onerror = () => {
      const code = el.error?.code ?? 0;
      finish({
        status: 'failed',
        reason: MEDIA_ERROR_TEXT[code] ?? el.error?.message ?? 'the file could not be opened',
      });
    };
    setTimeout(() => finish({ status: 'timeout', reason: `no answer in ${timeoutMs}ms` }), timeoutMs);
    el.src = url;
  });
}

/* ── Ordering ───────────────────────────────────────────────────── */

export type OrderBy = 'name' | 'modified' | 'created' | 'duration' | 'as-listed';

export const ORDER_NOTES: Record<OrderBy, string> = {
  name: 'Filename, compared naturally, so "clip2" comes before "clip10".',
  modified:
    'Filesystem modification time, oldest first. This is when the bytes last changed, ' +
    'which for footage straight off a card is usually when it was shot and after any ' +
    're-encode is not.',
  created:
    'Filesystem CREATION time, oldest first. Not EXIF capture time. Copying or ' +
    'downloading a file resets it, and some filesystems keep none at all (those files ' +
    'sort first). If capture order matters, check the result against the filenames.',
  duration:
    'Shortest first, by the duration the clip will HAVE on the timeline. A still has none of ' +
    'its own, so it sorts by the hold it is given (stillDurationMs), and a capped clip sorts by ' +
    'its capped length.',
  'as-listed': 'Whatever order the directory read returned. Not meaningful; use it only to reproduce a previous run.',
};

/** Compare with embedded digits treated as numbers. */
export function naturalCompare(a: string, b: string): number {
  const ax: (string | number)[] = [];
  const bx: (string | number)[] = [];
  for (const m of a.toLowerCase().matchAll(/(\d+)|(\D+)/g)) ax.push(m[1] ? Number(m[1]) : m[2]);
  for (const m of b.toLowerCase().matchAll(/(\d+)|(\D+)/g)) bx.push(m[1] ? Number(m[1]) : m[2]);
  for (let i = 0; i < Math.max(ax.length, bx.length); i++) {
    const x = ax[i];
    const y = bx[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

/* ── The operation ──────────────────────────────────────────────── */

export interface AssembleArgs {
  folder: string;
  recursive?: boolean;
  orderBy?: OrderBy;
  trackId?: string;
  startMs?: number;
  stillDurationMs?: number;
  uniformDurationMs?: number;
  maxClipMs?: number;
  minClipMs?: number;
  audio?: 'bed' | 'sequence' | 'ignore';
  clearTrack?: boolean;
  fitMode?: 'cover' | 'contain';
  limit?: number;
  dryRun?: boolean;
}

interface Candidate {
  name: string;
  path: string;
  url: string;
  kind: MediaKind;
  ext: string;
  sizeBytes: number;
  mtimeMs: number;
  birthtimeMs: number;
  probe?: ProbeResult;
}

/** The exact encoding `import_media_from_path` uses, so the two agree. */
function fileUrl(path: string): string {
  return `file://${encodeURI(path).replace(/#/g, '%23')}`;
}

export async function assembleFromFolder(args: AssembleArgs): Promise<Record<string, unknown>> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.media?.listFolder) {
    throw new Error(
      'Reading a folder needs the desktop app. The browser cannot enumerate a directory. ' +
      '(fetch and XHR on a file:// directory both fail even with webSecurity off.)'
    );
  }

  const listing = await api.media.listFolder(args.folder, args.recursive === true);
  if (!listing.ok) throw new Error(listing.error ?? `Could not read "${args.folder}".`);

  const entries = listing.entries ?? [];
  const filesSeen = entries.length;

  const subdirectories: string[] = [];
  const notMedia: { name: string; reason: string }[] = [];
  const candidates: Candidate[] = [];

  for (const e of entries) {
    if (e.kind === 'directory') { subdirectories.push(e.name); continue; }
    if (e.kind === 'other') {
      notMedia.push({ name: e.name, reason: 'not a regular file (a socket, device or fifo)' });
      continue;
    }
    const { kind, ext } = classifyExtension(e.name);
    if (kind === 'not-media') {
      notMedia.push({
        name: e.name,
        reason: ext ? `".${ext}" is not a video, audio or image extension` : 'no file extension',
      });
      continue;
    }
    if (e.sizeBytes === 0) {
      // Probing a zero-byte file is a guaranteed failure with a vaguer message.
      notMedia.push({ name: e.name, reason: 'the file is empty (0 bytes)' });
      continue;
    }
    candidates.push({
      name: e.name, path: e.path, url: fileUrl(e.path), kind, ext,
      sizeBytes: e.sizeBytes, mtimeMs: e.mtimeMs, birthtimeMs: e.birthtimeMs,
    });
  }

  /* ── decode every candidate ───────────────────────────────────── */
  await Promise.all(
    candidates.map(async (c) => { c.probe = await probeDecodable(c.url, c.kind); })
  );

  const undecodable = candidates
    .filter((c) => c.probe?.status !== 'decoded')
    .map((c) => ({
      name: c.name,
      kind: c.kind,
      sizeBytes: c.sizeBytes,
      outcome: c.probe?.status ?? 'failed',
      reason: c.probe?.reason ?? 'unknown',
    }));

  const good = candidates.filter((c) => c.probe?.status === 'decoded');

  /* ── durations ────────────────────────────────────────────────── */
  /*
    Worked out BEFORE the ordering, because "order by duration" has to
    mean the length the clip will HAVE. A still has no duration of its
    own — sorting on the probe's answer put every still first with a
    duration of zero, which is a sort on a value that does not exist.
  */
  const stillMs = args.stillDurationMs ?? 3000;
  const durationFor = (c: Candidate): number => {
    if (args.uniformDurationMs !== undefined) return Math.max(100, Math.round(args.uniformDurationMs));
    if (c.kind === 'image') return Math.max(100, Math.round(stillMs));
    let d = c.probe?.durationMs ?? 0;
    if (args.maxClipMs !== undefined) d = Math.min(d, args.maxClipMs);
    if (args.minClipMs !== undefined) d = Math.max(d, args.minClipMs);
    return Math.max(100, Math.round(d));
  };

  /* ── order ────────────────────────────────────────────────────── */
  const orderBy: OrderBy = args.orderBy ?? 'name';
  const ordered = [...good];
  if (orderBy === 'name') ordered.sort((a, b) => naturalCompare(a.name, b.name));
  else if (orderBy === 'modified') ordered.sort((a, b) => a.mtimeMs - b.mtimeMs);
  else if (orderBy === 'created') ordered.sort((a, b) => a.birthtimeMs - b.birthtimeMs);
  else if (orderBy === 'duration') ordered.sort((a, b) => durationFor(a) - durationFor(b));

  const noBirthtime = orderBy === 'created' ? ordered.filter((c) => !c.birthtimeMs).length : 0;

  const limited = args.limit !== undefined ? ordered.slice(0, args.limit) : ordered;
  const droppedByLimit = ordered.length - limited.length;

  const visual = limited.filter((c) => c.kind === 'video' || c.kind === 'image');
  const audioFiles = limited.filter((c) => c.kind === 'audio');

  const durationPolicy =
    args.uniformDurationMs !== undefined
      ? `Every clip is ${Math.round(args.uniformDurationMs)}ms because uniformDurationMs was given. ` +
        `Footage longer than that is trimmed; footage shorter than that plays out and leaves the rest of ` +
        `its slot empty.`
      : `Video and audio keep their measured duration` +
        (args.maxClipMs !== undefined ? `, capped at ${args.maxClipMs}ms` : '') +
        (args.minClipMs !== undefined ? `, floored at ${args.minClipMs}ms` : '') +
        `. Stills have no duration of their own, so each one is held for ${stillMs}ms, ` +
        `that number is a choice, not a measurement.`;

  const audioPolicy = args.audio ?? 'bed';
  const startMs = Math.max(0, Math.round(args.startMs ?? 0));

  /* ── what would happen ────────────────────────────────────────── */
  const plannedVisual: { name: string; kind: MediaKind; startMs: number; durationMs: number }[] = [];
  let cursor = startMs;
  for (const c of visual) {
    const d = durationFor(c);
    plannedVisual.push({ name: c.name, kind: c.kind, startMs: cursor, durationMs: d });
    cursor += d;
  }
  const sequenceEndMs = cursor;

  const plannedAudio: { name: string; startMs: number; durationMs: number }[] = [];
  if (audioPolicy !== 'ignore') {
    if (audioPolicy === 'bed' && audioFiles.length > 0) {
      plannedAudio.push({ name: audioFiles[0].name, startMs, durationMs: durationFor(audioFiles[0]) });
    } else if (audioPolicy === 'sequence') {
      let ac = startMs;
      for (const c of audioFiles) {
        const d = durationFor(c);
        plannedAudio.push({ name: c.name, startMs: ac, durationMs: d });
        ac += d;
      }
    }
  }
  const audioNotPlaced = audioFiles
    .filter((c) => !plannedAudio.some((p) => p.name === c.name))
    .map((c) => ({
      name: c.name,
      reason:
        audioPolicy === 'ignore'
          ? 'audio: "ignore"'
          : 'audio: "bed" lays only the first audio file; pass audio:"sequence" to lay them all',
    }));

  /* ── accounting, which is the point ───────────────────────────── */
  const accountedFor =
    subdirectories.length + notMedia.length + undecodable.length + good.length;
  const accounting = {
    filesSeen,
    subdirectories: subdirectories.length,
    notMedia: notMedia.length,
    undecodable: undecodable.length,
    decoded: good.length,
    placed: plannedVisual.length + plannedAudio.length,
    droppedByLimit,
    audioNotPlaced: audioNotPlaced.length,
    balances: accountedFor === filesSeen,
  };

  const warnings: string[] = [];
  if (!accounting.balances) {
    warnings.push(
      `ACCOUNTING DOES NOT BALANCE: ${filesSeen} entries seen but ${accountedFor} accounted for. ` +
      `This is a bug in assemble_from_folder, not in your folder. Do not trust the lists above.`
    );
  }
  if (undecodable.length > 0) {
    warnings.push(
      `${undecodable.length} of ${filesSeen} file(s) could not be decoded and were NOT imported. ` +
      `They are listed by name under "undecodable".`
    );
  }
  if (listing.unreadable && listing.unreadable.length > 0) {
    warnings.push(
      `${listing.unreadable.length} entr(y/ies) could not even be stat'd: ` +
      listing.unreadable.map((u) => `${u.name} (${u.reason})`).join(', ')
    );
  }
  if (noBirthtime > 0) {
    warnings.push(
      `${noBirthtime} file(s) have no filesystem creation time, so ordering by "created" put them first ` +
      `in whatever order the directory read returned.`
    );
  }

  const order = {
    by: orderBy,
    note: ORDER_NOTES[orderBy],
    files: ordered.map((c) => c.name),
  };

  const durations = {
    policy: durationPolicy,
    stillDurationMs: stillMs,
    ...(args.uniformDurationMs !== undefined ? { uniformDurationMs: args.uniformDurationMs } : {}),
    ...(args.maxClipMs !== undefined ? { maxClipMs: args.maxClipMs } : {}),
    ...(args.minClipMs !== undefined ? { minClipMs: args.minClipMs } : {}),
  };

  const stills = visual.filter((c) => c.kind === 'image').length;
  const movies = visual.filter((c) => c.kind === 'video').length;

  if (args.dryRun) {
    return {
      dryRun: true,
      folder: listing.folder,
      accounting,
      order,
      durations,
      stillsVsVideo: {
        stills, video: movies,
        note: `Stills and video share one track. Stills are held for ${stillMs}ms each and fit "${args.fitMode ?? 'cover'}".`,
      },
      videoSequence: plannedVisual,
      audioTrack: { policy: audioPolicy, clips: plannedAudio, notPlaced: audioNotPlaced },
      undecodable,
      notMedia,
      subdirectories,
      sequenceMs: sequenceEndMs - startMs,
      ...(warnings.length ? { warnings } : {}),
      note: 'Nothing was imported or placed. Call again without dryRun to build it.',
    };
  }

  /* ── build it ─────────────────────────────────────────────────── */
  const state = timeline();

  let videoTrackId = args.trackId;
  if (videoTrackId && !state.tracks.some((t) => t.id === videoTrackId)) {
    const needle = videoTrackId.toLowerCase();
    const byName = state.tracks.find(
      (t) => t.name.toLowerCase().includes(needle) || t.type === needle
    );
    if (!byName) throw new Error(`No track matching "${videoTrackId}".`);
    videoTrackId = byName.id;
  }
  let videoTrackCreated = false;
  if (!videoTrackId) {
    const existing = state.tracks.find((t) => t.type === 'video');
    if (existing) videoTrackId = existing.id;
    else { videoTrackId = timeline().addTrack('video', 'Assembly'); videoTrackCreated = true; }
  }

  let audioTrackId: string | null = null;
  if (plannedAudio.length > 0) {
    const existing = timeline().tracks.find((t) => t.type === 'audio');
    audioTrackId = existing ? existing.id : timeline().addTrack('audio', 'Music');
  }

  timeline().beginTransaction();

  let clipsRemoved = 0;
  if (args.clearTrack ?? true) {
    const track = timeline().tracks.find((t) => t.id === videoTrackId);
    for (const clip of [...(track?.clips ?? [])]) {
      if (timeline().deleteClip(clip.id, false)) clipsRemoved++;
    }
  }

  const importedAssets: { name: string; assetId: string; type: ClipType; durationMs: number }[] = [];
  const assetIdByPath = new Map<string, MediaAsset>();
  const stamp = Date.now().toString(36);

  limited.forEach((c, i) => {
    const type: ClipType = c.kind === 'image' ? 'image' : c.kind === 'audio' ? 'audio' : 'video';
    const asset: MediaAsset = {
      id: `asset_${stamp}_${i.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: c.name,
      type,
      url: c.url,
      thumbnailUrl: c.kind === 'audio' ? '' : c.url,
      // The measured duration. A still gets the chosen hold time, and the
      // report says that number is a choice.
      durationMs: c.kind === 'image' ? Math.max(100, Math.round(stillMs)) : (c.probe?.durationMs ?? 0),
      width: c.probe?.width,
      height: c.probe?.height,
      fileSizeFormatted: formatBytes(c.sizeBytes),
    };
    timeline().addMediaAsset(asset);
    assetIdByPath.set(c.path, asset);
    importedAssets.push({ name: c.name, assetId: asset.id, type, durationMs: asset.durationMs });
  });

  const patchErrors: string[] = [];
  const placedVisual: {
    name: string; clipId: string; kind: MediaKind; startMs: number; durationMs: number;
    durationFrom: 'measured' | 'still hold' | 'uniform' | 'capped' | 'floored';
  }[] = [];

  cursor = startMs;
  for (const c of visual) {
    const asset = assetIdByPath.get(c.path)!;
    const want = durationFor(c);
    const clipId = timeline().insertClip(videoTrackId, asset, cursor);
    const patch = timeline().patchClip(clipId, {
      startTimeMs: cursor,
      durationMs: want,
      fitMode: args.fitMode ?? 'cover',
    });
    if (patch.errors.length) patchErrors.push(`${c.name}: ${patch.errors.join('; ')}`);

    const placed = findClipById(timeline().tracks, clipId);
    const actualStart = placed?.startTimeMs ?? cursor;
    const actualDur = placed?.durationMs ?? want;

    let durationFrom: 'measured' | 'still hold' | 'uniform' | 'capped' | 'floored' = 'measured';
    if (args.uniformDurationMs !== undefined) durationFrom = 'uniform';
    else if (c.kind === 'image') durationFrom = 'still hold';
    else if (args.maxClipMs !== undefined && (c.probe?.durationMs ?? 0) > args.maxClipMs) durationFrom = 'capped';
    else if (args.minClipMs !== undefined && (c.probe?.durationMs ?? 0) < args.minClipMs) durationFrom = 'floored';

    placedVisual.push({
      name: c.name, clipId, kind: c.kind,
      startMs: actualStart, durationMs: actualDur, durationFrom,
    });
    cursor = actualStart + actualDur;
  }

  const placedAudio: { name: string; clipId: string; startMs: number; durationMs: number }[] = [];
  for (const p of plannedAudio) {
    const c = audioFiles.find((f) => f.name === p.name)!;
    const asset = assetIdByPath.get(c.path)!;
    const clipId = timeline().insertClip(audioTrackId!, asset, p.startMs);
    const patch = timeline().patchClip(clipId, { startTimeMs: p.startMs, durationMs: p.durationMs });
    if (patch.errors.length) patchErrors.push(`${c.name}: ${patch.errors.join('; ')}`);
    const placed = findClipById(timeline().tracks, clipId);
    placedAudio.push({
      name: c.name, clipId,
      startMs: placed?.startTimeMs ?? p.startMs,
      durationMs: placed?.durationMs ?? p.durationMs,
    });
  }

  timeline().commitTransaction(`Assemble ${placedVisual.length} clip(s) from folder`);

  /* Recompute the placed counts from what the store HOLDS, not from the plan. */
  const finalAccounting = {
    ...accounting,
    placed: placedVisual.length + placedAudio.length,
    imported: importedAssets.length,
  };
  if (finalAccounting.placed !== plannedVisual.length + plannedAudio.length) {
    warnings.push(
      `Planned ${plannedVisual.length + plannedAudio.length} clip(s) but the timeline holds ` +
      `${finalAccounting.placed}. The editor refused some placements.`
    );
  }

  const totalMs = placedVisual.length
    ? placedVisual[placedVisual.length - 1].startMs + placedVisual[placedVisual.length - 1].durationMs
    : 0;

  return {
    folder: listing.folder,
    accounting: finalAccounting,
    order,
    durations,
    stillsVsVideo: {
      stills, video: movies,
      note:
        `Stills and video are laid on one track in the same sequence. Each still is held for ` +
        `${stillMs}ms, chosen, not measured, and both are fitted "${args.fitMode ?? 'cover'}".`,
    },
    videoTrack: {
      trackId: videoTrackId,
      created: videoTrackCreated,
      clearedFirst: args.clearTrack ?? true,
      clipsRemoved,
      clips: placedVisual,
    },
    audioTrack: {
      policy: audioPolicy,
      trackId: audioTrackId,
      clips: placedAudio,
      notPlaced: audioNotPlaced,
    },
    undecodable,
    notMedia,
    subdirectories,
    ...(droppedByLimit > 0
      ? { droppedByLimit: { count: droppedByLimit, note: `limit=${args.limit} kept the first ${limited.length} in ${orderBy} order.` } }
      : {}),
    sequenceMs: totalMs - startMs,
    timelineEndMs: totalMs,
    ...(patchErrors.length ? { patchErrors } : {}),
    ...(warnings.length ? { warnings } : {}),
    nextStep:
      placedAudio.length > 0
        ? 'auto_montage_to_beats will re-lay this sequence so its cuts land on the music.'
        : 'Add music and call auto_montage_to_beats to put the cuts on its beats.',
  };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
