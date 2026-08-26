import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import http from 'http';
import { initAutoUpdater } from './updater';
import { initToolBridge, setBridgeWindow } from './toolBridge';
import { transcribeMedia, transcriberStatus, analyzeAudio, setupTranscription } from './transcribe';
import { startExport, writeFrame, finishExport, cancelExport, ExportClipAudio, StartExportOptions } from './render';
import { startRpcServer } from './rpcServer';
import {
  startSession, stopSession, resetSession, isRunning, findClaudeCli, getCliVersion,
  writeMcpConfig, setBackend, getBackendId, listBackends,
} from './claudeSession';
import { installBackend, signInCommand, BackendId } from './agentBackends';

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

  /*
    `queryLocalFonts()` is gated behind a permission that has no UI in
    Electron, so without this it is denied by default and the font
    picker silently falls back to probing a candidate list. Local fonts
    are exactly as sensitive as the fonts already readable through CSS.
  */
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'local-fonts');
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

  /* In development, renderer errors are otherwise invisible from a
     terminal — a crashed React tree just looks like a black window. */
  if (!app.isPackaged) {
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message}  (${sourceId}:${line})`);
    });
    mainWindow.webContents.on('render-process-gone', (_e, details) =>
      console.log('[renderer] gone:', JSON.stringify(details)));
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) =>
      console.log(`[renderer] did-fail-load ${code} ${desc} ${url}`));
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
    /*
      Reports the SELECTED backend, not Claude specifically. The header
      badge reads this, and it would otherwise show Claude's readiness
      while a different CLI was actually driving the Copilot.
    */
    const id = getBackendId();
    const surveyed = (await listBackends(false)).find((b) => b.id === id);
    return {
      installed: Boolean(surveyed?.installed),
      path: surveyed?.path ?? null,
      version: surveyed?.version ?? null,
      label: surveyed?.label ?? 'Claude Code',
      backendId: id,
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

  /* Speech-to-text lives in main: it shells out to ffmpeg and Whisper,
     neither of which a renderer can reach. */
  ipcMain.handle('stt:status', () => transcriberStatus());
  ipcMain.handle(
    'stt:transcribe',
    async (_e, payload: { mediaUrl: string; language?: string; model?: string }) =>
      transcribeMedia({
        ...payload,
        onProgress: (percent, note) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('stt:progress', { percent, note });
          }
        },
      })
  );

  /*
    Generated media has to reach the DISK, not just memory. ffmpeg
    cannot read a `blob:` URL, so a synthesised sound that only existed
    as an object URL would play in the preview and vanish from the
    export — silently, which is the failure mode this project keeps
    having to hunt down.
  */
  ipcMain.handle('media:writeTemp', async (_e, p: { name: string; bytes: Uint8Array }) => {
    const fs = await import('fs');
    const os = await import('os');
    const dir = path.join(os.tmpdir(), 'auracut-generated');
    fs.mkdirSync(dir, { recursive: true });

    // Never let a caller-supplied name escape the directory.
    const safe = path.basename(p.name).replace(/[^\w.\-]+/g, '_') || 'audio.wav';
    const filePath = path.join(dir, `${Date.now().toString(36)}_${safe}`);
    fs.writeFileSync(filePath, Buffer.from(p.bytes));
    return filePath;
  });

  ipcMain.handle('audio:analyze', async (_e, p: { mediaUrl: string; silenceThresholdDb?: number; minSilenceMs?: number }) =>
    analyzeAudio(p.mediaUrl, p.silenceThresholdDb, p.minSilenceMs));
  ipcMain.handle('stt:setup', async (_e, p: { model?: string }) => setupTranscription(p?.model));

  /* Export. Frames arrive from the renderer as JPEG and go straight to
     ffmpeg's stdin; audio is rebuilt from sources at the end. */
  ipcMain.handle('export:start', (_e, opts: StartExportOptions) => startExport(opts));
  ipcMain.handle('export:frame', (_e, p: { sessionId: string; jpeg: Uint8Array }) =>
    writeFrame(p.sessionId, p.jpeg));
  ipcMain.handle('export:finish', (_e, p: { sessionId: string; audioClips: ExportClipAudio[] }) =>
    finishExport(p.sessionId, p.audioClips));
  ipcMain.handle('export:cancel', (_e, p: { sessionId: string }) => { cancelExport(p.sessionId); return true; });

  /* ── Which CLI drives the Copilot ── */

  ipcMain.handle('agents:list', async (_e, p: { deep?: boolean }) => ({
    selected: getBackendId(),
    backends: await listBackends(p?.deep ?? false),
  }));

  ipcMain.handle('agents:select', (_e, p: { id: BackendId }) => {
    setBackend(p.id);
    return getBackendId();
  });

  ipcMain.handle('agents:install', async (_e, p: { id: BackendId }) =>
    installBackend(p.id, (line) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agents:install-progress', { id: p.id, line });
      }
    }));

  /*
    Sign-in is an OAuth flow with a browser round trip and a prompt. It
    cannot run inside a headless child process, so the honest version of
    a button is a real terminal already running the right command.
  */
  ipcMain.handle('agents:signIn', async (_e, p: { id: BackendId }) => {
    const command = signInCommand(p.id);
    if (!command) return { ok: false, message: 'No sign-in command for that agent.' };

    if (process.platform === 'darwin') {
      const { execFile } = await import('child_process');
      execFile('osascript', [
        '-e',
        `tell application "Terminal" to do script "${command}"`,
        '-e',
        'tell application "Terminal" to activate',
      ]);
      return { ok: true, message: `Opened Terminal running \`${command}\`.` };
    }
    return { ok: false, message: `Run \`${command}\` in a terminal, then reopen AuraCut.` };
  });

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
