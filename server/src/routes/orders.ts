/* ═══════════════════════════════════════════════════════════════════
   Buying a skill.

   The shape of a mobile-money purchase is not a checkout page: Kerf
   asks for a phone number, Lipia pushes a PIN prompt to that handset,
   and the person confirms on their phone. So an order is created
   BEFORE anybody has paid, and it stays open until either the webhook
   lands or the reconcile sweep asks Lipia what happened.

   Two failure modes drove this design, and both are silent:

     · a webhook that never arrives leaves a buyer who paid with
       nothing. `reconcile_after` is why `GET /v1/orders/:id` asks the
       gateway directly once an order has been open too long.
     · a wrong or wrongly-formatted msisdn produces a push to nobody.
       That is indistinguishable, from the buyer's chair, from a broken
       app — so the number is normalised and the wallet is resolved
       before a charge is created, and an unknown prefix ASKS rather
       than guessing.
   ═══════════════════════════════════════════════════════════════════ */

import { requireEnv, type Env } from '../lib/env';
import { json, fail, bearer, readJson } from '../lib/http';
import { id } from '../lib/crypto';
import { now, userForToken, entitlementFor, type SkillRow, type OrderRow } from '../lib/db';
import * as lipia from '../lib/lipia';
import { markPaidAndGrant, markFailed } from '../lib/fulfil';
import { tooManyOrders } from '../lib/ratelimit';

/** How long an open order waits on the webhook before we go and ask. */
const RECONCILE_AFTER_MS = 45_000;

export async function createOrder(req: Request, env: Env): Promise<Response> {
  const token = bearer(req);
  if (!token) return fail(401, 'not_signed_in');
  const user = await userForToken(env, token);
  if (!user) return fail(401, 'not_signed_in');

  /* Every order is a real PIN prompt on a real handset. Somebody
     spamming this makes a stranger's phone buzz over and over, which is
     a worse outcome than a large table. */
  if (await tooManyOrders(env, user.id)) {
    return fail(429, 'too_many_orders',
      'Several payment attempts already started. Finish or cancel one before starting another.');
  }

  const body = await readJson<{ skillId?: string; msisdn?: string; provider?: string }>(req);
  if (!body?.skillId) return fail(400, 'missing_skill');
  if (!body.msisdn) return fail(400, 'missing_msisdn', 'A phone number is needed to send the payment prompt.');

  /* Checked before anything is written. A half-configured deployment
     that creates orders it can never charge leaves rows nobody can
     settle, and a buyer staring at a prompt that will never arrive. */
  const notConfigured = requireEnv(env, ['LIPIA_API_URL', 'LIPIA_PUBLIC_KEY', 'LIPIA_SECRET']);
  if (notConfigured) return fail(503, 'payments_not_configured', notConfigured);

  const skill = await env.DB.prepare(
    `SELECT * FROM skills WHERE id = ? AND status = 'published'`
  ).bind(body.skillId).first<SkillRow>();
  if (!skill) return fail(404, 'unknown_skill');
  if (skill.price_amount === 0) {
    return fail(400, 'skill_is_free', 'Claim it instead of paying for it.');
  }

  const already = await entitlementFor(env, user.id, skill.id, skill.major_version);
  if (already) {
    // Not an error the UI should dress as one — the person owns it, and
    // the right outcome is to install it, not to charge them twice.
    return json({ alreadyOwned: true, skillId: skill.id, majorVersion: skill.major_version }, 409);
  }

  const msisdn = lipia.normaliseMsisdn(body.msisdn);
  if (!msisdn) {
    return fail(400, 'bad_msisdn',
      'That does not look like a Tanzanian mobile number. Try 0712 345 678.');
  }

  const provider = (body.provider as lipia.LipiaProvider | undefined)
    ?? lipia.providerForMsisdn(msisdn);
  if (!provider) {
    return fail(400, 'unknown_provider',
      'We could not tell which mobile-money network that number is on. Pick one.');
  }

  const orderId = id('ord');
  const order: OrderRow = {
    id: orderId, user_id: user.id, skill_id: skill.id, major_version: skill.major_version,
    amount: skill.price_amount, currency: skill.price_currency,
    msisdn, provider, status: 'created', failure_reason: null,
    lipia_transaction_id: null, lipia_status: null, receipt: null,
    created_at: now(), updated_at: now(), reconcile_after: now() + RECONCILE_AFTER_MS,
  };

  await env.DB.prepare(
    `INSERT INTO orders (id, user_id, skill_id, major_version, amount, currency, msisdn,
                         provider, status, created_at, updated_at, reconcile_after)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?, ?)`
  ).bind(order.id, order.user_id, order.skill_id, order.major_version, order.amount,
         order.currency, order.msisdn, order.provider, order.created_at,
         order.updated_at, order.reconcile_after).run();

  // Remember the number for next time — it is the one field a repeat
  // buyer should never have to type twice.
  await env.DB.prepare('UPDATE users SET msisdn = ? WHERE id = ?').bind(msisdn, user.id).run();

  try {
    const res = await lipia.charge(env, {
      amount: order.amount,
      currency: order.currency as 'TZS',
      method: 'mobile_wallet',
      provider,
      customer_msisdn: msisdn,
      customer_email: user.email ?? undefined,
      customer_name: user.name ?? undefined,
      description: `Kerf skill — ${skill.name}`.slice(0, 256),
      external_id: order.id,
      /*
        Echoed back verbatim on the callback (this is how DukaBot's
        handler finds its subscription), so this is the join between a
        Lipia transaction and a Kerf order. `kind` is here because the
        same Lipia tenant may one day carry more than one product.
      */
      metadata: {
        kind: 'kerf_skill',
        order_id: order.id,
        skill_id: skill.id,
        user_id: user.id,
        major_version: skill.major_version,
      },
      // The order id is already unique per attempt, so a retried POST
      // cannot double-charge.
      idempotency_key: order.id,
    });

    if (!res.data) throw new lipia.LipiaError(res.error ?? 'no transaction returned', 502);

    await env.DB.prepare(
      `UPDATE orders SET status = 'charging', lipia_transaction_id = ?, lipia_status = ?,
                         updated_at = ? WHERE id = ?`
    ).bind(res.data.id, res.data.status, now(), order.id).run();

    return json({
      orderId: order.id,
      status: 'charging',
      amount: order.amount,
      currency: order.currency,
      msisdn,
      provider,
      /* The buyer is about to be interrupted by their own handset; the
         UI needs to say so rather than showing a spinner. */
      instruction: 'Check your phone for a payment prompt and enter your PIN.',
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'payment provider error';
    await env.DB.prepare(
      `UPDATE orders SET status = 'failed', failure_reason = ?, updated_at = ? WHERE id = ?`
    ).bind(reason, now(), order.id).run();
    return json({ orderId: order.id, status: 'failed', error: 'charge_failed', detail: reason }, 502);
  }
}

/* ── GET /v1/orders/:id ───────────────────────────────────────────
   What the client polls while the PIN prompt is on the handset. */

export async function getOrder(req: Request, env: Env, orderId: string): Promise<Response> {
  const token = bearer(req);
  if (!token) return fail(401, 'not_signed_in');
  const user = await userForToken(env, token);
  if (!user) return fail(401, 'not_signed_in');

  let order = await env.DB.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
    .bind(orderId, user.id).first<OrderRow>();
  if (!order) return fail(404, 'unknown_order');

  /*
    The safety net. Lipia retries a failed callback on a 1m/5m/30m/2h/12h
    ladder, and a buyer standing there having just entered their PIN is
    not going to wait for the second rung. Once an order has been open
    past `reconcile_after`, every poll asks the gateway directly, and the
    answer is fulfilled through exactly the same code the webhook uses.
  */
  if ((order.status === 'charging' || order.status === 'created')
      && order.lipia_transaction_id && now() > order.reconcile_after) {
    try {
      const { data: tx } = await lipia.getTransaction(env, order.lipia_transaction_id);
      if (tx.status === 'success') {
        await markPaidAndGrant(env, order, {
          amount: tx.amount, currency: tx.currency,
          receipt: null, lipiaStatus: tx.status,
        });
      } else if (tx.status === 'failed') {
        await markFailed(env, order, tx.failure_reason ?? 'payment failed', tx.status);
      }
      order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?')
        .bind(orderId).first<OrderRow>() as OrderRow;
    } catch {
      /* The gateway being unreachable is not the order failing. Leave it
         open and let the next poll — or the webhook — settle it. */
    }
  }

  return json({
    orderId: order.id,
    status: order.status,
    skillId: order.skill_id,
    majorVersion: order.major_version,
    amount: order.amount,
    currency: order.currency,
    receipt: order.receipt,
    failureReason: order.failure_reason,
    updatedAt: order.updated_at,
  });
}
