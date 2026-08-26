/* ═══════════════════════════════════════════════════════════════════
   The bundled starter project.

   A first run used to open onto an empty Recents wall, which tells a new
   user nothing about what the app does. This is Kerf's own logo sting,
   built from the same primitives anyone else would use — two shapes, two
   text layers, keyframed transforms — so opening it is also reading a
   worked example.

   Built in code rather than shipped as a serialized snapshot: a blob
   would go stale the moment the EDL shape changes, and nobody could read
   a diff of it. This runs against the live store actions, so it cannot
   drift from the format the app actually loads.
   ═══════════════════════════════════════════════════════════════════ */

import { useTimelineStore } from '../store/timelineStore';
import { useProjectStore } from '../store/projectStore';
import { Easing } from '../types/edl';

export const STARTER_ID = 'starter:kerf-logo-sting';
export const STARTER_NAME = 'Kerf — Logo Sting';
export const STARTER_DURATION_MS = 3200;

/* Measured against a 1920x1080 canvas, not guessed. A shape layer's base
   box is 480x480, so a scale of 1 is 480px — the numbers below are all
   derived from that rather than from the canvas size. */
const SHAPE_BASE = 480;
const BAR_WIDTH_PX = 680;
const BAR_HEIGHT_PX = 22;
const BAR_SCALE_X = BAR_WIDTH_PX / SHAPE_BASE;
const BAR_SCALE_Y = BAR_HEIGHT_PX / SHAPE_BASE;

/** Flush when each bar sits half its own height from centre. */
const CLOSED_Y = BAR_HEIGHT_PX / 2;
const OPEN_Y = 200;

interface Key {
  timeOffsetMs: number;
  value: number;
  easing?: Easing;
}

export function buildStarterProject(): void {
  const project = useProjectStore.getState();
  const timeline = useTimelineStore.getState();

  project.setProjectName(STARTER_NAME);
  project.setAspectRatio('16:9');
  project.setFps(30);
  project.setBackgroundColor?.('#07080a');
  project.setDurationMs(STARTER_DURATION_MS);

  // Start from nothing, so opening the starter twice does not stack it.
  timeline.loadProject([], []);

  const t = useTimelineStore.getState();
  const barTrack = t.addTrack('video', 'Kerf bars');
  const wordTrack = t.addTrack('text', 'Wordmark');
  const tagTrack = t.addTrack('text', 'Tagline');

  const keys = (clipId: string, property: 'positionY' | 'scaleX' | 'scaleY' | 'opacity', points: Key[]) => {
    const store = useTimelineStore.getState();
    for (const p of points) {
      store.addKeyframe(clipId, {
        property,
        timeOffsetMs: p.timeOffsetMs,
        value: p.value,
        easing: p.easing ?? 'easeOut',
      });
    }
  };

  /* ── The kerf: one slab, then a cut ── */
  for (const [side, sign] of [['upper', -1], ['lower', 1]] as const) {
    const store = useTimelineStore.getState();
    const clipId = store.addShapeLayer(barTrack, 'rectangle', 0, STARTER_DURATION_MS);

    store.patchClip(clipId, {
      name: `Kerf bar ${side}`,
      'style.fill': '#eef1f6',
      'transform.scaleX': BAR_SCALE_X,
      'transform.scaleY': BAR_SCALE_Y,
      'transform.x': 0,
      'transform.y': sign * CLOSED_Y,
    });

    keys(clipId, 'positionY', [
      { timeOffsetMs: 0, value: sign * CLOSED_Y },
      { timeOffsetMs: 380, value: sign * CLOSED_Y },
      { timeOffsetMs: 1120, value: sign * OPEN_Y },
      { timeOffsetMs: 2700, value: sign * OPEN_Y, easing: 'easeIn' },
      { timeOffsetMs: STARTER_DURATION_MS, value: sign * CLOSED_Y, easing: 'easeIn' },
    ]);

    // A quick widen as they part, so it reads as a blade passing through.
    keys(clipId, 'scaleX', [
      { timeOffsetMs: 0, value: BAR_SCALE_X * 0.55 },
      { timeOffsetMs: 380, value: BAR_SCALE_X * 0.55 },
      { timeOffsetMs: 820, value: BAR_SCALE_X * 1.1 },
      { timeOffsetMs: 1120, value: BAR_SCALE_X },
      { timeOffsetMs: STARTER_DURATION_MS, value: BAR_SCALE_X * 0.55, easing: 'easeIn' },
    ]);
  }

  /* ── Wordmark, revealed by the cut ── */
  {
    const store = useTimelineStore.getState();
    const clipId = store.addTextLayer(wordTrack, 'KERF', 700, STARTER_DURATION_MS - 700);
    store.patchClip(clipId, {
      name: 'KERF wordmark',
      'textStyle.fontSize': 190,
      'textStyle.fontWeight': 800,
      'textStyle.color': '#ffffff',
      'textStyle.letterSpacing': 26,
      'textStyle.align': 'center',
      'transform.y': -6,
    });
    keys(clipId, 'opacity', [
      { timeOffsetMs: 0, value: 0 },
      { timeOffsetMs: 420, value: 1 },
      { timeOffsetMs: 1900, value: 1, easing: 'linear' },
      { timeOffsetMs: 2300, value: 0, easing: 'easeIn' },
    ]);
    keys(clipId, 'scaleX', [
      { timeOffsetMs: 0, value: 0.92 },
      { timeOffsetMs: 650, value: 1 },
    ]);
    keys(clipId, 'scaleY', [
      { timeOffsetMs: 0, value: 0.92 },
      { timeOffsetMs: 650, value: 1 },
    ]);
  }

  /* ── Tagline ── */
  {
    const store = useTimelineStore.getState();
    const clipId = store.addTextLayer(tagTrack, 'CUT WITH INTENT', 1250, STARTER_DURATION_MS - 1450);
    store.patchClip(clipId, {
      name: 'Tagline',
      'textStyle.fontSize': 38,
      'textStyle.fontWeight': 500,
      'textStyle.color': '#8fa3bf',
      'textStyle.letterSpacing': 14,
      'textStyle.align': 'center',
      'transform.y': 132,
    });
    keys(clipId, 'opacity', [
      { timeOffsetMs: 0, value: 0 },
      { timeOffsetMs: 500, value: 1 },
      { timeOffsetMs: 1300, value: 1, easing: 'linear' },
      { timeOffsetMs: 1750, value: 0, easing: 'easeIn' },
    ]);
  }

  useTimelineStore.getState().setPlayheadMs(1700);
  useTimelineStore.getState().commit('Open starter project');
}
