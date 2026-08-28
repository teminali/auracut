import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import {
  readSession as readStoreSession,
  writeSession as writeStoreSession,
  clearSession as clearStoreSession,
  storeBaseUrl,
} from './storeSession';
import path from 'path';
import http from 'http';
import { initAutoUpdater } from './updater';
import { initToolBridge, setBridgeWindow } from './toolBridge';
import {
  transcribeMedia, transcriberStatus, analyzeAudio, setupTranscription, ffmpeg,
  cancelTranscription,
} from './transcribe';
import { startExport, writeFrame, finishExport, cancelExport, ExportClipAudio, StartExportOptions } from './render';
import { ffmpegSource } from './mediaPath';
import { execFile } from 'child_process';
import { startRpcServer } from './rpcServer';
import { initScreenRecorder, shutdownScreenRecorder } from './screenRecorder';
import { initUserSkills } from './userSkills';
import { initCaptionCleanup } from './captionCleanup';
import { initStreamer, setStreamWindow } from './streamer';
import { initSkillTrials } from './skillTrials';
import { initCrashLog, logEvent, crashLogPath } from './crashLog';
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

/*
  Keep painting when another window covers Kerf.

  macOS occlusion detection pauses frame production for a covered window.
  Nothing about the app needs those frames — but `debug/capture` does, and
  `webContents.capturePage()` on a window that has stopped compositing
  returns the LAST FRAME IT PAINTED, with no error and no indication. So
  the endpoint HANDOVER offers for "does the panel look right" answered
  with the screen from before the change, which is the most expensive kind
  of wrong answer: it looks like a real screenshot.

  Found by capturing after setting `document.body.style.background = red`
  and getting a byte-identical PNG back — the app had navigated from the
  home screen to the editor and every capture still showed home.
*/
app.commandLine.appendSwitch('disable-features', 'MacWebContentsOcclusion');

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
      /*
        macOS throttles a background window's timers and rendering. Kerf
        runs long exports that a user will reasonably switch away from,
        and an export that slows down because you looked at your email is
        a bad property for a video editor to have.

        Measured, interleaved, on the 345-frame 1080p starter export:
        with throttling ON both minimised runs were slower than both
        raised ones (19.1/18.8 against 16.4/15.5, ~20%); with it OFF
        there is no ordered gap. n=2 per cell, so 20% is an order of
        magnitude rather than a figure.

        This is NOT the fix for the stalled suites in trap 6b — that was
        machine load, and it was misdiagnosed as visibility three
        separate times this session.
      */
      backgroundThrottling: false,
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

  /*
    Renderer failures, to the terminal in development AND to the log file
    always.

    This block used to be wrapped in `if (!app.isPackaged)`, which is
    backwards: in development you have devtools and a terminal, and in
    the packaged build you have neither. The one build where a user meets
    a crash was the one build that recorded nothing.
  */
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (!app.isPackaged) console.log(`[renderer:${level}] ${message}  (${sourceId}:${line})`);
    // level 3 is console.error. Logging every log line would bury the
    // one entry that matters under the app's own chatter.
    if (level >= 3) logEvent('renderer', 'error', message, `${sourceId}:${line}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    if (!app.isPackaged) console.log('[renderer] gone:', JSON.stringify(details));
    logEvent('renderer', 'error', `render process gone: ${details.reason}`, details);
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    if (!app.isPackaged) console.log(`[renderer] did-fail-load ${code} ${desc} ${url}`);
    // -3 is ERR_ABORTED, which every ordinary in-app navigation reports.
    if (code !== -3) logEvent('renderer', 'error', `did-fail-load ${code} ${desc}`, url);
  });
  mainWindow.webContents.on('unresponsive', () =>
    logEvent('renderer', 'warn', 'window became unresponsive'));

  initAutoUpdater(mainWindow);
  setBridgeWindow(mainWindow);
  setStreamWindow(mainWindow);

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
    setStreamWindow(null);
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
  /* Abandon a transcription in flight. A long take must not be a trap. */
  ipcMain.handle('stt:cancel', () => cancelTranscription());

  ipcMain.handle(
    'stt:transcribe',
    async (_e, payload: {
      mediaUrl: string; language?: string; model?: string; wordTimestamps?: boolean;
    }) =>
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
  /*
    Writing a project back out.

    There was a `project:read` and no counterpart, so an agent could open
    a project and never save one — `serializeProject()` existed in the
    renderer and nothing could get its output to disk. Found while
    building the first skill by hand: a skill IS a template project plus
    its assets, and there was no way to produce the template.

    Refuses to create directories. A save that silently invents a path
    is how work ends up somewhere nobody looks.
  */
  ipcMain.handle('project:write', async (_e, p: { path: string; json: string }) => {
    const fs = await import('fs');
    const path = await import('path');
    try {
      const dir = path.dirname(p.path);
      if (!fs.existsSync(dir)) {
        return { ok: false, error: `No such directory: ${dir}` };
      }
      fs.writeFileSync(p.path, p.json, 'utf8');
      return { ok: true, bytes: Buffer.byteLength(p.json, 'utf8') };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

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

  /*
    The ffmpeg bridge.

    A large slice of "Kerf cannot do that" is really "the compositor
    cannot do that in real time" — stabilisation, frame interpolation,
    denoise, reverse, a 3D LUT. All of them ffmpeg does well, offline, to
    a file. Pre-rendering to temp and importing the result turns a wall
    into a wait.

    The renderer supplies a FILTER STRING and named options, never argv.
    Building the command here means a caller cannot reach `-f`, an output
    path, or anything else that writes where it likes; the worst it can
    express is a bad filtergraph, which fails with ffmpeg's own message.
  */
  ipcMain.handle('ffmpeg:process', async (_e, p: {
    input: string;
    vf?: string;
    af?: string;
    fps?: number;
    codec?: 'h264' | 'prores';
    noAudio?: boolean;
    audioOnly?: boolean;
    name?: string;
  }) => {
    const ff = ffmpeg();
    if (!ff) return { ok: false, error: 'ffmpeg was not found.' };

    const fs = await import('fs');
    const os = await import('os');
    const dir = path.join(os.tmpdir(), 'kerf-processed');
    fs.mkdirSync(dir, { recursive: true });

    const safe = path.basename(p.name || 'processed').replace(/[^\w.\-]+/g, '_') || 'processed';
    const ext = p.audioOnly ? 'wav' : p.codec === 'prores' ? 'mov' : 'mp4';
    const outPath = path.join(dir, `${Date.now().toString(36)}_${safe}.${ext}`);

    const args = ['-y', '-nostdin', '-i', ffmpegSource(p.input)];
    if (p.vf) args.push('-vf', p.vf);
    if (p.af) args.push('-af', p.af);
    if (p.fps) args.push('-r', String(p.fps));

    if (p.audioOnly) {
      args.push('-vn', '-c:a', 'pcm_s16le', '-ar', '48000');
    } else {
      if (p.noAudio) args.push('-an');
      else args.push('-c:a', 'aac', '-b:a', '256k');
      if (p.codec === 'prores') args.push('-c:v', 'prores_ks', '-profile:v', '3');
      else args.push('-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p');
    }
    args.push(outPath);

    return await new Promise((resolve) => {
      execFile(ff, args, { timeout: 15 * 60_000, maxBuffer: 1024 * 1024 }, (err, _o, stderr) => {
        const text = (stderr || '').trim();
        if (err || !fs.existsSync(outPath)) {
          resolve({
            ok: false,
            error: text.split('\n').filter(Boolean).slice(-3).join(' ') || (err as Error)?.message || 'ffmpeg failed.',
          });
          return;
        }
        const size = fs.statSync(outPath).size;
        if (size === 0) {
          resolve({ ok: false, error: 'ffmpeg produced an empty file.' });
          return;
        }
        resolve({ ok: true, path: outPath, bytes: size });
      });
    });
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

  /* ── Kerf Store session ──────────────────────────────────────────
     The token is a credential, so it is held in main at 0600 and the
     renderer is handed it only when it asks. See electron/storeSession.ts
     for why this is not localStorage. */
  ipcMain.handle('store:getSession', () => ({
    session: readStoreSession(),
    baseUrl: storeBaseUrl(),
  }));

  ipcMain.handle('store:setSession', (_e, p: { token: string; expiresAt: number }) => {
    writeStoreSession({ token: p.token, expiresAt: p.expiresAt });
    return true;
  });

  ipcMain.handle('store:clearSession', () => {
    clearStoreSession();
    return true;
  });

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

/*
  Before anything else, because a failure during startup is exactly the
  one nobody could see. `initCrashLog` only touches `app.getPath`, which
  is valid this early.
*/
initCrashLog();

/*
  The renderer's own failures.

  `console-message` catches what React logs, but a `window.onerror` or an
  unhandled promise rejection in the renderer does not necessarily reach
  the console in a form that survives — and the error boundary wants to
  record a component stack, which no console line carries.
*/
function registerCrashIpc(): void {
  ipcMain.handle(
    'crash:report',
    (_e, payload: { message: string; detail?: string; source?: string }) => {
      logEvent('renderer', 'error', payload.message, payload.detail);
      return { ok: true, logPath: crashLogPath() };
    }
  );
  ipcMain.handle('crash:logPath', () => crashLogPath());
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
  registerCrashIpc();
  /*
    Passed as a getter, not as the window. `createWindow` runs AFTER
    this and reassigns `mainWindow` on every relaunch from the dock, so
    a captured reference would be the FIRST window for the rest of the
    session — and the recorder would hide a window nobody is looking at.
  */
  initScreenRecorder(() => mainWindow);
  initUserSkills();
  initCaptionCleanup();
  initStreamer();
  initSkillTrials();
  // Only once the port is actually ours — see rpcServer's listen callback.
  startRpcServer(() => writeMcpConfig());
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

/*
  A recording holds three things that MUST NOT outlive the process: a
  global shortcut (which would keep Alt+Shift+R away from every other
  app on the machine), an always-on-top window, and open file handles.
  `will-quit` is the last point all three are still reachable.
*/
app.on('will-quit', () => shutdownScreenRecorder());
