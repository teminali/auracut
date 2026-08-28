/* Ambient typings for the preload bridge. Kept in sync with
   electron/preload.ts by hand — the renderer must not import from the
   Electron layer, so the shape is declared rather than shared. */

/** One published release this build could switch to. */
export interface ReleaseOption {
  version: string;
  tag: string;
  publishedAt: string;
  /** True for the version that is running right now. */
  current: boolean;
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; notes?: string }
  | { state: 'downloading'; version: string; percent: number; bytesPerSecond: number }
  | { state: 'ready'; version: string }
  | { state: 'up-to-date'; version: string }
  | { state: 'manual-only'; version: string; url: string; canSideload: boolean }
  | { state: 'error'; message: string };

/** One selectable agent CLI, as main sees it. */
export interface AgentBackendStatus {
  id: 'claude' | 'gemini' | 'codex' | 'cursor';
  label: string;
  vendor: string;
  installed: boolean;
  path: string | null;
  version: string | null;
  /** Whether the readiness probe has run. False means "not known yet". */
  checked: boolean;
  /** Installed AND usable — a CLI can be present but not signed in. */
  ready: boolean;
  reason?: string;
  fix?: string;
  installHint: string;
  /** Whether this adapter's stream format has been verified on a real run. */
  streamVerified: boolean;
  /** Supplying this env var would make it usable. */
  needsKey?: string;
  /** Whether Kerf already holds a key for it. */
  hasKey?: boolean;
}

export interface ClaudeStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
  running: boolean;
  /** The selected backend, so the header can name what is really driving. */
  label?: string;
  backendId?: string;
}

/** One line of Claude Code's stream-json output. */
export interface ClaudeEvent {
  type: string;
  [key: string]: unknown;
}

/* ── Screen recording ─────────────────────────────────────────────
   Main owns the source list, the files and the cursor track; the
   renderer owns the MediaRecorder, because only it can hold a
   MediaStream. These are the shapes that cross between them.        */

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
  /** Whether zooms can be placed on real clicks rather than inferred. */
  input: InputCaptureStatus;
}

/**
 * One cursor position.
 *
 * `x` and `y` are normalised against the captured display and are NOT
 * clamped: outside 0..1 means the pointer was on another display and is
 * not in frame at all, which the analyser has to be able to tell from
 * "parked against the left edge".
 */
export interface CursorSample {
  /** Milliseconds into the recording, with paused time already removed. */
  tMs: number;
  x: number;
  y: number;
}

/**
 * One real input event, from `electron/inputEvents.ts`.
 *
 * `x` and `y` do NOT come from the input hook: libuiohook's coordinate
 * space varies with platform and display scale, so main reads
 * `screen.getCursorScreenPoint()` at the instant of the event instead —
 * the same space the cursor track is in, and at a click the pointer IS
 * the click point.
 */
export interface InputEvent {
  /** Milliseconds into the recording, with paused time already removed. */
  tMs: number;
  kind: 'click' | 'rightclick' | 'scroll' | 'key';
  x: number;
  y: number;
}

export type InputCaptureReason = 'ready' | 'not-installed' | 'needs-accessibility' | 'failed';

export interface InputCaptureStatus {
  ok: boolean;
  source: 'events' | 'cursor-only';
  reason: InputCaptureReason;
  /** One sentence, written for the person reading the studio. */
  message: string;
}

export interface RecordedFile {
  path: string;
  /** A `file://` URL a `<video>` element can load. Empty when nothing was written. */
  url: string;
  bytes: number;
  /** True when this is still the raw MediaRecorder .webm, because ffmpeg could not convert it. */
  raw: boolean;
  error?: string;
}

/** What main hands back when a take stops. */
export interface RecordingResult {
  ok: true;
  dir: string;
  durationMs: number;
  files: Partial<Record<'screen' | 'camera', RecordedFile>>;
  cursor: CursorSample[];
  /** Real clicks, scrolls and keystrokes. Empty when the hook could not run. */
  events: InputEvent[];
  /** Moments the user marked by hand during the take, in recording ms. */
  marks: number[];
  /** False for a window capture, where cursor coordinates cannot be mapped into the frame. */
  cursorTracked: boolean;
  scaleFactor: number;
}

/**
 * How many runs of a skill on trial are left.
 *
 * `trialsAreLocal` is returned with every answer and is always true for
 * now: the ledger lives on this machine, so deleting it resets the
 * count. The UI says so rather than implying a stronger guarantee than
 * the one that exists. See `electron/skillTrials.ts`.
 */
export interface TrialStatus {
  skillId: string;
  /** What the publisher allows. 0 means the skill is not gated at all. */
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

export interface KerfElectronAPI {
  openMediaDialog: () => Promise<string[] | null>;
  saveExportDialog: (defaultName: string) => Promise<string | null>;
  platform: string;

  bridge: {
    onListTools: (cb: (id: string) => void) => void;
    onCallTool: (cb: (id: string, name: string, args: Record<string, unknown>) => void) => void;
    respond: (payload: { id: string; ok: boolean; data?: unknown; error?: string }) => void;
  };

  /**
   * Pushing a composited live stream to an RTMP ingest.
   *
   * `chunk` is one encoded blob from the renderer's MediaRecorder. It is
   * a send rather than an invoke: the capture loop must not wait on main.
   */
  stream: {
    start: (o: {
      url: string; width: number; height: number; fps: number;
      videoKbps?: number; audioKbps?: number; software?: boolean;
    }) => Promise<{ ok: boolean; error?: string }>;
    stop: () => Promise<{ ok: boolean }>;
    getState: () => Promise<StreamState>;
    recommendedBitrate: (height: number, fps: number) => Promise<number>;
    chunk: (data: Uint8Array) => void;
    onState: (cb: (s: StreamState) => void) => () => void;
  };

  captions: {
    /**
     * One plain-text turn to whichever agent CLI is configured, for
     * correcting a transcript. No tools and no project access: the
     * reply is text, and `parseCleanupReply` decides whether any of it
     * is taken.
     */
    clean: (prompt: string) => Promise<{
      ok: boolean; text?: string; backend?: string; error?: string;
    }>;
  };

  stt: {
    status: () => Promise<{
      ffmpeg: string | null;
      whisper: string | null;
      whisperCli: string | null;
      models: string[];
      ggmlModels: string[];
      /** Which one will actually run. `whisper.cpp` is the fast, Metal one. */
      backend: 'whisper.cpp' | 'python' | null;
      backendModel: string | null;
      fast: boolean;
      ready: boolean;
    }>;
    cancel: () => Promise<boolean>;
    transcribe: (opts: {
      mediaUrl: string; language?: string; model?: string; wordTimestamps?: boolean;
    }) => Promise<
      | { ok: true; language: string; text: string; segments: { startMs: number; endMs: number; text: string }[];
          words: { word: string; startMs: number; endMs: number; confidence: number }[]; model: string; elapsedMs: number;
          /** Stretches whisper heard as sound and produced no words for. See TranscribeResult. */
          nonSpeech?: { startMs: number; endMs: number; text: string }[] }
      | { ok: false; reason: string; message: string }
    >;
    analyze: (opts: { mediaUrl: string; silenceThresholdDb?: number; minSilenceMs?: number }) => Promise<any>;
    setup: (opts?: { model?: string }) => Promise<{ ok: boolean; step: string; message: string; log?: string }>;
    onProgress: (cb: (p: { percent: number; note: string }) => void) => () => void;
  };

  exporter: {
    start: (opts: {
      width: number; height: number; fps: number;
      codec: 'h264' | 'hevc' | 'prores'; outputPath: string;
      hardware?: boolean; bitrateMbps?: number;
    }) => Promise<{ sessionId?: string; error?: string }>;
    frame: (sessionId: string, jpeg: Uint8Array) => Promise<{ ok: boolean; error?: string }>;
    finish: (sessionId: string, audioClips: unknown[]) => Promise<{
      ok: boolean; outputPath?: string; frames?: number; hasAudio?: boolean;
      bytes?: number; error?: string; audioError?: string;
      /* `hasAudio: false` cannot say whether the timeline was silent or the
         mix was dropped. This can. */
      audio?: {
        requested: number;
        included: number;
        dropped: { source: string; reason: string }[];
        note?: string;
      };
    }>;
    cancel: (sessionId: string) => Promise<boolean>;
  };

  media: {
    /** Writes bytes to a temp file and returns its absolute path. */
    writeTemp: (name: string, bytes: Uint8Array) => Promise<string>;
    /**
     * Enumerate a folder, in main, because the renderer cannot: `fetch`
     * and XHR on a `file://` DIRECTORY both fail even with webSecurity
     * off (measured — "Failed to fetch" and onerror/status 0).
     *
     * Names, sizes and timestamps only. Whether a file is usable media
     * is decided by trying to decode it, not by its extension.
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

  /**
   * Screen and camera capture. See `src/engine/screenCapture.ts` for the
   * renderer half and `electron/screenRecorder.ts` for this one.
   */
  recorder: {
    sources: (thumbWidth?: number) => Promise<{
      ok: boolean;
      error?: string;
      /**
       * macOS reported zero displays, which cannot be true of a Mac.
       * The grant is stale: an ad-hoc signature changes on every update
       * and TCC binds to it, so the switch stays on and the capture is
       * refused. `resetScreenPermission` is the way out.
       */
      deniedDespiteSettings?: boolean;
      sources: RecorderSource[];
    }>;
    resetScreenPermission: () => Promise<{ ok: boolean; message: string }>;
    relaunch: () => Promise<boolean>;
    permissions: () => Promise<RecorderPermissions>;
    requestPermission: (kind: 'camera' | 'microphone' | 'screen' | 'accessibility')
      => Promise<{ granted: boolean; opened: boolean }>;
    begin: (opts: { streams: ('screen' | 'camera')[]; displayId: number | null; hideWindow: boolean })
      => Promise<
        | { ok: true; sessionId: string; dir: string; cursorTracked: boolean;
            shortcuts: string[]; barHiddenFromCapture: boolean; input: InputCaptureStatus }
        | { ok: false; error: string }
      >;
    chunk: (sessionId: string, stream: 'screen' | 'camera', bytes: Uint8Array)
      => Promise<{ ok: boolean; bytes?: number; error?: string }>;
    pause: (sessionId: string, paused: boolean) => Promise<{ ok: boolean; elapsedMs?: number }>;
    finish: (sessionId: string, copyable: boolean)
      => Promise<RecordingResult | { ok: false; error: string }>;
    cancel: (sessionId: string, discard: boolean)
      => Promise<{ ok: boolean; dir?: string; discarded?: boolean }>;
    /** Write generated bytes into a take folder, so the take stays self-contained. */
    writeTakeAsset: (dir: string, name: string, bytes: Uint8Array)
      => Promise<{ ok: boolean; path?: string; url?: string; bytes?: number; error?: string }>;
    /** A take's cursor.json, decrypted if it is sealed. */
    readManifest: (dir: string) => Promise<
      | { ok: true; manifest: Record<string, unknown> }
      | { ok: false; error: string; reason?: string }
    >;
    reveal: (path: string) => Promise<boolean>;
    publishState: (state: Record<string, unknown>) => Promise<boolean>;
    barCommand: (action: string) => Promise<boolean>;
    onCommand: (cb: (p: { action: string; source: string }) => void) => () => void;
    onState: (cb: (state: Record<string, unknown>) => void) => () => void;
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

  crash: {
    /** Record a renderer failure in the log file main owns. */
    report: (payload: { message: string; detail?: string; source?: string })
      => Promise<{ ok: boolean; logPath: string }>;
    logPath: () => Promise<string>;
  };
  /** Trial runs of a paid skill, counted in a sealed ledger main owns. */
  trials: {
    /**
     * `scope` identifies WHAT the run is for, so a run already spent on
     * that subject does not cost another. For the tutorial skill it is
     * the take: keep editing what you made, pay again for new footage.
     */
    status: (skillId: string, allowed: number, owned: boolean, scope?: string)
      => Promise<TrialStatus>;
    consume: (skillId: string, allowed: number, owned: boolean, scope?: string)
      => Promise<{ ok: boolean; status: TrialStatus }>;
    clearBought: (skillId: string) => Promise<{ ok: boolean }>;
  };

  ui: {
    setScreen: (screen: 'home' | 'editor') => Promise<boolean>;
    onGoHome: (cb: () => void) => () => void;
  };

  /** The Kerf Store session token, held at 0600 by the main process. */
  store: {
    getSession: () => Promise<{ session: { token: string; expiresAt: number } | null; baseUrl: string }>;
    setSession: (token: string, expiresAt: number) => Promise<boolean>;
    clearSession: () => Promise<boolean>;
  };

  agents: {
    list: (deep?: boolean) => Promise<{ selected: string; backends: AgentBackendStatus[] }>;
    select: (id: string) => Promise<string>;
    install: (id: string) => Promise<{ ok: boolean; message: string }>;
    setKey: (variable: string, value: string) => Promise<boolean>;
    recheck: () => Promise<boolean>;
    /** `source` is 'queried' when the CLI told us, 'suggested' otherwise. */
    models: (id: string) => Promise<{ models: string[]; source: 'queried' | 'suggested'; selected: string }>;
    setModel: (id: string, model: string) => Promise<boolean>;
    signIn: (id: string) => Promise<{ ok: boolean; message: string }>;
    onInstallProgress: (cb: (p: { id: string; line: string }) => void) => () => void;
  };

  claude: {
    status: () => Promise<ClaudeStatus>;
    send: (prompt: string, resume: boolean) => Promise<boolean>;
    stop: () => Promise<boolean>;
    reset: () => Promise<boolean>;
    onEvent: (cb: (event: ClaudeEvent) => void) => () => void;
  };
  /** Skills stored under userData and read at runtime. */
  userSkills: {
    list: () => Promise<Array<{
      manifest: {
        id: string; name: string; version: string; summary: string; toolApi?: number;
        trial?: { uses: number };
        slots: Array<{ id: string; kind: string; required?: boolean; default?: unknown; options?: string[]; description?: string }>;
        requiresTools: string[];
        recipe: Array<{ tool: string; args: Record<string, unknown> }>;
        assets: Array<{
          id?: string; file?: string; kind?: string; path?: string; role?: string; description?: string;
        }>;
        verify?: string;
        provenance?: { author?: string; builtWith?: string; builtAt?: string };
        guide?: string;
      };
      dir: string;
      assetsPresent: string[];
      assetsMissing: string[];
    }>>;
    write: (manifest: unknown, knownTools?: string[]) => Promise<
      { ok: true; dir: string; manifest: Record<string, unknown>; warnings: string[] }
      | { ok: false; problems: string[] }>;
    remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
    addAsset: (id: string, source: string, as?: string) => Promise<
      { ok: true; file: string; bytes: number } | { ok: false; error: string }>;
  };
  updater: {
    getStatus: () => Promise<UpdateStatus>;
    getCurrentVersion: () => Promise<string>;
    check: () => Promise<UpdateStatus>;
    install: () => Promise<boolean>;
    openReleases: () => Promise<void>;
    /** Update without Squirrel on an unsigned macOS build. See preload. */
    /** Replace this bundle. No version means the latest; a version rolls BACK. */
    sideload: (version?: string) => Promise<{ ok: boolean; message: string; version?: string }>;
    /** The releases this build could switch to, newest first. */
    releases: (limit?: number) => Promise<
      { ok: true; releases: ReleaseOption[] } | { ok: false; error: string }>;
    quitForUpdate: () => Promise<boolean>;
    onStatus: (cb: (status: UpdateStatus) => void) => () => void;
  };
}

declare global {
  interface Window {
    /** Absent in the browser — always guard before use. */
    electronAPI?: KerfElectronAPI;
  }
}

export {};
