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

export interface AuraCutElectronAPI {
  openMediaDialog: () => Promise<string[] | null>;
  saveExportDialog: (defaultName: string) => Promise<string | null>;
  platform: string;
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
