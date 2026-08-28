import { describe, expect, it } from 'vitest';
import { mergeBundledSkills, type BundledSkill } from './bundledSkills';

const base: BundledSkill = {
  id: 'tutorial',
  name: 'Tutorial',
  version: '1.9.0',
  toolApi: 1,
  summary: 'Bundled copy',
  trialUses: 0,
  slots: [],
  requiresTools: [],
  recipe: [],
  verified: true,
};

describe('runtime bundled-skill overrides', () => {
  it('uses a newer manifest with the same id', () => {
    const [resolved] = mergeBundledSkills([base], [{
      manifest: {
        id: 'tutorial', name: 'Tutorial', version: '1.10.0', toolApi: 1,
        summary: 'Downloaded copy', slots: [], requiresTools: [], verify: 'verify.py',
      },
    }]);
    expect(resolved.version).toBe('1.10.0');
    expect(resolved.summary).toBe('Downloaded copy');
    expect(resolved.verified).toBe(true);
  });

  it('keeps the app copy against equal or older runtime manifests', () => {
    for (const version of ['1.9.0', '1.8.99']) {
      const [resolved] = mergeBundledSkills([base], [{
        manifest: { id: 'tutorial', name: 'Old', version, summary: 'stale' },
      }]);
      expect(resolved).toEqual(base);
    }
  });

  it('does not let an unrelated runtime skill replace a bundled one', () => {
    const [resolved] = mergeBundledSkills([base], [{
      manifest: { id: 'another-skill', name: 'Another', version: '99.0.0', summary: 'other' },
    }]);
    expect(resolved).toEqual(base);
  });
});
