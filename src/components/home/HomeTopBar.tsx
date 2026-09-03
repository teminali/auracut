/* ═══════════════════════════════════════════════════════════════════
   The band above the main column.

   It carries the identity and the four things that are reachable from
   anywhere: the command palette, the MCP server, the Copilot, and the
   account. The approved launcher puts the mark and a breadcrumb at the
   left of this bar rather than at the top of the rail, which is what
   frees the rail to be a narrow column of icon tiles.

   Every control here is the real one. `Commands` opens the actual
   palette, `MCP` opens the actual status modal, `Copilot` enters the
   editor with the drawer open — the same three destinations the
   editor's own header offers, so the two headers cannot drift into
   describing different products.

   The update indicator is deliberately NOT here. The rail announces an
   update and the version row under it is the route to acting on one;
   putting the indicator here as well would tell the user about the
   same release twice in the same instant, in two visual languages.
   `iconography.test.ts` pins that.

   The agent chip is FIRST for a reason beyond taste: `verify_home`
   identifies it as `header button`, and it has THREE states, not two.
   `status === null` means nobody has asked yet, and a "not connected"
   dot shown during that window is a claim the app cannot support
   (HANDOVER §3, got wrong three times in a row before it was written
   down).
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useClaudeAgentStore } from '../../store/claudeAgentStore';
import { useAccountStore } from '../../store/accountStore';
import { useUiStore } from '../../store/uiStore';
import { useProjectStore } from '../../store/projectStore';
import { usePackagesStore } from '../../store/packagesStore';
import { SignInDialog } from './SignInDialog';
import { TeminaliCutMark } from '../ui/TeminaliCutMark';
import { Keyboard, Command, Sparkle, Package } from '../ui/icons';
import { StatusDot } from '../ui/Primitives';

interface Props {
  onOpenAgentPicker: () => void;
  /** The avatar is the way in to the account view. */
  onOpenAccount: () => void;
  /** Enters the editor with the Copilot drawer open. */
  onOpenCopilot: () => void;
  /** Which view the rail is on, shown as the breadcrumb. */
  viewLabel: string;
}

export const HomeTopBar: React.FC<Props> = ({
  onOpenAgentPicker, onOpenAccount, onOpenCopilot, viewLabel,
}) => {
  const status = useClaudeAgentStore((s) => s.status);
  const openCommandPalette = useUiStore((s) => s.openCommandPalette);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const setMcpModalOpen = useProjectStore((s) => s.setMcpModalOpen);
  const authStatus = useAccountStore((s) => s.status);
  const user = useAccountStore((s) => s.user);
  const [signInOpen, setSignInOpen] = React.useState(false);
  const packages = usePackagesStore((s) => s.packages);
  const coreReady = Boolean(packages.ffmpeg?.installed && packages.ffprobe?.installed);

  const state: 'unknown' | 'ready' | 'absent' =
    status === null ? 'unknown' : status.installed ? 'ready' : 'absent';

  const label =
    state === 'unknown' ? 'Checking for an agent' : state === 'ready' ? (status?.label ?? 'Agent connected') : 'No agent connected';

  const agentTitle =
    state === 'unknown'
      ? 'Looking for an agent CLI'
      : state === 'ready'
        ? `${label} is connected. Click for the agent and API keys`
        : 'No agent CLI found, the editor still works. Click to set one up';

  return (
    <header className="hp-topbar titlebar-drag flex-shrink-0 flex items-center gap-2 px-[15px]">
      {/* Window-control gutter — macOS only, sized by --titlebar-inset. */}
      <div className="titlebar-gutter" />

      <span className="hp-brand-mark w-[26px] h-[var(--h-sm)] rounded-squircle-xs flex items-center justify-center flex-shrink-0">
        <TeminaliCutMark className="w-[16px] h-[7px]" />
      </span>
      <span className="text-ui-lg font-semibold text-spectrum-text tracking-tight flex-shrink-0">TeminaliCut</span>
      <span className="w-px h-4 bg-line flex-shrink-0" />
      <span className="text-ui-lg text-spectrum-textMuted truncate">{viewLabel}</span>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        {/* Spotlight Command Bar */}
        <div className="hp-command-cluster h-[28px]">
          <button
            onClick={onOpenAgentPicker}
            className="hp-command-agent"
            title={agentTitle}
            aria-label={label}
          >
            <StatusDot state={state === 'unknown' ? 'unknown' : state === 'ready' ? 'on' : 'off'} />
            <span className="sr-only">
              {state === 'unknown' ? 'checking…' : state === 'ready' ? label : 'no agent'}
            </span>
          </button>
          <button
            onClick={openCommandPalette}
            className="hp-command-main px-2 gap-2"
            title="Command palette (⌘K)"
            aria-label="Command palette"
          >
            <Command className="w-3.5 h-3.5" />
            <span className="text-ui-xs text-spectrum-textMuted hidden xl:inline">Search & Commands</span>
            <span className="kbd hidden sm:inline-flex">⌘K</span>
          </button>
        </div>

        {/* Compact Utility Capsule: MCP + Packages + Shortcuts */}
        <div className="h-[28px] rounded-squircle-xs bg-spectrum-hover border border-line p-0.5 flex items-center gap-0.5">
          <button
            onClick={() => setMcpModalOpen(true)}
            className="h-[var(--h-xs)] px-2 rounded-[3px] hover:bg-spectrum-cardHover text-ui-xs font-mono tracking-wide text-spectrum-textMuted hover:text-spectrum-text flex items-center gap-1.5 transition-colors"
            title="MCP server & tools"
            aria-label="MCP server and tools"
          >
            <StatusDot state="on" className="animate-pulse-ring" />
            MCP
          </button>

          <span className="w-px h-3 bg-spectrum-cardHover" />

          <button
            onClick={() => usePackagesStore.getState().setModalOpen(true)}
            className="h-[var(--h-xs)] px-2 rounded-[3px] hover:bg-spectrum-cardHover text-ui-xs font-medium text-spectrum-textMuted hover:text-spectrum-text flex items-center gap-1.5 transition-colors relative"
            title={coreReady ? 'Packages & Models Manager' : 'Recommended packages available. Click to install.'}
            aria-label="Packages & Models Manager"
          >
            <Package className="w-3.5 h-3.5 text-spectrum-accent" />
            <span>Packages</span>
            {!coreReady && (
              <span className="w-1.5 h-1.5 rounded-full bg-spectrum-accent animate-pulse" />
            )}
          </button>

          <span className="w-px h-3 bg-spectrum-cardHover" />

          <button
            onClick={() => setShortcutsOpen(true)}
            className="w-[22px] h-[var(--h-xs)] rounded-[3px] hover:bg-spectrum-cardHover text-spectrum-textDim hover:text-spectrum-text flex items-center justify-center transition-colors"
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
          >
            <Keyboard className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* AI Copilot Action */}
        <button
          onClick={onOpenCopilot}
          className="h-[28px] px-2 rounded-squircle-xs bg-spectrum-cardHover hover:bg-spectrum-control border border-spectrum-accent/35 text-ui-xs font-semibold text-spectrum-accent hover:text-spectrum-textBright flex items-center gap-1.5 transition-all"
          title="AI Copilot (⌘J)"
          aria-label="AI Copilot"
        >
          <Sparkle className="w-3.5 h-3.5" weight="fill" />
          <span>Copilot</span>
          <span className="kbd hidden sm:inline-flex !h-3.5 !px-1">⌘J</span>
        </button>

        {/* ── Account ── */}
        {authStatus === 'signed_out' && (
          <button
            onClick={() => setSignInOpen(true)}
            className="h-[28px] px-2 rounded-squircle-xs bg-spectrum-cardHover hover:bg-spectrum-cardHover border border-line text-ui-xs font-medium text-spectrum-text transition-colors"
          >
            Sign in
          </button>
        )}

        {authStatus === 'signed_in' && (
          <button
            onClick={onOpenAccount}
            className="ml-0.5 rounded-full ring-1 ring-line-strong hover:ring-spectrum-accent transition-all"
            title={`Account · ${user?.email ?? 'signed in'}`}
            aria-label="Open your account"
          >
            {user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt=""
                className="w-6 h-6 rounded-full object-cover"
              />
            ) : (
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center text-ui-xs font-semibold text-spectrum-textBright"
                style={{ background: 'var(--surface-3)' }}
              >
                {(user?.name ?? user?.email ?? '?').slice(0, 1).toUpperCase()}
              </span>
            )}
          </button>
        )}
      </div>

      {signInOpen && <SignInDialog onClose={() => setSignInOpen(false)} />}
    </header>
  );
};
