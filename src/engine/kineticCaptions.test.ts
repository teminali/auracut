/*
 * The kinetic caption design, checked against the numbers it claims.
 *
 * Every constant in `kineticCaptions.ts` is documented as a measurement
 * off the reference file, which is the right way to write them down and
 * is no protection at all against the code drifting away from them
 * afterwards. These check the ARITHMETIC still lands where the
 * measurements say it should: a word four deep in the stack is at the
 * size and the height the reference puts it at, not merely at some
 * smaller size and some higher place.
 */
import { describe, it, expect } from 'vitest';
import {
  pickEmphasis, stackKeyframes, wordSize, wordStyle, buildKineticCaptions,
  RESTACK_SCALE, STACK_ANCHOR_H, RESTACK_RISE, ENTRY_DROP, HERO_WIDTH,
  MAX_STACK, EMPHASIS_GREEN, INK_BLACK, STACK_FIT, WORD_SIZE, ACCENT_FAMILY,
  EmphasisWord,
} from './kineticCaptions';
import { SpeechCue } from './recordingProject';

const H = 1080;
const W = 1920;

const word = (text: string, index: number, tier: EmphasisWord['tier']): EmphasisWord =>
  ({ text, index, tier });

/** Every keyframe for one property, in time order. */
const track = (kfs: ReturnType<typeof stackKeyframes>['keyframes'], property: string) =>
  kfs.filter((k) => k.property === property).sort((a, b) => a.timeOffsetMs - b.timeOffsetMs);

describe('the restack move', () => {
  it('scales about the measured anchor rather than by two loose constants', () => {
    /* 0.716 frame heights above centre, times one 0.80 step, is 0.143
       of a frame height. That is the identity `RESTACK_RISE` states. */
    expect(RESTACK_RISE).toBeCloseTo(STACK_ANCHOR_H * (1 - RESTACK_SCALE), 10);
    expect(RESTACK_RISE).toBeCloseTo(0.1432, 4);
  });

  it('lifts the first word by exactly one step when one word follows it', () => {
    const { keyframes } = stackKeyframes([0, 1000], 0, H);
    const y = track(keyframes, 'positionY');
    const s = track(keyframes, 'scaleX');

    expect(y[0].value).toBe(ENTRY_DROP * H);
    expect(s[0].value).toBe(1);
    expect(s[s.length - 1].value).toBeCloseTo(RESTACK_SCALE, 10);
    expect(y[y.length - 1].value).toBeCloseTo(-RESTACK_RISE * H, 6);
  });

  it('compounds, so a word four deep is at 0.8^4 and has risen 0.42 of a frame', () => {
    const arrivals = [0, 400, 800, 1200, 1600];
    const { keyframes } = stackKeyframes(arrivals, 0, H);
    const s = track(keyframes, 'scaleX');
    const y = track(keyframes, 'positionY');

    expect(s[s.length - 1].value).toBeCloseTo(RESTACK_SCALE ** 4, 10);
    expect(s[s.length - 1].value).toBeCloseTo(0.4096, 4);

    /* Scale about a fixed anchor: y_n = A + s^n (y_0 - A). */
    const anchor = -STACK_ANCHOR_H * H;
    const expected = anchor + RESTACK_SCALE ** 4 * (ENTRY_DROP * H - anchor);
    expect(y[y.length - 1].value).toBeCloseTo(expected, 6);
    expect(Math.abs(y[y.length - 1].value) / H).toBeCloseTo(0.4227, 3);
  });

  it('gives the newest word no keyframes at all, rather than two identical ones', () => {
    /*
      A static clip carrying a two-key animation that does nothing is
      indistinguishable from a broken one in the editor, and it is what
      a naive loop emits for the last item.
    */
    const { keyframes } = stackKeyframes([0, 400, 800], 2, H);
    expect(keyframes).toEqual([]);
  });

  it('eases every keyframe at both ends, with no linear key anywhere', () => {
    /* The whole reason the reference is watchable. See GLIDE_CURVE and
       the author's own "make sure that these keyframes are smooth". */
    const { keyframes } = stackKeyframes([0, 400, 800, 1200], 0, H);
    expect(keyframes.length).toBeGreaterThan(0);
    expect(keyframes.every((k) => k.easing === 'easeInOut')).toBe(true);
  });

  it('keys X nowhere, because the measured move has no horizontal component', () => {
    /* Solving for the scale centre put it at x = 960 on a 1920 frame,
       to the pixel, on all three measurable transitions. */
    const { keyframes } = stackKeyframes([0, 400, 800], 0, H);
    expect(track(keyframes, 'positionX')).toEqual([]);
  });
});

describe('sizing', () => {
  it('sets a hero word to the measured share of frame width', () => {
    const size = wordSize(word('this', 0, 'emphasis'), W, H, 1);
    /* 4 characters at 0.55 em advance each should fill HERO_WIDTH. */
    const drawn = 4 * size * 0.55;
    expect(drawn / W).toBeCloseTo(HERO_WIDTH, 2);
  });

  it('gives a short hero word a bigger point size, which is the reference behaviour', () => {
    /* `be` is set at 866 and `this` at 575 in the reference, and they
       are the same design decision: both fill the same measure. */
    const be = wordSize(word('be', 0, 'emphasis'), W, H, 1);
    const challenging = wordSize(word('challenging', 0, 'emphasis'), W, H, 1);
    expect(be).toBeGreaterThan(challenging * 2);
  });

  it('caps a one-character word instead of solving it to a screenful of glyph', () => {
    const one = wordSize(word('e', 0, 'emphasis'), W, H, 1);
    expect(one).toBeLessThanOrEqual(0.8 * H);
  });

  it('sets supporting words at a point size rather than a width', () => {
    const short = wordSize(word('can', 0, 'normal'), W, H, 1);
    const long = wordSize(word('information', 0, 'normal'), W, H, 1);
    expect(short).toBe(long);
    expect(short).toBe(WORD_SIZE.normal);
  });

  it('scales the whole design by the fit, keeping every ratio', () => {
    const full = wordSize(word('challenging', 0, 'normal'), W, H, 1);
    const fitted = wordSize(word('challenging', 0, 'normal'), W, H, 0.42);
    expect(fitted / full).toBeCloseTo(0.42, 2);
  });
});

describe('the style', () => {
  it('paints the emphasis word in the measured green and the rest in black', () => {
    expect(wordStyle(word('but', 0, 'emphasis'), 'Poppins', W, H).color).toBe(EMPHASIS_GREEN);
    expect(wordStyle(word('this', 0, 'major'), 'Poppins', W, H).color).toBe(INK_BLACK);
  });

  it('puts nothing behind the type: no plate, no stroke, no shadow', () => {
    /*
      A histogram across the reference's title sequence finds exactly
      two ink colours and no halo. A chip here would be a different
      design that happened to use the same font.
    */
    const s = wordStyle(word('this', 0, 'major'), 'Poppins', W, H);
    expect(s.background).toBeUndefined();
    expect(s.strokeWidth).toBe(0);
    expect(s.shadowBlur).toBe(0);
    expect(s.backgroundPadding).toBe(0);
  });

  it('applies no tracking, because the measurement found none to apply', () => {
    expect(wordStyle(word('challenging', 0, 'normal'), 'Poppins', W, H).letterSpacing).toBe(0);
  });
});

describe('choosing the words', () => {
  it('drops filler outright rather than drawing it at 300px', () => {
    const picked = pickEmphasis('um so the render pipeline crashed');
    expect(picked.map((p) => p.text)).not.toContain('um');
  });

  it('never ends a stack on a stop word', () => {
    const picked = pickEmphasis('open the inspector and then click on the');
    expect(picked.length).toBeGreaterThan(0);
    const last = picked[picked.length - 1];
    expect(['the', 'on', 'and']).not.toContain(last.text.toLowerCase());
  });

  it('keeps Swahili function words out of the emphasis, not just English ones', () => {
    /* The take this was written against is code-switched, and a
       stop-word list that knows one language emphasises the other
       language's articles. */
    const picked = pickEmphasis('tunaenda kwenye timeline na kubadilisha rangi');
    const shown = picked.filter((p) => p.tier !== 'minor').map((p) => p.text);
    expect(shown).not.toContain('kwenye');
    expect(shown).not.toContain('na');
    expect(shown.join(' ')).toContain('kubadilisha');
  });

  it('names exactly one hero per phrase', () => {
    const picked = pickEmphasis('the render pipeline crashed on export');
    expect(picked.filter((p) => p.tier === 'emphasis')).toHaveLength(1);
  });

  it('never exceeds the stack depth, however long the sentence', () => {
    const picked = pickEmphasis(
      'transcription accuracy improves considerably whenever multilingual recordings '
      + 'receive appropriately sized acoustic models during decoding'
    );
    expect(picked.length).toBeLessThanOrEqual(MAX_STACK);
  });

  it('still shows something for a phrase made only of stop words', () => {
    const picked = pickEmphasis('and then it is');
    expect(picked.length).toBeGreaterThan(0);
  });
});

describe('building the clips', () => {
  const cues: SpeechCue[] = [
    { startMs: 0, endMs: 2000, text: 'the render pipeline crashed on export' },
    { startMs: 2500, endMs: 4000, text: 'so we fixed the encoder' },
  ];

  it('emits one clip per shown word, on the given track', () => {
    const build = buildKineticCaptions(cues, 'T2', { frameWidth: W, frameHeight: H });
    expect(build.clips.length).toBe(build.words);
    expect(build.phrases).toBe(2);
    expect(build.clips.every((c) => c.trackId === 'T2')).toBe(true);
  });

  it('turns on motion blur, which is the reference’s own last step', () => {
    const build = buildKineticCaptions(cues, 'T2', { frameWidth: W, frameHeight: H });
    expect(build.clips.every((c) => c.motionBlur.enabled)).toBe(true);
    expect(build.clips.every((c) => c.motionBlur.shutterAngle === 180)).toBe(true);
  });

  it('starts each phrase’s words inside its own cue and never before it', () => {
    const build = buildKineticCaptions(cues, 'T2', { frameWidth: W, frameHeight: H });
    for (const clip of build.clips) {
      const owner = cues.find((c) => clip.startTimeMs >= c.startMs && clip.startTimeMs <= c.endMs + 500);
      expect(owner).toBeDefined();
    }
  });

  it('prefers a supplied emphasis map over the deterministic picker', () => {
    /*
      This is the path the model review takes, and getting it wrong is
      invisible: the build succeeds either way and simply ignores the
      better answer.
    */
    const emphasis = new Map<number, EmphasisWord[]>([
      [0, [word('ENCODER', 2, 'emphasis')]],
    ]);
    const build = buildKineticCaptions([cues[0]], 'T2', {
      frameWidth: W, frameHeight: H, emphasis,
    });
    expect(build.clips).toHaveLength(1);
    expect(build.clips[0].textStyle!.text).toBe('ENCODER');
  });

  it('draws nothing at all for an empty transcript', () => {
    const build = buildKineticCaptions([], 'T2', { frameWidth: W, frameHeight: H });
    expect(build.clips).toEqual([]);
    expect(build.phrases).toBe(0);
  });

  it('keeps the type inside the frame at the shipped fit', () => {
    /*
      The one departure from the reference is `STACK_FIT`, and its
      whole job is that the words do not cover the screen recording
      underneath. Checked rather than asserted in a comment.
    */
    const build = buildKineticCaptions(cues, 'T2', {
      frameWidth: W, frameHeight: H, fit: STACK_FIT,
    });
    for (const clip of build.clips) {
      expect(clip.textStyle!.fontSize).toBeLessThan(0.5 * H);
    }
  });
});

describe('the aside', () => {
  it('sets a discourse marker in the reference’s accent face, not a small headline', () => {
    /*
      The reference's small green italic word IS the word `like`, set in
      Trebuchet MS Bold Italic against a body in Visby CF Extra Bold.
      Read off CapCut's own inspector at t=78s.
    */
    const picked = pickEmphasis('so basically the encoder crashed');
    const marker = picked.find((p) => p.text === 'basically');
    expect(marker?.tier).toBe('aside');

    const style = wordStyle(marker!, 'Poppins', W, H);
    expect(style.fontFamily).toBe(ACCENT_FAMILY);
    expect(style.italic).toBe(true);
    expect(style.color).toBe(EMPHASIS_GREEN);
    expect(style.fontSize).toBeLessThan(
      wordStyle(word('encoder', 0, 'normal'), 'Poppins', W, H).fontSize
    );
  });

  it('never lets an aside be the hero of its phrase', () => {
    const picked = pickEmphasis('so basically actually really');
    expect(picked.some((p) => p.tier === 'emphasis')).toBe(false);
  });

  it('leaves ordinary stop words in the headline face', () => {
    const style = wordStyle(word('the', 0, 'minor'), 'Poppins', W, H);
    expect(style.fontFamily).toBe('Poppins');
    expect(style.italic).toBe(false);
    expect(style.color).toBe(INK_BLACK);
  });
});
