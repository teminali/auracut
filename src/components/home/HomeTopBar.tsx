/* ═══════════════════════════════════════════════════════════════════
   The band above the main column.

   CapCut ends this bar with a row of icon controls and the account
   avatar, and the templates page ends it with "Sign in" and "Sign up".
   Kerf has one account and one agent, so it is the same row with the
   things Kerf actually has: the agent, shortcuts, settings, and the
   account at the end.

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
import { UpdateIndicator } from '../header/UpdateIndicator';
import { Keyboard, Settings, LogOut } from '../ui/icons';

interface Props {
  onOpenAgentPicker: () => void;
}

export const HomeTopBar: React.FC<Props> = ({ onOpenAgentPicker }) => {
  const status = useClaudeAgentStore((s) => s.status);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const authStatus = useAccountStore((s) => s.status);
  const user = useAccountStore((s) => s.user);
  const signOut = useAccountStore((s) => s.signOut);
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
        ? `${label} is connected, click to change`
        : 'No agent CLI found, the editor still works. Click to set one up';

  return (
    <header className="titlebar-drag h-12 flex-shrink-0 flex items-center px-8">
      <div className="flex-1" />

      <div className="flex items-center gap-1.5">
        {/*
          Here as well as in the editor's HeaderBar, and it was missing.

          `UpdateIndicator` was mounted only in `HeaderBar`, which is the
          EDITOR's header. Kerf opens on the home screen and somebody
          between projects sits here, so a build that had detected an
          update and could install it showed nothing at all: measured on
          a real 1.5.0 install that had already logged
          `{"state":"manual-only","version":"1.6.0","canSideload":true}`
          and offered the user no way to act on it anywhere on screen.
        */}
        <UpdateIndicator />

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

        <button
          onClick={onOpenAgentPicker}
          className="pro-btn w-[28px] h-[28px] rounded-full"
          title="Settings, agent and API keys"
          aria-label="Settings"
        >
          <Settings className="w-4 h-4" />
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

        {authStatus === 'signed_in' && (
          <span className="flex items-center gap-1 ml-1">
            {user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt=""
                className="w-7 h-7 rounded-full object-cover ring-1 ring-inset ring-white/12"
                title={user.email ?? 'Signed in'}
              />
            ) : (
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center text-ui-sm font-semibold
                           text-white/90 ring-1 ring-inset ring-white/12"
                style={{ background: 'linear-gradient(148deg,#efa78e,#c4603f)' }}
                title={user?.email ?? 'Signed in'}
              >
                {(user?.name ?? user?.email ?? '?').slice(0, 1).toUpperCase()}
              </span>
            )}
            <button
              onClick={() => void signOut()}
              className="pro-btn w-[28px] h-[28px] rounded-full"
              title={`Sign out of ${user?.email ?? 'this account'}`}
              aria-label="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </span>
        )}
      </div>

      {signInOpen && <SignInDialog onClose={() => setSignInOpen(false)} />}
    </header>
  );
};
