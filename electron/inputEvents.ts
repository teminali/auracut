/* ═══════════════════════════════════════════════════════════════════
   Real input, from outside the app.

   The auto zoom was built on an inference — travel, then stillness —
   because nothing in Electron reports a mouse button pressed in another
   application. That inference is decent and it is not what a first-class
   zoom is made of: it cannot tell a click from a pause, it cannot see a
   scroll at all, and it has no idea whether you clicked once or filled
   in a form.

   `uiohook-napi` can. It is a prebuilt N-API binding over libuiohook, so
   there is no compile step and no Electron ABI to match, and it ships
   binaries for every platform Kerf targets.

   ── Three things this module is careful about ──────────────────────

   1. **It is optional, and its absence is not an error.** The module is
      required lazily inside a try/catch and every failure path returns a
      REASON. Kerf falls back to the cursor-settle detector, says which
      one is running, and works either way. A screen recorder that
      refuses to record because a permission is missing would be worse
      than one that zooms slightly less cleverly.

   2. **macOS needs Accessibility, and says so precisely.** `start()`
      throws `UIOHOOK_ERROR_AXAPI_DISABLED` synchronously when the
      permission is not granted — a clean, catchable, specific failure,
      which is why this is worth building on. The studio turns that into
      a button that opens the right settings pane.

   3. **It does NOT use uiohook's coordinates.** libuiohook reports
      positions in its own space, and whether that is points or backing
      pixels varies by platform and by display scale — a difference that
      would silently put every zoom in the wrong place on a Retina
      screen, or off the frame entirely. `screen.getCursorScreenPoint()`
      is authoritative, is in the same space as the cursor track this is
      merged with, and at the instant of a click the pointer IS the click
      point. So uiohook is asked only WHEN and WHAT, never WHERE.
   ═══════════════════════════════════════════════════════════════════ */

import { screen } from 'electron';

export type InputKind = 'click' | 'rightclick' | 'scroll' | 'key';

export interface InputEvent {
  /** Milliseconds into the recording, with paused time already removed. */
  tMs: number;
  kind: InputKind;
  /** Normalised against the captured display, in the same space as the cursor track. */
  x: number;
  y: number;
}

export type InputSource = 'events' | 'cursor-only';

export interface InputCaptureStatus {
  /** Whether real input events are being delivered. */
  ok: boolean;
  source: InputSource;
  reason:
    | 'ready'
    | 'not-installed'
    | 'needs-accessibility'
    | 'failed';
  /** One sentence, written for the person reading the studio. */
  message: string;
}

/* ── Loading the module ─────────────────────────────────────────── */

interface UiohookLike {
  on(event: string, handler: (payload: { button?: number; clicks?: number }) => void): void;
  removeAllListeners(): void;
  start(): void;
  stop(): void;
}

let cached: UiohookLike | null | undefined;

function load(): UiohookLike | null {
  if (cached !== undefined) return cached;
  try {
    /*
      `require` rather than `import`, and inside a try: this is the one
      dependency in the app whose absence has to be survivable at
      runtime. esbuild leaves it external, so on a machine where the
      prebuilt binary will not load, this throws here and nowhere else.
    */
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('uiohook-napi') as { uIOhook?: UiohookLike };
    cached = mod.uIOhook ?? null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Whether the binding is present at all, without starting it. */
export function inputCaptureAvailable(): boolean {
  return load() !== null;
}

/* ── Capture ────────────────────────────────────────────────────── */

let running = false;

export interface CaptureHandle {
  status: InputCaptureStatus;
  stop: () => void;
}

const UNAVAILABLE: InputCaptureStatus = {
  ok: false,
  source: 'cursor-only',
  reason: 'not-installed',
  message:
    'Real click capture is not available in this build, so zooms are placed from where the '
    + 'pointer travelled to and stopped.',
};

const NEEDS_ACCESSIBILITY: InputCaptureStatus = {
  ok: false,
  source: 'cursor-only',
  reason: 'needs-accessibility',
  message:
    'macOS has not allowed Kerf to see input from other apps, so zooms are placed from where '
    + 'the pointer travelled to and stopped. Turn Kerf on under Privacy and Security, '
    + 'Accessibility, then relaunch it for zooms on real clicks.',
};

/**
 * Start listening, and hand back a stop function whatever happens.
 *
 * `now()` is supplied by the caller rather than read here, because the
 * only correct clock is the recording's — the one the cursor track is
 * already stamped with, with paused time removed. Two clocks would put
 * clicks and cursor positions on different timelines.
 */
export function startInputCapture(
  now: () => number,
  bounds: () => Electron.Rectangle | null,
  push: (event: InputEvent) => void
): CaptureHandle {
  const hook = load();
  if (!hook) return { status: UNAVAILABLE, stop: () => undefined };

  const locate = (): { x: number; y: number } | null => {
    const area = bounds();
    if (!area) return null;
    const point = screen.getCursorScreenPoint();
    return {
      x: (point.x - area.x) / area.width,
      y: (point.y - area.y) / area.height,
    };
  };

  const record = (kind: InputKind) => {
    const at = locate();
    if (!at) return;
    push({ tMs: now(), kind, x: at.x, y: at.y });
  };

  /*
    `mousedown`, not `click`. The moment a zoom should be arriving at is
    when the button goes DOWN — that is when the thing being clicked
    matters — and a click event only fires on release, which on a drag is
    somewhere else entirely.
  */
  hook.on('mousedown', (event) => record(event.button === 1 ? 'click' : 'rightclick'));
  hook.on('wheel', () => record('scroll'));
  hook.on('keydown', () => record('key'));

  try {
    hook.start();
    running = true;
  } catch (err) {
    hook.removeAllListeners();
    const code = (err as { code?: string } | null)?.code;
    return {
      status: code === 'UIOHOOK_ERROR_AXAPI_DISABLED'
        ? NEEDS_ACCESSIBILITY
        : {
          ok: false,
          source: 'cursor-only',
          reason: 'failed',
          message:
            'Input capture could not start, so zooms are placed from where the pointer '
            + `travelled to and stopped. (${(err as Error)?.message ?? 'unknown error'})`,
        },
      stop: () => undefined,
    };
  }

  return {
    status: {
      ok: true,
      source: 'events',
      reason: 'ready',
      message: 'Zooms are placed on real clicks, scrolls and typing.',
    },
    stop: () => {
      if (!running) return;
      running = false;
      try { hook.stop(); } catch { /* already stopped */ }
      hook.removeAllListeners();
    },
  };
}

/**
 * What the studio can promise BEFORE a take starts.
 *
 * Deliberately does not start the hook to find out. On macOS starting it
 * without permission is what triggers the system's own prompt, and a
 * prompt that appears when you open a settings panel — rather than when
 * you press record — is the kind of thing people click Deny on.
 */
export function probeInputCapture(): InputCaptureStatus {
  if (!load()) return UNAVAILABLE;
  if (process.platform !== 'darwin') {
    return {
      ok: true,
      source: 'events',
      reason: 'ready',
      message: 'Zooms are placed on real clicks, scrolls and typing.',
    };
  }
  /*
    macOS: `systemPreferences.isTrustedAccessibilityClient(false)` answers
    without prompting, which is exactly what is wanted here.
  */
  const { systemPreferences } = require('electron') as typeof import('electron');
  const trusted = systemPreferences.isTrustedAccessibilityClient(false);
  return trusted
    ? { ok: true, source: 'events', reason: 'ready', message: 'Zooms are placed on real clicks, scrolls and typing.' }
    : NEEDS_ACCESSIBILITY;
}

/** Never leave a system-wide hook running past a quit. */
export function shutdownInputCapture(): void {
  if (!running) return;
  running = false;
  const hook = load();
  try { hook?.stop(); } catch { /* nothing to stop */ }
  hook?.removeAllListeners();
}
