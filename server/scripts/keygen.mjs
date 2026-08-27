/*
  Generates the licence signing pair.

  The PRIVATE half becomes the LICENCE_SIGNING_JWK secret on the Worker.
  The PUBLIC half is compiled into the Kerf client so a licence verifies
  with no network — which is the entire point of signing them.

  Rotating this invalidates every licence in the field, so rotation means
  ADDING a second key the client also trusts, never replacing this one.

      node scripts/keygen.mjs
*/
import { webcrypto as crypto } from 'node:crypto';

const pair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
);

const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);

console.log('\n── LICENCE_SIGNING_JWK (secret — wrangler secret put LICENCE_SIGNING_JWK) ──\n');
console.log(JSON.stringify(priv));
console.log('\n── public key (paste into src/services/licenceKey.ts in the Kerf repo) ──\n');
console.log(JSON.stringify({ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }, null, 2));
console.log('');
