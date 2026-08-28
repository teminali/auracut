/* Typed rows and the few queries used from more than one route. */

import type { Env } from './env';

export interface UserRow {
  id: string; provider: string; provider_sub: string;
  email: string | null; name: string | null; avatar_url: string | null;
  msisdn: string | null; created_at: number; last_seen_at: number;
}

export interface SkillRow {
  id: string; name: string; summary: string; description: string | null;
  author_name: string; author_user_id: string | null;
  major_version: number; latest_version: string; tool_api: number;
  price_amount: number; price_currency: string;
  poster_url: string | null; preview_url: string | null;
  included: number;
  status: string; verified_at: number | null; verified_build: string | null;
  created_at: number; updated_at: number;
}

export interface OrderRow {
  id: string; user_id: string; skill_id: string; major_version: number;
  amount: number; currency: string; msisdn: string | null; provider: string | null;
  status: string; failure_reason: string | null;
  lipia_transaction_id: string | null; lipia_status: string | null; receipt: string | null;
  created_at: number; updated_at: number; reconcile_after: number;
}

export interface EntitlementRow {
  id: string; user_id: string; skill_id: string; major_version: number;
  order_id: string | null; source: string;
  granted_at: number; revoked_at: number | null; revoke_reason: string | null;
}

export const now = () => Date.now();

/**
 * Resolve a bearer token to its user, and touch the session.
 *
 * Returns null for absent, unknown AND expired — the caller gets one
 * "not signed in", because telling a caller that a token was once valid
 * is information it has no use for and an attacker does.
 */
export async function userForToken(env: Env, token: string): Promise<UserRow | null> {
  const hash = await import('./crypto').then((m) => m.sha256Hex(token));
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`
  ).bind(hash, now()).first<UserRow>();
  if (!row) return null;

  await env.DB.prepare('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?')
    .bind(now(), hash).run();
  return row;
}

/** The live entitlement for a skill's major version, or null. */
export async function entitlementFor(
  env: Env, userId: string, skillId: string, major: number
): Promise<EntitlementRow | null> {
  return env.DB.prepare(
    `SELECT * FROM entitlements
      WHERE user_id = ? AND skill_id = ? AND major_version = ? AND revoked_at IS NULL`
  ).bind(userId, skillId, major).first<EntitlementRow>();
}
