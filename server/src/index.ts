/* ═══════════════════════════════════════════════════════════════════
   Kerf Store — the whole API surface.

   Hand-rolled routing, on purpose. This is the money path, and being
   able to read every request from entry to response without stepping
   through a framework's middleware chain is worth more here than the
   forty lines a router would save. It is also one less dependency on
   the code that grants entitlements.

       POST   /v1/auth/device/start
       POST   /v1/auth/device/poll
       GET    /v1/me
       POST   /v1/auth/signout

       GET    /v1/skills
       GET    /v1/skills/:id
       GET    /v1/skills/:id/manifest?version=
       GET    /v1/skills/:id/download?version=
       POST   /v1/skills/:id/claim          free skills only

       POST   /v1/orders
       GET    /v1/orders/:id

       GET    /v1/entitlements
       POST   /webhooks/lipia
       GET    /health
   ═══════════════════════════════════════════════════════════════════ */

import type { Env } from './lib/env';
import { json, fail, cors } from './lib/http';
import { deviceStart, devicePoll, me, signOut } from './routes/auth';
import { listSkills, getSkill, getSkillManifest } from './routes/catalogue';
import { listEntitlements, claimFree } from './routes/entitlements';
import { createOrder, getOrder } from './routes/orders';
import { downloadSkill } from './routes/download';
import { lipiaWebhook } from './routes/webhook';
import { reconcileOpenOrders } from './lib/reconcile';

export default {
  /**
   * The sweep for orders nobody is watching.
   *
   * `GET /v1/orders/:id` reconciles for the buyer who is standing there;
   * this is for the one who approved the payment and closed the laptop.
   * Both settle through the same `markPaidAndGrant`, so the two running
   * at once cannot double-grant.
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      reconcileOpenOrders(env).then((r) => {
        // Read with `wrangler tail`. A sweep that quietly does nothing
        // for a week looks exactly like a sweep that had nothing to do.
        console.log('reconcile', JSON.stringify(r));
      })
    );
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method;
    const seg = path.split('/').filter(Boolean);

    try {
      if (path === '/health') return json({ ok: true, service: 'kerf-store' });

      /* ── auth ── */
      if (method === 'POST' && path === '/v1/auth/device/start') return deviceStart(req, env);
      if (method === 'POST' && path === '/v1/auth/device/poll') return devicePoll(req, env);
      if (method === 'GET' && path === '/v1/me') return me(req, env);
      if (method === 'POST' && path === '/v1/auth/signout') return signOut(req, env);

      /* ── catalogue ── */
      if (method === 'GET' && path === '/v1/skills') return listSkills(req, env);
      if (seg[0] === 'v1' && seg[1] === 'skills' && seg[2]) {
        if (method === 'GET' && seg.length === 3) return getSkill(req, env, seg[2]);
        if (method === 'GET' && seg[3] === 'manifest') return getSkillManifest(req, env, seg[2]);
        if (method === 'GET' && seg[3] === 'download') return downloadSkill(req, env, seg[2]);
        if (method === 'POST' && seg[3] === 'claim') return claimFree(req, env, seg[2]);
      }

      /* ── buying ── */
      if (method === 'POST' && path === '/v1/orders') return createOrder(req, env);
      if (method === 'GET' && seg[0] === 'v1' && seg[1] === 'orders' && seg[2]) {
        return getOrder(req, env, seg[2]);
      }

      /* ── owning ── */
      if (method === 'GET' && path === '/v1/entitlements') return listEntitlements(req, env);

      /* ── the gateway calling us ── */
      if (method === 'POST' && path === '/webhooks/lipia') return lipiaWebhook(req, env);

      return fail(404, 'not_found', `${method} ${path}`);
    } catch (err) {
      /*
        Never leak a stack to a client, and never swallow one either —
        `wrangler tail` is where this is read, and an error that only
        ever appeared as a 500 is an error nobody can fix.
      */
      console.error('unhandled', method, path, err);
      return fail(500, 'internal_error');
    }
  },
};
