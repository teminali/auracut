/* ═══════════════════════════════════════════════════════════════════
   The sweep for orders nobody is watching.

   `GET /v1/orders/:id` already reconciles on demand, which covers the
   buyer standing there with their phone in their hand. It does NOT
   cover the person who approved the payment and then closed the laptop,
   or whose Kerf crashed, or who lost signal between the PIN and the
   confirmation — and for them a webhook that failed all five retries
   means money taken and nothing delivered.

   So this runs on a schedule and asks Lipia directly about every order
   still open past its reconcile window. It settles through exactly the
   same `markPaidAndGrant` the webhook uses, which is why a double
   settlement is a no-op rather than a second grant.
   ═══════════════════════════════════════════════════════════════════ */

import type { Env } from './env';
import { now, type OrderRow } from './db';
import * as lipia from './lipia';
import { markPaidAndGrant, markFailed } from './fulfil';

/**
 * After this long an open order is given up on.
 *
 * Selcom's push expires long before this. The generous window is not
 * about the handset — it is so a Lipia outage lasting hours does not
 * turn into a pile of orders wrongly marked expired, because "expired"
 * is a state a buyer reads as "you were not charged".
 */
const GIVE_UP_AFTER_MS = 6 * 60 * 60 * 1000;

/** Kept small: a sweep that takes longer than its interval overlaps itself. */
const BATCH = 25;

export interface SweepResult {
  examined: number;
  paid: number;
  failed: number;
  expired: number;
  unreachable: number;
}

export async function reconcileOpenOrders(env: Env): Promise<SweepResult> {
  const result: SweepResult = { examined: 0, paid: 0, failed: 0, expired: 0, unreachable: 0 };

  const { results } = await env.DB.prepare(
    `SELECT * FROM orders
      WHERE status IN ('created', 'charging') AND reconcile_after < ?
      ORDER BY created_at ASC LIMIT ?`
  ).bind(now(), BATCH).all<OrderRow>();

  for (const order of results ?? []) {
    result.examined++;

    if (now() - order.created_at > GIVE_UP_AFTER_MS) {
      await env.DB.prepare(
        `UPDATE orders SET status = 'expired', updated_at = ?,
                failure_reason = 'No confirmation arrived. If you were charged, contact support with this order id.'
          WHERE id = ? AND status != 'paid'`
      ).bind(now(), order.id).run();
      result.expired++;
      continue;
    }

    // An order that never reached Lipia has nothing to ask about.
    if (!order.lipia_transaction_id) continue;

    try {
      const { data: tx } = await lipia.getTransaction(env, order.lipia_transaction_id);
      if (tx.status === 'success') {
        const r = await markPaidAndGrant(env, order, {
          amount: tx.amount, currency: tx.currency, receipt: tx.id, lipiaStatus: tx.status,
        });
        if (r.granted) result.paid++;
      } else if (tx.status === 'failed') {
        await markFailed(env, order, tx.failure_reason ?? 'payment failed', tx.status);
        result.failed++;
      } else {
        /* Still pending at the gateway. Push the window out so the next
           sweep does not re-ask immediately, and leave it open. */
        await env.DB.prepare('UPDATE orders SET reconcile_after = ? WHERE id = ?')
          .bind(now() + 60_000, order.id).run();
      }
    } catch {
      /* Lipia unreachable. NOT the order failing — leave it exactly as
         it is and try again next time. Marking an order failed because
         we could not ask is how a paid customer loses their purchase. */
      result.unreachable++;
    }
  }

  return result;
}
