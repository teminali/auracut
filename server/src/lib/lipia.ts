/* ═══════════════════════════════════════════════════════════════════
   The Lipia gateway (pay.mhasibudigital.com).

   Kerf is a tenant of Lipia the same way DukaBot and M-Digital are.
   Lipia wraps Selcom, holds the merchant credentials and the static-IP
   proxy Selcom's whitelisting requires, and hands back one clean REST
   surface — so this file knows about Lipia and nothing at all about
   Selcom, HMAC order signing, or IP allowlists.

   Written against the live route handlers rather than the docs page:
   `lipia/src/lib/validations/charge.ts` is the request schema, and
   `lipia/src/lib/webhook-dispatcher.ts` is the callback shape.
   ═══════════════════════════════════════════════════════════════════ */

import type { Env } from './env';

/** Selcom wallet names, as Lipia passes them through. */
export type LipiaProvider = 'vodacom' | 'tigo' | 'airtel' | 'halopesa';

export interface ChargeRequest {
  amount: number;                 // positive INTEGER, minor units of `currency`
  currency: 'TZS' | 'KES' | 'UGX' | 'USD';
  method: 'mobile_wallet' | 'card';
  provider?: string;              // required when method is mobile_wallet
  customer_msisdn?: string;       // required when method is mobile_wallet
  customer_email?: string;
  customer_name?: string;
  description?: string;
  external_id?: string;
  metadata?: Record<string, unknown>;
  idempotency_key?: string;
}

export interface ChargeResponse {
  data: {
    id: string;
    status: 'processing' | 'pending' | 'failed';
    selcom_order_id: string;
    payment_url: string | null;
    idempotent?: boolean;
  } | null;
  error: string | null;
}

export interface LipiaTransaction {
  id: string;
  external_id: string | null;
  amount: number;
  currency: string;
  status: string;                 // pending|processing|success|failed|refunded
  provider: string | null;
  customer_msisdn: string | null;
  metadata: Record<string, unknown>;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export class LipiaError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'LipiaError';
  }
}

async function request<T>(
  env: Env, method: 'GET' | 'POST', path: string, body?: unknown
): Promise<T> {
  const res = await fetch(`${env.LIPIA_API_URL}${path}`, {
    method,
    headers: {
      // Lipia's own scheme: the pair, colon-joined, inside one Bearer.
      authorization: `Bearer ${env.LIPIA_PUBLIC_KEY}:${env.LIPIA_SECRET}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });

  const parsed = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    throw new LipiaError(parsed?.error ?? `Lipia returned ${res.status}`, res.status);
  }
  return parsed as T;
}

export const charge = (env: Env, params: ChargeRequest) =>
  request<ChargeResponse>(env, 'POST', '/api/v1/charge', params);

export const getTransaction = (env: Env, id: string) =>
  request<{ data: LipiaTransaction; error: null }>(env, 'GET', `/api/v1/transactions/${id}`);

/* ── msisdn ────────────────────────────────────────────────────────
   Lipia's own examples are E.164 without the plus: `255769445221`.
   Buyers type all four of `0769…`, `+255769…`, `255769…` and
   `0769 445 221`, and a number in the wrong shape does not fail loudly
   — it produces a push to nobody, which reads to the buyer as "the app
   is broken" and to us as an order that never completes. */
export function normaliseMsisdn(raw: string, countryCode = '255'): string | null {
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return null;

  let msisdn: string;
  if (digits.startsWith(countryCode) && digits.length === countryCode.length + 9) {
    msisdn = digits;
  } else if (digits.startsWith('0') && digits.length === 10) {
    msisdn = countryCode + digits.slice(1);
  } else if (digits.length === 9) {
    msisdn = countryCode + digits;
  } else {
    return null;
  }
  return msisdn.length === countryCode.length + 9 ? msisdn : null;
}

/**
 * Which wallet a Tanzanian number belongs to.
 *
 * Returns null rather than guessing when the prefix is unknown — the
 * caller then ASKS. A wrong provider sends the push to the wrong
 * network and the buyer sees nothing at all, which is worse than one
 * extra tap, and prefix tables go stale as ranges are reassigned.
 */
export function providerForMsisdn(msisdn: string): LipiaProvider | null {
  const local = msisdn.startsWith('255') ? msisdn.slice(3) : msisdn;
  const p = local.slice(0, 2);
  if (['74', '75', '76'].includes(p)) return 'vodacom';
  if (['65', '67', '71', '77'].includes(p)) return 'tigo';
  if (['68', '69', '78'].includes(p)) return 'airtel';
  if (['62', '61'].includes(p)) return 'halopesa';
  return null;
}
