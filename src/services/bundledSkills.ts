/* ═══════════════════════════════════════════════════════════════════
   The skills that ship inside Kerf.

   The Skills screen was written against the store, so it showed the
   store's catalogue and nothing else. Kerf bundles two skills, and both
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

/** The slice of a `skill.json` this screen reads. The rest is for the runner. */
export interface BundledSkill {
  id: string;
  name: string;
  version: string;
  summary: string;
  /** How many trial runs the publisher allows. 0 means not gated. */
  trialUses: number;
  /** What the buyer is allowed to change without editing the recipe. */
  slots: { id: string; kind: string; required?: boolean; description?: string }[];
  requiresTools: string[];
  /** Whether it carries its own verification test, which is what makes it a skill. */
  verified: boolean;
  provenance?: { author?: string; builtWith?: string; builtAt?: string };
}

interface RawManifest {
  id?: string;
  name?: string;
  version?: string;
  summary?: string;
  trial?: { uses?: number };
  slots?: { id: string; kind: string; required?: boolean; description?: string }[];
  requiresTools?: string[];
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
export const BUNDLED_SKILLS: BundledSkill[] = Object.values(MANIFESTS)
  .filter((m): m is RawManifest => Boolean(m && m.id && m.name))
  .map((m) => ({
    id: m.id!,
    name: m.name!,
    version: m.version ?? '0.0.0',
    summary: m.summary ?? '',
    trialUses: m.trial?.uses ?? 0,
    slots: m.slots ?? [],
    requiresTools: m.requiresTools ?? [],
    /* A skill is tools, assets, a template and a VERIFICATION TEST. The
       badge is the presence of the fourth, not a claim about quality. */
    verified: Boolean(m.verify),
    provenance: m.provenance,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function bundledSkill(id: string): BundledSkill | undefined {
  return BUNDLED_SKILLS.find((s) => s.id === id);
}
