/* ═══════════════════════════════════════════════════════════════════
   Home's right rail: who you are, and what is installed.

   The approved launcher puts both of these in a column down the right
   rather than in the scrolling page, and it is the better shape: the
   account is a fact about the session and the skills list is a
   reference, so neither belongs in the flow of "what do I do next".
   Skills used to be a horizontal shelf between the tiles and the
   projects wall, which put a browse surface in the middle of a launch
   surface and pushed the actual work further down the page.

   RUN AND CONFIGURE ARE BOTH REAL, and neither is a new mechanism.

   `Run` is how a skill has always been run in this product: it asks
   the Copilot, in words, to run it. So the button enters the editor,
   opens the drawer and sends that prompt — you land where the work
   happens and watch it, rather than having something fire invisibly
   on a launcher. It is one deliberate click and the run is cancellable
   from the drawer like any other.

   `Configure` opens the Skills view, which is where a skill's detail,
   its entitlement and its trial state actually live. There is no
   separate per-skill settings screen and this does not invent one.

   The THUMBNAILS are the approved prototype's frozen seed artwork,
   stored locally so the launcher and editor panel share the exact same
   plates without relying on a network request at runtime. Real project
   and imported-media thumbnails remain content-derived elsewhere.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useBundledSkills } from '../../hooks/useBundledSkills';
import { useAccountStore } from '../../store/accountStore';
import { Blocks, ChevronRight, Search, X } from '../ui/icons';
import { SkillCard } from '../ui/SkillCard';
import { skillArtwork } from './skillArtwork';

interface Props {
  onOpenSkills: () => void;
  onOpenAccount: () => void;
  onSignIn: () => void;
  /** Enters the editor and asks the Copilot to run this skill. */
  onRunSkill: (name: string) => void;
}

export const HomeSkillsRail: React.FC<Props> = ({
  onOpenSkills, onOpenAccount, onSignIn, onRunSkill,
}) => {
  const { skills } = useBundledSkills();
  const authStatus = useAccountStore((s) => s.status);
  const user = useAccountStore((s) => s.user);
  const [query, setQuery] = React.useState('');

  const publicSkills = skills.filter((skill) => skill.id !== 'skill-builder');
  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return publicSkills;
    return publicSkills.filter(
      (s) => s.name.toLowerCase().includes(q) || (s.summary ?? '').toLowerCase().includes(q)
    );
  }, [publicSkills, query]);

  return (
    <aside className="hp-side-rail kf" aria-label="Account and skills">
      {/* ── Who you are ──────────────────────────────────────────
          Three states, as everywhere else in this app: `unknown`
          means the session file has not been read yet, and drawing
          either a name or a "Sign in" during that window is a claim
          the app has not looked up. It draws nothing. */}
      {authStatus === 'signed_in' && (
        <button onClick={onOpenAccount} className="hp-account-card" title="Open your account">
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="hp-account-avatar object-cover" />
          ) : (
            <span className="hp-account-avatar hp-account-avatar-fallback">
              {(user?.name ?? user?.email ?? '?').slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-ui-lg font-semibold text-spectrum-text truncate">
              {user?.name ?? user?.email ?? 'Signed in'}
            </span>
            <span className="block text-ui-sm text-spectrum-textDim truncate">
              {user?.email ?? 'TeminaliCut account'}
            </span>
          </span>
          <ChevronRight className="w-4 h-4 text-spectrum-textDim flex-shrink-0" />
        </button>
      )}

      {authStatus === 'signed_out' && (
        <button onClick={onSignIn} className="hp-account-card">
          <span className="hp-account-avatar hp-account-avatar-fallback">K</span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-ui-lg font-semibold text-spectrum-text truncate">Sign in</span>
            <span className="block text-ui-sm text-spectrum-textDim truncate">
              To buy and sync skills
            </span>
          </span>
          <ChevronRight className="w-4 h-4 text-spectrum-textDim flex-shrink-0" />
        </button>
      )}

      {/* ── What is installed ── */}
      <div className="flex items-center gap-2 mt-5">
        <p className="hp-kicker">Skills</p>
        <span className="text-ui-sm text-spectrum-textDim tabular">
          {publicSkills.length} installed
        </span>
        <span className="flex-1" />
        <button onClick={onOpenSkills} className="hp-view-more">View all</button>
      </div>

      <div className="pro-input flex items-center gap-1.5 px-2 h-7 mt-2">
        <Search className="w-3 h-3 text-spectrum-textDim flex-shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); } }}
          placeholder="Search skills…"
          className="flex-1 bg-transparent outline-none text-ui-sm text-spectrum-text placeholder:text-spectrum-textFaint min-w-0"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="w-3.5 h-3.5 flex items-center justify-center text-spectrum-textDim hover:text-spectrum-text flex-shrink-0"
            title="Clear (Esc)"
            aria-label="Clear the skill search"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 mt-3">
        {publicSkills.length === 0 ? (
          <div className="surface-card rounded-squircle-md p-4 flex items-center gap-2">
            <Blocks className="w-4 h-4 text-spectrum-textDim flex-shrink-0" />
            <p className="text-ui-sm text-spectrum-textDim">Bundled skills are being prepared.</p>
          </div>
        ) : shown.length === 0 ? (
          <p className="text-ui-sm text-spectrum-textDim px-1">
            Nothing matches “{query}”.
          </p>
        ) : (
          shown.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              artwork={skillArtwork(skill.id)}
              aspect="16/9"
              onOpen={onOpenSkills}
              onRun={() => onRunSkill(skill.name)}
              onConfigure={onOpenSkills}
            />
          ))
        )}
      </div>
    </aside>
  );
};
