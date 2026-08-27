/* ═══════════════════════════════════════════════════════════════════
   The Kerf Store API, from the app's side.

   Portable on purpose: `fetch` and nothing else. No `window.electronAPI`
   in this file, so it holds under the §6 rule that keeps the core
   movable, and so it can be exercised from a test without an Electron
   window.

   Every method returns a discriminated result rather than throwing. A
   store that is unreachable is an ordinary state for a desktop app on a
   phone tether, and an exception thrown through a React event handler
   becomes a blank panel with no explanation.
   ═══════════════════════════════════════════════════════════════════ */

export const DEFAULT_STORE_URL = 'http://127.0.0.1:8788';

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; detail?: string; status: number };

export interface StoreSkill {
  id: string;
  name: string;
  summary: string;
  description: string | null;
  author: string;
  majorVersion: number;
  latestVersion: string;
  toolApi: number;
  price: { amount: number; currency: string };
  free: boolean;
  posterUrl: string | null;
  previewUrl: string | null;
  verifiedAt: number | null;
  verifiedBuild: string | null;
  owned: boolean;
}

export interface StoreUser {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  msisdn: string | null;
  provider: string;
}

export interface DeviceAuth {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  interval: number;
  expiresIn: number;
}

export type DevicePoll =
  | { status: 'pending' | 'slow_down' | 'denied' | 'expired'; interval?: number }
  | { status: 'ok'; token: string; expiresAt: number; user: Omit<StoreUser, 'msisdn' | 'provider'> };

export interface Entitlement {
  skillId: string;
  majorVersion: number;
  source: string;
  grantedAt: number;
  licence: string | null;
}

export interface OrderState {
  orderId: string;
  status: 'created' | 'charging' | 'paid' | 'failed' | 'expired' | 'refunded';
  skillId?: string;
  amount?: number;
  currency?: string;
  receipt?: string | null;
  failureReason?: string | null;
  instruction?: string;
  msisdn?: string;
  provider?: string;
}

export class StoreClient {
  constructor(private baseUrl: string = DEFAULT_STORE_URL, private token: string | null = null) {}

  setToken(token: string | null): void { this.token = token; }
  setBaseUrl(url: string): void { this.baseUrl = url.replace(/\/+$/, ''); }

  private async call<T>(
    method: 'GET' | 'POST', path: string, body?: unknown
  ): Promise<Result<T>> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      /* Offline, DNS, TLS, a captive portal. All the same to the caller
         and all worth distinguishing from "the store said no". */
      return { ok: false, error: 'offline', detail: (err as Error).message, status: 0 };
    }

    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }

    if (!res.ok) {
      const e = parsed as { error?: string; detail?: string } | null;
      return {
        ok: false,
        error: e?.error ?? `http_${res.status}`,
        detail: e?.detail,
        status: res.status,
      };
    }
    return { ok: true, data: parsed as T };
  }

  /* ── auth ── */
  startDeviceAuth(provider: 'google' | 'github') {
    return this.call<DeviceAuth>('POST', '/v1/auth/device/start', { provider });
  }
  pollDeviceAuth(deviceCode: string) {
    return this.call<DevicePoll>('POST', '/v1/auth/device/poll', { deviceCode });
  }
  me() { return this.call<{ user: StoreUser }>('GET', '/v1/me'); }
  signOut() { return this.call<{ ok: true }>('POST', '/v1/auth/signout'); }

  /* ── catalogue ── */
  listSkills() { return this.call<{ skills: StoreSkill[]; signedIn: boolean }>('GET', '/v1/skills'); }
  getSkill(id: string) {
    return this.call<{ skill: StoreSkill; versions: unknown[] }>('GET', `/v1/skills/${encodeURIComponent(id)}`);
  }

  /* ── owning ── */
  entitlements() { return this.call<{ entitlements: Entitlement[] }>('GET', '/v1/entitlements'); }
  claimFree(skillId: string) {
    return this.call<{ licence: string | null; alreadyOwned: boolean }>(
      'POST', `/v1/skills/${encodeURIComponent(skillId)}/claim`, {}
    );
  }

  /* ── buying ── */
  createOrder(skillId: string, msisdn: string, provider?: string) {
    return this.call<OrderState>('POST', '/v1/orders', { skillId, msisdn, provider });
  }
  getOrder(orderId: string) {
    return this.call<OrderState>('GET', `/v1/orders/${encodeURIComponent(orderId)}`);
  }
}

/* ── Money, as the buyer reads it ─────────────────────────────────
   TZS has no practical subunit, so 5000 is five thousand shillings and
   not fifty. Dividing by 100 here would silently price everything at
   1% of what was intended, which is the kind of bug that only shows up
   in the payout. */
const ZERO_DECIMAL = new Set(['TZS', 'UGX', 'KES', 'RWF', 'JPY']);

export function formatPrice(amount: number, currency: string): string {
  if (amount === 0) return 'Free';
  const value = ZERO_DECIMAL.has(currency) ? amount : amount / 100;
  return `${currency} ${value.toLocaleString('en-US', {
    minimumFractionDigits: ZERO_DECIMAL.has(currency) ? 0 : 2,
    maximumFractionDigits: ZERO_DECIMAL.has(currency) ? 0 : 2,
  })}`;
}

/* Mirrors the server's own normaliser, so the field can say "that does
   not look right" before a round trip. The SERVER is still the one that
   decides — this is a courtesy, not a validation. */
export function looksLikeTzMsisdn(raw: string): boolean {
  const d = raw.replace(/[^\d]/g, '');
  return (d.startsWith('255') && d.length === 12) || (d.startsWith('0') && d.length === 10) || d.length === 9;
}

export const WALLETS = [
  { id: 'vodacom', label: 'Vodacom M-Pesa' },
  { id: 'tigo', label: 'Mixx by Yas (Tigo Pesa)' },
  { id: 'airtel', label: 'Airtel Money' },
  { id: 'halopesa', label: 'Halopesa' },
] as const;
