/* ═══════════════════════════════════════════════════════════════════
   Settings — the things that were already there, in one place.

   Nothing on this screen is new behaviour. Every control here was
   reachable before: the agent picker behind an icon in the top bar,
   the Whisper install behind a captions panel, the screen-recording
   permission behind a failed recording, the MCP setup behind a menu,
   the crash log behind a path in a comment. Reachable, and only if you
   already knew.

   So this is a MAP rather than a new surface. Where a control already
   has a home — the agent picker, the MCP sheet — the row opens it
   instead of reimplementing it, because two dialogues that configure
   the same thing will disagree about it within a release.

   Each row says what the current state IS before it offers to change
   it. A settings screen full of buttons and no readings is a screen
   that cannot answer the question people actually arrive with, which
   is "is this set up or not".
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { useUpdater } from '../../hooks/useUpdater';
import type { AgentBackendStatus, RecorderPermissions } from '../../types/electron';
import {
  Sparkle, Mic, Video, Server, FileText, RefreshCw, Check, AlertTriangle, ExternalLink,
} from '../ui/icons';

export const SettingsView: React.FC<{ onOpenAgentPicker: () => void }> = ({ onOpenAgentPicker }) => {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  const setMcpModalOpen = useProjectStore((s) => s.setMcpModalOpen);
  const pushToast = useUiStore((s) => s.pushToast);
  const { currentVersion, status, check, isDesktop } = useUpdater();

  const [agents, setAgents] = React.useState<{ selected: string; backends: AgentBackendStatus[] } | null>(null);
  const [stt, setStt] = React.useState<{ backend: string | null; ready: boolean; fast: boolean } | null>(null);
  const [perms, setPerms] = React.useState<RecorderPermissions | null>(null);
  const [logPath, setLogPath] = React.useState<string>('');
  const [busy, setBusy] = React.useState<string | null>(null);

  /*
    Read once on arrival, and again after anything that could change an
    answer. Not on a timer: a settings screen that repolls is a screen
    whose readings move while somebody is reading them.
  */
  const refresh = React.useCallback(() => {
    if (!api) return;
    void api.agents.list().then(setAgents).catch(() => setAgents(null));
    void api.stt.status().then((s) => setStt({ backend: s.backend, ready: s.ready, fast: s.fast }))
      .catch(() => setStt(null));
    void api.recorder.permissions().then(setPerms).catch(() => setPerms(null));
    void api.crash.logPath().then(setLogPath).catch(() => setLogPath(''));
  }, [api]);

  React.useEffect(refresh, [refresh]);

  if (!api) {
    return (
      <div className="py-16 text-center">
        <p className="text-ui-lg text-spectrum-textDim">
          Settings need the desktop app. A browser has nothing to configure.
        </p>
      </div>
    );
  }

  const selected = agents?.backends.find((b) => b.id === agents.selected);

  const installWhisper = async () => {
    setBusy('stt');
    const result = await api.stt.setup();
    setBusy(null);
    pushToast({
      kind: result.ok ? 'success' : 'error',
      title: result.ok ? 'Transcription ready' : 'Transcription setup failed',
      detail: result.message,
    });
    refresh();
  };

  const resetScreen = async () => {
    setBusy('screen');
    const result = await api.recorder.resetScreenPermission();
    setBusy(null);
    pushToast({
      kind: result.ok ? 'success' : 'error',
      title: 'Screen recording permission',
      detail: result.message,
    });
    refresh();
  };

  return (
    <div className="max-w-[720px] pb-4">
      <h1 className="text-[26px] font-semibold text-spectrum-text tracking-[-0.02em]">Settings</h1>
      <p className="text-ui-lg text-spectrum-textDim mt-1">
        How FrontierCut talks to the tools it needs, and what it is allowed to see.
      </p>

      <Group title="The Copilot" icon={Sparkle}>
        <Row
          label="Agent"
          value={
            selected
              ? `${selected.label}${selected.version ? ` ${selected.version}` : ''}`
              : agents ? 'None selected' : 'Checking…'
          }
          state={selected?.ready ? 'ok' : selected ? 'warn' : 'unknown'}
          note={selected?.ready ? undefined : selected?.reason ?? selected?.fix}
          actionLabel="Choose"
          onAction={onOpenAgentPicker}
        />
      </Group>

      <Group title="Speech" icon={Mic}>
        <Row
          label="Transcription"
          value={
            stt === null ? 'Checking…'
              : stt.ready ? `${stt.backend ?? 'Whisper'}${stt.fast ? ' · Metal' : ' · CPU'}`
                : 'Not installed'
          }
          state={stt === null ? 'unknown' : stt.ready ? 'ok' : 'warn'}
          note={
            stt && stt.ready && !stt.fast
              ? 'The Python build runs on the CPU and is roughly two orders of magnitude slower '
                + 'than whisper.cpp. Installing the fast one is worth the download.'
              : stt && !stt.ready
                ? 'Captions and silence detection need Whisper and ffmpeg.'
                : undefined
          }
          actionLabel={busy === 'stt' ? 'Installing…' : stt?.ready ? 'Reinstall' : 'Install'}
          onAction={() => void installWhisper()}
          busy={busy === 'stt'}
        />
      </Group>

      <Group title="Permissions" icon={Video}>
        <Row
          label="Screen recording"
          value={perms ? access(perms.screen) : 'Checking…'}
          state={perms ? (perms.screen === 'granted' ? 'ok' : 'warn') : 'unknown'}
          note={
            'Every unsigned update invalidates this, which is why it is here rather than only '
            + 'in the recorder. Resetting it makes the system ask again.'
          }
          actionLabel={busy === 'screen' ? 'Resetting…' : 'Reset'}
          onAction={() => void resetScreen()}
          busy={busy === 'screen'}
        />
        <Row
          label="Camera"
          value={perms ? access(perms.camera) : 'Checking…'}
          state={perms ? (perms.camera === 'granted' ? 'ok' : 'warn') : 'unknown'}
          actionLabel="Ask"
          onAction={() => void api.recorder.requestPermission('camera').then(refresh)}
        />
        <Row
          label="Microphone"
          value={perms ? access(perms.microphone) : 'Checking…'}
          state={perms ? (perms.microphone === 'granted' ? 'ok' : 'warn') : 'unknown'}
          actionLabel="Ask"
          onAction={() => void api.recorder.requestPermission('microphone').then(refresh)}
        />
        <Row
          label="Click capture"
          /* `ok` with `source: 'events'` is the real click stream;
             `cursor-only` means the OS refused it and movement is all
             there is. Reporting "granted" for the second would be a
             promise the zooms cannot keep. */
          value={
            perms === null ? 'Checking…'
              : perms.input.ok && perms.input.source === 'events' ? 'Granted'
                : 'Movement only'
          }
          state={perms === null ? 'unknown' : perms.input.source === 'events' ? 'ok' : 'warn'}
          note="Without it, cursor zooms are inferred from movement rather than placed on real clicks."
          actionLabel="Ask"
          onAction={() => void api.recorder.requestPermission('accessibility').then(refresh)}
        />
      </Group>

      <Group title="Connections" icon={Server}>
        <Row
          label="Model Context Protocol"
          value="FrontierCut’s 58 tools exposed live to Antigravity & external agents (Port 3888)"
          state="ok"
          actionLabel="Details"
          onAction={() => setMcpModalOpen(true)}
        />
      </Group>

      <Group title="This build" icon={FileText}>
        <Row
          label="Version"
          value={currentVersion || 'Unknown'}
          state={status.state === 'available' || status.state === 'manual-only' ? 'warn' : 'ok'}
          note={
            status.state === 'available' || status.state === 'manual-only'
              ? `FrontierCut ${status.version} is available.`
              : undefined
          }
          actionLabel={status.state === 'checking' ? 'Checking…' : 'Check'}
          onAction={check}
          busy={status.state === 'checking' || !isDesktop}
          actionIcon={RefreshCw}
        />
        <Row
          label="Crash and error log"
          value={logPath || 'Not written yet'}
          state="unknown"
          note="Every renderer failure, ffmpeg error and failed update is appended here."
          actionLabel="Show"
          onAction={() => { if (logPath) void api.shell?.reveal(logPath); }}
          actionIcon={ExternalLink}
        />
      </Group>
    </div>
  );
};

/** `MediaAccess` in the user's words rather than the OS's. */
function access(value: string): string {
  switch (value) {
    case 'granted': return 'Granted';
    case 'denied': return 'Denied';
    case 'restricted': return 'Restricted by policy';
    case 'not-determined': return 'Not asked yet';
    default: return value;
  }
}

const Group: React.FC<{ title: string; icon: React.ElementType; children: React.ReactNode }> =
  ({ title, icon: Icon, children }) => (
    <section className="mt-7">
      <div className="flex items-center gap-2 h-[26px]">
        <Icon className="w-3.5 h-3.5 text-spectrum-textFaint" />
        <h2 className="text-ui-sm font-semibold uppercase tracking-[0.06em] text-spectrum-textFaint">
          {title}
        </h2>
      </div>
      <div className="surface-card rounded-squircle-lg mt-2.5 divide-y divide-line-soft">
        {children}
      </div>
    </section>
  );

const Row: React.FC<{
  label: string;
  value: string;
  /** Whether the reading is good news, bad news, or neither. */
  state: 'ok' | 'warn' | 'unknown';
  note?: string;
  actionLabel: string;
  onAction: () => void;
  actionIcon?: React.ElementType;
  busy?: boolean;
}> = ({ label, value, state, note, actionLabel, onAction, actionIcon: ActionIcon, busy }) => (
  <div className="flex items-start gap-3 px-3.5 py-3">
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <span className="text-ui-lg font-medium text-spectrum-text">{label}</span>
        {state === 'ok' && <Check className="w-3 h-3 text-spectrum-green flex-shrink-0" />}
        {state === 'warn' && <AlertTriangle className="w-3 h-3 text-spectrum-amber flex-shrink-0" />}
      </div>
      <p className="text-ui-sm text-spectrum-textDim truncate mt-0.5" title={value}>{value}</p>
      {note && <p className="text-micro text-spectrum-textFaint leading-snug mt-1">{note}</p>}
    </div>
    <button
      onClick={onAction}
      disabled={busy}
      className="pro-btn-filled h-[26px] px-2.5 gap-1.5 text-ui-sm flex-shrink-0 mt-0.5 disabled:opacity-55"
    >
      {ActionIcon && <ActionIcon className="w-3 h-3" />}
      {actionLabel}
    </button>
  </div>
);
