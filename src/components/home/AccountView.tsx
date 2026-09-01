/* ═══════════════════════════════════════════════════════════════════
   Account — who is signed in, and what that account owns.

   ── Why this is a place and not a menu ─────────────────────────────

   The account used to be an avatar and a sign-out glyph in the top
   bar. That is enough to show identity and nothing else: there was
   nowhere to read which email is signed in, which skills that account
   owns, or whether a licence has expired — and a licence that has
   quietly expired is exactly the thing somebody goes looking for when
   a skill stops working.

   So identity stays in the top bar, where it answers "am I signed in"
   at a glance, and the ACTIONS move here. The top bar's sign-out
   button is gone rather than duplicated: a destructive action one
   pixel from an avatar, with no confirmation and no context, was the
   worst place in the app for it.

   `unknown` is not `signed_out`. Before the store answers, this shows
   neither state — offering "Sign in" to somebody who is already signed
   in is worse than a moment of nothing.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useAccountStore } from '../../store/accountStore';
import { useUiStore } from '../../store/uiStore';
import { SignInDialog } from './SignInDialog';
import { UserCircle, LogOut, RefreshCw, Blocks, AlertTriangle, Check, ExternalLink } from '../ui/icons';

export const AccountView: React.FC<{ onOpenSkills: () => void }> = ({ onOpenSkills }) => {
  const status = useAccountStore((s) => s.status);
  const user = useAccountStore((s) => s.user);
  const owned = useAccountStore((s) => s.owned);
  const reachable = useAccountStore((s) => s.reachable);
  const baseUrl = useAccountStore((s) => s.baseUrl);
  const signOut = useAccountStore((s) => s.signOut);
  const refreshEntitlements = useAccountStore((s) => s.refreshEntitlements);
  const pushToast = useUiStore((s) => s.pushToast);

  const [signInOpen, setSignInOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const expired = owned.filter((o) => o.licenceState === 'expired');
  const unverified = owned.filter((o) => o.licenceState === 'unverified');

  const refresh = async () => {
    setBusy(true);
    await refreshEntitlements();
    setBusy(false);
    pushToast({ kind: 'success', title: 'Licences rechecked', detail: `${owned.length} owned` });
  };

  return (
    <div className="max-w-[720px] pb-4">
      <h1 className="text-[26px] font-semibold text-spectrum-text tracking-[-0.02em]">Account</h1>
      <p className="text-ui-lg text-spectrum-textDim mt-1">
        The account skills are bought and licensed against.
      </p>

      {/* Identity. `unknown` deliberately renders neither branch. */}
      {status === 'signed_in' && user && (
        <div className="surface-card rounded-squircle-lg mt-6 p-4 flex items-center gap-3.5">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
          ) : (
            <span
              className="w-12 h-12 rounded-full flex items-center justify-center text-ui-lg font-semibold
                         text-white/90 flex-shrink-0"
              style={{ background: 'linear-gradient(148deg,#f0a78e,#d0714d)' }}
            >
              {(user.name ?? user.email ?? '?').slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-ui-lg font-medium text-spectrum-text truncate">
              {user.name ?? user.email ?? 'Signed in'}
            </p>
            {user.name && user.email && (
              <p className="text-ui-sm text-spectrum-textDim truncate">{user.email}</p>
            )}
            <p className="text-micro text-spectrum-textFaint mt-0.5">
              Signed in with {user.provider}
              {reachable === false ? ' · the store is unreachable from here' : ''}
            </p>
          </div>
          <button
            onClick={() => void signOut()}
            className="pro-btn-filled h-[28px] px-3 gap-1.5 text-ui-sm flex-shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      )}

      {status === 'signed_out' && (
        <div className="surface-card rounded-squircle-lg mt-6 p-6 flex flex-col items-center text-center gap-2.5">
          <UserCircle className="w-9 h-9 text-spectrum-textFaint" />
          <p className="text-ui-lg font-medium text-spectrum-text">Not signed in</p>
          <p className="text-ui-sm text-spectrum-textDim max-w-[380px] leading-snug">
            TeminaliCut edits, records and exports without an account. Signing in is what licenses the
            paid skills to this machine, and what carries them to the next one.
          </p>
          <button onClick={() => setSignInOpen(true)} className="btn-primary h-8 px-4 mt-1 text-ui">
            Sign in
          </button>
        </div>
      )}

      {status === 'unknown' && (
        <div className="surface-card rounded-squircle-lg mt-6 p-6 text-center">
          <p className="text-ui-sm text-spectrum-textDim">Asking the store who is signed in…</p>
        </div>
      )}

      {/* Entitlements. Shown whenever there are any, signed in or not:
          a licence granted to this machine outlives a sign-out. */}
      {owned.length > 0 && (
        <section className="mt-7">
          <div className="flex items-center gap-2 h-[26px]">
            <Blocks className="w-3.5 h-3.5 text-spectrum-textFaint" />
            <h2 className="text-ui-sm font-semibold uppercase tracking-[0.06em] text-spectrum-textFaint">
              Owned skills
            </h2>
            <button
              onClick={() => void refresh()}
              disabled={busy}
              className="pro-btn h-[22px] px-2 gap-1.5 text-micro ml-auto disabled:opacity-55"
            >
              <RefreshCw className="w-3 h-3" />
              {busy ? 'Checking…' : 'Recheck'}
            </button>
          </div>

          <div className="surface-card rounded-squircle-lg mt-2.5 divide-y divide-line-soft">
            {owned.map((skill) => (
              <div key={`${skill.skillId}@${skill.majorVersion}`} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-ui-lg font-medium text-spectrum-text truncate">{skill.skillId}</p>
                  <p className="text-micro text-spectrum-textFaint">
                    Major version {skill.majorVersion} · {skill.source}
                  </p>
                </div>
                <LicenceChip state={skill.licenceState} />
              </div>
            ))}
          </div>

          {(expired.length > 0 || unverified.length > 0) && (
            <p className="text-micro text-spectrum-amber leading-snug mt-2">
              {expired.length > 0 && `${expired.length} licence${expired.length > 1 ? 's have' : ' has'} expired. `}
              {unverified.length > 0 && `${unverified.length} could not be verified, which usually means the store was unreachable. `}
              Rechecking needs a connection to {baseUrl}.
            </p>
          )}
        </section>
      )}

      {status === 'signed_in' && owned.length === 0 && (
        <section className="mt-7">
          <div className="surface-card rounded-squircle-lg p-5 flex items-center gap-3">
            <Blocks className="w-4 h-4 text-spectrum-textFaint flex-shrink-0" />
            <p className="text-ui-sm text-spectrum-textDim flex-1">
              This account owns no skills yet.
            </p>
            <button onClick={onOpenSkills} className="pro-btn-filled h-[26px] px-2.5 gap-1.5 text-ui-sm">
              <ExternalLink className="w-3 h-3" />
              Browse skills
            </button>
          </div>
        </section>
      )}

      {signInOpen && <SignInDialog onClose={() => setSignInOpen(false)} />}
    </div>
  );
};

const LicenceChip: React.FC<{ state: 'valid' | 'expired' | 'unverified' }> = ({ state }) => {
  if (state === 'valid') {
    return (
      <span className="flex items-center gap-1 text-micro text-spectrum-green flex-shrink-0">
        <Check className="w-3 h-3" />
        Valid
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-micro text-spectrum-amber flex-shrink-0">
      <AlertTriangle className="w-3 h-3" />
      {state === 'expired' ? 'Expired' : 'Unverified'}
    </span>
  );
};
