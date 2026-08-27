/* ═══════════════════════════════════════════════════════════════════
   Home's left rail.

   Shaped after CapCut's: an identity card, a labelled nav group, and a
   card pinned to the bottom. What sits in those slots is Kerf's, and
   only things that exist — there is no account, no Pro tier and no
   cloud workspace here, so the account card is the AGENT (the one
   connection Kerf actually has) and the bottom card is the unsaved
   work waiting to be recovered.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { KerfMark } from '../ui/KerfMark';
import { useClaudeAgentStore } from '../../store/claudeAgentStore';
import { useAccountStore } from '../../store/accountStore';
import { SignInDialog } from './SignInDialog';
import { Scissors, Blocks, FolderOpen, RotateCcw, X, LogOut } from '../ui/icons';

export type HomeView = 'home' | 'skills';

interface Props {
  view: HomeView;
  onView: (view: HomeView) => void;
  onOpenFile: () => void;
  recoverable: boolean;
  onRecover: () => void;
  onDiscardRecovery: () => void;
}

const NAV: { id: HomeView; label: string; icon: React.ElementType }[] = [
  { id: 'home', label: 'Home', icon: Scissors },
  { id: 'skills', label: 'Skills', icon: Blocks },
];

export const HomeSidebar: React.FC<Props> = ({
  view, onView, onOpenFile, recoverable, onRecover, onDiscardRecovery,
}) => {
  const status = useClaudeAgentStore((s) => s.status);
  const authStatus = useAccountStore((s) => s.status);
  const user = useAccountStore((s) => s.user);
  const signOut = useAccountStore((s) => s.signOut);
  const [signInOpen, setSignInOpen] = React.useState(false);

  const agentLine =
    status === null
      ? 'looking for an agent…'
      : status.installed
        ? `${status.label ?? 'Claude Code'} connected`
        : 'no agent CLI found';

  return (
    <aside className="w-[252px] flex-shrink-0 flex flex-col px-5 pb-5 min-h-0 rise-in rise-1">

      {/* ── Identity. This is CapCut's account card, and it finally has
             an account in it: skills are bought against one. Signed out
             it reads "Sign in" and does exactly that, which is the same
             affordance CapCut's has. There is still no Pro tier and no
             upsell — §7 rule 3. ── */}
      <div className="pt-1">
        <button
          onClick={() => { if (authStatus === 'signed_out') setSignInOpen(true); }}
          disabled={authStatus !== 'signed_out'}
          className="group/card flex items-center gap-2.5 w-full text-left disabled:cursor-default"
        >
          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              className="w-8 h-8 rounded-full flex-shrink-0 object-cover ring-1 ring-inset ring-white/12"
            />
          ) : (
            <span
              className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0
                         shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_2px_8px_-2px_rgba(196,96,63,0.5)]"
              style={{ background: 'linear-gradient(148deg,#efa78e,#c4603f)' }}
            >
              <KerfMark className="w-[18px] h-[18px]" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-ui-lg font-semibold text-spectrum-text tracking-[-0.012em] leading-tight truncate">
              {/* Three states, not two: `unknown` means the session file
                  has not been read yet, and a "Sign in" shown during
                  that window is a claim the app cannot support. */}
              {authStatus === 'unknown' ? 'Kerf'
                : authStatus === 'signed_in' ? (user?.name ?? user?.email ?? 'Signed in')
                : 'Sign in'}
            </span>
            <span className="block text-micro text-spectrum-textDim truncate">
              {authStatus === 'signed_in' ? (user?.email ?? agentLine) : agentLine}
            </span>
          </span>
          {authStatus === 'signed_in' && (
            <span
              onClick={(e) => { e.stopPropagation(); void signOut(); }}
              className="pro-btn w-6 h-6 flex-shrink-0 rounded-full opacity-0 group-hover/card:opacity-100
                         focus-visible:opacity-100 transition-opacity"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="w-3 h-3" />
            </span>
          )}
        </button>

        <button onClick={onOpenFile} className="pro-btn-filled w-full h-[32px] mt-4 gap-1.5 text-ui-sm">
          <FolderOpen className="w-3.5 h-3.5" /> Open project…
        </button>
      </div>

      {/* ── Nav ── */}
      {/* Sentence case, like CapCut's. `panel-title` is the editor's
          uppercase tracking, which belongs on a tool panel, not here. */}
      <p className="text-ui-sm font-medium text-spectrum-textDim mt-7 mb-2.5 px-1">Video editing</p>

      <nav className="flex flex-col gap-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              data-home={`nav-${item.id}`}
              onClick={() => onView(item.id)}
              aria-current={active ? 'page' : undefined}
              /* ONE signal for one state. This had three — an edge bar,
                 a raised gradient pill and an inset ring — which is how
                 a nav with two items ends up looking like a control
                 panel. A quiet fill plus the accent on the icon is
                 enough, and the icon is what the eye reads first anyway. */
              className={`h-[36px] px-3 rounded-squircle-md flex items-center gap-2.5 text-ui-lg
                          transition-colors duration-fast ${
                active
                  ? 'text-spectrum-text font-medium bg-white/[0.055]'
                  : 'text-spectrum-textMuted hover:bg-white/[0.035] hover:text-spectrum-text'
              }`}
            >
              <Icon
                className={`w-4 h-4 flex-shrink-0 ${active ? 'text-spectrum-accent' : ''}`}
                weight={active ? 'fill' : 'regular'}
              />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* ── Bottom card. CapCut runs advertisements here; §7 rule 3 says
             never, so it holds the one thing that is genuinely waiting
             for you — and otherwise says how saving works. ── */}
      <div>
        {recoverable ? (
          /* A notice, not a card. A tinted, bordered, shadowed box in
             the corner of a launcher competes with the primary action
             for exactly the wrong reason — it is important, but it is
             not what you came here to do. */
          <div className="px-1">
            <div className="flex items-start gap-2">
              <RotateCcw className="w-3.5 h-3.5 text-spectrum-amber flex-shrink-0 mt-px" />
              <div className="min-w-0 flex-1">
                <p className="text-ui-sm font-medium text-spectrum-text">Unsaved work</p>
                <p className="text-micro text-spectrum-textDim leading-snug mt-0.5">
                  From your last session.
                </p>
              </div>
              <button
                onClick={onDiscardRecovery}
                className="pro-btn w-5 h-5 flex-shrink-0 -mt-0.5"
                title="Discard it"
                aria-label="Discard the unsaved work"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <button onClick={onRecover} className="pro-btn-filled w-full h-[28px] mt-2.5 text-ui-sm">
              Recover
            </button>
          </div>
        ) : (
          <p className="text-micro text-spectrum-textFaint leading-snug px-1">
            Your work is saved automatically every 20 seconds.
          </p>
        )}
      </div>

      {signInOpen && <SignInDialog onClose={() => setSignInOpen(false)} />}
    </aside>
  );
};
