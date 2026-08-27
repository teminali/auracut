/* ═══════════════════════════════════════════════════════════════════
   The catalogue.

   Only `published` rows are listed, and a row cannot be published
   without `verified_at` — §6: "If it does not run, it does not publish."
   That rule is enforced in `publishSkill`, not merely documented, so a
   skill nobody has watched execute cannot reach a buyer.

   `owned` is computed per request when a token is present. It is a
   CONVENIENCE for the UI; nothing is authorised by it. Download and
   licence issue both re-check the entitlement table.
   ═══════════════════════════════════════════════════════════════════ */

import type { Env } from '../lib/env';
import { json, fail, bearer } from '../lib/http';
import { userForToken, type SkillRow } from '../lib/db';

function publicSkill(s: SkillRow, owned: boolean) {
  return {
    id: s.id,
    name: s.name,
    summary: s.summary,
    description: s.description,
    author: s.author_name,
    majorVersion: s.major_version,
    latestVersion: s.latest_version,
    toolApi: s.tool_api,
    price: { amount: s.price_amount, currency: s.price_currency },
    free: s.price_amount === 0,
    posterUrl: s.poster_url,
    previewUrl: s.preview_url,
    verifiedAt: s.verified_at,
    verifiedBuild: s.verified_build,
    owned,
  };
}

export async function listSkills(req: Request, env: Env): Promise<Response> {
  const token = bearer(req);
  const user = token ? await userForToken(env, token) : null;

  const { results } = await env.DB.prepare(
    `SELECT * FROM skills WHERE status = 'published' ORDER BY updated_at DESC`
  ).all<SkillRow>();

  let owned = new Set<string>();
  if (user) {
    const ents = await env.DB.prepare(
      `SELECT skill_id, major_version FROM entitlements
        WHERE user_id = ? AND revoked_at IS NULL`
    ).bind(user.id).all<{ skill_id: string; major_version: number }>();
    owned = new Set(ents.results.map((e) => `${e.skill_id}@${e.major_version}`));
  }

  return json({
    skills: (results ?? []).map((s) => publicSkill(s, owned.has(`${s.id}@${s.major_version}`))),
    signedIn: Boolean(user),
  });
}

export async function getSkill(req: Request, env: Env, skillId: string): Promise<Response> {
  const token = bearer(req);
  const user = token ? await userForToken(env, token) : null;

  const skill = await env.DB.prepare(
    `SELECT * FROM skills WHERE id = ? AND status = 'published'`
  ).bind(skillId).first<SkillRow>();
  if (!skill) return fail(404, 'unknown_skill');

  let owned = false;
  if (user) {
    const ent = await env.DB.prepare(
      `SELECT id FROM entitlements
        WHERE user_id = ? AND skill_id = ? AND major_version = ? AND revoked_at IS NULL`
    ).bind(user.id, skill.id, skill.major_version).first();
    owned = Boolean(ent);
  }

  const versions = await env.DB.prepare(
    `SELECT version, size_bytes, sha256, tool_api, released_at
       FROM skill_versions WHERE skill_id = ? ORDER BY released_at DESC`
  ).bind(skillId).all();

  return json({ skill: publicSkill(skill, owned), versions: versions.results ?? [] });
}
