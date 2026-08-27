/*
 * Two things a skills marketplace cannot be wrong about, tested where
 * they can be tested: without an app, a disk or a device.
 *
 *   1. A trial that has been spent stays spent, INCLUDING when the file
 *      holding the count will not open. The obvious implementation
 *      falls back to zero there, which makes corrupting the file a
 *      reset button and the whole feature decorative.
 *
 *   2. A sealed file that has been edited FAILS rather than decrypting
 *      to something plausible. That property is the only reason (1) is
 *      enforceable, so it is asserted rather than assumed of the cipher.
 */
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decideTrial, UNLIMITED } from './trialPolicy';
import { seal, open, subKey, ENVELOPE_MAGIC } from './sealedEnvelope';

const KEY = randomBytes(32);

/* ── The decision ───────────────────────────────────────────────── */

describe('trial policy', () => {
  const base = { skillId: 'tutorial', allowed: 3, used: 0, owned: false, ledger: 'ok' as const };

  it('gives the publisher the number of runs they set', () => {
    expect(decideTrial({ ...base, used: 0 }).remaining).toBe(3);
    expect(decideTrial({ ...base, used: 2 }).remaining).toBe(1);
    expect(decideTrial({ ...base, used: 2 }).canRun).toBe(true);
  });

  it('stops the run once they are spent', () => {
    const spent = decideTrial({ ...base, used: 3 });
    expect(spent.canRun).toBe(false);
    expect(spent.reason).toBe('exhausted');
    expect(spent.message).toContain('All 3 trial runs');
  });

  it('treats an unreadable ledger as SPENT, not as fresh', () => {
    /*
      The decision this module exists for. Falling back to zero here is
      the natural thing to write and it hands anybody with a text editor
      unlimited runs of every paid skill.
    */
    const broken = decideTrial({ ...base, ledger: 'broken', ledgerMessage: 'It did not decrypt.' });
    expect(broken.canRun).toBe(false);
    expect(broken.reason).toBe('tampered');
    expect(broken.remaining).toBe(0);
    expect(broken.message).toContain('It did not decrypt.');
  });

  it('never blocks somebody who has paid, even on a broken ledger', () => {
    /*
      Ownership is checked before the ledger is consulted at all. A
      corrupt counter locking out a paying customer would be the worst
      failure this system has, and it is exactly what a naive ordering
      produces: read the ledger, fail closed, and never reach the
      entitlement.
    */
    const owner = decideTrial({ ...base, owned: true, ledger: 'broken' });
    expect(owner.canRun).toBe(true);
    expect(owner.reason).toBe('owned');
  });

  it('does not charge again for work an earlier run already covered', () => {
    /*
      A trial run buys a SUBJECT, not an invocation. Somebody who spends
      a run turning a recording into a tutorial can undo it, reopen the
      project and apply it again without the counter moving; what costs
      a second run is pointing the skill at different footage. Charging
      per invocation punishes the one behaviour a trial exists to
      encourage, which is trying it properly.
    */
    const again = decideTrial({ ...base, used: 3, alreadyGranted: true });
    expect(again.canRun).toBe(true);
    expect(again.reason).toBe('granted');
    // And it does not pretend the runs came back.
    expect(again.used).toBe(3);
    expect(again.remaining).toBe(0);
  });

  it('does not let a granted subject survive a tampered ledger', () => {
    /*
      "Already covered" is a claim READ FROM the ledger. If the ledger
      did not open, the claim has no source, and honouring it would hand
      anybody who corrupts the file unlimited runs by simply asserting
      they had one before.
    */
    const broken = decideTrial({ ...base, alreadyGranted: true, ledger: 'broken' });
    expect(broken.canRun).toBe(false);
    expect(broken.reason).toBe('tampered');
  });

  it('leaves an ungated skill alone', () => {
    for (const allowed of [0, -1, Number.NaN]) {
      const free = decideTrial({ ...base, allowed, used: 99 });
      expect(free.canRun).toBe(true);
      expect(free.reason).toBe('not-gated');
    }
  });

  it('counts a fresh install as unused without inventing a number', () => {
    const fresh = decideTrial({ ...base, ledger: 'absent', used: 7 });
    expect(fresh.used).toBe(0);
    expect(fresh.remaining).toBe(3);
  });

  it('reports unlimited as a number that survives JSON', () => {
    /*
      `Infinity` is the correct value and `JSON.stringify` turns it into
      `null`, so a verdict that is ever logged, cached or sent anywhere
      as JSON would come back reading as "none left" for exactly the
      people who have paid.
    */
    for (const verdict of [
      decideTrial({ ...base, owned: true }),
      decideTrial({ ...base, allowed: 0 }),
    ]) {
      expect(verdict.remaining).toBe(UNLIMITED);
      expect(JSON.parse(JSON.stringify(verdict)).remaining).toBe(UNLIMITED);
      expect(verdict.canRun).toBe(true);
    }
  });

  it('says out loud that the count is local', () => {
    // The UI must not be able to imply a stronger guarantee than exists.
    expect(decideTrial(base).trialsAreLocal).toBe(true);
    expect(decideTrial({ ...base, owned: true }).trialsAreLocal).toBe(true);
  });
});

/* ── The seal ───────────────────────────────────────────────────── */

describe('sealed envelope', () => {
  it('round-trips', () => {
    const text = JSON.stringify({ skills: { tutorial: { used: 2 } } });
    const sealed = seal(KEY, 'skill-trials', text);
    expect(sealed.startsWith(`${ENVELOPE_MAGIC}.skill-trials.`)).toBe(true);
    const opened = open(KEY, 'skill-trials', sealed);
    expect(opened.ok && opened.plaintext).toBe(text);
  });

  it('does not leave the contents readable', () => {
    const sealed = seal(KEY, 'skill-trials', '{"used":2}');
    expect(sealed).not.toContain('used');
    expect(sealed).not.toContain('{');
  });

  it('FAILS on a changed byte rather than decrypting to something plausible', () => {
    /*
      The property everything else rests on. An unauthenticated cipher
      would hand back garbage that a JSON parse might well survive.
    */
    const sealed = seal(KEY, 'skill-trials', '{"used":3}');
    const parts = sealed.split('.');
    const body = Buffer.from(parts[4], 'base64url');
    body[0] ^= 0x01;
    parts[4] = body.toString('base64url');

    const opened = open(KEY, 'skill-trials', parts.join('.'));
    expect(opened.ok).toBe(false);
    expect(!opened.ok && opened.reason).toBe('tampered');
  });

  it('fails on a swapped authentication tag', () => {
    const a = seal(KEY, 'skill-trials', '{"used":3}').split('.');
    const b = seal(KEY, 'skill-trials', '{"used":0}').split('.');
    a[3] = b[3];
    const opened = open(KEY, 'skill-trials', a.join('.'));
    expect(opened.ok).toBe(false);
  });

  it('refuses a file sealed for another purpose', () => {
    /*
      Two files, one key. Without a per-purpose derivation a ciphertext
      from the take sidecar could be dropped into the trial ledger and
      would decrypt. It has to be a failure, not a surprise.
    */
    const sidecar = seal(KEY, 'take-sidecar', '{"samples":[]}');
    const opened = open(KEY, 'skill-trials', sidecar);
    expect(opened.ok).toBe(false);
    expect(!opened.ok && opened.reason).toBe('wrong-purpose');

    // And the keys really are different, not merely labelled differently.
    expect(subKey(KEY, 'skill-trials').equals(subKey(KEY, 'take-sidecar'))).toBe(false);
  });

  it('will not open under another install key', () => {
    const sealed = seal(KEY, 'skill-trials', '{"used":3}');
    const opened = open(randomBytes(32), 'skill-trials', sealed);
    expect(opened.ok).toBe(false);
    expect(!opened.ok && opened.reason).toBe('tampered');
  });

  it('recognises a plain file as plain rather than as damaged', () => {
    /*
      A take assembled by hand, or one written before any of this
      existed, has to keep working. `not-sealed` is a different answer
      from `tampered` and the caller is allowed to use the file.
    */
    const opened = open(KEY, 'take-sidecar', '{"samples":[],"marks":[]}');
    expect(opened.ok).toBe(false);
    expect(!opened.ok && opened.reason).toBe('not-sealed');
  });
});
