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

export interface ElectronAPI {
  openMediaDialog: () => Promise<string[] | null>;
  saveExportDialog: (defaultName: string) => Promise<string | null>;
  platform: string;

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
