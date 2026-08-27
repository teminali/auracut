/* ═══════════════════════════════════════════════════════════════════
   Skill trials.

   A publisher says how many times a skill may be run before it is
   bought. `skill.json` carries `trial: { uses: 3 }`; the store's
   catalogue carries the same number; this counts.

   ── Where the count lives, and why it is not a number in a file ────

   In `userData`, sealed by `vault.ts`, 0600. The seal is AES-GCM, which
   is authenticated, so the useful property is not secrecy but
   TAMPER-EVIDENCE: an edited ledger does not decrypt to a smaller
   number, it fails to decrypt at all. And a failed decrypt is treated
   as EXHAUSTED rather than as empty, which is the single decision that
   makes this worth building — the obvious implementation treats an
   unreadable ledger as "no trials used", so corrupting the file is a
   reset button.

   ── What this cannot do ────────────────────────────────────────────

   Deleting the ledger resets the trials on that machine. There is no
   fix for that which lives on the machine: anything Kerf can find,
   somebody can delete, and anything hidden well enough to survive is
   something an uninstall should have removed and did not.

   The real fix is server-side, against an account, and the store
   already has the account and the entitlement table to hang it on. It
   is not built here because it needs a schema change and a deploy, and
   shipping an unverified half of it would be worse than shipping this
   half and saying where the line is. `trialsAreLocal` is returned with
   every answer so the UI can say so rather than implying more.

   None of which is an argument for skipping it. A trial that survives a
   text editor and an app restart is what publishers are actually asking
   for; a trial that survives a determined person is not something
   anybody sells.
   ═══════════════════════════════════════════════════════════════════ */

import { app, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { writeSealed, readMaybeSealed } from './vault';
import { decideTrial, TrialVerdict } from '../src/services/trialPolicy';

const PURPOSE = 'skill-trials';
const FILE = () => path.join(app.getPath('userData'), 'skill-trials.kerf');

interface TrialRecord {
  used: number;
  firstAt: number;
  lastAt: number;
  /**
   * The subjects earlier runs bought, as opaque ids the caller supplies.
   *
   * For the tutorial skill a subject is a TAKE: spend a run on a
   * recording and that recording is yours to keep applying the skill to.
   * Point it at different footage and that is a different subject and a
   * different run. It is the line that lets somebody keep editing what
   * they made without letting them re-use the skill for free.
   */
  scopes?: string[];
}

interface Ledger {
  version: 1;
  /** Bumped on every write, so a restored older copy is visible. */
  seq: number;
  skills: Record<string, TrialRecord>;
}

const EMPTY: Ledger = { version: 1, seq: 0, skills: {} };

/**
 * The state a ledger read can be in.
 *
 * `sealed-broken` is the one that matters and the one an ordinary
 * implementation does not have: the file exists, it is a Kerf envelope,
 * and it did not open. That is not "no trials used".
 */
type LedgerState =
  | { kind: 'ok'; ledger: Ledger }
  | { kind: 'absent' }
  | { kind: 'sealed-broken'; message: string };

function read(): LedgerState {
  const file = FILE();
  if (!fs.existsSync(file)) return { kind: 'absent' };

  const opened = readMaybeSealed(file, PURPOSE);
  if (!opened.ok) return { kind: 'sealed-broken', message: opened.message };

  try {
    const parsed = JSON.parse(opened.plaintext) as Ledger;
    if (parsed?.version !== 1 || typeof parsed.skills !== 'object') {
      return { kind: 'sealed-broken', message: 'The trial ledger is not in a shape this build understands.' };
    }
    return { kind: 'ok', ledger: parsed };
  } catch {
    return { kind: 'sealed-broken', message: 'The trial ledger could not be parsed.' };
  }
}

function write(ledger: Ledger): void {
  try {
    writeSealed(FILE(), PURPOSE, JSON.stringify({ ...ledger, seq: ledger.seq + 1 }));
  } catch {
    /*
      Nothing to do about it here, and refusing to run the skill would
      punish the user for a disk problem. The next `status` call reads
      `absent` and the UI shows the trials as unused, which is the
      failure direction that does not strand somebody mid-edit.
    */
  }
}

/* ── The answer ─────────────────────────────────────────────────── */

export type TrialStatus = TrialVerdict;

/**
 * The ledger, read, and turned into an answer.
 *
 * The judgement itself is in `src/services/trialPolicy.ts` so it can be
 * tested without an app; this half is the file. The one thing worth
 * noticing here is that `sealed-broken` is passed through as `broken`
 * rather than being collapsed into `absent`, because those two mean
 * opposite things: absent is a fresh install, broken is a file that was
 * edited.
 */
function decide(skillId: string, allowed: number, owned: boolean, scope?: string): TrialStatus {
  const state = read();
  const record = state.kind === 'ok' ? state.ledger.skills[skillId] : undefined;
  return decideTrial({
    skillId,
    allowed,
    owned,
    used: record?.used ?? 0,
    ledger: state.kind === 'ok' ? 'ok' : state.kind === 'absent' ? 'absent' : 'broken',
    ledgerMessage: state.kind === 'sealed-broken' ? state.message : undefined,
    alreadyGranted: Boolean(scope && record?.scopes?.includes(scope)),
  });
}

export function initSkillTrials(): void {
  ipcMain.handle(
    'trials:status',
    (_e, p: { skillId: string; allowed: number; owned?: boolean; scope?: string }) =>
      decide(p.skillId, p.allowed, Boolean(p.owned), p.scope)
  );

  /**
   * Spend one run.
   *
   * Returns the status AFTER spending, so a caller cannot ask and act on
   * two different answers. It also refuses rather than going negative
   * when the trial is already spent, which is what makes a caller that
   * forgot to check first still safe.
   */
  ipcMain.handle(
    'trials:consume',
    (_e, p: { skillId: string; allowed: number; owned?: boolean; scope?: string }) => {
      const before = decide(p.skillId, p.allowed, Boolean(p.owned), p.scope);
      if (!before.canRun) return { ok: false, status: before };

      /* Nothing to spend: not gated, already paid for, or already
         covered by an earlier run on this same subject. */
      if (before.reason === 'owned' || before.reason === 'not-gated' || before.reason === 'granted') {
        return { ok: true, status: before };
      }

      const state = read();
      const ledger = state.kind === 'ok' ? state.ledger : { ...EMPTY, skills: {} };
      const now = Date.now();
      const record = ledger.skills[p.skillId];
      const scopes = record?.scopes ?? [];
      ledger.skills[p.skillId] = {
        used: (record?.used ?? 0) + 1,
        firstAt: record?.firstAt ?? now,
        lastAt: now,
        /* Capped. A publisher's three runs cannot produce more than three
           subjects, and an unbounded list in a file that is read on every
           check is a slow leak nobody would look for. */
        scopes: p.scope ? [...scopes, p.scope].slice(-64) : scopes,
      };
      write(ledger);

      return { ok: true, status: decide(p.skillId, p.allowed, Boolean(p.owned), p.scope) };
    }
  );

  /**
   * Forget one skill's trials.
   *
   * Only for a skill that has since been BOUGHT: a purchase should not
   * leave a spent trial behind to reappear if the entitlement lapses
   * while the app is open. Not exposed as "reset my trials", because it
   * is not that.
   */
  ipcMain.handle('trials:clearBought', (_e, p: { skillId: string }) => {
    const state = read();
    if (state.kind !== 'ok') return { ok: false };
    if (!state.ledger.skills[p.skillId]) return { ok: true };
    delete state.ledger.skills[p.skillId];
    write(state.ledger);
    return { ok: true };
  });
}
