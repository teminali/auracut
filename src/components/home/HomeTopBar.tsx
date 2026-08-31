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
import { KerfMark } from '../ui/KerfMark';
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
    <header className="hp-topbar titlebar-drag flex-shrink-0 flex items-center gap-2.5 px-[15px]">
      {/* Window-control gutter — macOS only, sized by --titlebar-inset. */}
      <div className="titlebar-gutter" />

      <span className="hp-brand-mark w-[26px] h-[26px] rounded-squircle-xs flex items-center justify-center flex-shrink-0">
        <KerfMark className="w-[15px] h-[15px]" />
      </span>
      <span className="text-ui-lg font-semibold text-spectrum-text tracking-tight flex-shrink-0">FrontierCut</span>
      <span className="w-px h-4 bg-line flex-shrink-0" />
      <span className="text-ui-lg text-spectrum-textMuted truncate">{viewLabel}</span>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <div className="hp-command-cluster">
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
            className="hp-command-main"
            title="Command palette (⌘K)"
            aria-label="Command palette"
          >
            <Command className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Commands</span>
            <span className="kbd hidden lg:inline-flex">⌘K</span>
          </button>
        </div>

        <button
          onClick={() => setShortcutsOpen(true)}
          className="pro-btn w-[28px] h-[28px]"
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
        >
          <Keyboard className="w-4 h-4" />
        </button>

        <button
          onClick={() => setMcpModalOpen(true)}
          className="pro-btn-filled h-[28px] px-2.5 gap-1.5 text-ui-sm font-mono tracking-wide"
          title="MCP server & tools"
          aria-label="MCP server and tools"
        >
          <StatusDot state="on" className="animate-pulse-ring" />
          MCP
        </button>

        <button
          onClick={() => usePackagesStore.getState().setModalOpen(true)}
          className="pro-btn-filled h-[28px] px-2.5 gap-1.5 text-ui-sm font-medium"
          title="Packages & Models Manager"
          aria-label="Packages & Models Manager"
        >
          <Package className="w-4 h-4 text-spectrum-accent" /> Packages
        </button>

        <button
          onClick={onOpenCopilot}
          className="pro-btn-filled h-[28px] px-2.5 gap-1.5 text-ui-sm font-medium"
          title="AI Copilot (⌘J)"
          aria-label="AI Copilot"
        >
          <Sparkle className="w-4 h-4" /> Copilot
        </button>

        {/* ── The account ──────────────────────────────────────────
            Three states again, and for the same reason: `unknown`
            means the 0600 session file has not been read yet, and a
            "Sign in" button shown during that window is the app
            claiming to know something it has not looked up. It shows
            nothing until it knows. */}
        {authStatus === 'signed_out' && (
          <button
            onClick={() => setSignInOpen(true)}
            className="pro-btn-filled h-[28px] px-3 ml-0.5 text-ui-sm"
          >
            Sign in
          </button>
        )}

        {/*
          Identity, and only identity. The sign-out button that used to
          sit beside this is in the Account view now: a destructive
          action one pixel from an avatar, with no confirmation and no
          context, was the worst place in the app for it. The avatar is
          the way there.
        */}
        {authStatus === 'signed_in' && (
          <button
            onClick={onOpenAccount}
            className="ml-1 rounded-full"
            title={`Account · ${user?.email ?? 'signed in'}`}
            aria-label="Open your account"
          >
            {user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt=""
                className="w-7 h-7 rounded-full object-cover ring-1 ring-inset ring-white/12"
              />
            ) : (
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center text-ui-sm font-semibold
                           text-white/90 ring-1 ring-inset ring-white/12"
                style={{ background: 'linear-gradient(148deg,#f0a78e,#d0714d)' }}
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
