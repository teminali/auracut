/* ═══════════════════════════════════════════════════════════════════
   The editor's Skills panel.

   The approved editor has a Skills destination on the rail and the
   platform had none — skills were reachable only from the launcher,
   which meant leaving the project you wanted to run one ON.

   Nothing here is a new mechanism. A skill runs the way it has always
   run: by asking the Copilot for it, in words. This opens the real
   drawer and sends the real prompt, so the run is visible, cancellable
   and in the transcript like every other turn. There is no private
   route into a skill that the Copilot does not know about, and there
   is no per-skill configuration screen invented to fill a panel.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useBundledSkills } from '../../hooks/useBundledSkills';
import { useProjectStore } from '../../store/projectStore';
import { useAgentChatStore } from '../../store/agentChatStore';
import { PanelSearch, matchesQuery } from './PanelSearch';
import { EmptyState } from '../ui/Controls';
import { skillArtwork } from '../home/skillArtwork';
import { Blocks } from '../ui/icons';
import { SkillCard } from '../ui/SkillCard';

export const SkillsPanel: React.FC = () => {
  const { skills } = useBundledSkills();
  const setCopilotOpen = useProjectStore((s) => s.setCopilotOpen);
  const [query, setQuery] = React.useState('');

  const publicSkills = skills.filter((s) => s.id !== 'skill-builder');
  const shown = publicSkills.filter((s) => matchesQuery(query, s.name, s.summary));

  const run = (name: string) => {
    setCopilotOpen(true);
    void useAgentChatStore.getState().sendPrompt(`Run the ${name} skill.`);
  };

  return (
    <aside className="w-full h-full bg-spectrum-panel border-r border-line flex flex-col overflow-hidden">
      <div className="panel-header">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="panel-title">Skills</span>
          <span className="text-micro font-mono text-spectrum-textFaint tabular">
            {publicSkills.length}
          </span>
        </div>
      </div>

      <div className="px-2 py-2 flex-shrink-0">
        <PanelSearch
          value={query}
          onChange={setQuery}
          noun="skills"
          countLabel={`${shown.length} of ${publicSkills.length}`}
        />
      </div>

      {publicSkills.length === 0 ? (
        <EmptyState
          icon={Blocks}
          title="No skills installed"
          detail="Bundled skills ship with TeminaliCut. Browse them from the home screen."
        />
      ) : shown.length === 0 ? (
        <EmptyState icon={Blocks} title="Nothing matches" detail={`No skill matches “${query}”.`} />
      ) : (
        <div className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-2">
          {shown.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              artwork={skillArtwork(skill.id)}
              aspect="16/9"
              onOpen={() => run(skill.name)}
              onRun={() => run(skill.name)}
            />
          ))}
        </div>
      )}
    </aside>
  );
};
