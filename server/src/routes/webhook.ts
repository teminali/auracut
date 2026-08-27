/* ═══════════════════════════════════════════════════════════════════
   Lipia's callback. This is the moment a purchase becomes real.

   Order of operations matters and is not negotiable:

     1. read the RAW body as text
     2. verify the HMAC over those exact bytes, in constant time
     3. log the delivery — verified or not
     4. only then parse it

   Parsing before verifying is already trusting the payload, and the log
   is written even for a failed signature because "somebody is posting
   forged callbacks at us" is something you want to be able to see.

   Deliveries repeat. Lipia retries on 1m/5m/30m/2h/12h, and the
   reconcile sweep in `orders.ts` can settle the same order from the
   other direction, so everything below is idempotent by construction
   rather than by luck.
   ═══════════════════════════════════════════════════════════════════ */

import type { Env } from '../lib/env';
import { json, fail } from '../lib/http';
import { hmacSha256Hex, timingSafeEqual, id } from '../lib/crypto';
import { now, type OrderRow } from '../lib/db';
import { markPaidAndGrant, markFailed, revokeForRefund } from '../lib/fulfil';

interface LipiaWebhook {
  event: string;
  timestamp: string;
  data: {
    id: string;
    external_id: string | null;
    amount: number;
    currency: string;
    method: string;
    provider: string | null;
    status: string;
    customer_msisdn: string | null;
    customer_email: string | null;
    customer_name: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at?: string;
  };
}

export async function lipiaWebhook(req: Request, env: Env): Promise<Response> {
  const raw = await req.text();
  const signature = req.headers.get('x-lipia-signature');
  const event = req.headers.get('x-lipia-event');

  if (!env.LIPIA_WEBHOOK_SECRET) {
    return fail(500, 'webhook_not_configured');
  }

  const expected = await hmacSha256Hex(env.LIPIA_WEBHOOK_SECRET, raw);
  const signatureOk = Boolean(signature) && timingSafeEqual(signature!, expected);

  const eventId = id('whk');
  const log = (orderId: string | null, handled: boolean, note: string) =>
    env.DB.prepare(
      `INSERT INTO webhook_events (id, received_at, event, signature_ok, order_id, body, handled, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(eventId, now(), event, signatureOk ? 1 : 0, orderId, raw.slice(0, 8000),
           handled ? 1 : 0, note).run();

  if (!signatureOk) {
    await log(null, false, 'signature did not verify — payload ignored');
    return fail(401, 'bad_signature');
  }

  let payload: LipiaWebhook;
  try {
    payload = JSON.parse(raw) as LipiaWebhook;
  } catch {
    await log(null, false, 'signed but not JSON');
    return fail(400, 'bad_payload');
  }

  const meta = payload.data?.metadata ?? {};
  const orderId = (meta.order_id as string | undefined) ?? payload.data?.external_id ?? null;

  /*
    Lipia is multi-tenant and this endpoint may receive events for
    products that are not Kerf. An unknown order is acknowledged with
    200, never retried at us, and recorded — a 4xx here would put Lipia
    into a twelve-hour retry ladder over something we will never handle.
  */
  if (!orderId) {
    await log(null, true, 'no order_id in metadata — not a Kerf purchase');
    return json({ received: true });
  }

  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?')
    .bind(orderId).first<OrderRow>();
  if (!order) {
    await log(orderId, true, 'no such Kerf order — acknowledged and ignored');
    return json({ received: true });
  }

  switch (payload.event) {
    case 'payment.completed': {
      const result = await markPaidAndGrant(env, order, {
        amount: payload.data.amount,
        currency: payload.data.currency,
        receipt: (meta.receipt as string | undefined) ?? payload.data.id,
        lipiaStatus: payload.data.status,
      });
      await log(orderId, result.ok, result.note);
      // Even a rejected fulfilment is ACKED: retrying an amount mismatch
      // five more times will not make the amount match.
      return json({ received: true, granted: result.granted });
    }

    case 'payment.failed': {
      await markFailed(env, order, 'The payment was declined, cancelled or timed out.',
                       payload.data.status);
      await log(orderId, true, 'order marked failed');
      return json({ received: true });
    }

    case 'payment.refunded':
    case 'payment.partially_refunded': {
      /*
        A refund revokes. It does not kill an already-issued licence —
        those are signed and cannot be recalled — but it stops the next
        one being minted, so access ends within the licence window. That
        trade is stated in `entitlements.ts` and it is the price of the
        skill still opening on a laptop with no internet.
      */
      await revokeForRefund(env, order, `refunded via ${payload.event}`);
      await log(orderId, true, 'entitlement revoked on refund');
      return json({ received: true });
    }

    default:
      await log(orderId, true, `event ${payload.event} needs no action`);
      return json({ received: true });
  }
}
