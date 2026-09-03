/* ═══════════════════════════════════════════════════════════════════
   Encryption at rest, and an honest account of what it buys.

   TeminaliCut writes several things to disk that are not the user's document:
   a trial ledger that decides whether a paid skill will run, and the
   behavioural sidecar of a recording — every cursor position and the
   timing of every keystroke of a take. Both are written through here.

   ── What this protects against, and what it cannot ─────────────────

   It protects against: another user on the machine reading a take's
   input log; a backup or a copied folder being readable as plain JSON;
   and a trial counter being edited in a text editor. The last one is
   the one with teeth, and it works because AES-GCM is AUTHENTICATED —
   a changed byte does not decrypt to something plausible, it fails, and
   a failed decrypt is treated as tampering rather than as an empty
   ledger.

   It does NOT protect against a determined owner of the machine, and
   nothing running on that machine could. The key is derived from a
   secret this app wrote and this app can read; anything TeminaliCut can
   decrypt, someone with TeminaliCut can decrypt. `licenceKey.ts` already says
   this in as many words about signatures, and the same is true here:
   TeminaliCut is MIT, this file ships as source, and the store's value is
   updates, verification and convenience rather than a lock.

   Saying so is not a disclaimer. It is the difference between a trial
   system that is designed for what it can do — be tamper-EVIDENT, and
   not be trivially editable — and one that pretends to be a vault and
   gets built as if the pretence were true.

   ── The one thing deliberately not encrypted ───────────────────────

   The video. A take's screen.mp4 has to be opened by a `<video>`
   element to preview and by ffmpeg — a separate process — to export.
   Encrypting it would mean decrypting the whole file to disk before
   every export, which puts the plaintext on the same disk it was
   removed from, or holding gigabytes in memory. It would cost real
   performance and buy nothing. The recording is the user's own footage
   on the user's own machine; the sidecar that logs how they moved and
   typed is the part worth covering.
   ═══════════════════════════════════════════════════════════════════ */

import { app } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  seal as sealEnvelope, open as openEnvelope, OpenResult, ENVELOPE_MAGIC,
} from '../src/services/sealedEnvelope';

export { ENVELOPE_MAGIC };
export type { OpenResult };

const KEY_FILE = () => path.join(app.getPath('userData'), 'device-key');

/**
 * A random 32-byte secret, made once per install and never sent
 * anywhere.
 *
 * Not derived from a machine id, and that is deliberate: a key derived
 * from the hostname or a serial number is the same key on every install
 * of the same build, so one person recovering it recovers everybody's.
 * Random-per-install means the worst case is one machine.
 *
 * Written 0600 and, if the platform allows, in a directory only this
 * user can read. Same shape as `storeSession` and `agentBackends`, so
 * there is one standard for secrets here rather than three.
 */
function deviceKey(): Buffer {
  const file = KEY_FILE();
  try {
    const existing = fs.readFileSync(file);
    if (existing.length === 32) return existing;
  } catch {
    /* not made yet */
  }

  const key = crypto.randomBytes(32);
  try {
    fs.writeFileSync(file, key, { mode: 0o600 });
    // writeFileSync's mode is ignored when the file already exists.
    fs.chmodSync(file, 0o600);
  } catch {
    /*
      An unwritable userData directory is a broken install, and refusing
      to run would be worse than running with a key that lives only for
      this session. Trials fall back to "unused" and the sidecar is
      written in the clear, both of which are visible in the UI.
    */
  }
  return key;
}

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (!cachedKey) cachedKey = deviceKey();
  return cachedKey;
}

/* ── The envelope ───────────────────────────────────────────────────
   Format, and the reasoning behind it, live in
   `src/services/sealedEnvelope.ts` — pure, and therefore testable
   without an app or a disk, which matters because the property the
   whole trial system rests on is that an edited file FAILS rather than
   decrypting to something plausible. This half owns the key and the
   files.                                                             */

export function seal(purpose: string, plaintext: string): string {
  return sealEnvelope(key(), purpose, plaintext);
}

export function open(purpose: string, text: string): OpenResult {
  return openEnvelope(key(), purpose, text);
}

/* ── Files ──────────────────────────────────────────────────────── */

/** Write a sealed file, 0600. */
export function writeSealed(filePath: string, purpose: string, plaintext: string): void {
  fs.writeFileSync(filePath, seal(purpose, plaintext), { mode: 0o600 });
  try { fs.chmodSync(filePath, 0o600); } catch { /* best effort on Windows */ }
}

/**
 * Read a file that may or may not be sealed.
 *
 * A plain file comes back as itself. That is not a hole: nothing here
 * claims a file MUST be sealed, and a take somebody assembled by hand
 * or copied from an older version has to keep working.
 */
export function readMaybeSealed(filePath: string, purpose: string): OpenResult {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { ok: false, reason: 'not-sealed', message: (err as Error).message };
  }
  const result = open(purpose, text);
  if (result.ok || result.reason !== 'not-sealed') return result;
  return { ok: true, plaintext: text };
}

/**
 * Make a directory only this user can enter.
 *
 * 0700 on the directory matters more than 0600 on the files inside it:
 * a mode on a file stops a read, and a mode on the directory stops the
 * listing that finds it. No-op on Windows, where the equivalent is an
 * ACL and the user profile already carries one.
 */
export function makePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (os.platform() !== 'win32') {
    try { fs.chmodSync(dir, 0o700); } catch { /* already right, or not ours */ }
  }
}
