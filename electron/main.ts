import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import http from 'http';
import { initAutoUpdater } from './updater';
import { initToolBridge, setBridgeWindow } from './toolBridge';
import { startRpcServer } from './rpcServer';
import {
  startSession, stopSession, resetSession, isRunning, findClaudeCli, getCliVersion,
  writeMcpConfig,
} from './claudeSession';

/*
  This file is bundled to CommonJS (`main.cjs`), so `__dirname` is native
  and no import.meta shim is needed. CJS is deliberate: an ESM entry point
  inside an asar archive fails to load silently on Electron 34 — the
  process exits 0 having printed nothing, which is an awful thing to debug.
*/

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    // The renderer draws its own title bar; on macOS we only inset the
    // traffic lights into it. `--titlebar-inset` in the CSS reserves the
    // matching gutter, so the two stay in step.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 13 },
    // Matches --stage, so the window never flashes white before first paint.
    backgroundColor: '#060709',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  // Painting into a hidden window and revealing it once ready avoids the
  // white flash every Electron app gets for free otherwise.
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  if (!app.isPackaged) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  initAutoUpdater(mainWindow);
  setBridgeWindow(mainWindow);

  mainWindow.on('closed', () => {
    setBridgeWindow(null);
    mainWindow = null;
  });
}

ipcMain.handle('dialog:openMedia', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Media Files', extensions: ['mp4', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'aac', 'png', 'jpg', 'jpeg', 'webp'] },
    ],
  });
  return result.filePaths;
});

ipcMain.handle('dialog:saveExport', async (_, defaultName: string) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'AuraCut_Render_Master.mp4',
    filters: [
      { name: 'MP4 Video (H.264 / HEVC)', extensions: ['mp4'] },
      { name: 'Apple ProRes 422', extensions: ['mov'] },
    ],
  });
  return result.filePath;
});

/* ── Claude Code session IPC ─────────────────────────────────────── */

function registerAgentIpc() {
  ipcMain.handle('claude:status', async () => {
    const cli = findClaudeCli();
    return {
      installed: Boolean(cli),
      path: cli,
      version: cli ? await getCliVersion(cli) : null,
      running: isRunning(),
    };
  });

  ipcMain.handle('claude:send', async (_e, payload: { prompt: string; resume?: boolean }) => {
    if (!mainWindow) return false;
    if (isRunning()) return false;
    await startSession(mainWindow, { prompt: payload.prompt, resume: payload.resume });
    return true;
  });

  /* The same config the in-app session uses, so the user can point their
     own terminal at the running editor with `claude --mcp-config <path>`. */
  ipcMain.handle('claude:mcpConfigPath', () => writeMcpConfig());

  ipcMain.handle('claude:stop', () => { stopSession(); return true; });
  ipcMain.handle('claude:reset', () => { resetSession(); return true; });
}

app.whenReady().then(() => {
  initToolBridge();
  registerAgentIpc();
  startRpcServer();
  writeMcpConfig();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
