/* ═══════════════════════════════════════════════════════════════════
   The sealed-file format, as pure functions.

   Split out of `electron/vault.ts` so that the property the trial
   system rests on — that an edited file FAILS rather than decrypting to
   something plausible — is testable without an app, a disk, or a device
   key. `vault.ts` supplies the key and the files; this is the format.

   ── The format ─────────────────────────────────────────────────────

       KERFv1.<purpose>.<iv>.<tag>.<ciphertext>

   All base64url, dot-separated, ASCII. Text rather than binary so that
   somebody who finds one of these files can see what it is: "this is an
   encrypted TeminaliCut file" is useful information, and a wall of bytes that
   might be a corrupt video is not.

   ── Why AES-GCM and not AES-CBC plus a hash ────────────────────────

   Because the failure mode is the feature. GCM authenticates, so a
   changed byte does not produce garbage plaintext to be validated
   later — it throws, at decrypt, before any caller sees a number. A
   trial counter guarded by an unauthenticated cipher is a trial counter
   somebody can flip a bit in and hope.

   ── Why `purpose` is inside the ciphertext's key derivation ────────

   TeminaliCut seals two unrelated things: a trial ledger and a recording's
   input sidecar. Under one key, a ciphertext from one file could be
   moved into the other and would decrypt. Deriving a sub-key per
   purpose makes that a decrypt failure instead of a confusing success.
   ═══════════════════════════════════════════════════════════════════ */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/** First field of every sealed file. Bump if the format ever changes. */
export const ENVELOPE_MAGIC = 'KERFv1';

/** A 32-byte key for one purpose, derived from the device key. */
export function subKey(deviceKey: Uint8Array, purpose: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', deviceKey, new Uint8Array(0), Buffer.from(purpose, 'utf8'), 32)
  );
}

export function seal(deviceKey: Uint8Array, purpose: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', subKey(deviceKey, purpose), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    ENVELOPE_MAGIC,
    purpose,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    body.toString('base64url'),
  ].join('.');
}

export type OpenResult =
  | { ok: true; plaintext: string }
  | { ok: false; reason: 'not-sealed' | 'wrong-purpose' | 'tampered'; message: string };

/**
 * Open an envelope.
 *
 * The three failures are told apart on purpose, and the distinction is
 * load-bearing rather than tidy:
 *
 *   `not-sealed`    a plain file. A legitimate thing to meet — a take
 *                   assembled by hand, or one written before this
 *                   existed — and the caller may use it as it is.
 *   `wrong-purpose` a sealed file of the wrong kind, which means
 *                   somebody moved it.
 *   `tampered`      an AUTHENTICATED decrypt that failed. Not a corrupt
 *                   file to shrug at: this is the signal the trial
 *                   ledger is built on, and treating it as "no data"
 *                   would turn tampering into a reset.
 */
export function open(deviceKey: Uint8Array, purpose: string, text: string): OpenResult {
  const parts = text.split('.');
  if (parts.length !== 5 || parts[0] !== ENVELOPE_MAGIC) {
    return { ok: false, reason: 'not-sealed', message: 'Not a sealed TeminaliCut file.' };
  }
  if (parts[1] !== purpose) {
    return {
      ok: false,
      reason: 'wrong-purpose',
      message: `This is a sealed "${parts[1]}" file, opened as "${purpose}".`,
    };
  }

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm', subKey(deviceKey, purpose), Buffer.from(parts[2], 'base64url')
    );
    decipher.setAuthTag(Buffer.from(parts[3], 'base64url'));
    return {
      ok: true,
      plaintext: Buffer.concat([
        decipher.update(Buffer.from(parts[4], 'base64url')),
        decipher.final(),
      ]).toString('utf8'),
    };
  } catch {
    return {
      ok: false,
      reason: 'tampered',
      message: 'This file did not decrypt. It has been altered, or it was written by another install.',
    };
  }
}
