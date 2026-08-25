/* ═══════════════════════════════════════════════════════════════════
   Update state for the renderer.

   Safe to call in a plain browser tab: with no preload bridge the hook
   simply reports `idle` and every action is a no-op, so the same build
   runs under `vite dev` and inside Electron.
   ═══════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useState } from 'react';
import type { UpdateStatus } from '../types/electron';

export interface Updater {
  status: UpdateStatus;
  currentVersion: string;
  /** False in the browser — hide update affordances entirely. */
  isDesktop: boolean;
  check: () => void;
  install: () => void;
  openReleases: () => void;
}

export function useUpdater(): Updater {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;

  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [currentVersion, setCurrentVersion] = useState('');

  useEffect(() => {
    if (!api) return;
    void api.updater.getStatus().then(setStatus);
    void api.updater.getCurrentVersion().then(setCurrentVersion);
    return api.updater.onStatus(setStatus);
  }, [api]);

  const check = useCallback(() => {
    if (!api) return;
    setStatus({ state: 'checking' });
    void api.updater.check().then(setStatus);
  }, [api]);

  const install = useCallback(() => { void api?.updater.install(); }, [api]);
  const openReleases = useCallback(() => { void api?.updater.openReleases(); }, [api]);

  return { status, currentVersion, isDesktop: Boolean(api), check, install, openReleases };
}
