/* ═══════════════════════════════════════════════════════════════════
   Frame encoding — the export's hot loop.

   The export used to hand every frame to ffmpeg as a JPEG:

       canvas -> toBlob('image/jpeg') -> IPC -> ffmpeg image2pipe -> libx264

   which pays for the same picture three times. The canvas is read back
   off the GPU, compressed to JPEG, copied across the bridge, decoded by
   ffmpeg, and encoded AGAIN to h264. The profile in HANDOVER said as
   much — 13,435ms of a 14,786ms render was `toBlob`, and removing
   `willReadFrequently` only took it to 4,883ms because the readback is
   the cost, not the compression. `NEXT.md` §7 closes with the same
   sentence twice: real encoding needs OffscreenCanvas in workers, or
   WebCodecs.

   This is the WebCodecs half.

       canvas -> VideoFrame -> VideoEncoder (VideoToolbox) -> h264 -> ffmpeg -c:v copy

   Three properties matter more than the speed:

     1. NOTHING IS RE-ENCODED. ffmpeg stream-copies what arrives, so the
        picture that leaves the encoder is the picture in the file.
     2. IT IS ASYNCHRONOUS. `encode()` returns immediately and the
        hardware works while the renderer seeks and composites the next
        frame. The old loop awaited a round trip per frame and did
        nothing else while it waited.
     3. IT FALLS BACK. `create()` returns null when WebCodecs is missing,
        the codec is unsupported, or the config is refused — and the
        caller keeps its JPEG path. ProRes has no WebCodecs equivalent
        and always takes the old road.

   Backpressure is real, not decorative: an unbounded encoder queue at
   4K is gigabytes of VideoFrames, and unbounded pending chunks are the
   same bytes again on the bridge. Both are capped.
   ═══════════════════════════════════════════════════════════════════ */

/** What the container on the other side has to be told it is receiving. */
export type FrameFormat = 'jpeg' | 'h264' | 'hevc';

export interface FrameEncoderOptions {
  width: number;
  height: number;
  fps: number;
  codec: 'h264' | 'hevc' | 'prores';
  /** Megabits per second. Defaults by resolution when absent. */
  bitrateMbps?: number;
  /** Prefer the platform encoder. False asks for the software one. */
  hardware?: boolean;
  /**
   * Where finished bytes go. Called with a concatenated run of chunks,
   * and the number of frames they represent, so the far side can keep
   * an honest frame count without parsing the stream.
   */
  sink: (bytes: Uint8Array, frames: number) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * A sane bitrate when the caller has no opinion.
 *
 * The 2D path's default is `-crf 18`, which is quality-targeted and has
 * no bitrate to copy. These are the numbers the existing VideoToolbox
 * branch in `electron/render.ts` already uses, scaled by pixel count so
 * a 720p render is not given a 4K allowance.
 */
function defaultBitrate(width: number, height: number, fps: number): number {
  const pixels = width * height;
  /* ~0.1 bits per pixel per frame at 30fps: 12Mbps at 1080p, 40 at 4K,
     which are the two figures the hardware branch was already using. */
  const bits = pixels * fps * 0.105;
  return Math.round(Math.max(2_000_000, Math.min(120_000_000, bits)));
}

/**
 * The codec string WebCodecs wants.
 *
 * `avc1.640028` is High profile level 4.0 — the level ceiling matters:
 * ask for 4.0 at 4K and the encoder refuses the config rather than
 * quietly producing a stream players will choke on, which is why the
 * level is chosen from the frame size instead of hard-coded.
 */
function avcCodecString(width: number, height: number): string {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  // Levels 4.0, 4.2, 5.0, 5.1, 5.2 by macroblock count.
  const level =
    mbs <= 8_192 ? 0x28 :
    mbs <= 8_704 ? 0x2a :
    mbs <= 22_080 ? 0x32 :
    mbs <= 36_864 ? 0x33 : 0x34;
  return `avc1.6400${level.toString(16)}`;
}

export interface FrameEncoder {
  /** What ffmpeg should be told the pipe contains. */
  readonly format: 'h264' | 'hevc';
  /** True once something has gone wrong; `flush` will throw with it. */
  readonly failure: Error | null;
  /**
   * Hand over one composited frame. Returns without waiting for the
   * encoder — await `settle()` when the queue is deep.
   */
  encode(source: CanvasImageSource, frameIndex: number): void;
  /** Wait until the encoder and the bridge have caught up enough to continue. */
  settle(): Promise<void>;
  /** Drain everything and return the total frames encoded. Throws on failure. */
  finish(): Promise<number>;
  /** Tear down without waiting. */
  close(): void;
}

/*
  How deep the queues are allowed to get.

  The encoder holds VideoFrames, which are full uncompressed surfaces —
  8.3MB each at 1080p, 33MB at 4K. Sixteen of them is 133MB at 1080p and
  half a gigabyte at 4K, so the cap scales down as the frame grows.

  The chunk buffer is compressed and tiny by comparison; it exists to
  turn one IPC round trip per frame into one per megabyte. At 12Mbps
  that is roughly every 20 frames.
*/
const CHUNK_FLUSH_BYTES = 1_000_000;

function queueLimit(width: number, height: number): number {
  const megapixels = (width * height) / 1_000_000;
  if (megapixels > 6) return 4;    // 4K
  if (megapixels > 3) return 8;    // 1440p
  return 16;
}

/** A keyframe every two seconds: seekable output, and cheap chunk joins. */
function gopFor(fps: number): number {
  return Math.max(1, Math.round(fps * 2));
}

/** The one place the encoder is described, so probe and build agree. */
function buildConfig(
  options: Omit<FrameEncoderOptions, 'sink'>
): VideoEncoderConfig & { hevc?: { format: 'annexb' } } {
  const { width, height, fps, codec, hardware = true } = options;
  const bitrate = options.bitrateMbps
    ? Math.round(options.bitrateMbps * 1_000_000)
    : defaultBitrate(width, height, fps);

  /*
    `hevc` is cast in rather than declared: the TypeScript DOM lib's
    `VideoEncoderConfig` still has no `hevc` member, though Chromium
    reads it. Dropping the field to satisfy the type would emit
    length-prefixed NALs into a pipe that has nowhere to put the
    description, which is a silent failure rather than a compile error.
  */
  const config = {
    codec: codec === 'hevc' ? 'hev1.1.6.L120.B0' : avcCodecString(width, height),
    width,
    height,
    bitrate,
    framerate: fps,
    /*
      Annex B, because the bytes go into a raw elementary stream that
      ffmpeg reads with `-f h264`. The default (`avc`) emits
      length-prefixed NAL units and a separate `description` in the
      metadata, which a raw pipe has nowhere to put — the stream would
      arrive without SPS/PPS and decode as nothing.
    */
    avc: codec === 'h264' ? { format: 'annexb' } : undefined,
    hevc: codec === 'hevc' ? { format: 'annexb' } : undefined,
    hardwareAcceleration: hardware ? 'prefer-hardware' : 'prefer-software',
    /*
      `realtime`, and this is a correctness choice rather than a speed one.

      A raw Annex B stream carries no timestamps. ffmpeg's h264 demuxer
      numbers the frames in the order they arrive at the rate it is
      given, so the arrival order IS the presentation order — there is
      nowhere for a reordered frame to say when it belongs. `quality`
      permits the encoder to emit B-frames in decode order, which would
      hand ffmpeg a stream it timestamps in the wrong order and copy into
      a file that plays its frames shuffled. It would not fail; it would
      just be wrong, in a way nobody notices until they watch it.

      `realtime` is specified to forbid reordering. The guard in `output`
      below checks the property holds rather than trusting the flag.
    */
    latencyMode: 'realtime',
  } as VideoEncoderConfig & { hevc?: { format: 'annexb' } };

  return config;
}

/**
 * Will this machine encode this, and as what?
 *
 * Separate from `createFrameEncoder` because the render farm has to
 * decide the pipe's format BEFORE any window exists to encode into it —
 * main tells ffmpeg what to expect at the moment the session opens, and
 * a worker that later fell back to a different format would be sending
 * stills into a pipe reading h264. One answer, decided once, in front.
 */
export async function probeFrameFormat(
  options: Omit<FrameEncoderOptions, 'sink'>
): Promise<{ format: 'h264' | 'hevc' } | { format: null; reason: string }> {
  const { width, height, codec } = options;

  if (codec === 'prores') {
    return { format: null, reason: 'ProRes has no WebCodecs encoder; using the ffmpeg path.' };
  }
  const VE = (globalThis as { VideoEncoder?: typeof VideoEncoder }).VideoEncoder;
  if (typeof VE === 'undefined' || typeof VideoFrame === 'undefined') {
    return { format: null, reason: 'WebCodecs is not available in this runtime.' };
  }

  let support: VideoEncoderSupport;
  try {
    support = await VE.isConfigSupported(buildConfig(options));
  } catch (err) {
    return { format: null, reason: `The encoder refused the configuration: ${(err as Error).message}` };
  }
  if (!support.supported) {
    return { format: null, reason: `${codec.toUpperCase()} encoding is not supported at ${width}x${height} here.` };
  }
  return { format: codec === 'hevc' ? 'hevc' : 'h264' };
}

/**
 * Build an encoder, or return null when this machine cannot do it.
 *
 * Never throws. Every refusal — no WebCodecs, no such codec, a config
 * the platform will not take — returns null with a reason, and the
 * caller falls back to the JPEG pipeline it already had.
 */
export async function createFrameEncoder(
  options: FrameEncoderOptions
): Promise<{ encoder: FrameEncoder } | { encoder: null; reason: string }> {
  const { width, height, fps, sink } = options;

  const probe = await probeFrameFormat(options);
  if (probe.format === null) return { encoder: null, reason: probe.reason };
  const format = probe.format;
  const config = buildConfig(options);
  const VE = (globalThis as { VideoEncoder: typeof VideoEncoder }).VideoEncoder;

  /* ── state ─────────────────────────────────────────────────────── */

  let failure: Error | null = null;
  let framesIn = 0;
  let framesOut = 0;
  /** Frames represented by the bytes currently sitting in `pending`. */
  let pendingFrames = 0;
  let pendingBytes = 0;
  const pending: Uint8Array[] = [];
  /** The write in flight, so two flushes cannot interleave on the pipe. */
  let writing: Promise<void> = Promise.resolve();

  const flushPending = (): Promise<void> => {
    if (pendingBytes === 0) return writing;
    const total = new Uint8Array(pendingBytes);
    let at = 0;
    for (const part of pending) { total.set(part, at); at += part.length; }
    const frames = pendingFrames;
    pending.length = 0;
    pendingBytes = 0;
    pendingFrames = 0;

    writing = writing.then(async () => {
      if (failure) return;
      const result = await sink(total, frames);
      if (!result.ok) failure = new Error(result.error ?? 'The encoder stopped accepting frames.');
    });
    return writing;
  };

  /** The last timestamp seen, to catch reordering the config forbids. */
  let lastTimestamp = -1;

  const encoder = new VE({
    output: (chunk) => {
      /*
        Trust the flag, verify the stream. If a chunk ever arrives out of
        order the raw pipe cannot represent it, so the render has to stop
        rather than write a scrambled file that plays.
      */
      if (chunk.timestamp <= lastTimestamp) {
        failure = new Error(
          'The encoder reordered its output, which a raw stream cannot carry. ' +
          'Export again with the ffmpeg encoder.'
        );
        return;
      }
      lastTimestamp = chunk.timestamp;

      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      pending.push(bytes);
      pendingBytes += bytes.length;
      pendingFrames += 1;
      framesOut += 1;
      if (pendingBytes >= CHUNK_FLUSH_BYTES) void flushPending();
    },
    error: (err) => { failure = err instanceof Error ? err : new Error(String(err)); },
  });

  encoder.configure(config);

  const maxQueue = queueLimit(width, height);
  const gop = gopFor(fps);
  const microsPerFrame = 1_000_000 / fps;

  const api: FrameEncoder = {
    format,
    get failure() { return failure; },

    encode(source, frameIndex) {
      if (failure) return;
      /*
        The timestamp is the frame's own position, not wall clock. ffmpeg
        is told the rate on the input side and stream-copies, so these
        only have to be monotonic and evenly spaced — but they have to be
        BOTH, and deriving them from the index is the only way that holds
        when a frame takes longer than its duration to composite.
      */
      const frame = new VideoFrame(source, {
        timestamp: Math.round(frameIndex * microsPerFrame),
        duration: Math.round(microsPerFrame),
      });
      try {
        encoder.encode(frame, { keyFrame: frameIndex % gop === 0 });
        framesIn += 1;
      } finally {
        /* Closed immediately: the encoder has taken its own reference,
           and a VideoFrame that is not closed holds a GPU surface until
           the garbage collector gets round to it — which at 4K is how a
           render ends as an out-of-memory crash rather than a file. */
        frame.close();
      }
    },

    async settle() {
      if (failure) throw failure;
      /* Two independent backlogs, and waiting on the wrong one is the
         same as not waiting at all. */
      while (encoder.encodeQueueSize > maxQueue && !failure) {
        await new Promise<void>((r) => { setTimeout(r, 1); });
      }
      if (pendingBytes >= CHUNK_FLUSH_BYTES) await flushPending();
      else await writing;
      if (failure) throw failure;
    },

    async finish() {
      if (failure) throw failure;
      await encoder.flush();
      await flushPending();
      await writing;
      if (failure) throw failure;
      /*
        A frame that went in and never came out is a frame missing from
        the file, and the file would still play — just short, and out of
        step with the audio from the point of the loss onward. Cheap to
        check, and impossible to notice otherwise.
      */
      if (framesOut !== framesIn) {
        throw new Error(`The encoder returned ${framesOut} of ${framesIn} frames.`);
      }
      encoder.close();
      return framesOut;
    },

    close() {
      try { if (encoder.state !== 'closed') encoder.close(); } catch { /* already gone */ }
    },
  };

  return { encoder: api };
}
