/* ═══════════════════════════════════════════════════════════════════
   Screen recording — the half that only the main process can do.

   Four things live here because a renderer cannot reach any of them:

     1. `desktopCapturer.getSources` enumerates displays and windows.
        The renderer is handed ids and thumbnails and turns one into a
        MediaStream itself; it can never ask for a source that was not
        offered here.

     2. **Chunks go to disk as they arrive.** A MediaRecorder blob held
        in renderer memory for a twenty-minute take is a gigabyte of
        heap that gets copied again the moment anyone reads it. Each
        stream owns an append-only file and each `ondataavailable`
        becomes one `write`, so memory stays flat however long the
        recording runs.

     3. **The cursor track.** `screen.getCursorScreenPoint()` is the
        only cursor position available anywhere in Electron, and it is
        main-only. Sampled at 30Hz against the captured display's
        bounds, it is what the auto-zoom is built from.

        Say plainly what this is NOT: it is not a click stream. Nothing
        in Electron reports a mouse button pressed in another
        application, and detecting one needs a system event tap — an
        accessibility permission and a native module, neither of which
        this app has. So `cursorZoom.ts` infers moments of ATTENTION
        from the track (travel, then stillness), and the user can mark
        one by hand with a global shortcut. Both are real. Neither is
        called a click anywhere the user can read it.

     4. The floating control bar, which is its own window because the
        editor window is hidden while a take is running — and which is
        marked `setContentProtection(true)` so it does not appear in
        the recording it is controlling.

   Files land in the user's Videos folder, not in a temp directory. A
   recording is the most expensive thing this app produces; losing it to
   a reboot because it was written to /tmp would be indefensible.
   ═══════════════════════════════════════════════════════════════════ */

import {
  app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain,
  screen, shell, systemPreferences,
} from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { ffmpeg } from './transcribe';
import { writeSealed, readMaybeSealed, makePrivateDir } from './vault';
import {
  startInputCapture, probeInputCapture, shutdownInputCapture,
  CaptureHandle, InputEvent, InputCaptureStatus,
} from './inputEvents';

/* ── Shapes shared with the renderer ────────────────────────────── */

export type StreamName = 'screen' | 'camera';

export interface CursorSample {
  /** Milliseconds into the RECORDING, with paused time already removed. */
  tMs: number;
  /**
   * Normalised against the captured display's bounds. Deliberately NOT
   * clamped: a value outside 0..1 means the pointer was on another
   * display and is not in frame, and the analyser needs to be able to
   * tell that from "parked against the left edge".
   */
  x: number;
  y: number;
}

interface OutStream {
  name: StreamName;
  filePath: string;
  handle: fs.WriteStream;
  bytes: number;
  closed: boolean;
}

interface Session {
  id: string;
  dir: string;
  startedAtMs: number;
  streams: Map<StreamName, OutStream>;
  cursor: CursorSample[];
  /** Bounds of the captured display, in DIP. Null for a window capture. */
  bounds: Electron.Rectangle | null;
  scaleFactor: number;
  sampler: NodeJS.Timeout | null;
  paused: boolean;
  pausedTotalMs: number;
  pausedAtMs: number;
  /** Moments the user marked by hand, in recording milliseconds. */
  marks: number[];
  /** Real clicks, scrolls and keystrokes, when the hook could be started. */
  events: InputEvent[];
  input: CaptureHandle | null;
  hidWindow: boolean;
}

const sessions = new Map<string, Session>();

/** 30Hz. A zoom target needs the pointer's resting place, not its path. */
const CURSOR_HZ = 30;

let getMainWindow: () => BrowserWindow | null = () => null;
let barWindow: BrowserWindow | null = null;

/* ── Where recordings go ────────────────────────────────────────── */

function stamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + ` ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
}

/**
 * `app.getPath('videos')` throws on a Linux box with no XDG user-dirs
 * configured, which is a normal server-ish install rather than an exotic
 * one. Fall back rather than fail the whole feature.
 */
function recordingsRoot(): string {
  for (const name of ['videos', 'documents'] as const) {
    try {
      return path.join(app.getPath(name), 'TeminaliCut Recordings');
    } catch {
      /* try the next one */
    }
  }
  return path.join(os.tmpdir(), 'kerf-recordings');
}

/* ── The cursor track ───────────────────────────────────────────── */

function startSampling(session: Session): void {
  if (!session.bounds) return;
  const bounds = session.bounds;

  session.sampler = setInterval(() => {
    if (session.paused) return;
    const point = screen.getCursorScreenPoint();
    session.cursor.push({
      tMs: Date.now() - session.startedAtMs - session.pausedTotalMs,
      x: (point.x - bounds.x) / bounds.width,
      y: (point.y - bounds.y) / bounds.height,
    });
  }, Math.round(1000 / CURSOR_HZ));
}

function elapsedMs(session: Session): number {
  const paused = session.paused ? Date.now() - session.pausedAtMs : 0;
  return Date.now() - session.startedAtMs - session.pausedTotalMs - paused;
}

/* ── Global shortcuts ───────────────────────────────────────────── */

/*
  Alt+Shift, because the bar is the real control and these are the
  fallback for a full-screen app that covers it. A combination a user
  presses in another application by accident would be worse than not
  having them: globalShortcut takes the key away from every app on the
  machine for as long as a recording runs.
*/
const SHORTCUTS: [string, 'stop' | 'pause' | 'mark'][] = [
  ['Alt+Shift+R', 'stop'],
  ['Alt+Shift+P', 'pause'],
  ['Alt+Shift+Z', 'mark'],
];

function registerShortcuts(sessionId: string): string[] {
  const registered: string[] = [];
  for (const [accelerator, action] of SHORTCUTS) {
    try {
      const ok = globalShortcut.register(accelerator, () => {
        if (action === 'mark') {
          const session = sessions.get(sessionId);
          if (session) session.marks.push(elapsedMs(session));
        }
        /*
          To the editor window only, never to the bar.

          The bar loads from the same bundle, so `recorderStore` is in
          its module graph and subscribed to this channel too — and a
          second store reacting to `stop` in a window that holds no
          MediaRecorders is a way for one keypress to mean two things.
          The bar learns what happened from the next `recorder:state`
          push, which is at most 200ms behind.
        */
        getMainWindow()?.webContents.send('recorder:command', { action, source: 'shortcut' });
      });
      if (ok) registered.push(accelerator);
    } catch {
      /* Another app owns it. Not fatal: the bar still works. */
    }
  }
  return registered;
}

function releaseShortcuts(): void {
  for (const [accelerator] of SHORTCUTS) {
    try {
      globalShortcut.unregister(accelerator);
    } catch {
      /* nothing held it */
    }
  }
}

/* ── The floating control bar ───────────────────────────────────── */

const BAR_W = 300;
const BAR_H = 54;

function openBar(bounds: Electron.Rectangle | null): void {
  if (barWindow && !barWindow.isDestroyed()) return;

  const area = bounds ?? screen.getPrimaryDisplay().workArea;
  barWindow = new BrowserWindow({
    width: BAR_W,
    height: BAR_H,
    x: Math.round(area.x + (area.width - BAR_W) / 2),
    y: Math.round(area.y + area.height - BAR_H - 34),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // 'screen-saver' is the level that stays above a full-screen window.
  barWindow.setAlwaysOnTop(true, 'screen-saver');
  barWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  /*
    The whole reason this is a separate window rather than an overlay in
    the app: it must not be IN the recording. Content protection is what
    keeps it out — NSWindowSharingNone on macOS, WDA_EXCLUDEFROMCAPTURE
    on Windows 10 2004 and later. It is a no-op on Linux, where the bar
    will appear in a full-screen capture; the renderer says so.
  */
  barWindow.setContentProtection(true);

  barWindow.once('ready-to-show', () => barWindow?.showInactive());

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  if (!app.isPackaged) {
    void barWindow.loadURL(`${devUrl}?window=recorder-bar`);
  } else {
    void barWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      query: { window: 'recorder-bar' },
    });
  }

  barWindow.on('closed', () => { barWindow = null; });
}

function closeBar(): void {
  if (barWindow && !barWindow.isDestroyed()) barWindow.destroy();
  barWindow = null;
}

/**
 * The bar window, for `debug/capture`.
 *
 * It exists because the bar CANNOT be screenshotted from outside the
 * app: `setContentProtection(true)` is what keeps it out of the
 * recording, and the OS honours that for every capture, including the
 * one you would take to check the bar looks right. `capturePage()`
 * renders from Electron's own compositor and is not affected, so this
 * is the only way to see it at all.
 */
export function recorderBarWindow(): BrowserWindow | null {
  return barWindow && !barWindow.isDestroyed() ? barWindow : null;
}

/** True on the platforms where `setContentProtection` actually excludes. */
function barIsHiddenFromCapture(): boolean {
  return process.platform === 'darwin' || process.platform === 'win32';
}

/* ── Turning the take into something an editor can scrub ────────── */

interface RemuxResult {
  ok: boolean;
  path: string;
  /** True when the file is still the raw MediaRecorder container. */
  raw: boolean;
  error?: string;
}

function runFfmpeg(bin: string, args: string[]): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 20 * 60_000, maxBuffer: 4 * 1024 * 1024 }, (err, _out, stderr) => {
      resolve({ ok: !err, stderr: (stderr || '').trim() });
    });
  });
}

/**
 * WebM out of MediaRecorder into MP4.
 *
 * This is not cosmetic. A MediaRecorder file carries NO duration in its
 * header and no cue index, so an `<video>` element reports its duration
 * as `Infinity` and seeking backwards in it re-decodes from zero. An
 * editor that cannot seek is not an editor, so every take goes through
 * here before it reaches the timeline.
 *
 * Stream copy first — a take recorded as H.264 needs no re-encode, and
 * a 4K twenty-minute file re-encoded is minutes of waiting for nothing.
 * If the copy fails (VP8/VP9 cannot go into MP4) the transcode is the
 * fallback rather than the default.
 */
async function toMp4(input: string, tryCopy: boolean): Promise<RemuxResult> {
  const bin = ffmpeg();
  if (!bin) {
    return {
      ok: false,
      path: input,
      raw: true,
      error: 'FFmpeg was not found, so the take is still a .webm. Download FFmpeg in the Packages & Models manager and re-import the file.',
    };
  }

  const output = input.replace(/\.webm$/, '.mp4');
  const base = ['-y', '-nostdin', '-fflags', '+genpts', '-avoid_negative_ts', 'make_zero', '-i', input];
  const tail = [
    '-c:a', 'aac', '-b:a', '192k',
    '-af', 'aresample=async=1:first_pts=0',
    '-movflags', '+faststart',
    output,
  ];

  if (tryCopy) {
    const copied = await runFfmpeg(bin, [...base, '-c:v', 'copy', ...tail]);
    if (copied.ok && fs.existsSync(output) && fs.statSync(output).size > 0) {
      return { ok: true, path: output, raw: false };
    }
  }

  const encoded = await runFfmpeg(bin, [
    ...base,
    '-c:v', 'libx264',
    '-crf', '18',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-fps_mode', 'cfr',
    ...tail,
  ]);
  if (encoded.ok && fs.existsSync(output) && fs.statSync(output).size > 0) {
    return { ok: true, path: output, raw: false };
  }

  return {
    ok: false,
    path: input,
    raw: true,
    error: encoded.stderr.split('\n').filter(Boolean).slice(-2).join(' ')
      || 'ffmpeg could not convert the take.',
  };
}

/* ── Teardown, shared by finish and cancel ──────────────────────── */

async function closeStreams(session: Session): Promise<void> {
  await Promise.all(
    [...session.streams.values()].map(
      (out) =>
        new Promise<void>((resolve) => {
          if (out.closed) { resolve(); return; }
          out.closed = true;
          out.handle.end(() => resolve());
        })
    )
  );
}

function teardown(session: Session): void {
  if (session.sampler) clearInterval(session.sampler);
  session.sampler = null;
  session.input?.stop();
  session.input = null;
  releaseShortcuts();
  closeBar();
  if (session.hidWindow) {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) { win.show(); win.focus(); }
  }
}

/* ── IPC ────────────────────────────────────────────────────────── */

export function initScreenRecorder(mainWindowGetter: () => BrowserWindow | null): void {
  getMainWindow = mainWindowGetter;

  /*
    A hidden editor window must never outlive the take that hid it.

    `hideWindow` hides the main window for the duration of a recording,
    and `teardown` shows it again on both exit paths. Neither runs if the
    RENDERER goes away mid-take: the session id lives in the renderer, so
    a reload, an HMR update or a crash means `recorder:finish` and
    `recorder:cancel` are never called, the session is orphaned, and the
    window stays hidden for the life of the process.

    What that looks like from outside is the part that costs the time.
    The floating bar is `skipTaskbar` and content-protected, so with the
    editor hidden macOS reports the app as having NO windows and being
    background-only: no Dock icon, nothing in the app switcher, and
    AppleScript cannot unhide it because it is hidden at the window
    level rather than the app level. The app is running perfectly and
    answering its RPC, and there is no way to get back to it. Reported
    as "I do not see the electron icon on my bottom mac tabbar".

    So the renderer loading is treated as proof that no take can still be
    running in it: orphaned sessions are torn down and the window comes
    back. A reload during a take has already killed the capture — the
    MediaRecorder lives in the renderer — so there is nothing left to
    protect by staying hidden.
  */
  const reconcileOnLoad = () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.on('did-finish-load', () => {
      for (const session of [...sessions.values()]) {
        teardown(session);
        void closeStreams(session);
      }
      const live = getMainWindow();
      if (live && !live.isDestroyed() && !live.isVisible()) { live.show(); live.focus(); }
    });
  };
  if (getMainWindow()) reconcileOnLoad();
  else app.whenReady().then(() => setTimeout(reconcileOnLoad, 0));

  ipcMain.handle('recorder:sources', async (_e, p: { thumbWidth?: number }) => {
    const width = p?.thumbWidth ?? 480;
    let sources: Electron.DesktopCapturerSource[] = [];
    try {
      sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width, height: Math.round((width * 9) / 16) },
        fetchWindowIcons: true,
      });
    } catch (err) {
      return { ok: false, error: (err as Error).message, sources: [] };
    }

    const displays = screen.getAllDisplays();
    const primaryId = screen.getPrimaryDisplay().id;

    /*
      A Mac always has at least one display. Zero of them is not a state
      the machine can be in, so it is the one RELIABLE signal that screen
      recording is denied — `getMediaAccessStatus` answers `granted` from
      a stale row and cannot be trusted for this.
    */
    const screens = sources.filter((source) => source.id.startsWith('screen:')).length;

    return {
      ok: true,
      deniedDespiteSettings: process.platform === 'darwin' && screens === 0,
      sources: sources.map((source) => {
        const display = source.display_id
          ? displays.find((d) => String(d.id) === source.display_id)
          : undefined;
        return {
          id: source.id,
          name: source.name,
          kind: source.id.startsWith('screen:') ? ('screen' as const) : ('window' as const),
          displayId: display ? display.id : null,
          /* Real pixels, not the thumbnail's. A window's are unknown
             until its stream starts, so they stay null and the renderer
             reads them off the track. */
          width: display ? Math.round(display.size.width * display.scaleFactor) : null,
          height: display ? Math.round(display.size.height * display.scaleFactor) : null,
          scaleFactor: display?.scaleFactor ?? 1,
          primary: display ? display.id === primaryId : false,
          thumbnail: source.thumbnail.isEmpty() ? null : source.thumbnail.toDataURL(),
          icon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
        };
      }),
    };
  });

  /*
    macOS gates all three of these behind TCC, and the failure mode is
    silent: a denied screen capture yields a black stream rather than an
    error, and a denied camera yields a stream with no frames. Asking up
    front is the difference between "nothing recorded" and a sentence
    telling the user which switch to turn on.
  */
  ipcMain.handle('recorder:permissions', () => {
    const input = probeInputCapture();
    if (process.platform !== 'darwin') {
      return {
        platform: process.platform,
        screen: 'granted' as const,
        camera: 'granted' as const,
        microphone: 'granted' as const,
        barHiddenFromCapture: barIsHiddenFromCapture(),
        input,
      };
    }
    return {
      platform: 'darwin' as const,
      screen: systemPreferences.getMediaAccessStatus('screen'),
      camera: systemPreferences.getMediaAccessStatus('camera'),
      microphone: systemPreferences.getMediaAccessStatus('microphone'),
      barHiddenFromCapture: true,
      input,
    };
  });

  /*
    ── The permission that says it is granted and is not ─────────────

    TeminaliCut's macOS builds are AD-HOC SIGNED with no Team ID, and TCC binds
    a screen-recording grant to the binary's cdhash. Every rebuild is a
    different cdhash. So after an update the switch in System Settings is
    still on, `getMediaAccessStatus('screen')` still answers `granted`,
    and `desktopCapturer` returns ZERO displays — macOS never re-asks,
    because a row for the bundle id already exists.

    Seen for real: permission visibly enabled in Screen and System Audio
    Recording, `Displays (0)` in the studio, and a take that wrote a
    zero-byte file. Every user who updates will meet it.

    `tccutil reset` deletes TeminaliCut's own row so macOS asks again on the
    next launch. It is scoped to this bundle and this one service, and
    the worst it can do is make somebody tick a box they had already
    ticked. It will keep being needed on every update until these builds
    carry a Developer ID, at which point the requirement is the team
    identifier rather than a hash and survives.
  */
  ipcMain.handle('recorder:resetScreenPermission', async () => {
    if (process.platform !== 'darwin') {
      return { ok: false, message: 'Only macOS keeps a grant that can go stale like this.' };
    }
    const services = ['ScreenCapture', 'Camera', 'Microphone', 'Accessibility', 'ListenEvent'];
    const bundleIds = ['com.teminalicut.editor', 'com.kerf.editor'];
    await Promise.all(
      bundleIds.flatMap((bId) =>
        services.map(
          (s) =>
            new Promise<void>((resolve) => {
              execFile('tccutil', ['reset', s, bId], { timeout: 10_000 }, () => resolve());
            })
        )
      )
    );
    return {
      ok: true,
      message: 'Cleared all permissions for TeminaliCut. Permissions will refresh upon restart.',
    };
  });

  /** Quit and come back, so a fresh permission is asked for on launch. */
  ipcMain.handle('recorder:relaunch', () => {
    app.relaunch();
    app.exit(0);
    return true;
  });

  ipcMain.handle('recorder:requestPermission', async (_e, p: {
    kind: 'camera' | 'microphone' | 'screen' | 'accessibility';
  }) => {
    if (process.platform !== 'darwin') return { granted: true, opened: false };

    /*
      Accessibility is what lets the input hook see clicks in other
      applications. `isTrustedAccessibilityClient(true)` asks macOS to
      show its own prompt, which is the only way the app appears in that
      list at all; the pane is opened as well, because the prompt is a
      one-time thing and the switch is where the actual grant happens.
    */
    if (p.kind === 'accessibility') {
      systemPreferences.isTrustedAccessibilityClient(true);
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
      );
      return { granted: false, opened: true };
    }

    /*
      There is no ask-for-screen-capture API. The only honest button is
      one that opens the exact pane the switch lives in, and macOS makes
      the user restart the app afterwards.
    */
    if (p.kind === 'screen') {
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
      );
      return { granted: false, opened: true };
    }

    const granted = await systemPreferences.askForMediaAccess(p.kind);
    return { granted, opened: false };
  });

  ipcMain.handle('recorder:begin', (_e, p: {
    streams: StreamName[];
    displayId: number | null;
    hideWindow: boolean;
  }) => {
    const id = `rec_${Date.now().toString(36)}`;
    const dir = path.join(recordingsRoot(), stamp(new Date()));

    try {
      /*
        0700, not 0755. A take carries a recording of somebody's screen
        and the sidecar logs the timing of every key they pressed; on a
        shared machine the default mode makes both readable by every
        other account on it. The mode on the DIRECTORY is what stops the
        listing that finds them, which matters more than the mode on any
        one file inside.
      */
      makePrivateDir(dir);
    } catch (err) {
      return { ok: false as const, error: `Could not create ${dir}: ${(err as Error).message}` };
    }

    const display = p.displayId === null
      ? null
      : screen.getAllDisplays().find((d) => d.id === p.displayId) ?? null;

    const session: Session = {
      id,
      dir,
      startedAtMs: Date.now(),
      streams: new Map(),
      cursor: [],
      bounds: display ? display.bounds : null,
      scaleFactor: display?.scaleFactor ?? 1,
      sampler: null,
      paused: false,
      pausedTotalMs: 0,
      pausedAtMs: 0,
      marks: [],
      events: [],
      input: null,
      hidWindow: false,
    };

    for (const name of p.streams) {
      const filePath = path.join(dir, `${name}.webm`);
      session.streams.set(name, {
        name,
        filePath,
        handle: fs.createWriteStream(filePath),
        bytes: 0,
        closed: false,
      });
    }

    sessions.set(id, session);
    startSampling(session);

    /*
      The input hook shares the recording's clock and the display's
      bounds with the cursor sampler, deliberately: a click and the
      cursor position it is merged with have to be on the same timeline
      and in the same coordinate space, or the zoom lands next to the
      thing it was aimed at.

      Never started for a window capture. Without display bounds a click
      cannot be located in the frame at all, and a hook that reads every
      keystroke on the machine for no benefit is not a trade to make
      quietly.
    */
    session.input = session.bounds
      ? startInputCapture(
        () => elapsedMs(session),
        () => session.bounds,
        (event) => { if (!session.paused) session.events.push(event); }
      )
      : null;

    const shortcuts = registerShortcuts(id);

    if (p.hideWindow) {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) { win.hide(); session.hidWindow = true; }
    }
    openBar(session.bounds);

    return {
      ok: true as const,
      sessionId: id,
      dir,
      cursorTracked: session.bounds !== null,
      shortcuts,
      barHiddenFromCapture: barIsHiddenFromCapture(),
      input: session.input?.status ?? {
        ok: false,
        source: 'cursor-only' as const,
        reason: 'failed' as const,
        message: 'A single window was captured, so there is no frame to place a click in.',
      },
    };
  });

  ipcMain.handle('recorder:chunk', (_e, p: { sessionId: string; stream: StreamName; bytes: Uint8Array }) => {
    const session = sessions.get(p.sessionId);
    if (!session) return { ok: false, error: 'That recording session is not open.' };
    const out = session.streams.get(p.stream);
    if (!out || out.closed) return { ok: false, error: `No open "${p.stream}" file.` };

    out.handle.write(Buffer.from(p.bytes));
    out.bytes += p.bytes.byteLength;
    return { ok: true, bytes: out.bytes };
  });

  ipcMain.handle('recorder:pause', (_e, p: { sessionId: string; paused: boolean }) => {
    const session = sessions.get(p.sessionId);
    if (!session) return { ok: false };
    if (p.paused && !session.paused) {
      session.paused = true;
      session.pausedAtMs = Date.now();
    } else if (!p.paused && session.paused) {
      session.pausedTotalMs += Date.now() - session.pausedAtMs;
      session.paused = false;
    }
    return { ok: true, elapsedMs: elapsedMs(session) };
  });

  /** What the floating bar shows. Pushed from the renderer that records. */
  ipcMain.handle('recorder:publishState', (_e, state: Record<string, unknown>) => {
    if (barWindow && !barWindow.isDestroyed()) barWindow.webContents.send('recorder:state', state);
    return true;
  });

  /** The bar has no recorder of its own; every button is a message. */
  ipcMain.handle('recorder:barCommand', (_e, p: { action: string }) => {
    /*
      Marks are recorded HERE rather than forwarded, so that both ways of
      making one — this button and the global shortcut — write to the
      same list with the same clock. The renderer has its own idea of
      elapsed time and it is a few milliseconds off this one; two marking
      paths disagreeing about when "now" was is exactly the kind of split
      that shows up later as a zoom landing on the wrong frame.
    */
    if (p.action === 'mark') {
      for (const session of sessions.values()) session.marks.push(elapsedMs(session));
    }
    getMainWindow()?.webContents.send('recorder:command', { action: p.action, source: 'bar' });
    return true;
  });

  ipcMain.handle('recorder:finish', async (_e, p: { sessionId: string; copyable: boolean }) => {
    const session = sessions.get(p.sessionId);
    if (!session) return { ok: false as const, error: 'That recording session is not open.' };

    const durationMs = elapsedMs(session);
    teardown(session);
    await closeStreams(session);

    const files: Record<string, { path: string; url: string; bytes: number; raw: boolean; error?: string }> = {};
    for (const out of session.streams.values()) {
      if (out.bytes === 0) {
        files[out.name] = {
          path: out.filePath,
          url: '',
          bytes: 0,
          raw: true,
          error: 'Nothing was written for this source.',
        };
        continue;
      }
      const result = await toMp4(out.filePath, p.copyable);
      files[out.name] = {
        path: result.path,
        url: fileUrl(result.path),
        bytes: fs.existsSync(result.path) ? fs.statSync(result.path).size : out.bytes,
        raw: result.raw,
        ...(result.error ? { error: result.error } : {}),
      };
      /* The .webm is redundant once the .mp4 exists, and it is the same
         size again on disk. Only remove it when the conversion actually
         produced something. */
      if (!result.raw && result.path !== out.filePath) {
        try { fs.unlinkSync(out.filePath); } catch { /* keep going */ }
      }
    }

    /*
      The sidecar is SEALED, and it is the one part of a take that is.

      It is not the video that is sensitive here. It is this: every
      cursor position at 30Hz and the timing of every keystroke of the
      session, which together are a recording of how somebody works, in
      a file that would otherwise be plain JSON in a folder that gets
      copied, backed up and shared. The video is the thing they meant to
      make; this is exhaust.

      The video is deliberately left alone — see `vault.ts` on why
      encrypting it would put the plaintext back on the same disk at
      every export and buy nothing.
    */
    const cursorPath = path.join(session.dir, 'cursor.json');
    try {
      writeSealed(cursorPath, 'take-sidecar', JSON.stringify({
        durationMs,
        scaleFactor: session.scaleFactor,
        marks: session.marks,
        events: session.events,
        samples: session.cursor,
      }));
    } catch {
      /* The samples are returned below regardless; the file is a record. */
    }

    sessions.delete(session.id);

    return {
      ok: true as const,
      dir: session.dir,
      durationMs,
      files,
      cursor: session.cursor,
      events: session.events,
      marks: session.marks,
      cursorTracked: session.bounds !== null,
      scaleFactor: session.scaleFactor,
    };
  });

  ipcMain.handle('recorder:cancel', async (_e, p: { sessionId: string; discard: boolean }) => {
    const session = sessions.get(p.sessionId);
    if (!session) return { ok: false };

    teardown(session);
    await closeStreams(session);
    sessions.delete(session.id);

    if (p.discard) {
      try { fs.rmSync(session.dir, { recursive: true, force: true }); } catch { /* leave it */ }
    }
    return { ok: true, dir: session.dir, discarded: p.discard };
  });

  /*
    Generated audio, written INTO the take rather than into a temp
    directory.

    `media:writeTemp` exists and would work, and it puts the file under
    os.tmpdir() — where it survives until the next reboot. That is fine
    for a sound effect somebody auditioned; it is not fine for the click
    track of a recording they may open again next month, because the
    project would come back with every sound relinked. A take is a
    folder, and everything the take needs belongs in it.

    The contract is the same one `project:write` already has, and
    deliberately not a stricter one: the directory must ALREADY EXIST,
    and the name is reduced to a safe basename so nothing can climb out
    of it. Refusing to create directories is what stops a write
    inventing a path somewhere nobody looks.

    An earlier version confined this to the recordings folder, which
    sounded careful and was not: it bought no safety `project:write` did
    not already give away, and it broke the MCP tool the moment it was
    pointed at a take that had been moved or copied somewhere else.
  */
  ipcMain.handle('recorder:writeTakeAsset', async (_e, p: {
    dir: string; name: string; bytes: Uint8Array;
  }) => {
    const target = path.resolve(p.dir);
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      return { ok: false, error: `No such directory: ${target}` };
    }

    const safe = path.basename(p.name).replace(/[^\w.\-]+/g, '_') || 'asset.wav';
    const filePath = path.join(target, safe);
    try {
      fs.writeFileSync(filePath, Buffer.from(p.bytes));
      return { ok: true, path: filePath, url: fileUrl(filePath), bytes: p.bytes.byteLength };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  /*
    A take's sidecar, opened.

    Sealed files cannot be read through `project:read`, which returns
    text and knows nothing about envelopes. A PLAIN cursor.json still
    opens here, and that is not an oversight: a take assembled by hand,
    copied from an older version, or built by a test has to keep
    working, and `readMaybeSealed` says which it met.
  */
  ipcMain.handle('recorder:readManifest', async (_e, p: { dir: string }) => {
    const file = path.join(path.resolve(p.dir), 'cursor.json');
    if (!fs.existsSync(file)) return { ok: false, error: 'No cursor.json in that folder.' };

    const opened = readMaybeSealed(file, 'take-sidecar');
    if (!opened.ok) return { ok: false, error: opened.message, reason: opened.reason };
    try {
      return { ok: true, manifest: JSON.parse(opened.plaintext) };
    } catch (err) {
      return { ok: false, error: `cursor.json is not valid JSON: ${(err as Error).message}` };
    }
  });

  ipcMain.handle('recorder:reveal', async (_e, p: { path: string }) => {
    if (!p?.path) return false;
    shell.showItemInFolder(p.path);
    return true;
  });
}

/**
 * A `file://` URL the renderer can hand to a `<video>` element.
 *
 * `encodeURI` rather than raw concatenation: "TeminaliCut Recordings" has a
 * space in it, and an unencoded space in a URL is where a media element
 * stops loading with no error at all.
 */
function fileUrl(absolute: string): string {
  const normalised = absolute.replace(/\\/g, '/');
  return `file://${encodeURI(normalised.startsWith('/') ? normalised : `/${normalised}`)}`;
}

/** Recording holds a global shortcut and an always-on-top window. Neither may outlive a quit. */
export function shutdownScreenRecorder(): void {
  releaseShortcuts();
  shutdownInputCapture();
  closeBar();
  for (const session of sessions.values()) {
    if (session.sampler) clearInterval(session.sampler);
    for (const out of session.streams.values()) {
      if (!out.closed) { out.closed = true; out.handle.end(); }
    }
  }
  sessions.clear();
}
