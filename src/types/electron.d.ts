/* Ambient typings for the preload bridge. Kept in sync with
   electron/preload.ts by hand — the renderer must not import from the
   Electron layer, so the shape is declared rather than shared. */

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; notes?: string }
  | { state: 'downloading'; version: string; percent: number; bytesPerSecond: number }
  | { state: 'ready'; version: string }
  | { state: 'up-to-date'; version: string }
  | { state: 'manual-only'; version: string; url: string }
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

export interface KerfElectronAPI {
  openMediaDialog: () => Promise<string[] | null>;
  saveExportDialog: (defaultName: string) => Promise<string | null>;
  platform: string;

  bridge: {
    onListTools: (cb: (id: string) => void) => void;
    onCallTool: (cb: (id: string, name: string, args: Record<string, unknown>) => void) => void;
    respond: (payload: { id: string; ok: boolean; data?: unknown; error?: string }) => void;
  };

  stt: {
    status: () => Promise<{ ffmpeg: string | null; whisper: string | null; models: string[]; ready: boolean }>;
    transcribe: (opts: { mediaUrl: string; language?: string; model?: string }) => Promise<
      | { ok: true; language: string; text: string; segments: { startMs: number; endMs: number; text: string }[];
          words: { word: string; startMs: number; endMs: number; confidence: number }[]; model: string; elapsedMs: number }
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
  };

  ui: {
    setScreen: (screen: 'home' | 'editor') => Promise<boolean>;
    onGoHome: (cb: () => void) => () => void;
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
  updater: {
    getStatus: () => Promise<UpdateStatus>;
    getCurrentVersion: () => Promise<string>;
    check: () => Promise<UpdateStatus>;
    install: () => Promise<boolean>;
    openReleases: () => Promise<void>;
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
