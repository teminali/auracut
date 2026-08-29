import { contextBridge, ipcRenderer } from 'electron';

/** Shape of the update state pushed from the main process. */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; notes?: string }
  | { state: 'downloading'; version: string; percent: number; bytesPerSecond: number }
  | { state: 'ready'; version: string }
  | { state: 'up-to-date'; version: string }
  | { state: 'manual-only'; version: string; url: string }
  | { state: 'error'; message: string };

/** One skill the user built, as main reads it back off disk. */
export interface UserSkillRecord {
  manifest: {
    id: string; name: string; version: string; summary: string;
    toolApi?: number;
    trial?: { uses: number };
    slots: { id: string; kind: string; required?: boolean; default?: unknown; options?: string[]; description?: string }[];
    requiresTools: string[];
    recipe: { tool: string; args: Record<string, unknown> }[];
    assets: { id?: string; file?: string; kind?: string; path?: string; role?: string; description?: string }[];
    verify?: string;
    provenance?: { author?: string; builtWith?: string; builtAt?: string };
    guide?: string;
  };
  dir: string;
  assetsPresent: string[];
  assetsMissing: string[];
}

export interface ClaudeStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
  running: boolean;
}

/** One capturable display or window, as `desktopCapturer` sees it. */
export interface RecorderSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  displayId: number | null;
  /** Real captured pixels. Null for a window, whose size is only known once its stream starts. */
  width: number | null;
  height: number | null;
  scaleFactor: number;
  primary: boolean;
  thumbnail: string | null;
  icon: string | null;
}

export type MediaAccess = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';

export interface RecorderPermissions {
  platform: string;
  screen: MediaAccess;
  camera: MediaAccess;
  microphone: MediaAccess;
  /** False on Linux, where the control bar cannot be kept out of the capture. */
  barHiddenFromCapture: boolean;
}

export interface TrialStatus {
  skillId: string;
  allowed: number;
  used: number;
  remaining: number;
  canRun: boolean;
  /* 'granted' means an earlier run already covered this subject, so it
     costs nothing. 'unlimited' was in this union and the policy never
     produced it; a value no code path can return is a branch every
     reader has to rule out by hand. */
  reason: 'owned' | 'not-gated' | 'granted' | 'trial' | 'exhausted' | 'tampered';
  message: string;
  trialsAreLocal: boolean;
}

export interface ElectronAPI {
  openMediaDialog: () => Promise<string[] | null>;
  saveExportDialog: (defaultName: string) => Promise<string | null>;
  platform: string;

  /** Serves external tool calls from the process that owns the project. */
  bridge: {
    onListTools: (cb: (id: string) => void) => void;
    onCallTool: (cb: (id: string, name: string, args: Record<string, unknown>) => void) => void;
    respond: (payload: { id: string; ok: boolean; data?: unknown; error?: string }) => void;
  };

  /** Pushing a composited live stream to an RTMP ingest. */
  stream: {
    start: (o: unknown) => Promise<{ ok: boolean; error?: string }>;
    stop: () => Promise<{ ok: boolean }>;
    getState: () => Promise<unknown>;
    recommendedBitrate: (height: number, fps: number) => Promise<number>;
    chunk: (data: Uint8Array) => void;
    onState: (cb: (s: unknown) => void) => () => void;
  };

  /**
   * One plain-text turn to the configured agent CLI, for correcting a
   * transcript. No tools and no project access: a model fixing spelling
   * does not need write access to the timeline.
   */
  captions: {
    clean: (prompt: string) => Promise<{
      ok: boolean; text?: string; backend?: string; error?: string;
    }>;
  };

  /** On-device speech-to-text (ffmpeg + Whisper, run in main). */
  stt: {
    status: () => Promise<{ ffmpeg: string | null; whisper: string | null; models: string[]; ready: boolean }>;
    transcribe: (opts: {
      mediaUrl: string; language?: string; model?: string; wordTimestamps?: boolean;
    }) => Promise<any>;
    /** Stop a transcription in flight; the caller carries on without captions. */
    cancel: () => Promise<boolean>;
    analyze: (opts: { mediaUrl: string; silenceThresholdDb?: number; minSilenceMs?: number }) => Promise<any>;
    setup: (opts?: { model?: string }) => Promise<any>;
    onProgress: (cb: (p: { percent: number; note: string }) => void) => () => void;
  };

  /** Real video export: frames to ffmpeg, audio muxed in. */
  exporter: {
    start: (opts: any) => Promise<{ sessionId?: string; error?: string }>;
    /** `frames` is how many frames the bytes carry; a batched h264 write
        carries many, a JPEG carries one. */
    frame: (sessionId: string, jpeg: Uint8Array, frames?: number) => Promise<{ ok: boolean; error?: string }>;
    finish: (sessionId: string, audioClips: any[]) => Promise<any>;
    cancel: (sessionId: string) => Promise<boolean>;
    /** One render-farm worker's picture, appended to its own chunk file. */
    chunk: (sessionId: string, index: number, bytes: Uint8Array, frames: number)
      => Promise<{ ok: boolean; error?: string }>;
    /** Render across several hidden windows at once. */
    runChunked: (spec: any) => Promise<{ ok: boolean; chunks?: number; error?: string }>;
    /** How the render will be split, decided by main. */
    plan: (opts: { totalFrames: number; fps: number; workers?: number })
      => Promise<{ workers: number; chunks: number; chunked: boolean; reason: string }>;
    onChunkProgress: (cb: (p: any) => void) => () => void;
  };

  /** Only bound in the hidden render-farm windows. */
  renderWorker: {
    onJob: (cb: (job: any) => void) => () => void;
    report: (msg: Record<string, unknown>) => void;
  };

  /** Show a finished file to the user in their own file manager. */
  shell: {
    reveal: (path: string) => Promise<boolean>;
    open: (path: string) => Promise<{ ok: boolean; error?: string }>;
    openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
  };

  /** Write generated bytes to a temp file, so ffmpeg can read them. */
  media: {
    writeTemp: (name: string, bytes: Uint8Array) => Promise<string>;
    /**
     * Enumerate a folder. The renderer cannot: `fetch`/XHR on a `file://`
     * directory both fail even with webSecurity off. Reports names, sizes
     * and timestamps only — whether a file is usable media is decided by
     * trying to decode it, not by its extension.
     */
    listFolder: (
      path: string,
      recursive?: boolean
    ) => Promise<{
      ok: boolean;
      folder?: string;
      entries?: {
        name: string; path: string; kind: 'file' | 'directory' | 'other';
        sizeBytes: number; mtimeMs: number; birthtimeMs: number;
      }[];
      unreadable?: { name: string; reason: string }[];
      error?: string;
    }>;
  };

  project: {
    read: (path: string) => Promise<{ ok: boolean; json?: string; error?: string }>;
    write: (path: string, json: string) => Promise<{ ok: boolean; bytes?: number; error?: string }>;
  };

  ffmpeg: {
    process: (opts: {
      input: string; vf?: string; af?: string; fps?: number;
      codec?: 'h264' | 'prores'; noAudio?: boolean; audioOnly?: boolean; name?: string;
    }) => Promise<{ ok: boolean; path?: string; bytes?: number; error?: string }>;
  };

  /** Renderer failures, into the log file main owns. */
  crash: {
    report: (payload: { message: string; detail?: string; source?: string })
      => Promise<{ ok: boolean; logPath: string }>;
    logPath: () => Promise<string>;
  };

  /**
   * Screen and camera capture.
   *
   * The renderer owns the MediaRecorder — only it can hold a
   * MediaStream — and main owns everything a MediaRecorder cannot
   * reach: the source list, the files on disk, the cursor track and
   * the floating control bar.
   */
  recorder: {
    sources: (thumbWidth?: number) => Promise<{
      ok: boolean; error?: string; deniedDespiteSettings?: boolean; sources: RecorderSource[];
    }>;
    /** Clear a stale macOS screen-recording grant so it is asked for again. */
    resetScreenPermission: () => Promise<{ ok: boolean; message: string }>;
    relaunch: () => Promise<boolean>;
    permissions: () => Promise<RecorderPermissions>;
    requestPermission: (kind: 'camera' | 'microphone' | 'screen' | 'accessibility')
      => Promise<{ granted: boolean; opened: boolean }>;
    begin: (opts: { streams: ('screen' | 'camera')[]; displayId: number | null; hideWindow: boolean })
      => Promise<
        | { ok: true; sessionId: string; dir: string; cursorTracked: boolean; shortcuts: string[]; barHiddenFromCapture: boolean }
        | { ok: false; error: string }
      >;
    chunk: (sessionId: string, stream: 'screen' | 'camera', bytes: Uint8Array)
      => Promise<{ ok: boolean; bytes?: number; error?: string }>;
    pause: (sessionId: string, paused: boolean) => Promise<{ ok: boolean; elapsedMs?: number }>;
    finish: (sessionId: string, copyable: boolean) => Promise<any>;
    cancel: (sessionId: string, discard: boolean) => Promise<{ ok: boolean; dir?: string; discarded?: boolean }>;
    writeTakeAsset: (dir: string, name: string, bytes: Uint8Array) => Promise<any>;
    /** A take's cursor.json, decrypted if it is sealed. */
    readManifest: (dir: string) => Promise<any>;
    reveal: (path: string) => Promise<boolean>;
    /** Push what the floating bar shows. */
    publishState: (state: Record<string, unknown>) => Promise<boolean>;
    /** The bar's buttons, on their way to the window that is recording. */
    barCommand: (action: string) => Promise<boolean>;
    onCommand: (cb: (p: { action: string; source: string }) => void) => () => void;
    onState: (cb: (state: Record<string, unknown>) => void) => () => void;
  };

  /** How many times a skill on trial has been run, held sealed in main. */
  trials: {
    status: (skillId: string, allowed: number, owned: boolean, scope?: string)
      => Promise<TrialStatus>;
    consume: (skillId: string, allowed: number, owned: boolean, scope?: string)
      => Promise<{ ok: boolean; status: TrialStatus }>;
    clearBought: (skillId: string) => Promise<{ ok: boolean }>;
  };

  /** Screen state, so the window close button can mean the right thing. */
  ui: {
    setScreen: (screen: 'home' | 'editor') => Promise<boolean>;
    onGoHome: (cb: () => void) => () => void;
  };

  /** The Kerf Store session token, held at 0600 in main rather than
      in the renderer's localStorage. */
  store: {
    getSession: () => Promise<{ session: { token: string; expiresAt: number } | null; baseUrl: string }>;
    setSession: (token: string, expiresAt: number) => Promise<boolean>;
    clearSession: () => Promise<boolean>;
  };

  /** Which CLI backend drives the Copilot, and getting one installed. */
  agents: {
    list: (deep?: boolean) => Promise<{ selected: string; backends: unknown[] }>;
    select: (id: string) => Promise<string>;
    install: (id: string) => Promise<{ ok: boolean; message: string }>;
    setKey: (variable: string, value: string) => Promise<boolean>;
    recheck: () => Promise<boolean>;
    models: (id: string) => Promise<{ models: string[]; source: string; selected: string }>;
    setModel: (id: string, model: string) => Promise<boolean>;
    signIn: (id: string) => Promise<{ ok: boolean; message: string }>;
    openAntigravity: (prompt?: string) => Promise<{ ok: boolean; message?: string }>;
    onInstallProgress: (cb: (p: { id: string; line: string }) => void) => () => void;
  };

  /** The Claude Code session that powers the Copilot. */
  claude: {
    status: () => Promise<ClaudeStatus>;
    send: (prompt: string, resume: boolean) => Promise<boolean>;
    stop: () => Promise<boolean>;
    reset: () => Promise<boolean>;
    onEvent: (cb: (event: Record<string, unknown>) => void) => () => void;
  };

  /** Skills the user built, stored under userData and read at runtime. */
  userSkills: {
    list: () => Promise<UserSkillRecord[]>;
    write: (manifest: unknown, knownTools?: string[]) => Promise<
      { ok: true; dir: string; manifest: Record<string, unknown>; warnings: string[] }
      | { ok: false; problems: string[] }>;
    remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
    addAsset: (id: string, source: string, as?: string) => Promise<
      { ok: true; file: string; bytes: number } | { ok: false; error: string }>;
  };

  updater: {
    /** Current state, for the first render before any event arrives. */
    getStatus: () => Promise<UpdateStatus>;
    getCurrentVersion: () => Promise<string>;
    /** User-initiated check. Background checks happen on their own. */
    check: () => Promise<UpdateStatus>;
    /** Quit and apply a downloaded update. No-op unless state is `ready`. */
    install: () => Promise<boolean>;
    /** Fallback for builds that cannot self-update. */
    openReleases: () => Promise<void>;
    /**
     * Do the update WITHOUT Squirrel, on an unsigned macOS build.
     *
     * Downloads the published zip, checks it against the SHA-512 in the
     * feed, swaps the bundle, and records a durable permission reset for
     * the next launch. Does not quit; the caller can save first.
     */
    sideload: (version?: string) => Promise<{ ok: boolean; message: string; version?: string }>;
    releases: (limit?: number) => Promise<
      { ok: true; releases: { version: string; tag: string; publishedAt: string; current: boolean }[] }
      | { ok: false; error: string }>;
    /** Quit after an unsigned in-place update. The user reopens normally. */
    quitForUpdate: () => Promise<boolean>;
    /** Subscribe to state changes; returns an unsubscribe function. */
    onStatus: (cb: (status: UpdateStatus) => void) => () => void;
  };
}

const api: ElectronAPI = {
  openMediaDialog: () => ipcRenderer.invoke('dialog:openMedia'),
  saveExportDialog: (defaultName: string) => ipcRenderer.invoke('dialog:saveExport', defaultName),
  platform: process.platform,

  bridge: {
    onListTools: (cb) => {
      ipcRenderer.on('bridge:list-tools', (_e, msg: { id: string }) => cb(msg.id));
    },
    onCallTool: (cb) => {
      ipcRenderer.on(
        'bridge:call-tool',
        (_e, msg: { id: string; payload: { name: string; args: Record<string, unknown> } }) =>
          cb(msg.id, msg.payload.name, msg.payload.args)
      );
    },
    respond: (payload) => ipcRenderer.send('bridge:response', payload),
  },

  captions: {
    clean: (prompt: string) => ipcRenderer.invoke('captions:clean', { prompt }),
  },

  stream: {
    start: (o: unknown) => ipcRenderer.invoke('stream:start', o),
    stop: () => ipcRenderer.invoke('stream:stop'),
    getState: () => ipcRenderer.invoke('stream:state'),
    recommendedBitrate: (height: number, fps: number) =>
      ipcRenderer.invoke('stream:bitrate', { height, fps }),
    /* `send`, not `invoke`: a chunk is fire-and-forget and an IPC round
       trip per chunk would sit inside the capture loop. */
    chunk: (data: Uint8Array) => ipcRenderer.send('stream:chunk', data),
    onState: (cb: (s: unknown) => void) => {
      const handler = (_e: unknown, s: unknown) => cb(s);
      ipcRenderer.on('stream:state', handler);
      return () => ipcRenderer.removeListener('stream:state', handler);
    },
  },

  stt: {
    status: () => ipcRenderer.invoke('stt:status'),
    transcribe: (opts) => ipcRenderer.invoke('stt:transcribe', opts),
    cancel: () => ipcRenderer.invoke('stt:cancel'),
    analyze: (opts) => ipcRenderer.invoke('audio:analyze', opts),
    setup: (opts) => ipcRenderer.invoke('stt:setup', opts ?? {}),
    onProgress: (cb) => {
      const handler = (_e: unknown, p: { percent: number; note: string }) => cb(p);
      ipcRenderer.on('stt:progress', handler);
      return () => ipcRenderer.removeListener('stt:progress', handler);
    },
  },

  exporter: {
    start: (opts) => ipcRenderer.invoke('export:start', opts),
    frame: (sessionId, jpeg, frames) => ipcRenderer.invoke('export:frame', { sessionId, jpeg, frames }),
    finish: (sessionId, audioClips) => ipcRenderer.invoke('export:finish', { sessionId, audioClips }),
    cancel: (sessionId) => ipcRenderer.invoke('export:cancel', { sessionId }),
    chunk: (sessionId, index, bytes, frames) =>
      ipcRenderer.invoke('export:chunk', { sessionId, index, bytes, frames }),
    runChunked: (spec) => ipcRenderer.invoke('export:runChunked', spec),
    plan: (opts) => ipcRenderer.invoke('export:plan', opts),
    onChunkProgress: (cb) => {
      const handler = (_e: unknown, p: unknown) => cb(p);
      ipcRenderer.on('export:chunkProgress', handler);
      return () => ipcRenderer.removeListener('export:chunkProgress', handler);
    },
  },

  renderWorker: {
    onJob: (cb) => {
      const handler = (_e: unknown, job: unknown) => cb(job);
      ipcRenderer.on('render:job', handler);
      return () => ipcRenderer.removeListener('render:job', handler);
    },
    /* `send`, not `invoke`: main is listening on the window's own
       `webContents.ipc`, and the farm wants a stream of notifications
       rather than a request it has to answer. */
    report: (msg) => ipcRenderer.send('render:chunk', msg),
  },

  shell: {
    reveal: (filePath) => ipcRenderer.invoke('shell:reveal', { path: filePath }),
    open: (filePath) => ipcRenderer.invoke('shell:open', { path: filePath }),
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', { url }),
  },

  media: {
    writeTemp: (name, bytes) => ipcRenderer.invoke('media:writeTemp', { name, bytes }),
    listFolder: (path, recursive) => ipcRenderer.invoke('media:listFolder', { path, recursive }),
  },

  project: {
    read: (filePath) => ipcRenderer.invoke('project:read', { path: filePath }),
    write: (filePath, json) => ipcRenderer.invoke('project:write', { path: filePath, json }),
  },

  ffmpeg: {
    process: (opts) => ipcRenderer.invoke('ffmpeg:process', opts),
  },

  crash: {
    report: (payload) => ipcRenderer.invoke('crash:report', payload),
    logPath: () => ipcRenderer.invoke('crash:logPath'),
  },
  recorder: {
    sources: (thumbWidth) => ipcRenderer.invoke('recorder:sources', { thumbWidth }),
    resetScreenPermission: () => ipcRenderer.invoke('recorder:resetScreenPermission'),
    relaunch: () => ipcRenderer.invoke('recorder:relaunch'),
    permissions: () => ipcRenderer.invoke('recorder:permissions'),
    requestPermission: (kind) => ipcRenderer.invoke('recorder:requestPermission', { kind }),
    begin: (opts) => ipcRenderer.invoke('recorder:begin', opts),
    chunk: (sessionId, stream, bytes) => ipcRenderer.invoke('recorder:chunk', { sessionId, stream, bytes }),
    pause: (sessionId, paused) => ipcRenderer.invoke('recorder:pause', { sessionId, paused }),
    finish: (sessionId, copyable) => ipcRenderer.invoke('recorder:finish', { sessionId, copyable }),
    cancel: (sessionId, discard) => ipcRenderer.invoke('recorder:cancel', { sessionId, discard }),
    writeTakeAsset: (dir, name, bytes) =>
      ipcRenderer.invoke('recorder:writeTakeAsset', { dir, name, bytes }),
    readManifest: (dir) => ipcRenderer.invoke('recorder:readManifest', { dir }),
    reveal: (filePath) => ipcRenderer.invoke('recorder:reveal', { path: filePath }),
    publishState: (state) => ipcRenderer.invoke('recorder:publishState', state),
    barCommand: (action) => ipcRenderer.invoke('recorder:barCommand', { action }),
    onCommand: (cb) => {
      const handler = (_e: unknown, p: { action: string; source: string }) => cb(p);
      ipcRenderer.on('recorder:command', handler);
      return () => ipcRenderer.removeListener('recorder:command', handler);
    },
    onState: (cb) => {
      const handler = (_e: unknown, state: Record<string, unknown>) => cb(state);
      ipcRenderer.on('recorder:state', handler);
      return () => ipcRenderer.removeListener('recorder:state', handler);
    },
  },

  trials: {
    status: (skillId, allowed, owned, scope) =>
      ipcRenderer.invoke('trials:status', { skillId, allowed, owned, scope }),
    consume: (skillId, allowed, owned, scope) =>
      ipcRenderer.invoke('trials:consume', { skillId, allowed, owned, scope }),
    clearBought: (skillId) => ipcRenderer.invoke('trials:clearBought', { skillId }),
  },

  ui: {
    setScreen: (screen) => ipcRenderer.invoke('ui:setScreen', { screen }),
    onGoHome: (cb) => {
      const handler = () => cb();
      ipcRenderer.on('ui:go-home', handler);
      return () => ipcRenderer.removeListener('ui:go-home', handler);
    },
  },

  store: {
    getSession: () => ipcRenderer.invoke('store:getSession'),
    setSession: (token, expiresAt) => ipcRenderer.invoke('store:setSession', { token, expiresAt }),
    clearSession: () => ipcRenderer.invoke('store:clearSession'),
  },

  agents: {
    list: (deep) => ipcRenderer.invoke('agents:list', { deep }),
    select: (id) => ipcRenderer.invoke('agents:select', { id }),
    install: (id) => ipcRenderer.invoke('agents:install', { id }),
    setKey: (variable, value) => ipcRenderer.invoke('agents:setKey', { variable, value }),
    recheck: () => ipcRenderer.invoke('agents:recheck'),
    models: (id) => ipcRenderer.invoke('agents:models', { id }),
    setModel: (id, model) => ipcRenderer.invoke('agents:setModel', { id, model }),
    signIn: (id) => ipcRenderer.invoke('agents:signIn', { id }),
    openAntigravity: (prompt) => ipcRenderer.invoke('agents:openAntigravity', { prompt }),
    onInstallProgress: (cb) => {
      const handler = (_e: unknown, p: { id: string; line: string }) => cb(p);
      ipcRenderer.on('agents:install-progress', handler);
      return () => ipcRenderer.removeListener('agents:install-progress', handler);
    },
  },

  claude: {
    status: () => ipcRenderer.invoke('claude:status'),
    send: (prompt: string, resume: boolean) => ipcRenderer.invoke('claude:send', { prompt, resume }),
    stop: () => ipcRenderer.invoke('claude:stop'),
    reset: () => ipcRenderer.invoke('claude:reset'),
    onEvent: (cb) => {
      const handler = (_e: unknown, event: Record<string, unknown>) => cb(event);
      ipcRenderer.on('claude:event', handler);
      return () => ipcRenderer.removeListener('claude:event', handler);
    },
  },

  userSkills: {
    list: () => ipcRenderer.invoke('userSkills:list'),
    write: (manifest: unknown, knownTools?: string[]) =>
      ipcRenderer.invoke('userSkills:write', manifest, knownTools),
    remove: (id: string) => ipcRenderer.invoke('userSkills:delete', { id }),
    addAsset: (id: string, source: string, as?: string) =>
      ipcRenderer.invoke('userSkills:addAsset', { id, source, as }),
  },

  updater: {
    getStatus: () => ipcRenderer.invoke('updater:status'),
    getCurrentVersion: () => ipcRenderer.invoke('updater:currentVersion'),
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    openReleases: () => ipcRenderer.invoke('updater:openReleases'),
    sideload: (version?: string) => ipcRenderer.invoke('updater:sideload', { version }),
    releases: (limit?: number) => ipcRenderer.invoke('updater:releases', { limit }),
    quitForUpdate: () => ipcRenderer.invoke('updater:quitForUpdate'),
    onStatus: (cb) => {
      const handler = (_e: unknown, status: UpdateStatus) => cb(status);
      ipcRenderer.on('updater:status', handler);
      return () => ipcRenderer.removeListener('updater:status', handler);
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
