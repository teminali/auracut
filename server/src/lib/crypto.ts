/* ═══════════════════════════════════════════════════════════════════
   Everything that has to be constant-time, signed, or unguessable.

   Three separate jobs, and they use different primitives on purpose:

     · session tokens  — random, stored as a hash. A database dump must
                         not be a pile of live logins.
     · Lipia webhooks  — HMAC-SHA256 over the RAW body, compared in
                         constant time. The body must be verified before
                         it is parsed; JSON.parse of an unverified
                         payload is already trusting it.
     · licences        — ECDSA P-256, so an installed skill still opens
                         on a laptop with no internet. Ed25519 would be
                         smaller and is NOT used: WebCrypto support for
                         it is recent enough that a signature the server
                         can make and the renderer cannot verify is a
                         real risk, and a licence that fails to verify
                         locks a paying customer out of what they bought.
   ═══════════════════════════════════════════════════════════════════ */

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Short, human-readable, unambiguous. Used for ids people may read out. */
export function id(prefix: string): string {
  return `${prefix}_${b64url(crypto.getRandomValues(new Uint8Array(12)))}`;
}

export async function sha256Hex(input: string | ArrayBuffer): Promise<string> {
  const data = typeof input === 'string' ? enc.encode(input) : new Uint8Array(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant time for equal-length inputs.
 *
 * `a === b` on a signature leaks how many leading bytes were right, one
 * request at a time. It is a small leak and it is also completely free
 * to not have.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ── Licences ─────────────────────────────────────────────────────── */

export interface LicencePayload {
  /** user id */
  sub: string;
  skill: string;
  /** major version this licence covers — §6, one-time is per major */
  ver: number;
  /** entitlement id, so a specific licence can be traced and revoked */
  jti: string;
  iat: number;
  exp: number;
}

/**
 * Compact `base64url(header).base64url(payload).base64url(signature)`.
 *
 * Deliberately SHORT-LIVED. Revocation on a signed offline token is
 * otherwise impossible — a refunded skill would keep working forever —
 * so the client refreshes while online and a revoked entitlement simply
 * stops being reissued. Offline grace is the expiry, and nothing else.
 */
export async function signLicence(privateJwk: JsonWebKey, payload: LicencePayload): Promise<string> {
  const key = await crypto.subtle.importKey(
    'jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const header = b64url(enc.encode(JSON.stringify({ alg: 'ES256', typ: 'kerf-licence' })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const signing = `${header}.${body}`;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signing)
  );
  return `${signing}.${b64url(new Uint8Array(sig))}`;
}
