/* ═══════════════════════════════════════════════════════════════════
   Turning a renderer's media URL into something ffmpeg can open.

   ffmpeg is a separate OS process. It does not share the renderer's idea
   of where things are, and it does not share Electron's patched `fs`
   either.

   Conversions:
   1. `file://` URLs are safely translated using Node's `fileURLToPath`,
      handling spaces, percent-encoding, and Windows drive letters correctly.
   2. Paths inside `app.asar` are checked in `app.asar.unpacked`. If not
      unpacked, the bytes are extracted from the archive to a temp file
      so ffmpeg can open and read them directly.
   ═══════════════════════════════════════════════════════════════════ */

import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import os from 'os';

/** A path or URL ffmpeg — a separate process — can actually open. */
export function ffmpegSource(mediaUrl: string): string {
  let source = mediaUrl;

  if (source.startsWith('file://')) {
    try {
      source = fileURLToPath(source);
    } catch {
      try {
        source = decodeURIComponent(source.replace(/^file:\/\//, ''));
      } catch {
        source = source.replace(/^file:\/\//, '');
      }
      if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(source)) {
        source = source.slice(1);
      }
    }
  }

  // Leave remote URLs alone (http/https/rtmp); only local paths can be inside the archive.
  if (/^[a-z][a-z0-9+.-]*:/i.test(source) && !/^[a-zA-Z]:[/\\]/.test(source)) {
    return source;
  }

  // On Windows, normalize slashes if it's a local file path
  if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(source)) {
    source = source.slice(1);
  }

  // If path is inside app.asar, check if an unpacked copy exists
  if (source.includes('app.asar')) {
    const unpackedPath = source.replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(unpackedPath)) {
      return unpackedPath;
    }
    // If not unpacked on disk, extract it from the asar archive to a temp file so ffmpeg can read it
    try {
      if (fs.existsSync(source)) {
        const tempDir = path.join(os.tmpdir(), 'frontiercut-media');
        fs.mkdirSync(tempDir, { recursive: true });
        const ext = path.extname(source) || '.tmp';
        const extractedPath = path.join(tempDir, `${Date.now().toString(36)}_${path.basename(source, ext)}${ext}`);
        if (!fs.existsSync(extractedPath)) {
          const buf = fs.readFileSync(source);
          fs.writeFileSync(extractedPath, buf);
        }
        return extractedPath;
      }
    } catch {
      // fallback to unpacked path
      return unpackedPath;
    }
  }

  return source;
}
