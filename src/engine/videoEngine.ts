/* ═══════════════════════════════════════════════════════════════════
   Video decode.

   Until this existed, Kerf could not show video. Every clip — the
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
  /**
   * A live capture rather than a file.
   *
   * The element is fed by `srcObject` from a MediaStream, which has no
   * duration, no seekable range and exactly one position: now. Every
   * timing operation in this module is therefore wrong for it — seeking
   * throws, `currentTime` is a stopwatch rather than an address, and
   * pausing it drops frames that will never come back. So they are
   * skipped by `syncVideo` and by `seekVideosForFrame` instead of being
   * special-cased at each call site.
   */
  live: boolean;
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

  const entry: VideoEntry = { el, loaded: false, failed: false, seekWaiters: [], live: false };

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

/**
 * Put a LIVE capture into the cache under a URL of your choosing.
 *
 * This is what lets a live stream be composited by exactly the same code
 * as the editor rather than by a second renderer written to match it.
 * Register the screen and the camera here, build an ordinary project out
 * of ordinary clips pointing at those URLs, and `renderTimelineFrame`
 * draws the backdrop, the inset, the rounded corners, the grade and the
 * camera the one way they are drawn anywhere. A parallel implementation
 * would be correct on the day it was written and wrong by the next time
 * somebody changed the look.
 *
 * The URL is a handle and never fetched: use something that cannot
 * collide with a file, e.g. `live://screen`.
 */
export function registerLiveSource(url: string, stream: MediaStream): HTMLVideoElement {
  releaseLiveSource(url);

  const el = document.createElement('video');
  el.muted = true;
  el.defaultMuted = true;
  el.volume = 0;
  el.playsInline = true;
  el.disableRemotePlayback = true;
  el.srcObject = stream;

  const entry: VideoEntry = { el, loaded: false, failed: false, seekWaiters: [], live: true };
  el.onloadeddata = () => { entry.loaded = true; generation++; };
  el.onerror = () => { entry.failed = true; generation++; };

  videos.set(url, entry);
  /* A live element must be PLAYING to produce frames; there is no seek
     that would otherwise pull one out of it. */
  void el.play().catch(() => { entry.failed = true; });
  return el;
}

/** Drop a live source and stop its element decoding. */
export function releaseLiveSource(url: string): void {
  const entry = videos.get(url);
  if (!entry) return;
  try {
    entry.el.pause();
    entry.el.srcObject = null;
  } catch { /* already gone */ }
  videos.delete(url);
  generation++;
}

/** True when this URL is a live capture rather than a file. */
export function isLiveSource(url: string): boolean {
  return videos.get(url)?.live === true;
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
  /*
    Solo is PER STREAM. This used to read `tracks.some((t) => t.solo)`
    with no type test, while the audio side has always filtered by type —
    so soloing an AUDIO track meant no video track was soloed, every one
    of them failed the `!track.solo` test, and the picture went to black.
    Proved on pixels: mean luma 7.06 -> 0.00 with nothing but an audio
    track's solo flag changed. Video solo and audio solo are independent.
  */
  const anySolo = tracks.some((t) => t.type !== 'audio' && t.solo);

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

    /* A live capture has one position and it is now. Seeking it throws,
       pausing it loses frames for good. Leave it running. */
    if (entry.live) continue;

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
    /* Except a live capture, which is not "under the playhead" in any
       sense and cannot be resumed from where it was paused. */
    if (entry.live) continue;
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
    /* A live capture has nothing to seek to and pausing it would end the
       stream's picture. It is already showing the only frame it has. */
    if (entry.live) continue;
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
