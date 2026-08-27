/* ═══════════════════════════════════════════════════════════════════
   Everything the recorder studio knows.

   The capture engine holds the MediaRecorders and the main process
   holds the files; this holds only what the interface has to draw, and
   it is the single place a recording can be started or stopped from.
   That matters more here than in most stores: a recording can be
   stopped from FOUR places — the studio, the floating bar, a global
   shortcut, and the app quitting — and every one of them has to land in
   the same code or a take gets half-written.

   Settings persist. Nobody wants to re-pick their microphone every
   time, and the source list is the only part that genuinely cannot be
   remembered (a window id is only valid for as long as that window is).
   ═══════════════════════════════════════════════════════════════════ */

import { create } from 'zustand';
import { RecorderSource, RecorderPermissions } from '../types/electron';
import {
  CaptureSettings, DeviceOption, Take,
  startCapture, stopCapture, pauseCapture, cancelCapture, listDevices, isRecording,
} from '../engine/screenCapture';
import {
  AssembleOptions, TUTORIAL_ASSEMBLE, CAPTION_STYLE,
} from '../engine/recordingProject';
import { TutorialOptions } from '../engine/tutorialSkill';
import { BackdropId, DEFAULT_LOOK } from '../engine/cinematicLook';
import { DEFAULT_SHAPE } from '../engine/cursorZoom';

export type RecorderPhase =
  | 'setup'
  | 'countdown'
  | 'recording'
  | 'paused'
  | 'processing'
  | 'review'
  | 'error';

/** The half of the settings that survives a restart. */
export interface StickySettings {
  fps: 30 | 60;
  maxWidth: number;
  cameraDeviceId: string | null;
  cameraHeight: 720 | 1080;
  micDeviceId: string | null;
  systemAudio: boolean;
  countdownSec: 0 | 3 | 5;
  hideWindow: boolean;
  autoZoom: boolean;
  zoomFactor: number;
  motionBlur: boolean;
  detachNarration: boolean;
  cameraSizePct: number;
  cameraCorner: AssembleOptions['cameraCorner'];

  /* ── The Tutorial skill ──────────────────────────────────────────
     What "Open with the Tutorial skill" does. Every one of these is a
     normal edit on a normal track afterwards, so none of it is a
     commitment. */
  cinematic: boolean;
  backdrop: BackdropId;
  insetPct: number;
  /** Give the camera the whole frame while nobody is doing anything. */
  cameraOnPauses: boolean;
  /** A tick under every click, air under every zoom. */
  clickSounds: boolean;
  /** Transcribe the narration, and let the words place the cuts. */
  captions: boolean;
}

const STORAGE_KEY = 'kerf.recorder.v1';

const DEFAULT_STICKY: StickySettings = {
  fps: 30,
  maxWidth: 0,
  cameraDeviceId: null,
  /* 1080p, not 720. A 720p camera cannot fill the frame without
     looking soft, and `cameraCanFillFrame` refuses it — so the default
     that makes the best feature in the skill unreachable is the wrong
     default. `ideal` rather than `exact`, so a 720p webcam still works. */
  cameraHeight: 1080,
  micDeviceId: null,
  systemAudio: true,
  countdownSec: 3,
  hideWindow: true,
  autoZoom: true,
  zoomFactor: DEFAULT_SHAPE.factor,
  motionBlur: true,
  detachNarration: true,
  cameraSizePct: TUTORIAL_ASSEMBLE.cameraSizePct,
  cameraCorner: TUTORIAL_ASSEMBLE.cameraCorner,
  cinematic: true,
  backdrop: DEFAULT_LOOK.backdrop,
  insetPct: DEFAULT_LOOK.insetPct,
  cameraOnPauses: true,
  clickSounds: true,
  captions: true,
};

function loadSticky(): StickySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_STICKY, ...(JSON.parse(raw) as Partial<StickySettings>) } : DEFAULT_STICKY;
  } catch {
    return DEFAULT_STICKY;
  }
}

function persistSticky(settings: StickySettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* A remembered microphone is not worth throwing during a render. */
  }
}

interface RecorderState {
  isOpen: boolean;
  phase: RecorderPhase;

  sources: RecorderSource[];
  sourcesLoading: boolean;
  selectedSourceId: string | null;

  permissions: RecorderPermissions | null;
  cameras: DeviceOption[];
  microphones: DeviceOption[];

  settings: StickySettings;

  countdown: number;
  elapsedMs: number;
  /** How many moments the user has marked during this take. */
  markCount: number;
  shortcuts: string[];

  take: Take | null;
  error: string | null;
  warnings: string[];

  open: () => void;
  close: () => void;

  refreshSources: () => Promise<void>;
  refreshDevices: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
  requestPermission: (kind: 'camera' | 'microphone' | 'screen' | 'accessibility') => Promise<void>;

  selectSource: (id: string) => void;
  set: <K extends keyof StickySettings>(key: K, value: StickySettings[K]) => void;

  begin: () => Promise<void>;
  togglePause: () => Promise<void>;
  stop: () => Promise<void>;
  discard: () => Promise<void>;
  /** Mark a moment for the auto zoom. Goes through main, like the bar's. */
  mark: () => void;
  /** The echo coming back, which is what moves the counter. */
  noteMark: () => void;

  /** What the Tutorial skill is told to do, derived from the sticky settings. */
  tutorialOptions: () => Partial<TutorialOptions>;
}

let ticker: number | null = null;
let countdownTimer: number | null = null;

/** Push what the floating bar shows. Called on every tick and phase change. */
function publish(state: { phase: RecorderPhase; elapsedMs: number; markCount: number }): void {
  void window.electronAPI?.recorder.publishState({
    phase: state.phase,
    elapsedMs: state.elapsedMs,
    markCount: state.markCount,
  });
}

export const useRecorderStore = create<RecorderState>((set, get) => ({
  isOpen: false,
  phase: 'setup',

  sources: [],
  sourcesLoading: false,
  selectedSourceId: null,

  permissions: null,
  cameras: [],
  microphones: [],

  settings: loadSticky(),

  countdown: 0,
  elapsedMs: 0,
  markCount: 0,
  shortcuts: [],

  take: null,
  error: null,
  warnings: [],

  open: () => {
    set({ isOpen: true, phase: 'setup', take: null, error: null, warnings: [], elapsedMs: 0, markCount: 0 });
    void get().refreshPermissions();
    void get().refreshSources();
    void get().refreshDevices();
  },

  close: () => {
    /*
      Closing the studio must never abandon a running take silently. The
      studio's own close button is disabled while recording; this is the
      belt for the Escape key and anything else that gets here.
    */
    if (isRecording()) return;
    if (ticker !== null) { window.clearInterval(ticker); ticker = null; }
    if (countdownTimer !== null) { window.clearInterval(countdownTimer); countdownTimer = null; }
    set({ isOpen: false, phase: 'setup' });
  },

  refreshSources: async () => {
    const api = window.electronAPI;
    if (!api?.recorder) return;
    set({ sourcesLoading: true });
    const result = await api.recorder.sources(480);
    const sources = result.sources ?? [];
    set((s) => ({
      sources,
      sourcesLoading: false,
      error: result.ok ? s.error : (result.error ?? 'The screen list could not be read.'),
      // Keep the current pick if it still exists; otherwise take the primary display.
      selectedSourceId:
        s.selectedSourceId && sources.some((x) => x.id === s.selectedSourceId)
          ? s.selectedSourceId
          : (sources.find((x) => x.primary) ?? sources.find((x) => x.kind === 'screen') ?? sources[0])?.id ?? null,
    }));
  },

  refreshDevices: async () => {
    const { cameras, microphones } = await listDevices();
    set((s) => ({
      cameras,
      microphones,
      settings: {
        ...s.settings,
        /* A remembered device that has since been unplugged would fail
           at `getUserMedia` with an exact-constraint error, which reads
           as a bug rather than as "that webcam is not here any more". */
        cameraDeviceId:
          s.settings.cameraDeviceId && cameras.some((c) => c.deviceId === s.settings.cameraDeviceId)
            ? s.settings.cameraDeviceId
            : null,
        micDeviceId:
          s.settings.micDeviceId && microphones.some((m) => m.deviceId === s.settings.micDeviceId)
            ? s.settings.micDeviceId
            : (microphones[0]?.deviceId ?? null),
      },
    }));
  },

  refreshPermissions: async () => {
    const permissions = await window.electronAPI?.recorder.permissions();
    if (permissions) set({ permissions });
  },

  requestPermission: async (kind) => {
    await window.electronAPI?.recorder.requestPermission(kind);
    await get().refreshPermissions();
    // Labels only appear once access has been granted at least once.
    await get().refreshDevices();
  },

  selectSource: (id) => set({ selectedSourceId: id }),

  set: (key, value) =>
    set((s) => {
      const settings = { ...s.settings, [key]: value };
      persistSticky(settings);
      return { settings };
    }),

  tutorialOptions: () => {
    const s = get().settings;
    return {
      transcribe: s.captions,
      autoZoom: s.autoZoom,
      zoomShape: { ...DEFAULT_SHAPE, factor: s.zoomFactor },
      motionBlur: s.motionBlur && s.autoZoom,
      detachNarration: s.detachNarration,
      cameraSizePct: s.cameraSizePct,
      cameraCorner: s.cameraCorner,
      markMoments: true,
      cinematic: s.cinematic,
      look: { ...DEFAULT_LOOK, backdrop: s.backdrop, insetPct: s.insetPct },
      cameraOnPauses: s.cameraOnPauses,
      sound: s.clickSounds,
      captions: s.captions,
      captionStyle: CAPTION_STYLE,
    };
  },

  begin: async () => {
    const state = get();
    const source = state.sources.find((s) => s.id === state.selectedSourceId);
    if (!source) {
      set({ error: 'Pick a screen or a window first.', phase: 'error' });
      return;
    }

    const runCountdown = (seconds: number) =>
      new Promise<void>((resolve) => {
        if (seconds <= 0) { resolve(); return; }
        set({ phase: 'countdown', countdown: seconds });
        countdownTimer = window.setInterval(() => {
          const left = get().countdown - 1;
          set({ countdown: left });
          if (left <= 0) {
            if (countdownTimer !== null) { window.clearInterval(countdownTimer); countdownTimer = null; }
            resolve();
          }
        }, 1000);
      });

    await runCountdown(state.settings.countdownSec);

    const settings: CaptureSettings = {
      sourceId: source.id,
      sourceKind: source.kind,
      displayId: source.displayId,
      fps: state.settings.fps,
      maxWidth: state.settings.maxWidth,
      cameraDeviceId: state.settings.cameraDeviceId,
      cameraHeight: state.settings.cameraHeight,
      micDeviceId: state.settings.micDeviceId,
      systemAudio: state.settings.systemAudio,
      hideWindow: state.settings.hideWindow,
    };

    const outcome = await startCapture(settings);
    if (!outcome.ok) {
      set({ phase: 'error', error: outcome.error ?? 'The capture could not be started.', warnings: outcome.warnings });
      return;
    }

    set({
      phase: 'recording',
      elapsedMs: 0,
      markCount: 0,
      warnings: outcome.warnings,
      shortcuts: outcome.shortcuts,
      error: null,
    });
    publish({ phase: 'recording', elapsedMs: 0, markCount: 0 });

    /*
      A wall clock rather than a counter of ticks. `setInterval` drifts,
      and a timer that reads 9:58 on a ten-minute take is the kind of
      small lie that makes everything beside it suspect.
    */
    const startedAt = performance.now();
    let pausedTotal = 0;
    let pausedAt: number | null = null;

    ticker = window.setInterval(() => {
      const current = get();
      if (current.phase === 'paused') {
        if (pausedAt === null) pausedAt = performance.now();
        return;
      }
      if (pausedAt !== null) { pausedTotal += performance.now() - pausedAt; pausedAt = null; }
      if (current.phase !== 'recording') return;

      const elapsedMs = Math.round(performance.now() - startedAt - pausedTotal);
      set({ elapsedMs });
      publish({ phase: 'recording', elapsedMs, markCount: current.markCount });
    }, 200);
  },

  togglePause: async () => {
    const phase = get().phase;
    if (phase !== 'recording' && phase !== 'paused') return;
    const next = phase === 'recording' ? 'paused' : 'recording';
    await pauseCapture(next === 'paused');
    set({ phase: next });
    publish({ phase: next, elapsedMs: get().elapsedMs, markCount: get().markCount });
  },

  stop: async () => {
    if (!isRecording()) return;
    if (ticker !== null) { window.clearInterval(ticker); ticker = null; }
    set({ phase: 'processing', isOpen: true });
    publish({ phase: 'processing', elapsedMs: get().elapsedMs, markCount: get().markCount });

    const result = await stopCapture();
    if (!result.ok) {
      set({ phase: 'error', error: result.error });
      return;
    }
    set({
      phase: 'review',
      take: result.take,
      warnings: result.take.warnings,
      elapsedMs: result.take.durationMs,
    });
  },

  /*
    Two different things behind one word, and the difference is on
    purpose.

    Called while a take is RUNNING it throws the take away, files and
    all — that is what "stop and discard" means, and the partial file it
    deletes is one nobody wants. Called from the review screen it only
    returns to setup: the take is already written, and deleting ten
    minutes of somebody's work because they pressed the button next to
    the one they wanted is not a thing this should be able to do. The
    review screen's button says "Record again" for exactly that reason.
  */
  discard: async () => {
    if (ticker !== null) { window.clearInterval(ticker); ticker = null; }
    if (isRecording()) await cancelCapture(true);
    set({ phase: 'setup', take: null, elapsedMs: 0, markCount: 0, error: null, warnings: [] });
  },

  /*
    Deliberately the same round trip the floating bar makes, rather than
    a local increment.

    Main owns the mark LIST, because main owns the clock the cursor track
    is stamped with. A studio button that bumped its own counter would
    show a mark that never reached the take — and the two clocks are a
    few milliseconds apart, so even writing the renderer's own timestamp
    would land the zoom on a slightly different frame than a shortcut
    press would.
  */
  mark: () => {
    void window.electronAPI?.recorder.barCommand('mark');
  },

  noteMark: () => {
    const markCount = get().markCount + 1;
    set({ markCount });
    publish({ phase: get().phase, elapsedMs: get().elapsedMs, markCount });
  },
}));

/* ── The other three ways a take can be controlled ──────────────────
   The floating bar and the global shortcuts both arrive as one event,
   and both have to end up in the store actions above rather than in
   their own copy of the logic. Registered once, at module load, because
   the studio component is not mounted while the window is hidden — which
   is precisely when the bar is the only control there is.            */

if (typeof window !== 'undefined' && window.electronAPI?.recorder) {
  window.electronAPI.recorder.onCommand(({ action }) => {
    const store = useRecorderStore.getState();
    if (action === 'stop') void store.stop();
    else if (action === 'pause') void store.togglePause();
    else if (action === 'mark') store.noteMark();
  });
}
