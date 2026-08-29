/* ═══════════════════════════════════════════════════════════════════
   Update state for the renderer.

   Safe to call in a plain browser tab: with no preload bridge the hook
   simply reports `idle` and every action is a no-op, so the same build
   runs under `vite dev` and inside Electron.
   ═══════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useState } from 'react';
import type { UpdateStatus, ReleaseOption } from '../types/electron';

export interface Updater {
  status: UpdateStatus;
  currentVersion: string;
  /** False in the browser — hide update affordances entirely. */
  isDesktop: boolean;
  check: () => void;
  install: () => void;
  openReleases: () => void;
  /**
   * Update in place on a build Squirrel refuses. Resolves once the new
   * version is on disk; it does NOT relaunch.
   */
  sideload: (version?: string) => Promise<{ ok: boolean; message: string; version?: string }>;
  /** The releases this build could switch to, newest first. */
  releases: (limit?: number) => Promise<ReleaseOption[]>;
  quitForUpdate: () => void;
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

  /*
    Sideload, then hand the restart back to the user.

    Two steps rather than one, and the split is deliberate: the update is
    already on disk once this resolves, so a user who is mid-edit can
    finish and restart in their own time. Relaunching for them is the one
    thing the whole update flow is written to avoid.
  */
  const releases = useCallback(async (limit?: number) => {
    if (!api) return [];
    const reply = await api.updater.releases(limit);
    return reply.ok ? reply.releases : [];
  }, [api]);

  const sideload = useCallback(async (version?: string) => {
    if (!api) return { ok: false, message: 'Updating in place needs the desktop app.' };
    const result = await api.updater.sideload(version);
    if (result.ok) {
      setStatus({ state: 'ready', version: result.version ?? version ?? '' });
    }
    return result;
  }, [api]);

  const quitForUpdate = useCallback(() => { void api?.updater.quitForUpdate(); }, [api]);

  return {
    status, currentVersion, isDesktop: Boolean(api),
    check, install, openReleases, sideload, releases, quitForUpdate,
  };
}
