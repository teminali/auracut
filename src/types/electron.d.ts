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

export interface ClaudeStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
  running: boolean;
}

/** One line of Claude Code's stream-json output. */
export interface ClaudeEvent {
  type: string;
  [key: string]: unknown;
}

export interface AuraCutElectronAPI {
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
    electronAPI?: AuraCutElectronAPI;
  }
}

export {};
