/* ═══════════════════════════════════════════════════════════════════
   Tonal grading — highlights, shadows and sharpen.

   These three were stored on every clip, exposed as sliders in the
   colour inspector, listed to the agent by `list_properties` with a
   range, and set by three of the built-in look presets. Nothing
   rendered them. You dragged Highlights, the number moved, the picture
   did not — and `patch_clip` reported `shadows 0 → 40` as a successful
   change.

   They cannot be expressed as CSS filter functions: `brightness()` and
   `contrast()` act on the whole range, and lifting shadows means
   touching the low end and leaving the high end alone. That needs a
   tone curve.

   Canvas can reference an SVG filter by id — `ctx.filter = 'url(#x)'` —
   and Chromium honours it, including through `getImageData` and
   `toBlob`, which is what makes it usable for export as well as
   preview. Verified in the app before this was written: a black pixel
   through a 0→0.5 table came out at exactly 127.

   So: build one `<filter>` per distinct combination of settings, cache
   it by those settings, and hand the compositor an id.
   ═══════════════════════════════════════════════════════════════════ */

import { ClipFilters } from '../types/edl';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** How many points the tone curve is sampled at. */
const TABLE_STEPS = 17;

let host: SVGSVGElement | null = null;
const cache = new Map<string, string>();
let seq = 0;

/**
 * A zero-sized SVG parked in the document to hold the filter defs.
 *
 * It has to be IN the document — a detached SVG cannot be referenced by
 * `url(#id)` from a canvas.
 */
function ensureHost(): SVGSVGElement | null {
  if (host) return host;
  if (typeof document === 'undefined') return null;

  host = document.createElementNS(SVG_NS, 'svg');
  host.setAttribute('width', '0');
  host.setAttribute('height', '0');
  host.setAttribute('aria-hidden', 'true');
  host.style.position = 'absolute';
  host.style.width = '0';
  host.style.height = '0';
  host.style.overflow = 'hidden';
  document.body.appendChild(host);
  return host;
}

/**
 * The tone curve, as a table of output values for evenly spaced inputs.
 *
 * Each control acts where it should and fades out where it should not:
 * shadows weight by (1-x)², so the effect is strongest at black and
 * zero at white; highlights weight by x², the mirror. A straight
 * addition would just be brightness with extra steps.
 */
function toneTable(highlights: number, shadows: number): string {
  const h = (highlights / 100) * 0.5;
  const s = (shadows / 100) * 0.5;
  const out: string[] = [];

  for (let i = 0; i < TABLE_STEPS; i++) {
    const x = i / (TABLE_STEPS - 1);
    const shadowWeight = (1 - x) * (1 - x);
    const highlightWeight = x * x;
    const y = Math.max(0, Math.min(1, x + s * shadowWeight + h * highlightWeight));
    out.push(y.toFixed(4));
  }
  return out.join(' ');
}

/**
 * Unsharp mask as a 3×3 convolution.
 *
 * `preserveAlpha` matters: without it the kernel runs on premultiplied
 * colour and every layer with transparency gets a dark halo at its
 * edges — which looks like a compositing bug, not a sharpen setting.
 */
function sharpenKernel(sharpen: number): string {
  const a = (sharpen / 100) * 0.7;
  const centre = 1 + 4 * a;
  return `0 ${-a} 0 ${-a} ${centre} ${-a} 0 ${-a} 0`;
}

function needsTone(f: ClipFilters): boolean {
  return f.highlights !== 0 || f.shadows !== 0 || f.sharpen > 0;
}

/**
 * An SVG filter id for this clip's tonal settings, or null when none
 * are set. Safe to call every frame — identical settings reuse the
 * same element rather than building a new one.
 */
export function toneFilterId(f: ClipFilters): string | null {
  if (!needsTone(f)) return null;

  // Round before keying: a slider drag would otherwise mint a filter per
  // pixel of travel and leak hundreds of elements into the document.
  const highlights = Math.round(f.highlights);
  const shadows = Math.round(f.shadows);
  const sharpen = Math.round(f.sharpen);
  const key = `${highlights}|${shadows}|${sharpen}`;

  const hit = cache.get(key);
  if (hit) return hit;

  const svg = ensureHost();
  if (!svg) return null;

  const id = `kerf_tone_${++seq}`;
  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.setAttribute('id', id);
  /*
    Filters operate in linearRGB by default, which is correct for light
    but wrong here: the slider values are picked against what the user
    sees, and the curve has to act on the same numbers.
  */
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  // The source is the drawn layer itself, so keep the region tight.
  filter.setAttribute('x', '0%');
  filter.setAttribute('y', '0%');
  filter.setAttribute('width', '100%');
  filter.setAttribute('height', '100%');

  if (highlights !== 0 || shadows !== 0) {
    const transfer = document.createElementNS(SVG_NS, 'feComponentTransfer');
    const table = toneTable(highlights, shadows);
    for (const channel of ['feFuncR', 'feFuncG', 'feFuncB']) {
      const fn = document.createElementNS(SVG_NS, channel);
      fn.setAttribute('type', 'table');
      fn.setAttribute('tableValues', table);
      transfer.appendChild(fn);
    }
    filter.appendChild(transfer);
  }

  if (sharpen > 0) {
    const convolve = document.createElementNS(SVG_NS, 'feConvolveMatrix');
    convolve.setAttribute('order', '3');
    convolve.setAttribute('kernelMatrix', sharpenKernel(sharpen));
    convolve.setAttribute('preserveAlpha', 'true');
    filter.appendChild(convolve);
  }

  svg.appendChild(filter);
  cache.set(key, id);

  /*
    A hard ceiling on distinct filters. Three sliders is a large space
    and a long session could otherwise accumulate thousands of unused
    elements; clearing wholesale is cheap because they rebuild on demand.
  */
  if (cache.size > 256) {
    cache.clear();
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  return id;
}

/** Drop every generated filter — used when a project is replaced. */
export function resetToneFilters(): void {
  cache.clear();
  if (host) {
    while (host.firstChild) host.removeChild(host.firstChild);
  }
}
