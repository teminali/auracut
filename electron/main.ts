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
  writeMcpConfig, setBackend, getBackendId, listBackends, autoSelectBackend,
} from './claudeSession';
import {
  installBackend, signInCommand, BackendId, setStoredKey, clearReadinessCache,
  modelsFor, setModel,
} from './agentBackends';

/*
  This file is bundled to CommonJS (`main.cjs`), so `__dirname` is native
  and no import.meta shim is needed. CJS is deliberate: an ESM entry point
  inside an asar archive fails to load silently on Electron 34 — the
  process exits 0 having printed nothing, which is an awful thing to debug.
*/

let mainWindow: BrowserWindow | null = null;

/*
  Which screen the renderer is showing, so the window's close button can
  mean different things in each — closing the editor goes back to home,
  and closing home quits. Main cannot see React state, so the renderer
  reports it on every change.
*/
let currentScreen: 'home' | 'editor' = 'home';

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
    This used to be `callback(permission === 'local-fonts')`, which was
    wrong twice over: 'local-fonts' is not one of the permissions
    Electron routes through this handler, so the comparison could never
    be true — and because it could never be true, the handler DENIED
    every permission the renderer will ever ask for. Font enumeration
    worked anyway, which is what hid it.

    Only the renderer's own code runs here, so the honest default is to
    allow, and to say so rather than leave a handler that silently means
    "no to everything".
  */
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(true);
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

  /*
    Closing the editor returns to home rather than quitting. Only home
    closes the app. This is the one place the two screens are more than
    a React branch, so the intercept lives here rather than in the
    renderer, where the window button never reaches.
  */
  mainWindow.on('close', (event) => {
    console.log(`[Kerf] close requested while on: ${currentScreen}`);
    if (currentScreen !== 'editor') return;
    event.preventDefault();
    mainWindow?.webContents.send('ui:go-home');
  });

  mainWindow.on('closed', () => {
    setBridgeWindow(null);
    mainWindow = null;
  });
}

ipcMain.handle('ui:setScreen', (_e, p: { screen: 'home' | 'editor' }) => {
  currentScreen = p.screen;
  return true;
});

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
    defaultPath: defaultName || 'Kerf_Render_Master.mp4',
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
    const dir = path.join(os.tmpdir(), 'kerf-generated');
    fs.mkdirSync(dir, { recursive: true });

    // Never let a caller-supplied name escape the directory.
    const safe = path.basename(p.name).replace(/[^\w.\-]+/g, '_') || 'audio.wav';
    const filePath = path.join(dir, `${Date.now().toString(36)}_${safe}`);
    fs.writeFileSync(filePath, Buffer.from(p.bytes));
    return filePath;
  });

  /*
    Read a project file. Kept to a text read with a size ceiling rather
    than a general file-read bridge: the renderer asking main for
    arbitrary paths is exactly the kind of surface that grows into
    something regrettable.
  */
  ipcMain.handle('project:read', async (_e, p: { path: string }) => {
    const fs = await import('fs');
    try {
      const stat = fs.statSync(p.path);
      if (!stat.isFile()) return { ok: false, error: 'That path is not a file.' };
      if (stat.size > 64 * 1024 * 1024) {
        return { ok: false, error: 'That file is too large to be a Kerf project.' };
      }
      return { ok: true, json: fs.readFileSync(p.path, 'utf8') };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
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

  /* Store a key the user pasted, out of their shell profile. */
  ipcMain.handle('agents:setKey', (_e, p: { variable: string; value: string }) => {
    setStoredKey(p.variable, p.value);
    return true;
  });

  ipcMain.handle('agents:recheck', () => { clearReadinessCache(); return true; });

  ipcMain.handle('agents:models', (_e, p: { id: BackendId }) => modelsFor(p.id));
  ipcMain.handle('agents:setModel', (_e, p: { id: BackendId; model: string }) => {
    setModel(p.id, p.model);
    return true;
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
    return { ok: false, message: `Run \`${command}\` in a terminal, then reopen Kerf.` };
  });

  ipcMain.handle('claude:stop', () => { stopSession(); return true; });
  ipcMain.handle('claude:reset', () => { resetSession(); return true; });
}

app.whenReady().then(() => {
  /*
    Land on a backend that can answer. Defaulting blindly to Claude meant
    a user without it — or with it unauthenticated — got an error on
    their first prompt instead of the agent they do have.
  */
  void autoSelectBackend().then((id) => console.log(`[Kerf] Copilot agent: ${id}`));

  initToolBridge();
  registerAgentIpc();
  startRpcServer();
  writeMcpConfig();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/*
  Quit on every platform, macOS included. The usual macOS convention is
  to keep the app alive with no windows, but here closing the window can
  only happen FROM HOME — the editor intercepts it — so a close is an
  explicit "I am done", not an accident.
*/
app.on('window-all-closed', () => app.quit());
