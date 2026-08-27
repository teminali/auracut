/* The Worker's bindings and secrets, in one place with what each is for.

   Nothing here is committed. `wrangler secret put <NAME>` for every
   secret; the D1/R2 bindings come from wrangler.jsonc. */

export interface Env {
  DB: D1Database;
  /*
    Optional, because R2 has to be enabled on the account by hand and
    everything except package download works without it. A store that
    refuses to boot over storage it does not yet use would be a worse
    failure than a download route that says what is missing.
  */
  SKILLS?: R2Bucket;

  /* ── Lipia (pay.mhasibudigital.com) ─────────────────────────────
     Kerf is a TENANT of Lipia, exactly like DukaBot and M-Digital are.
     The pair below is that tenant's API credential; the webhook secret
     is the tenant's, and is what signs the callbacks Lipia sends us. */
  LIPIA_API_URL: string;          // https://pay.mhasibudigital.com
  LIPIA_PUBLIC_KEY: string;       // secret — lpk_live_…
  LIPIA_SECRET: string;           // secret
  LIPIA_WEBHOOK_SECRET: string;   // secret — HMAC key for X-Lipia-Signature

  /* ── OAuth device flow ──────────────────────────────────────────
     These never reach Kerf. The desktop app polls THIS Worker, and the
     Worker polls the provider, so the client secret stays server-side
     and we get the account row as a side effect of the exchange. */
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;   // secret
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;   // secret

  /* ── Licence signing ────────────────────────────────────────────
     ECDSA P-256 private key as a JWK string. The matching PUBLIC key is
     baked into the Kerf client (src/services/licenceKey.ts) so a bought
     skill verifies with no network. Rotating this invalidates every
     licence in the field, so it rotates by adding a second key, never
     by replacing this one. */
  LICENCE_SIGNING_JWK: string;    // secret
}

export function requireEnv(env: Env, keys: (keyof Env)[]): string | null {
  const missing = keys.filter((k) => !env[k]);
  return missing.length ? `Server is not configured: missing ${missing.join(', ')}` : null;
}
