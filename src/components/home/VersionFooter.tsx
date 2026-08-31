/* ═══════════════════════════════════════════════════════════════════
   Which version this is, and everything you can do about it.

   ── Why the version is the button ──────────────────────────────────

   "Which build am I on" matters more in Kerf than in most apps, because
   this build is unsigned: every update invalidates screen recording and
   accessibility, so it is the first thing worth knowing when the
   recorder starts behaving oddly. Making the version itself the control
   puts checking, updating and ROLLING BACK behind the one label
   somebody is already looking at when they have that question.

   ── Rolling back is the point of the menu ──────────────────────────

   An update that turns out to be broken is only recoverable in place if
   the app can install an older build over itself, and this app already
   knows how: `sideloadUpdate` takes a version now, every release
   publishes its own `latest-mac.yml` beside its artifacts, so a
   rollback verifies the old zip against the checksum that shipped WITH
   it rather than against the current feed.

   Three previous versions, not all of them. A list of everything ever
   released is an invitation to go somewhere nobody is testing; the last
   three are the ones a regression could plausibly have arrived in.

   ── What this does NOT do ──────────────────────────────────────────

   It does not announce updates. That is `UpdateBanner`, in the card
   above, because an announcement should be something you notice without
   opening a menu. This is the deliberate route, and it is quiet.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useUpdater } from '../../hooks/useUpdater';
import { useUiStore } from '../../store/uiStore';
import type { ReleaseOption } from '../../types/electron';
import { compareVersions } from '../../utils/version';
import { RefreshCw, Check, ChevronDown, Download, RotateCcw, AlertTriangle } from '../ui/icons';

/** How long "Up to date" stays up before the row reads normally again. */
const CONFIRMATION_MS = 4000;

/** Previous versions offered. See the header. */
const ROLLBACK_CHOICES = 3;

export const VersionFooter: React.FC = () => {
  const { status, currentVersion, isDesktop, check, sideload, releases, quitForUpdate } = useUpdater();
  const pushToast = useUiStore((s) => s.pushToast);

  const [open, setOpen] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);
  const [options, setOptions] = React.useState<ReleaseOption[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ ok: boolean; message: string; version?: string } | null>(null);
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const root = React.useRef<HTMLDivElement>(null);

  /* A check that answers with silence is indistinguishable from one that
     did not run, so the up-to-date result is shown — and then expires,
     because a permanent "Up to date" is a claim about now made then. */
  React.useEffect(() => {
    if (status.state !== 'up-to-date') return undefined;
    setConfirmed(true);
    const timer = window.setTimeout(() => setConfirmed(false), CONFIRMATION_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  /* The list is fetched when the menu opens rather than on mount: it is
     a network round trip to GitHub for something most sessions never
     look at. */
  React.useEffect(() => {
    if (!open || options) return;
    void releases(ROLLBACK_CHOICES + 1).then(setOptions);
  }, [open, options, releases]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) { setOpen(false); setConfirming(null); }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setConfirming(null); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const switchTo = React.useCallback(async (version?: string) => {
    setBusy(version ?? 'latest');
    setResult(null);
    const outcome = await sideload(version);
    setBusy(null);
    setConfirming(null);
    setResult({ ok: outcome.ok, message: outcome.message, version: outcome.version ?? version });
    if (outcome.ok) {
      pushToast({
        kind: 'success',
        title: `FrontierCut ${outcome.version ?? version ?? ''} installed`,
        detail: 'Close and reopen FrontierCut when you are ready.',
      });
    } else {
      pushToast({
        kind: 'error',
        title: 'Update failed',
        detail: outcome.message,
      });
    }
  }, [sideload, pushToast]);

  if (!isDesktop) {
    return (
      <p className="text-micro text-spectrum-textFaint px-1 leading-snug">
        {currentVersion ? `Kerf ${currentVersion}` : 'Kerf'}
      </p>
    );
  }

  const updateAvailable = status.state === 'available' || status.state === 'manual-only';
  const isReady = status.state === 'ready' || result?.ok;
  const newer = updateAvailable ? status.version : null;

  /* The current build is excluded from the rollback list, and so is
     anything NEWER than it: going forward is an update, and it has its
     own action rather than being buried among the old versions. */
  const older = (options ?? [])
    .filter((r) => !r.current && compareVersions(r.version, currentVersion) < 0)
    .slice(0, ROLLBACK_CHOICES);

  return (
    <div className="px-1 relative z-30" ref={root}>
      <button
        onClick={() => setOpen((v) => !v)}
        /* The rail is 76px wide now, so this cannot spill onto two
           lines: it is centred, it does not wrap, and the word "Kerf"
           is dropped because it sits directly under a rail whose only
           subject is Kerf. */
        className="text-micro text-spectrum-textFaint hover:text-spectrum-textDim
                   transition-colors flex items-center justify-center gap-0.5 w-full whitespace-nowrap"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Kerf ${currentVersion || ''} · version, updates and rollback`}
      >
        {currentVersion || '…'}
        {(newer || isReady) && (
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              isReady ? 'bg-spectrum-green' : 'bg-spectrum-accent'
            }`}
          />
        )}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* When ready and menu is closed, show a dedicated action button so the user can easily restart */}
      {!open && isReady && (
        <div className="mt-1 px-0.5">
          <button
            onClick={quitForUpdate}
            className="pro-btn-filled w-full h-[22px] text-micro gap-1 !text-spectrum-green !border-spectrum-green/30"
            title="Update installed. Click to quit and restart Kerf."
          >
            <RefreshCw className="w-2.5 h-2.5" />
            Quit to apply
          </button>
        </div>
      )}

      {/* When downloading, show real-time download progress bar */}
      {!open && status.state === 'downloading' && (
        <div className="mt-1 w-full px-0.5">
          <div className="p-1 rounded-[3px] bg-[#1a1a1a] border border-[#3a3a3a] space-y-1">
            <div className="flex items-center justify-between text-micro font-mono text-[#f0a173] px-0.5">
              <span className="truncate">Downloading</span>
              <span className="font-bold tabular-nums">{status.percent}%</span>
            </div>
            <div className="w-full h-1 rounded-full bg-[#141414] overflow-hidden border border-[#2a2a2a]">
              <div
                className="h-full bg-[#f0a173] transition-all duration-150"
                style={{ width: `${status.percent}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* The confirmation, when a check found nothing, without opening
          anything. */}
      {!open && confirmed && !isReady && (
        <p className="text-micro text-spectrum-textDim flex items-center gap-1 mt-1">
          <Check className="w-3 h-3 text-spectrum-green flex-shrink-0" />
          Up to date
        </p>
      )}

      {!open && result && !result.ok && (
        <p className="text-micro text-spectrum-red leading-snug mt-1">{result.message}</p>
      )}

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-2 w-[248px] surface-card
                     rounded-squircle-lg p-1.5 shadow-2xl border border-line-strong z-50"
        >
          {isReady && (
            <MenuItem
              icon={RefreshCw}
              label="Quit FrontierCut to finish update"
              tone="accent"
              disabled={Boolean(busy)}
              onClick={quitForUpdate}
            />
          )}

          {!isReady && newer && (
            <MenuItem
              icon={Download}
              label={busy === 'latest' ? 'Updating…' : `Update to ${newer}`}
              tone="accent"
              disabled={Boolean(busy)}
              onClick={() => void switchTo()}
            />
          )}

          <MenuItem
            icon={RefreshCw}
            label={status.state === 'checking' ? 'Checking…' : 'Check for updates'}
            spinning={status.state === 'checking'}
            disabled={Boolean(busy) || status.state === 'checking'}
            onClick={check}
          />

          <div className="h-px bg-line my-1.5" />

          <p className="hp-rail-label px-2 pb-1">Roll back</p>

          {options === null && (
            <p className="text-micro text-spectrum-textDim px-2 py-1.5">Looking…</p>
          )}
          {options !== null && older.length === 0 && (
            <p className="text-micro text-spectrum-textDim px-2 py-1.5 leading-snug">
              No earlier release to go back to.
            </p>
          )}

          {older.map((release) => (
            <div key={release.tag}>
              <MenuItem
                icon={RotateCcw}
                label={busy === release.version ? `Installing ${release.version}…` : release.version}
                disabled={Boolean(busy)}
                onClick={() => setConfirming(
                  confirming === release.version ? null : release.version
                )}
              />
              {/*
                Confirmed in place rather than done on the first click.
                This replaces the running application with an older one
                and schedules the screen-recording grant to be refreshed on next launch, which
                is not something to do because a menu was misread.
              */}
              {confirming === release.version && (
                <div className="px-2 pb-2 pt-0.5">
                  <p className="text-micro text-spectrum-textDim leading-snug mb-1.5">
                    Replaces Kerf {currentVersion} with {release.version} and asks for screen
                    recording again. Projects saved by a newer build may not open.
                  </p>
                  <button
                    onClick={() => void switchTo(release.version)}
                    disabled={Boolean(busy)}
                    className="pro-btn-filled w-full h-[26px] text-ui-xs disabled:opacity-60"
                  >
                    Install {release.version}
                  </button>
                </div>
              )}
            </div>
          ))}

          {result && (
            <>
              <div className="h-px bg-line my-1.5" />
              <div className="px-2 py-1">
                <p className={`text-micro leading-snug ${result.ok ? 'text-spectrum-textDim' : 'text-spectrum-red'}`}>
                  {!result.ok && <AlertTriangle className="w-3 h-3 inline mr-1 -mt-px" />}
                  {result.message}
                </p>
                {result.ok && (
                  <button
                    onClick={quitForUpdate}
                    className="pro-btn-filled w-full h-[26px] mt-2 text-ui-xs"
                  >
                    Quit Kerf
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

/* ── Pieces ─────────────────────────────────────────────────────── */

const MenuItem: React.FC<{
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  spinning?: boolean;
  tone?: 'accent';
}> = ({ icon: Icon, label, onClick, disabled, spinning, tone }) => (
  <button
    role="menuitem"
    onClick={onClick}
    disabled={disabled}
    className={`w-full h-7 px-2 rounded-squircle-xs flex items-center gap-2 text-ui-sm
                text-left transition-colors disabled:opacity-50
                ${tone === 'accent' ? 'text-spectrum-accent' : 'text-spectrum-text'}
                hover:bg-spectrum-hover`}
  >
    <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${spinning ? 'animate-spin' : ''}`} />
    <span className="truncate">{label}</span>
  </button>
);
