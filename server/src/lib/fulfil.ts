/* ═══════════════════════════════════════════════════════════════════
   Turning a paid order into an entitlement.

   Two different things call this — the webhook Lipia sends, and the
   reconcile sweep that runs when a webhook never arrived — so it has to
   be safe to run twice on the same order. It is written to be idempotent
   rather than guarded by its callers, because "the callers are careful"
   is not a property you can check and `ON CONFLICT DO NOTHING` is.

   The amount is re-checked against the order here and not trusted from
   the callback. Lipia is ours and its signature is verified, but an
   entitlement granted for an amount nobody compared is the kind of hole
   that is only ever found by reading the ledger months later.
   ═══════════════════════════════════════════════════════════════════ */

import type { Env } from './env';
import { id } from './crypto';
import { now, type OrderRow } from './db';

export interface FulfilResult {
  ok: boolean;
  granted: boolean;
  note: string;
}

export async function markPaidAndGrant(
  env: Env,
  order: OrderRow,
  paid: { amount: number; currency: string; receipt: string | null; lipiaStatus: string }
): Promise<FulfilResult> {
  if (order.status === 'paid') {
    return { ok: true, granted: false, note: 'order was already paid — duplicate delivery' };
  }

  /*
    Underpayment is not a rounding problem to be waved through. If the
    gateway reports less than the order was for, the order is left open
    and flagged rather than fulfilled: a human decides, and meanwhile
    nobody has been given something they did not pay for.
  */
  if (paid.amount < order.amount || paid.currency !== order.currency) {
    await env.DB.prepare(
      `UPDATE orders SET status = 'failed', failure_reason = ?, lipia_status = ?, updated_at = ?
        WHERE id = ?`
    ).bind(
      `amount mismatch: paid ${paid.amount} ${paid.currency}, order was ${order.amount} ${order.currency}`,
      paid.lipiaStatus, now(), order.id
    ).run();
    return { ok: false, granted: false, note: 'amount or currency did not match the order' };
  }

  const entId = id('ent');

  /*
    One batch, so an order cannot be marked paid without the entitlement
    landing beside it. D1 runs a batch as a single transaction; the
    UNIQUE (user, skill, major) plus ON CONFLICT is what makes a repeat
    delivery a no-op instead of a second grant.
  */
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO entitlements
         (id, user_id, skill_id, major_version, order_id, source, granted_at)
       VALUES (?, ?, ?, ?, ?, 'purchase', ?)
       ON CONFLICT (user_id, skill_id, major_version) DO UPDATE
         SET revoked_at = NULL, revoke_reason = NULL, order_id = excluded.order_id`
    ).bind(entId, order.user_id, order.skill_id, order.major_version, order.id, now()),
    env.DB.prepare(
      `UPDATE orders SET status = 'paid', receipt = ?, lipia_status = ?, updated_at = ?
        WHERE id = ?`
    ).bind(paid.receipt, paid.lipiaStatus, now(), order.id),
  ]);

  return { ok: true, granted: true, note: 'entitlement granted' };
}

export async function markFailed(
  env: Env, order: OrderRow, reason: string, lipiaStatus: string
): Promise<void> {
  // A terminal state is terminal: a late `failed` must not undo a
  // `paid` that already landed from a different delivery.
  if (order.status === 'paid') return;
  await env.DB.prepare(
    `UPDATE orders SET status = 'failed', failure_reason = ?, lipia_status = ?, updated_at = ?
      WHERE id = ? AND status != 'paid'`
  ).bind(reason, lipiaStatus, now(), order.id).run();
}

export async function revokeForRefund(env: Env, order: OrderRow, reason: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE entitlements SET revoked_at = ?, revoke_reason = ?
        WHERE order_id = ? AND revoked_at IS NULL`
    ).bind(now(), reason, order.id),
    env.DB.prepare(
      `UPDATE orders SET status = 'refunded', lipia_status = 'refunded', updated_at = ? WHERE id = ?`
    ).bind(now(), order.id),
  ]);
}
