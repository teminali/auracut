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
import { useUiStore } from './uiStore';
import { RecorderSource, RecorderPermissions } from '../types/electron';
import {
  CaptureSettings, DeviceOption, Take,
  startCapture, stopCapture, pauseCapture, cancelCapture, listDevices, isRecording,
  liveCaptureStreams,
} from '../engine/screenCapture';
import { startLiveStream, stopLiveStream } from '../engine/liveStream';
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
  mirrorCamera: boolean;
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

  /* ── Going live ──────────────────────────────────────────────────
     An RTMP ingest to push the SAME composition to while the take is
     recording. Empty means record only, which is the default and stays
     the default: streaming is something you turn on, never something
     that happens because a field was left filled in from last time. */
  streamUrl: string;
  /** Off unless explicitly switched on, whatever `streamUrl` holds. */
  streamEnabled: boolean;
  streamHeight: 720 | 1080;

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
  /**
   * Spoken language, as a two-letter code, or `auto` to detect it.
   *
   * It is a recorder setting rather than a skill argument because it is
   * a property of the PERSON, not of the take: whoever is narrating will
   * narrate the next one in the same language, and being asked every
   * time is the kind of friction that makes a feature go unused.
   */
  language: string;
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
  mirrorCamera: true,
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
  /*
    Off, and the URL is remembered while the switch is not. Somebody who
    streamed once and then records a private walkthrough must not
    discover they were live because a field persisted.
  */
  streamUrl: '',
  streamEnabled: false,
  streamHeight: 1080,
  cinematic: true,
  backdrop: DEFAULT_LOOK.backdrop,
  insetPct: DEFAULT_LOOK.insetPct,
  cameraOnPauses: true,
  clickSounds: true,
  captions: true,
  /*
    `auto` is a real choice now and was not before. whisper.cpp's
    `--language` defaults to `en`, and Kerf used to omit the flag
    entirely for `auto`, so detection never ran and any other language
    came back as one "(speaking in foreign language)" marker. With `-l
    auto` actually passed, the same take detects `sw` at p=0.84.

    Still worth being able to override: auto-detect reads the language
    ONCE, from the start of the file, so a take that opens in one
    language and continues in another gets whichever came first.
  */
  language: 'auto',
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
  /** True while a live stream is going out alongside the take. */
  streaming: boolean;

  sources: RecorderSource[];
  sourcesLoading: boolean;
  selectedSourceId: string | null;
  /** macOS says the permission is granted and hands back no displays. */
  screenGrantStale: boolean;

  permissions: RecorderPermissions | null;
  cameras: DeviceOption[];
  microphones: DeviceOption[];

  settings: StickySettings;

  countdown: number;
  elapsedMs: number;
  /**
   * Set when a recorder is producing nothing, within seconds of the
   * start rather than at the end. See `SILENCE_GRACE_MS`.
   */
  fault: string | null;
  /** How many moments the user has marked during this take. */
  markCount: number;
  shortcuts: string[];

  take: Take | null;
  error: string | null;
  warnings: string[];

  open: () => void;
  close: () => void;

  refreshSources: () => Promise<void>;
  refreshDevices: (prompt?: boolean) => Promise<void>;
  refreshPermissions: () => Promise<void>;
  requestPermission: (kind: 'camera' | 'microphone' | 'screen' | 'accessibility') => Promise<void>;
  /** Clear the stale grant and restart, so macOS asks again. */
  repairScreenPermission: () => Promise<void>;

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

/** One id, so a fault from an earlier take cannot linger over a later one. */
const FAULT_TOAST = 'recorder-fault';

/** Push what the floating bar shows. Called on every tick and phase change. */
function publish(state: {
  phase: RecorderPhase; elapsedMs: number; markCount: number; fault?: string | null;
}): void {
  void window.electronAPI?.recorder.publishState({
    phase: state.phase,
    elapsedMs: state.elapsedMs,
    markCount: state.markCount,
    /* The bar is the only thing on screen while the window is hidden, so
       a take that is recording nothing has to be visible THERE. */
    fault: state.fault ?? null,
  });
}

export const useRecorderStore = create<RecorderState>((set, get) => ({
  isOpen: false,
  phase: 'setup',
  streaming: false,

  sources: [],
  sourcesLoading: false,
  selectedSourceId: null,
  screenGrantStale: false,

  permissions: null,
  cameras: [],
  microphones: [],

  settings: loadSticky(),

  countdown: 0,
  elapsedMs: 0,
  fault: null,
  markCount: 0,
  shortcuts: [],

  take: null,
  error: null,
  warnings: [],

  open: () => {
    set({
      isOpen: true, phase: 'setup', take: null, error: null,
      warnings: [], elapsedMs: 0, markCount: 0, fault: null,
    });
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
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.recorder) {
      const webSource: RecorderSource = {
        id: 'web:screen',
        name: 'Browser Display / Window / Tab',
        kind: 'screen',
        displayId: null,
        width: 1920,
        height: 1080,
        scaleFactor: 1,
        primary: true,
        thumbnail: null,
        icon: null,
      };
      set({
        sources: [webSource],
        sourcesLoading: false,
        selectedSourceId: 'web:screen',
      });
      return;
    }
    set({ sourcesLoading: true });
    const result = await api.recorder.sources(480);
    const sources = result.sources ?? [];
    set((s) => ({
      sources,
      sourcesLoading: false,
      screenGrantStale: Boolean(result.deniedDespiteSettings),
      error: result.ok ? s.error : (result.error ?? 'The screen list could not be read.'),
      // Keep the current pick if it still exists; otherwise take the primary display.
      selectedSourceId:
        s.selectedSourceId && sources.some((x) => x.id === s.selectedSourceId)
          ? s.selectedSourceId
          : (sources.find((x) => x.primary) ?? sources.find((x) => x.kind === 'screen') ?? sources[0])?.id ?? null,
    }));
  },

  refreshDevices: async (prompt = false) => {
    const isWeb = typeof window !== 'undefined' && !window.electronAPI?.recorder;
    const { cameras, microphones } = await listDevices(prompt || isWeb);
    set((s) => {
      const selectedCamera =
        s.settings.cameraDeviceId && cameras.some((c) => c.deviceId === s.settings.cameraDeviceId)
          ? s.settings.cameraDeviceId
          : (cameras[0]?.deviceId ?? null);
      const selectedMic =
        s.settings.micDeviceId && microphones.some((m) => m.deviceId === s.settings.micDeviceId)
          ? s.settings.micDeviceId
          : (microphones[0]?.deviceId ?? null);
      return {
        cameras,
        microphones,
        settings: {
          ...s.settings,
          cameraDeviceId: selectedCamera,
          micDeviceId: selectedMic,
        },
      };
    });
  },

  refreshPermissions: async () => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (api?.recorder) {
      const permissions = await api.recorder.permissions();
      if (permissions) set({ permissions });
    } else {
      set({
        permissions: {
          platform: 'web',
          screen: 'granted',
          camera: 'granted',
          microphone: 'granted',
          barHiddenFromCapture: true,
          input: {
            ok: true,
            source: 'cursor-only',
            reason: 'ready',
            message: 'Web Browser Capture',
          },
        },
      });
    }
  },

  requestPermission: async (kind) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (api?.recorder) {
      await api.recorder.requestPermission(kind);
    } else if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      try {
        if (kind === 'camera') {
          const s = await navigator.mediaDevices.getUserMedia({ video: true });
          s.getTracks().forEach((t) => t.stop());
        } else if (kind === 'microphone') {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true });
          s.getTracks().forEach((t) => t.stop());
        }
      } catch {
        /* dismissed prompt */
      }
    }
    await get().refreshPermissions();
    // Labels only appear once access has been granted at least once.
    await get().refreshDevices(true);
  },

  /*
    The switch is already on, so sending somebody back to System Settings
    would be sending them to look at a thing that is not the problem.
    Clearing the row is, and it needs a restart to take effect.
  */
  repairScreenPermission: async () => {
    const api = window.electronAPI?.recorder;
    if (!api) return;
    const result = await api.resetScreenPermission();
    useUiStore.getState().pushToast({
      kind: result.ok ? 'success' : 'error',
      title: result.ok ? 'Restarting Kerf' : 'Could not reset the permission',
      detail: result.message,
      ttl: result.ok ? 2500 : 8000,
    });
    if (result.ok) window.setTimeout(() => void api.relaunch(), 1200);
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
      mirrorCamera: s.mirrorCamera,
      markMoments: true,
      cinematic: s.cinematic,
      look: { ...DEFAULT_LOOK, backdrop: s.backdrop, insetPct: s.insetPct },
      cameraOnPauses: s.cameraOnPauses,
      sound: s.clickSounds,
      captions: s.captions,
      language: s.language,
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

    // Whatever the last take said, this one has not said it yet.
    useUiStore.getState().dismissToast(FAULT_TOAST);

    const outcome = await startCapture(settings, (fault) => {
      /*
        Raised from the capture engine six seconds in, not at the end.
        The alternative is what actually happened to somebody: twenty-
        seven seconds of recording, a green tick, and a zero-byte file.
      */
      set({ fault });
      publish({ phase: get().phase, elapsedMs: get().elapsedMs, markCount: get().markCount, fault });
      useUiStore.getState().pushToast({
        /* A fixed id, and sticky. Sticky because a take that is
           recording nothing is not something to miss while you look
           away; a fixed id so it replaces itself rather than stacking,
           and so the next take can clear it by name. */
        id: FAULT_TOAST,
        kind: 'error',
        title: 'This take is not recording',
        detail: fault,
        ttl: 0,
      });
    });
    if (!outcome.ok) {
      set({ phase: 'error', error: outcome.error ?? 'The capture could not be started.', warnings: outcome.warnings });
      return;
    }

    set({
      phase: 'recording',
      elapsedMs: 0,
      markCount: 0,
      fault: null,
      warnings: outcome.warnings,
      shortcuts: outcome.shortcuts,
      error: null,
    });
    publish({ phase: 'recording', elapsedMs: 0, markCount: 0 });

    /*
      ── And, if asked, the same composition pushed live ──

      Started AFTER the recorders, deliberately and in that order. The
      recording is the asset and the stream is disposable, so nothing
      about going live is allowed to delay or fail the take: this is not
      awaited into the start path, and if it throws the recording
      carries on and a toast says the stream did not.
    */
    if (state.settings.streamEnabled && state.settings.streamUrl.trim()) {
      void (async () => {
        try {
          const captures = liveCaptureStreams();
          if (!captures) throw new Error('The capture had no live tracks to stream.');
          await startLiveStream({
            url: state.settings.streamUrl.trim(),
            screen: captures.screen,
            camera: captures.camera,
            audio: captures.audio,
            height: state.settings.streamHeight,
            fps: state.settings.fps,
            look: {
              backdrop: state.settings.backdrop,
              insetPct: state.settings.insetPct,
            },
            cameraCorner: state.settings.cameraCorner,
            cameraSizePct: state.settings.cameraSizePct,
          });
          set({ streaming: true });
        } catch (err) {
          set({ streaming: false });
          useUiStore.getState().pushToast({
            kind: 'error',
            title: 'The stream did not start',
            detail: `${(err as Error).message} The take is still recording.`,
            ttl: 12000,
          });
        }
      })();
    }

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
      publish({ phase: 'recording', elapsedMs, markCount: current.markCount, fault: current.fault });
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

    /* Before the capture is torn down: the stream is composited from
       these tracks and stopping them first leaves it encoding nothing. */
    if (get().streaming) {
      await stopLiveStream().catch(() => { /* the take matters more */ });
      set({ streaming: false });
    }

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
    if (get().streaming) {
      await stopLiveStream().catch(() => { /* nothing to salvage on a cancel */ });
      set({ streaming: false });
    }
    if (isRecording()) await cancelCapture(true);
    set({ phase: 'setup', take: null, elapsedMs: 0, markCount: 0, error: null, warnings: [], fault: null });
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
