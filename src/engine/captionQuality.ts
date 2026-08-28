/* ═══════════════════════════════════════════════════════════════════
   Are the captions worth putting on screen?

   ── Why this exists, and it is not a nicety ────────────────────────

   The Tutorial skill transcribes on device and lays the words down as
   captions. Nothing measured them. On a real 275-second Swahili take
   the transcriber latched into a repetition loop and returned ONE
   sentence 109 times, on a two-second grid, from 37s to the end of the
   film — 86% of the running time — and the build reported success,
   because every number it checks was fine: the decode exited 0, the
   language was detected correctly, the segment timings were plausible,
   and 127 caption clips really were on the timeline.

   The cause is fixed at source (`-mc 0` in `electron/transcribe.ts`,
   where the measurement is written down). This module exists because
   the cause being fixed is not the same as the failure being visible:
   a transcriber is a model, models fail in ways nobody enumerated in
   advance, and a caption track is the one output of this skill that a
   viewer reads word by word. Everything here is measured on the RESULT.

   ── The two halves, and why the order matters ──────────────────────

   `auditCaptions` is deterministic and always runs. `cleanCaptions`
   needs a language model and is optional. They are not alternatives
   and they must not be swapped:

   A repetition loop is not a typo. Those 109 lines are not a mangled
   version of what was said — they are what the decoder emitted while
   decoding nothing, and the words that were actually spoken are not in
   the text at all. Handing that to a language model and asking it to
   "clean it up" asks it to invent four minutes of plausible Swahili,
   which it can do, and which would turn a visible failure into an
   invisible one. So the deterministic pass runs FIRST and REMOVES what
   was never transcribed; the model only ever sees lines that have real
   content, and is asked only to spell them correctly.

   That is the rule the whole module is arranged around: a model may
   repair what is there and may never supply what is missing.
   ═══════════════════════════════════════════════════════════════════ */

import { SpeechCue } from './recordingProject';

/* ── What a defect is ───────────────────────────────────────────── */

export type CaptionDefectKind =
  /** The same line, over and over, consecutively. The decoder latched. */
  | 'repetition-loop'
  /** One word or phrase repeated inside a single line. */
  | 'stutter'
  /** Consecutive cues whose start time does not advance. */
  | 'stalled-timing'
  /** `(speaking in foreign language)`, `[Music]` — not speech. */
  | 'non-speech-marker'
  /** Nothing but whitespace or punctuation. */
  | 'empty';

export interface CaptionDefect {
  kind: CaptionDefectKind;
  /** Inclusive range of cue indices, into the array that was audited. */
  fromIndex: number;
  toIndex: number;
  startMs: number;
  endMs: number;
  /** How many cues this defect covers. */
  count: number;
  /** The offending text, trimmed for reporting. */
  text: string;
  detail: string;
}

export interface CaptionAudit {
  cues: number;
  /** Distinct normalised lines. A loop drives this far below `cues`. */
  distinct: number;
  defects: CaptionDefect[];
  /**
   * Share of the captioned span that repetition loops cover, 0..1.
   *
   * The headline number, because it is the one that says whether the
   * caption track is worth shipping at all. 0.86 on the take above.
   */
  loopedShare: number;
  /**
   * Whether the words that survive are worth putting on screen.
   *
   * False when a loop has eaten more of the film than `LOOP_FATAL_SHARE`
   * — at which point the honest thing is to say the transcript failed,
   * not to ship the fragments around the edges as if they were the
   * narration.
   */
  usable: boolean;
  summary: string;
}

/* ── The thresholds, and what each one is measured against ──────── */

/**
 * Consecutive identical lines before it is a loop rather than a repeat.
 *
 * The measured loop was 109 long. Legitimate consecutive repetition in
 * speech is one line, occasionally two — on the same take, "Payroll ni
 * mwishua wiki." appears twice and is real, but NOT consecutively. Four
 * is comfortably above anything a person says and two orders of
 * magnitude below the failure.
 */
export const LOOP_RUN = 4;

/**
 * Repeats of one WORD inside a line before it is a stutter.
 *
 * `-mc 0` kills the long loops and leaves short local ones: the same
 * take still produced "akaunti akaunti akaunti akaunti tuneita
 * payables" after the fix. Three is a rhetorical device ("no, no, no");
 * four is a decoder.
 */
export const STUTTER_RUN = 4;

/**
 * Repeats of a PHRASE, which needs a lower bar than a single word.
 *
 * Found by running this on a second real take rather than by thinking
 * about it. The word-level check above passed cleanly on a line reading
 * "MCPs za AI existence ndigito kwenye MCPs za AI existence ndigito
 * kwenye MCPs za AI existence ndigito kwenye" because no single word
 * repeats consecutively: the unit that repeats is six words long. The
 * same take also produced "ndigito mcp ndigito mcp ndigito mcp ndigito
 * mcp", a two-word unit.
 *
 * Three, not four, because saying a whole phrase three times in a row
 * is already not something people do, where saying one word three times
 * is ordinary emphasis.
 */
export const PHRASE_RUN = 3;

/** Longest repeating unit worth looking for. */
const MAX_PHRASE = 6;

/**
 * Consecutive cues sharing a start time before the clock has stalled.
 *
 * The other half of what that take found: EIGHT caption cues all
 * beginning at 4620ms, so eight lines are on screen at once and the
 * eight after them are missing. Whisper emits this when it is stuck on
 * a window, and it is a different symptom from a repetition loop
 * because the TEXT varies while the CLOCK does not.
 *
 * Three, because two cues can legitimately share a start when a long
 * line has been split for width, and three cannot.
 */
export const STALL_RUN = 3;

/** Past this share of the film lost to loops, the transcript failed. */
export const LOOP_FATAL_SHARE = 0.35;

/*
  Non-speech markers.

  Whisper writes these in brackets and they are not narration. The
  `(speaking in foreign language)` one is the specific marker an English
  decode of another language returns for the whole stretch — the failure
  HANDOVER §7h is about — so it is worth naming rather than merely
  filtering, because seeing it in an audit tells you the language was
  wrong, which no other symptom does.
*/
const MARKER = /^[([【][^)\]】]*[)\]】][.,!?\s]*$/;
const FOREIGN_MARKER = /speaking in (a )?foreign language|speaking foreign language/i;

/**
 * Punctuation, spaces, and nothing else.
 *
 * The dashes are written as escapes rather than as themselves so that
 * the em-dash sweep in `iconography.test.ts` does not read this line as
 * user-facing copy. It is a character class, not a sentence.
 */
const EMPTY = /^[\s.,!?;:_\-\u2013\u2014\u2026"'`~]*$/;

/**
 * Compare lines the way a reader would, not the way a byte comparison
 * would: case, punctuation and spacing are not what makes two captions
 * the same line.
 */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ── The audit ──────────────────────────────────────────────────── */

/**
 * Measure a caption track. Deterministic, no model, no network.
 *
 * Deliberately NOT included as a defect: a uniform time grid. The
 * looped take put 112 of its 126 cues on an exact 2000ms spacing, which
 * looks like a decisive tell and is not one — the same file decoded
 * cleanly ALSO opens 0, 2000, 4000, and a check that fires on clean
 * output is an instrument that lies. It is reported as corroboration on
 * a loop that was found some other way, and never on its own.
 */
export function auditCaptions(cues: SpeechCue[]): CaptionAudit {
  const defects: CaptionDefect[] = [];
  const keys = cues.map((c) => normalise(c.text));

  /* ── Loops: runs of consecutive identical lines ── */
  let loopedMs = 0;
  for (let i = 0; i < cues.length;) {
    if (keys[i].length === 0) { i += 1; continue; }
    let j = i;
    while (j + 1 < cues.length && keys[j + 1] === keys[i]) j += 1;
    const run = j - i + 1;
    if (run >= LOOP_RUN) {
      const startMs = cues[i].startMs;
      const endMs = cues[j].endMs;
      loopedMs += Math.max(0, endMs - startMs);
      defects.push({
        kind: 'repetition-loop',
        fromIndex: i,
        toIndex: j,
        startMs,
        endMs,
        count: run,
        text: cues[i].text.trim(),
        detail:
          `The same line ${run} times in a row, covering ${Math.round((endMs - startMs) / 1000)}s. `
          + 'The transcriber latched: these are not misheard words, they are what it emitted '
          + 'while decoding nothing, so the narration under them was never transcribed.',
      });
    }
    i = j + 1;
  }

  /* ── Markers, empties and stutters: one cue at a time ── */
  cues.forEach((cue, i) => {
    const text = cue.text.trim();
    const inLoop = defects.some(
      (d) => d.kind === 'repetition-loop' && i >= d.fromIndex && i <= d.toIndex
    );

    if (EMPTY.test(text)) {
      defects.push({
        kind: 'empty', fromIndex: i, toIndex: i, startMs: cue.startMs, endMs: cue.endMs,
        count: 1, text, detail: 'Nothing but punctuation or whitespace.',
      });
      return;
    }

    if (MARKER.test(text)) {
      defects.push({
        kind: 'non-speech-marker', fromIndex: i, toIndex: i,
        startMs: cue.startMs, endMs: cue.endMs, count: 1, text,
        detail: FOREIGN_MARKER.test(text)
          ? 'The transcriber was given the wrong language: this marker is what an English '
            + 'decode of another language returns for the whole stretch, so the words are not '
            + 'missing from the audio, they are missing from the decode. Set `language`.'
          : 'A non-speech marker, not narration.',
      });
      return;
    }

    /* A stutter inside a line the loop pass did not already claim. */
    if (inLoop) return;
    const found = findRepeat(text);
    if (found) {
      defects.push({
        kind: 'stutter', fromIndex: i, toIndex: i,
        startMs: cue.startMs, endMs: cue.endMs, count: found.run, text,
        detail: found.size === 1
          ? `"${found.unit}" ${found.run} times in a row inside one line.`
          : `"${found.unit}" ${found.run} times in a row inside one line, `
            + `a ${found.size}-word phrase rather than a stuck word.`,
      });
    }
  });

  /*
    ── The clock, as opposed to the words ──

    Cues whose start time does not advance. Reported after the per-cue
    pass because it is a property of a RUN and not of any one line, and
    it is a separate failure from a repetition loop: there the text
    repeats and the clock moves, here the text varies and the clock
    stands still. Eight lines end up on screen together and the eight
    that should follow them are gone.
  */
  for (let i = 0; i < cues.length;) {
    let j = i;
    while (j + 1 < cues.length && cues[j + 1].startMs === cues[i].startMs) j += 1;
    const run = j - i + 1;
    if (run >= STALL_RUN) {
      defects.push({
        kind: 'stalled-timing',
        fromIndex: i, toIndex: j,
        startMs: cues[i].startMs, endMs: cues[j].endMs,
        count: run,
        text: cues[i].text.trim(),
        detail:
          `${run} cues all begin at ${Math.round(cues[i].startMs)}ms, so they would be on `
          + 'screen at the same time. The transcriber stopped advancing its clock.',
      });
    }
    i = j + 1;
  }

  defects.sort((a, b) => a.fromIndex - b.fromIndex || a.kind.localeCompare(b.kind));

  const spanMs = cues.length > 0
    ? Math.max(...cues.map((c) => c.endMs)) - Math.min(...cues.map((c) => c.startMs))
    : 0;
  const loopedShare = spanMs > 0 ? Math.min(1, loopedMs / spanMs) : 0;
  const distinct = new Set(keys.filter((k) => k.length > 0)).size;
  const usable = cues.length > 0 && loopedShare <= LOOP_FATAL_SHARE;

  const counts = defects.reduce<Record<string, number>>((acc, d) => {
    acc[d.kind] = (acc[d.kind] ?? 0) + 1;
    return acc;
  }, {});

  const summary = defects.length === 0
    ? `${cues.length} caption lines, ${distinct} distinct, nothing wrong found.`
    : `${cues.length} caption lines, ${distinct} distinct. `
      + Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')
      + (loopedShare > 0 ? `; ${Math.round(loopedShare * 100)}% of the film is inside a loop.` : '.');

  return { cues: cues.length, distinct, defects, loopedShare, usable, summary };
}

/* ── The deterministic repair ───────────────────────────────────── */

export interface CaptionRepair {
  cues: SpeechCue[];
  removed: number;
  changed: number;
  notes: string[];
}

/**
 * Remove what was never said and collapse what was said once.
 *
 * Everything here is a DELETION or a collapse — nothing is rewritten
 * into something new, because at this stage there is no evidence for
 * what the new thing should be. A looped run keeps its FIRST cue: that
 * one line may well be a real line that the decoder then got stuck on,
 * and keeping it costs one caption where dropping it could lose a real
 * sentence.
 */
export function repairCaptions(cues: SpeechCue[], audit = auditCaptions(cues)): CaptionRepair {
  const drop = new Set<number>();
  const notes: string[] = [];
  const out: SpeechCue[] = cues.map((c) => ({ ...c }));
  let changed = 0;

  for (const defect of audit.defects) {
    if (defect.kind === 'repetition-loop') {
      for (let i = defect.fromIndex + 1; i <= defect.toIndex; i += 1) drop.add(i);
      notes.push(
        `Dropped ${defect.count - 1} repeats of "${defect.text.slice(0, 48)}" between `
        + `${Math.round(defect.startMs / 1000)}s and ${Math.round(defect.endMs / 1000)}s. `
        + 'The narration there was not transcribed, so there are no captions over it.'
      );
    } else if (defect.kind === 'empty' || defect.kind === 'non-speech-marker') {
      drop.add(defect.fromIndex);
    } else if (defect.kind === 'stalled-timing') {
      /*
        Keep the first and drop the rest, the same call the loop repair
        makes and for the same reason: the first cue is the one whose
        timestamp is trustworthy, and the ones piled on top of it would
        render over each other. Dropping rather than re-spacing, because
        there is no evidence for where they should have gone.
      */
      for (let i = defect.fromIndex + 1; i <= defect.toIndex; i += 1) drop.add(i);
      notes.push(
        `Dropped ${defect.count - 1} caption lines stacked on the same timestamp at `
        + `${Math.round(defect.startMs / 1000)}s. The transcriber stopped advancing its clock `
        + 'there, so they would all have been on screen at once.'
      );
    } else if (defect.kind === 'stutter') {
      const collapsed = collapseStutter(out[defect.fromIndex].text);
      if (collapsed !== out[defect.fromIndex].text) {
        out[defect.fromIndex] = { ...out[defect.fromIndex], text: collapsed };
        changed += 1;
      }
    }
  }

  const markers = audit.defects.filter((d) => d.kind === 'non-speech-marker').length;
  if (markers > 0) notes.push(`Dropped ${markers} non-speech marker${markers === 1 ? '' : 's'}.`);

  return {
    cues: out.filter((_, i) => !drop.has(i)),
    removed: drop.size,
    changed,
    notes,
  };
}

/**
 * The longest immediately-repeating unit in a line, if there is one.
 *
 * Longest unit first: "ndigito mcp ndigito mcp ndigito mcp" is a 2-word
 * phrase three times, and reporting it as "ndigito, twice" would be
 * true of a sub-part and wrong about the shape.
 */
export function findRepeat(
  text: string
): { unit: string; size: number; run: number; at: number } | null {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  const keys = words.map(normalise);

  for (let size = MAX_PHRASE; size >= 1; size -= 1) {
    if (words.length < size * (size === 1 ? STUTTER_RUN : PHRASE_RUN)) continue;
    for (let start = 0; start + size <= words.length; start += 1) {
      const unit = keys.slice(start, start + size);
      if (unit.some((w) => w.length === 0)) continue;
      let run = 1;
      let at = start + size;
      while (at + size <= words.length
        && unit.every((w, k) => keys[at + k] === w)) { run += 1; at += size; }
      if (run >= (size === 1 ? STUTTER_RUN : PHRASE_RUN)) {
        return { unit: words.slice(start, start + size).join(' '), size, run, at: start };
      }
    }
  }
  return null;
}

/**
 * Collapse an immediately-repeated word or phrase to one copy.
 *
 * `akaunti akaunti akaunti akaunti tuneita` becomes `akaunti tuneita`,
 * and a repeated six-word phrase becomes that phrase once. Repeated
 * until nothing repeats, because collapsing an inner unit can leave a
 * longer one adjacent to itself.
 */
export function collapseStutter(text: string): string {
  let words = text.trim().split(/\s+/).filter((w) => w.length > 0);

  for (let guard = 0; guard < 16; guard += 1) {
    const found = findRepeat(words.join(' '));
    if (!found) break;
    words = [
      ...words.slice(0, found.at + found.size),
      ...words.slice(found.at + found.size * found.run),
    ];
  }
  return words.join(' ');
}

/* ── The model half ─────────────────────────────────────────────── */

export interface CleanupRequest {
  prompt: string;
  /** Indices sent, in order. The reply is checked against these. */
  indices: number[];
}

/**
 * Ask for spelling, word boundaries, punctuation and casing. Nothing else.
 *
 * The prompt is a pure function so the thing that governs the model's
 * behaviour can be read in a test rather than only in a log. Two
 * properties matter and both are asserted on the way back in
 * `parseCleanupReply` rather than trusted here: the line count does not
 * change, and no line grows into a sentence that was not there.
 */
export function buildCleanupRequest(cues: SpeechCue[], language?: string): CleanupRequest {
  const indices = cues.map((_, i) => i);
  const lines = cues.map((c, i) => `${i}\t${c.text.replace(/\t/g, ' ')}`).join('\n');
  const named = language && language !== 'auto' ? `The language is "${language}". ` : '';

  const prompt = [
    'You are correcting the output of an on-device speech recogniser, to be shown as',
    'subtitles over a screen recording. Below are numbered lines, one per subtitle,',
    'tab-separated as INDEX<TAB>TEXT.',
    '',
    `${named}Correct ONLY these things, in the SAME language as the input:`,
    '  - misspelt words, including proper nouns and technical terms;',
    '  - word boundaries the recogniser got wrong, both words wrongly joined and',
    '    single words wrongly split across a space;',
    '  - capitalisation and punctuation;',
    '  - obvious grammatical agreement errors that are clearly transcription slips.',
    '',
    'Rules, and they matter more than the corrections:',
    '  - Do NOT translate. Return the same language you were given, even if it is',
    '    code-switched between two languages: keep each word in the language it is in.',
    '  - Do NOT add, invent, complete or extend anything. If a line is a fragment,',
    '    it stays a fragment. A speaker who was interrupted stays interrupted.',
    '  - Do NOT merge, split, reorder or renumber lines. One line in, one line out.',
    '  - If you cannot tell what a line was meant to say, RETURN IT UNCHANGED.',
    '    Leaving a line wrong is correct behaviour here; guessing is not.',
    '',
    'Reply with JSON only, no prose and no code fence: an array of objects',
    '{"i": <index>, "text": "<corrected line>"} for the lines you CHANGED. Omit',
    'lines you left alone. An empty array is a valid and acceptable answer.',
    '',
    lines,
  ].join('\n');

  return { prompt, indices };
}

export interface CleanupOutcome {
  cues: SpeechCue[];
  applied: number;
  rejected: { i: number; text: string; why: string }[];
  /** Set when the whole reply was thrown away, with the reason. */
  refused: string | null;
}

/**
 * How far a line may change before the change is not a correction.
 *
 * A spelling pass moves a line's length by a little. A line that comes
 * back 2.2x longer has had content added to it, which is the one thing
 * the model was told not to do and the one thing it is most likely to
 * do anyway.
 */
const GROWTH_CEILING = 2.2;
const SHRINK_FLOOR = 0.4;

/** Reject the reply outright past this share of individually bad lines. */
const REPLY_FATAL_SHARE = 0.25;

/**
 * Take the model's reply apart and refuse it unless it is a correction.
 *
 * Every check here exists because the alternative is a caption track
 * that reads beautifully and is not what anybody said. That failure is
 * undetectable downstream — it looks exactly like success — so it has
 * to be refused at the boundary or not at all.
 */
export function parseCleanupReply(
  raw: string,
  cues: SpeechCue[]
): CleanupOutcome {
  const unchanged = (refused: string): CleanupOutcome =>
    ({ cues, applied: 0, rejected: [], refused });

  /* A code fence, or prose around the JSON, is a formatting slip rather
     than a bad answer — the array is still in there. Anything past that
     is a model that did not do the task. */
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return unchanged('The reply held no JSON array.');

  let rows: unknown;
  try {
    rows = JSON.parse(raw.slice(start, end + 1));
  } catch (error) {
    return unchanged(`The reply was not valid JSON. ${(error as Error).message}`);
  }
  if (!Array.isArray(rows)) return unchanged('The reply was not an array.');

  const out = cues.map((c) => ({ ...c }));
  const rejected: CleanupOutcome['rejected'] = [];
  const seen = new Set<number>();
  let applied = 0;

  for (const row of rows) {
    const r = row as { i?: unknown; text?: unknown };
    const i = typeof r.i === 'number' ? r.i : Number.NaN;
    const text = typeof r.text === 'string' ? r.text.trim() : '';

    if (!Number.isInteger(i) || i < 0 || i >= cues.length) {
      rejected.push({ i, text, why: 'no such line' });
      continue;
    }
    if (seen.has(i)) {
      rejected.push({ i, text, why: 'the same line twice' });
      continue;
    }
    seen.add(i);

    const before = cues[i].text.trim();
    if (text.length === 0) {
      rejected.push({ i, text, why: 'emptied the line' });
      continue;
    }
    const ratio = text.length / Math.max(1, before.length);
    if (ratio > GROWTH_CEILING) {
      rejected.push({ i, text, why: `grew ${ratio.toFixed(1)}x, which is invention rather than spelling` });
      continue;
    }
    if (ratio < SHRINK_FLOOR) {
      rejected.push({ i, text, why: `lost ${Math.round((1 - ratio) * 100)}% of the line` });
      continue;
    }
    if (text === before) continue;

    out[i] = { ...out[i], text };
    applied += 1;
  }

  /*
    One bad line is a model slip and is dropped. A quarter of them is a
    model that misunderstood the task, and the lines it got "right" are
    then not evidence of anything — so the whole reply goes.
  */
  const offered = applied + rejected.length;
  if (offered > 0 && rejected.length / offered > REPLY_FATAL_SHARE) {
    return unchanged(
      `${rejected.length} of ${offered} corrections were not corrections `
      + `(${rejected.slice(0, 3).map((r) => r.why).join('; ')}), so none were taken.`
    );
  }

  return { cues: out, applied, rejected, refused: null };
}
