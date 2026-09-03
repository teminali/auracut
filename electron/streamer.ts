/* ═══════════════════════════════════════════════════════════════════
   Pushing a live stream to an RTMP ingest.

   ── What this is, and what it deliberately is not ──────────────────

   It is the same shape as `render.ts`: a spawned ffmpeg fed from the
   renderer over a pipe. The difference is the far end. An export writes
   a file and may take as long as it likes; a stream has a wall clock it
   cannot fall behind, a server that can drop it, and a viewer who sees
   every stall.

   It is NOT a second compositor. The picture arriving on the pipe was
   drawn by `renderTimelineFrame`, the function that draws the editor
   and the export, so a stream looks like the edit because it IS the
   edit, rendered live. See `registerLiveSource` in videoEngine.ts.

   ── The encoder settings are not preferences ───────────────────────

   Every number below comes from what the ingests actually require, and
   was verified end to end against a real RTMP endpoint before it was
   written down (ffmpeg can listen as well as publish, which is what
   `verify_stream.py` uses):

     · H.264, High profile, yuv420p.
     · CBR. YouTube states constant bitrate as a requirement, not a
       preference: `-b:v` alone is a target, so `-maxrate` and `-bufsize`
       are set with it, and bufsize is ONE second of video rather than
       the ffmpeg default of two, because a large buffer is exactly how
       a "constant" bitrate ends up bursting.
     · A keyframe every 2 SECONDS, closed. Recommended 2s and capped at
       4s by YouTube; it is what lets the server cut segments. `-g` is in
       FRAMES, so it is 2 x fps, and `-keyint_min` equal to it stops the
       encoder inserting an early keyframe on a scene change and
       shortening the segment. Measured on the wire: keyframes at 0.02,
       2.02, 4.02.
     · No B-frames. They cost latency for a picture that is mostly a
       still screen, and some ingests are happier without them.
     · AAC-LC, 128 kbps, 44.1 kHz, stereo.

   The bitrate ladder is YouTube's published table for H.264, chosen by
   height and frame rate rather than guessed.
   ═══════════════════════════════════════════════════════════════════ */

import { BrowserWindow, ipcMain } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import log from 'electron-log';
import { ffmpeg } from './transcribe';

/* ── The ladder ─────────────────────────────────────────────────── */

/**
 * YouTube's recommended video bitrate, in kbps, for H.264.
 *
 * Standard frame rate is 24-30fps and high is 50-60. The numbers are the
 * "recommended" column, not the maximum: a stream that saturates the
 * viewer's connection is worse than one that is slightly softer.
 */
export function recommendedBitrateKbps(height: number, fps: number): number {
  const high = fps > 30;
  if (height >= 1400) return high ? 24000 : 15000;
  if (height >= 1000) return high ? 12000 : 10000;
  if (height >= 700) return high ? 6000 : 4000;
  return high ? 3000 : 2000;
}

export interface StreamOptions {
  /** Full ingest URL including the stream key, e.g. rtmp://a.rtmp.youtube.com/live2/KEY */
  url: string;
  width: number;
  height: number;
  fps: number;
  /** Leave unset to take the recommended rate for this size. */
  videoKbps?: number;
  audioKbps?: number;
  /** Force software x264 instead of the platform encoder. */
  software?: boolean;
}

export type StreamState =
  | { state: 'idle' }
  | { state: 'connecting'; url: string }
  | { state: 'live'; url: string; sinceMs: number; framesIn: number; bytesIn: number; droppedFrames: number }
  | { state: 'ended'; reason: string }
  | { state: 'error'; message: string };

let proc: ChildProcess | null = null;
let state: StreamState = { state: 'idle' };
let target: BrowserWindow | null = null;
let framesIn = 0;
let bytesIn = 0;
let dropped = 0;
let startedAt = 0;
let stderrTail = '';

export function setStreamWindow(window: BrowserWindow | null): void {
  target = window;
}

function publish(next: StreamState): void {
  state = next;
  log.info('[stream]', JSON.stringify(next));
  if (target && !target.isDestroyed()) target.webContents.send('stream:state', next);
}

/** Everything after the last slash is the stream key and is never logged. */
function redact(url: string): string {
  const at = url.lastIndexOf('/');
  return at <= 0 ? '<url>' : `${url.slice(0, at)}/<key>`;
}

function encoderArgs(o: Required<Pick<StreamOptions, 'width' | 'height' | 'fps'>> & StreamOptions) {
  const kbps = o.videoKbps ?? recommendedBitrateKbps(o.height, o.fps);
  const gop = String(Math.round(o.fps * 2));

  /*
    VideoToolbox where it exists. Encoding 1080p30 in software while the
    same machine is capturing its own screen, compositing every frame and
    running two recorders is how a stream starts dropping frames, and the
    frames it drops are the recording's.
  */
  const video = o.software
    ? [
      '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-tune', 'zerolatency',
      '-x264-params', `nal-hrd=cbr:keyint=${gop}:min-keyint=${gop}:scenecut=0`,
    ]
    : ['-c:v', 'h264_videotoolbox', '-profile:v', 'high', '-realtime', '1'];

  return [
    ...video,
    '-pix_fmt', 'yuv420p',
    '-b:v', `${kbps}k`,
    '-maxrate', `${kbps}k`,
    '-bufsize', `${kbps}k`,
    '-g', gop,
    '-keyint_min', gop,
    '-bf', '0',
    '-r', String(o.fps),
    '-c:a', 'aac', '-b:a', `${o.audioKbps ?? 128}k`, '-ar', '44100', '-ac', '2',
    /* The clock the muxer stamps with. Without it a stream whose source
       pauses for a moment carries the gap forward for ever. */
    '-fflags', '+genpts',
    '-f', 'flv',
  ];
}

export function startStream(o: StreamOptions): { ok: boolean; error?: string } {
  if (proc) return { ok: false, error: 'A stream is already running.' };

  const ff = ffmpeg();
  if (!ff) return { ok: false, error: 'ffmpeg is not installed, so TeminaliCut cannot encode a stream.' };
  if (!/^rtmps?:\/\//i.test(o.url)) {
    return { ok: false, error: 'That is not an RTMP address. It should begin rtmp:// or rtmps://.' };
  }

  framesIn = 0;
  bytesIn = 0;
  dropped = 0;
  stderrTail = '';
  startedAt = Date.now();

  /*
    The input is whatever the renderer's MediaRecorder produces, which is
    a fragmented WebM/Matroska byte stream. It is given to ffmpeg as a
    pipe rather than a file precisely so nothing has to be finished
    before it can be sent.
  */
  const args = [
    '-hide_banner', '-loglevel', 'warning',
    '-f', 'webm', '-i', 'pipe:0',
    ...encoderArgs({ ...o, width: o.width, height: o.height, fps: o.fps }),
    o.url,
  ];

  log.info('[stream] starting', redact(o.url), `${o.width}x${o.height}@${o.fps}`);
  publish({ state: 'connecting', url: redact(o.url) });

  const child = spawn(ff, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  proc = child;

  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-4000);
    /* ffmpeg reports what it had to throw away. A stream that is quietly
       dropping frames looks fine here and stutters for the viewer. */
    const drop = /drop=(\d+)/.exec(chunk);
    if (drop) dropped = Number(drop[1]);
  });

  child.on('error', (err) => {
    proc = null;
    publish({ state: 'error', message: err.message });
  });

  child.on('close', (code) => {
    proc = null;
    if (code === 0) {
      publish({ state: 'ended', reason: 'The stream was stopped.' });
      return;
    }
    /*
      The tail rather than the whole log: ffmpeg is chatty and the last
      line is the one that says what happened. The stream key is never
      in stderr, but the URL is, so it is redacted on the way out.
    */
    const line = stderrTail.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
    publish({
      state: 'error',
      message: line.replace(/rtmps?:\/\/\S+/gi, (m) => redact(m)) || `ffmpeg exited ${code}`,
    });
  });

  /*
    A broken pipe is normal on stop and must not crash main: the renderer
    can still have a chunk in flight when ffmpeg has already gone.
  */
  child.stdin?.on('error', () => { /* ffmpeg went away; `close` reports it */ });

  return { ok: true };
}

/**
 * One encoded chunk from the renderer.
 *
 * Returns whether the pipe accepted it without buffering. False means
 * ffmpeg is not draining as fast as the renderer is producing, which is
 * the signal to stop compositing new frames rather than to queue more.
 */
export function pushChunk(data: Uint8Array): boolean {
  if (!proc?.stdin || proc.stdin.destroyed) return false;

  framesIn += 1;
  bytesIn += data.byteLength;

  if (state.state === 'connecting') {
    publish({ state: 'live', url: state.url, sinceMs: startedAt, framesIn, bytesIn, droppedFrames: dropped });
  } else if (state.state === 'live' && framesIn % 25 === 0) {
    publish({ ...state, framesIn, bytesIn, droppedFrames: dropped });
  }

  return proc.stdin.write(Buffer.from(data));
}

export function stopStream(): void {
  if (!proc) return;
  const child = proc;
  /*
    End the pipe and let ffmpeg finish the file it is muxing. Killing it
    outright leaves the ingest waiting for a close it never gets, and
    some servers hold the session open for a minute afterwards.
  */
  try { child.stdin?.end(); } catch { /* already closed */ }
  setTimeout(() => { if (!child.killed) child.kill('SIGINT'); }, 1500);
  setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 6000);
}

export function streamState(): StreamState {
  return state;
}

export function initStreamer(): void {
  ipcMain.handle('stream:start', (_e, o: StreamOptions) => startStream(o));
  ipcMain.handle('stream:stop', () => { stopStream(); return { ok: true }; });
  ipcMain.handle('stream:state', () => state);
  ipcMain.handle('stream:bitrate', (_e, p: { height: number; fps: number }) =>
    recommendedBitrateKbps(p.height, p.fps));
  /*
    `on`, not `handle`. A frame is fire-and-forget: waiting for main to
    answer every chunk would put an IPC round trip in the capture loop.
  */
  ipcMain.on('stream:chunk', (_e, data: Uint8Array) => { pushChunk(data); });
}
