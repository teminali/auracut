/* ═══════════════════════════════════════════════════════════════════
   Where the store session token lives.

   Not localStorage. A bearer token in localStorage is readable by
   anything that can run script in the renderer, survives in a plain
   file inside the Chromium profile, and — for an app that already
   keeps agent API keys at 0600 in the app data directory — would be a
   second, weaker standard for the same kind of secret.

   This is the same shape as `agentBackends.setStoredKey`: one JSON file
   in `userData`, written 0600, read through the main process only.
   ═══════════════════════════════════════════════════════════════════ */

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface StoreSession {
  token: string;
  expiresAt: number;
}

const FILE = () => path.join(app.getPath('userData'), 'store-session.json');

/**
 * The store this build talks to.
 *
 * An env var rather than a constant so a developer can point a normal
 * build at a local Worker without recompiling the renderer, and so a
 * staging build is a launch flag rather than a branch.
 */
export function storeBaseUrl(): string {
  return process.env.KERF_STORE_URL?.replace(/\/+$/, '')
    || 'https://kerf-store.mhasibudigital.workers.dev';
}

export function readSession(): StoreSession | null {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), 'utf8')) as StoreSession;
    if (!raw?.token) return null;
    // An expired token is the same as no token to every caller, and
    // returning it would have the UI show a signed-in state that every
    // request then fails.
    if (typeof raw.expiresAt === 'number' && raw.expiresAt < Date.now()) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeSession(session: StoreSession): void {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify(session, null, 2), { encoding: 'utf8', mode: 0o600 });
}

export function clearSession(): void {
  try {
    fs.rmSync(FILE(), { force: true });
  } catch {
    /* Signing out must never fail loudly because a file was already gone. */
  }
}
