/* ═══════════════════════════════════════════════════════════════════
   Handing over the bytes.

   The entitlement is re-checked HERE. The catalogue's `owned` flag and
   the signed licence are both conveniences for the client; neither is
   what authorises a download, because both are things the client holds
   and this is the only place the answer is looked up fresh.

   The object is streamed rather than presigned. A presigned R2 URL is
   a bearer credential that outlives the check and can be forwarded, and
   at this volume the Worker streaming it costs nothing worth having.
   ═══════════════════════════════════════════════════════════════════ */

import type { Env } from '../lib/env';
import { fail, bearer, cors } from '../lib/http';
import { userForToken, entitlementFor, type SkillRow } from '../lib/db';

export async function downloadSkill(req: Request, env: Env, skillId: string): Promise<Response> {
  const token = bearer(req);
  if (!token) return fail(401, 'not_signed_in');
  const user = await userForToken(env, token);
  if (!user) return fail(401, 'not_signed_in');

  const skill = await env.DB.prepare(
    `SELECT * FROM skills WHERE id = ? AND status = 'published'`
  ).bind(skillId).first<SkillRow>();
  if (!skill) return fail(404, 'unknown_skill');

  const ent = await entitlementFor(env, user.id, skill.id, skill.major_version);
  if (!ent) return fail(403, 'not_entitled', 'This account does not own that skill.');

  const version = new URL(req.url).searchParams.get('version') ?? skill.latest_version;
  const row = await env.DB.prepare(
    'SELECT r2_key, sha256, size_bytes FROM skill_versions WHERE skill_id = ? AND version = ?'
  ).bind(skillId, version).first<{ r2_key: string; sha256: string; size_bytes: number }>();
  if (!row) return fail(404, 'unknown_version');

  if (!env.SKILLS) {
    // The entitlement is real and stays real; only the bytes are absent.
    // Saying so plainly beats a 500 that looks like a lost purchase.
    return fail(503, 'storage_not_configured',
      'Package storage is not set up on this deployment yet. Your purchase is safe.');
  }

  const object = await env.SKILLS.get(row.r2_key);
  if (!object) {
    // The catalogue row exists and the file does not. Say so plainly:
    // a 404 here would send the client hunting for a version problem.
    return fail(500, 'package_missing', `Catalogued at ${row.r2_key}, but no object is stored there.`);
  }

  return new Response(object.body, {
    headers: {
      ...cors(),
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${skillId}-${version}.kerfskill"`,
      'content-length': String(row.size_bytes),
      // The client verifies this before unpacking. A truncated download
      // that unpacks anyway is a skill that half-works for ever.
      'x-kerf-sha256': row.sha256,
      'x-kerf-version': version,
    },
  });
}
