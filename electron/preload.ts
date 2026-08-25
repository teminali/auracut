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

export interface ClaudeStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
  running: boolean;
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

  /** The Claude Code session that powers the Copilot. */
  claude: {
    status: () => Promise<ClaudeStatus>;
    send: (prompt: string, resume: boolean) => Promise<boolean>;
    stop: () => Promise<boolean>;
    reset: () => Promise<boolean>;
    onEvent: (cb: (event: Record<string, unknown>) => void) => () => void;
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

  updater: {
    getStatus: () => ipcRenderer.invoke('updater:status'),
    getCurrentVersion: () => ipcRenderer.invoke('updater:currentVersion'),
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    openReleases: () => ipcRenderer.invoke('updater:openReleases'),
    onStatus: (cb) => {
      const handler = (_e: unknown, status: UpdateStatus) => cb(status);
      ipcRenderer.on('updater:status', handler);
      return () => ipcRenderer.removeListener('updater:status', handler);
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
