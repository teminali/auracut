/* ═══════════════════════════════════════════════════════════════════
   "There is a newer Kerf", in the card the rail already had.

   Deliberately the same shape as the unsaved-work card above it: same
   surface, same icon-title-body, same full-width button underneath.
   That card is the rail's established way of saying "something happened
   while you were away, and here is the one thing to do about it", and
   an update is exactly that. A second visual language for the same kind
   of message would only make both of them read as decoration.

   It renders NOTHING unless there is an update, so the rail is empty in
   the ordinary case. The permanent affordance is the version row under
   it, which is where checking and rolling back live.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useUpdater } from '../../hooks/useUpdater';
import { Download, RefreshCw, ExternalLink, X } from '../ui/icons';

export const UpdateBanner: React.FC = () => {
  const { status, sideload, relaunch, openReleases } = useUpdater();
  const [busy, setBusy] = React.useState(false);
  const [ready, setReady] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);
  const [dismissed, setDismissed] = React.useState<string | null>(null);

  const install = React.useCallback(async () => {
    setBusy(true);
    setFailed(null);
    const result = await sideload();
    setBusy(false);
    if (result.ok) setReady(result.message);
    else setFailed(result.message);
  }, [sideload]);

  /*
    Shown ahead of everything else because it outlives the status that
    produced it: the bundle is already swapped, and somebody mid-edit
    should still find the restart when they are done.
  */
  if (ready) {
    return (
      <Card
        tone="accent"
        icon={RefreshCw}
        title="Update installed"
        body={ready}
        actionLabel="Restart Kerf"
        onAction={relaunch}
      />
    );
  }

  const pending = status.state === 'available' || status.state === 'manual-only';
  if (!pending) return null;

  const version = status.state === 'available' || status.state === 'manual-only'
    ? status.version : '';
  if (dismissed === version) return null;

  const canSideload = status.state === 'manual-only' ? status.canSideload : true;

  return (
    <Card
      tone="accent"
      icon={Download}
      title={`Kerf ${version}`}
      body={
        failed
          ?? (canSideload
            ? 'A newer version is available. Screen recording will need granting again '
              + 'afterwards, because an unsigned update always invalidates it.'
            : 'A newer version is available, and this copy is not somewhere Kerf can '
              + 'replace it. Open the download page.')
      }
      actionLabel={canSideload ? (busy ? 'Updating…' : 'Update now') : 'Open downloads'}
      onAction={canSideload ? () => void install() : openReleases}
      actionIcon={canSideload ? undefined : ExternalLink}
      busy={busy}
      onDismiss={() => setDismissed(version)}
    />
  );
};

/* ── The card, matching the one beside it ───────────────────────── */

const Card: React.FC<{
  tone: 'accent';
  icon: React.ElementType;
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
  actionIcon?: React.ElementType;
  busy?: boolean;
  onDismiss?: () => void;
}> = ({ icon: Icon, title, body, actionLabel, onAction, actionIcon: ActionIcon, busy, onDismiss }) => (
  <div className="surface-card rounded-squircle-lg p-3">
    <div className="flex items-start gap-2.5">
      <Icon className="w-4 h-4 text-spectrum-accent flex-shrink-0 mt-px" />
      <div className="min-w-0 flex-1">
        <p className="text-ui-lg font-medium text-spectrum-text leading-tight">{title}</p>
        <p className="text-ui-sm text-spectrum-textDim leading-snug mt-1">{body}</p>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="pro-btn w-5 h-5 flex-shrink-0 -mt-0.5 -mr-0.5"
          title="Not now"
          aria-label="Dismiss this update notice"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
    <button
      onClick={onAction}
      disabled={busy}
      className="pro-btn-filled w-full h-[30px] mt-3 text-ui-sm gap-1.5 disabled:opacity-60"
    >
      {ActionIcon && <ActionIcon className="w-3.5 h-3.5" />}
      {actionLabel}
    </button>
  </div>
);
