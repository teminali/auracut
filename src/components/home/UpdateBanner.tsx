/* ═══════════════════════════════════════════════════════════════════
   "There is a newer TeminaliCut", in the card the rail already had.

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
import { useBundledSkills } from '../../hooks/useBundledSkills';
import { useAccountStore } from '../../store/accountStore';
import { useUiStore } from '../../store/uiStore';
import { SUPPORTED_SKILL_TOOL_API } from '../../services/bundledSkills';
import { compareVersions } from '../../utils/version';
import { Download, RefreshCw, ExternalLink, X, Sparkle } from '../ui/icons';

export const UpdateBanner: React.FC<{
  kind: 'app' | 'skill';
  onOpenSkills?: () => void;
}> = ({ kind, onOpenSkills }) => (
  kind === 'app' ? <AppUpdateBanner /> : <SkillUpdateBanner onOpenSkills={onOpenSkills} />
);

const AppUpdateBanner: React.FC = () => {
  const { status, sideload, quitForUpdate, openReleases } = useUpdater();
  const pushToast = useUiStore((s) => s.pushToast);
  const [busy, setBusy] = React.useState(false);
  const [ready, setReady] = React.useState<string | null>(null);

  const install = React.useCallback(async () => {
    setBusy(true);
    const result = await sideload();
    setBusy(false);
    if (result.ok) {
      setReady(result.message);
      pushToast({
        kind: 'success',
        title: `TeminaliCut ${result.version ?? ''} installed`,
        detail: 'Quit and reopen TeminaliCut to launch the new version.',
      });
    } else {
      pushToast({
        kind: 'error',
        title: 'Update failed',
        detail: result.message,
      });
    }
  }, [sideload, pushToast]);

  if (status.state === 'ready' || ready) {
    const readyVersion = status.state === 'ready' ? status.version : '';
    return (
      <button
        onClick={quitForUpdate}
        className="rail-tile !text-spectrum-green bg-spectrum-green/10 border border-spectrum-green/30 animate-pulse mx-auto"
        title={ready ?? `TeminaliCut ${readyVersion} is installed. Click to quit and restart TeminaliCut.`}
        aria-label="Quit and restart TeminaliCut to apply update"
      >
        <RefreshCw className="w-[18px] h-[18px]" />
        <span className="text-micro leading-none font-semibold">Restart</span>
      </button>
    );
  }

  if (status.state === 'downloading') {
    return (
      <div
        className="rail-tile !text-spectrum-accent bg-spectrum-accent/10 border border-spectrum-accent/30 mx-auto cursor-default flex flex-col items-center justify-center p-1"
        title={`Downloading TeminaliCut ${status.version} (${status.percent}%)`}
      >
        <Download className="w-4 h-4 animate-bounce" />
        <span className="text-micro leading-none font-bold font-mono mt-0.5">{status.percent}%</span>
      </div>
    );
  }

  const pending = status.state === 'available' || status.state === 'manual-only';
  if (!pending) return null;

  const version = status.state === 'available' || status.state === 'manual-only'
    ? status.version : '';
  const canSideload = status.state === 'manual-only' ? status.canSideload : true;

  return (
    <button
      onClick={canSideload ? () => void install() : openReleases}
      disabled={busy}
      className="rail-tile !text-spectrum-accent bg-spectrum-accent/10 border border-spectrum-accent/30 mx-auto"
      title={`TeminaliCut ${version} is available. Click to update.`}
      aria-label={`Update to TeminaliCut ${version}`}
    >
      {busy ? (
        <RefreshCw className="w-[18px] h-[18px] animate-spin" />
      ) : (
        <Download className="w-[18px] h-[18px]" />
      )}
      <span className="text-micro leading-none font-semibold">
        {busy ? 'Updating…' : 'Update'}
      </span>
    </button>
  );
};

const SkillUpdateBanner: React.FC<{ onOpenSkills?: () => void }> = ({ onOpenSkills }) => {
  const { skills: local, loaded: localLoaded } = useBundledSkills();
  const remote = useAccountStore((s) => s.skills);

  const candidate = remote
    .filter((s) => s.included)
    .map((storeSkill) => ({ storeSkill, installed: local.find((s) => s.id === storeSkill.id) }))
    .filter((x) => x.installed && compareVersions(x.storeSkill.latestVersion, x.installed.version) > 0)
    .find((x) => true);

  if (!localLoaded || !candidate) return null;

  return (
    <button
      onClick={onOpenSkills}
      className="rail-tile !text-spectrum-accent bg-spectrum-accent/10 border border-spectrum-accent/30 mx-auto"
      title={`Newer skill available: ${candidate.storeSkill.name}. Click to view skills.`}
      aria-label="Skill update available"
    >
      <Sparkle className="w-[18px] h-[18px]" />
      <span className="text-micro leading-none font-semibold">Skills</span>
    </button>
  );
};
