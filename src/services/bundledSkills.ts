/* ═══════════════════════════════════════════════════════════════════
   The skills that ship inside TeminaliCut.

   The Skills screen was written against the store, so it showed the
   store's catalogue and nothing else. TeminaliCut bundles two skills, and both
   were invisible there — including the Tutorial skill, which is the one
   the recorder offers by name after every take. A screen called Skills
   that does not list the skills you have is telling you something
   untrue about your own install.

   Worse, the store is a Cloudflare Worker that is not deployed:
   `kerf-store.mhasibudigital.workers.dev` does not resolve. So the
   catalogue is empty for everybody, and the screen's honest "nothing
   published yet" was covering for the fact that there was also nothing
   local. These two facts are independent and should look independent.

   ── Read at BUILD time, not from disk ──────────────────────────────

   `import.meta.glob` with `eager` inlines each manifest into the
   bundle. The alternative is reading each skill folder's manifest from
   disk at runtime, which cannot work in a packaged app: `files:` in
   electron-builder.yml ships `dist`, `dist-electron` and package.json,
   and nothing else. A manifest that only exists in a git checkout is a
   manifest the shipped app has never seen.
   ═══════════════════════════════════════════════════════════════════ */

import { compareVersions } from '../utils/version';

/** The slice of a `skill.json` this screen reads. The rest is for the runner. */
export interface BundledSkill {
  id: string;
  name: string;
  version: string;
  /** Tool contract this manifest expects from the app. */
  toolApi: number;
  summary: string;
  /** How many trial runs the publisher allows. 0 means not gated. */
  trialUses: number;
  /** What the buyer is allowed to change without editing the recipe. */
  slots: {
    id: string; kind: string; required?: boolean; default?: unknown;
    options?: string[]; description?: string; requiresSlot?: string;
  }[];
  requiresTools: string[];
  recipe: { tool: string; args: Record<string, unknown> }[];
  guide?: string;
  /** Whether it carries its own verification test, which is what makes it a skill. */
  verified: boolean;
  provenance?: { author?: string; builtWith?: string; builtAt?: string };
}

interface RawManifest {
  id?: string;
  name?: string;
  version?: string;
  toolApi?: number;
  summary?: string;
  trial?: { uses?: number };
  slots?: {
    id: string; kind: string; required?: boolean; default?: unknown;
    options?: string[]; description?: string; requiresSlot?: string;
  }[];
  requiresTools?: string[];
  recipe?: { tool: string; args: Record<string, unknown> }[];
  guide?: string;
  verify?: string;
  provenance?: { author?: string; builtWith?: string; builtAt?: string };
}

/*
  Root-relative, so it reaches outside `src`: Vite resolves a leading
  slash against the project root rather than against the importing file.
*/
const MANIFESTS = import.meta.glob<RawManifest>('/skills/*/skill.json', {
  eager: true,
  import: 'default',
});

/**
 * Every bundled skill, in a stable order.
 *
 * Sorted by name rather than by whatever order the glob returns, which
 * is filesystem order and therefore differs between machines.
 */
function asBundledSkill(m: RawManifest): BundledSkill {
  return {
    id: m.id!,
    name: m.name!,
    version: m.version ?? '0.0.0',
    toolApi: m.toolApi ?? 1,
    summary: m.summary ?? '',
    trialUses: m.trial?.uses ?? 0,
    slots: m.slots ?? [],
    requiresTools: m.requiresTools ?? [],
    recipe: m.recipe ?? [],
    guide: m.guide,
    /* A skill is tools, assets, a template and a VERIFICATION TEST. The
       badge is the presence of the fourth, not a claim about quality. */
    verified: Boolean(m.verify),
    provenance: m.provenance,
  };
}

export const BUNDLED_SKILLS: BundledSkill[] = Object.values(MANIFESTS)
  .filter((m): m is RawManifest => Boolean(m && m.id && m.name))
  .map(asBundledSkill)
  .sort((a, b) => a.name.localeCompare(b.name));

/** Highest manifest/tool contract this app build knows how to satisfy. */
export const SUPPORTED_SKILL_TOOL_API = Math.max(1, ...BUNDLED_SKILLS.map((s) => s.toolApi));

/** Runtime records are intentionally structural to keep Electron types out of this module. */
export interface RuntimeSkillRecord {
  manifest: RawManifest;
  assetsMissing?: string[];
}

/**
 * Let a newer runtime manifest replace the copy inlined into the app.
 *
 * Equal and older versions never win. That makes deleting an override a
 * safe rollback to the app copy and prevents a stale download from
 * shadowing a newer TeminaliCut release.
 */
export function mergeBundledSkills(
  bundled: BundledSkill[],
  runtime: RuntimeSkillRecord[]
): BundledSkill[] {
  const byId = new Map(runtime.map((r) => [r.manifest.id, r]));
  return bundled.map((base) => {
    const candidate = byId.get(base.id);
    const manifest = candidate?.manifest;
    if (!manifest?.id || !manifest.name || !manifest.version) return base;
    if (compareVersions(manifest.version, base.version) <= 0) return base;
    const resolved = asBundledSkill(manifest);
    resolved.verified = Boolean(manifest.verify)
      && !(candidate?.assetsMissing ?? []).includes(manifest.verify!);
    return resolved;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function bundledSkill(id: string): BundledSkill | undefined {
  return BUNDLED_SKILLS.find((s) => s.id === id);
}
