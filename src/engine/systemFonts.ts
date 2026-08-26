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

/*
  Local Font Access throws `SecurityError: Page needs to be visible.`
  while the window is hidden, and an Electron window is hidden for the
  whole of its startup: it is created with `show: false` and revealed on
  `ready-to-show`. A packaged build loads its renderer from a local file
  fast enough to ask before the reveal, lose, and fall back — while a
  dev build's slower dev-server round-trip means the window is already
  up. That is the whole of the difference, and it cost this session a
  packaged app that offered 33 families on a machine with 183.

  macOS occlusion counts as hidden too, so backgrounding the window at
  the wrong moment reproduces it in either build.
*/
const VISIBILITY_WAIT_MS = 10_000;

async function whenVisible(): Promise<void> {
  if (typeof document === 'undefined') return;
  if (document.visibilityState === 'visible') return;

  await new Promise<void>((resolve) => {
    let timer = 0;
    const done = () => {
      document.removeEventListener('visibilitychange', onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (document.visibilityState === 'visible') done();
    };
    document.addEventListener('visibilitychange', onChange);
    // Never block the font list forever on a window nobody shows.
    timer = window.setTimeout(done, VISIBILITY_WAIT_MS);
  });
}

interface LocalQuery {
  /** The real system list, or null when we could not get it. */
  families: string[] | null;
  /** Null because of something that could pass — so do not cache it. */
  retryable: boolean;
}

/** The full system list, when the browser will give it to us. */
async function queryLocal(): Promise<LocalQuery> {
  const query = (window as unknown as {
    queryLocalFonts?: () => Promise<LocalFontData[]>;
  }).queryLocalFonts;

  // Not this browser. That answer will not change.
  if (typeof query !== 'function') return { families: null, retryable: false };

  await whenVisible();

  try {
    const fonts = await query();
    return { families: [...new Set(fonts.map((f) => f.family))], retryable: false };
  } catch {
    /*
      Denied is permanent; hidden is not. Distinguishing them is the
      difference between a fallback and a fallback burned into the cache
      for the rest of the session.
    */
    const hidden = typeof document !== 'undefined' && document.visibilityState !== 'visible';
    return { families: null, retryable: hidden };
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
    enumerated = local.families !== null;
    const systemFamilies = local.families ?? CANDIDATES.filter(isFontAvailable);

    const system: FontOption[] = systemFamilies
      .filter((family) => !BUNDLED.includes(family))
      .sort((a, b) => a.localeCompare(b))
      .map((family) => ({ family, source: 'system' as const }));

    const list = [...bundled, ...system];

    /*
      A probed list stood in for one we could still get. Hand it back so
      the caller has something, but leave the cache empty so the next ask
      tries again rather than serving 33 fonts until the app restarts.
    */
    if (local.families === null && local.retryable) {
      loading = null;
      return list;
    }

    cache = list;
    return cache;
  })();

  return loading;
}

/**
 * Whether the loaded list is the machine's real one or a probed stand-in.
 *
 * The difference matters to anyone acting on it: a probed list is a
 * fixed set of common families that happen to exist here, so a name
 * missing from it is not evidence the machine lacks that font.
 */
export function fontsAreEnumerated(): boolean {
  return enumerated;
}

/** What has been loaded so far, for a synchronous first render. */
export function loadedFonts(): FontOption[] {
  return cache ?? BUNDLED.map((family) => ({ family, source: 'bundled' as const }));
}
