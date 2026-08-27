/* ═══════════════════════════════════════════════════════════════════
   Rate limits on the two endpoints that cost us something.

   Counting rows in D1 rather than reaching for a counter store: both
   limits are per ten minutes at single-digit thresholds, the tables are
   indexed for exactly this query, and adding KV or a Durable Object to
   the money path buys precision nobody needs and a dependency somebody
   has to reason about at 2am.

   It is a FLOOR, not a firewall. A distributed abuser rotating IPs gets
   through, and that is fine — the job here is to stop one broken client
   or one bored person from burning the OAuth quota or filling the orders
   table, not to survive a determined attack.
   ═══════════════════════════════════════════════════════════════════ */

import type { Env } from './env';

const WINDOW_MS = 10 * 60 * 1000;

/** Each start costs a round trip to Google or GitHub against OUR quota. */
const MAX_DEVICE_STARTS = 10;

/**
 * Each order is a real STK push to a real handset. Somebody spamming
 * this makes a stranger's phone buzz repeatedly, which is a worse
 * outcome than a full table.
 */
const MAX_ORDERS = 5;

export function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip')
    ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ?? 'unknown';
}

export async function tooManyDeviceStarts(env: Env, ip: string): Promise<boolean> {
  // 'unknown' means the header was absent — `wrangler dev` locally, or a
  // misconfigured proxy. Lumping every such caller into one bucket would
  // rate-limit local development into uselessness.
  if (ip === 'unknown') return false;

  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM device_auths WHERE created_ip = ? AND created_at > ?'
  ).bind(ip, Date.now() - WINDOW_MS).first<{ n: number }>();
  return (row?.n ?? 0) >= MAX_DEVICE_STARTS;
}

export async function tooManyOrders(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND created_at > ?'
  ).bind(userId, Date.now() - WINDOW_MS).first<{ n: number }>();
  return (row?.n ?? 0) >= MAX_ORDERS;
}
