/* ═══════════════════════════════════════════════════════════════════
   The account, the catalogue, and what this machine is allowed to run.

   Three-valued throughout, because HANDOVER §3 is emphatic about it and
   this codebase got it wrong three times in a row: `unknown` is not
   `signed_out`. A sign-in button rendered while the session file has
   not been read yet is a lie that flashes on every launch.

   Entitlements are held with their VERIFIED payloads rather than as the
   server's word. Nothing here trusts a `licence` string it has not put
   through `verifyLicence`, so a tampered or expired one is visible as
   a distinct state instead of quietly counting as ownership.
   ═══════════════════════════════════════════════════════════════════ */

import { create } from 'zustand';
import {
  StoreClient, DEFAULT_STORE_URL,
  type StoreSkill, type StoreUser, type DeviceAuth, type OrderState,
} from '../services/storeClient';
import { verifyLicence, type LicencePayload } from '../services/licenceKey';
import { loadSession, saveSession, dropSession } from '../services/session';
import { SUPPORTED_SKILL_TOOL_API } from '../services/bundledSkills';

export type AuthStatus = 'unknown' | 'signed_out' | 'signed_in';

export interface OwnedSkill {
  skillId: string;
  majorVersion: number;
  source: string;
  grantedAt: number;
  /** 'valid' | 'expired' | 'unverified' — never assumed, always checked. */
  licenceState: 'valid' | 'expired' | 'unverified';
  licence: string | null;
  payload: LicencePayload | null;
}

export type SignInPhase =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'waiting'; auth: DeviceAuth }
  | { phase: 'error'; message: string };

export type PurchasePhase =
  | { phase: 'idle' }
  | { phase: 'creating'; skillId: string }
  | { phase: 'awaiting_pin'; skillId: string; order: OrderState }
  | { phase: 'done'; skillId: string }
  | { phase: 'error'; skillId: string; message: string };

interface AccountState {
  client: StoreClient;
  baseUrl: string;
  status: AuthStatus;
  user: StoreUser | null;
  /** Whether the last store call reached the server at all. */
  reachable: boolean | null;

  skills: StoreSkill[];
  catalogueLoaded: boolean;
  owned: OwnedSkill[];

  signIn: SignInPhase;
  purchase: PurchasePhase;

  init: () => Promise<void>;
  beginSignIn: (provider: 'google' | 'github') => Promise<void>;
  cancelSignIn: () => void;
  signOut: () => Promise<void>;
  refreshCatalogue: () => Promise<void>;
  refreshEntitlements: () => Promise<void>;
  claimFree: (skillId: string) => Promise<{ ok: boolean; message: string }>;
  buy: (skillId: string, msisdn: string, provider?: string) => Promise<void>;
  installManifestUpdate: (skillId: string, version: string) => Promise<{ ok: boolean; message: string }>;
  resetPurchase: () => void;
  ownsSkill: (skillId: string, majorVersion: number) => boolean;
}

/** Stops a poll loop when the user cancels or the component unmounts. */
let signInCancelled = false;

export const useAccountStore = create<AccountState>((set, get) => ({
  client: new StoreClient(DEFAULT_STORE_URL),
  baseUrl: DEFAULT_STORE_URL,
  status: 'unknown',
  user: null,
  reachable: null,

  skills: [],
  catalogueLoaded: false,
  owned: [],

  signIn: { phase: 'idle' },
  purchase: { phase: 'idle' },

  init: async () => {
    const { session, baseUrl } = await loadSession();
    const url = baseUrl ?? DEFAULT_STORE_URL;
    const client = new StoreClient(url, session?.token ?? null);
    set({ client, baseUrl: url });

    if (!session) {
      set({ status: 'signed_out' });
      // The catalogue is public. Show it to somebody who has not signed
      // in — a store you must join to look at is a store nobody looks at.
      await get().refreshCatalogue();
      return;
    }

    const me = await client.me();
    if (me.ok) {
      set({ status: 'signed_in', user: me.data.user, reachable: true });
      await Promise.all([get().refreshCatalogue(), get().refreshEntitlements()]);
    } else if (me.status === 401) {
      // The token is genuinely dead — drop it rather than retrying it
      // on every launch for the next ninety days.
      await dropSession();
      client.setToken(null);
      set({ status: 'signed_out', user: null, reachable: true });
      await get().refreshCatalogue();
    } else {
      /*
        Offline, or the store is down. This is NOT signed out: the token
        is still good and the person still owns what they own. Staying
        `unknown` would hide the whole UI, so the session is honoured
        and `reachable` carries the bad news.
      */
      set({ status: 'signed_in', reachable: false });
    }
  },

  beginSignIn: async (provider) => {
    signInCancelled = false;
    set({ signIn: { phase: 'starting' } });

    const started = await get().client.startDeviceAuth(provider);
    if (!started.ok) {
      set({ signIn: { phase: 'error', message: started.detail ?? started.error } });
      return;
    }
    set({ signIn: { phase: 'waiting', auth: started.data } });

    /*
      Poll until the provider answers. The interval comes from the
      provider and is echoed back by our own server, which also enforces
      it — so a bug here cannot burn the OAuth quota for everyone else.
    */
    let interval = started.data.interval * 1000;
    const deadline = Date.now() + started.data.expiresIn * 1000;

    while (!signInCancelled && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      if (signInCancelled) return;

      const poll = await get().client.pollDeviceAuth(started.data.deviceCode);
      if (!poll.ok) {
        set({ signIn: { phase: 'error', message: poll.detail ?? poll.error } });
        return;
      }
      const d = poll.data;

      if (d.status === 'ok') {
        await saveSession({ token: d.token, expiresAt: d.expiresAt });
        get().client.setToken(d.token);
        set({ status: 'signed_in', signIn: { phase: 'idle' }, reachable: true });
        const me = await get().client.me();
        if (me.ok) set({ user: me.data.user });
        await Promise.all([get().refreshCatalogue(), get().refreshEntitlements()]);
        return;
      }
      if (d.status === 'denied') {
        set({ signIn: { phase: 'error', message: 'Sign-in was declined.' } });
        return;
      }
      if (d.status === 'expired') {
        set({ signIn: { phase: 'error', message: 'That code expired. Start again.' } });
        return;
      }
      if (d.status === 'slow_down' && d.interval) interval = d.interval * 1000;
    }

    if (!signInCancelled) {
      set({ signIn: { phase: 'error', message: 'That code expired. Start again.' } });
    }
  },

  cancelSignIn: () => {
    signInCancelled = true;
    set({ signIn: { phase: 'idle' } });
  },

  signOut: async () => {
    await get().client.signOut();
    await dropSession();
    get().client.setToken(null);
    set({ status: 'signed_out', user: null, owned: [], purchase: { phase: 'idle' } });
    await get().refreshCatalogue();
  },

  refreshCatalogue: async () => {
    const res = await get().client.listSkills();
    if (!res.ok) {
      set({ reachable: res.status === 0 ? false : true, catalogueLoaded: true });
      return;
    }
    set({ skills: res.data.skills, catalogueLoaded: true, reachable: true });
  },

  refreshEntitlements: async () => {
    const res = await get().client.entitlements();
    if (!res.ok) {
      set({ reachable: res.status === 0 ? false : get().reachable });
      return;
    }

    const owned: OwnedSkill[] = [];
    for (const e of res.data.entitlements) {
      let licenceState: OwnedSkill['licenceState'] = 'unverified';
      let payload: LicencePayload | null = null;

      if (e.licence) {
        const verdict = await verifyLicence(e.licence);
        if (verdict.valid) {
          licenceState = 'valid';
          payload = verdict.payload;
        } else if (verdict.reason === 'expired') {
          licenceState = 'expired';
          payload = verdict.payload ?? null;
        }
        /*
          A `bad_signature` stays 'unverified'. That is not a hostile
          user — far more likely the client is running against a key
          the server does not have, which is exactly the mistake a
          production build makes when nobody replaced the dev key. It
          has to be visible, not silently treated as ownership.
        */
      }
      owned.push({
        skillId: e.skillId, majorVersion: e.majorVersion, source: e.source,
        grantedAt: e.grantedAt, licenceState, licence: e.licence, payload,
      });
    }
    set({ owned, reachable: true });
  },

  claimFree: async (skillId) => {
    const res = await get().client.claimFree(skillId);
    if (!res.ok) {
      return { ok: false, message: res.detail ?? res.error };
    }
    await Promise.all([get().refreshEntitlements(), get().refreshCatalogue()]);
    return {
      ok: true,
      message: res.data.alreadyOwned ? 'You already had this one.' : 'Added to your skills.',
    };
  },

  buy: async (skillId, msisdn, provider) => {
    set({ purchase: { phase: 'creating', skillId } });

    const created = await get().client.createOrder(skillId, msisdn, provider);
    if (!created.ok) {
      if (created.status === 409) {
        // Already owned. Not a failure — refresh and show it as theirs.
        await get().refreshEntitlements();
        set({ purchase: { phase: 'done', skillId } });
        return;
      }
      set({ purchase: { phase: 'error', skillId, message: created.detail ?? created.error } });
      return;
    }

    const order = created.data;
    set({ purchase: { phase: 'awaiting_pin', skillId, order } });

    /*
      From here the buyer is looking at their handset, not at TeminaliCut. Poll
      our own order — which reconciles against the gateway once the
      webhook has had its chance — until it is terminal or the push has
      plainly been ignored.
    */
    const deadline = Date.now() + 3 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      const poll = await get().client.getOrder(order.orderId);
      if (!poll.ok) continue;

      if (poll.data.status === 'paid') {
        await Promise.all([get().refreshEntitlements(), get().refreshCatalogue()]);
        set({ purchase: { phase: 'done', skillId } });
        return;
      }
      if (poll.data.status === 'failed' || poll.data.status === 'expired') {
        set({
          purchase: {
            phase: 'error', skillId,
            message: poll.data.failureReason
              ?? 'The payment did not go through. Nothing was charged.',
          },
        });
        return;
      }
      set({ purchase: { phase: 'awaiting_pin', skillId, order: poll.data } });
    }

    set({
      purchase: {
        phase: 'error', skillId,
        // Deliberately not "it failed": a push can be confirmed late,
        // and telling somebody nothing was charged when it might have
        // been is the one message that must never be guessed.
        message: 'No confirmation arrived within three minutes. '
          + 'If your PIN was accepted, the skill will appear here shortly.',
      },
    });
  },

  installManifestUpdate: async (skillId, version) => {
    const bridge = window.electronAPI?.userSkills;
    if (!bridge) return { ok: false, message: 'Skill updates need the desktop app.' };

    const downloaded = await get().client.getSkillManifest(skillId, version);
    if (!downloaded.ok) {
      return { ok: false, message: downloaded.detail ?? downloaded.error };
    }

    const manifest = downloaded.data.manifest as {
      id?: unknown; version?: unknown; toolApi?: unknown;
    };
    if (manifest.id !== skillId || manifest.version !== version) {
      return { ok: false, message: 'The downloaded manifest does not match the requested skill release.' };
    }
    if (typeof manifest.toolApi !== 'number' || manifest.toolApi > SUPPORTED_SKILL_TOOL_API) {
      return {
        ok: false,
        message: `This manifest needs tool API ${String(manifest.toolApi)}; this TeminaliCut build supports ${SUPPORTED_SKILL_TOOL_API}.`,
      };
    }

    const written = await bridge.write(downloaded.data.manifest);
    if (!written.ok) {
      return { ok: false, message: written.problems.join(' ') };
    }

    window.dispatchEvent(new Event('kerf:skills-changed'));
    return {
      ok: true,
      message: `Skill settings and guidance updated to ${version}. Tool behaviour still comes from this TeminaliCut build.`,
    };
  },

  resetPurchase: () => set({ purchase: { phase: 'idle' } }),

  ownsSkill: (skillId, majorVersion) =>
    get().owned.some(
      (o) => o.skillId === skillId && o.majorVersion === majorVersion && o.licenceState !== 'unverified'
    ),
}));
