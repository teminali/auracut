/* ═══════════════════════════════════════════════════════════════════
   B-roll suggestions.

   What this file used to be: four Unsplash JPEGs named `.mp4`, labelled
   `H.264 High Profile` at `8.4 MB`, plus a keyword matcher hardcoded to
   one demo project's vocabulary — `whatsapp`, `oda`, `duka`, `biashara`,
   `dukabot`, `pesa`. Any other project fell through to the `else` branch
   every time, so a wedding video got "Matches AI technology theme" and
   the same stock still for every caption. Each suggestion carried a
   confidence of `0.94 + (index % 5) * 0.01` — an array index formatted
   as a measurement.

   It looked like analysis. It was a lookup table for a demo.

   What it is now: it searches the media the user ACTUALLY has. Every
   suggestion names the caption word it matched and the asset it matched
   against, so the basis is checkable. When the pool has nothing
   relevant it says so and suggests nothing, because an irrelevant
   cutaway proposed confidently is worse than no cutaway.
   ═══════════════════════════════════════════════════════════════════ */

import { Track, MediaAsset } from '../types/edl';

export interface BrollSuggestion {
  id: string;
  /** The caption word that produced this match. */
  keyword: string;
  /** Why, in terms a user can check against the two names involved. */
  reason: string;
  startTimeMs: number;
  durationMs: number;
  mediaAsset: MediaAsset;
  recommendedTransition: 'crossfade' | 'zoom_in' | 'whip_pan';
}

export interface BrollReport {
  suggestions: BrollSuggestion[];
  /** Set when nothing could be suggested, explaining which reason. */
  note?: string;
  /** Caption words that matched nothing — the gap, stated plainly. */
  unmatched: string[];
}

/*
  Words carry no visual meaning, so matching on them produces confident
  nonsense: "the" matching "The Wedding.mp4". Short and structural words
  are dropped before any comparison.
*/
const STOPWORDS = new Set([
  'the', 'and', 'for', 'you', 'your', 'our', 'with', 'that', 'this', 'from',
  'are', 'was', 'were', 'have', 'has', 'had', 'but', 'not', 'all', 'can',
  'will', 'just', 'about', 'into', 'over', 'they', 'them', 'their', 'what',
  'when', 'where', 'who', 'how', 'why', 'its', 'it\'s', 'his', 'her', 'she',
  'him', 'been', 'more', 'than', 'then', 'some', 'any', 'out', 'get', 'got',
  'one', 'two', 'now', 'new', 'like', 'here', 'there', 'very', 'much',
]);

function significantWords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9']+/)
        .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
    ),
  ];
}

/** Filenames separate words with punctuation, not spaces. */
const normalise = (text: string) => text.toLowerCase().replace(/[_\-.]+/g, ' ');

/**
 * Where in an asset a word matched — the NAME and the TRANSCRIPT are
 * different kinds of evidence and the caller has to be able to tell
 * them apart. Reporting a transcript hit as if the filename matched
 * makes a correct suggestion look like a bug, because the user reads
 * the filename, does not see the word, and stops trusting the tool.
 */
function matchField(asset: MediaAsset, word: string): 'name' | 'transcript' | null {
  if (normalise(asset.name).includes(word)) return 'name';
  if (asset.transcript && normalise(asset.transcript).includes(word)) return 'transcript';
  return null;
}

/**
 * Propose cutaways for the captions on the timeline, drawn from the
 * project's own media pool.
 *
 * `pool` is passed in rather than read from the store so this stays a
 * pure function — the same captions and the same pool always produce the
 * same suggestions, which is what makes it testable.
 */
export function analyzeTranscriptForBroll(tracks: Track[], pool: MediaAsset[]): BrollReport {
  const textClips = tracks
    .filter((t) => t.type === 'text')
    .flatMap((t) => t.clips)
    .filter((c) => c.textStyle?.text?.trim())
    .sort((a, b) => a.startTimeMs - b.startTimeMs);

  if (textClips.length === 0) {
    return {
      suggestions: [],
      unmatched: [],
      note: 'There are no captions on the timeline to read. Run generate_auto_captions or import_captions first.',
    };
  }

  /*
    Only visual media can be a cutaway. An audio asset matching a caption
    word is a real match and a useless suggestion.
  */
  const candidates = pool.filter((a) => a.type === 'video' || a.type === 'image');

  if (candidates.length === 0) {
    return {
      suggestions: [],
      unmatched: [],
      note:
        'The media pool has no video or image assets to cut away to. Import some footage first — ' +
        'Kerf has no built-in stock library.',
    };
  }

  const suggestions: BrollSuggestion[] = [];
  const unmatched = new Set<string>();
  /* One cutaway per asset: repeating the same shot at every mention is
     the single most obvious way an auto-edit looks automated. */
  const used = new Set<string>();

  textClips.forEach((clip, index) => {
    const words = significantWords(clip.textStyle!.text);
    if (words.length === 0) return;

    let best: { asset: MediaAsset; word: string; field: 'name' | 'transcript' } | null = null;

    /*
      A filename match beats a transcript match: someone named the file
      after what is in the shot, which is a stronger signal than the same
      word appearing in what was said over it.
    */
    for (const word of words) {
      for (const preferred of ['name', 'transcript'] as const) {
        const hit = candidates.find(
          (a) => !used.has(a.id) && matchField(a, word) === preferred
        );
        if (hit) { best = { asset: hit, word, field: preferred }; break; }
      }
      if (best) break;
    }

    if (!best) {
      for (const word of words) unmatched.add(word);
      return;
    }

    used.add(best.asset.id);
    suggestions.push({
      id: `broll_${clip.id}_${best.asset.id}`,
      keyword: best.word,
      reason:
        best.field === 'name'
          ? `The caption says "${best.word}", and the file is named "${best.asset.name}".`
          : `The caption says "${best.word}", and the transcript of "${best.asset.name}" says it too.`,
      startTimeMs: clip.startTimeMs,
      // Never outlast the line it illustrates, and never outlast the source.
      durationMs: Math.min(clip.durationMs, best.asset.durationMs || clip.durationMs, 4000),
      mediaAsset: best.asset,
      recommendedTransition: index % 2 === 0 ? 'crossfade' : 'whip_pan',
    });
  });

  return {
    suggestions,
    unmatched: [...unmatched].slice(0, 12),
    ...(suggestions.length === 0
      ? {
          note:
            'No caption word matched any asset in the media pool by name or transcript. ' +
            'Rename the footage after what it shows, or import media that matches the script.',
        }
      : {}),
  };
}
