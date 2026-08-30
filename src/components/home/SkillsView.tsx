/* ═══════════════════════════════════════════════════════════════════
   The skills store, laid out after CapCut's templates page.

   That page is the right reference for this screen and not a
   coincidence: both are a titled catalogue you browse and filter, and
   both open with a wide banner carrying the title, one paragraph of
   what the thing is, and the search. So this has the banner, the
   scope control beside the search, the tab bar under it, and a wall of
   cards whose type sits below the plate rather than inside a box.

   The gradient follows the supplied kit's blue, lilac and blush
   banner. It is intentionally lighter than the editor because this is
   a browse-and-choose surface, not a colour-critical canvas.

   The scope is ONE state with two affordances. CapCut's page has the
   same redundancy, a dropdown beside the search and a tab bar under
   it, and it is only a problem when the two disagree, so they do not:
   both read and write `scope`.

   Two things this screen still refuses to pretend about:

     · a skill's "verified" badge is the record of a verification RUN
       that passed against a fresh project (§6). A skill with no
       `verifiedAt` cannot be published, so the badge is a fact rather
       than a marketing claim.
     · `licenceState` is shown when it is not `valid`. A licence that
       did not verify is not quietly treated as ownership. Most often
       it means the build is carrying a signing key the server does not
       have, and hiding that would strand a paying customer.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useAccountStore } from '../../store/accountStore';
import { useUiStore } from '../../store/uiStore';
import { formatPrice, type StoreSkill } from '../../services/storeClient';
import { trialStatus } from '../../services/skillTrials';
import { useBundledSkills } from '../../hooks/useBundledSkills';
import type { TrialStatus } from '../../types/electron';
import { SignInDialog } from './SignInDialog';
import { BuySheet } from './BuySheet';
import { skillArtwork } from './skillArtwork';
import {
  Blocks, BadgeCheck, Check, Loader2, WifiOff, ShieldAlert, Download, Timer, Sparkle,
  Search, X, ChevronDown,
} from '../ui/icons';

type Scope = 'all' | 'bundled' | 'store';

const SCOPES: { id: Scope; label: string }[] = [
  { id: 'all', label: 'All skills' },
  { id: 'bundled', label: 'Included with FrontierCut' },
  { id: 'store', label: 'From the store' },
];

/* The plate at the top of a card. A skill has no poster frame, so the
   plate carries the mark and the badges rather than a picture of
   nothing: the reference puts the duration and the use count on its
   thumbnail, and these are the two facts that belong in that slot. */
const PLATE = 'block aspect-[4/5] rounded-squircle-sm relative overflow-hidden flex items-center justify-center';

export const SkillsView: React.FC = () => {
  const { skills: allBundledSkills } = useBundledSkills();
  /* Skill Builder remains bundled for internal authoring and
     verification, but it is a developer tool—not a public product. */
  const bundledSkills = allBundledSkills.filter((skill) => skill.id !== 'skill-builder');
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
  const [scope, setScope] = React.useState<Scope>('all');
  const [query, setQuery] = React.useState('');

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

  const q = query.trim().toLowerCase();
  const hit = (name: string, summary: string) =>
    !q || name.toLowerCase().includes(q) || summary.toLowerCase().includes(q);

  const bundled = bundledSkills.filter((s) => hit(s.name, s.summary));
  const store = skills.filter((s) => hit(s.name, s.summary));

  const showBundled = scope !== 'store';
  const showStore = scope !== 'bundled';

  return (
    <section>
      {/* ── The banner ─────────────────────────────────────────── */}
      <div className="hp-banner rounded-squircle-lg px-8 py-7 rise-in rise-1">
        <div className="relative z-[1] max-w-[600px]">
          <h2 className="text-[26px] leading-[1.1] font-semibold text-spectrum-text tracking-[-0.024em]">
            Skills
          </h2>

          <p className="text-ui-xl text-spectrum-textMuted leading-relaxed mt-2.5">
            A skill is a template project, the assets it needs, the tools that fill it in, and a
            verification test that has to pass before it can be sold. Buy it once for a major
            version; new projects are cloned from it and stay yours to edit by hand.
          </p>

          <div className="flex items-center gap-2 mt-5">
            <div className="relative flex-shrink-0">
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as Scope)}
                className="pro-input appearance-none h-[34px] text-ui-sm pl-3 pr-7 cursor-pointer"
                title="Which skills to show"
                aria-label="Which skills to show"
              >
                {SCOPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <ChevronDown
                className="w-3 h-3 text-spectrum-textDim absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
            </div>

            <div className="pro-input h-[34px] flex items-center gap-2 px-3 flex-1 max-w-[320px]">
              <Search className="w-3.5 h-3.5 text-spectrum-textDim flex-shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
                placeholder="Search skills…"
                aria-label="Search skills"
                className="flex-1 bg-transparent outline-none text-ui-sm text-spectrum-text
                           placeholder:text-spectrum-textFaint min-w-0"
              />
              {query && (
                <button onClick={() => setQuery('')} className="pro-btn w-4 h-4 flex-shrink-0"
                        title="Clear" aria-label="Clear the search">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {status === 'unknown' && (
              <span className="flex items-center gap-1.5 text-ui-sm text-spectrum-textDim">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> checking…
              </span>
            )}
            {status === 'signed_out' && (
              <button onClick={() => setSignInOpen(true)} className="btn-primary h-[34px] px-4 text-ui-sm">
                Sign in
              </button>
            )}
          </div>
        </div>

        {/* The reference fills the right end of its banner with a
            collage of the templates it is selling. This is the same
            slot with the same job, holding the skills that are
            actually installed rather than a picture of some. */}
        <div
          aria-hidden="true"
          className="absolute right-0 top-0 bottom-0 w-[300px] hidden xl:flex items-center justify-center gap-3
                     pointer-events-none opacity-90"
          style={{ maskImage: 'linear-gradient(90deg,transparent 0%,#000 34%,#000 100%)',
                   WebkitMaskImage: 'linear-gradient(90deg,transparent 0%,#000 34%,#000 100%)' }}
        >
          {bundledSkills.slice(0, 3).map((skill, i) => (
            <span
              key={skill.id}
              className="w-[84px] h-[112px] rounded-squircle-md flex flex-col items-center justify-center gap-2 px-2
                         shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]"
              style={{
                /* Three depths of the accent, not three different hues.
                   These were teal, violet and mauve — the fanned cards
                   in the banner were a third palette on a screen that
                   now has one. The raised centre card is the brightest,
                   which is the only ranking the fan needs. */
                background: i === 1
                  ? 'linear-gradient(150deg,#4d2c1e,#2b1e19)'
                  : i === 2
                    ? 'linear-gradient(150deg,#2f1d16,#211a17)'
                    : 'linear-gradient(150deg,#3d2419,#261c18)',
                transform: `rotate(${(i - 1) * 6}deg) translateY(${i === 1 ? -10 : 0}px)`,
              }}
            >
              <Sparkle className="w-4 h-4 text-white/70" weight="fill" />
              <span className="text-micro text-white/70 font-semibold text-center leading-tight">{skill.name}</span>
            </span>
          ))}
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-6 mt-7 mb-6 rise-in rise-2">
        {SCOPES.map((s) => (
          <button
            key={s.id}
            onClick={() => setScope(s.id)}
            aria-current={scope === s.id ? 'true' : undefined}
            className={`hp-tab text-ui-xl pb-2.5 ${scope === s.id ? 'hp-tab-on' : ''}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-11 rise-in rise-3">

        {/* ── What is already installed ────────────────────────────
            Above the catalogue, because it is the part that is true
            right now. A screen called Skills that lists none of the
            skills you have is telling you something untrue about your
            own install, and the Tutorial skill is offered by name
            after every take. */}
        {showBundled && (
          <section>
            <div className="flex items-center gap-2.5 h-[30px]">
              <h3 className="text-ui-lg font-semibold text-spectrum-textMuted">Included with FrontierCut</h3>
              <span className="chip tabular">{bundled.length}</span>
            </div>

            {bundled.length === 0 ? (
              <p className="text-ui-lg text-spectrum-textDim mt-4">
                None of the bundled skills match “{query.trim()}”.
              </p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(184px,184px))] gap-4 mt-5">
                {bundled.map((skill) => {
                  const artwork = skillArtwork(skill.id);
                  return (
                  <div key={skill.id} className="hp-catalog-card group">
                    <span className={`${PLATE} hp-plate-warm`}>
                      {artwork && <img src={artwork} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                      <span className="hp-skill-thumb-shade" aria-hidden="true" />

                      {skill.verified && (
                        <span
                          className="media-pill absolute bottom-2 left-2 h-[18px] px-1.5 rounded-squircle-xs
                                     flex items-center gap-1 !font-sans !text-spectrum-green"
                          title="Ships with its own verification test, which is what makes it a skill rather than a prompt pack"
                        >
                          <BadgeCheck className="w-2.5 h-2.5" weight="fill" /> verified
                        </span>
                      )}
                      <span className="media-pill absolute bottom-2 right-2 h-[18px] px-1.5 rounded-squircle-xs flex items-center">
                        v{skill.version}
                      </span>
                    </span>

                    <p className="text-ui-lg font-medium text-spectrum-text truncate mt-2.5">{skill.name}</p>
                    <p className="text-ui-sm text-spectrum-textDim leading-snug mt-1 clamp-2">{skill.summary}</p>

                    <p className="flex items-center gap-1.5 text-ui-sm text-spectrum-green mt-2">
                      <Check className="w-3.5 h-3.5 flex-shrink-0" />
                      installed
                      <span className="text-spectrum-textFaint">
                        {/* Bundled skills declare `trial.uses: 0`, which
                            means not gated. Counting runs of something
                            that ships inside the app would be gating
                            somebody out of what they already have. */}
                        · {skill.trialUses > 0 ? `${skill.trialUses} trial runs` : 'no limit'}
                      </span>
                    </p>
                  </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ── The catalogue ──────────────────────────────────────── */}
        {showStore && (
          <section>
            <div className="flex items-center gap-2.5 h-[30px]">
              <h3 className="text-ui-lg font-semibold text-spectrum-textMuted">From the store</h3>
              {loaded && store.length > 0 && <span className="chip tabular">{store.length}</span>}
            </div>

            {reachable === false && (
              <div className="flex items-start gap-2.5 surface-card rounded-squircle-md p-3.5 mt-4">
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
            ) : store.length === 0 ? (
              <div className="surface-card rounded-squircle-lg p-5 mt-4">
                <div className="flex items-center gap-2">
                  <Blocks className="w-4 h-4 text-spectrum-textDim" />
                  <p className="text-ui-lg text-spectrum-text font-medium">
                    {q ? `Nothing in the store matches “${query.trim()}”.` : 'Nothing published yet.'}
                  </p>
                </div>
                {!q && (
                  <p className="text-ui-lg text-spectrum-textDim leading-relaxed mt-2">
                    The store is running and the catalogue is empty, which is the honest state of it.
                    A skill appears here once it has a verification run that passed. The skills above
                    ship inside Kerf and do not come from here.
                  </p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(184px,184px))] gap-4 mt-5">
                {store.map((skill) => {
                  const mine = ownedFor(skill);
                  const isOwned = Boolean(mine);
                  const trial = trials[skill.id];
                  return (
                    <div key={skill.id} className="hp-catalog-card group">
                      <span className={`${PLATE} hp-plate-cool`}>
                        <span className="w-11 h-11 rounded-squircle-md bg-white/[0.10] flex items-center justify-center
                                         shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]">
                          <Blocks className="w-[22px] h-[22px] text-spectrum-accent" weight="duotone" />
                        </span>

                        {skill.verifiedAt && (
                          <span
                            className="media-pill absolute bottom-2 left-2 h-[18px] px-1.5 rounded-squircle-xs
                                       flex items-center gap-1 !font-sans !text-spectrum-green"
                            title={`Verified against a fresh project, ${skill.verifiedBuild ?? 'build not recorded'}`}
                          >
                            <BadgeCheck className="w-2.5 h-2.5" weight="fill" /> verified
                          </span>
                        )}
                        <span className="media-pill absolute bottom-2 right-2 h-[18px] px-1.5 rounded-squircle-xs flex items-center">
                          v{skill.latestVersion}
                        </span>
                      </span>

                      <p className="text-ui-lg font-medium text-spectrum-text truncate mt-2.5">{skill.name}</p>
                      <p className="text-ui-sm text-spectrum-textDim leading-snug mt-1 clamp-2">{skill.summary}</p>
                      <p className="text-micro text-spectrum-textFaint truncate mt-1.5">
                        {skill.author} · tool API {skill.toolApi}
                      </p>

                      {!isOwned && trial && trial.reason !== 'not-gated' && (
                        <p className={`flex items-start gap-1.5 mt-2 ${
                          trial.canRun ? 'text-spectrum-textDim' : 'text-spectrum-amber'}`}>
                          <Timer className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                          <span className="text-micro leading-snug">
                            {trial.message}
                            {/* Said plainly, because the alternative is
                                implying a guarantee that does not exist:
                                the count is on this machine and deleting
                                it resets it. */}
                            {trial.trialsAreLocal && trial.canRun ? ' Counted on this computer.' : ''}
                          </span>
                        </p>
                      )}

                      {mine && mine.licenceState !== 'valid' && (
                        <p className="flex items-start gap-1.5 mt-2 text-spectrum-amber">
                          <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                          <span className="text-micro leading-snug">
                            {mine.licenceState === 'expired'
                              ? 'Licence needs refreshing, connect once to renew it.'
                              : 'This licence did not verify on this machine.'}
                          </span>
                        </p>
                      )}

                      <div className="flex items-center justify-between gap-2 mt-3">
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
                            aria-label={skill.free ? `Get ${skill.name}` : `Buy ${skill.name}`}
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
          </section>
        )}
      </div>

      {/* Manifest updates are real; package assets are still a separate
          install. Owning a skill and having all of its bytes on disk are
          different facts, and the UI says only the one that is true. */}
      {owned.length > 0 && (
        <p className="text-micro text-spectrum-textFaint mt-8 leading-snug">
          {owned.length} skill{owned.length > 1 ? 's' : ''} on this account. Settings and guidance
          can update independently. Downloading package assets and executable recipe support are
          still separate work; the entitlement is real, but Kerf does not claim those parts yet.
        </p>
      )}

      {signInOpen && <SignInDialog onClose={() => setSignInOpen(false)} />}
      {buying && <BuySheet skill={buying} onClose={() => setBuying(null)} />}
    </section>
  );
};
