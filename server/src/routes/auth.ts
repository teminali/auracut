/* ═══════════════════════════════════════════════════════════════════
   Sign-in, by OAuth device flow.

   A desktop app cannot receive a redirect, so the browser half and the
   app half are joined by a short code the person types. Kerf shows the
   code, the person authorises in whatever browser they already trust,
   and Kerf polls until it is done.

   **Kerf polls US, not the provider.** That is the whole design:

     · the provider's client secret never ships inside an MIT-licensed
       Electron app, where it would be one `asar` extract away;
     · the account row is created as a side effect of an exchange we
       performed, rather than trusted from a token the client handed us;
     · and the poll interval is enforced here, so a client bug cannot
       burn the OAuth quota for every other user.

   Nothing is simulated. A `pending` means the provider said pending.
   ═══════════════════════════════════════════════════════════════════ */

import type { Env } from '../lib/env';
import { json, fail, readJson, bearer } from '../lib/http';
import { id, randomToken, sha256Hex } from '../lib/crypto';
import { now, userForToken, type UserRow } from '../lib/db';
import { clientIp, tooManyDeviceStarts } from '../lib/ratelimit';

type Provider = 'google' | 'github';

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

interface Profile { sub: string; email: string | null; name: string | null; avatar: string | null }

/* ── Provider adapters ─────────────────────────────────────────────
   One shape, two implementations. Both device flows are RFC 8628; they
   differ only in field names and in where the profile comes from. */

const PROVIDERS = {
  google: {
    deviceUrl: 'https://oauth2.googleapis.com/device/code',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    clientId: (e: Env) => e.GOOGLE_CLIENT_ID,
    clientSecret: (e: Env) => e.GOOGLE_CLIENT_SECRET,
    // Google calls it verification_url; GitHub calls it verification_uri.
    verificationUri: (d: Record<string, string>) => d.verification_url ?? d.verification_uri,
    async profile(accessToken: string): Promise<Profile> {
      const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) throw new Error(`Google userinfo returned ${r.status}`);
      const p = (await r.json()) as Record<string, string>;
      return { sub: p.sub, email: p.email ?? null, name: p.name ?? null, avatar: p.picture ?? null };
    },
  },
  github: {
    deviceUrl: 'https://github.com/login/device/code',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    clientId: (e: Env) => e.GITHUB_CLIENT_ID,
    clientSecret: (e: Env) => e.GITHUB_CLIENT_SECRET,
    verificationUri: (d: Record<string, string>) => d.verification_uri,
    async profile(accessToken: string): Promise<Profile> {
      const headers = {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/vnd.github+json',
        // GitHub rejects API calls with no User-Agent outright.
        'user-agent': 'kerf-store',
      };
      const r = await fetch('https://api.github.com/user', { headers });
      if (!r.ok) throw new Error(`GitHub /user returned ${r.status}`);
      const p = (await r.json()) as Record<string, string>;

      // A GitHub profile email is null whenever the address is private,
      // which is the default. The receipt has to go somewhere.
      let email: string | null = p.email ?? null;
      if (!email) {
        const er = await fetch('https://api.github.com/user/emails', { headers });
        if (er.ok) {
          const list = (await er.json()) as { email: string; primary: boolean; verified: boolean }[];
          email = list.find((e) => e.primary && e.verified)?.email ?? null;
        }
      }
      return { sub: String(p.id), email, name: p.name ?? p.login ?? null, avatar: p.avatar_url ?? null };
    },
  },
} as const;

async function form(url: string, body: Record<string, string>): Promise<Record<string, string>> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
  });
  return (await r.json().catch(() => ({}))) as Record<string, string>;
}

/* ── POST /v1/auth/device/start ────────────────────────────────── */

export async function deviceStart(req: Request, env: Env): Promise<Response> {
  const body = await readJson<{ provider?: string }>(req);
  const provider = (body?.provider ?? 'google') as Provider;
  if (provider !== 'google' && provider !== 'github') {
    return fail(400, 'unknown_provider', 'provider must be "google" or "github"');
  }

  const p = PROVIDERS[provider];
  if (!p.clientId(env) || !p.clientSecret(env)) {
    return fail(503, 'provider_not_configured', `${provider} sign-in is not set up on this server`);
  }

  /* Checked BEFORE the provider is called, which is the entire point:
     the thing being protected is our OAuth quota, and a limit applied
     after the round trip protects nothing. */
  const ip = clientIp(req);
  if (await tooManyDeviceStarts(env, ip)) {
    return fail(429, 'too_many_attempts', 'Too many sign-in attempts. Wait a few minutes.');
  }

  const d = await form(p.deviceUrl, { client_id: p.clientId(env), scope: p.scope });
  if (!d.device_code || !d.user_code) {
    return fail(502, 'provider_error', d.error_description ?? d.error ?? 'no device code returned');
  }

  const ours = id('dev');
  const interval = Number(d.interval ?? 5);
  const expiresIn = Number(d.expires_in ?? 900);
  const verificationUri = p.verificationUri(d);

  await env.DB.prepare(
    `INSERT INTO device_auths
       (id, provider, provider_device_code, user_code, verification_uri, interval_s,
        created_at, expires_at, status, last_polled_at, created_ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`
  ).bind(ours, provider, d.device_code, d.user_code, verificationUri, interval,
         now(), now() + expiresIn * 1000, ip).run();

  return json({
    deviceCode: ours,
    userCode: d.user_code,
    verificationUri,
    // Google returns a prefilled URL; GitHub does not. The client shows
    // the plain one when this is absent rather than building its own.
    verificationUriComplete: d.verification_url_complete ?? null,
    interval,
    expiresIn,
  });
}

/* ── POST /v1/auth/device/poll ─────────────────────────────────── */

export async function devicePoll(req: Request, env: Env): Promise<Response> {
  const body = await readJson<{ deviceCode?: string }>(req);
  if (!body?.deviceCode) return fail(400, 'missing_device_code');

  const row = await env.DB.prepare('SELECT * FROM device_auths WHERE id = ?')
    .bind(body.deviceCode).first<{
      id: string; provider: Provider; provider_device_code: string;
      interval_s: number; expires_at: number; status: string;
      user_id: string | null; last_polled_at: number;
    }>();
  if (!row) return fail(404, 'unknown_device_code');

  if (row.status === 'denied') return json({ status: 'denied' });
  if (row.status === 'expired' || row.expires_at < now()) {
    await env.DB.prepare("UPDATE device_auths SET status = 'expired' WHERE id = ?").bind(row.id).run();
    return json({ status: 'expired' });
  }

  /*
    Enforce the provider's own interval here. A client that polls in a
    tight loop gets slow_down from us and never reaches the provider,
    so one misbehaving desktop cannot rate-limit sign-in for everybody.
  */
  if (now() - row.last_polled_at < row.interval_s * 1000) {
    return json({ status: 'slow_down', interval: row.interval_s });
  }
  await env.DB.prepare('UPDATE device_auths SET last_polled_at = ? WHERE id = ?')
    .bind(now(), row.id).run();

  const p = PROVIDERS[row.provider];
  const t = await form(p.tokenUrl, {
    client_id: p.clientId(env),
    client_secret: p.clientSecret(env),
    device_code: row.provider_device_code,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });

  if (t.error === 'authorization_pending') return json({ status: 'pending' });
  if (t.error === 'slow_down') return json({ status: 'slow_down', interval: row.interval_s + 5 });
  if (t.error === 'access_denied') {
    await env.DB.prepare("UPDATE device_auths SET status = 'denied' WHERE id = ?").bind(row.id).run();
    return json({ status: 'denied' });
  }
  if (t.error === 'expired_token') {
    await env.DB.prepare("UPDATE device_auths SET status = 'expired' WHERE id = ?").bind(row.id).run();
    return json({ status: 'expired' });
  }
  if (!t.access_token) {
    return fail(502, 'provider_error', t.error_description ?? t.error ?? 'no access token');
  }

  /* Authorised. Everything below happens exactly once per device code. */
  let profile: Profile;
  try {
    profile = await p.profile(t.access_token);
  } catch (err) {
    return fail(502, 'provider_error', (err as Error).message);
  }

  const existing = await env.DB.prepare(
    'SELECT * FROM users WHERE provider = ? AND provider_sub = ?'
  ).bind(row.provider, profile.sub).first<UserRow>();

  let userId: string;
  if (existing) {
    userId = existing.id;
    await env.DB.prepare(
      'UPDATE users SET email = ?, name = ?, avatar_url = ?, last_seen_at = ? WHERE id = ?'
    ).bind(profile.email, profile.name, profile.avatar, now(), userId).run();
  } else {
    userId = id('usr');
    await env.DB.prepare(
      `INSERT INTO users (id, provider, provider_sub, email, name, avatar_url, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(userId, row.provider, profile.sub, profile.email, profile.name,
           profile.avatar, now(), now()).run();
  }

  const token = randomToken(32);
  await env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, last_used_at, expires_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(await sha256Hex(token), userId, now(), now(), now() + SESSION_TTL_MS,
         req.headers.get('user-agent')).run();

  await env.DB.prepare("UPDATE device_auths SET status = 'complete', user_id = ? WHERE id = ?")
    .bind(userId, row.id).run();

  return json({
    status: 'ok',
    token,
    expiresAt: now() + SESSION_TTL_MS,
    user: { id: userId, email: profile.email, name: profile.name, avatarUrl: profile.avatar },
  });
}

/* ── GET /v1/me ────────────────────────────────────────────────── */

export async function me(req: Request, env: Env): Promise<Response> {
  const token = bearer(req);
  if (!token) return fail(401, 'not_signed_in');
  const user = await userForToken(env, token);
  if (!user) return fail(401, 'not_signed_in');
  return json({
    user: {
      id: user.id, email: user.email, name: user.name,
      avatarUrl: user.avatar_url, msisdn: user.msisdn, provider: user.provider,
    },
  });
}

/* ── POST /v1/auth/signout ─────────────────────────────────────── */

export async function signOut(req: Request, env: Env): Promise<Response> {
  const token = bearer(req);
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sha256Hex(token)).run();
  }
  // Idempotent on purpose: signing out twice is not an error, and a
  // client that cannot sign out because it already did is a bad bug.
  return json({ ok: true });
}
