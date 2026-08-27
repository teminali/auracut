/* ═══════════════════════════════════════════════════════════════════
   What a trial count means, as one pure decision.

   Split from `electron/skillTrials.ts`, which owns the sealed file and
   the IPC, so the one judgement in the whole system can be tested
   without an app: **an unreadable ledger is SPENT, not fresh.**

   That is not a detail. The obvious implementation reads the counter,
   fails, and falls back to zero — which makes "corrupt the file" a
   reset button and the entire feature decorative. Everything else here
   is arithmetic.
   ═══════════════════════════════════════════════════════════════════ */

/** What the ledger had to say when it was read. */
export type LedgerKind = 'ok' | 'absent' | 'broken';

export interface TrialInput {
  skillId: string;
  /** What the publisher allows. 0 or less means the skill is not gated. */
  allowed: number;
  /** Runs already spent, from the ledger. Ignored unless `ledger` is 'ok'. */
  used: number;
  /** A verified entitlement for this skill. */
  owned: boolean;
  ledger: LedgerKind;
  /** Carried into the message when the ledger did not open. */
  ledgerMessage?: string;
  /**
   * Whether this exact piece of work was already paid for by an earlier
   * run.
   *
   * A trial run buys a SUBJECT, not an invocation. Somebody who spends a
   * run turning a recording into a tutorial owns that result: they can
   * undo it, reopen the project, change their mind about the backdrop
   * and apply it again, without watching a counter go down for work they
   * already bought. What costs a second run is pointing the skill at
   * DIFFERENT footage, which is the thing a publisher is actually
   * selling.
   *
   * Without this the honest-looking implementation punishes exactly the
   * behaviour a trial is meant to encourage: trying it properly.
   */
  alreadyGranted?: boolean;
}

export type TrialReason =
  | 'owned' | 'not-gated' | 'granted' | 'trial' | 'exhausted' | 'tampered';

/**
 * `remaining` when there is no limit.
 *
 * A number, not `Infinity`. `Infinity` is correct in JavaScript and does
 * not survive `JSON.stringify`, which turns it into `null` — so the
 * moment one of these verdicts is logged, cached or sent over anything
 * that serialises as JSON, "unlimited" silently becomes "none left".
 */
export const UNLIMITED = -1;

export interface TrialVerdict {
  skillId: string;
  allowed: number;
  used: number;
  /** `UNLIMITED` (-1) when there is no cap. Never `Infinity`; see above. */
  remaining: number;
  canRun: boolean;
  reason: TrialReason;
  message: string;
  /**
   * Always true while the ledger lives on this machine.
   *
   * Returned with every answer so the UI can say what this is rather
   * than implying more: deleting the ledger resets the count, there is
   * no fix for that which also lives on the machine, and the real one
   * is server-side against an account.
   */
  trialsAreLocal: boolean;
}

export function decideTrial(input: TrialInput): TrialVerdict {
  const base = { skillId: input.skillId, allowed: input.allowed, trialsAreLocal: true };

  /* Ownership first, and before the ledger is even consulted. Somebody
     who has paid must not be stopped by a ledger that will not open. */
  if (input.owned) {
    return {
      ...base, used: 0, remaining: UNLIMITED, canRun: true,
      reason: 'owned', message: 'You own this skill.',
    };
  }

  if (!Number.isFinite(input.allowed) || input.allowed <= 0) {
    return {
      ...base, used: 0, remaining: UNLIMITED, canRun: true,
      reason: 'not-gated', message: 'This skill is not on trial; it runs freely.',
    };
  }

  /*
    Before the ledger's count, and after ownership. Work that a previous
    run already covered stays available even when every run is spent —
    that is what stops a trial from taking back something it gave.
  */
  if (input.alreadyGranted && input.ledger !== 'broken') {
    const used = Math.max(0, Math.floor(input.used));
    return {
      ...base, used, remaining: Math.max(0, input.allowed - used), canRun: true,
      reason: 'granted',
      message: 'An earlier trial run already covered this, so it does not cost another.',
    };
  }

  if (input.ledger === 'broken') {
    return {
      ...base, used: input.allowed, remaining: 0, canRun: false, reason: 'tampered',
      message: `${input.ledgerMessage ?? 'The trial ledger did not open.'} `
        + 'Until the skill is bought, its trials are treated as used.',
    };
  }

  const used = input.ledger === 'ok' ? Math.max(0, Math.floor(input.used)) : 0;
  const remaining = Math.max(0, input.allowed - used);
  const runs = (n: number) => `${n} trial run${n === 1 ? '' : 's'}`;

  return {
    ...base,
    used,
    remaining,
    canRun: remaining > 0,
    reason: remaining > 0 ? 'trial' : 'exhausted',
    message: remaining > 0
      ? `${remaining} of ${runs(input.allowed)} left.`
      : `All ${runs(input.allowed)} have been used.`,
  };
}
