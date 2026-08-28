/*
 * Kerf Store — end-to-end checks against a running Worker.
 *
 *     npx wrangler dev --port 8788 --local     # in another shell
 *     node verify_store.mjs
 *
 * Same bar as the rest of this repo: assert against the ARTIFACT, not
 * the function. A licence is not "issued" because a route returned 200
 * — it is issued when the bytes it returned verify under the public key
 * the client will actually use. That is the check below, and it is the
 * one that would catch a signing key mismatch, a mangled base64url, or
 * a payload that says something other than what was bought.
 *
 * Every check that can be faked by ambient state has a control beside
 * it: an entitlement is claimed only after asserting it was ABSENT, a
 * webhook is accepted only after an identical unsigned one is refused.
 */
import { webcrypto as crypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BASE = process.env.STORE_URL ?? 'http://127.0.0.1:8788';
const PERSIST_TO = process.env.STORE_PERSIST_TO;
const results = [];
const check = (label, pass, detail) => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label.padEnd(52)} ${detail ?? ''}`);
  results.push(pass);
};

const enc = new TextEncoder();
const b64u = (b) => Buffer.from(b).toString('base64url');

async function api(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* leave null */ }
  return { status: res.status, json, text, headers: res.headers };
}

/* ── local dev secrets, so the test can sign what Lipia would sign ── */
const devVars = Object.fromEntries(
  readFileSync('.dev.vars', 'utf8').split('\n').filter(Boolean)
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);
const signingJwk = JSON.parse(devVars.LICENCE_SIGNING_JWK);
const WEBHOOK_SECRET = devVars.LIPIA_WEBHOOK_SECRET;

/* The client verifies with the PUBLIC half only — derive it here the
   same way `keygen.mjs` prints it, so this test uses what ships. */
const publicJwk = { kty: signingJwk.kty, crv: signingJwk.crv, x: signingJwk.x, y: signingJwk.y };

async function verifyLicence(compact) {
  const [h, p, s] = compact.split('.');
  if (!h || !p || !s) return { ok: false, reason: 'not three segments' };
  const key = await crypto.subtle.importKey(
    'jwk', { ...publicJwk, key_ops: ['verify'], ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
  );
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, key,
    Buffer.from(s, 'base64url'), enc.encode(`${h}.${p}`)
  );
  return { ok, payload: JSON.parse(Buffer.from(p, 'base64url').toString()) };
}

async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return Buffer.from(sig).toString('hex');
}

/* ═══ 0. Up at all ═══════════════════════════════════════════════ */
const health = await api('GET', '/health');
check('the worker is up', health.status === 200 && health.json?.ok === true,
      JSON.stringify(health.json));

/* ═══ 1. Catalogue is public, ownership is not ═══════════════════ */
const anon = await api('GET', '/v1/skills');
const free = anon.json?.skills?.find((s) => s.id === 'beat-montage');
const paid = anon.json?.skills?.find((s) => s.id === 'cinematic-grade');
check('the catalogue is readable signed out',
      anon.status === 200 && anon.json.skills.length >= 2 && anon.json.signedIn === false,
      `${anon.json?.skills?.length} skills, signedIn=${anon.json?.signedIn}`);
check('a free skill is priced 0 and flagged free', free?.price.amount === 0 && free?.free === true,
      `${free?.price.amount} ${free?.price.currency}`);
check('the included skill is marked for public manifest updates', free?.included === true,
      `included=${free?.included}`);
check('a paid skill carries its real price', paid?.price.amount === 5000 && paid?.free === false,
      `${paid?.price.amount} ${paid?.price.currency}`);
check('control: nothing is owned when signed out',
      anon.json.skills.every((s) => s.owned === false), 'all owned=false');

/* ═══ 2. Everything that costs money needs a session ═════════════ */
for (const [method, path] of [['GET', '/v1/me'], ['GET', '/v1/entitlements'],
                              ['POST', '/v1/orders'], ['GET', '/v1/skills/beat-montage/download'],
                              ['POST', '/v1/skills/beat-montage/claim']]) {
  const r = await api(method, path, { body: method === 'POST' ? {} : undefined });
  check(`${method} ${path} refuses an anonymous caller`, r.status === 401,
        `${r.status} ${r.json?.error ?? ''}`);
}
const badToken = await api('GET', '/v1/me', { token: 'not-a-real-token' });
check('control: a forged bearer token is refused', badToken.status === 401,
      `${badToken.status} ${badToken.json?.error ?? ''}`);

/* ═══ 3. Make a session the way the device flow would ════════════ */
const { execSync } = await import('node:child_process');
const token = b64u(crypto.getRandomValues(new Uint8Array(32)));
const tokenHash = Buffer.from(
  await crypto.subtle.digest('SHA-256', enc.encode(token))
).toString('hex');
const USER = 'usr_verify_store';
const nowMs = Date.now();
const q = (sql, mayFail = false) => {
  try {
    const persist = PERSIST_TO ? ` --persist-to=${JSON.stringify(PERSIST_TO)}` : '';
    return execSync(`npx wrangler d1 execute kerf-store --local${persist} --command=${JSON.stringify(sql)}`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    // A statement expected to be REFUSED is not a broken harness.
    if (mayFail) return String(err.stdout ?? '') + String(err.stderr ?? '');
    throw err;
  }
};

q(`DELETE FROM entitlements WHERE user_id='${USER}'`);
q(`DELETE FROM orders WHERE user_id='${USER}'`);
q(`DELETE FROM sessions WHERE user_id='${USER}'`);
q(`DELETE FROM users WHERE id='${USER}'`);
q(`INSERT INTO users (id, provider, provider_sub, email, name, created_at, last_seen_at) VALUES ('${USER}','google','sub-verify','v@example.com','Verify Store',${nowMs},${nowMs})`);
q(`INSERT INTO sessions (token_hash, user_id, created_at, last_used_at, expires_at) VALUES ('${tokenHash}','${USER}',${nowMs},${nowMs},${nowMs + 86400000})`);

const updateManifest = {
  id: 'beat-montage', name: 'Beat Montage', version: '1.0.0', toolApi: 1,
  summary: 'Manifest update verification probe.', trial: { uses: 0 },
  slots: [{ id: 'footage', kind: 'folder', required: true, description: 'A folder of clips.' }],
  requiresTools: ['assemble_from_folder'],
  recipe: [{ tool: 'assemble_from_folder', args: { folder: '{slot:footage}' } }],
  assets: [],
};
const manifestSql = JSON.stringify(updateManifest).replaceAll("'", "''");
q(`UPDATE skill_versions SET manifest_json='${manifestSql}' WHERE skill_id='beat-montage' AND version='1.0.0'`);

const publicManifest = await api('GET', '/v1/skills/beat-montage/manifest?version=1.0.0');
check('an included skill manifest updates without signing in',
      publicManifest.status === 200
      && publicManifest.json?.manifest?.id === 'beat-montage'
      && publicManifest.json?.manifest?.version === '1.0.0',
      `${publicManifest.status} ${publicManifest.json?.manifest?.id ?? publicManifest.json?.error}`);

const paidManifest = await api('GET', '/v1/skills/cinematic-grade/manifest?version=1.0.0');
check('control: a paid skill manifest stays behind entitlement',
      paidManifest.status === 401 && paidManifest.json?.error === 'not_signed_in',
      `${paidManifest.status} ${paidManifest.json?.error}`);

const meRes = await api('GET', '/v1/me', { token });
check('a real session resolves to its user',
      meRes.status === 200 && meRes.json.user.id === USER,
      `${meRes.json?.user?.email ?? meRes.json?.error}`);

/* ═══ 4. Entitlement: absent, then claimed, then real ════════════ */
const before = await api('GET', '/v1/entitlements', { token });
check('control: the account owns nothing yet',
      before.status === 200 && before.json.entitlements.length === 0,
      `${before.json?.entitlements?.length} entitlements`);

const denied = await api('GET', '/v1/skills/beat-montage/download', { token });
check('control: download is refused before the claim',
      denied.status === 403 && denied.json.error === 'not_entitled',
      `${denied.status} ${denied.json?.error}`);

const claim = await api('POST', '/v1/skills/beat-montage/claim', { token, body: {} });
check('a free skill can be claimed', claim.status === 200 && claim.json.alreadyOwned === false,
      `alreadyOwned=${claim.json?.alreadyOwned}`);

/* The check this file exists for. */
const lic = await verifyLicence(claim.json?.licence ?? '');
check('the licence VERIFIES under the client public key', lic.ok === true,
      lic.ok ? 'ES256 signature valid' : `INVALID: ${lic.reason ?? 'signature rejected'}`);
check('the licence says what was actually bought',
      lic.payload?.sub === USER && lic.payload?.skill === 'beat-montage' && lic.payload?.ver === 1,
      `sub=${lic.payload?.sub} skill=${lic.payload?.skill} ver=${lic.payload?.ver}`);
check('the licence expires, so a revoke can bite',
      lic.payload?.exp > Date.now() && lic.payload.exp - lic.payload.iat <= 31 * 86400000,
      `${Math.round((lic.payload?.exp - lic.payload?.iat) / 86400000)} days`);

/* A licence must not verify if a single byte of its claim is changed. */
const tampered = (() => {
  const [h, p, s] = claim.json.licence.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  payload.skill = 'cinematic-grade';
  return `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
})();
const tamperCheck = await verifyLicence(tampered);
check('control: a licence edited to name another skill fails',
      tamperCheck.ok === false, 'signature rejected as it must be');

const after = await api('GET', '/v1/entitlements', { token });
check('the entitlement is listed afterwards',
      after.json.entitlements.length === 1 && after.json.entitlements[0].skillId === 'beat-montage',
      `${after.json?.entitlements?.length} entitlement(s)`);

const reclaim = await api('POST', '/v1/skills/beat-montage/claim', { token, body: {} });
check('claiming twice is idempotent, not a second grant',
      reclaim.status === 200 && reclaim.json.alreadyOwned === true,
      `alreadyOwned=${reclaim.json?.alreadyOwned}`);

const ownedNow = await api('GET', '/v1/skills', { token });
check('the catalogue now reports it owned',
      ownedNow.json.skills.find((s) => s.id === 'beat-montage')?.owned === true &&
      ownedNow.json.skills.find((s) => s.id === 'cinematic-grade')?.owned === false,
      'free owned, paid not');

/* ═══ 5. A paid skill cannot be claimed for free ═════════════════ */
const freeload = await api('POST', '/v1/skills/cinematic-grade/claim', { token, body: {} });
check('a PAID skill refuses the free-claim route',
      freeload.status === 402 && freeload.json.error === 'not_free',
      `${freeload.status} ${freeload.json?.error}`);

/* ═══ 6. Phone numbers ═══════════════════════════════════════════ */
const badPhone = await api('POST', '/v1/orders', {
  token, body: { skillId: 'cinematic-grade', msisdn: '12' },
});
check('a malformed phone number is refused before charging',
      badPhone.status === 400 && badPhone.json.error === 'bad_msisdn',
      `${badPhone.status} ${badPhone.json?.error}`);

const freeOrder = await api('POST', '/v1/orders', {
  token, body: { skillId: 'beat-montage', msisdn: '0712345678' },
});
check('a free skill cannot be turned into an order',
      freeOrder.status === 400 && freeOrder.json.error === 'skill_is_free',
      `${freeOrder.status} ${freeOrder.json?.error}`);

/* ═══ 7. The webhook: signature first, always ════════════════════ */
const ORDER = 'ord_verify_store';
q(`DELETE FROM orders WHERE id='${ORDER}'`);
q(`INSERT INTO orders (id,user_id,skill_id,major_version,amount,currency,msisdn,provider,status,lipia_transaction_id,created_at,updated_at,reconcile_after) VALUES ('${ORDER}','${USER}','cinematic-grade',1,5000,'TZS','255712345678','vodacom','charging','txn_fake',${nowMs},${nowMs},${nowMs + 45000})`);

const hookBody = JSON.stringify({
  event: 'payment.completed',
  timestamp: new Date(nowMs).toISOString(),
  data: {
    id: 'txn_fake', external_id: ORDER, amount: 5000, currency: 'TZS',
    method: 'mobile_wallet', provider: 'vodacom', status: 'success',
    customer_msisdn: '255712345678', customer_email: null, customer_name: null,
    metadata: { kind: 'kerf_skill', order_id: ORDER, skill_id: 'cinematic-grade',
                user_id: USER, major_version: 1 },
    created_at: new Date(nowMs).toISOString(),
  },
});

const unsigned = await api('POST', '/webhooks/lipia', {
  body: hookBody, headers: { 'x-lipia-event': 'payment.completed' },
});
check('control: an UNSIGNED callback is refused', unsigned.status === 401,
      `${unsigned.status} ${unsigned.json?.error}`);

const wrongSig = await api('POST', '/webhooks/lipia', {
  body: hookBody,
  headers: { 'x-lipia-event': 'payment.completed', 'x-lipia-signature': 'a'.repeat(64) },
});
check('control: a WRONGLY-signed callback is refused', wrongSig.status === 401,
      `${wrongSig.status} ${wrongSig.json?.error}`);

const stillNot = await api('GET', '/v1/entitlements', { token });
check('control: the refused callbacks granted nothing',
      stillNot.json.entitlements.length === 1, `${stillNot.json.entitlements.length} entitlement(s)`);

const signed = await api('POST', '/webhooks/lipia', {
  body: hookBody,
  headers: {
    'x-lipia-event': 'payment.completed',
    'x-lipia-signature': await hmacHex(WEBHOOK_SECRET, hookBody),
  },
});
check('a correctly-signed payment.completed grants the skill',
      signed.status === 200 && signed.json.granted === true,
      `granted=${signed.json?.granted}`);

const paidNow = await api('GET', '/v1/entitlements', { token });
const boughtOne = paidNow.json.entitlements.find((e) => e.skillId === 'cinematic-grade');
check('the purchased entitlement is real and licensed',
      Boolean(boughtOne) && (await verifyLicence(boughtOne.licence)).ok === true,
      `source=${boughtOne?.source}`);

/* Lipia retries on a 1m/5m/30m/2h/12h ladder. The second delivery must
   not mint a second entitlement or a second charge. */
const replay = await api('POST', '/webhooks/lipia', {
  body: hookBody,
  headers: {
    'x-lipia-event': 'payment.completed',
    'x-lipia-signature': await hmacHex(WEBHOOK_SECRET, hookBody),
  },
});
const afterReplay = await api('GET', '/v1/entitlements', { token });
check('a REPLAYED callback grants nothing a second time',
      replay.status === 200 && replay.json.granted === false &&
      afterReplay.json.entitlements.length === 2,
      `granted=${replay.json?.granted}, ${afterReplay.json.entitlements.length} total`);

/* ═══ 8. Underpayment must not fulfil ════════════════════════════ */
const SHORT = 'ord_verify_short';
q(`DELETE FROM entitlements WHERE order_id='${SHORT}'`);
q(`DELETE FROM orders WHERE id='${SHORT}'`);
q(`INSERT INTO orders (id,user_id,skill_id,major_version,amount,currency,msisdn,provider,status,lipia_transaction_id,created_at,updated_at,reconcile_after) VALUES ('${SHORT}','${USER}','beat-montage',2,5000,'TZS','255712345678','vodacom','charging','txn_short',${nowMs},${nowMs},${nowMs + 45000})`);
const shortBody = JSON.stringify({
  event: 'payment.completed', timestamp: new Date(nowMs).toISOString(),
  data: { id: 'txn_short', external_id: SHORT, amount: 100, currency: 'TZS',
          method: 'mobile_wallet', provider: 'vodacom', status: 'success',
          customer_msisdn: '255712345678', customer_email: null, customer_name: null,
          metadata: { order_id: SHORT }, created_at: new Date(nowMs).toISOString() },
});
const short = await api('POST', '/webhooks/lipia', {
  body: shortBody,
  headers: { 'x-lipia-event': 'payment.completed',
             'x-lipia-signature': await hmacHex(WEBHOOK_SECRET, shortBody) },
});
check('paying 100 for a 5000 order grants nothing',
      short.status === 200 && short.json.granted === false, `granted=${short.json?.granted}`);

/* ═══ 9. The publish gate is a CONSTRAINT, not a comment ═════════ */
/* §6: "If it does not run, it does not publish." Enforced in the
   database so no code path and no future admin screen can route around
   it. Proved by trying, because a constraint nobody has tried to
   violate is a constraint you are hoping is there. */
/* Asserted on the DATABASE STATE, not on the error text.
   The first version of this check pattern-matched "CHECK constraint
   failed" out of the thrown error — and the helper discarded stderr,
   which is where wrangler writes it. The constraint was working
   perfectly and the check called it broken. Ask whether the row is
   there; that is the artifact, and it cannot be got wrong. */
q(`DELETE FROM skills WHERE id='verify_unverified'`, true);
q(`INSERT INTO skills (id,name,summary,author_name,major_version,latest_version,tool_api,price_amount,price_currency,status,created_at,updated_at) VALUES ('verify_unverified','X','no verification run','x',1,'1.0.0',1,999,'TZS','published',0,0)`, true);
const landed = q(`SELECT COUNT(*) AS n FROM skills WHERE id='verify_unverified'`, true);
const gateHeld = /"n": 0/.test(landed);
check('an unverified skill CANNOT be published', gateHeld,
      gateHeld ? 'the row is not in the table' : 'IT WAS INSERTED — the gate is not there');

/* Control: the same row WITH a verification run must go in, or the
   check above would pass for the wrong reason (e.g. a typo'd column). */
let verifiedWentIn = false;
try {
  q(`DELETE FROM skills WHERE id='verify_verified'`);
  q(`INSERT INTO skills (id,name,summary,author_name,major_version,latest_version,tool_api,price_amount,price_currency,status,verified_at,created_at,updated_at) VALUES ('verify_verified','X','has a verification run','x',1,'1.0.0',1,999,'TZS','published',1,0,0)`);
  verifiedWentIn = true;
} catch { /* left false */ }
check('control: a VERIFIED skill publishes normally', verifiedWentIn,
      verifiedWentIn ? 'inserted' : 'the constraint is too strict');
q(`DELETE FROM skills WHERE id='verify_verified'`);

/* ═══ 10. Rate limits ════════════════════════════════════════════ */
/* Six orders in a row: the sixth must be refused. Each order is a real
   PIN prompt on a real handset, so the failure mode being prevented is
   making a stranger's phone buzz repeatedly.

   A SECOND user, deliberately. Clearing the first one's orders would
   mean deleting rows that `entitlements.order_id` still references, and
   D1 enforces foreign keys — which is how this was found. */
const USER2 = 'usr_verify_rate';
const token2 = b64u(crypto.getRandomValues(new Uint8Array(32)));
const hash2 = Buffer.from(
  await crypto.subtle.digest('SHA-256', enc.encode(token2))
).toString('hex');
q(`DELETE FROM sessions WHERE user_id='${USER2}'`);
q(`DELETE FROM orders WHERE user_id='${USER2}'`);
q(`DELETE FROM users WHERE id='${USER2}'`);
q(`INSERT INTO users (id, provider, provider_sub, email, name, created_at, last_seen_at) VALUES ('${USER2}','google','sub-rate','r@example.com','Rate Limit',${nowMs},${nowMs})`);
q(`INSERT INTO sessions (token_hash, user_id, created_at, last_used_at, expires_at) VALUES ('${hash2}','${USER2}',${nowMs},${nowMs},${nowMs + 86400000})`);

let limited = null;
for (let i = 0; i < 6; i++) {
  const r = await api('POST', '/v1/orders', {
    token: token2, body: { skillId: 'cinematic-grade', msisdn: '0712345678' },
  });
  if (r.status === 429) { limited = i; break; }
}
check('order creation is rate limited', limited !== null,
      limited === null ? 'six attempts all allowed' : `refused at attempt ${limited + 1}`);

/* ═══ 11. Every delivery is on the record ════════════════════════ */
const logged = q(`SELECT COUNT(*) AS n FROM webhook_events`);
check('every callback was logged, verified or not', /"n": [4-9]|"n": \d\d/.test(logged),
      logged.replace(/\s+/g, ' ').match(/"n": \d+/)?.[0] ?? 'unreadable');

/* ─────────────────────────────────────────────────────────────── */
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} store checks passed`);
process.exit(passed === results.length ? 0 : 1);
