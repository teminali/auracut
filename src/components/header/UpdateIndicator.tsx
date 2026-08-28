/* ═══════════════════════════════════════════════════════════════════
   Update affordance in the title bar.

   Deliberately quiet: it renders nothing at all while the app is up to
   date, so the chrome does not carry a permanent widget that says
   "nothing is happening". It only appears when there is something the
   user can act on — and the action is always theirs to take, because a
   video editor that relaunches itself mid-edit is a bug, not a feature.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useUpdater } from '../../hooks/useUpdater';
import { Download, RefreshCw, ExternalLink, AlertTriangle } from '../ui/icons';

export const UpdateIndicator: React.FC = () => {
  const { status, install, openReleases, sideload, quitForUpdate } = useUpdater();
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);

  const doSideload = React.useCallback(async () => {
    setBusy(true);
    setFailed(null);
    const result = await sideload();
    setBusy(false);
    if (result.ok) setDone(result.message);
    else setFailed(result.message);
  }, [sideload]);

  /*
    The update is on disk and the restart is the user's to take. Shown
    ahead of the switch because it outlives the status it came from:
    `sideloadUpdate` publishes `ready`, and a user who keeps working
    should still be able to find the button when they are done.
  */
  if (done) {
    return (
      <button
        onClick={quitForUpdate}
        className="btn-primary h-[26px] px-2.5 gap-1.5 text-ui-xs"
        title={done}
        aria-label={done}
      >
        <RefreshCw className="w-3 h-3" />
        Quit to finish
      </button>
    );
  }

  if (failed) {
    return (
      <button
        onClick={openReleases}
        className="h-[26px] px-2.5 rounded-squircle-xs border border-spectrum-amber/40 text-spectrum-amber text-ui-xs font-medium flex items-center gap-1.5"
        title={`${failed} Click to open the download page instead.`}
        aria-label={`Update failed: ${failed}`}
      >
        <AlertTriangle className="w-3 h-3" />
        Update failed
      </button>
    );
  }

  switch (status.state) {
    /* Nothing to say. Say nothing. */
    case 'idle':
    case 'checking':
    case 'up-to-date':
    case 'available':
      return null;

    case 'downloading':
      return (
        <div
          className="h-[26px] px-2 rounded-squircle-xs bg-spectrum-card flex items-center gap-2 text-ui-xs text-spectrum-textMuted"
          title={`Downloading Kerf ${status.version}`}
        >
          <Download className="w-3 h-3 flex-shrink-0" />
          <div className="w-14 h-[3px] rounded-full bg-spectrum-sunken overflow-hidden">
            <div
              className="h-full bg-spectrum-accent transition-[width] duration-300"
              style={{ width: `${status.percent}%` }}
            />
          </div>
          <span className="font-mono tabular w-7 text-right">{status.percent}%</span>
        </div>
      );

    case 'ready':
      return (
        <button
          onClick={install}
          className="btn-primary h-[26px] px-2.5 gap-1.5 text-ui-xs"
          title={`Kerf ${status.version} is ready. Click to restart and update`}
            aria-label={`Kerf ${status.version} is ready. Click to restart and update`}
        >
          <RefreshCw className="w-3 h-3" />
          Restart to update
        </button>
      );

    /*
      An update exists and Squirrel will not install it.

      Kerf can still do the swap itself — see `sideloadUpdate` in
      `electron/updater.ts` for what that verifies and, more importantly,
      what it does not. When the bundle is somewhere Kerf cannot write,
      `canSideload` is false and this falls back to the download page,
      which is what this branch always used to do.
    */
    case 'manual-only':
      return status.canSideload ? (
        <button
          onClick={() => void doSideload()}
          disabled={busy}
          className="h-[26px] px-2.5 rounded-squircle-xs border border-spectrum-accentLine bg-spectrum-accentSoft text-spectrum-accent text-ui-xs font-medium flex items-center gap-1.5 disabled:opacity-60"
          title={
            `Download Kerf ${status.version} and replace this copy. This build is not `
            + 'code-signed, so the download is checked against the checksum the release '
            + 'publishes rather than against a signature, and macOS will ask for screen '
            + 'recording again afterwards because an unsigned update always invalidates it.'
          }
          aria-label={`Update to Kerf ${status.version}`}
        >
          <Download className="w-3 h-3" />
          {busy ? 'Updating…' : `Update to ${status.version}`}
        </button>
      ) : (
        <button
          onClick={openReleases}
          className="h-[26px] px-2.5 rounded-squircle-xs border border-spectrum-accentLine bg-spectrum-accentSoft text-spectrum-accent text-ui-xs font-medium flex items-center gap-1.5"
          title={
            `Kerf ${status.version} is available, and this copy is not somewhere Kerf can `
            + 'replace it. Open the download page.'
          }
          aria-label={`Kerf ${status.version} is available. Open the download page.`}
        >
          <ExternalLink className="w-3 h-3" />
          Get {status.version}
        </button>
      );

    case 'error':
      return (
        <button
          onClick={openReleases}
          className="pro-btn w-[26px] h-[26px] !text-spectrum-amber"
          title={`Update check failed: ${status.message}. Click to open the download page.`}
            aria-label={`Update check failed: ${status.message}. Click to open the download page.`}
        >
          <AlertTriangle className="w-[15px] h-[15px]" />
        </button>
      );
  }
};
