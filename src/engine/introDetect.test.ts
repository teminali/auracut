/*
  Does the skill know an introduction when it hears one?

  This is the only part of the tutorial skill that makes a judgement
  about MEANING rather than about pixels or timing, so it is the part
  most able to be confidently wrong. Getting it wrong in one direction
  costs nothing — the camera stays an inset, which is what the skill did
  before. Getting it wrong in the other direction covers the screen with
  somebody's face while they are showing you the thing you came for.

  So the negative cases below outnumber the positive ones on purpose,
  and every one of them is a take somebody would plausibly record.
*/
import { describe, it, expect } from 'vitest';
import { detectIntroduction, SpeechCue } from './recordingProject';

/** Cues laid end to end from `startMs`, each `perMs` long with a small gap. */
const say = (startMs: number, lines: string[], perMs = 1800, gapMs = 120): SpeechCue[] =>
  lines.map((text, i) => ({
    startMs: startMs + i * (perMs + gapMs),
    endMs: startMs + i * (perMs + gapMs) + perMs,
    text,
  }));

const click = (tMs: number) => ({ tMs, kind: 'click' });

describe('hearing an introduction', () => {
  it('takes a greeting, a name and a framing as an introduction', () => {
    const v = detectIntroduction(
      say(0, ["Hi everyone, my name is Sam.", "Today I'm going to show you how the importer works."]),
      []
    );
    expect(v.intro).not.toBeNull();
    expect(v.intro!.startMs).toBe(0);
    expect(v.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it('takes a greeting plus a framing, with no name', () => {
    const v = detectIntroduction(
      say(0, ["Hey, welcome back to the channel.", "In this video we're going to set up billing."]),
      []
    );
    expect(v.intro).not.toBeNull();
  });

  it('takes somebody naming themselves as decisive on its own', () => {
    /* Nothing else in a screen recording sounds like a person saying
       their own name, so it does not need a second marker. */
    /* 3.4s, which is about how long that sentence takes to say. A
       shorter one is refused on length whatever the words are, and
       rightly: cutting the camera in and out inside two seconds is a
       flinch, not an opening. */
    const v = detectIntroduction(
      say(0, ["My name is Priya and I look after onboarding here."], 3400),
      []
    );
    expect(v.intro).not.toBeNull();
    expect(v.evidence).toContain('naming themselves');
  });

  it('runs the introduction to the end of the talking, not to a fixed length', () => {
    const v = detectIntroduction(
      say(0, [
        "Hi, my name is Sam.",
        "I've been working on this importer for about three months.",
        "Today I'll walk you through what it does.",
      ]),
      []
    );
    expect(v.intro!.endMs).toBeGreaterThan(5000);
  });

  it('ends it the moment WORK starts on screen', () => {
    const v = detectIntroduction(
      say(0, ["Hi, my name is Sam.", "Today I'll show you the importer.", "So first of all."]),
      [click(4000), click(5200)]
    );
    expect(v.intro).not.toBeNull();
    expect(v.intro!.endMs).toBeLessThanOrEqual(4000);
  });

  it('is not ended by ONE stray click with nothing around it', () => {
    /*
      Measured on a real take: an isolated click at 204ms, another at
      21804ms, and the actual work starting at 30725ms with a click and a
      scroll burst 1.5s later. Ending the introduction at 204ms was
      correct by the old rule and wrong about the take. A lone click is a
      window being focused or a notification going away.
    */
    const v = detectIntroduction(
      say(0, ["Hi, my name is Sam.", "Today I'll show you the importer.", "Let's begin."]),
      [click(204), click(21804), click(30725), click(32233)]
    );
    expect(v.intro).not.toBeNull();
    expect(v.intro!.endMs).toBeGreaterThan(5000);
  });

  it('takes a long opening in a language it has no markers for', () => {
    /*
      Every marker is an English phrase, so requiring one makes this an
      English-only feature. Eight uninterrupted seconds of talking at the
      very start, over a screen nobody is touching, is an introduction in
      any language. This is the Swahili take that found it.
    */
    const v = detectIntroduction(
      say(0, [
        'Habari zenu, jina langu ni Sam.',
        'Leo nitawaonyesha jinsi mfumo huu unavyofanya kazi.',
        'Tutaanza na integration.',
        'Halafu tutaendelea na connection.',
        'Ni rahisi sana kufanya hivi.',
      ]),
      [click(30000), click(31200)]
    );
    expect(v.intro).not.toBeNull();
    expect(v.evidence.join(' ')).toMatch(/uninterrupted talking/);
  });

  it('stops the introduction where the pointing starts, rather than throwing it away', () => {
    /* A take that introduces itself and THEN starts demoing has an
       introduction in it. Discarding the whole thing because of what was
       said thirty seconds later is the wrong answer. */
    const v = detectIntroduction(
      say(0, [
        "Hi everyone, my name is Sam.",
        "Today I'm going to show you the importer.",
        "So here you can see the dashboard.",
        "And this button runs it.",
      ]),
      [click(30000), click(31200)]
    );
    expect(v.intro).not.toBeNull();
    /* Two cues of 1800ms plus a 120ms gap: the introduction ends before
       the third one starts. */
    expect(v.intro!.endMs).toBeLessThan(3840);
  });

  /* ── The refusals, which are the point ─────────────────────────── */

  it('refuses when the first thing that happens is real work', () => {
    const v = detectIntroduction(
      say(0, ["Hi, my name is Sam and today I'll show you the importer."]),
      [click(400), click(1100)]
    );
    expect(v.intro).toBeNull();
    expect(v.reason).toMatch(/2500ms|introduction has to last/);
  });

  it('refuses a take that opens by pointing at the screen', () => {
    /* The words are friendly and there is no input yet, and it is still
       a demo: they are looking at the picture. */
    const v = detectIntroduction(
      say(0, ["Hey, so here you can see the dashboard.", "Today I'll show you around it."]),
      []
    );
    expect(v.intro).toBeNull();
    expect(v.reason).toMatch(/pointing at the screen/);
  });

  it('refuses ordinary narration that happens to say "today"', () => {
    const v = detectIntroduction(
      say(0, ["Today's numbers are already loaded.", "So the totals should be about right."]),
      []
    );
    expect(v.intro).toBeNull();
  });

  it('refuses a single greeting with nothing after it', () => {
    const v = detectIntroduction(
      say(0, ["Hey.", "Right.", "Okay."], 400, 900),
      []
    );
    expect(v.intro).toBeNull();
  });

  it('refuses when the talking starts too late to be an opening', () => {
    const v = detectIntroduction(
      say(6000, ["Hi, my name is Sam and today I'll show you the importer."]),
      []
    );
    expect(v.intro).toBeNull();
    expect(v.reason).toMatch(/past the 2000ms/);
  });

  it('refuses when there is no transcript at all', () => {
    const v = detectIntroduction([], []);
    expect(v.intro).toBeNull();
    expect(v.reason).toMatch(/no transcript/);
  });

  it('refuses a long opening that is mostly silence', () => {
    /* Two words twelve seconds apart is not somebody introducing
       themselves, whatever the words are. */
    const v = detectIntroduction(
      [
        { startMs: 0, endMs: 300, text: 'Hi.' },
        { startMs: 1100, endMs: 1500, text: "Today, then." },
      ],
      []
    );
    expect(v.intro).toBeNull();
  });

  it('refuses typing as firmly as clicking', () => {
    const v = detectIntroduction(
      say(0, ["Hi, my name is Sam and today I'll show you the importer."]),
      [{ tMs: 300, kind: 'key' }, { tMs: 800, kind: 'key' }]
    );
    expect(v.intro).toBeNull();
  });

  /* ── Shape ─────────────────────────────────────────────────────── */

  it('caps a very long opening and says that it did', () => {
    const many = say(0, Array.from({ length: 40 }, (_, i) =>
      i === 0 ? "Hi, my name is Sam and today I'll show you the importer." : `Point ${i}.`));
    const v = detectIntroduction(many, []);
    expect(v.intro).not.toBeNull();
    expect(v.intro!.endMs).toBeLessThanOrEqual(45000);
    expect(v.reason).toMatch(/ceiling/);
  });

  it('always says why, whichever way it went', () => {
    const yes = detectIntroduction(say(0, ["Hi, my name is Sam.", "Today I'll show you."]), []);
    const no = detectIntroduction(say(0, ["The build is green."]), []);
    expect(yes.reason.length).toBeGreaterThan(20);
    expect(no.reason.length).toBeGreaterThan(20);
  });
});
