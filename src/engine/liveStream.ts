/* ═══════════════════════════════════════════════════════════════════
   Streaming the edit, live.

   ── The claim, and how it is kept ──────────────────────────────────

   The stream is not "a stream that looks like the edit". It IS the
   edit: the same clips, on the same tracks, drawn by the same
   `renderTimelineFrame` that draws the editor's preview and the export,
   from live captures registered into the same media cache that holds
   files. There is no second compositor and no second copy of the look.

   That is the whole design decision. A parallel live renderer would be
   correct on the day it was written and wrong the next time anybody
   touched `cinematicLook`, and nobody would notice until a viewer saw
   something the editor had never shown. So `registerLiveSource` puts a
   MediaStream into `videoEngine`'s cache under a URL, and from that
   point on the live capture is indistinguishable, to every drawing path
   in the app, from a file on disk.

   ── What the recorder keeps doing while this runs ──────────────────

   Everything. HANDOVER §7a's claim is that a recording arrives as an
   EDIT and not as a render, and that rests on never compositing during
   capture. Streaming has to composite. Both are true at once because
   the composite is a SECOND consumer of the same captures: the two
   MediaRecorders still write screen and camera to disk untouched, the
   cursor track is still logged, and the take that lands afterwards is
   the same take that would have landed with no stream at all.

   So the stream is the disposable one. If the machine cannot keep up,
   the frames that are dropped must be the stream's, never the
   recording's. The recording is the asset.

   ── What cannot be live, stated rather than hidden ─────────────────

   Two parts of the tutorial grammar need to know the future and are
   therefore absent here rather than approximated:

     · The camera taking the frame over a PAUSE. A pause is a stretch
       with no input in it, and you cannot know a stretch has ended
       until it has. A delay buffer would buy it; there is none yet.
     · The closing pull-back, which is defined against the end of the
       film. A live stream has no end until it has ended.

   Zooms on real clicks ARE live, because `uiohook` reports a click
   synchronously, and everything about the look — backdrop, inset,
   corner radius, shadow, grade, camera inset — is a property of the
   present frame and is therefore exact.
   ═══════════════════════════════════════════════════════════════════ */

import { useTimelineStore } from '../store/timelineStore';
import { useProjectStore } from '../store/projectStore';
import { MediaAsset, ProjectSettings, Track } from '../types/edl';
import { registerLiveSource, releaseLiveSource } from './videoEngine';
import { renderTimelineFrame } from './compositor';
import {
  LookOptions, DEFAULT_LOOK, addBackdrop, applyScreenLook,
} from './cinematicLook';
import { computePipGeometry, buildPipPatch } from './pictureInPicture';

const store = () => useTimelineStore.getState();
const project = () => useProjectStore.getState();

export const SCREEN_SOURCE = 'live://screen';
export const CAMERA_SOURCE = 'live://camera';

/**
 * A live clip has no end, and the timeline needs one.
 *
 * Twenty-four hours, so the playhead is inside the clip for any stream
 * anybody will run, and the duration is still a real number rather than
 * Infinity — which every arithmetic path here would turn into NaN.
 */
const LIVE_DURATION_MS = 24 * 60 * 60 * 1000;

export interface LiveStreamOptions {
  /** Full ingest URL including the stream key. */
  url: string;
  screen: MediaStream;
  camera?: MediaStream | null;
  /** Mixed programme audio. Usually the microphone, plus system audio where there is any. */
  audio?: MediaStream | null;
  /** Output height. 1080 unless there is a reason. */
  height?: number;
  fps?: 30 | 60;
  look?: Partial<LookOptions>;
  cameraCorner?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  cameraSizePct?: number;
  mirrorCamera?: boolean;
  /** Whether to render live closed captions on the broadcast video stream. */
  liveCaptions?: boolean;
  /** Force software encoding in ffmpeg. */
  software?: boolean;
}

export interface LiveSession {
  stop: () => Promise<void>;
  /** The canvas being encoded, for a local preview. */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  fps: number;
}

let active: LiveSession | null = null;

export function liveSession(): LiveSession | null {
  return active;
}

/**
 * The output size, from the source's shape.
 *
 * Height is fixed and width follows the capture's aspect ratio, then
 * both are rounded to even numbers because H.264 refuses odd
 * dimensions. Deriving width from the SOURCE rather than assuming 16:9
 * matters: a 16:10 display streamed into a 16:9 frame is either
 * letterboxed or cropped, and neither is what the editor would show.
 */
export function streamSize(
  sourceWidth: number,
  sourceHeight: number,
  height: number
): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const aspect = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 16 / 9;
  return { width: even(height * aspect), height: even(height) };
}

/** Wait for a live element to have real dimensions before measuring it. */
function firstFrame(el: HTMLVideoElement, timeoutMs = 5000): Promise<void> {
  if (el.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { el.removeEventListener('loadeddata', done); resolve(); };
    el.addEventListener('loadeddata', done);
    window.setTimeout(done, timeoutMs);
  });
}

/**
 * Build the project the stream is a render of.
 *
 * Deliberately the real store and real clips, not a private scene graph.
 * It costs nothing — the tracks are the same three a take produces — and
 * it buys two things: the compositor needs no live-specific path, and
 * the person streaming can open the editor and SEE what is going out,
 * with every control that normally applies.
 */
function buildLiveProject(
  size: { width: number; height: number },
  fps: 30 | 60,
  look: LookOptions,
  cameraNatural: { width: number; height: number } | null,
  cameraCorner: NonNullable<LiveStreamOptions['cameraCorner']>,
  cameraSizePct: number,
  mirrorCamera = true
): { screenClipId: string; cameraClipId: string | null; liveCaptionClipId: string | null } {
  const settings: ProjectSettings = {
    ...project().project,
    name: 'Live stream',
    width: size.width,
    height: size.height,
    fps,
    durationMs: LIVE_DURATION_MS,
  };

  store().loadProject([], []);
  project().loadProjectSettings(settings);
  store().beginTransaction();

  const backdropTrack = look.backdrop !== 'none' ? store().addTrack('video', 'V1 · Backdrop') : null;
  const screenTrack = store().addTrack('video', 'V2 · Screen');
  const cameraTrack = cameraNatural ? store().addTrack('video', 'V3 · Camera') : null;

  if (backdropTrack) addBackdrop(backdropTrack, settings, LIVE_DURATION_MS, look.backdrop);

  const screenAsset: MediaAsset = {
    id: 'media_live_screen',
    name: 'Screen (live)',
    type: 'video',
    url: SCREEN_SOURCE,
    thumbnailUrl: '',
    durationMs: LIVE_DURATION_MS,
    fileSizeFormatted: 'Live',
    codec: 'live',
  };
  store().addMediaAsset(screenAsset);
  const screenClipId = store().insertClip(screenTrack, screenAsset, 0);
  store().patchClip(screenClipId, { name: 'Screen', fitMode: 'contain' });
  store().patchClip(screenClipId, { 'transform.scale': look.insetPct / 100 });
  applyScreenLook(screenClipId, settings, look);

  let cameraClipId: string | null = null;
  if (cameraTrack && cameraNatural) {
    const cameraAsset: MediaAsset = {
      id: 'media_live_camera',
      name: 'Camera (live)',
      type: 'video',
      url: CAMERA_SOURCE,
      thumbnailUrl: '',
      durationMs: LIVE_DURATION_MS,
      fileSizeFormatted: 'Live',
      codec: 'live',
    };
    store().addMediaAsset(cameraAsset);
    cameraClipId = store().insertClip(cameraTrack, cameraAsset, 0);

    const inserted = store().tracks
      .find((t) => t.id === cameraTrack)!.clips
      .find((c) => c.id === cameraClipId)!;

    const geometry = computePipGeometry({
      project: settings,
      clip: inserted,
      natural: cameraNatural,
      sizePct: cameraSizePct,
      marginPct: 3.5,
      corner: cameraCorner,
      maxHeightPct: 44,
    });
    const patch = buildPipPatch(
      geometry,
      { cornerRadiusPx: Math.round(settings.height * 0.022) },
      { name: 'Camera', muteAudio: true }
    );
    store().patchClip(cameraClipId, {
      ...patch.properties,
      'transform.flipH': mirrorCamera !== false,
    });
  }

  let liveCaptionClipId: string | null = null;
  const captionTrack = store().addTrack('text', 'T1 · Live Captions');
  if (captionTrack) {
    const defaultText = '';
    liveCaptionClipId = store().addTextLayer(captionTrack, defaultText, 0, LIVE_DURATION_MS);
    if (liveCaptionClipId) {
      store().patchClip(liveCaptionClipId, {
        name: 'Live Subtitles',
        'textStyle.fontSize': Math.round(settings.height * 0.045),
        'textStyle.fontWeight': 800,
        'textStyle.color': '#ffffff',
        'textStyle.strokeColor': '#000000',
        'textStyle.strokeWidth': 6,
        'textStyle.background': 'rgba(10, 11, 14, 0.85)',
        'textStyle.backgroundPadding': 14,
        'textStyle.backgroundRadius': 8,
        'transform.y': Math.round(settings.height * 0.38),
      });
    }
  }

  store().commitTransaction('Live stream');
  return { screenClipId, cameraClipId, liveCaptionClipId };
}

/**
 * Start streaming.
 *
 * Order matters. The sources are registered and given a moment to
 * produce a first frame BEFORE the project is built, because the
 * project's size is derived from the capture's real dimensions —
 * `track.getSettings()` has already been observed to disagree with the
 * encoder by two pixels (§7a), and a stream is not a thing you want to
 * discover that in.
 */
export async function startLiveStream(o: LiveStreamOptions): Promise<LiveSession> {
  if (active) throw new Error('A stream is already running.');

  const api = window.electronAPI;
  if (!api?.stream) throw new Error('Streaming needs the desktop app.');

  const fps = o.fps ?? 30;
  const look: LookOptions = { ...DEFAULT_LOOK, ...o.look };

  const screenEl = registerLiveSource(SCREEN_SOURCE, o.screen);
  const cameraEl = o.camera ? registerLiveSource(CAMERA_SOURCE, o.camera) : null;

  await firstFrame(screenEl);
  if (cameraEl) await firstFrame(cameraEl);

  const size = streamSize(
    screenEl.videoWidth || 1920,
    screenEl.videoHeight || 1080,
    o.height ?? 1080
  );

  buildLiveProject(
    size, fps, look,
    cameraEl && cameraEl.videoWidth > 0
      ? { width: cameraEl.videoWidth, height: cameraEl.videoHeight }
      : null,
    o.cameraCorner ?? 'bottom-right',
    o.cameraSizePct ?? 24,
    o.mirrorCamera ?? true
  );

  /* ── The surface that is encoded ── */

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not get a 2D context to compose the stream on.');

  const started = performance.now();
  let raf = 0;
  let stopped = false;

  /*
    Drawn on a timer at the frame rate rather than on rAF.

    `requestAnimationFrame` is throttled hard when the window is not
    visible, and the editor window is HIDDEN for the whole of a screen
    recording (§7a). A stream that stops producing frames the moment you
    start recording would be a remarkable bug to ship.
  */
  const frameMs = 1000 / fps;
  const draw = () => {
    if (stopped) return;
    const tracks = store().tracks as Track[];
    const settings = project().project as ProjectSettings;
    renderTimelineFrame(
      ctx, tracks, settings,
      performance.now() - started,
      canvas.width, canvas.height
    );
  };
  const timer = window.setInterval(draw, frameMs);
  draw();

  /* ── The encoder ── */

  const composite = canvas.captureStream(fps);
  const audioTracks = o.audio?.getAudioTracks() ?? [];
  for (const track of audioTracks) composite.addTrack(track);

  /*
    A stream with no microphone still carries SILENCE, and that is not
    tidiness.

    Found by the suite: with no audio source the FLV went out with a
    video track and nothing else. RTMP ingests do not expect that —
    YouTube and Twitch both publish audio as a required part of the
    stream spec, players stall waiting for a track that never arrives,
    and the failure at the far end reads as "your stream is broken"
    rather than "you had no microphone".

    So a silent source is generated when there is nothing else. It costs
    one oscillator at zero gain and it means the stream is always
    well-formed, however the machine is set up.
  */
  let silence: AudioContext | null = null;
  if (audioTracks.length === 0) {
    silence = new AudioContext();
    const source = silence.createConstantSource();
    const gain = silence.createGain();
    gain.gain.value = 0;
    const destination = silence.createMediaStreamDestination();
    source.connect(gain).connect(destination);
    source.start();
    for (const track of destination.stream.getAudioTracks()) composite.addTrack(track);
  }

  const mime = [
    'video/webm;codecs=h264,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ].find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error('This build has no WebM encoder to stream with.');

  const start = await api.stream.start({
    url: o.url,
    width: size.width,
    height: size.height,
    fps,
    software: o.software,
  });
  if (!start.ok) {
    window.clearInterval(timer);
    releaseLiveSource(SCREEN_SOURCE);
    releaseLiveSource(CAMERA_SOURCE);
    throw new Error(start.error ?? 'The stream could not be started.');
  }

  const recorder = new MediaRecorder(composite, { mimeType: mime });
  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return;
    void event.data.arrayBuffer().then((buffer) => {
      if (!stopped) api.stream.chunk(new Uint8Array(buffer));
    });
  };
  /*
    A short timeslice, because it is the stream's latency floor: nothing
    reaches the ingest until the recorder hands over a blob. 250ms is
    small enough not to be noticed against RTMP's own buffering and
    large enough not to spend the run in IPC.
  */
  recorder.start(250);

  const session: LiveSession = {
    canvas,
    width: size.width,
    height: size.height,
    fps,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      window.clearInterval(timer);
      if (raf) cancelAnimationFrame(raf);
      try { recorder.stop(); } catch { /* already stopped */ }
      /* Let the last blob land before the pipe is closed, or the final
         second of the stream is simply missing. */
      await new Promise((resolve) => window.setTimeout(resolve, 400));
      await api.stream.stop();
      releaseLiveSource(SCREEN_SOURCE);
      releaseLiveSource(CAMERA_SOURCE);
      try { await silence?.close(); } catch { /* already closed */ }
      active = null;
    },
  };

  active = session;
  return session;
}

export async function stopLiveStream(): Promise<void> {
  await active?.stop();
}
