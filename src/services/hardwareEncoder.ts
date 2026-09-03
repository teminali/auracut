/*
  Which hardware video encoder to ask ffmpeg for.

  VideoToolbox is macOS only. Naming `h264_videotoolbox` on Windows is not
  a slower encode, it is `Unknown encoder` and the run dies — and hardware
  encoding is on by default, so every export and every stream started off
  a Mac build failed there outright.

  The decision is pure so it can be tested without an ffmpeg or a Windows
  machine: the caller probes the binary and passes in what it actually has.
*/

export type HwCodec = 'h264' | 'hevc';

/*
  Ordered best-first. On Windows NVENC beats QSV beats AMF for both
  quality and availability. VAAPI needs a render node passed as a device
  argument, which the call sites do not have, so Linux stays on software
  rather than guessing `/dev/dri/renderD128`.
*/
export const HW_CANDIDATES: Record<string, Record<HwCodec, string[]>> = {
  darwin: {
    h264: ['h264_videotoolbox'],
    hevc: ['hevc_videotoolbox'],
  },
  win32: {
    h264: ['h264_nvenc', 'h264_qsv', 'h264_amf'],
    hevc: ['hevc_nvenc', 'hevc_qsv', 'hevc_amf'],
  },
};

/**
 * The best hardware encoder for `codec` that this ffmpeg actually has, or
 * `null` when there is none and the caller should encode in software.
 */
export function pickHardwareEncoder(
  codec: HwCodec,
  platform: string,
  available: ReadonlySet<string>
): string | null {
  const candidates = HW_CANDIDATES[platform]?.[codec] ?? [];
  return candidates.find((name) => available.has(name)) ?? null;
}

/**
 * Parse the encoder names out of `ffmpeg -encoders`. Lines look like
 * ` V....D h264_nvenc           NVIDIA NVENC H.264 encoder`.
 */
export function parseEncoders(stdout: string): Set<string> {
  const names = new Set<string>();
  for (const line of stdout.split('\n')) {
    const m = /^\s*[A-Z.]{6}\s+(\S+)/.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}
