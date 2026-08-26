/* ═══════════════════════════════════════════════════════════════════
   The bundled starter project — Kerf's own brand film.

   A first run used to open onto an empty Recents wall, which tells a new
   user nothing about what the app does. This is a complete 11.5s piece
   built from the same primitives anyone else would use — shape layers,
   text layers, keyframed transforms, one audio clip — so opening it is
   also reading a worked example.

   Built in code rather than shipped as a serialized snapshot: a blob
   would go stale the moment the EDL shape changes, and nobody could read
   a diff of it. This runs against the live store actions, so it cannot
   drift from the format the app actually loads.

   ── The shape of it ──────────────────────────────────────────────

   0.000 – 3.994s   ONE CONTINUOUS SHOT. The mark builds itself: a slab,
                    held; a construction grid; the arms arriving attached
                    to the stem and then retracting to cut the kerf open.
                    Nothing cuts here, and for the last half second
                    nothing moves either.
   3.994 – 9.985s   THIRTEEN CUTS, one per detected beat, 120 BPM.
   9.985 – 11.500s  The settle. The music keeps its beat through this;
                    the picture stops cutting, which is what makes it
                    read as finished rather than merely stopped.

   Two things carry the energy, and both are measurements rather than
   taste:

   **The runway.** Eight beats with no cut at all. A sting that fires at
   0.9s has nothing to land against; the reason the first cut here hits
   is that four seconds of rising sound went by without one.

   **The luminance zig-zag.** Per beat the montage runs roughly
   227, 10, 37, 171, 232, 26, 165, 223, 29, 219, 4, 238, 22 — no two
   adjacent shots near each other, the extremes at the first cut and at
   two-thirds through. Every cut is a luminance jolt, which is what reads
   as percussive before a single note is heard. If you edit a shot, keep
   its neighbours far apart in brightness or the cut between them will
   disappear.

   And one that is easy to get backwards: the two BRIGHTEST shots are the
   two STILLEST. Bright frames are held; dark frames drift.
   ═══════════════════════════════════════════════════════════════════ */

import { useTimelineStore } from '../store/timelineStore';
import { useProjectStore } from '../store/projectStore';
import { Easing, MediaAsset } from '../types/edl';
/* `import bedUrl from '...wav'` yields a ROOT-RELATIVE path in dev
   (`/src/assets/kerf_film_bed.wav`). That is fine for an <audio> tag in
   the renderer and useless to ffmpeg, which runs in the main process and
   resolves it against the filesystem root — the export came back with
   "0 of 1 audio sources made it into the render". `new URL(..., import.meta.url)`
   is Vite's idiom for the absolute form: an http:// URL in dev and a
   file:// one when packaged, both of which ffmpeg can open. */
const bedUrl = new URL('../assets/kerf_film_bed.wav', import.meta.url).href;

export const STARTER_ID = 'starter:kerf-brand-film';
export const STARTER_NAME = 'Kerf — Brand Film';
export const STARTER_DURATION_MS = 11500;

/* ── The beat grid ──────────────────────────────────────────────────
   These are not chosen numbers. They are what `detect_beats` returned
   when it was run on the bundled audio bed: 118.9 BPM, 22 beats, 55% of
   them anchored to a real detected onset rather than interpolated. The
   cuts below sit on this grid, so the picture is locked to the music the
   editor measured rather than to a tempo somebody typed.

   Run `detect_beats` on the bed again and you get these back — which is
   also the point of dropping them on the timeline as markers, so anyone
   opening the starter can see the grid the cuts are sitting on.

   Note the gaps are not all 500ms. Beats 6502 and 9009 sit slightly late
   because that is where the onset actually is. Snapping them to a
   synthetic grid would look tidier in the code and worse in the room. */
const BEATS_MS = [
  430, 934, 1439, 1944, 2449, 2953, 3458,
  3994, 4468, 4992, 5477, 5991, 6502, 6989,
  7500, 7988, 8499, 9009, 9497, 9985, 10495, 11030,
];
const CUTS = BEATS_MS.slice(7, 20);       // the thirteen montage cuts
const BUILD_END = CUTS[0];                // 3994 — the first cut

/* ── Palette ──────────────────────────────────────────────────────── */
const INK = '#0a0d12';
const PAPER = '#f2f5fa';
const PAPER2 = '#eef1f6';
const SLATE = '#8fa3bf';
const NIGHT = '#05060a';
const BLUE = '#4a90ff';
const BLUE_HI = '#6ba5ff';
const GUIDE = '#7d92b4';
const FONT = 'Inter';

/* ── Geometry ─────────────────────────────────────────────────────────
   A shape layer's base box is 480x480 regardless of the canvas, so every
   size below is derived from that rather than from 1920x1080. */
const SHAPE_BASE = 480;

/* Straight out of KerfMark.tsx's 24x24 viewBox. The ink spans x
   4.55..20.25 and y 2.25..21.75, so the optical centre is (12.4, 12.0) —
   NOT (12, 12). Centring on the viewBox instead leaves the mark visibly
   left-heavy, which is the kind of thing nobody can name but everybody
   sees. */
const CX = 12.4;
const CY = 12.0;
const STROKE_UNITS = 3.3;
const SEGMENTS: [[number, number], [number, number]][] = [
  [[6.2, 3.9], [6.2, 20.1]],    // stem
  [[10.9, 12], [18.3, 4.4]],    // arm
  [[10.9, 12], [18.6, 19.9]],   // leg
];
const SEGMENT_NAMES = ['stem', 'arm', 'leg'];

interface SegGeom {
  midX: number;
  midY: number;
  length: number;
  angle: number;
}

function segGeometry(index: number, unit: number): SegGeom {
  const [a, b] = SEGMENTS[index];
  const ax = (a[0] - CX) * unit;
  const ay = (a[1] - CY) * unit;
  const bx = (b[0] - CX) * unit;
  const by = (b[1] - CY) * unit;
  return {
    midX: (ax + bx) / 2,
    midY: (ay + by) / 2,
    length: Math.hypot(bx - ax, by - ay),
    angle: (Math.atan2(by - ay, bx - ax) * 180) / Math.PI,
  };
}

function rotate(x: number, y: number, deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
}

interface Key {
  ms: number;
  value: number;
  easing?: Easing;
}

/** One stroke of the mark, placed on the canvas. */
interface Stroke {
  clipId: string;
  x: number;
  y: number;
}

export function buildStarterProject(): void {
  const project = useProjectStore.getState();

  project.setProjectName(STARTER_NAME);
  project.setAspectRatio('16:9');
  project.setFps(30);
  project.setBackgroundColor(NIGHT);
  project.setDurationMs(STARTER_DURATION_MS);

  // Start from nothing, so opening the starter twice does not stack it.
  useTimelineStore.getState().loadProject([], []);

  /* ── Local helpers, all thin wrappers over store actions ────────── */

  const store = () => useTimelineStore.getState();

  const track = (type: 'video' | 'audio' | 'text', name: string) =>
    store().addTrack(type, name);

  const patch = (clipId: string, props: Record<string, unknown>) => {
    store().patchClip(clipId, props);
  };

  const shape = (
    kind: 'rectangle' | 'ellipse' | 'line',
    trackId: string,
    startMs: number,
    durationMs: number,
    style: Record<string, unknown>,
    props: Record<string, unknown> = {}
  ): string => {
    const id = store().addShapeLayer(trackId, kind, Math.round(startMs), Math.round(durationMs));
    const patchObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(style)) patchObj[`shapeStyle.${k}`] = v;
    Object.assign(patchObj, props);
    patch(id, patchObj);
    return id;
  };

  const text = (
    value: string,
    trackId: string,
    startMs: number,
    durationMs: number,
    props: Record<string, unknown>
  ): string => {
    const id = store().addTextLayer(trackId, value, Math.round(startMs), Math.round(durationMs));
    /* A new text layer defaults to CAPTION styling — a 6px black outline
       and an 18px drop shadow — which is what keeps burned-in text
       readable over footage and is wrong for everything here. At small
       sizes that outline thickens Inter until it reads as a slab face. */
    patch(id, {
      'textStyle.fontFamily': FONT,
      'textStyle.strokeWidth': 0,
      'textStyle.shadowBlur': 0,
      'textStyle.shadowOffsetY': 0,
      'textStyle.shadowColor': 'rgba(0,0,0,0)',
      'textStyle.kineticAnimation': 'none',
      'textStyle.align': 'center',
      ...props,
    });
    return id;
  };

  /** `addKeyframe` APPENDS, so each property gets exactly one call. */
  const keys = (
    clipId: string,
    property: 'positionX' | 'positionY' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity',
    points: Key[]
  ) => {
    for (const p of points) {
      store().addKeyframe(clipId, {
        property,
        timeOffsetMs: Math.round(p.ms),
        value: p.value,
        easing: p.easing ?? 'easeOut',
      });
    }
  };

  const glow = (clipId: string, radius: number, threshold: number, intensity: number) => {
    const ref = store().addEffect(clipId, 'glow', {
      radius,
      threshold,
      tint: BLUE,
      streak: 0.35,
    });
    if (ref) store().setEffectIntensity(clipId, ref, intensity);
  };

  /** A full-bleed ground colour. 1.02 so a drifting frame never shows an edge. */
  const ground = (trackId: string, startMs: number, durationMs: number, fill: string, name: string) =>
    shape('rectangle', trackId, startMs, durationMs, { fill, cornerRadius: 0, strokeWidth: 0 }, {
      name,
      'transform.scaleX': (1920 / SHAPE_BASE) * 1.02,
      'transform.scaleY': (1080 / SHAPE_BASE) * 1.02,
    });

  /** The mark, as its three strokes. */
  const mark = (
    trackId: string,
    startMs: number,
    durationMs: number,
    unit: number,
    offsetX: number,
    offsetY: number,
    colour: string,
    name: string,
    opts: { rotation?: number; strokePx?: number } = {}
  ): Stroke[] => {
    const rotation = opts.rotation ?? 0;
    const strokeWidth = opts.strokePx ?? STROKE_UNITS * unit;
    const out: Stroke[] = [];
    for (let i = 0; i < 3; i++) {
      const g = segGeometry(i, unit);
      const [rx, ry] = rotate(g.midX, g.midY, rotation);
      const x = offsetX + rx;
      const y = offsetY + ry;
      const id = shape('line', trackId, startMs, durationMs,
        { fill: colour, stroke: colour, strokeWidth },
        {
          name: `${name} ${SEGMENT_NAMES[i]}`,
          'transform.x': x,
          'transform.y': y,
          'transform.scaleX': g.length / SHAPE_BASE,
          'transform.scaleY': Math.max(strokeWidth, 4) / SHAPE_BASE,
          'transform.rotation': g.angle + rotation,
        });
      out.push({ clipId: id, x, y });
    }
    return out;
  };

  /* Stroke WIDTH is absolute pixels and is not an animatable property, so
     scaling a mark built from strokes would stretch its length and leave
     its weight behind. Translation is the only move that stays true to
     the letterform — which is why every shot below drifts rather than
     pushes. */
  const drift = (strokes: Stroke[], dx: number, dy: number, durationMs: number) => {
    for (const s of strokes) {
      keys(s.clipId, 'positionX', [
        { ms: 0, value: s.x, easing: 'linear' },
        { ms: durationMs, value: s.x + dx, easing: 'linear' },
      ]);
      keys(s.clipId, 'positionY', [
        { ms: 0, value: s.y, easing: 'linear' },
        { ms: durationMs, value: s.y + dy, easing: 'linear' },
      ]);
    }
  };

  /** Mark plus wordmark, set as a horizontal pair. */
  const lockup = (
    markTrack: string,
    typeTrack: string,
    startMs: number,
    durationMs: number,
    unit: number,
    colour: string,
    name: string,
    opts: { markX?: number; textX?: number; size?: number; glow?: boolean } = {}
  ): { strokes: Stroke[]; word: string } => {
    const strokes = mark(markTrack, startMs, durationMs, unit,
      opts.markX ?? -280, 0, colour, name);
    if (opts.glow) for (const s of strokes) glow(s.clipId, 34, 40, 0.7);
    const word = text('KERF', typeTrack, startMs, durationMs, {
      name: `${name} wordmark`,
      'textStyle.fontSize': opts.size ?? 150,
      'textStyle.fontWeight': 800,
      'textStyle.color': colour,
      'textStyle.letterSpacing': 20,
      'transform.x': opts.textX ?? 200,
      'transform.y': 0,
    });
    return { strokes, word };
  };

  /* ── Tracks. Highest index paints first and each new track lands on
        top, so these are created back to front. ──────────────────── */
  const tMusic = track('audio', 'Music');
  const tGround = track('video', 'Ground');
  const tGuide = track('video', 'Guides');
  const tMark = track('video', 'Mark');
  const tType = track('text', 'Type');

  /* ── The bed ────────────────────────────────────────────────────── */
  const bed: MediaAsset = {
    id: 'starter:kerf-film-bed',
    name: 'Kerf film bed',
    type: 'audio',
    url: bedUrl,
    thumbnailUrl: '',
    durationMs: STARTER_DURATION_MS,
    fileSizeFormatted: '2.2 MB',
    codec: 'pcm_s16le',
  };
  store().addMediaAsset(bed);
  store().insertClip(tMusic, bed, 0);

  /* ═══ ACT 1 — the build ══════════════════════════════════════════ */
  const U1 = 33;
  const STEM_HALF = 8.1 * U1;
  const KERF_GAP = 1.5 * U1;

  const bloom = shape('ellipse', tGround, 0, BUILD_END + 40, { fill: BLUE, strokeWidth: 0 }, {
    name: 'Bloom bed',
    'transform.scaleX': 3.0,
    'transform.scaleY': 2.2,
    'filters.blur': 70,
  });
  keys(bloom, 'opacity', [
    { ms: 0, value: 0.03 }, { ms: 1400, value: 0.11 },
    { ms: 2900, value: 0.14 }, { ms: BUILD_END, value: 0.10, easing: 'linear' },
  ]);

  /* A portrait frame can leave its sides empty and still read as
     composed. A 16:9 one cannot — the same mark centred in 1920 leaves
     two dead thirds. So the geometry that builds the letter also has to
     furnish the width: full-bleed rules at the cap and baseline, the
     stem axis dropped through them, and the two diagonals sweeping in
     from off-frame. It is what a type specimen actually looks like, and
     it means the wide frame carries information instead of air. */
  for (const [name, y, delay] of [
    ['Cap rule', -STEM_HALF, 1050],
    ['Base rule', STEM_HALF, 1130],
  ] as const) {
    const r = shape('line', tGuide, delay, BUILD_END - delay - 500,
      { fill: GUIDE, stroke: GUIDE, strokeWidth: 4 },
      { name, 'transform.x': 0, 'transform.y': y, 'transform.scaleX': 2100 / SHAPE_BASE, 'transform.scaleY': 0.02 });
    keys(r, 'scaleX', [{ ms: 0, value: 0.2 }, { ms: 620, value: 2100 / SHAPE_BASE }]);
    keys(r, 'opacity', [
      { ms: 0, value: 0 }, { ms: 240, value: 0.40 },
      { ms: 1500, value: 0.40, easing: 'linear' },
      { ms: BUILD_END - delay - 560, value: 0, easing: 'easeIn' },
    ]);
  }

  const stemX = (6.2 - CX) * U1;
  const axis = shape('line', tGuide, 1210, BUILD_END - 1710,
    { fill: GUIDE, stroke: GUIDE, strokeWidth: 4 },
    { name: 'Stem axis', 'transform.x': stemX, 'transform.y': 0, 'transform.rotation': 90,
      'transform.scaleX': 1180 / SHAPE_BASE, 'transform.scaleY': 0.02 });
  keys(axis, 'scaleX', [{ ms: 0, value: 0.2 }, { ms: 620, value: 1180 / SHAPE_BASE }]);
  keys(axis, 'opacity', [
    { ms: 0, value: 0 }, { ms: 240, value: 0.34 },
    { ms: 1300, value: 0.34, easing: 'linear' },
    { ms: BUILD_END - 1770, value: 0, easing: 'easeIn' },
  ]);

  const junctionX = (10.9 - CX) * U1;
  for (const [i, index, delay, fromX] of [[0, 1, 900, -1700], [1, 2, 980, 1700]] as const) {
    const g = segGeometry(index, U1);
    const id = shape('line', tGuide, delay, 2500,
      { fill: GUIDE, stroke: GUIDE, strokeWidth: 5 },
      { name: `Axis ${i + 1}`, 'transform.x': junctionX, 'transform.y': 0,
        'transform.rotation': g.angle, 'transform.scaleX': 2600 / SHAPE_BASE, 'transform.scaleY': 0.02 });
    keys(id, 'positionX', [{ ms: 0, value: junctionX + fromX }, { ms: 780, value: junctionX }]);
    keys(id, 'opacity', [
      { ms: 0, value: 0 }, { ms: 260, value: 0.45 },
      { ms: 1650, value: 0.45, easing: 'linear' }, { ms: 2400, value: 0, easing: 'easeIn' },
    ]);
  }

  const circleD = (15.6 * U1) / SHAPE_BASE;
  const circle = shape('ellipse', tGuide, 1500, 1850,
    { fill: 'transparent', stroke: BLUE, strokeWidth: 5 },
    { name: 'Optical circle', 'transform.x': junctionX * 0.35, 'transform.y': 0,
      'transform.scaleX': circleD, 'transform.scaleY': circleD });
  keys(circle, 'opacity', [
    { ms: 0, value: 0 }, { ms: 420, value: 0.46 },
    { ms: 1100, value: 0.46, easing: 'linear' }, { ms: 1780, value: 0, easing: 'easeIn' },
  ]);
  keys(circle, 'scaleX', [{ ms: 0, value: circleD * 0.55 }, { ms: 560, value: circleD }]);
  keys(circle, 'scaleY', [{ ms: 0, value: circleD * 0.55 }, { ms: 560, value: circleD }]);

  // The stem: a slab, HELD, then drawn out. The hold is the runway.
  const stemGeom = segGeometry(0, U1);
  const stem = shape('line', tMark, 150, BUILD_END - 150,
    { fill: PAPER2, stroke: PAPER2, strokeWidth: STROKE_UNITS * U1 },
    { name: 'Stem', 'transform.x': stemGeom.midX, 'transform.y': stemGeom.midY,
      'transform.rotation': stemGeom.angle, 'transform.scaleY': (STROKE_UNITS * U1) / SHAPE_BASE });
  keys(stem, 'opacity', [{ ms: 0, value: 0 }, { ms: 200, value: 1 }]);
  keys(stem, 'scaleX', [
    { ms: 0, value: (stemGeom.length / SHAPE_BASE) * 0.15 },
    { ms: 680, value: (stemGeom.length / SHAPE_BASE) * 0.15, easing: 'linear' },
    { ms: 1180, value: (stemGeom.length / SHAPE_BASE) * 1.05 },
    { ms: 1360, value: stemGeom.length / SHAPE_BASE },
  ]);

  /* The arms arrive ATTACHED to the stem and then retract along their own
     axes. The gap is not drawn — it is cut, which is the entire idea of
     the mark, so it is the one moment the build slows down for. */
  for (const [index, start, label] of [[1, 1900, 'Arm'], [2, 2000, 'Leg']] as const) {
    const g = segGeometry(index, U1);
    const ux = Math.cos((g.angle * Math.PI) / 180);
    const uy = Math.sin((g.angle * Math.PI) / 180);
    const closedX = g.midX - KERF_GAP * ux;
    const closedY = g.midY - KERF_GAP * uy;
    const id = shape('line', tMark, start, BUILD_END - start,
      { fill: PAPER2, stroke: PAPER2, strokeWidth: STROKE_UNITS * U1 },
      { name: label, 'transform.x': closedX, 'transform.y': closedY,
        'transform.rotation': g.angle, 'transform.scaleY': (STROKE_UNITS * U1) / SHAPE_BASE });
    keys(id, 'opacity', [{ ms: 0, value: 0 }, { ms: 180, value: 1 }]);
    keys(id, 'scaleX', [
      { ms: 0, value: (g.length / SHAPE_BASE) * 0.18 },
      { ms: 560, value: g.length / SHAPE_BASE },
    ]);
    keys(id, 'positionX', [
      { ms: 0, value: closedX }, { ms: 700, value: closedX, easing: 'linear' },
      { ms: 1060, value: g.midX },
    ]);
    keys(id, 'positionY', [
      { ms: 0, value: closedY }, { ms: 700, value: closedY, easing: 'linear' },
      { ms: 1060, value: g.midY },
    ]);
  }

  const caption = text('LOGO CONSTRUCTION', tType, 1250, BUILD_END - 1250, {
    name: 'Build caption',
    'textStyle.fontSize': 26,
    'textStyle.fontWeight': 600,
    'textStyle.color': GUIDE,
    'textStyle.letterSpacing': 9,
    'transform.x': -652,
    'transform.y': 438,
  });
  keys(caption, 'opacity', [
    { ms: 0, value: 0 }, { ms: 400, value: 0.75 },
    { ms: 1900, value: 0.75, easing: 'linear' }, { ms: 2400, value: 0, easing: 'easeIn' },
  ]);

  /* ═══ ACT 2 — thirteen cuts, one per beat ═══════════════════════ */
  const shot = (i: number): [number, number] => {
    const start = CUTS[i];
    const end = i + 1 < CUTS.length ? CUTS[i + 1] : STARTER_DURATION_MS;
    return [start, end - start];
  };

  // 1 · the slam. Huge, near-black, on paper. Held completely still.
  {
    const [s, d] = shot(0);
    ground(tGround, s, d, PAPER, 'Paper');
    mark(tMark, s, d, 38, 0, 0, INK, 'Slam');
  }

  // 2 · night. Small, blue, glowing, with the word.
  {
    const [s, d] = shot(1);
    ground(tGround, s, d, '#05070c', 'Night');
    const { strokes } = lockup(tMark, tType, s, d, 15, BLUE, 'Night',
      { glow: true, markX: -300, textX: 170, size: 120 });
    drift(strokes, 26, 0, d);
  }

  // 3 · the kerf itself, cropped past the edges of the frame.
  {
    const [s, d] = shot(2);
    ground(tGround, s, d, '#0e1420', 'Deep');
    drift(mark(tMark, s, d, 72, 3.85 * 72, 0, BLUE_HI, 'Crop'), -70, 22, d);
  }

  // 4 · three across. The wide frame earning its width.
  {
    const [s, d] = shot(3);
    ground(tGround, s, d, '#a9b6c9', 'Grey');
    [-620, 0, 620].forEach((x, k) => {
      drift(mark(tMark, s, d, 17, x, 0, '#10151f', `Row ${k + 1}`), -34, 0, d);
    });
  }

  // 5 · the lockup, dark on light.
  {
    const [s, d] = shot(4);
    ground(tGround, s, d, PAPER2, 'Light');
    const { strokes, word } = lockup(tMark, tType, s, d, 20, INK, 'Light lockup');
    drift(strokes, 0, -16, d);
    keys(word, 'scaleX', [{ ms: 0, value: 0.97 }, { ms: d, value: 1.02, easing: 'linear' }]);
    keys(word, 'scaleY', [{ ms: 0, value: 0.97 }, { ms: d, value: 1.02, easing: 'linear' }]);
  }

  // 6 · blueprint. The grid returns, over a mark drawn in line weight.
  {
    const [s, d] = shot(5);
    ground(tGround, s, d, '#101828', 'Blueprint');
    drift(mark(tMark, s, d, 30, 0, 0, '#a8c8ff', 'Blueprint', { strokePx: 19 }), 20, 0, d);
    const bpD = (15.6 * 30) / SHAPE_BASE;
    shape('ellipse', tGuide, s, d, { fill: 'transparent', stroke: BLUE, strokeWidth: 4 },
      { name: 'BP circle', 'transform.x': -24, 'transform.y': 0,
        'transform.scaleX': bpD, 'transform.scaleY': bpD, 'transform.opacity': 0.75 });
    for (const [k, index] of [[0, 1], [1, 2]] as const) {
      const g = segGeometry(index, 30);
      shape('line', tGuide, s, d, { fill: GUIDE, stroke: GUIDE, strokeWidth: 4 },
        { name: `BP axis ${k + 1}`, 'transform.x': (10.9 - CX) * 30, 'transform.y': 0,
          'transform.rotation': g.angle, 'transform.scaleX': 2600 / SHAPE_BASE,
          'transform.scaleY': 0.02, 'transform.opacity': 0.6 });
    }
    for (const [name, y] of [['BP cap', -8.1 * 30], ['BP base', 8.1 * 30]] as const) {
      shape('line', tGuide, s, d, { fill: GUIDE, stroke: GUIDE, strokeWidth: 4 },
        { name, 'transform.x': 0, 'transform.y': y, 'transform.scaleX': 2100 / SHAPE_BASE,
          'transform.scaleY': 0.02, 'transform.opacity': 0.6 });
    }
  }

  // 7 · knocked out of slate.
  {
    const [s, d] = shot(6);
    ground(tGround, s, d, SLATE, 'Slate');
    drift(mark(tMark, s, d, 27, 0, 30, '#ffffff', 'Knockout'), 0, -56, d);
  }

  // 8 · paper again, turned, running off the right edge. Still.
  {
    const [s, d] = shot(7);
    ground(tGround, s, d, PAPER, 'Paper 2');
    mark(tMark, s, d, 48, 330, -40, INK, 'Corner', { rotation: -12 });
  }

  /* 9 · the word reversed out. This shot exists dark because shot 8 is
        bright and shot 10 is bright: three light frames in a row would
        have collapsed two cuts into one. */
  {
    const [s, d] = shot(8);
    ground(tGround, s, d, '#0d1117', 'Reverse');
    mark(tMark, s, d, 12, -790, 0, BLUE, 'Tiny');
    const big = text('KERF', tType, s, d, {
      name: 'Big word', 'textStyle.fontSize': 340, 'textStyle.fontWeight': 800,
      'textStyle.color': PAPER2, 'textStyle.letterSpacing': 34,
      'transform.x': 110, 'transform.y': 0,
    });
    keys(big, 'scaleX', [{ ms: 0, value: 0.96 }, { ms: d, value: 1.04, easing: 'linear' }]);
    keys(big, 'scaleY', [{ ms: 0, value: 0.96 }, { ms: d, value: 1.04, easing: 'linear' }]);
  }

  // 10 · the app tile, on light.
  {
    const [s, d] = shot(9);
    ground(tGround, s, d, '#e4e9f1', 'Tile ground');
    const tile = shape('rectangle', tGuide, s, d, { fill: BLUE, cornerRadius: 130, strokeWidth: 0 },
      { name: 'App tile', 'transform.scaleX': 590 / SHAPE_BASE, 'transform.scaleY': 590 / SHAPE_BASE });
    keys(tile, 'positionY', [{ ms: 0, value: 18, easing: 'linear' }, { ms: d, value: -18, easing: 'linear' }]);
    drift(mark(tMark, s, d, 17, 0, 0, '#ffffff', 'Tile mark'), 0, -36, d);
  }

  /* 11 · the darkest frame in the film, and the only one that is only an
         idea: the letter goes almost to black and the CUT is what is
         lit. Measured at Y=4 against Y=238 on the beat after it. */
  {
    const [s, d] = shot(10);
    ground(tGround, s, d, '#000000', 'Black');
    mark(tMark, s, d, 34, 0, 0, '#0a0c10', 'Ghost');
    const slit = shape('rectangle', tType, s, d, { fill: '#cfe0ff', cornerRadius: 12, strokeWidth: 0 },
      { name: 'The kerf', 'transform.x': -3.85 * 34, 'transform.y': 0,
        'transform.scaleX': (1.4 * 34) / SHAPE_BASE, 'transform.scaleY': (16.2 * 34) / SHAPE_BASE });
    glow(slit, 96, 18, 1);
    keys(slit, 'opacity', [
      { ms: 0, value: 0.75 }, { ms: d * 0.4, value: 1, easing: 'linear' },
      { ms: d, value: 0.8, easing: 'linear' },
    ]);
  }

  // 12 · the lockup as it would actually be used — placed small, with the
  //      width left as air rather than filled.
  {
    const [s, d] = shot(11);
    ground(tGround, s, d, PAPER2, 'Card');
    const { strokes } = lockup(tMark, tType, s, d, 11, INK, 'Card',
      { markX: -640, textX: -368, size: 84 });
    drift(strokes, 0, -10, d);
    shape('line', tGuide, s, d, { fill: '#c3ccd9', stroke: '#c3ccd9', strokeWidth: 3 },
      { name: 'Card rule', 'transform.x': 0, 'transform.y': 246,
        'transform.scaleX': 1560 / SHAPE_BASE, 'transform.scaleY': 0.02 });
    text('kerf.app', tType, s, d, {
      name: 'Card edge', 'textStyle.fontSize': 30, 'textStyle.fontWeight': 500,
      'textStyle.color': '#7f8b9c', 'textStyle.letterSpacing': 8,
      'transform.x': 628, 'transform.y': 176,
    });
  }

  /* ═══ ACT 3 — the settle ════════════════════════════════════════ */
  {
    const [s, d] = shot(12);
    ground(tGround, s, d, NIGHT, 'Final');
    const finalBloom = shape('ellipse', tGround, s, d, { fill: BLUE, strokeWidth: 0 },
      { name: 'Final bloom', 'transform.scaleX': 3.2, 'transform.scaleY': 2.4, 'filters.blur': 80 });
    keys(finalBloom, 'opacity', [
      { ms: 0, value: 0.05 }, { ms: 600, value: 0.13 },
      { ms: 1100, value: 0.13, easing: 'linear' }, { ms: d, value: 0, easing: 'easeIn' },
    ]);

    const { strokes, word } = lockup(tMark, tType, s, d, 20, PAPER2, 'Final', { glow: true });
    keys(word, 'opacity', [
      { ms: 0, value: 0 }, { ms: 200, value: 1 },
      { ms: d - 620, value: 1, easing: 'linear' }, { ms: d - 160, value: 0, easing: 'easeIn' },
    ]);
    for (const st of strokes) {
      keys(st.clipId, 'opacity', [
        { ms: 0, value: 1 }, { ms: d - 620, value: 1, easing: 'linear' },
        { ms: d - 200, value: 0, easing: 'easeIn' },
      ]);
    }

    const tagline = text('CUT WITH INTENT', tType, s + 330, d - 590, {
      name: 'Tagline', 'textStyle.fontSize': 34, 'textStyle.fontWeight': 500,
      'textStyle.color': SLATE, 'textStyle.letterSpacing': 15,
      'transform.x': 200, 'transform.y': 128,
    });
    keys(tagline, 'opacity', [
      { ms: 0, value: 0 }, { ms: 420, value: 0.95 },
      { ms: d - 1230, value: 0.95, easing: 'linear' }, { ms: d - 630, value: 0, easing: 'easeIn' },
    ]);
  }

  /* The bookend. Everything falls away and the slab from the opening
     frame comes back, so the film closes on the shape it opened with. */
  {
    const slabX = (6.2 - CX) * 33 - 280;
    const back = shape('line', tMark, STARTER_DURATION_MS - 640, 560,
      { fill: PAPER2, stroke: PAPER2, strokeWidth: STROKE_UNITS * 33 },
      { name: 'Bookend slab', 'transform.x': slabX, 'transform.y': 0, 'transform.rotation': 90,
        'transform.scaleX': ((16.2 * 33) / SHAPE_BASE) * 0.15,
        'transform.scaleY': (STROKE_UNITS * 33) / SHAPE_BASE });
    keys(back, 'opacity', [
      { ms: 0, value: 0 }, { ms: 180, value: 1 },
      { ms: 330, value: 1, easing: 'linear' }, { ms: 540, value: 0, easing: 'easeIn' },
    ]);
    keys(back, 'positionX', [
      { ms: 0, value: slabX, easing: 'linear' }, { ms: 540, value: -6, easing: 'linear' },
    ]);
  }

  /* Drop the detected grid on the timeline, so the claim that the cuts
     sit on the beat is something you can see rather than take on trust. */
  store().setBeatMarkers(BEATS_MS);
  store().setPlayheadMs(BUILD_END);
  store().commit('Open starter project');
}
