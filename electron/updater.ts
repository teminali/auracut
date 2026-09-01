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
import {
  markPermissionResetPending,
  permissionResetStateFile,
} from '../src/services/permissionReset';

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

export const RELEASES_URL = 'https://github.com/teminali/frontierCut/releases/latest';

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

   So the update records a durable reset obligation BEFORE replacing the
   bundle. The next packaged launch clears the grants before the recorder
   starts. That launch may come from the button, Finder, a reboot, or a
   rollback; correctness no longer depends on Electron successfully
   relaunching a bundle that changed underneath it. A signed build never
   reaches this path.
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

export interface SideloadResult { ok: boolean; message: string; version?: string }

/**
 * Download the published zip, verify it, and swap this bundle for it.
 *
 * The old bundle is MOVED aside rather than deleted, and moved back if
 * anything after that point fails. A half-replaced `/Applications/Kerf.app`
 * is the one outcome worth extra code to avoid: it leaves the user with
 * no working app and no obvious way back.
 */
/**
 * The releases this build could switch to, newest first.
 *
 * From the GitHub API rather than from a list compiled here, because a
 * list compiled here is wrong the moment anything ships. Unauthenticated
 * and cached for a few minutes: it is asked for when a menu opens, and
 * the rate limit is sixty an hour.
 */
export interface ReleaseOption {
  version: string;
  tag: string;
  publishedAt: string;
  /** True for the version that is running right now. */
  current: boolean;
}

let releaseCache: { at: number; releases: ReleaseOption[] } | null = null;
const RELEASE_CACHE_MS = 5 * 60_000;

export async function listReleases(limit = 4): Promise<ReleaseOption[]> {
  if (releaseCache && Date.now() - releaseCache.at < RELEASE_CACHE_MS) {
    return releaseCache.releases.slice(0, limit);
  }

  const res = await fetch(
    'https://api.github.com/repos/teminali/frontierCut/releases?per_page=15',
    { headers: { Accept: 'application/vnd.github+json' } }
  );
  if (!res.ok) throw new Error(`GitHub answered ${res.status} when asked for the releases.`);

  const raw = (await res.json()) as {
    tag_name?: string; draft?: boolean; prerelease?: boolean; published_at?: string;
  }[];

  const running = app.getVersion();
  const releases = raw
    .filter((r) => r.tag_name && !r.draft && !r.prerelease)
    .map((r) => ({
      version: r.tag_name!.replace(/^v/, ''),
      tag: r.tag_name!,
      publishedAt: r.published_at ?? '',
      current: r.tag_name!.replace(/^v/, '') === running,
    }));

  releaseCache = { at: Date.now(), releases };
  return releases.slice(0, limit);
}

/**
 * Replace this bundle with a specific version, or with the latest.
 *
 * `version` undefined means "the latest", which is what the update
 * button asks for. A version string means GO THERE, including
 * BACKWARDS, which is the whole point of being able to roll back: a
 * release that turns out to be broken is only recoverable in place if
 * the app can install an older one over itself.
 *
 * Every release publishes its own `latest-mac.yml` beside its
 * artifacts, so the checksum a rollback verifies against is the one
 * that shipped WITH that version rather than the current feed. Without
 * that this would verify the old zip against the new manifest and fail
 * every time.
 */
async function sideloadUpdate(version?: string): Promise<SideloadResult> {
  const bundle = bundlePath();
  if (!bundle) return { ok: false, message: 'This is not a packaged macOS build, so there is nothing to replace.' };
  if (!canSideload()) {
    return { ok: false, message: `${path.dirname(bundle)} is not writable, so Kerf cannot replace itself there.` };
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kerf-update-'));
  const aside = `${bundle}.old-${Date.now()}`;
  const cleanup = () => { try { rmTree(work); } catch { /* temp */ } };

  try {
    const base = version
      ? `https://github.com/teminali/frontierCut/releases/download/v${encodeURIComponent(version)}`
      : 'https://github.com/teminali/frontierCut/releases/latest/download';
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

    /*
      This write is part of the safety boundary, not bookkeeping. If it
      fails, leave the running bundle alone: replacing an unsigned build
      without a durable reset obligation recreates the stale-on-switch
      state this updater exists to prevent.
    */
    markPermissionResetPending(
      permissionResetStateFile(app.getPath('userData')),
      want.version
    );

    fs.renameSync(bundle, aside);
    try {
      await run('/bin/cp', ['-a', fresh, bundle]);
      try { await run('/usr/bin/xattr', ['-c', bundle]); } catch { /* best effort */ }
      try { await run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle]); } catch { /* best effort */ }
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
      the new version. The reset obligation is now persisted BEFORE the
      swap, so cleanup can no longer skip the one fact the next launch
      needs in order to repair TCC.

      Found by running it. It cannot be caught any other way: it needs a
      real packaged build replacing a real packaged build.
    */
    try {
      rmTree(aside);
    } catch (err) {
      log.warn('[updater] the old bundle could not be removed:', (err as Error).message);
    }
    cleanup();

    log.info('[updater] sideloaded', want.version, 'permission reset pending on next launch');
    publish({ state: 'ready', version: want.version });

    return {
      ok: true,
      version: want.version,
      message:
        `Kerf ${want.version} is installed. Close and reopen Kerf when you are ready; `
        + 'macOS permissions will be refreshed automatically on that launch.',
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
  ipcMain.handle('updater:sideload', async (_e, p?: { version?: string }): Promise<SideloadResult> => {
    /*
      A ROLLBACK is allowed on a build that can update itself, and an
      update is not. Squirrel installs forward and refuses to go back, so
      "use Restart to update" is the right answer for the update and the
      wrong one for somebody trying to get off a bad release.
    */
    if (canSelfUpdate() && !p?.version) {
      return { ok: false, message: 'This build can update itself; use Restart to update.' };
    }
    const result = await sideloadUpdate(p?.version);
    if (!result.ok) publish({ state: 'error', message: result.message });
    return result;
  });

  ipcMain.handle('updater:releases', async (_e, p?: { limit?: number }) => {
    try {
      return { ok: true as const, releases: await listReleases(p?.limit ?? 4) };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  });

  ipcMain.handle('updater:quitForUpdate', () => {
    log.info('[updater] quit requested after sideload; reopen through macOS to finish');
    // `app.quit()` can be cancelled by the editor's close-to-home guard.
    // This button explicitly says Quit, so finish the process reliably.
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
