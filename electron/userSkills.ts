/* ═══════════════════════════════════════════════════════════════════
   Skills the user made, as opposed to the ones Kerf ships.

   ── Why this exists at all ─────────────────────────────────────────

   `src/services/bundledSkills.ts` reads every `skills/<id>/skill.json`
   through `import.meta.glob`, which inlines them into the bundle at
   BUILD time. That is the right call for the skills that ship inside
   Kerf — `files:` in electron-builder.yml carries `dist`, `dist-electron`
   and package.json and nothing else, so a manifest that only exists in
   a git checkout is a manifest the shipped app has never seen.

   It also means a skill created while the app is running cannot be seen
   by the app that created it. There is no amount of prompting that gets
   around a glob evaluated at build time. So user skills live somewhere
   else and are read at RUNTIME, from `userData/skills/<id>/`, by the
   main process, which is the only side of the app that can read a file.

   ── The shape on disk, and why it is a folder ──────────────────────

       userData/skills/<id>/skill.json     the manifest
       userData/skills/<id>/GUIDE.md       how to run it, for the agent
       userData/skills/<id>/assets/…       whatever the skill needs

   A folder rather than one JSON file because a skill that generalises
   needs ASSETS, and the whole point of the builder is that a skill is
   not a saved project: it is a recipe plus the material to run that
   recipe on something new. One file could hold a manifest and could not
   hold a music bed.

   ── What this does not do ──────────────────────────────────────────

   It does not run anything. There is no skill runner in Kerf yet — the
   `recipe` field is declarative and the one skill that ships is invoked
   through its own tool. This stores, lists and validates. Running is the
   next piece and is deliberately not faked here, because a builder that
   produced skills nothing could execute would be worse than no builder:
   it would look finished.
   ═══════════════════════════════════════════════════════════════════ */

import { app, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';

export interface UserSkillManifest {
  id: string;
  name: string;
  version: string;
  summary: string;
  slots: { id: string; kind: string; required?: boolean; default?: unknown; options?: string[]; description?: string }[];
  requiresTools: string[];
  recipe: { tool: string; args: Record<string, unknown> }[];
  assets: { id: string; file: string; kind: string; description?: string }[];
  provenance?: { author?: string; builtWith?: string; builtAt?: string };
  /** Free text the agent reads before running it. */
  guide?: string;
}

export interface StoredUserSkill {
  manifest: UserSkillManifest;
  dir: string;
  /** Assets actually present on disk, so a missing file is visible. */
  assetsPresent: string[];
  assetsMissing: string[];
}

function root(): string {
  return path.join(app.getPath('userData'), 'skills');
}

/**
 * A folder name that cannot escape the skills directory.
 *
 * The id reaches this from an agent-authored manifest, so it is
 * untrusted input being turned into a path. `..`, a leading slash and a
 * Windows drive letter all have to be impossible rather than unlikely.
 */
function safeId(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(trimmed)) return null;
  return trimmed;
}

/** Everything a manifest must have before it is worth storing. */
export function validateManifest(raw: unknown): { ok: true; manifest: UserSkillManifest } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const m = (raw ?? {}) as Partial<UserSkillManifest>;

  const id = safeId(m.id);
  if (!id) problems.push('`id` must be 2-49 characters of lowercase letters, digits and hyphens, starting with a letter or digit.');
  if (!m.name || typeof m.name !== 'string') problems.push('`name` is required.');
  if (!m.summary || typeof m.summary !== 'string') problems.push('`summary` is required: one line saying what the skill makes.');

  const slots = Array.isArray(m.slots) ? m.slots : [];
  if (slots.length === 0) {
    /*
      The single most common way to get this wrong, so it is refused
      rather than warned about. A skill with no slots cannot be pointed
      at anything new — it can only rebuild the project it came from,
      which is a saved project wearing a skill's clothes.
    */
    problems.push(
      '`slots` is empty. A skill with no slots can only rebuild the one project it was made '
      + 'from. Give it the inputs that must change for it to build something else.'
    );
  }
  for (const [i, slot] of slots.entries()) {
    if (!slot || typeof slot.id !== 'string' || !slot.id) problems.push(`slots[${i}] has no id.`);
    if (!slot || typeof slot.kind !== 'string' || !slot.kind) problems.push(`slots[${i}] has no kind.`);
    if (slot?.kind === 'enum' && !Array.isArray(slot.options)) {
      problems.push(`slots[${i}] is an enum with no options list, so it is a free text field that fails on the fifth character somebody types.`);
    }
    if (!slot?.description) problems.push(`slots[${i}] has no description; the person filling it in has nothing to go on.`);
  }

  const recipe = Array.isArray(m.recipe) ? m.recipe : [];
  if (recipe.length === 0) problems.push('`recipe` is empty, so the skill does nothing.');
  for (const [i, step] of recipe.entries()) {
    if (!step || typeof step.tool !== 'string' || !step.tool) problems.push(`recipe[${i}] names no tool.`);
  }

  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    manifest: {
      id: id!,
      name: m.name!,
      version: typeof m.version === 'string' ? m.version : '1.0.0',
      summary: m.summary!,
      slots,
      requiresTools: Array.isArray(m.requiresTools) ? m.requiresTools : [],
      recipe,
      assets: Array.isArray(m.assets) ? m.assets : [],
      provenance: m.provenance,
      guide: typeof m.guide === 'string' ? m.guide : undefined,
    },
  };
}

export function listUserSkills(): StoredUserSkill[] {
  const base = root();
  if (!fs.existsSync(base)) return [];
  const out: StoredUserSkill[] = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(base, entry.name);
    const file = path.join(dir, 'skill.json');
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as UserSkillManifest;
      const present: string[] = [];
      const missing: string[] = [];
      for (const asset of parsed.assets ?? []) {
        (fs.existsSync(path.join(dir, asset.file)) ? present : missing).push(asset.file);
      }
      out.push({ manifest: parsed, dir, assetsPresent: present, assetsMissing: missing });
    } catch {
      /* A manifest that will not parse is skipped rather than crashing
         the Skills screen. It stays on disk so it can be repaired. */
    }
  }
  return out.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

export function initUserSkills(): void {
  ipcMain.handle('userSkills:list', () => listUserSkills());

  ipcMain.handle('userSkills:write', (_e, raw: unknown) => {
    const checked = validateManifest(raw);
    if (!checked.ok) return { ok: false as const, problems: checked.problems };

    const dir = path.join(root(), checked.manifest.id);
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'skill.json'),
      `${JSON.stringify(checked.manifest, null, 2)}\n`,
      { mode: 0o600 }
    );
    if (checked.manifest.guide) {
      fs.writeFileSync(path.join(dir, 'GUIDE.md'), checked.manifest.guide, { mode: 0o600 });
    }
    return { ok: true as const, dir, manifest: checked.manifest };
  });

  ipcMain.handle('userSkills:delete', (_e, p: { id: string }) => {
    const id = safeId(p?.id);
    if (!id) return { ok: false as const, error: 'Not a skill id.' };
    const dir = path.join(root(), id);
    if (!fs.existsSync(dir)) return { ok: false as const, error: 'No skill by that name.' };
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true as const };
  });

  /**
   * Copy a file the user already has into the skill's own folder.
   *
   * Copied rather than referenced, because a skill that points at
   * `~/Desktop/track.mp3` stops working the first time that file moves,
   * and it stops working silently at run time rather than loudly at
   * build time. A skill carries its material.
   */
  ipcMain.handle('userSkills:addAsset', (_e, p: { id: string; source: string; as?: string }) => {
    const id = safeId(p?.id);
    if (!id) return { ok: false as const, error: 'Not a skill id.' };
    const dir = path.join(root(), id);
    if (!fs.existsSync(dir)) return { ok: false as const, error: 'That skill does not exist yet.' };

    const source = p.source.replace(/^file:\/\//, '');
    if (!fs.existsSync(source)) return { ok: false as const, error: `No file at ${source}` };

    const name = path.basename(p.as || source).replace(/[^\w.-]/g, '_');
    const target = path.join(dir, 'assets', name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    return { ok: true as const, file: path.join('assets', name), bytes: fs.statSync(target).size };
  });
}
