/* ═══════════════════════════════════════════════════════════════════
   Fonts the machine actually has.

   The font picker was nine hardcoded names — Inter, JetBrains Mono,
   Georgia, Impact, Arial Black, Courier New, Times New Roman, Verdana,
   Trebuchet MS — offered identically on every machine. Two problems at
   once: a Mac with three hundred families could use nine of them, and
   several of those nine are Windows fonts that a Mac does not have, so
   picking them silently fell back to the default and the preview did
   not change.

   The agent had it worse. `textStyle.fontFamily` is a plain string with
   no enumeration anywhere, so it could set "Helvetica Neue Condensed
   Black", get a success, and render in Inter.

   Two sources, in order:

     1. `queryLocalFonts()` — the real system list, when the browser
        exposes it and the user allows it.
     2. A candidate list, each entry width-probed against three
        fallbacks — always available, and it answers the question that
        matters: does this name resolve, or fall back?

   Note which API is NOT used: `document.fonts.check()` looks like the
   right call and is not. It reports whether the text can be rendered by
   the font set, which is true for every name because the fallback can
   always render it — it returns true for "Definitely Not A Font".

   Either way the list is MEASURED, never assumed.
   ═══════════════════════════════════════════════════════════════════ */

export interface FontOption {
  family: string;
  /** Where we learned about it, so the UI can group sensibly. */
  source: 'bundled' | 'system';
}

/** Shipped with the app, so they are present regardless of the OS. */
const BUNDLED = ['Inter', 'JetBrains Mono'];

/*
  Families worth probing when the full system list is unavailable.
  Deliberately cross-platform: whichever ones exist survive the check,
  and the rest are dropped rather than offered and quietly substituted.
*/
const CANDIDATES = [
  // macOS
  'Helvetica', 'Helvetica Neue', 'Avenir', 'Avenir Next', 'Futura', 'Optima',
  'Baskerville', 'Didot', 'Palatino', 'Menlo', 'Monaco', 'SF Pro Text',
  'American Typewriter', 'Chalkboard SE', 'Copperplate', 'Gill Sans',
  'Hoefler Text', 'Marker Felt', 'Papyrus', 'Snell Roundhand', 'Zapfino',
  // Windows
  'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Candara', 'Consolas',
  'Constantia', 'Corbel', 'Franklin Gothic Medium', 'Segoe UI', 'Tahoma',
  'Bahnschrift', 'Impact', 'Lucida Console', 'Comic Sans MS',
  // Common to most
  'Courier New', 'Georgia', 'Times New Roman', 'Trebuchet MS', 'Verdana',
  'Garamond', 'Bookman', 'Century Gothic', 'Rockwell',
  // Common Linux
  'DejaVu Sans', 'DejaVu Serif', 'Liberation Sans', 'Ubuntu', 'Cantarell',
  'Noto Sans', 'Noto Serif', 'FreeSans',
];

let cache: FontOption[] | null = null;
let loading: Promise<FontOption[]> | null = null;
/** True when `cache` came from the real system list, so it is complete. */
let enumerated = false;

/*
  `document.fonts.check()` is NOT the answer, though it looks like it.
  It reports whether the given text can be rendered by the font set —
  which is true for any family name at all, because the fallback can
  always render it. Asking it about "Definitely Not A Font" returns
  true. A check that always passes is worse than none: it makes the
  caller confident.

  What does work is measurement. Render a string in `"<family>", X` and
  in `X` alone; if the family resolved, the metrics differ from the
  fallback's. Three different fallbacks, because a real font can
  coincidentally match one of them.
*/
const PROBE_TEXT = 'mmmmmmmmmmlliWWWQGJ@#0Oo';
const FALLBACKS = ['monospace', 'serif', 'sans-serif'];

let probeCtx: CanvasRenderingContext2D | null = null;

function widthIn(font: string): number {
  if (!probeCtx) {
    const canvas = document.createElement('canvas');
    probeCtx = canvas.getContext('2d');
  }
  if (!probeCtx) return 0;
  probeCtx.font = font;
  return probeCtx.measureText(PROBE_TEXT).width;
}

/** Would text in this family actually render in it, or fall back? */
export function isFontAvailable(family: string): boolean {
  if (typeof document === 'undefined') return true;

  // Once the real list is known, membership is the authoritative answer.
  if (cache) {
    const wanted = family.trim().toLowerCase();
    if (cache.some((f) => f.family.toLowerCase() === wanted)) return true;
    // Only trust a negative from the enumerated list when it came from
    // the system itself; the probed fallback list is not exhaustive.
    if (enumerated) return false;
  }

  try {
    return FALLBACKS.some(
      (fallback) => widthIn(`72px "${family}", ${fallback}`) !== widthIn(`72px ${fallback}`)
    );
  } catch {
    return true;
  }
}

interface LocalFontData {
  family: string;
}

/** The full system list, when the browser will give it to us. */
async function queryLocal(): Promise<string[] | null> {
  const query = (window as unknown as {
    queryLocalFonts?: () => Promise<LocalFontData[]>;
  }).queryLocalFonts;

  if (typeof query !== 'function') return null;

  try {
    const fonts = await query();
    return [...new Set(fonts.map((f) => f.family))];
  } catch {
    // Denied, or unavailable in this context — fall back rather than fail.
    return null;
  }
}

/**
 * Every font the user can pick, measured on this machine.
 *
 * Cached: enumerating is not free, and the answer does not change
 * while the app is open.
 */
export async function loadFonts(): Promise<FontOption[]> {
  if (cache) return cache;
  if (loading) return loading;

  loading = (async () => {
    const bundled: FontOption[] = BUNDLED.map((family) => ({ family, source: 'bundled' as const }));

    const local = await queryLocal();
    enumerated = local !== null;
    const systemFamilies = local ?? CANDIDATES.filter(isFontAvailable);

    const system: FontOption[] = systemFamilies
      .filter((family) => !BUNDLED.includes(family))
      .sort((a, b) => a.localeCompare(b))
      .map((family) => ({ family, source: 'system' as const }));

    cache = [...bundled, ...system];
    return cache;
  })();

  return loading;
}

/** What has been loaded so far, for a synchronous first render. */
export function loadedFonts(): FontOption[] {
  return cache ?? BUNDLED.map((family) => ({ family, source: 'bundled' as const }));
}
