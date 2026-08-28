import React from 'react';
import { useBundledSkills } from '../../hooks/useBundledSkills';
import { ArrowRight, BadgeCheck, Blocks } from '../ui/icons';
import { skillArtwork } from './skillArtwork';

interface Props {
  onOpenSkills: () => void;
}

/**
 * The template wall from the reference, filled with the skills that
 * really ship with Kerf. They are deliberately poster-shaped here:
 * this is a browse-and-discover surface, while the Skills page keeps
 * the denser catalogue cards and purchasing controls.
 */
export const HomeSkillsShelf: React.FC<Props> = ({ onOpenSkills }) => {
  const { skills } = useBundledSkills();
  const publicSkills = skills.filter((skill) => skill.id !== 'skill-builder');

  return (
    <section id="hp-skills" className="scroll-mt-4">
      <div className="flex items-center gap-2.5 h-[30px]">
        <h2 className="text-ui-lg font-semibold text-spectrum-textMuted">Skills</h2>
        <span className="chip tabular">{publicSkills.length}</span>
        <span className="flex-1" />
        <button onClick={onOpenSkills} className="hp-view-more">
          View all
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {publicSkills.length === 0 ? (
        <div className="surface-card rounded-squircle-lg mt-4 p-5 flex items-center gap-3">
          <Blocks className="w-5 h-5 text-spectrum-textDim" />
          <p className="text-ui-lg text-spectrum-textDim">Bundled skills are being prepared.</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,200px))] gap-3.5 mt-4 max-w-[980px]">
          {publicSkills.map((skill) => {
            const artwork = skillArtwork(skill.id);
            return (
              <button
                key={skill.id}
                onClick={onOpenSkills}
                className="hp-skill-card group text-left min-w-0"
                aria-label={`Browse ${skill.name}`}
              >
                <span className="hp-skill-thumb">
                  {artwork ? <img src={artwork} alt="" className="w-full h-full object-cover" /> : null}
                  <span className="hp-skill-thumb-shade" aria-hidden="true" />
                  <span className="hp-skill-state">
                    {skill.verified && <BadgeCheck className="w-3.5 h-3.5" weight="fill" />}
                    Included
                  </span>
                  <span className="hp-skill-version">v{skill.version}</span>
                </span>

                <span className="block px-1 pt-3 pb-1">
                  <span className="block text-ui-lg leading-5 font-semibold text-spectrum-text truncate">
                    {skill.name}
                  </span>
                  <span className="block text-ui-sm text-spectrum-textDim leading-snug mt-1 clamp-2">
                    {skill.summary}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};
