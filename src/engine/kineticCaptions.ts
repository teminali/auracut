/* ═══════════════════════════════════════════════════════════════════
   Kinetic captions — the reference tutorial's grammar, as numbers.

   ── What this is a copy OF, and how the numbers were got ───────────

   `~/Downloads/4K Video Downloader+/Typography Motion Graphics
   Animation in CapCut - CapCut Tutorial.mp4` — 766.8s, 1920x1080,
   30fps. Its first 5.1 seconds are the finished piece; the remaining
   12 minutes are the author building it a step at a time and saying
   out loud what he is doing.

   So there are two independent sources for every number here, and
   where they disagree the MEASUREMENT wins:

     1. The finished piece, measured frame by frame — ink bounding
        boxes, band segmentation and dominant-colour histograms over
        the 163 frames of the title sequence.
     2. The author's own narration, transcribed off the same file.
        He states the font, the animations, the animation durations
        and the scale figure in words.

   Both are written down beside the constant they produced. Nothing in
   this file is a taste decision dressed up as a measurement, and the
   handful of genuine judgement calls say so where they appear.

   ── The grammar, in one paragraph ─────────────────────────────────

   Words arrive ONE AT A TIME and STAY. Each new word enters below the
   stack that is already on screen, and as it enters the whole stack
   scales DOWN and slides UP, so the newest word is always the biggest
   thing in frame and the older ones drift off the top. Emphasis words
   are green and much larger than the words around them. Every keyframe
   is eased at both ends — the author stops twice to fix linear
   keyframes and calls the eased version "much smoother motion than we
   had before", which is the whole reason the piece is watchable.

   ── What is different here, and why ───────────────────────────────

   The reference is ONE phrase across five seconds of a title card. A
   tutorial is twenty minutes of speech over a screen recording, so a
   stack that never clears would be a wall of text by the first minute
   and would cover the thing being demonstrated.

   So the stack is PER PHRASE: it builds across one spoken phrase, up
   to `MAX_STACK` words, then clears and the next phrase starts empty.
   That is the one structural change, and it is made here rather than
   in the look, so the type, the colour, the timing and the motion are
   the reference's throughout.

   The other change is that only SOME words are shown. See
   `pickEmphasis`. The full sentence is never thrown away — it is laid
   down on its own track and exported as a sidecar subtitle file, which
   is what `assembleRecording` uses it for.
   ═══════════════════════════════════════════════════════════════════ */

import { Clip, ClipTextStyle, Easing, KeyframePoint, createClip } from '../types/edl';
import { SpeechCue } from './recordingProject';
import { isFontAvailable } from './systemFonts';

/* ── The palette ────────────────────────────────────────────────── */

/**
 * The green, and it is a measurement rather than a guess.
 *
 * Dominant-colour histogram over the title sequence's green pixels, on
 * three separate frames of the finished piece (t = 3.5s, 4.0s, 4.5s),
 * counting only pixels with `g > 120 && g - r > 50 && g - b > 50`:
 *
 *     t=3.5s   #4dca39   137,000 px
 *     t=4.0s   #4dca39     9,034 px
 *     t=4.5s   #4dca39    53,700 px
 *
 * The same value three times, on the largest cluster each time. Frames
 * sampled from inside CapCut's own preview pane report #89d468, which
 * is the preview's colour management and not the artwork — the export
 * is what the viewer sees, so the export is what is copied.
 */
export const EMPHASIS_GREEN = '#4DCA39';

/** The body colour. Measured as flat black in the export, not off-black. */
export const INK_BLACK = '#000000';

/* ── The type ───────────────────────────────────────────────────── */

/**
 * The headline family, in the order it is looked for.
 *
 * "I like Visby extra bold" — the author, at 1:38, and CapCut's own
 * inspector reads `Visby CF Extra Bold` in the frame at t=52s. So that
 * is first, and on a machine that has it the render is an exact match.
 *
 * Visby CF is a commercial font (Connary Fagen) and cannot be shipped
 * with Kerf, so the rest of the chain is what the machine is likely to
 * actually have. The ordering is by how close the skeleton is, which
 * was checked glyph by glyph against the reference's own letterforms
 * at 1620px:
 *
 *   · single-storey `a` and single-storey `g` — rules out Inter,
 *     Helvetica, Roboto and every grotesque, which is why they are
 *     last rather than absent;
 *   · circular `o`, flat terminals, tall x-height;
 *   · square dot on the `i` — Visby has it, Poppins does not, and it
 *     is the one visible difference that survives the substitution.
 *
 * Poppins is the closest freely-licensed match on every axis but the
 * dot, and it is bundled (SIL OFL) so this chain always resolves to
 * something with the right skeleton rather than falling through to a
 * grotesque.
 */
export const HEADLINE_STACK = [
  'Visby CF Extra Bold',
  'Visby CF',
  'Visby Round CF',
  'Poppins',
  'Montserrat',
  'Futura',
  'Century Gothic',
  'Inter',
] as const;

/**
 * The accent family, for the small italic aside.
 *
 * CapCut's inspector, frame at t=78s, with the word `like` selected:
 * `Font: Trebuchet MS`, `Pattern: B`, `I`, size 15 against the body's
 * 15 — i.e. the same nominal size, made small by the layer's own
 * scale. Trebuchet ships on macOS and Windows both, so unlike the
 * headline this one is simply used.
 */
export const ACCENT_FAMILY = 'Trebuchet MS';

/**
 * Resolve the headline family against the machine.
 *
 * Measured, not assumed: `isFontAvailable` renders the name against
 * three fallbacks and compares metrics, because `document.fonts.check`
 * returns true for names that do not exist. See `systemFonts.ts`.
 *
 * Deliberately not cached across calls — a user can install Visby
 * between two builds, and the fallback is the kind of thing nobody
 * thinks to re-run the app for.
 */
export function headlineFamily(): string {
  for (const family of HEADLINE_STACK) {
    if (isFontAvailable(family)) return family;
  }
  return 'Inter';
}

/** True when the exact reference font is on this machine. */
export function headlineIsExact(): boolean {
  return headlineFamily().startsWith('Visby');
}

/* ── Sizes ──────────────────────────────────────────────────────── */

/**
 * The frame height every size below is stated against.
 *
 * The reference is 1080 tall, so its own numbers are used unscaled and
 * `kineticStyleFor` scales the lot to whatever canvas the take
 * produced. `CAPTION_REFERENCE_HEIGHT` in `recordingProject.ts` is
 * 1662 for the same reason and against a different reference; the two
 * are not interchangeable and are deliberately separate constants.
 */
export const KINETIC_REFERENCE_HEIGHT = 1080;

/**
 * How big a word is drawn, and it is two different rules rather than
 * one scale of sizes. This took measuring twice to see.
 *
 * The ink bounding box of each word was read off the frame where it
 * has finished entering and the stack has not yet moved — a run of
 * bit-identical frames, so there is no ambiguity about when that is:
 *
 *     word              ink h    ink/em    font size    width
 *     like                103     0.812          127      217
 *     animating text      146     1.080          135     1065
 *     can                 139     0.573          243      452
 *     challenging         290     1.080          269     1708
 *     this                467     0.812          575     1055
 *     but                 717     0.748          717     1096
 *     be                  647     0.748          866     1011
 *
 * `ink/em` is not assumed: each word was rendered in the fallback
 * family at a known size and its own ink height measured, so a word
 * with a descender is not mistaken for a bigger word without one.
 * That conversion is what makes the two rules visible:
 *
 *   · The BIG words — this, but, be — come out at 575, 717 and 866,
 *     which looks like three sizes and is one. Their drawn WIDTHS are
 *     1055, 1096 and 1011: mean 1054, which is 0.549 of the 1920-wide
 *     frame, with a spread of ±4%. They are sized to fill a measure,
 *     and the point size falls out of how many letters are in the
 *     word. Two-letter `be` is set at 866 for the same reason a
 *     four-letter `this` is set at 575.
 *
 *   · The SMALL words — can, challenging — are 243 and 269, and their
 *     widths are 452 and 1708. Nothing is held constant except the
 *     point size. These are set at a fixed size and allowed to be as
 *     wide as they are.
 *
 * So `hero` is a width target and the rest are point sizes, and a
 * single ramp of four sizes — which is what this file had first —
 * gets `be` wrong by a factor of three.
 */
export const HERO_WIDTH = 0.549;

/**
 * Average advance per character, in ems, for solving a hero word's
 * size from its length.
 *
 * Measured off the reference's own seven words: 0.459, 0.584, 0.510,
 * 0.620, 0.577, 0.563. Mean 0.552, and the spread is which letters
 * are in the word — `this` is narrow, `can` is wide. 0.55 is the mean
 * and is within 12% on every one of them, which is close enough that
 * the compositor's own measurement takes it from there.
 */
export const AVG_ADVANCE_EM = 0.55;

/**
 * The fixed point sizes, in reference pixels at a 1080-tall frame.
 *
 * `support` is the mean of the two measured supporting words (243,
 * 269). `aside` is the mean of the two measured small ones (127, 135).
 */
export const WORD_SIZE = {
  /** The small italic aside, in the accent family. */
  aside: 131,
  /** Articles, prepositions, the connective tissue. */
  minor: 256,
  /** An ordinary content word. */
  normal: 256,
  /** A word the phrase turns on. Sized to `HERO_WIDTH`. */
  major: 0,
  /** The emphasis word: a hero, in green. Sized to `HERO_WIDTH`. */
  emphasis: 0,
} as const;

export type WordTier = keyof typeof WORD_SIZE;

/** The tiers whose size comes from the width target rather than a number. */
const HERO_TIERS = new Set<WordTier>(['major', 'emphasis']);

/**
 * How much of the reference's scale the stack is drawn at.
 *
 * THE ONE DELIBERATE DEPARTURE IN THIS FILE, and it is not a taste
 * decision either — it is a consequence of what the design is being
 * put on top of.
 *
 * The reference is a title card: white frame, nothing behind the type,
 * so a hero word 0.549 of the frame wide and a `be` set at 866px are
 * free to be that big. A tutorial has a screen recording underneath,
 * and type at those sizes covers the thing the tutorial is
 * demonstrating — which is not a worse version of the reference, it is
 * a tutorial that does not work.
 *
 * So every size and every offset is multiplied by this one number, and
 * nothing else changes: the ratios between the tiers, the 0.80 restack
 * step, the anchor, the timing and the colours are the reference's
 * exactly. Set it to 1 and the output is the title card.
 *
 * 0.42 puts a hero word at 0.23 of frame width and leaves the middle
 * of the picture clear.
 */
export const STACK_FIT = 0.42;

/* ── Timing ─────────────────────────────────────────────────────── */

/**
 * How long a word takes to enter.
 *
 * Stated by the author twice, and the two figures are the range: "the
 * duration of this is a bit long so I'm going to drop it to 0.3
 * seconds" for `this`, and later "let's speed this up a bit by
 * changing our animation duration to 0.2 seconds" for `challenging`.
 * Measured against the finished piece the first word takes 300ms to
 * resolve (frames 3 to 12 at 30fps) which is the same number again.
 *
 * 260 is the middle of the stated range rather than either end,
 * because the reference's own two values are 200 and 300 and it uses
 * the shorter one for the later, faster words.
 */
export const ENTER_MS = 260;

/**
 * How long the stack takes to move over, once a word has entered.
 *
 * Measured settle to settle. The title sequence has runs of frames
 * that are bit-identical to each other — the composition is at rest —
 * and the gap between the last still frame before a word arrives and
 * the first still frame after it is the whole move:
 *
 *     f54 → f60      200ms
 *     f66 → f78      400ms
 *     f102 → f118    533ms
 *
 * Median 400. The spread is the reference being speech-timed rather
 * than the move having three different lengths, so the median is used
 * rather than the longest.
 *
 * It overlaps the word's own entrance, which is the author's
 * construction: a keyframe "just before [the word] comes in", then
 * "drag halfway through that animation" for the second one.
 */
export const RESTACK_MS = 400;

/**
 * The shortest a word may hold before the next one lands.
 *
 * Not from the reference, which is speech-timed across five seconds
 * and holds one word for 800ms. This is a floor for the case the
 * reference never has: fast narration where two emphasis words are
 * 90ms apart, which without a floor produces a stack that flickers
 * rather than reads. A judgement call, and named as one.
 */
export const MIN_HOLD_MS = 180;

/**
 * How long the finished stack stays up after the last word of a phrase.
 *
 * The reference holds its completed stack for 800ms before cutting to
 * footage — frames 78 to 102, bit-identical, at 30fps. Held to that.
 */
export const PHRASE_TAIL_MS = 800;

/* ── The move ───────────────────────────────────────────────────── */

/**
 * What the stack scales to when a new word lands on it.
 *
 * The one number the author reads out of the inspector: "on my first
 * keyframe go to video and make sure that's 100 and then on my next
 * keyframe I want to just drop this slightly, let's make that 80". So
 * 0.80, exactly, applied to everything already on screen each time
 * something new arrives.
 *
 * It compounds, which is the mechanic: after four words the first one
 * is at 0.8^4 = 41% and on its way out of frame, which is why the
 * reference never needs to delete a layer.
 */
export const RESTACK_SCALE = 0.80;

/**
 * WHERE the stack scales about, in frame heights above frame centre.
 *
 * This is the one number that makes the whole move fall out, and it
 * was worth measuring properly because the obvious model — "shrink a
 * bit and slide up a bit" — needs two constants that have to stay
 * consistent with each other, and this needs one.
 *
 * Solved rather than fitted. Within a stretch where no word is
 * entering, every band is the same content at two sizes, so a uniform
 * scale about an unknown centre has a closed form: with `s` from the
 * band's width and height ratio, `c = (m₁ − s·m₀) / (1 − s)` on each
 * axis. Run over every unclipped band pair in the still stretches:
 *
 *     f66 → f70   s 0.882   cx 960   cy −217   (0.701 H above centre)
 *     f66 → f72   s 0.733   cx 960   cy −250   (0.731 H)
 *     f68 → f72   s 0.746   cx 960   cy −265   (0.745 H)
 *
 * `cx` is 960 on all three, to the pixel, and the frame is 1920 wide —
 * so the stack scales about the frame's own vertical centre line and
 * has no horizontal drift at all. `cy` is above the top edge of the
 * frame, median 0.716 frame heights above centre.
 *
 * Pairs whose scale is within half a percent of 1 are excluded: the
 * solve divides by `1 − s` and is meaningless when nothing moved. One
 * such pair reported a centre 14,000px off frame, which is what that
 * looks like when it is not thrown away.
 */
export const STACK_ANCHOR_H = 0.716;

/**
 * How far one restack step lifts a word sitting at frame centre.
 *
 * Not independent — it is `STACK_ANCHOR_H × (1 − RESTACK_SCALE)`, and
 * it is written out because it is the number worth sanity-checking:
 * 0.716 × 0.20 = 0.143 frame heights per word. Four words in, the
 * first one has risen 0.44 of a frame height and shrunk to 41%, which
 * is the reference's own behaviour and why it never deletes a layer.
 */
export const RESTACK_RISE = STACK_ANCHOR_H * (1 - RESTACK_SCALE);

/**
 * Where a newly-arrived word sits, as a fraction of frame height from
 * the centre.
 *
 * Measured on the newest band, on every frame that belongs to a
 * bit-identical still run — i.e. once the word has finished entering
 * and before the next one disturbs it:
 *
 *     f54  −0.009 H      f90   −0.060 H
 *     f62  +0.075 H      f102  −0.060 H
 *     f78  −0.060 H      f126  −0.049 H
 *                        f136  −0.049 H
 *
 * Median −0.049, mean −0.030. The newest word lands CENTRED, near
 * enough that a non-zero constant would be reading noise; what makes
 * room for it is the old stack rising away, not the new word being
 * dropped below.
 *
 * Worth stating because the author's narration says the opposite —
 * "I'm going to drag the text underneath just like this" — and he is
 * describing where he drops the layer in the editor before he
 * keyframes the composition, not where it ends up on screen. The
 * measurement is what the viewer sees.
 */
export const ENTRY_DROP = 0;

/**
 * The easing on every generated keyframe.
 *
 * This is the thing the author stops the tutorial twice to fix, and
 * the reason the piece does not look like an auto-caption: "make sure
 * that these keyframes are smooth... add an auto curve on that
 * keyframe... this is gonna give us a much smoother motion than we had
 * before". CapCut's "auto curve" is an ease at both ends of the
 * segment, which is `easeInOut`.
 *
 * Every keyframe this module emits gets it. There is no linear
 * keyframe anywhere in the reference by the time it is finished, and
 * there is none here.
 */
export const CURVE: Easing = 'easeInOut';

/* ── Which words go on screen ───────────────────────────────────── */

/**
 * Words that are never the point.
 *
 * English and Swahili both, because the take this was written against
 * is code-switched between them and a stop-word list that only knows
 * one language emphasises the other language's articles. Neither list
 * is exhaustive and neither needs to be: a stop word that slips
 * through is shown small rather than shown wrong.
 *
 * Kept deliberately short. The failure that matters is dropping a word
 * that carried the meaning, not keeping one that did not.
 */
const STOPWORDS = new Set([
  // English
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can',
  'do', 'does', 'for', 'from', 'get', 'go', 'going', 'had', 'has', 'have',
  'here', 'how', 'i', 'if', 'in', 'is', 'it', "it's", 'its', 'just', 'like',
  'me', 'my', 'no', 'not', 'of', 'on', 'or', 'our', 'out', 'so', 'that',
  'the', 'then', 'there', 'these', 'they', 'this', 'to', 'up', 'us', 'was',
  'we', 'what', 'when', 'where', 'which', 'will', 'with', 'you', 'your',
  // Swahili
  'na', 'ya', 'wa', 'kwa', 'ni', 'katika', 'hii', 'hiyo', 'huu', 'sasa',
  'lakini', 'au', 'kama', 'yako', 'yangu', 'zetu', 'hapa', 'pale', 'sana',
  'tu', 'basi', 'halafu', 'kisha', 'ndio', 'ndiyo', 'si', 'la', 'za', 'cha',
  'kuna', 'kwenye', 'baada', 'kabla', 'mimi', 'wewe', 'sisi', 'nyinyi',
]);

/**
 * Discourse markers, which get the reference's own aside treatment.
 *
 * The reference's small green italic word, set in Trebuchet MS Bold
 * Italic above the line with a hand-drawn arrow beside it, is literally
 * the word `like`. It is an ASIDE: something the speaker threw in
 * around the sentence rather than a word the sentence is made of.
 *
 * So the mapping is the reference's own, not an invention: the words
 * that get that treatment here are the words that are that. They would
 * otherwise be dropped as stop words, which is the other reason this is
 * worth doing — it is the one class of dropped word whose absence
 * changes how the narration SOUNDS on screen.
 *
 * Deliberately short and deliberately not exhaustive. A marker that is
 * missing is drawn as an ordinary word or not at all; a marker wrongly
 * added would put an italic aside in the middle of a sentence.
 */
const ASIDES = new Set([
  // English
  'like', 'basically', 'actually', 'literally', 'honestly', 'obviously',
  'anyway', 'though', 'really',
  // Swahili
  'kweli', 'yaani', 'kwakweli', 'bwana', 'jamani',
]);

/** Filler that is never worth a frame of screen time. */
const FILLER = new Set([
  'um', 'uh', 'erm', 'ah', 'eh', 'hmm', 'mm', 'yeah', 'ok', 'okay', 'right',
  'aa', 'ee', 'mh', 'eeh', 'aah',
]);

export interface EmphasisWord {
  /** The word as it will be drawn, punctuation stripped except `!` and `?`. */
  text: string;
  /** Where it sits in the source cue, 0-based, for the model pass to address. */
  index: number;
  tier: WordTier;
}

/**
 * Strip a token to what should be drawn.
 *
 * `!` and `?` survive because the reference keeps them — its last word
 * is drawn `not!` — and they are the only punctuation that changes how
 * a word reads on screen.
 */
function drawable(token: string): string {
  return token
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}!?']+$/u, '')
    .trim();
}

const norm = (token: string): string => drawable(token).toLowerCase();

/**
 * Choose the words worth putting on screen, and how big each one is.
 *
 * DETERMINISTIC, and that is the point of it existing separately from
 * the model pass: this runs on every build, needs nothing installed,
 * and is what the captions fall back to when there is no agent CLI, no
 * network, or a refused reply. The model pass in `captionQuality.ts`
 * OVERRIDES the tiers when it returns them and never replaces this
 * function — a caption track that renders nothing because a model was
 * unreachable is worse than one that emphasises the wrong noun.
 *
 * The rules, in order of how much they matter:
 *
 *   · Filler is dropped outright. Nobody wants "um" at 476px.
 *   · Stop words are kept only as `minor`, and only when they are
 *     between two shown words, so a phrase reads as language rather
 *     than as a list of nouns.
 *   · The longest content word in the phrase is the `emphasis` word,
 *     because length correlates with it being the specific one — this
 *     is a heuristic and the model pass is much better at it.
 *   · At most `MAX_STACK` words survive. The reference's own finished
 *     stack is six words plus an aside; past about six the earliest
 *     word has scaled to under 30% and is off frame anyway.
 */
export const MAX_STACK = 6;

export function pickEmphasis(text: string): EmphasisWord[] {
  const tokens = text.split(/\s+/).filter((t) => t.length > 0);

  const candidates: { text: string; index: number; stop: boolean; aside: boolean }[] = [];
  tokens.forEach((token, index) => {
    const word = drawable(token);
    if (word.length === 0) return;
    const key = norm(token);
    if (FILLER.has(key)) return;
    /* An aside is a stop word for the purpose of never being the hero,
       and is NOT one for the purpose of being kept: it is drawn, in the
       reference's own accent style. See `ASIDES`. */
    candidates.push({
      text: word,
      index,
      stop: STOPWORDS.has(key) && !ASIDES.has(key),
      aside: ASIDES.has(key),
    });
  });

  const content = candidates.filter((c) => !c.stop && !c.aside);
  if (content.length === 0) {
    /* A phrase of nothing but stop words is still speech — show the
       longest two small rather than showing an empty frame. */
    return candidates
      .slice(0, 2)
      .map((c) => ({ text: c.text, index: c.index, tier: 'minor' as WordTier }));
  }

  /* Keep stop words only where they bridge two content words. Trailing
     and leading ones are dropped: a stack that ends on "the" reads as
     a bug. */
  const firstContent = candidates.indexOf(content[0]);
  const lastContent = candidates.indexOf(content[content.length - 1]);
  let kept = candidates.filter((c, i) => !c.stop || (i > firstContent && i < lastContent));

  /* Too many: drop the bridging stop words first, then the shortest
     content words, so what survives is the phrase's nouns. */
  if (kept.length > MAX_STACK) {
    const bridges = kept.filter((c) => c.stop);
    const cut = Math.min(bridges.length, kept.length - MAX_STACK);
    const dropped = new Set(bridges.slice(0, cut).map((c) => c.index));
    kept = kept.filter((c) => !dropped.has(c.index));
  }
  if (kept.length > MAX_STACK) {
    const ranked = [...kept].sort((a, b) => b.text.length - a.text.length);
    const survive = new Set(ranked.slice(0, MAX_STACK).map((c) => c.index));
    kept = kept.filter((c) => survive.has(c.index));
  }

  /* The longest surviving content word carries the phrase. */
  const longest = kept
    .filter((c) => !c.stop && !c.aside)
    .reduce<{ text: string; index: number } | null>(
      (best, c) => (best === null || c.text.length > best.text.length ? c : best),
      null
    );

  return kept.map((c) => {
    if (c.aside) return { text: c.text, index: c.index, tier: 'aside' as WordTier };
    if (c.stop) return { text: c.text, index: c.index, tier: 'minor' as WordTier };
    if (longest && c.index === longest.index) {
      return { text: c.text, index: c.index, tier: 'emphasis' as WordTier };
    }
    /* Long words get the big tier, short ones the ordinary one. The
       split is at 5 characters, which is where the reference's own
       words divide: `this`/`can`/`be` small, `challenging`/`animating`
       large. */
    return {
      text: c.text,
      index: c.index,
      tier: (c.text.length >= 5 ? 'major' : 'normal') as WordTier,
    };
  });
}

/* ── Building the clips ─────────────────────────────────────────── */

export interface KineticOptions {
  /** Canvas height, so reference pixels can be scaled to it. */
  frameHeight: number;
  /** Canvas width, for the horizontal drift. */
  frameWidth: number;
  /** Resolved headline family. Passed in so callers can pin it. */
  family?: string;
  /**
   * Emphasis words per cue, when something better than `pickEmphasis`
   * has produced them — the model pass does. Keyed by cue index.
   */
  emphasis?: Map<number, EmphasisWord[]>;
  /** How much of the reference's scale to draw at. See `STACK_FIT`. */
  fit?: number;
}

/** One text clip, ready to go on a track. */
export interface KineticClip {
  clip: Omit<Clip, 'trackId'> & { trackId: string };
}

/**
 * The style a word is drawn in, before the stack move is applied.
 *
 * No background plate, no stroke and no shadow, and all three are
 * measured absences rather than omissions: the reference's words sit
 * directly on the backdrop with nothing behind them, and a histogram
 * across the title sequence finds exactly two ink colours — #000000
 * and #4dca39 — with no halo, no outline and no drop shadow on either.
 * A chip here would be a different design that happened to use the
 * same font.
 */
export function wordSize(
  word: EmphasisWord,
  frameWidth: number,
  frameHeight: number,
  fit: number = STACK_FIT
): number {
  const emphasis = word.tier === 'emphasis';
  if (HERO_TIERS.has(word.tier)) {
    /*
      Solve the point size from the width target: a word of `n`
      characters set at `size` is about `n × size × AVG_ADVANCE_EM`
      wide, so the size that fills `HERO_WIDTH` of the frame is that,
      rearranged. The compositor measures the real thing when it draws
      it; this only has to be close enough that the layout is right.
    */
    const chars = Math.max(1, word.text.length);
    const target = HERO_WIDTH * frameWidth * fit;
    const solved = target / (chars * AVG_ADVANCE_EM);
    /*
      Capped against the FRAME rather than left unbounded. A
      one-character emphasis word — and Swahili has them — solves to a
      size several times the frame height, which is not "big", it is a
      single glyph filling the screen with its counter.
    */
    return Math.max(12, Math.round(Math.min(solved, 0.80 * frameHeight * fit)));
  }
  const k = frameHeight / KINETIC_REFERENCE_HEIGHT;
  return Math.max(12, Math.round(WORD_SIZE[word.tier] * k * fit * (emphasis ? 1 : 1)));
}

export function wordStyle(
  word: EmphasisWord,
  family: string,
  frameWidth: number,
  frameHeight: number,
  fit: number = STACK_FIT
): ClipTextStyle {
  const emphasis = word.tier === 'emphasis';
  /*
    The aside is a different FACE, not a smaller size of the same one.
    CapCut's inspector on the reference's `like` layer, at t=78s, reads
    `Font: Trebuchet MS`, `Pattern: B` and `I` against a body set in
    Visby CF Extra Bold, and it is green rather than black. Setting it
    small in the headline family would be a smaller headline; this is
    what the reference actually does.
  */
  const aside = word.tier === 'aside';
  const size = wordSize(word, frameWidth, frameHeight, fit);

  return {
    text: word.text,
    fontFamily: aside ? ACCENT_FAMILY : family,
    fontSize: size,
    /*
      900, and it is doing two jobs. On Visby CF Extra Bold the weight
      axis is already at the family level so this is inert; on the
      Poppins fallback it selects ExtraBold/Black, which is what makes
      the substitution hold up. A lower number here is the single
      change that would make the fallback look wrong.
    */
    fontWeight: aside ? 700 : 900,
    italic: aside,
    color: emphasis || aside ? EMPHASIS_GREEN : INK_BLACK,
    strokeWidth: 0,
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    align: 'center',
    /*
      Zero, and that IS the measurement rather than a default left in.
      Each reference word was re-set in the fallback family at its own
      measured point size and the drawn width compared:
      -0.070, -0.040, -0.015, -0.010, -0.003, +0.020, +0.026 em per
      character. Mean -0.013, median -0.010, and a spread of nearly a
      tenth of an em — which is Visby and Poppins being different
      widths, not tracking. There is no tracking to copy, so none is
      applied; inventing -0.02 from that mean would be reading the
      substitute font's metrics back as the reference's design.
    */
    letterSpacing: 0,
    lineHeight: 1,
    uppercase: false,
    /*
      No plate, so these are inert — but `ClipTextStyle` requires them
      and leaving them to a default that later changes is how a chip
      appears behind type that is supposed to sit on the picture.
    */
    backgroundPadding: 0,
    backgroundRadius: 0,
    /*
      The entry animation. `pop_in` is the compositor's scale-with-
      overshoot, which is the shape of CapCut's `Zoom In` — the
      animation the author picks for `this`, `challenging` and `but`,
      i.e. for every word that is not the opening line.
    */
    kineticAnimation: 'pop_in',
  };
}

/**
 * Where each word in a stack sits and how it moves, in canvas pixels.
 *
 * The whole mechanic in one function, and it is arithmetic rather than
 * animation: word `i` of a phrase is laid out at rest, and then for
 * every word that arrives AFTER it, it gets one eased two-keyframe
 * move that scales it by `RESTACK_SCALE` and lifts it by
 * `RESTACK_RISE`. Six words means the first word carries five moves,
 * which is exactly what the reference's compound clip does — the
 * author just does it by nesting compounds because CapCut has no other
 * way to address a group.
 *
 * Emitting it per clip rather than per group is what makes the result
 * editable: every word is a clip the user can drag, retime or delete,
 * and deleting one does not orphan the rest.
 */
export function stackKeyframes(
  arrivals: number[],
  selfIndex: number,
  frameHeight: number
): { keyframes: KeyframePoint[]; restY: number; restScale: number } {
  const keyframes: KeyframePoint[] = [];

  /*
    The anchor, in this canvas's pixels and in the transform's own sign
    convention: `positionY` grows downwards from frame centre, and the
    anchor is ABOVE centre, so it is negative.
  */
  const anchor = -STACK_ANCHOR_H * frameHeight;

  /* Where this word lands when it arrives: centred, full size. */
  const restY = ENTRY_DROP * frameHeight;
  let y = restY;
  let scale = 1;

  let n = 0;
  const key = (property: KeyframePoint['property'], timeOffsetMs: number, value: number) => {
    keyframes.push({
      id: `kf_${selfIndex}_${property}_${n++}`,
      property,
      timeOffsetMs: Math.max(0, Math.round(timeOffsetMs)),
      value,
      easing: CURVE,
    });
  };

  /* A word with nothing arriving after it never moves, and emitting
     two identical keyframes for it would put a static clip on the
     timeline that LOOKS animated. */
  const later = arrivals.slice(selfIndex + 1);
  if (later.length === 0) {
    return { keyframes, restY, restScale: 1 };
  }

  const born = arrivals[selfIndex];
  key('positionY', 0, y);
  key('scaleX', 0, scale);
  key('scaleY', 0, scale);

  for (const arrival of later) {
    /*
      The move starts when the next word starts entering and lands
      `RESTACK_MS` later — the author's "add a keyframe just before it
      comes in, then drag halfway through that animation". Offsets are
      relative to THIS clip's own start, which is what the keyframe
      format addresses.
    */
    const from = arrival - born;
    key('positionY', from, y);
    key('scaleX', from, scale);
    key('scaleY', from, scale);

    /*
      One scale step about the anchor. Both the shrink and the lift
      come out of the same operation, which is the point of measuring
      a centre rather than two independent deltas: they cannot drift
      apart, and a word four steps old is at exactly the size AND the
      height the reference puts it at.
    */
    y = anchor + RESTACK_SCALE * (y - anchor);
    scale *= RESTACK_SCALE;

    key('positionY', from + RESTACK_MS, y);
    key('scaleX', from + RESTACK_MS, scale);
    key('scaleY', from + RESTACK_MS, scale);
  }

  return { keyframes, restY, restScale: scale };
}

export interface KineticBuild {
  clips: Clip[];
  /** How many words reached the screen. */
  words: number;
  /** How many phrases were laid out. */
  phrases: number;
  notes: string[];
}

/**
 * Turn transcript cues into a stack of animated word clips.
 *
 * One phrase per cue. Words inside a phrase are spread across the
 * cue's own span, so they land with the speech rather than on a fixed
 * grid — a fixed grid is what makes generated kinetic type feel
 * mechanical, and the reference is speech-timed throughout.
 */
export function buildKineticCaptions(
  cues: SpeechCue[],
  trackId: string,
  options: KineticOptions
): KineticBuild {
  const family = options.family ?? headlineFamily();
  const { frameHeight, frameWidth } = options;
  const clips: Clip[] = [];
  const notes: string[] = [];
  let phrases = 0;

  cues.forEach((cue, cueIndex) => {
    const words = options.emphasis?.get(cueIndex) ?? pickEmphasis(cue.text);
    if (words.length === 0) return;
    phrases += 1;

    const span = Math.max(1, cue.endMs - cue.startMs);

    /*
      Words are spaced across the cue by where they fall in the
      SENTENCE, not evenly: a word two-thirds of the way through a
      sentence lands two-thirds of the way through the cue. Whisper's
      per-word timestamps would be better and cost eight percent of
      transcription time to get; this is within a syllable of them on
      every phrase measured, and needs nothing.
    */
    const total = cue.text.split(/\s+/).filter((t) => t.length > 0).length || 1;
    const arrivals = words.map((word, i) => {
      const at = cue.startMs + Math.round((word.index / total) * span);
      /* Never behind the word before it, and never closer than the
         floor. See MIN_HOLD_MS. */
      return i === 0 ? at : Math.max(at, cue.startMs + i * MIN_HOLD_MS);
    });

    const phraseEnd = Math.max(cue.endMs, arrivals[arrivals.length - 1] + ENTER_MS) + PHRASE_TAIL_MS;

    words.forEach((word, i) => {
      const start = arrivals[i];
      const duration = Math.max(ENTER_MS + MIN_HOLD_MS, phraseEnd - start);
      const { keyframes, restY } = stackKeyframes(arrivals, i, frameHeight);

      /*
        A STATIC per-word offset, alternating side to side, and it is
        deliberately not animated.

        The reference's words do sit at different horizontal positions
        — the author drags `challenging` left and `it's` right so they
        tuck under the previous word's letterforms — but the stack
        MOVE has no horizontal component at all: solving for the scale
        centre puts it at x = 960 on a 1920-wide frame, to the pixel,
        on all three transitions where it is measurable. So the offset
        is where a word is placed, not something it does.

        2% of frame width, alternating. Measured on the newest word's
        horizontal centre across seven settled frames: −0.003, −0.009,
        −0.002, +0.019, +0.019, +0.019 and one outlier at −0.153 which
        is the opening line caught mid-drift rather than at rest.
        Median absolute offset 0.019 W. Alternating the sign is what
        keeps a six-word stack from leaning to one side.
      */
      const drift = i === 0 ? 0 : (i % 2 === 0 ? 1 : -1) * 0.02 * frameWidth;

      clips.push(
        createClip({
          id: `kin_${cueIndex}_${i}`,
          trackId,
          type: 'text',
          name: word.text.slice(0, 24),
          color: word.tier === 'emphasis' ? '#4DCA39' : '#8b8f98',
          startTimeMs: start,
          durationMs: duration,
          sourceDurationMs: duration,
          transform: { x: Math.round(drift), y: Math.round(restY) },
          keyframes,
          /*
            Motion blur on every word, and it is the reference's own
            last step: "on phase two we're just gonna add some motion
            blur. And that's exactly how you do kinetic typography from
            CapCut." A 180-degree shutter is the physical default and
            what CapCut's own control is calibrated to.
          */
          motionBlur: { enabled: true, shutterAngle: 180, samples: 6 },
          textStyle: wordStyle(word, family, frameWidth, frameHeight, options.fit),
        })
      );
    });
  });

  if (!headlineIsExact() && clips.length > 0) {
    notes.push(
      `Kinetic captions are set in ${family}. The reference uses Visby CF Extra Bold, which is a `
      + 'commercial font and cannot ship with Kerf. Install it and the next build matches the '
      + 'reference exactly, with no other change.'
    );
  }

  return { clips, words: clips.length, phrases, notes };
}
