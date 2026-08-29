/*
  The captions nobody was measuring.

  The case these tests are written from is real and is worth stating,
  because every threshold below is set against it rather than guessed:
  a 275-second Swahili take, transcribed on device, came back as 127
  caption lines of which 109 were the SAME sentence, consecutively, from
  37s to the end of the film. The build reported success. Nothing in the
  suite noticed, because nothing in the suite read the words.

  So the first test is that take, and the numbers in it are measured.

  The second thing these are written for is the boundary between the two
  halves. The deterministic pass may delete; the model pass may only
  correct. A model asked to tidy 109 identical lines will happily write
  four minutes of fluent narration nobody said, and that failure is
  invisible afterwards — it reads as a very good transcript. So the
  tests that matter most here are the ones that REFUSE a model's answer.
*/
import { describe, it, expect } from 'vitest';
import {
  auditCaptions, repairCaptions, collapseStutter, normalise, findRepeat,
  buildCleanupRequest, parseCleanupReply,
  buildReviewRequest, parseReviewReply,
  LOOP_RUN, STUTTER_RUN, PHRASE_RUN, STALL_RUN,
} from './captionQuality';
import { SpeechCue } from './recordingProject';

/** Cues on a fixed grid, the way a latched decoder emits them. */
const grid = (texts: string[], stepMs = 2000, startMs = 0): SpeechCue[] =>
  texts.map((text, i) => ({
    startMs: startMs + i * stepMs,
    endMs: startMs + i * stepMs + stepMs,
    text,
  }));

describe('finding a repetition loop', () => {
  /*
    The shape of the real failure, at its real proportions: a handful of
    real lines, then one line to the end of the film.
  */
  const real = grid([
    "Yes sir, we'll be back.",
    'Baria Leo.',
    'Leo ni mwishua wiki.',
    'Tuna daku malizia',
    'payment method ya sasa kwenye expenditure.',
    ...Array.from({ length: 109 }, () => 'Tukazumu zia iswi ya manu nuzi.'),
  ]);

  it('finds the loop, and says how much of the film it ate', () => {
    const audit = auditCaptions(real);
    expect(audit.cues).toBe(114);
    expect(audit.distinct).toBe(6);

    const loops = audit.defects.filter((d) => d.kind === 'repetition-loop');
    expect(loops).toHaveLength(1);
    expect(loops[0].count).toBe(109);
    expect(loops[0].fromIndex).toBe(5);

    // 109 cues of the 114 total, so the great majority of the running time.
    expect(audit.loopedShare).toBeGreaterThan(0.9);
  });

  it('calls the track unusable rather than shipping the fragments', () => {
    expect(auditCaptions(real).usable).toBe(false);
  });

  it('keeps the first line of the loop and drops the rest', () => {
    const repair = repairCaptions(real);
    expect(repair.removed).toBe(108);
    expect(repair.cues).toHaveLength(6);
    // The first occurrence survives: it may well be a real line the
    // decoder then got stuck on, and dropping it could lose a sentence.
    expect(repair.cues[5].text).toBe('Tukazumu zia iswi ya manu nuzi.');
    expect(repair.notes.join(' ')).toMatch(/not transcribed/);
  });
});

describe('what is NOT a loop', () => {
  it('leaves a line that is genuinely said twice in a row', () => {
    const audit = auditCaptions(grid(['Right.', 'Right.', 'So the next thing.']));
    expect(audit.defects.filter((d) => d.kind === 'repetition-loop')).toHaveLength(0);
    expect(audit.usable).toBe(true);
  });

  it('leaves repeats that are not consecutive', () => {
    // On the real take "Payroll ni mwishua wiki." appears twice, apart,
    // and both are real.
    const audit = auditCaptions(grid([
      'Payroll ni mwishua wiki.', 'Tukazumu zia asseti.', 'Payroll ni mwishua wiki.',
    ]));
    expect(audit.defects).toHaveLength(0);
  });

  it('fires at the run length it documents and not before', () => {
    const under = grid(Array.from({ length: LOOP_RUN - 1 }, () => 'same line'));
    const over = grid(Array.from({ length: LOOP_RUN }, () => 'same line'));
    expect(auditCaptions(under).defects).toHaveLength(0);
    expect(auditCaptions(over).defects.filter((d) => d.kind === 'repetition-loop')).toHaveLength(1);
  });

  it('does not fire on a uniform time grid alone', () => {
    /*
      The deliberate non-check. 112 of the looped take's 126 gaps were
      exactly 2000ms, which looks decisive and is not: the SAME file
      decoded cleanly also opens 0, 2000, 4000. A check that fires on
      clean output is an instrument that lies.
    */
    const clean = grid([
      "Yes sir, we'll be back.", 'Baria Leo.', 'Leo ni mwishua wiki.',
      'Tuna daku malizia', 'payment method ya sasa kwenye expenditure.',
    ]);
    expect(auditCaptions(clean).defects).toHaveLength(0);
    expect(auditCaptions(clean).usable).toBe(true);
  });
});

describe('stutters, markers and empties', () => {
  it('collapses a word repeated inside one line', () => {
    // Measured on the same take after the loop was fixed at source.
    expect(collapseStutter('akaunti akaunti akaunti akaunti tuneita payables'))
      .toBe('akaunti tuneita payables');
  });

  it('leaves a word said three times, which is a person talking', () => {
    expect(collapseStutter('no no no that is the wrong one'))
      .toBe('no no no that is the wrong one');
    expect(STUTTER_RUN).toBe(4);
  });

  /*
    Both of these are verbatim from a second real take, and both got
    through a word-only check cleanly: no single word repeats
    consecutively in either. The repeating unit is six words in the
    first and two in the second, which is why the check counts phrases.
  */
  it('collapses a repeated PHRASE, which no single word repeat would catch', () => {
    const line = 'MCPs za AI existence ndigito kwenye MCPs za AI existence ndigito '
      + 'kwenye MCPs za AI existence ndigito kwenye';
    expect(findRepeat(line)?.size).toBe(6);
    expect(findRepeat(line)?.run).toBe(3);
    expect(collapseStutter(line)).toBe('MCPs za AI existence ndigito kwenye');
  });

  it('collapses a repeated two-word phrase', () => {
    expect(collapseStutter('ndigito mcp ndigito mcp ndigito mcp ndigito mcp'))
      .toBe('ndigito mcp');
  });

  it('leaves a phrase said twice, which is emphasis rather than a decoder', () => {
    expect(collapseStutter('do it again do it again and then stop'))
      .toBe('do it again do it again and then stop');
    expect(PHRASE_RUN).toBe(3);
  });

  it('finds nothing to collapse in ordinary narration', () => {
    const line = 'First we open the payroll screen and then we add the staff member.';
    expect(findRepeat(line)).toBeNull();
    expect(collapseStutter(line)).toBe(line);
  });

  it('finds cues stacked on one timestamp, which a loop check misses', () => {
    /*
      Also from that take: EIGHT cues all beginning at 4620ms, so eight
      lines on screen together. The text VARIES, so nothing about it
      looks like a repetition loop; what stopped was the clock.
    */
    const stacked: SpeechCue[] = [
      { startMs: 0, endMs: 4000, text: 'Lyaotu ndakujifunza agensi ambavyo' },
      ...['one', 'two', 'three', 'four'].map((t) => ({ startMs: 4620, endMs: 9000, text: t })),
      { startMs: 10620, endMs: 14000, text: 'na konaginsia pavo transatoka' },
    ];
    const audit = auditCaptions(stacked);
    const stall = audit.defects.find((d) => d.kind === 'stalled-timing');
    expect(stall).toBeDefined();
    expect(stall!.count).toBe(4);

    const repair = repairCaptions(stacked, audit);
    expect(repair.cues.filter((c) => c.startMs === 4620)).toHaveLength(1);
    expect(repair.notes.join(' ')).toMatch(/same timestamp/);
  });

  it('does not call two cues sharing a start a stall', () => {
    // A long line split for width legitimately shares a timestamp.
    const pair: SpeechCue[] = [
      { startMs: 1000, endMs: 3000, text: 'the first half of a long line' },
      { startMs: 1000, endMs: 3000, text: 'and the second half of it' },
      { startMs: 3000, endMs: 5000, text: 'then the next thing entirely' },
    ];
    expect(auditCaptions(pair).defects.filter((d) => d.kind === 'stalled-timing')).toEqual([]);
    expect(STALL_RUN).toBe(3);
  });

  it('names the wrong-language marker as a language problem', () => {
    const audit = auditCaptions(grid(['(speaking in foreign language)']));
    const marker = audit.defects.find((d) => d.kind === 'non-speech-marker');
    expect(marker).toBeDefined();
    expect(marker!.detail).toMatch(/wrong language/);
  });

  it('drops markers and empties', () => {
    const repair = repairCaptions(grid(['[Music]', '   ', 'Real words here.', '...']));
    expect(repair.cues).toHaveLength(1);
    expect(repair.cues[0].text).toBe('Real words here.');
  });

  it('reports nothing wrong on a clean track', () => {
    const audit = auditCaptions(grid([
      'First we open the payroll screen.',
      'Then we add the staff member.',
      'And their salary goes here.',
    ]));
    expect(audit.defects).toEqual([]);
    expect(audit.summary).toMatch(/nothing wrong found/);
  });

  it('survives an empty track without dividing by zero', () => {
    const audit = auditCaptions([]);
    expect(audit.cues).toBe(0);
    expect(audit.loopedShare).toBe(0);
    expect(audit.usable).toBe(false);
  });
});

describe('what the model is asked', () => {
  const cues = grid(['Lakin ni tuna focusz edina', 'cross salary, uta deducti nccf.']);

  it('sends every line, numbered, and names the language when it is known', () => {
    const request = buildCleanupRequest(cues, 'sw');
    expect(request.indices).toEqual([0, 1]);
    expect(request.prompt).toContain('0\tLakin ni tuna focusz edina');
    expect(request.prompt).toContain('The language is "sw"');
  });

  it('does not claim to know the language when it was auto-detected', () => {
    expect(buildCleanupRequest(cues, 'auto').prompt).not.toContain('The language is');
  });

  it('tells the model to leave a line it cannot read, and not to translate', () => {
    const prompt = buildCleanupRequest(cues).prompt;
    expect(prompt).toMatch(/RETURN IT UNCHANGED/);
    expect(prompt).toMatch(/Do NOT translate/);
    expect(prompt).toMatch(/Do NOT add, invent/);
  });
});

describe('refusing the model', () => {
  const cues = grid(['Lakin ni tuna focusz edina', 'cross salary, uta deducti nccf.']);

  it('takes an ordinary spelling correction', () => {
    const out = parseCleanupReply(
      '[{"i":1,"text":"gross salary, uta-deduct NSSF."}]', cues
    );
    expect(out.refused).toBeNull();
    expect(out.applied).toBe(1);
    expect(out.cues[1].text).toBe('gross salary, uta-deduct NSSF.');
    // The line it was not asked about is untouched, byte for byte.
    expect(out.cues[0].text).toBe(cues[0].text);
  });

  it('digs the array out of a code fence', () => {
    const out = parseCleanupReply(
      '```json\n[{"i":0,"text":"Lakini tuna focus zaidi"}]\n```', cues
    );
    expect(out.refused).toBeNull();
    expect(out.applied).toBe(1);
  });

  it('takes an empty array as a real answer', () => {
    const out = parseCleanupReply('[]', cues);
    expect(out.refused).toBeNull();
    expect(out.applied).toBe(0);
  });

  it('rejects a line that grew into a sentence nobody said', () => {
    /*
      The failure this whole boundary exists for. It is fluent, it is
      plausible, it is in the right language, and it is invented.
    */
    const out = parseCleanupReply(
      '[{"i":0,"text":"Lakini leo tuna focus zaidi kwenye payroll na jinsi ya '
      + 'kuongeza wafanyakazi wapya kwenye mfumo wetu wa malipo."}]', cues
    );
    expect(out.applied).toBe(0);
    expect(out.cues[0].text).toBe(cues[0].text);
    // One bad line out of one offered is past the fatal share, so the
    // whole reply goes rather than the bad line only.
    expect(out.refused).toMatch(/invention rather than spelling/);
  });

  it('rejects a line it emptied', () => {
    const out = parseCleanupReply('[{"i":0,"text":"   "}]', cues);
    expect(out.applied).toBe(0);
    expect(out.refused).toMatch(/emptied the line/);
  });

  it('drops a stray index without losing the good corrections', () => {
    const many = grid(['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh']);
    const out = parseCleanupReply(
      '[{"i":0,"text":"AA"},{"i":1,"text":"BB"},{"i":2,"text":"CC"},'
      + '{"i":3,"text":"DD"},{"i":99,"text":"nowhere"}]', many
    );
    // 1 rejected of 5 offered is under the fatal share, so the four good
    // ones stand and the stray one is reported.
    expect(out.refused).toBeNull();
    expect(out.applied).toBe(4);
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0].why).toBe('no such line');
  });

  it('throws the whole reply away when a quarter of it is wrong', () => {
    const out = parseCleanupReply(
      '[{"i":0,"text":"Lakini tuna focus"},{"i":99,"text":"nowhere"}]', cues
    );
    expect(out.refused).toMatch(/none were taken/);
    expect(out.cues[0].text).toBe(cues[0].text);
  });

  it('refuses prose, and refuses a reply that is not an array', () => {
    expect(parseCleanupReply('I have reviewed the captions and they look good!', cues).refused)
      .toMatch(/no JSON array/);
    expect(parseCleanupReply('[not json at all]', cues).refused).toMatch(/not valid JSON/);
  });

  it('never changes the number of lines, whatever the model says', () => {
    const out = parseCleanupReply(
      '[{"i":0,"text":"one"},{"i":0,"text":"one again"}]', cues
    );
    expect(out.cues).toHaveLength(cues.length);
  });
});

describe('normalising the way a reader would', () => {
  it('ignores case, punctuation and spacing', () => {
    expect(normalise('Tukazumu, zia iswi!')).toBe(normalise('tukazumu   zia iswi'));
  });

  it('does not collapse two genuinely different lines', () => {
    expect(normalise('Payroll ni mwishua wiki.')).not.toBe(normalise('Payroll ni mwanzo wiki.'));
  });
});

/* ── The review pass ────────────────────────────────────────────── */

describe('parseReviewReply', () => {
  const cues: SpeechCue[] = [
    { startMs: 0, endMs: 2000, text: 'the encoder crashd on exprot' },
    { startMs: 2000, endMs: 4000, text: 'so we fixd the pipeline' },
  ];

  it('takes the corrections and the emphasis together', () => {
    const reply = JSON.stringify([
      { i: 0, text: 'the encoder crashed on export', words: [1, 2], hero: 1 },
      { i: 1, text: 'so we fixed the pipeline', words: [2, 4], hero: 4 },
    ]);
    const out = parseReviewReply(reply, cues);

    expect(out.refused).toBeNull();
    expect(out.corrected).toBe(2);
    expect(out.emphasised).toBe(2);
    expect(out.cues[0].text).toBe('the encoder crashed on export');
    expect(out.reviewed.get(0)).toEqual({
      text: 'the encoder crashed on export', emphasis: [1, 2], hero: 0,
    });
  });

  it('reads the emphasis indices against the CORRECTED line, not the original', () => {
    /*
      The whole reason this is not two passes. A correction that changes
      the word count shifts every index after it, and using the original
      line here puts the emphasis on the wrong word with no error
      anywhere.
    */
    const shifted: SpeechCue[] = [{ startMs: 0, endMs: 1000, text: 'the enco der crashed' }];
    const reply = JSON.stringify([
      { i: 0, text: 'the encoder crashed', words: [1, 2], hero: 1 },
    ]);
    const out = parseReviewReply(reply, shifted);
    expect(out.cues[0].text).toBe('the encoder crashed');
    /* Index 2 exists in the corrected 3-word line; in the original
       4-word line it would have been "crashed" rather than out of range,
       which is exactly how this fails silently. */
    expect(out.reviewed.get(0)!.emphasis).toEqual([1, 2]);
  });

  it('refuses emphasis that names a word the line does not have', () => {
    const reply = JSON.stringify([
      { i: 0, text: 'the encoder crashed on export', words: [1, 99], hero: 1 },
    ]);
    const out = parseReviewReply(reply, cues);
    /* The correction survives; only the emphasis is dropped, and the
       deterministic picker then decides. */
    expect(out.cues[0].text).toBe('the encoder crashed on export');
    expect(out.reviewed.has(0)).toBe(false);
  });

  it('drops a hero that is not one of its own words', () => {
    const reply = JSON.stringify([
      { i: 0, text: 'the encoder crashed on export', words: [1, 2], hero: 4 },
    ]);
    const out = parseReviewReply(reply, cues);
    expect(out.reviewed.get(0)!.hero).toBeNull();
  });

  it('still refuses a reply that grew a line into a sentence nobody said', () => {
    /* The cleanup gate is not relaxed for the review. */
    const reply = JSON.stringify([
      {
        i: 0,
        text: 'The encoder crashed on export because the hardware pipeline ran out of '
          + 'memory while writing the final frames of the sequence.',
        words: [1], hero: 1,
      },
      { i: 1, text: 'so we fixed the pipeline', words: [2], hero: 2 },
    ]);
    const out = parseReviewReply(reply, cues);
    expect(out.refused).toBeTruthy();
    expect(out.cues).toEqual(cues);
  });

  it('is a no-op rather than a throw on a reply that is not JSON', () => {
    const out = parseReviewReply('I could not do that.', cues);
    expect(out.refused).toBeTruthy();
    expect(out.cues).toEqual(cues);
    expect(out.reviewed.size).toBe(0);
  });

  it('accepts a line with no opinion on emphasis', () => {
    const reply = JSON.stringify([
      { i: 0, text: 'the encoder crashed on export', words: [], hero: null },
    ]);
    const out = parseReviewReply(reply, cues);
    expect(out.refused).toBeNull();
    expect(out.corrected).toBe(1);
    expect(out.reviewed.has(0)).toBe(false);
  });
});

describe('buildReviewRequest', () => {
  it('names the language and warns the model about code-switching', () => {
    const { prompt } = buildReviewRequest(
      [{ startMs: 0, endMs: 1, text: 'habari' }],
      'sw'
    );
    expect(prompt).toContain('"sw"');
    expect(prompt).toContain('code-switched');
    expect(prompt).toContain('Do NOT translate');
  });

  it('still warns about code-switching when the language is unknown', () => {
    const { prompt } = buildReviewRequest([{ startMs: 0, endMs: 1, text: 'hello' }]);
    expect(prompt).toContain('code-switched');
  });
});
