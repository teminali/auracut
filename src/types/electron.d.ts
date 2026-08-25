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
    onProgress: (cb: (p: { percent: number; note: string }) => void) => () => void;
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
