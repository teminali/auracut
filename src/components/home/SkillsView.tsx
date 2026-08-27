/* ═══════════════════════════════════════════════════════════════════
   The skills store.

   This used to be a panel that said "not built yet", and it said so
   because an empty store dressed as a full one is the theatre this
   codebase keeps deleting. It is a real store now: the catalogue comes
   from the server, ownership comes from a signed entitlement this
   machine verified itself, and a price is a price somebody can pay.

   Two things it still refuses to pretend about:

     · a skill's "verified" badge is the record of a verification RUN
       that passed against a fresh project (§6). A skill with no
       `verifiedAt` cannot be published, so the badge is a fact rather
       than a marketing claim.
     · `licenceState` is shown when it is not `valid`. A licence that
       did not verify is not quietly treated as ownership — most often
       it means the build is carrying a signing key the server does not
       have, and hiding that would strand a paying customer.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useAccountStore } from '../../store/accountStore';
import { useUiStore } from '../../store/uiStore';
import { formatPrice, type StoreSkill } from '../../services/storeClient';
import { SignInDialog } from './SignInDialog';
import { BuySheet } from './BuySheet';
import {
  Blocks, BadgeCheck, Check, Loader2, WifiOff, ShieldAlert, Download,
} from '../ui/icons';

export const SkillsView: React.FC = () => {
  const status = useAccountStore((s) => s.status);
  const skills = useAccountStore((s) => s.skills);
  const loaded = useAccountStore((s) => s.catalogueLoaded);
  const reachable = useAccountStore((s) => s.reachable);
  const owned = useAccountStore((s) => s.owned);
  const claimFree = useAccountStore((s) => s.claimFree);
  const pushToast = useUiStore((s) => s.pushToast);

  const [signInOpen, setSignInOpen] = React.useState(false);
  const [buying, setBuying] = React.useState<StoreSkill | null>(null);
  const [claiming, setClaiming] = React.useState<string | null>(null);

  const ownedFor = (s: StoreSkill) =>
    owned.find((o) => o.skillId === s.id && o.majorVersion === s.majorVersion);

  const act = async (skill: StoreSkill) => {
    if (status !== 'signed_in') { setSignInOpen(true); return; }
    if (skill.free) {
      setClaiming(skill.id);
      const r = await claimFree(skill.id);
      setClaiming(null);
      pushToast({ kind: r.ok ? 'success' : 'error', title: r.message });
      return;
    }
    setBuying(skill);
  };

  return (
    <section className="max-w-[860px]">
      <div className="flex items-center gap-3">
        <h2 className="text-display font-semibold text-spectrum-text flex-1">Skills</h2>

        {status === 'unknown' && (
          <span className="flex items-center gap-1.5 text-ui-sm text-spectrum-textDim">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> checking…
          </span>
        )}
        {status === 'signed_out' && (
          <button onClick={() => setSignInOpen(true)} className="pro-btn-filled h-7 px-3 text-ui-sm">
            Sign in
          </button>
        )}
      </div>

      <p className="text-ui-lg text-spectrum-textMuted leading-relaxed mt-2 max-w-[620px]">
        A skill is a template project, the assets it needs, the tools that fill it in, and a
        verification test that has to pass before it can be sold. Buy it once for a major
        version; new projects are cloned from it and stay yours to edit by hand.
      </p>

      {reachable === false && (
        <div className="flex items-start gap-2.5 rounded-squircle-md bg-spectrum-panel p-3 mt-4">
          <WifiOff className="w-4 h-4 text-spectrum-textDim flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-ui-lg text-spectrum-text">The store is not reachable.</p>
            <p className="text-ui-sm text-spectrum-textDim leading-snug mt-0.5">
              Skills you already own keep working. Their licences are checked on this machine,
              not on the network.
            </p>
          </div>
        </div>
      )}

      {!loaded ? (
        <div className="flex items-center gap-2 py-16 justify-center text-spectrum-textDim">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-ui-lg">Loading the catalogue…</span>
        </div>
      ) : skills.length === 0 ? (
        <div className="rounded-squircle-lg bg-spectrum-panel p-5 mt-4">
          <div className="flex items-center gap-2">
            <Blocks className="w-4 h-4 text-spectrum-textDim" />
            <p className="text-ui-lg text-spectrum-text font-medium">Nothing published yet.</p>
          </div>
          <p className="text-ui-lg text-spectrum-textDim leading-relaxed mt-2">
            The store is running and the catalogue is empty, which is the honest state of it.
            A skill appears here once it has a verification run that passed.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 mt-5">
          {skills.map((skill) => {
            const mine = ownedFor(skill);
            const isOwned = Boolean(mine);
            return (
              <div
                key={skill.id}
                className="rounded-squircle-lg bg-spectrum-panel p-4 flex flex-col"
              >
                <div className="flex items-start gap-2">
                  <h3 className="text-ui-xl font-semibold text-spectrum-text flex-1 min-w-0">
                    {skill.name}
                  </h3>
                  {skill.verifiedAt && (
                    <span
                      className="flex items-center gap-1 h-[18px] px-1.5 rounded-full
                                 bg-spectrum-green/12 text-spectrum-green text-micro font-medium flex-shrink-0"
                      title={`Verified against a fresh project, ${skill.verifiedBuild ?? 'build not recorded'}`}
                    >
                      <BadgeCheck className="w-3 h-3" /> verified
                    </span>
                  )}
                </div>

                <p className="text-ui-sm text-spectrum-textMuted leading-snug mt-1.5 flex-1">
                  {skill.summary}
                </p>

                <p className="text-micro text-spectrum-textFaint mt-2">
                  {skill.author} · v{skill.latestVersion} · tool API {skill.toolApi}
                </p>

                {mine && mine.licenceState !== 'valid' && (
                  <div className="flex items-start gap-1.5 mt-2 text-spectrum-amber">
                    <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                    <span className="text-micro leading-snug">
                      {mine.licenceState === 'expired'
                        ? 'Licence needs refreshing, connect once to renew it.'
                        : 'This licence did not verify on this machine.'}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-line">
                  <span className="text-ui-lg font-semibold text-spectrum-text tabular">
                    {isOwned ? 'Owned' : formatPrice(skill.price.amount, skill.price.currency)}
                  </span>

                  {isOwned ? (
                    <span className="flex items-center gap-1.5 text-ui-sm text-spectrum-green">
                      <Check className="w-3.5 h-3.5" /> in your skills
                    </span>
                  ) : (
                    <button
                      onClick={() => void act(skill)}
                      disabled={claiming === skill.id}
                      className={`h-7 px-3 gap-1.5 text-ui-sm ${skill.free ? 'pro-btn-filled' : 'btn-primary'}`}
                    >
                      {claiming === skill.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : skill.free
                          ? <><Download className="w-3.5 h-3.5" /> Get</>
                          : <>Buy</>}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Installing the package itself is the next stage and is not
          claimed here: owning a skill and having its bytes on disk are
          different facts, and the UI says only the one that is true. */}
      {owned.length > 0 && (
        <p className="text-micro text-spectrum-textFaint mt-5 leading-snug">
          {owned.length} skill{owned.length > 1 ? 's' : ''} on this account. Downloading and
          installing the package is not wired up yet. The entitlement is real, the install is
          the next piece.
        </p>
      )}

      {signInOpen && <SignInDialog onClose={() => setSignInOpen(false)} />}
      {buying && <BuySheet skill={buying} onClose={() => setBuying(null)} />}
    </section>
  );
};
