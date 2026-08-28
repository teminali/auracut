/* ═══════════════════════════════════════════════════════════════════
   Auto-update.

   Flow: check → download in the background → tell the renderer → the
   user chooses when to restart. Updates are never applied under the
   user's feet; losing an unsaved edit to a surprise relaunch is a far
   worse outcome than running an old build for another ten minutes.

   ── macOS caveat, deliberately surfaced rather than hidden ──
   Squirrel.Mac refuses to apply an update whose code signature it
   cannot validate against the running app. An ad-hoc / unsigned build
   therefore CANNOT self-update, no matter how the feed is configured.
   Rather than fail silently in the background forever, an unsigned
   macOS build reports `manual-only` and points the user at the release
   page. Ship a Developer ID-signed, notarised build and the same code
   path silently starts working — nothing here needs to change.
   ═══════════════════════════════════════════════════════════════════ */

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import electronUpdater from 'electron-updater';
import log from 'electron-log';
import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseFeed } from '../src/services/updateFeed';

/*
  `electronUpdater.autoUpdater` is a LAZY GETTER: touching it constructs a
  platform updater, which reads `app.getVersion()` on the spot. Destructuring
  it at module scope therefore runs before Electron has an `app` object and
  throws `Cannot read properties of undefined (reading 'getVersion')` during
  import — which kills the main process before a single line of it executes,
  with no window, no dialog and exit code 0. Resolve it lazily instead.
*/
type AutoUpdater = typeof electronUpdater.autoUpdater;
let cached: AutoUpdater | null = null;
const updater = (): AutoUpdater => (cached ??= electronUpdater.autoUpdater);

export const RELEASES_URL = 'https://github.com/teminali/kerf/releases/latest';

/** Everything the renderer is allowed to know about update state. */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; notes?: string }
  | { state: 'downloading'; version: string; percent: number; bytesPerSecond: number }
  | { state: 'ready'; version: string }
  | { state: 'up-to-date'; version: string }
  /**
   * An update exists but Squirrel cannot install it.
   *
   * `canSideload` says whether Kerf can nevertheless do the swap itself.
   * See `sideloadUpdate` for what that means and what it does not.
   */
  | { state: 'manual-only'; version: string; url: string; canSideload: boolean }
  | { state: 'error'; message: string };

let status: UpdateStatus = { state: 'idle' };
let mainWindow: BrowserWindow | null = null;

function publish(next: UpdateStatus) {
  status = next;
  log.info('[updater]', JSON.stringify(next));
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status', next);
  }
}

/**
 * Can this build actually swap itself out?
 *
 * On macOS that requires a valid signature. `isPackaged` alone is not
 * enough — a packaged-but-unsigned .app looks identical until Squirrel
 * rejects the staged update.
 */
function canSelfUpdate(): boolean {
  if (!app.isPackaged) return false;
  // Windows and Linux install updates regardless of signature.
  if (process.platform !== 'darwin') return true;
  // On macOS only a Developer ID-signed build can. The release workflow
  // stamps this in at build time, and only when it actually signed.
  return process.env.KERF_SIGNED === '1';
}

/* ── Sideloading, for the build that cannot sign itself ─────────────

   `canSelfUpdate` is false on every unsigned macOS build, and that used
   to be the end of it: the user got a link to the releases page and did
   the download, the drag and the relaunch by hand.

   Squirrel refuses because it cannot VALIDATE a signature. Replacing an
   app bundle does not actually require one — it is a directory swap, and
   the app can do it. So it does.

   ── What this is not ────────────────────────────────────────────────

   **It is not a substitute for code signing and must not be described as
   one.** Squirrel's check exists so that somebody who can serve you bytes
   cannot replace your app. What is verified here is the SHA-512 the feed
   publishes, over HTTPS, against the bytes that arrive: that catches a
   corrupted or tampered DOWNLOAD and does nothing at all about a tampered
   RELEASE. Anyone who can publish to the repo can publish anything —
   exactly as they can today for the manual download this replaces. No
   worse than doing it by hand, and not as good as a signature.

   ── The consequence nobody expects, handled here ────────────────────

   Every sideload changes the binary's cdhash, and TCC binds an unsigned
   app's permissions to the cdhash. A successful update therefore SILENTLY
   revokes screen recording and accessibility while leaving both switches
   ON in System Settings, and macOS never re-asks because a row already
   exists. That is the failure `recorder:resetScreenPermission` was written
   for, and shipping an update button without handling it would hand the
   user a button that quietly breaks the recorder every time they press it.

   So the grants are cleared as PART of the update, before the relaunch.
   The user is asked once, which is honest and actionable. A signed build
   never reaches this path.
   ═══════════════════════════════════════════════════════════════════ */

/** The app bundle root, or null when this is not a packaged macOS app. */
function bundlePath(): string | null {
  if (process.platform !== 'darwin' || !app.isPackaged) return null;
  /* …/Kerf.app/Contents/MacOS/Kerf -> …/Kerf.app */
  const exe = app.getPath('exe');
  const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const at = exe.lastIndexOf(marker);
  return at === -1 ? null : exe.slice(0, at);
}

/**
 * Can Kerf replace its own bundle in place?
 *
 * Writability is checked on the PARENT rather than on the bundle: the
 * swap is a rename plus a copy in that directory, so a read-only
 * `/Applications` fails even when the bundle itself is writable. An app
 * still running from a mounted .dmg fails this too, which is correct.
 */
function canSideload(): boolean {
  const bundle = bundlePath();
  if (!bundle) return false;
  try {
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function run(cmd: string, args: string[], timeoutMs = 10 * 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1 << 22 }, (err, _o, stderr) => {
      if (err) reject(new Error((stderr || '').trim() || err.message));
      else resolve();
    });
  });
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

/**
 * The macOS entry from the published feed: the zip's name and its
 * SHA-512, straight out of `latest-mac.yml`.
 *
 * Read with a regex rather than a YAML dependency, because the shape is
 * fixed by electron-builder and one more parser in the main process is
 * one more thing that can fail at launch. If the shape ever changes this
 * throws naming what it could not read, rather than half-matching.
 */
async function download(url: string, to: string, onPercent: (p: number) => void): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`${url} answered ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let seen = 0;
  const out = fs.createWriteStream(to);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    out.write(Buffer.from(value));
    if (total > 0) onPercent(Math.min(99, Math.round((seen / total) * 100)));
  }
  await new Promise<void>((resolve, reject) => out.end((e?: Error) => (e ? reject(e) : resolve())));
}

function sha512Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    fs.createReadStream(file)
      .on('data', (c) => hash.update(c as Buffer))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('base64')));
  });
}

/**
 * Clear the permissions this update is about to invalidate.
 *
 * Best effort on purpose: `tccutil` failing is not a reason to abandon an
 * update that is already downloaded, verified and swapped in. The
 * recorder detects and reports a stale grant on its own, so the worst
 * case here is the state the user is in today.
 */
/**
 * Remove a tree that may contain an asar archive.
 *
 * `fs.rmSync(…, { recursive: true })` cannot do it inside Electron. The
 * asar integration makes `app.asar` stat as a directory so that reads
 * inside it resolve, which means a recursive walk descends into it and
 * then calls `rmdir` on what is really a file: `ENOTDIR`. `noAsar` is
 * the documented way to ask for the unpatched behaviour, and it is
 * restored afterwards rather than set once, because leaving it on would
 * break every later read of the app's own resources.
 */
function rmTree(target: string): void {
  const patched = process.noAsar;
  process.noAsar = true;
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } finally {
    process.noAsar = patched;
  }
}

async function resetStaleGrants(): Promise<string[]> {
  const cleared: string[] = [];
  for (const service of ['ScreenCapture', 'Accessibility', 'ListenEvent']) {
    try {
      await run('tccutil', ['reset', service, 'com.kerf.editor'], 20_000);
      cleared.push(service);
    } catch { /* an absent row is not a failure */ }
  }
  return cleared;
}

export interface SideloadResult { ok: boolean; message: string; version?: string }

/**
 * Download the published zip, verify it, and swap this bundle for it.
 *
 * The old bundle is MOVED aside rather than deleted, and moved back if
 * anything after that point fails. A half-replaced `/Applications/Kerf.app`
 * is the one outcome worth extra code to avoid: it leaves the user with
 * no working app and no obvious way back.
 */
async function sideloadUpdate(): Promise<SideloadResult> {
  const bundle = bundlePath();
  if (!bundle) return { ok: false, message: 'This is not a packaged macOS build, so there is nothing to replace.' };
  if (!canSideload()) {
    return { ok: false, message: `${path.dirname(bundle)} is not writable, so Kerf cannot replace itself there.` };
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kerf-update-'));
  const aside = `${bundle}.old-${Date.now()}`;
  const cleanup = () => { try { rmTree(work); } catch { /* temp */ } };

  try {
    const base = 'https://github.com/teminali/kerf/releases/latest/download';
    const want = parseFeed(await fetchText(`${base}/latest-mac.yml`), process.arch);
    publish({ state: 'downloading', version: want.version, percent: 0, bytesPerSecond: 0 });

    const zip = path.join(work, want.name);
    await download(`${base}/${encodeURIComponent(want.name)}`, zip,
      (percent) => publish({ state: 'downloading', version: want.version, percent, bytesPerSecond: 0 }));

    if (await sha512Of(zip) !== want.sha512) {
      cleanup();
      return { ok: false, message: 'The download did not match the checksum the release publishes, so it was thrown away.' };
    }

    /* `ditto -xk` rather than `unzip`: it is what preserves the bundle's
       symlinks, extended attributes and executable bits. An app expanded
       with `unzip` does not launch. */
    const staged = path.join(work, 'staged');
    fs.mkdirSync(staged);
    await run('/usr/bin/ditto', ['-xk', zip, staged]);

    const found = fs.readdirSync(staged).find((n) => n.endsWith('.app'));
    if (!found) { cleanup(); return { ok: false, message: 'The download held no .app bundle.' }; }
    const fresh = path.join(staged, found);
    if (!fs.existsSync(path.join(fresh, 'Contents', 'MacOS'))) {
      cleanup();
      return { ok: false, message: 'The downloaded bundle is not shaped like an app.' };
    }

    fs.renameSync(bundle, aside);
    try {
      await run('/bin/cp', ['-R', fresh, bundle]);
    } catch (err) {
      try { rmTree(bundle); } catch { /* nothing there */ }
      fs.renameSync(aside, bundle);
      cleanup();
      return { ok: false, message: `The swap failed and the old version was put back. ${(err as Error).message}` };
    }

    /*
      The new bundle is IN PLACE from here on, so nothing below may
      fail the update.

      This line used to be a plain `fs.rmSync(aside, {recursive:true})`
      and it threw every single time:

          ENOTDIR: not a directory, rmdir
          '/Applications/Kerf.app.old-…/Contents/Resources/app.asar'

      Electron patches `fs` so an asar archive reads as a DIRECTORY —
      that is what makes `require` work inside it — so a recursive
      remove walks into `app.asar` and then `rmdir`s a file. `rmTree`
      turns the patch off for the duration.

      The throw landed in the outer catch, which correctly declined to
      roll back (the new bundle exists) and then returned ok: false. So
      a completely successful update reported failure, and the two lines
      below never ran: the user was told to try again while already on
      the new version, and `resetStaleGrants` — the entire reason this
      function is safe to offer — was skipped, leaving screen recording
      and accessibility silently revoked with both switches still ON.

      Found by running it. It cannot be caught any other way: it needs a
      real packaged build replacing a real packaged build.
    */
    try {
      rmTree(aside);
    } catch (err) {
      log.warn('[updater] the old bundle could not be removed:', (err as Error).message);
    }
    cleanup();

    const cleared = await resetStaleGrants();
    log.info('[updater] sideloaded', want.version, 'cleared:', cleared.join(', ') || 'none');
    publish({ state: 'ready', version: want.version });

    return {
      ok: true,
      version: want.version,
      message:
        `Kerf ${want.version} is installed. Screen recording and accessibility were cleared, `
        + 'because an unsigned update always invalidates them, so macOS will ask again once Kerf restarts.',
    };
  } catch (err) {
    try { if (fs.existsSync(aside) && !fs.existsSync(bundle)) fs.renameSync(aside, bundle); } catch { /* best effort */ }
    cleanup();
    return { ok: false, message: (err as Error).message };
  }
}

let initialised = false;

export function initAutoUpdater(window: BrowserWindow) {
  // The window is re-bound on every call so events reach the live one.
  mainWindow = window;

  /*
    Everything below registers global handlers exactly once. On macOS
    `createWindow()` runs again whenever the dock icon is clicked with no
    windows open, and `ipcMain.handle` throws on a duplicate channel —
    which would take down the second window before it appeared.
  */
  if (initialised) return;
  initialised = true;

  log.transports.file.level = 'info';
  const autoUpdater = updater();
  autoUpdater.logger = log;

  // We drive both steps explicitly so the user keeps control of the restart.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => publish({ state: 'checking' }));

  autoUpdater.on('update-available', (info) => {
    if (!canSelfUpdate()) {
      publish({
        state: 'manual-only',
        version: info.version,
        url: RELEASES_URL,
        canSideload: canSideload(),
      });
      return;
    }
    publish({ state: 'available', version: info.version, notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined });
    void updater().downloadUpdate();
  });

  autoUpdater.on('update-not-available', () => {
    publish({ state: 'up-to-date', version: app.getVersion() });
  });

  autoUpdater.on('download-progress', (p) => {
    publish({
      state: 'downloading',
      version: status.state === 'available' ? status.version : app.getVersion(),
      percent: Math.round(p.percent),
      bytesPerSecond: Math.round(p.bytesPerSecond),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    publish({ state: 'ready', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    /*
      A build with no app-update.yml is not a broken build — it is a
      build that was never configured for updates (a --dir package, or a
      dev run). Reporting ENOENT as an error put a warning triangle in
      the title bar on every launch and told the user nothing they could
      act on.
    */
    const message = err?.message ?? String(err);
    if (/app-update\.yml/i.test(message)) {
      publish({ state: 'up-to-date', version: app.getVersion() });
      return;
    }

    publish({ state: 'error', message: err?.message ?? String(err) });
  });

  /* ── Renderer API ── */

  ipcMain.handle('updater:status', () => status);
  ipcMain.handle('updater:currentVersion', () => app.getVersion());

  ipcMain.handle('updater:check', async () => {
    if (!app.isPackaged) {
      publish({ state: 'up-to-date', version: app.getVersion() });
      return status;
    }
    try {
      await updater().checkForUpdates();
    } catch (err) {
      publish({ state: 'error', message: (err as Error).message });
    }
    return status;
  });

  ipcMain.handle('updater:install', () => {
    if (status.state !== 'ready') return false;
    // `isSilent: false, isForceRunAfter: true` — show the installer on
    // Windows and come back up afterwards.
    updater().quitAndInstall(false, true);
    return true;
  });

  ipcMain.handle('updater:openReleases', () => shell.openExternal(RELEASES_URL));

  /**
   * Do the update ourselves, on a build Squirrel will not update.
   *
   * Relaunching is the caller's move, not this one's: the renderer knows
   * whether there is unsaved work and this does not, and applying an
   * update under somebody's hands is the failure the whole flow is built
   * to avoid.
   */
  ipcMain.handle('updater:sideload', async (): Promise<SideloadResult> => {
    if (canSelfUpdate()) {
      return { ok: false, message: 'This build can update itself; use Restart to update.' };
    }
    const result = await sideloadUpdate();
    if (!result.ok) publish({ state: 'error', message: result.message });
    return result;
  });

  ipcMain.handle('updater:relaunch', () => {
    app.relaunch();
    app.exit(0);
    return true;
  });

  /*
    Check shortly after launch rather than immediately: the first seconds
    belong to painting the window, not to a network round trip. Then once
    every six hours for sessions that stay open for days.
  */
  if (app.isPackaged) {
    setTimeout(() => void updater().checkForUpdates()?.catch(() => {}), 8_000);
    setInterval(() => void updater().checkForUpdates()?.catch(() => {}), 6 * 60 * 60 * 1000);
  }
}
