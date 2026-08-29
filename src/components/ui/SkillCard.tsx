/* ═══════════════════════════════════════════════════════════════════
   One skill, drawn once.

   This markup was in THREE places — the home rail, the editor's Skills
   panel and the Skills view — and two of those three were mine, copied
   in the same session. The thumbnail, its two badges, the shade over
   them, the clamped summary and the actions were re-typed each time,
   which is exactly how the badge ends up in a different corner on one
   of them a month later.

   The artwork is the approved prototype's frozen seed artwork. Keeping
   those files local gives Home and the editor's Skills tab the same
   visual plates while the shared component keeps their badges, labels
   and actions aligned.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { BadgeCheck } from './icons';
import { Button } from './Primitives';

export interface SkillCardSkill {
  id: string;
  name: string;
  version: string;
  summary?: string;
  verified?: boolean;
}

export const SkillCard: React.FC<{
  skill: SkillCardSkill;
  artwork?: string;
  /** 16/10 in a rail, 16/9 in a panel — the frame, not the card. */
  aspect?: string;
  onOpen: () => void;
  /** Omitted where there is nothing to run, e.g. the catalogue. */
  onRun?: () => void;
  onConfigure?: () => void;
}> = ({ skill, artwork, aspect = '16/10', onOpen, onRun, onConfigure }) => (
  <div className="hp-skill-card group min-w-0">
    <button onClick={onOpen} className="block w-full text-left min-w-0" aria-label={`Browse ${skill.name}`}>
      <span className="hp-skill-thumb block" style={{ aspectRatio: aspect }}>
        {artwork ? <img src={artwork} alt="" className="w-full h-full object-cover" /> : null}
        <span className="hp-skill-thumb-shade" aria-hidden="true" />
        <span className="hp-skill-state">
          {skill.verified && <BadgeCheck className="w-3.5 h-3.5" weight="fill" />}
          Included
        </span>
        <span className="hp-skill-version">v{skill.version}</span>
      </span>

      <span className="block px-1 pt-1.5">
        <span className="block text-ui-lg leading-5 font-semibold text-spectrum-text truncate">
          {skill.name}
        </span>
        {skill.summary && (
          <span className="block text-ui-sm text-spectrum-textDim leading-snug mt-0.5 clamp-2">
            {skill.summary}
          </span>
        )}
      </span>
    </button>

    {/* The action row runs at 23.5px in the reference — xs controls with
        almost no gutter — which is what keeps the artwork the tallest
        thing on the card. At sm with pt-2 it stood 38px and pushed the
        card 23px past the design. */}
    {(onRun || onConfigure) && (
      <div className="flex items-center gap-2 px-1 pt-0.5">
        {onRun && (
          <Button variant="filled" size="xs" onClick={onRun} title={`Ask the Copilot to run ${skill.name}`}>
            Run
          </Button>
        )}
        {onConfigure && (
          <Button variant="ghost" size="xs" onClick={onConfigure} title={`${skill.name} in the Skills view`}>
            Configure
          </Button>
        )}
      </div>
    )}
  </div>
);
