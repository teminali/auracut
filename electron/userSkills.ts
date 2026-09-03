/* ═══════════════════════════════════════════════════════════════════
   Skills the user made, as opposed to the ones TeminaliCut ships.

   ── Why this exists at all ─────────────────────────────────────────

   `src/services/bundledSkills.ts` reads every `skills/<id>/skill.json`
   through `import.meta.glob`, which inlines them into the bundle at
   BUILD time. That is the right call for the skills that ship inside
   TeminaliCut — `files:` in electron-builder.yml carries `dist`, `dist-electron`
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

   It does not run anything. There is no skill runner in TeminaliCut yet — the
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
  slots: {
    id: string; kind: string; required?: boolean; default?: unknown;
    options?: string[]; description?: string;
    /**
     * Another slot this one is meaningless without.
     *
     * Added because the same gap turned up three times in one manifest:
     * with `captions` off, `language` does nothing, `cleanCaptions` does
     * nothing, and the camera stops opening on an introduction. Before
     * this a caller could set all three and have nothing tell them why
     * none of them took effect.
     *
     * It is a DEPENDENCY and not a constraint. A dependent slot whose
     * parent is off is inert, not an error: refusing the combination
     * would break anybody who sets a language once and toggles captions
     * per take.
     */
    requiresSlot?: string;
  }[];
  requiresTools: string[];
  recipe: { tool: string; args: Record<string, unknown> }[];
  assets: {
    id?: string; file?: string; kind?: string;
    /** Hand-authored bundled manifests use path/role for the same facts. */
    path?: string; role?: string; description?: string;
  }[];
  provenance?: { author?: string; builtWith?: string; builtAt?: string; verifiedOn?: string };
  /** Free text the agent reads before running it. */
  guide?: string;

  /*
    ── The fields the builder used to throw away ────────────────────

    Found by feeding this validator the hand-written `skills/tutorial`
    manifest, which is the one skill in the repo somebody got right
    before any of this existed. It came back accepted, with four of its
    twelve fields silently gone and `success: true` on the result. Both
    shipped skills use all four; between them they use five this could
    not express.

    Dropping `trial` is the worst of them, because it is not a
    decoration: it is the whole publishing story. A skill built by the
    builder could never be sold or trial-gated, and nothing said so.
  */

  /** Manifest compatibility version. */
  toolApi?: number;
  /**
   * What the publisher allows before the skill is bought. 0 means not
   * gated, and is deliberately different from the field being absent.
   */
  trial?: { uses: number };
  /**
   * The verification test, relative to the skill folder.
   *
   * HANDOVER §6's definition of a skill is tools plus assets plus a
   * template plus a verification test. This is the fourth part and the
   * reason to believe the other three, so a builder that could not
   * write it down was building three-quarters of a skill and calling it
   * finished. Reported as missing by `listUserSkills` when the file is
   * not there, exactly as a declared asset is.
   */
  verify?: string;
  /**
   * A project the recipe opens first, relative to the skill folder.
   *
   * beat-montage's safety net: a fumbled run still leaves something
   * real on the timeline. Not every skill can have one (the Tutorial
   * skill's canvas is not knowable before the take is read), which is
   * why it is optional and not required.
   */
  template?: string;
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

/** A declared file must stay inside its own skill folder. */
function safeRelativeFile(file: unknown): file is string {
  if (typeof file !== 'string' || !file || path.isAbsolute(file) || file.includes('\0')) return false;
  const normal = path.normalize(file);
  return normal !== '..' && !normal.startsWith(`..${path.sep}`);
}

/**
 * The slot kinds a manifest may use.
 *
 * A closed list for the same reason an enum slot must carry `options`:
 * a vocabulary that is documented and not enforced is a free text field
 * that fails on the fifth character. `kind: "bolean"` used to be
 * accepted, written to disk and reported as a created skill.
 */
const KINDS = new Set(['folder', 'file', 'string', 'text', 'number', 'boolean', 'colour', 'color', 'enum']);

/** Every `{slot:id}` anywhere in a step's args, however deeply nested. */
function slotRefs(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\{slot:([^}]+)\}/g)) into.add(match[1].trim());
  } else if (Array.isArray(value)) {
    for (const item of value) slotRefs(item, into);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) slotRefs(item, into);
  }
}

/**
 * Everything a manifest must have before it is worth storing.
 *
 * ── What this refuses, and why the list grew ──────────────────────
 *
 * It used to refuse exactly two things: a skill with no slots, and an
 * enum slot with no options. Both are right and both are about the
 * AUTHOR'S judgement. Everything added below is mechanical instead:
 * facts the app already has and was not checking, found by feeding the
 * builder eight manifests that are each obviously broken and watching
 * it accept all eight and report success. A recipe referring to
 * `{slot:nope}` is not a matter of taste. It cannot work, the app can
 * see that it cannot work, and letting it through produces a skill that
 * fails at run time in front of whoever bought it.
 *
 * `knownTools` is passed by the renderer because the tool registry
 * lives there. When it is absent the tool-name checks are skipped
 * rather than guessed at, so an older caller loses a check instead of
 * being refused for tools this side cannot see.
 */
export function validateManifest(raw: unknown, knownTools?: string[]): { ok: true; manifest: UserSkillManifest; warnings: string[] } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
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
  const seenIds = new Set<string>();
  for (const [i, slot] of slots.entries()) {
    if (!slot || typeof slot.id !== 'string' || !slot.id) problems.push(`slots[${i}] has no id.`);
    if (!slot || typeof slot.kind !== 'string' || !slot.kind) problems.push(`slots[${i}] has no kind.`);
    if (slot?.kind === 'enum' && !Array.isArray(slot.options)) {
      problems.push(`slots[${i}] is an enum with no options list, so it is a free text field that fails on the fifth character somebody types.`);
    }
    if (!slot?.description) problems.push(`slots[${i}] has no description; the person filling it in has nothing to go on.`);

    if (slot?.kind && !KINDS.has(slot.kind)) {
      problems.push(
        `slots[${i}] has kind "${slot.kind}", which is not one of ${[...KINDS].join(', ')}. `
        + 'A kind nothing recognises means the person filling this in gets no control and no '
        + 'validation, which is the same failure an enum without options has.'
      );
    }
    if (slot?.id) {
      if (seenIds.has(slot.id)) {
        problems.push(`Two slots are both called "${slot.id}", so {slot:${slot.id}} cannot say which one it means.`);
      }
      seenIds.add(slot.id);
    }
    /* An enum whose default is not on its own list: the one value
       guaranteed to be used is the one value guaranteed to be invalid. */
    if (slot?.kind === 'enum' && Array.isArray(slot.options)
      && slot.default !== undefined && !slot.options.includes(slot.default as string)) {
      problems.push(
        `slots[${i}] ("${slot.id}") defaults to ${JSON.stringify(slot.default)}, which is not one `
        + `of its options (${slot.options.join(', ')}).`
      );
    }
  }

  for (const [i, slot] of slots.entries()) {
    const needs = slot?.requiresSlot;
    if (needs === undefined) continue;
    if (typeof needs !== 'string' || !seenIds.has(needs)) {
      problems.push(`slots[${i}] ("${slot.id}") requires a slot called "${needs}", and there is no such slot.`);
    } else if (needs === slot.id) {
      problems.push(`slots[${i}] ("${slot.id}") requires itself.`);
    }
  }

  const recipe = Array.isArray(m.recipe) ? m.recipe : [];
  if (recipe.length === 0) problems.push('`recipe` is empty, so the skill does nothing.');

  const referenced = new Set<string>();
  for (const [i, step] of recipe.entries()) {
    if (!step || typeof step.tool !== 'string' || !step.tool) {
      problems.push(`recipe[${i}] names no tool.`);
      continue;
    }
    if (knownTools && knownTools.length > 0 && !knownTools.includes(step.tool)) {
      problems.push(`recipe[${i}] calls \`${step.tool}\`, which is not a tool this build has.`);
    }
    slotRefs(step.args, referenced);
  }
  /* The guide is prose an agent carries out, so a slot named only there
     is still being used. Counted, so that a skill whose steps are
     described rather than fully parameterised is not refused. */
  if (typeof m.guide === 'string') slotRefs(m.guide, referenced);

  for (const missing of [...referenced].filter((r) => !seenIds.has(r))) {
    problems.push(
      `The recipe refers to {slot:${missing}} and there is no slot called "${missing}". `
      + 'That step cannot run.'
    );
  }
  /*
    A slot nothing reads. Warned about rather than refused, and the
    difference is the runner.

    The whole claim of a skill is that its slots are the inputs that
    must change for it to build something else, so a slot no step
    mentions is usually a rename that only got done on one side. But
    `recipe` is a SPECIFICATION an agent carries out, not something the
    app executes, and an agent can perfectly well act on a slot that the
    guide describes in prose without ever writing `{slot:id}`. Refusing
    would reject manifests that work. So it is said, loudly, and the
    author decides.
  */
  for (const orphan of [...seenIds].filter((id) => !referenced.has(id))) {
    warnings.push(
      `Slot "${orphan}" is never referenced: no recipe step and no guide mentions `
      + `{slot:${orphan}}. If an agent is meant to use it, say where; otherwise it is a `
      + 'question asked of the user that changes nothing.'
    );
  }

  if (knownTools && knownTools.length > 0) {
    for (const tool of Array.isArray(m.requiresTools) ? m.requiresTools : []) {
      if (!knownTools.includes(tool)) {
        problems.push(`\`requiresTools\` names \`${tool}\`, which is not a tool this build has.`);
      }
    }
  }

  const assets = Array.isArray(m.assets) ? m.assets : [];
  for (const [i, asset] of assets.entries()) {
    const file = asset?.file ?? asset?.path;
    if (!safeRelativeFile(file)) {
      problems.push(`assets[${i}] needs a relative file or path inside the skill folder.`);
    }
  }
  for (const [label, file] of [['verify', m.verify], ['template', m.template]] as const) {
    if (file !== undefined && !safeRelativeFile(file)) {
      problems.push(`\`${label}\` must be a relative path inside the skill folder.`);
    }
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
      assets,
      provenance: m.provenance,
      guide: typeof m.guide === 'string' ? m.guide : undefined,
      ...(typeof m.toolApi === 'number' ? { toolApi: m.toolApi } : {}),
      ...(m.trial && typeof m.trial.uses === 'number' ? { trial: { uses: m.trial.uses } } : {}),
      ...(typeof m.verify === 'string' && m.verify ? { verify: m.verify } : {}),
      ...(typeof m.template === 'string' && m.template ? { template: m.template } : {}),
    },
    warnings,
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
        const file = asset.file ?? asset.path;
        if (!safeRelativeFile(file)) continue;
        (fs.existsSync(path.join(dir, file)) ? present : missing).push(file);
      }
      /* `verify` and `template` are declared the same way an asset is
         and were not being checked the same way, so a manifest could
         claim a verification test that had never been written. */
      for (const declared of [parsed.verify, parsed.template]) {
        if (!safeRelativeFile(declared)) continue;
        (fs.existsSync(path.join(dir, declared)) ? present : missing).push(declared);
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

  ipcMain.handle('userSkills:write', (_e, raw: unknown, knownTools?: string[]) => {
    const checked = validateManifest(raw, knownTools);
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
    return { ok: true as const, dir, manifest: checked.manifest, warnings: checked.warnings };
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
