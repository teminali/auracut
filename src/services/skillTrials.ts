/* ═══════════════════════════════════════════════════════════════════
   The gate every skill run passes through.

   Thin on purpose. The COUNT lives in main, sealed, because a renderer
   that could edit it would make the whole thing a suggestion; the
   decision lives in `trialPolicy.ts` because it needs testing; this is
   the doorway.

   Two rules it enforces that a caller could otherwise get wrong:

     1. Ownership is asked FOR, not assumed. A caller passing
        `owned: false` for a skill somebody bought would spend a trial
        run they did not need to.
     2. A run is CONSUMED, not merely checked. `check` and `consume` are
        separate calls and a caller that only checks gets a skill that
        is free forever. `runSkill` below is the shape that cannot be
        used wrongly: it spends first and only then runs.
   ═══════════════════════════════════════════════════════════════════ */

import { TrialStatus } from '../types/electron';
import { UNLIMITED } from './trialPolicy';

export { UNLIMITED };

/**
 * A skill that is not gated at all.
 *
 * Bundled skills land here: they ship inside the app, so counting runs
 * of them would be gating the user out of something they already have.
 */
const UNGATED: TrialStatus = {
  skillId: '',
  allowed: 0,
  used: 0,
  remaining: UNLIMITED,
  canRun: true,
  reason: 'not-gated',
  message: 'This skill is not on trial; it runs freely.',
  trialsAreLocal: true,
};

export async function trialStatus(
  skillId: string,
  allowed: number,
  owned: boolean,
  scope?: string
): Promise<TrialStatus> {
  const api = window.electronAPI?.trials;
  /*
    No desktop app means no sealed ledger, and there is nothing weaker
    to fall back to that would be worth having. Reporting `not-gated` is
    the honest answer for a build that cannot count at all, rather than
    a count kept somewhere a page can edit.
  */
  if (!api) return { ...UNGATED, skillId, allowed };
  return api.status(skillId, allowed, owned, scope);
}

/**
 * Spend one run and do the work, or refuse and say why.
 *
 * The order matters and is the reason this exists rather than a pair of
 * exported calls: the run is spent BEFORE the work starts. Spending
 * afterwards means a skill that throws halfway is free, and a skill
 * that is quit mid-run is free forever.
 */
export async function runSkill<T>(
  skillId: string,
  allowed: number,
  owned: boolean,
  scope: string | undefined,
  work: () => Promise<T>
): Promise<{ ok: true; result: T; status: TrialStatus } | { ok: false; status: TrialStatus }> {
  const api = window.electronAPI?.trials;
  if (!api) return { ok: true, result: await work(), status: { ...UNGATED, skillId, allowed } };

  const spent = await api.consume(skillId, allowed, owned, scope);
  if (!spent.ok) return { ok: false, status: spent.status };
  return { ok: true, result: await work(), status: spent.status };
}

/** Forget a skill's spent trials once it has actually been bought. */
export async function forgetTrialsFor(skillId: string): Promise<void> {
  await window.electronAPI?.trials.clearBought(skillId);
}
