/* ═══════════════════════════════════════════════════════════════════
   Listing a folder, for `assemble_from_folder`.

   The renderer cannot do this. `webSecurity: false` gets `file://` media
   into an <img>/<video>, but it does NOT get a directory listing:
   `fetch('file:///some/dir/')` throws "Failed to fetch" and an
   XMLHttpRequest to the same URL fires `onerror` with `status: 0`. Both
   were tried against a real folder in this app before this file existed.
   So the enumeration has to happen in main, where there is an `fs`.

   What it deliberately does NOT do is decide anything. It reports names,
   sizes and timestamps; whether a file is usable media is decided in the
   renderer by trying to DECODE it, because an extension is a claim and a
   decode is a measurement — this repo has already shipped one demo whose
   `.mov` files were JPEGs.

   `birthtimeMs` is the filesystem's creation time, and it is NOT capture
   time: copying a file resets it and some filesystems do not keep one at
   all (it comes back as 0 or as the mtime). `assemble_from_folder` says
   so when it orders by it rather than letting a caller assume EXIF.

   Registered from `initToolBridge()` rather than from `main.ts` because
   parallel work owns `main.ts`; the channel is an ordinary
   `ipcMain.handle`, so moving the registration later changes nothing.
   ═══════════════════════════════════════════════════════════════════ */

import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';

export interface FolderEntry {
  name: string;
  path: string;
  /** 'file' | 'directory' | 'other' — a symlink is resolved before this. */
  kind: 'file' | 'directory' | 'other';
  sizeBytes: number;
  mtimeMs: number;
  /** Filesystem creation time. 0 when the platform does not keep one. */
  birthtimeMs: number;
}

export interface FolderListing {
  ok: boolean;
  folder?: string;
  entries?: FolderEntry[];
  /** Entries whose `stat` failed — a broken symlink, a permission wall. */
  unreadable?: { name: string; reason: string }[];
  error?: string;
}

export function listFolder(folder: string, recursive = false, depth = 0): FolderListing {
  if (!path.isAbsolute(folder)) {
    return { ok: false, error: `Path must be absolute, got "${folder}"` };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(folder);
  } catch (err) {
    return { ok: false, error: `Cannot read "${folder}": ${(err as Error).message}` };
  }
  if (!stat.isDirectory()) {
    return { ok: false, error: `"${folder}" is not a directory.` };
  }

  const entries: FolderEntry[] = [];
  const unreadable: { name: string; reason: string }[] = [];

  let names: string[];
  try {
    names = fs.readdirSync(folder);
  } catch (err) {
    return { ok: false, error: `Cannot list "${folder}": ${(err as Error).message}` };
  }

  for (const name of names) {
    /*
      macOS scatters .DS_Store through every folder a Finder window has
      ever opened, and dotfiles are never the material someone meant. They
      are dropped HERE rather than reported as "skipped", because a caller
      being told it skipped three files it has never seen is noise, not
      accounting.
    */
    if (name.startsWith('.')) continue;

    const full = path.join(folder, name);
    let s: fs.Stats;
    try {
      s = fs.statSync(full); // follows symlinks: a link to a video is a video
    } catch (err) {
      unreadable.push({ name, reason: (err as Error).message });
      continue;
    }

    const kind: FolderEntry['kind'] = s.isDirectory()
      ? 'directory'
      : s.isFile()
        ? 'file'
        : 'other';

    if (kind === 'directory' && recursive && depth < 4) {
      const sub = listFolder(full, true, depth + 1);
      if (sub.ok && sub.entries) {
        entries.push(...sub.entries);
        if (sub.unreadable) unreadable.push(...sub.unreadable);
      } else {
        unreadable.push({ name, reason: sub.error ?? 'unreadable directory' });
      }
      continue;
    }

    entries.push({
      name,
      path: full,
      kind,
      sizeBytes: s.size,
      mtimeMs: s.mtimeMs,
      // birthtimeMs is 0 on filesystems with no creation time; keep the 0
      // rather than substituting mtime, so the caller can tell.
      birthtimeMs: Number.isFinite(s.birthtimeMs) ? s.birthtimeMs : 0,
    });
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { ok: true, folder, entries, unreadable };
}

let registered = false;

/** `ipcMain.handle` throws on a duplicate channel, so this is idempotent. */
export function registerFolderScan(): void {
  if (registered) return;
  registered = true;
  ipcMain.handle('media:listFolder', (_e, p: { path: string; recursive?: boolean }) =>
    listFolder(p.path, p.recursive === true)
  );
}
