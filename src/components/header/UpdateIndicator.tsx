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
  const { status, install, openReleases } = useUpdater();

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
          className="h-[26px] px-2 rounded-squircle-xs bg-spectrum-card border border-line flex items-center gap-2 text-ui-xs text-spectrum-textMuted"
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
          title={`Kerf ${status.version} is ready — click to restart and update`}
        >
          <RefreshCw className="w-3 h-3" />
          Restart to update
        </button>
      );

    /* An update exists, but this build cannot install it itself. */
    case 'manual-only':
      return (
        <button
          onClick={openReleases}
          className="h-[26px] px-2.5 rounded-squircle-xs border border-spectrum-accentLine bg-spectrum-accentSoft text-spectrum-accent text-ui-xs font-medium flex items-center gap-1.5"
          title={`Kerf ${status.version} is available. This build is not code-signed, so it cannot update itself — open the download page.`}
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
        >
          <AlertTriangle className="w-[15px] h-[15px]" />
        </button>
      );
  }
};
