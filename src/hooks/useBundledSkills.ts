import React from 'react';
import {
  BUNDLED_SKILLS, mergeBundledSkills, type BundledSkill, type RuntimeSkillRecord,
} from '../services/bundledSkills';

export const SKILLS_CHANGED_EVENT = 'kerf:skills-changed';

/** Bundled manifests with any newer runtime overrides applied. */
export function useBundledSkills(): { skills: BundledSkill[]; loaded: boolean } {
  const [skills, setSkills] = React.useState(BUNDLED_SKILLS);
  const [loaded, setLoaded] = React.useState(false);

  const load = React.useCallback(async () => {
    const records = await window.electronAPI?.userSkills?.list();
    setSkills(mergeBundledSkills(BUNDLED_SKILLS, (records ?? []) as RuntimeSkillRecord[]));
    setLoaded(true);
  }, []);

  React.useEffect(() => {
    void load();
    const changed = () => { void load(); };
    window.addEventListener(SKILLS_CHANGED_EVENT, changed);
    return () => window.removeEventListener(SKILLS_CHANGED_EVENT, changed);
  }, [load]);

  return { skills, loaded };
}
