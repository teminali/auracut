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
  /** An update exists but this build cannot install it — see the macOS note. */
  | { state: 'manual-only'; version: string; url: string }
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
      publish({ state: 'manual-only', version: info.version, url: RELEASES_URL });
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
