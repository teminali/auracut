/* ═══════════════════════════════════════════════════════════════════
   Turning a renderer's media URL into something ffmpeg can open.

   ffmpeg is a separate OS process. It does not share the renderer's idea
   of where things are, and it does not share Electron's patched `fs`
   either — which is the part that bites.

   Two conversions, and both were learned the hard way:

   1. `file://` URLs need decoding to a plain path. ffmpeg will accept
      some file: URLs, but not percent-encoded ones, and a project whose
      media sits in a folder with a space in its name is not exotic.

   2. **Paths through `app.asar` have to be redirected.** asar is a
      virtual filesystem that only Electron's patched `fs` understands.
      To every other process on the machine `app.asar` is a single file,
      so a path *through* it fails with "Not a directory" — which reads
      like a corrupt path rather than a packaging problem, and cost a
      packaged build that played its music in the app and exported it
      silent. electron-builder puts a real copy under
      `app.asar.unpacked` for anything listed in `asarUnpack`; this is
      what points at that copy.

   Dev never sees either problem: there is no asar and the URL is an
   http:// one the dev server is happily serving. Which is the usual
   shape of a packaged-only bug.
   ═══════════════════════════════════════════════════════════════════ */

/** A path or URL ffmpeg — a separate process — can actually open. */
export function ffmpegSource(mediaUrl: string): string {
  let source = mediaUrl;

  if (source.startsWith('file://')) {
    try {
      source = decodeURIComponent(source.replace('file://', ''));
    } catch {
      source = source.replace('file://', '');
    }
  }

  // Leave remote URLs alone; only local paths can be inside the archive.
  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) return source;

  if (source.includes('app.asar') && !source.includes('app.asar.unpacked')) {
    source = source.replace('app.asar', 'app.asar.unpacked');
  }

  return source;
}
