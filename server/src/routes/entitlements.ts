/* ═══════════════════════════════════════════════════════════════════
   What somebody owns, and the signed proof they can take offline.

   A licence is an ECDSA-signed statement that this user owns this
   skill's major version, valid for 30 days. Kerf verifies it with a
   public key compiled into the app, so a bought skill opens on a
   laptop with no connection — which is not a nicety in the market this
   is being built for.

   The expiry IS the revocation mechanism. A signed token cannot be
   recalled, so it is made short and simply not reissued once the
   entitlement is revoked. A refund therefore stops working within the
   grace window rather than instantly, and that is the deliberate trade:
   the alternative is a skill that dies the moment the wifi does.
   ═══════════════════════════════════════════════════════════════════ */

import type { Env } from '../lib/env';
import { json, fail, bearer } from '../lib/http';
import { id, signLicence } from '../lib/crypto';
import { now, userForToken, entitlementFor, type SkillRow, type EntitlementRow } from '../lib/db';

const LICENCE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function licenceFor(env: Env, ent: EntitlementRow): Promise<string | null> {
  if (!env.LICENCE_SIGNING_JWK) return null;
  return signLicence(JSON.parse(env.LICENCE_SIGNING_JWK) as JsonWebKey, {
    sub: ent.user_id,
    skill: ent.skill_id,
    ver: ent.major_version,
    jti: ent.id,
    iat: now(),
    exp: now() + LICENCE_TTL_MS,
  });
}

export async function listEntitlements(req: Request, env: Env): Promise<Response> {
  const token = bearer(req);
  if (!token) return fail(401, 'not_signed_in');
  const user = await userForToken(env, token);
  if (!user) return fail(401, 'not_signed_in');

  const { results } = await env.DB.prepare(
    `SELECT * FROM entitlements WHERE user_id = ? AND revoked_at IS NULL ORDER BY granted_at DESC`
  ).bind(user.id).all<EntitlementRow>();

  const entitlements = await Promise.all(
    (results ?? []).map(async (e) => ({
      skillId: e.skill_id,
      majorVersion: e.major_version,
      source: e.source,
      grantedAt: e.granted_at,
      licence: await licenceFor(env, e),
    }))
  );

  return json({ entitlements });
}

/**
 * Claim a free skill.
 *
 * Free means free: no card, no phone number, no order row that has to
 * be reconciled later. It is also the path that makes the whole store
 * end-to-end testable without moving money, which is why it exists as
 * a first-class route rather than a price of zero flowing through the
 * payment code.
 */
export async function claimFree(req: Request, env: Env, skillId: string): Promise<Response> {
  const token = bearer(req);
  if (!token) return fail(401, 'not_signed_in');
  const user = await userForToken(env, token);
  if (!user) return fail(401, 'not_signed_in');

  const skill = await env.DB.prepare(
    `SELECT * FROM skills WHERE id = ? AND status = 'published'`
  ).bind(skillId).first<SkillRow>();
  if (!skill) return fail(404, 'unknown_skill');
  if (skill.price_amount !== 0) {
    return fail(402, 'not_free', 'This skill has a price. Create an order instead.');
  }

  const existing = await entitlementFor(env, user.id, skill.id, skill.major_version);
  if (existing) {
    return json({ entitlement: { skillId, majorVersion: skill.major_version },
                  licence: await licenceFor(env, existing), alreadyOwned: true });
  }

  const ent: EntitlementRow = {
    id: id('ent'), user_id: user.id, skill_id: skill.id,
    major_version: skill.major_version, order_id: null, source: 'free',
    granted_at: now(), revoked_at: null, revoke_reason: null,
  };
  await env.DB.prepare(
    `INSERT INTO entitlements (id, user_id, skill_id, major_version, order_id, source, granted_at)
     VALUES (?, ?, ?, ?, NULL, 'free', ?)`
  ).bind(ent.id, ent.user_id, ent.skill_id, ent.major_version, ent.granted_at).run();

  return json({
    entitlement: { skillId, majorVersion: skill.major_version },
    licence: await licenceFor(env, ent),
    alreadyOwned: false,
  });
}
