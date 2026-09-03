/* ═══════════════════════════════════════════════════════════════════
   Whether a finished take can go into an MP4 by stream copy.

   Pure, and in `src/services` rather than in `electron/`, for the same
   reason `hardwareEncoder` is: `vitest.config` only collects
   tests under `src`, so a decision left in the main process cannot be
   tested without an ffmpeg and a real recording. This one is worth
   testing because getting it wrong is not slow, it is broken output.
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Video codecs an MP4 container has a tag for.
 *
 * MediaRecorder can realistically produce the first three. `mpeg4` is
 * here because a take re-imported from somewhere else can be one and
 * copying it is still correct; VP8, VP9 and AV1-in-WebM-only builds are
 * deliberately absent.
 */
const MP4_VIDEO = new Set(['h264', 'avc1', 'hevc', 'h265', 'av1', 'mpeg4']);

/**
 * Copy, or re-encode?
 *
 * Two independent facts, and the bug this exists to stop was trusting
 * only the first:
 *
 *   `requested`  the renderer asked `MediaRecorder` for an H.264 WebM
 *                and it said yes. That is a statement of intent.
 *   `actual`     what ffmpeg reads out of the file that was written.
 *                That is the fact.
 *
 * `MediaRecorder.isTypeSupported('video/webm;codecs=h264')` answers true
 * wherever Chromium *can* try H.264, and what it hands back depends on
 * the platform encoder it finds at start time. A machine that falls back
 * to VP8 still reports the mime it was given, so a take can be requested
 * as copyable and written as something an MP4 muxer has no tag for.
 *
 * Null `actual` means the file could not be read at all, which is not a
 * reason to guess: re-encoding is slower and always works.
 */
export function canStreamCopy(requested: boolean, actual: string | null): boolean {
  if (!requested) return false;
  if (!actual) return false;
  return MP4_VIDEO.has(actual.trim().toLowerCase());
}

/**
 * The codec name out of an `ffmpeg -i` stream table.
 *
 * `ffmpeg -i <file>` with no output file exits non-zero and prints the
 * table to stderr, which is why this parses stderr and why a non-zero
 * exit is not treated as failure. Deliberately takes the FIRST video
 * stream: a take has exactly one, and a file with more is not a take.
 */
export function videoCodecFromFfmpeg(stderr: string): string | null {
  const match = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Video: ([A-Za-z0-9_]+)/.exec(stderr);
  return match ? match[1].toLowerCase() : null;
}
