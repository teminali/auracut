/* ═══════════════════════════════════════════════════════════════════
   The band above the main column.

   CapCut ends this bar with a row of icon controls and the account
   avatar, and the templates page ends it with "Sign in" and "Sign up".
   Kerf has one account and one agent, so it is the same row with the
   things Kerf actually has: the agent, shortcuts, and the account at
   the end.

   Three controls, not five. The gear opened the agent picker — the
   same sheet the chip beside it opens — so the bar carried two buttons
   for one destination, and the chip lost the reading "this is the
   thing you press" by having a mute twin next to it. The update
   indicator was the other twin: the rail's bottom card announces the
   same update in the same instant, and an app that tells you twice
   about one release is telling you it does not know which of its own
   surfaces is in charge. The indicator stays in the EDITOR's header,
   where the rail is not on screen.

   It no longer reserves the macOS traffic-light gutter. The rail owns
   the window's top-left corner now, so the lights sit over the rail's
   own empty draggable strip and this bar starts flush.

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
import { SignInDialog } from './SignInDialog';
import { Keyboard } from '../ui/icons';

interface Props {
  onOpenAgentPicker: () => void;
  /** The avatar is the way in to the account view. */
  onOpenAccount: () => void;
}

export const HomeTopBar: React.FC<Props> = ({ onOpenAgentPicker, onOpenAccount }) => {
  const status = useClaudeAgentStore((s) => s.status);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const authStatus = useAccountStore((s) => s.status);
  const user = useAccountStore((s) => s.user);
  const [signInOpen, setSignInOpen] = React.useState(false);

  const state: 'unknown' | 'ready' | 'absent' =
    status === null ? 'unknown' : status.installed ? 'ready' : 'absent';

  const label =
    state === 'unknown' ? 'checking…' : state === 'ready' ? (status?.label ?? 'Claude Code') : 'no agent';

  const dot =
    state === 'unknown'
      ? 'bg-spectrum-textFaint animate-pulse'
      : state === 'ready'
        ? 'bg-spectrum-green'
        : 'bg-spectrum-textFaint';

  const agentTitle =
    state === 'unknown'
      ? 'Looking for an agent CLI'
      : state === 'ready'
        ? `${label} is connected. Click for the agent and API keys`
        : 'No agent CLI found, the editor still works. Click to set one up';

  return (
    <header className="hp-topbar titlebar-drag h-12 flex-shrink-0 flex items-center px-8">
      <div className="flex-1" />

      <div className="flex items-center gap-1.5">
        <button
          onClick={onOpenAgentPicker}
          className="pro-btn h-[28px] pl-2 pr-2.5 gap-1.5 text-ui-sm rounded-full"
          title={agentTitle}
          aria-label={agentTitle}
        >
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
          {label}
        </button>

        <button
          onClick={() => setShortcutsOpen(true)}
          className="pro-btn w-[28px] h-[28px] rounded-full"
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
        >
          <Keyboard className="w-4 h-4" />
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
            className="pro-btn-filled h-[28px] px-3 ml-1 text-ui-sm rounded-full"
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
