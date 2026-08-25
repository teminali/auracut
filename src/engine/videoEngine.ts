/* ═══════════════════════════════════════════════════════════════════
   Video decode.

   Until this existed, AuraCut could not show video. Every clip — the
   `.mov` files included — was drawn through `getCachedImage()`, which
   builds an `HTMLImageElement`. An <img> cannot decode an MP4, so the
   draw path fell through to its "media still loading" placeholder and
   rendered a dark gradient. Forever.

   Nothing looked wrong because the seed project's "footage" was a set
   of Unsplash JPEGs wearing .mov filenames and a fake ProRes codec
   label. Stills decode fine as images, so the demo looked like a
   working video editor while the only real video path was a gradient.

   Design mirrors `audioEngine`: one <video> element per clip, kept in
   a cache, told the timeline state every frame and reconciled against
   it. The engine owns no clock — the playhead is the only truth — so
   scrubbing, looping and rate changes need no special cases.

   The elements are MUTED on purpose. Sound comes from `audioEngine`,
   which already routes every clip through Web Audio for per-clip gain,
   fades and real metering. Letting the picture element make noise too
   would double every source.
   ═══════════════════════════════════════════════════════════════════ */

import { Track, Clip, ClipType } from '../types/edl';

/** Beyond this drift we re-seek rather than let the element free-run. */
const RESYNC_TOLERANCE_S = 0.25;

/** A seek that never lands must not wedge an export. */
const SEEK_TIMEOUT_MS = 4000;

interface VideoEntry {
  el: HTMLVideoElement;
  /** Metadata decoded — dimensions and duration are known. */
  loaded: boolean;
  /** The element could not decode this URL at all. */
  failed: boolean;
  seekWaiters: Array<() => void>;
}

const videos = new Map<string, VideoEntry>();

/**
 * Bumped whenever a new frame becomes drawable, so a paused preview
 * repaints instead of leaving the last frame (or a placeholder) on
 * screen after a seek completes.
 */
let generation = 0;

export function getVideoGeneration(): number {
  return generation;
}

/* ── Which decoder does this URL need? ──────────────────────────────

   Decided by extension first, then by the clip's declared type, and
   corrected by observation: if the guess fails to decode, the caller
   falls back to the other cache. That self-correction is what keeps a
   mislabelled asset — a JPEG called `.mov`, say — rendering anyway
   instead of silently becoming a gradient.                          */

const VIDEO_EXT = ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi', 'mpg', 'mpeg', 'ogv'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'heic', 'svg'];

export function likelyVideoUrl(url: string, declaredType?: ClipType): boolean {
  const path = url.split(/[?#]/)[0];
  const ext = path.split('.').pop()?.toLowerCase() ?? '';

  if (VIDEO_EXT.includes(ext)) return true;
  if (IMAGE_EXT.includes(ext)) return false;
  if (url.startsWith('data:video/')) return true;
  if (url.startsWith('data:image/')) return false;

  // No usable extension (CDN URLs often have none) — trust the label.
  return declaredType === 'video';
}

/* ── Element cache ──────────────────────────────────────────────── */

function acquire(url: string): VideoEntry {
  const hit = videos.get(url);
  if (hit) return hit;

  const el = document.createElement('video');
  // Sound belongs to audioEngine; this element is a picture source only.
  el.muted = true;
  el.defaultMuted = true;
  el.volume = 0;
  el.playsInline = true;
  el.preload = 'auto';
  el.crossOrigin = 'anonymous';
  // Seeking is far cheaper when the element is not also trying to keep
  // a decode-ahead buffer for playback it will never do.
  el.disableRemotePlayback = true;

  const entry: VideoEntry = { el, loaded: false, failed: false, seekWaiters: [] };

  el.onloadeddata = () => {
    entry.loaded = true;
    generation++;
  };
  el.onerror = () => {
    entry.failed = true;
    generation++;
    // Never leave an export waiting on a source that will not decode.
    entry.seekWaiters.splice(0).forEach((fn) => fn());
  };
  el.onseeked = () => {
    generation++;
    entry.seekWaiters.splice(0).forEach((fn) => fn());
  };

  el.src = url;
  videos.set(url, entry);
  return entry;
}

/** Start decoding this URL, without waiting for it. */
export function preloadVideo(url: string): void {
  acquire(url);
}

/** True once we know the element cannot decode this URL. */
export function videoFailed(url: string): boolean {
  return videos.get(url)?.failed ?? false;
}

/**
 * The element, if it currently holds a frame that can be drawn.
 *
 * Returns null while decoding so the caller paints its placeholder
 * rather than a blank element — drawing a video with readyState 0
 * silently paints nothing at all.
 */
export function getVideoFrame(url: string): HTMLVideoElement | null {
  const entry = acquire(url);
  if (entry.failed) return null;
  // HAVE_CURRENT_DATA — there is a frame at the current position.
  return entry.el.readyState >= 2 && entry.el.videoWidth > 0 ? entry.el : null;
}

/** Intrinsic pixel size once the metadata has decoded, else null. */
export function getVideoNaturalSize(url: string): { width: number; height: number } | null {
  const entry = acquire(url);
  if (entry.failed || entry.el.videoWidth === 0) return null;
  return { width: entry.el.videoWidth, height: entry.el.videoHeight };
}

/* ── Timeline reconciliation ────────────────────────────────────── */

/** Where in the SOURCE a given timeline position lands, in seconds. */
export function sourceSecondsFor(clip: Clip, offsetMs: number): number {
  const mult = clip.speed?.multiplier ?? 1;
  const played = offsetMs * mult;
  const span = clip.sourceDurationMs || clip.durationMs * mult;

  // A reversed clip reads its source back to front.
  const withinSource = clip.speed?.reversed ? Math.max(0, span - played) : played;
  return (clip.sourceStartMs + withinSource) / 1000;
}

function visibleVideoClips(tracks: Track[], playheadMs: number): Array<{ clip: Clip; offsetMs: number }> {
  const out: Array<{ clip: Clip; offsetMs: number }> = [];
  const anySolo = tracks.some((t) => t.solo);

  for (const track of tracks) {
    if (track.type === 'audio') continue;
    if (track.muted) continue;
    if (anySolo && !track.solo) continue;

    for (const clip of track.clips) {
      if (clip.hidden || !clip.mediaUrl) continue;
      if (!likelyVideoUrl(clip.mediaUrl, clip.type)) continue;
      const offsetMs = playheadMs - clip.startTimeMs;
      if (offsetMs < 0 || offsetMs >= clip.durationMs) continue;
      out.push({ clip, offsetMs });
    }
  }
  return out;
}

/**
 * Reconcile playback against the timeline. Called every frame from the
 * same loop that drives the picture and the sound.
 */
export function syncVideo(tracks: Track[], playheadMs: number, isPlaying: boolean, rate: number): void {
  const live = new Set<string>();

  for (const { clip, offsetMs } of visibleVideoClips(tracks, playheadMs)) {
    const url = clip.mediaUrl!;
    const entry = acquire(url);
    if (entry.failed) continue;
    live.add(url);

    const sourceSeconds = sourceSecondsFor(clip, offsetMs);
    if (!Number.isFinite(sourceSeconds)) continue;

    // A reversed clip cannot be played backwards by an element; it has to
    // be scrubbed frame by frame, which the paused branch already does.
    const scrub = !isPlaying || clip.speed?.reversed;

    if (scrub) {
      if (!entry.el.paused) entry.el.pause();
      if (Math.abs(entry.el.currentTime - sourceSeconds) > 0.02) {
        try { entry.el.currentTime = sourceSeconds; } catch { /* not seekable yet */ }
      }
      continue;
    }

    const targetRate = Math.max(0.0625, Math.min(16, rate * (clip.speed?.multiplier ?? 1)));
    if (entry.el.playbackRate !== targetRate) entry.el.playbackRate = targetRate;

    if (Math.abs(entry.el.currentTime - sourceSeconds) > RESYNC_TOLERANCE_S) {
      try { entry.el.currentTime = sourceSeconds; } catch { /* not seekable yet */ }
    }

    if (entry.el.paused) void entry.el.play().catch(() => {});
  }

  // Anything no longer under the playhead stops decoding immediately.
  for (const [url, entry] of videos) {
    if (live.has(url)) continue;
    if (!entry.el.paused) entry.el.pause();
  }
}

/* ── Deterministic seeking, for export ──────────────────────────── */

function seekTo(entry: VideoEntry, seconds: number): Promise<void> {
  if (entry.failed) return Promise.resolve();

  // Already there: `seeked` would never fire, so do not wait for it.
  if (Math.abs(entry.el.currentTime - seconds) < 0.001 && entry.el.readyState >= 2) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, SEEK_TIMEOUT_MS);
    entry.seekWaiters.push(done);

    try {
      entry.el.currentTime = seconds;
    } catch {
      done();
    }
  });
}

/**
 * Park every visible video on the exact frame this timeline position
 * needs, and resolve once they are all decoded.
 *
 * Export must await this before rendering. `renderTimelineFrame` is
 * synchronous: it draws whatever frame each element happens to be
 * holding, so without this an export writes the same stale frame over
 * and over — structurally a real video file, and completely wrong.
 */
export async function seekVideosForFrame(tracks: Track[], playheadMs: number): Promise<void> {
  const pending: Promise<void>[] = [];

  for (const { clip, offsetMs } of visibleVideoClips(tracks, playheadMs)) {
    const entry = acquire(clip.mediaUrl!);
    if (!entry.el.paused) entry.el.pause();

    const seconds = sourceSecondsFor(clip, offsetMs);
    if (!Number.isFinite(seconds)) continue;
    pending.push(seekTo(entry, seconds));
  }

  await Promise.all(pending);
}

/**
 * Wait for every video the timeline references to finish loading its
 * metadata, so the first exported frame is not a placeholder.
 */
/* `waitForVideoMetadata` lived here and only ever asked "does this decode
   as video?". That rejected extension-less CDN stills on video-typed clips
   and blocked every export of the demo project. Superseded by
   `undecodableSources` in compositor.ts, which tries both caches. */

/** Drop every element — used when a project is closed or replaced. */
export function stopAllVideo(): void {
  for (const [, entry] of videos) {
    try {
      entry.el.pause();
      entry.el.removeAttribute('src');
      entry.el.load();
    } catch {
      /* already torn down */
    }
  }
  videos.clear();
}

/** Discard one URL's element, so changed media is re-decoded. */
export function invalidateVideo(url: string): void {
  const entry = videos.get(url);
  if (!entry) return;
  try {
    entry.el.pause();
    entry.el.removeAttribute('src');
    entry.el.load();
  } catch {
    /* already torn down */
  }
  videos.delete(url);
}
