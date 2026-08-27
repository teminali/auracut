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
import { trialStatus } from '../../services/skillTrials';
import { BUNDLED_SKILLS } from '../../services/bundledSkills';
import type { TrialStatus } from '../../types/electron';
import { SignInDialog } from './SignInDialog';
import { BuySheet } from './BuySheet';
import {
  Blocks, BadgeCheck, Check, Loader2, WifiOff, ShieldAlert, Download, Timer, Sparkle,
} from '../ui/icons';

export const SkillsView: React.FC = () => {
  const status = useAccountStore((s) => s.status);
  const skills = useAccountStore((s) => s.skills);
  const loaded = useAccountStore((s) => s.catalogueLoaded);
  const reachable = useAccountStore((s) => s.reachable);
  const owned = useAccountStore((s) => s.owned);
  const claimFree = useAccountStore((s) => s.claimFree);
  const pushToast = useUiStore((s) => s.pushToast);

  const [trials, setTrials] = React.useState<Record<string, TrialStatus>>({});
  const [signInOpen, setSignInOpen] = React.useState(false);
  const [buying, setBuying] = React.useState<StoreSkill | null>(null);
  const [claiming, setClaiming] = React.useState<string | null>(null);

  const ownedFor = (s: StoreSkill) =>
    owned.find((o) => o.skillId === s.id && o.majorVersion === s.majorVersion);

  /*
    How many trial runs are left, asked of the sealed ledger in main
    rather than tracked here. The renderer is not allowed to be the one
    that counts: a number in a React state is a number a page can
    change, and the whole point of the ledger is that the count is not
    editable by whatever is showing it.
  */
  React.useEffect(() => {
    let cancelled = false;
    const gated = skills.filter((s) => (s.trialUses ?? 0) > 0 && !s.free);
    void Promise.all(
      gated.map(async (skill) => [
        skill.id,
        await trialStatus(skill.id, skill.trialUses ?? 0, Boolean(ownedFor(skill))),
      ] as const)
    ).then((entries) => {
      if (!cancelled) setTrials(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills, owned]);

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

      {/* ── What is already installed ────────────────────────────────
          Above the catalogue, because it is the part that is true right
          now. A screen called Skills that lists none of the skills you
          have is telling you something untrue about your own install,
          and the Tutorial skill is offered by name after every take. */}
      <div className="mt-5">
        <div className="flex items-center gap-2">
          <h3 className="text-ui-lg font-semibold text-spectrum-text">Included with Kerf</h3>
          <span className="chip">{BUNDLED_SKILLS.length}</span>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-3">
          {BUNDLED_SKILLS.map((skill) => (
            <div key={skill.id} className="rounded-squircle-lg bg-spectrum-panel p-4 flex flex-col">
              <div className="flex items-start gap-2">
                <span className="w-7 h-7 rounded-[9px] bg-spectrum-accent/15 flex items-center
                                 justify-center flex-shrink-0">
                  <Sparkle className="w-3.5 h-3.5 text-spectrum-accent" />
                </span>
                <h4 className="text-ui-xl font-semibold text-spectrum-text flex-1 min-w-0">
                  {skill.name}
                </h4>
                {skill.verified && (
                  <span
                    className="flex items-center gap-1 h-[18px] px-1.5 rounded-full
                               bg-spectrum-green/12 text-spectrum-green flex-shrink-0"
                    title="Ships with its own verification test, which is what makes it a skill
                           rather than a prompt pack"
                  >
                    <BadgeCheck className="w-3 h-3" />
                    <span className="text-micro font-medium">verified</span>
                  </span>
                )}
              </div>

              <p className="text-ui-sm text-spectrum-textMuted leading-snug mt-2 flex-1">
                {skill.summary}
              </p>

              <p className="text-micro text-spectrum-textFaint mt-2">
                v{skill.version}
                {skill.provenance?.author ? ` · ${skill.provenance.author}` : ''}
                {skill.slots.length > 0
                  ? ` · ${skill.slots.length} setting${skill.slots.length === 1 ? '' : 's'}`
                  : ''}
              </p>

              <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-line">
                <span className="text-ui-sm text-spectrum-textDim">
                  {/* Bundled skills declare `trial.uses: 0`, which means not
                      gated. Counting runs of something that ships inside the
                      app would be gating somebody out of what they have. */}
                  {skill.trialUses > 0 ? `${skill.trialUses} trial runs` : 'No limit'}
                </span>
                <span className="flex items-center gap-1.5 text-ui-sm text-spectrum-green">
                  <Check className="w-3.5 h-3.5" /> installed
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <h3 className="text-ui-lg font-semibold text-spectrum-text mt-8">From the store</h3>

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
            A skill appears here once it has a verification run that passed. The skills above
            ship inside Kerf and do not come from here.
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

                {!isOwned && trials[skill.id] && trials[skill.id].reason !== 'not-gated' && (
                  <div
                    className={`flex items-start gap-1.5 mt-2 ${
                      trials[skill.id].canRun ? 'text-spectrum-textDim' : 'text-spectrum-amber'
                    }`}
                  >
                    <Timer className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                    <span className="text-micro leading-snug">
                      {trials[skill.id].message}
                      {/* Said plainly, because the alternative is implying a
                          guarantee that does not exist: the count is on this
                          machine and deleting it resets it. A publisher
                          reading "3 runs" should know what kind of 3 it is. */}
                      {trials[skill.id].trialsAreLocal && trials[skill.id].canRun
                        ? ' Counted on this computer.'
                        : ''}
                    </span>
                  </div>
                )}

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
