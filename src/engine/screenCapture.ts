/* ═══════════════════════════════════════════════════════════════════
   Screen capture — the renderer half.

   Only a renderer can hold a MediaStream, so the recorders live here
   and everything they produce is pushed straight to the main process,
   which owns the files. See `electron/screenRecorder.ts` for that half.

   ── Two files, not one, and not three ──────────────────────────────

   A take is recorded as TWO independent files:

     screen.mp4   the display, plus system audio where the platform
                  gives it
     camera.mp4   the webcam, plus the microphone

   The pairing is not arbitrary. A MediaRecorder guarantees sync WITHIN
   its own file and nothing across files, so each recorder is given the
   picture and the sound that must not drift from each other: your voice
   belongs with your face, and an app's beeps belong with the app. Put
   the microphone on the screen file instead and a lip-sync error
   becomes possible for the length of the take.

   The alternative — one file, everything mixed — is what most screen
   recorders ship, and it is exactly what makes them useless to edit:
   you cannot duck the music under the voice, mute the beeps, or cut the
   camera without cutting the narration. Kerf lands them as separate
   clips on separate tracks precisely so all of that stays possible.

   ── Why the .webm goes through ffmpeg before the timeline ──────────

   A MediaRecorder file has no duration in its header and no cue index.
   An `<video>` element reports `duration: Infinity` for one, and seeking
   backwards re-decodes from zero. That is not editable footage, so main
   remuxes each take to MP4 before it is ever put on a track.

   Which means the DURATION on the timeline cannot come from the file.
   It comes from the clock: wall time between start and stop, minus
   whatever was paused. That is authoritative here and the file follows
   it to within a frame or two.
   ═══════════════════════════════════════════════════════════════════ */

import {
  CursorSample, InputEvent, InputCaptureStatus, RecordingResult,
} from '../types/electron';

/* ── What the user chose ────────────────────────────────────────── */

export interface CaptureSettings {
  /** A `desktopCapturer` source id. */
  sourceId: string;
  sourceKind: 'screen' | 'window';
  /** Null for a window: only a display has bounds the cursor can be mapped into. */
  displayId: number | null;
  fps: 30 | 60;
  /** Ceiling on the captured width. 0 records at the display's own resolution. */
  maxWidth: number;
  cameraDeviceId: string | null;
  /** Long edge of the camera capture. */
  cameraHeight: 720 | 1080;
  micDeviceId: string | null;
  /** Ask for the machine's own output as well. Only Windows reliably gives it. */
  systemAudio: boolean;
  hideWindow: boolean;
}

export interface DeviceOption {
  deviceId: string;
  label: string;
}

/* ── What a finished take looks like to the rest of the app ─────── */

export interface TakeTrack {
  url: string;
  path: string;
  width: number;
  height: number;
  bytes: number;
  hasAudio: boolean;
  /** Still a raw .webm, because ffmpeg was missing or refused it. */
  raw: boolean;
  error?: string;
}

export interface Take {
  dir: string;
  durationMs: number;
  /** The rate the screen was captured at, which the sequence inherits. */
  fps: 30 | 60;
  screen?: TakeTrack;
  /**
   * Milliseconds the camera recorder started AFTER the screen one.
   * Measured from both `onstart` events rather than assumed to be zero:
   * two MediaRecorders started in the same tick can still begin tens of
   * milliseconds apart, and that offset is what keeps the camera clip
   * lined up with the screen clip on the timeline.
   */
  cameraOffsetMs: number;
  camera?: TakeTrack;
  cursor: CursorSample[];
  /**
   * Real clicks, scrolls and keystrokes. Empty when the input hook could
   * not run, which is not an error — `cursorZoom` falls back to reading
   * the cursor track and the studio says which one happened.
   */
  events: InputEvent[];
  marks: number[];
  cursorTracked: boolean;
  /** Whether zooms will be placed on real input or inferred. */
  input: InputCaptureStatus;
  warnings: string[];
}

/* ── Container choice ───────────────────────────────────────────── */

/*
  H.264 first, and the reason is the remux: an H.264 take copies into an
  MP4 in about a second whatever its length, and a VP9 one has to be
  re-encoded frame by frame. On a twenty-minute 4K screen recording that
  is the difference between "ready" and "come back in ten minutes".
*/
const MIME_CANDIDATES: { mime: string; copyable: boolean }[] = [
  { mime: 'video/webm;codecs=h264,opus', copyable: true },
  { mime: 'video/webm;codecs=h264', copyable: true },
  { mime: 'video/webm;codecs=vp9,opus', copyable: false },
  { mime: 'video/webm;codecs=vp8,opus', copyable: false },
  { mime: 'video/webm', copyable: false },
];

function pickMime(): { mime: string; copyable: boolean } {
  for (const candidate of MIME_CANDIDATES) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate.mime)) {
      return candidate;
    }
  }
  return { mime: '', copyable: false };
}

/**
 * Bits per second for a stream of this size.
 *
 * Screen content is mostly flat colour and sharp edges, which encodes
 * far below the rate photographic video needs — but text going soft is
 * the one artefact that makes a screen recording worthless, so this is
 * deliberately generous. Capped, because an uncapped 5K display at 60fps
 * asks for 120 Mbps and fills a disk in minutes.
 */
function bitrateFor(width: number, height: number, fps: number): number {
  const raw = width * height * fps * 0.14;
  return Math.round(Math.min(48_000_000, Math.max(4_000_000, raw)));
}

/* ── Devices ────────────────────────────────────────────────────── */

/**
 * Cameras and microphones, by label.
 *
 * Labels are empty until the page has been granted access to that KIND
 * of device at least once, which is why the studio asks for permission
 * before it asks you to choose. A list of "Device 1 / Device 2" is not a
 * choice anybody can make.
 */
export async function listDevices(): Promise<{ cameras: DeviceOption[]; microphones: DeviceOption[] }> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const map = (kind: MediaDeviceKind) =>
      devices
        .filter((d) => d.kind === kind && d.deviceId)
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${kind} ${i + 1}` }));
    return { cameras: map('videoinput'), microphones: map('audioinput') };
  } catch {
    return { cameras: [], microphones: [] };
  }
}

/** A low-resolution camera stream for the studio's preview pane. */
export async function previewCamera(deviceId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 360 } },
    audio: false,
  });
}

/** A microphone stream, for the studio's level meter. */
export async function previewMicrophone(deviceId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true },
    video: false,
  });
}

/* ── Acquiring the capture streams ──────────────────────────────── */

/*
  Electron routes desktop capture through the legacy `mandatory`
  constraint bag rather than `getDisplayMedia`, because that is the only
  form that accepts a specific source id chosen elsewhere — with
  `getDisplayMedia` the PICKER decides, and the source grid in the studio
  would be decoration.

  None of it is in lib.dom's types, hence the cast. It is a real,
  documented Electron API, not a hack around one.
*/
interface DesktopConstraints {
  mandatory: Record<string, string | number>;
}

async function acquireScreen(settings: CaptureSettings): Promise<{
  video: MediaStreamTrack;
  systemAudio: MediaStreamTrack | null;
  warning?: string;
}> {
  const mandatory: Record<string, string | number> = {
    chromeMediaSource: 'desktop',
    chromeMediaSourceId: settings.sourceId,
    maxFrameRate: settings.fps,
  };
  if (settings.maxWidth > 0) {
    mandatory.maxWidth = settings.maxWidth;
    mandatory.maxHeight = Math.round((settings.maxWidth * 9) / 16) * 4;
  }

  const video: DesktopConstraints = { mandatory };

  /*
    ── System audio is a WINDOWS capability, and asking anyway is not free ──

    This used to attempt the loopback request everywhere and treat a
    throw as "not supported". macOS does not throw. It RESOLVES, hands
    back a real MediaStream with one audio track, and that track never
    delivers a sample — and a MediaRecorder given a video track and a
    silent-forever audio track **emits nothing at all**. No error, no
    `onerror`, `onstart` fires normally. It simply never produces a
    chunk.

    Measured on macOS 15, Electron 34, against one display:

        4s of desktop video alone          8 chunks, 1,202,678 bytes
        the same 4s with desktop audio     0 chunks,         0 bytes

    That is how a user recorded twenty-seven seconds of screen and
    camera and got a 0-byte `screen.webm` next to a 14MB `camera.mp4`.
    The camera survived only because its own microphone had failed, so
    that recorder happened to be video-only. The main process logged the
    other half of it: `Utility process gone: crashed, exitCode 5,
    audio.mojom.AudioService`, once per take, at the instant it started.

    So the request is gated on the platform that can actually serve it
    rather than on whether it throws. `settings.systemAudio` stays a
    real setting — the studio still offers it, because a Windows user
    wants it — and on every other platform it becomes a stated warning
    instead of a poisoned recorder.
  */
  const canLoopback = window.electronAPI?.platform === 'win32';

  if (settings.systemAudio && canLoopback) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'desktop' } } as unknown as MediaTrackConstraints,
        video: video as unknown as MediaTrackConstraints,
      });
      const audio = stream.getAudioTracks()[0] ?? null;
      return {
        video: stream.getVideoTracks()[0],
        systemAudio: audio,
        ...(audio ? {} : {
          warning: 'This machine offered no system audio, so the screen take has no sound of its own.',
        }),
      };
    } catch {
      /* fall through to picture only */
    }
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: video as unknown as MediaTrackConstraints,
  });
  return {
    video: stream.getVideoTracks()[0],
    systemAudio: null,
    ...(settings.systemAudio && !canLoopback
      ? {
        warning: 'System audio is a Windows feature, so the screen take has no sound of its own. '
          + 'Your microphone was still recorded. Asking for it here does not merely fail: it '
          + 'returns a track that never delivers a sample and stops the recording entirely, so '
          + 'Kerf does not ask.',
      }
      : {}),
  };
}

/** Sum two live audio tracks into one, for the case where they share a file. */
function mixAudio(tracks: MediaStreamTrack[]): { track: MediaStreamTrack; context: AudioContext } {
  const context = new AudioContext();
  if (context.state === 'suspended') {
    void context.resume();
  }
  const destination = context.createMediaStreamDestination();
  for (const track of tracks) {
    context.createMediaStreamSource(new MediaStream([track])).connect(destination);
  }
  return { track: destination.stream.getAudioTracks()[0], context };
}

/**
 * The live captures of the take that is recording, as MediaStreams.
 *
 * Null when nothing is recording. The tracks are the recorders' OWN
 * tracks rather than copies: a MediaStreamTrack can feed any number of
 * consumers, so a stream composited from these takes nothing away from
 * the files being written, which is the property the whole
 * stream-alongside-record design rests on.
 */
export function liveCaptureStreams(): {
  screen: MediaStream; camera: MediaStream | null; audio: MediaStream | null;
} | null {
  if (!session) return null;
  const { screen, camera, audio } = session.live;
  if (!screen) return null;
  return {
    screen: new MediaStream([screen]),
    camera: camera ? new MediaStream([camera]) : null,
    audio: audio ? new MediaStream([audio]) : null,
  };
}

/* ── The session ────────────────────────────────────────────────── */

type Phase = 'idle' | 'recording' | 'paused' | 'finishing';

interface Recorder {
  name: 'screen' | 'camera';
  recorder: MediaRecorder;
  startedAt: number | null;
  /** Every chunk is awaited, so a stop cannot run ahead of the writes. */
  writes: Promise<unknown>[];
  /** How many chunks have actually arrived. The watchdog reads this. */
  chunks: number;
  hasAudio: boolean;
  width: number;
  height: number;
}

interface Session {
  id: string;
  dir: string;
  phase: Phase;
  copyable: boolean;
  fps: 30 | 60;
  recorders: Recorder[];
  tracks: MediaStreamTrack[];
  /**
   * The same captures, named, for a SECOND consumer.
   *
   * `tracks` is the bag everything opened goes into so it can all be
   * stopped together, and it cannot say which track is the camera. A
   * live stream needs to know, because it composites them. Holding the
   * references costs nothing: the recorders already have them, and a
   * track can feed any number of consumers at once, which is exactly
   * what lets a stream exist without the recording being touched.
   */
  live: {
    screen: MediaStreamTrack | null;
    camera: MediaStreamTrack | null;
    /** The mixed programme audio the camera recorder is already given. */
    audio: MediaStreamTrack | null;
  };
  audioContext: AudioContext | null;
  cursorTracked: boolean;
  input: InputCaptureStatus;
  warnings: string[];
  shortcuts: string[];
  watchdog: number | null;
  /** Set when a recorder produced nothing. Surfaced while the take runs. */
  fault: string | null;
}

let session: Session | null = null;

export function isRecording(): boolean {
  return session !== null && session.phase !== 'idle';
}

/** Milliseconds a chunk covers. Fewer round trips, still bounded memory. */
const TIMESLICE_MS = 3000;

/**
 * How long to wait before deciding a recorder is producing nothing.
 *
 * Two timeslices and a little. A MediaRecorder that is working has
 * emitted twice by then; one that never will has emitted nothing, and
 * that difference is worth catching in six seconds rather than in
 * twenty-seven minutes.
 *
 * This exists because of a failure that produced NO error of any kind:
 * `onstart` fired, `onerror` never did, and `ondataavailable` simply
 * never ran. Nothing in the MediaRecorder API reports that state, so it
 * has to be measured.
 */
const SILENCE_GRACE_MS = 6500;

export interface StartOutcome {
  ok: boolean;
  error?: string;
  warnings: string[];
  shortcuts: string[];
  cursorTracked: boolean;
  /** Whether zooms will come from real clicks or from the cursor track. */
  input?: InputCaptureStatus;
  dir?: string;
}

export async function startCapture(
  settings: CaptureSettings,
  onFault: (message: string) => void = () => undefined
): Promise<StartOutcome> {
  if (session) return { ok: false, error: 'A recording is already running.', warnings: [], shortcuts: [], cursorTracked: false };

  const api = window.electronAPI;
  if (!api?.recorder) {
    return {
      ok: false,
      error: 'Recording needs the desktop app. This is running in a browser, which cannot capture a screen.',
      warnings: [], shortcuts: [], cursorTracked: false,
    };
  }

  const { mime, copyable } = pickMime();
  if (!mime) {
    return {
      ok: false,
      error: 'This build has no WebM recorder, so nothing can be captured.',
      warnings: [], shortcuts: [], cursorTracked: false,
    };
  }

  const warnings: string[] = [];
  const openedTracks: MediaStreamTrack[] = [];
  let audioContext: AudioContext | null = null;

  /** Release everything acquired so far. Called from every failure below. */
  const bail = () => {
    for (const track of openedTracks) track.stop();
    void audioContext?.close();
  };

  try {
    /* ── 1. The picture ── */
    const screen = await acquireScreen(settings);
    openedTracks.push(screen.video);
    if (screen.systemAudio) openedTracks.push(screen.systemAudio);
    if (screen.warning) warnings.push(screen.warning);

    /* ── 2. The camera ── */
    let cameraVideo: MediaStreamTrack | null = null;
    if (settings.cameraDeviceId) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: settings.cameraDeviceId },
            width: { ideal: Math.round((settings.cameraHeight * 16) / 9) },
            height: { ideal: settings.cameraHeight },
            frameRate: { ideal: 30 },
          },
          audio: false,
        });
        cameraVideo = stream.getVideoTracks()[0];
        openedTracks.push(cameraVideo);
      } catch (err) {
        warnings.push(`The camera could not be opened, so the take is screen only. ${(err as Error).message}`);
      }
    }

    /* ── 3. The microphone ── */
    let mic: MediaStreamTrack | null = null;
    if (settings.micDeviceId) {
      /*
        The remembered device first, the system default second.

        `deviceId: { exact }` fails outright with "Requested device not
        found" when the id no longer resolves, and ids do stop resolving:
        they are scoped to the page's origin and are re-minted when
        permission state changes, so a microphone chosen before the
        permission prompt is answered can be gone by the time recording
        starts. Losing the narration of a whole take over a stale
        identifier is not a trade worth making, so an exact miss falls
        back to whatever the machine considers its default and says so.
      */
      const shapes: { constraint: MediaTrackConstraints; note?: string }[] = [
        {
          constraint: {
            deviceId: { exact: settings.micDeviceId },
            echoCancellation: true, noiseSuppression: true, autoGainControl: true,
          },
        },
        {
          constraint: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          note: 'The microphone you picked was not there any more, so the take used this '
            + 'machine\'s default input instead.',
        },
      ];

      for (const shape of shapes) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: shape.constraint,
            video: false,
          });
          mic = stream.getAudioTracks()[0];
          openedTracks.push(mic);
          if (shape.note) warnings.push(shape.note);
          break;
        } catch (err) {
          if (shape === shapes[shapes.length - 1]) {
            warnings.push(
              `No microphone could be opened, so the take has no narration. ${(err as Error).message}`
            );
          }
        }
      }
    }

    /* ── 4. Pair each picture with the sound that must not drift from it ── */
    const screenTracks: MediaStreamTrack[] = [screen.video];
    const cameraTracks: MediaStreamTrack[] = cameraVideo ? [cameraVideo] : [];

    if (cameraVideo && mic) {
      cameraTracks.push(mic);
      if (screen.systemAudio) screenTracks.push(screen.systemAudio);
    } else if (mic && screen.systemAudio) {
      // No camera to carry the voice, so both sounds share the screen file.
      const mixed = mixAudio([screen.systemAudio, mic]);
      audioContext = mixed.context;
      screenTracks.push(mixed.track);
    } else if (mic) {
      screenTracks.push(mic);
    } else if (screen.systemAudio) {
      screenTracks.push(screen.systemAudio);
    }

    /* ── 5. Open the files ── */
    const streams: ('screen' | 'camera')[] = cameraTracks.length > 0 ? ['screen', 'camera'] : ['screen'];
    const begun = await api.recorder.begin({
      streams,
      displayId: settings.sourceKind === 'screen' ? settings.displayId : null,
      hideWindow: settings.hideWindow,
    });
    if (!begun.ok) {
      bail();
      return { ok: false, error: begun.error, warnings, shortcuts: [], cursorTracked: false };
    }
    if (!begun.cursorTracked) {
      warnings.push(
        'A single window was captured, so the pointer cannot be located inside the frame. '
        + 'Auto zoom is off for this take.'
      );
    }
    if (!begun.barHiddenFromCapture) {
      warnings.push('On this platform the recording bar cannot be hidden from the capture, so it will appear in the take.');
    }

    /* ── 6. The recorders ── */
    const built: Recorder[] = [];
    const make = (name: 'screen' | 'camera', tracks: MediaStreamTrack[]): Recorder => {
      const videoTrack = tracks.find((t) => t.kind === 'video')!;
      const size = videoTrack.getSettings();
      const width = size.width ?? 1920;
      const height = size.height ?? 1080;

      const recorder = new MediaRecorder(new MediaStream(tracks), {
        mimeType: mime,
        videoBitsPerSecond: bitrateFor(width, height, name === 'screen' ? settings.fps : 30),
        audioBitsPerSecond: 192_000,
      });

      const entry: Recorder = {
        name,
        recorder,
        startedAt: null,
        writes: [],
        chunks: 0,
        hasAudio: tracks.some((t) => t.kind === 'audio'),
        width,
        height,
      };

      recorder.onstart = () => { entry.startedAt = performance.now(); };
      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return;
        entry.chunks += 1;
        /*
          Kept as a promise the stop path awaits. Fire and forget loses
          the tail of the recording: `stop()` emits one last, often
          large, chunk and `finish` would close the file underneath it.
        */
        entry.writes.push(
          event.data
            .arrayBuffer()
            .then((buffer) => api.recorder.chunk(begun.sessionId, name, new Uint8Array(buffer)))
        );
      };

      return entry;
    };

    built.push(make('screen', screenTracks));
    if (cameraTracks.length > 0) built.push(make('camera', cameraTracks));

    session = {
      id: begun.sessionId,
      dir: begun.dir,
      phase: 'recording',
      copyable,
      fps: settings.fps,
      recorders: built,
      tracks: openedTracks,
      live: { screen: screen.video, camera: cameraVideo, audio: mic },
      audioContext,
      cursorTracked: begun.cursorTracked,
      input: begun.input,
      warnings,
      shortcuts: begun.shortcuts,
      watchdog: null,
      fault: null,
    };

    /*
      Started back to back rather than awaited in turn. Whatever gap is
      left is measured from the two `onstart` timestamps and applied to
      the camera clip, so it is corrected rather than merely small.
    */
    for (const entry of built) entry.recorder.start(TIMESLICE_MS);

    /*
      And then check that it is ACTUALLY recording.

      Nothing else does. A MediaRecorder handed a track that never
      delivers reports success at every step and produces no bytes, and
      the only way to know is to look at whether any arrived.
    */
    const started = session;
    started.watchdog = window.setTimeout(() => {
      if (session !== started) return;
      const dead = started.recorders.filter((entry) => entry.chunks === 0);
      if (dead.length === 0) return;

      started.fault = dead.length === started.recorders.length
        ? 'Nothing is being recorded. Stop and try again.'
        : `The ${dead.map((d) => d.name).join(' and ')} is not recording. Stop and try again.`;
      onFault(started.fault);
    }, SILENCE_GRACE_MS);

    return {
      ok: true,
      warnings,
      shortcuts: begun.shortcuts,
      cursorTracked: begun.cursorTracked,
      input: begun.input,
      dir: begun.dir,
    };
  } catch (err) {
    bail();
    return {
      ok: false,
      error: (err as Error).message || 'The capture could not be started.',
      warnings,
      shortcuts: [],
      cursorTracked: false,
    };
  }
}

export async function pauseCapture(paused: boolean): Promise<void> {
  if (!session) return;
  if (paused && session.phase !== 'recording') return;
  if (!paused && session.phase !== 'paused') return;

  for (const entry of session.recorders) {
    if (paused) entry.recorder.pause();
    else entry.recorder.resume();
  }
  session.phase = paused ? 'paused' : 'recording';
  await window.electronAPI?.recorder.pause(session.id, paused);
}

/** Wait for a recorder's `onstop`, which fires AFTER its last chunk. */
function stopped(entry: Recorder): Promise<void> {
  return new Promise((resolve) => {
    if (entry.recorder.state === 'inactive') { resolve(); return; }
    entry.recorder.onstop = () => resolve();
    entry.recorder.stop();
  });
}

export async function stopCapture(): Promise<{ ok: true; take: Take } | { ok: false; error: string }> {
  const current = session;
  if (!current) return { ok: false, error: 'Nothing is recording.' };
  current.phase = 'finishing';
  if (current.watchdog !== null) { window.clearTimeout(current.watchdog); current.watchdog = null; }

  for (const entry of current.recorders) {
    if (entry.recorder.state === 'paused') entry.recorder.resume();
  }
  await Promise.all(current.recorders.map(stopped));
  // Every chunk write, including the final one each `stop()` emitted.
  await Promise.all(current.recorders.flatMap((entry) => entry.writes));

  for (const track of current.tracks) track.stop();
  void current.audioContext?.close();

  const result = await window.electronAPI!.recorder.finish(current.id, current.copyable);
  session = null;

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, take: await assemble(current, result) };
}

/** Throw the take away without writing anything to the timeline. */
export async function cancelCapture(discard: boolean): Promise<void> {
  const current = session;
  if (!current) return;
  current.phase = 'finishing';
  if (current.watchdog !== null) { window.clearTimeout(current.watchdog); current.watchdog = null; }

  for (const entry of current.recorders) {
    if (entry.recorder.state !== 'inactive') {
      try { entry.recorder.stop(); } catch { /* already stopping */ }
    }
  }
  for (const track of current.tracks) track.stop();
  void current.audioContext?.close();

  session = null;
  await window.electronAPI?.recorder.cancel(current.id, discard);
}

/**
 * The dimensions the file actually has, read back off the finished file.
 *
 * Not the same thing as the ones the capture asked for, and the
 * difference is not theoretical: constrained to 1920 wide, a 3024x1964
 * display came back from `track.getSettings()` as 1920x1246 and the
 * encoder wrote **1918**x1246. Two pixels.
 *
 * Two pixels is enough to matter here, because the canvas is cut to the
 * take's aspect ratio so the screen clip can rest at scale 1 with
 * nothing cropped and nothing letterboxed. Build that canvas from a
 * width the media does not have and the clip rests at 0.9989 instead,
 * which puts a one-pixel line of project background along two edges of
 * every frame. Nobody would ever guess that from the symptom.
 *
 * Falls back to the track's numbers if the element will not report:
 * being two pixels out is much better than having no size at all.
 */
export function probeVideo(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const element = document.createElement('video');
    element.preload = 'metadata';
    element.muted = true;

    let settled = false;
    const done = (value: { width: number; height: number } | null) => {
      if (settled) return;
      settled = true;
      element.onloadedmetadata = null;
      element.onerror = null;
      element.removeAttribute('src');
      element.load();
      resolve(value);
    };

    element.onloadedmetadata = () =>
      done(element.videoWidth > 0 ? { width: element.videoWidth, height: element.videoHeight } : null);
    element.onerror = () => done(null);
    // A file that never reports must not hold the review screen for ever.
    window.setTimeout(() => done(null), 8000);

    element.src = url;
  });
}

async function assemble(current: Session, result: RecordingResult): Promise<Take> {
  const warnings = [...current.warnings];
  if (current.fault) warnings.push(current.fault);

  const screenRec = current.recorders.find((r) => r.name === 'screen');
  const cameraRec = current.recorders.find((r) => r.name === 'camera');

  const build = async (name: 'screen' | 'camera', entry: Recorder | undefined): Promise<TakeTrack | undefined> => {
    const file = result.files[name];
    if (!entry || !file || !file.url) {
      if (file?.error) warnings.push(`${name}: ${file.error}`);
      return undefined;
    }
    if (file.error) warnings.push(file.error);

    const probed = await probeVideo(file.url);
    return {
      url: file.url,
      path: file.path,
      width: probed?.width ?? entry.width,
      height: probed?.height ?? entry.height,
      bytes: file.bytes,
      hasAudio: entry.hasAudio,
      raw: file.raw,
      ...(file.error ? { error: file.error } : {}),
    };
  };

  const [screenTrack, cameraTrack] = await Promise.all([
    build('screen', screenRec),
    build('camera', cameraRec),
  ]);

  /*
    Both `startedAt` values come from the same `performance.now()` clock,
    so the difference is real. A camera that started late must be pushed
    late on the timeline by exactly that much, or the first words of the
    take are attributed to the wrong moment on screen.
  */
  const cameraOffsetMs =
    screenRec?.startedAt != null && cameraRec?.startedAt != null
      ? Math.max(0, Math.round(cameraRec.startedAt - screenRec.startedAt))
      : 0;

  return {
    dir: result.dir,
    durationMs: result.durationMs,
    fps: current.fps,
    screen: screenTrack,
    camera: cameraTrack,
    cameraOffsetMs,
    cursor: result.cursor,
    events: result.events ?? [],
    marks: result.marks,
    cursorTracked: result.cursorTracked && current.cursorTracked,
    input: current.input,
    warnings,
  };
}
