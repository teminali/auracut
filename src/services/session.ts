/* ═══════════════════════════════════════════════════════════════════
   Session persistence, isolated behind a function pair.

   `src/store` and `src/engine` must not reference `window.electronAPI`
   (HANDOVER §6) — that rule is what keeps the core portable. This
   module is the seam: the account store imports THIS, and this is the
   only file that knows the token lives in a 0600 file owned by main.

   The fallback matters. `window.electronAPI` is absent in a plain
   browser, in a vitest run, and in any future non-Electron shell. Doing
   nothing there would make the account store untestable; doing
   localStorage there silently is worse. So it falls back, and it SAYS
   which one it used, and callers that care can ask.
   ═══════════════════════════════════════════════════════════════════ */

export interface StoredSession {
  token: string;
  expiresAt: number;
}

const FALLBACK_KEY = 'kerf.store.session';

export const sessionIsSecure = (): boolean => Boolean(window.electronAPI?.store);

export async function loadSession(): Promise<{ session: StoredSession | null; baseUrl: string | null }> {
  const api = window.electronAPI?.store;
  if (api) {
    const { session, baseUrl } = await api.getSession();
    return { session, baseUrl };
  }
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    const session = raw ? (JSON.parse(raw) as StoredSession) : null;
    if (session && session.expiresAt < Date.now()) return { session: null, baseUrl: null };
    return { session, baseUrl: null };
  } catch {
    return { session: null, baseUrl: null };
  }
}

export async function saveSession(session: StoredSession): Promise<void> {
  const api = window.electronAPI?.store;
  if (api) {
    await api.setSession(session.token, session.expiresAt);
    return;
  }
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(session));
  } catch {
    /* Private mode, quota, a locked profile. Signing in still works for
       this session; it just will not be remembered. */
  }
}

export async function dropSession(): Promise<void> {
  const api = window.electronAPI?.store;
  if (api) {
    await api.clearSession();
    return;
  }
  try {
    localStorage.removeItem(FALLBACK_KEY);
  } catch { /* nothing to do */ }
}
