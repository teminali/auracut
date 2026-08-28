/*
  How a caption is broken into lines.

  Written from looking at a real build rather than from the rules: the
  tutorial skill asked Whisper for segments of up to 70 characters and
  then put each one on screen as a SINGLE line, so a caption ran the
  full width of the frame and the eye had to travel the picture to read
  it. Nothing was wrong with any number in the style; the caption was
  simply never wrapped.

  The interesting case is not "does it wrap" but WHERE, which is the
  difference between a caption that looks typeset and one that looks
  like text in a box.
*/
import { describe, it, expect } from 'vitest';
import { balanceLines, reflowCues } from './captions';
import {
  captionStyleFor, CAPTION_STYLE, CAPTION_REFERENCE_HEIGHT,
} from './recordingProject';

describe('breaking a caption into two lines', () => {
  it('leaves a line that already fits', () => {
    expect(balanceLines('First we open the payroll screen.', 38))
      .toBe('First we open the payroll screen.');
  });

  it('breaks a long line into two', () => {
    const out = balanceLines('na konaginsia pavo transatoka konecti indigito kwenye mcps', 38);
    expect(out.split('\n')).toHaveLength(2);
  });

  it('breaks it in the MIDDLE, not at the character limit', () => {
    /*
      The whole point. A greedy wrap fills the first line to 38 and drops
      the remainder underneath, which gives the long-line-with-two-words
      shape that reads as amateur. Balanced gives two lines of similar
      length.
    */
    const [first, second] = balanceLines(
      'na konaginsia pavo transatoka konecti indigito kwenye mcps', 38
    ).split('\n');
    expect(Math.abs(first.length - second.length)).toBeLessThanOrEqual(6);

    // And what a greedy wrap would have produced, for contrast.
    expect(first.length).toBeLessThan(38);
  });

  it('never returns more than two lines', () => {
    const long = Array.from({ length: 40 }, () => 'word').join(' ');
    expect(balanceLines(long, 38).split('\n')).toHaveLength(2);
  });

  it('collapses whitespace rather than wrapping around it', () => {
    expect(balanceLines('  two   spaces   here  ', 38)).toBe('two spaces here');
  });

  it('leaves a single unbreakable word alone', () => {
    const word = 'Supercalifragilisticexpialidociousandthensome';
    expect(balanceLines(word, 38)).toBe(word);
  });

  it('keeps every word, in order', () => {
    const line = 'payment method ya sasa kwenye expenditure na kadhalika';
    expect(balanceLines(line, 38).replace('\n', ' ')).toBe(line);
  });
});

describe('the two passes together, as the tutorial build runs them', () => {
  /*
    `reflowCues` first at twice the line limit, so anything that cannot
    fit in two lines becomes consecutive cues; then `balanceLines`, so
    what is left breaks in the middle. Four lines on screen is a wall of
    text however it is broken.
  */
  const MAX = 38;

  it('turns one over-long cue into consecutive cues of at most two lines', () => {
    const cue = {
      index: 1,
      startMs: 0,
      endMs: 8000,
      text: Array.from({ length: 30 }, (_, i) => `word${i}`).join(' '),
    };
    const out = reflowCues([cue], MAX * 2).map((c) => balanceLines(c.text, MAX));

    expect(out.length).toBeGreaterThan(1);
    for (const line of out) expect(line.split('\n').length).toBeLessThanOrEqual(2);
  });

  it('leaves a short cue as one cue and one line', () => {
    const out = reflowCues(
      [{ index: 1, startMs: 0, endMs: 2000, text: 'Save this.' }], MAX * 2
    ).map((c) => balanceLines(c.text, MAX));
    expect(out).toEqual(['Save this.']);
  });

  it('does not drop or reorder the words across both passes', () => {
    const text = 'So as you can see this is the instructions you can create '
      + 'your new connection here and then name it';
    const out = reflowCues([{ index: 1, startMs: 0, endMs: 9000, text }], MAX * 2)
      .map((c) => balanceLines(c.text, MAX))
      .join(' ')
      .replace(/\n/g, ' ');
    expect(out).toBe(text);
  });
});

describe('sizing a caption to the frame it is drawn in', () => {
  /*
    The style's numbers are canvas PIXELS and the canvas is cut to the
    recorded display's aspect ratio, so the same style is a different
    caption on every take. Found by `verify.py` rather than by looking:
    the camera-takeover check measures how much of the frame is the
    camera, and it fell from 92% to 88% when captions became two-line,
    because on that suite's 800-tall canvas the chip was covering the
    face. Scaled, the same check reads 98%.
  */
  it('is the style unchanged at the height it was designed against', () => {
    const at = captionStyleFor(CAPTION_REFERENCE_HEIGHT);
    expect(at.fontSize).toBe(CAPTION_STYLE.fontSize);
    expect(at.backgroundPadding).toBe(CAPTION_STYLE.backgroundPadding);
    expect(at.backgroundRadius).toBe(CAPTION_STYLE.backgroundRadius);
  });

  it('holds the caption at a constant share of frame height', () => {
    const share = (h: number) => captionStyleFor(h).fontSize! / h;
    const reference = share(CAPTION_REFERENCE_HEIGHT);
    for (const h of [900, 1080, 1440, 2160]) {
      expect(Math.abs(share(h) - reference)).toBeLessThan(0.002);
    }
  });

  it('scales the chip with the type, not just the type', () => {
    /*
      Scaling only the font is what leaves small text swimming in a
      large chip. The ratio of padding to type size is what has to hold.
    */
    const ratio = (h: number) =>
      captionStyleFor(h).backgroundPadding! / captionStyleFor(h).fontSize!;
    expect(Math.abs(ratio(800) - ratio(CAPTION_REFERENCE_HEIGHT))).toBeLessThan(0.15);
  });

  it('keeps everything that is not a length exactly as it was', () => {
    const at = captionStyleFor(800);
    expect(at.fontWeight).toBe(CAPTION_STYLE.fontWeight);
    expect(at.color).toBe(CAPTION_STYLE.color);
    expect(at.background).toBe(CAPTION_STYLE.background);
    expect(at.lineHeight).toBe(CAPTION_STYLE.lineHeight);
  });

  it('does not shrink to unreadability on a tiny sequence', () => {
    // The floor exists so a 480-tall export still has a caption rather
    // than a grey smudge; it is deliberately not proportional.
    expect(captionStyleFor(200).fontSize!).toBeGreaterThanOrEqual(12);
  });
});
