import { describe, it, expect } from 'vitest';
import { pickHardwareEncoder, parseEncoders } from './hardwareEncoder';

/* A trimmed but real-shaped `ffmpeg -encoders` listing. */
const WINDOWS_NVIDIA = `
Encoders:
 V..... = Video
 ------
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder
 V....D h264_qsv             H.264 QSV encoder
 V....D hevc_nvenc           NVIDIA NVENC hevc encoder
 A....D aac                  AAC (Advanced Audio Coding)
`;

const WINDOWS_NO_GPU = `
Encoders:
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC
 V....D libx265              libx265 H.265 / HEVC
`;

const MAC = `
Encoders:
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC
 V....D h264_videotoolbox    VideoToolbox H.264 Encoder
 V....D hevc_videotoolbox    VideoToolbox H.265 Encoder
`;

describe('parseEncoders', () => {
  it('reads encoder names and ignores the header', () => {
    const names = parseEncoders(WINDOWS_NVIDIA);
    expect(names.has('h264_nvenc')).toBe(true);
    expect(names.has('libx264')).toBe(true);
    expect(names.has('aac')).toBe(true);
    expect(names.has('Encoders:')).toBe(false);
  });
});

describe('pickHardwareEncoder', () => {
  /*
    The regression this file exists for. `hardware` defaults to on, and
    the encoder used to be hard-coded to VideoToolbox, so a Windows
    export asked for an encoder that ffmpeg does not have and the render
    died with `Unknown encoder`.
  */
  it('never names VideoToolbox on Windows', () => {
    const have = parseEncoders(WINDOWS_NVIDIA);
    expect(pickHardwareEncoder('h264', 'win32', have)).not.toContain('videotoolbox');
    expect(pickHardwareEncoder('hevc', 'win32', have)).not.toContain('videotoolbox');
  });

  it('prefers NVENC on Windows when it is present', () => {
    const have = parseEncoders(WINDOWS_NVIDIA);
    expect(pickHardwareEncoder('h264', 'win32', have)).toBe('h264_nvenc');
    expect(pickHardwareEncoder('hevc', 'win32', have)).toBe('hevc_nvenc');
  });

  it('falls back to the next candidate when the best is absent', () => {
    const have = new Set(['h264_qsv', 'h264_amf']);
    expect(pickHardwareEncoder('h264', 'win32', have)).toBe('h264_qsv');
  });

  it('returns null on Windows with no GPU encoder, so the caller uses software', () => {
    const have = parseEncoders(WINDOWS_NO_GPU);
    expect(pickHardwareEncoder('h264', 'win32', have)).toBeNull();
    expect(pickHardwareEncoder('hevc', 'win32', have)).toBeNull();
  });

  it('still picks VideoToolbox on macOS', () => {
    const have = parseEncoders(MAC);
    expect(pickHardwareEncoder('h264', 'darwin', have)).toBe('h264_videotoolbox');
    expect(pickHardwareEncoder('hevc', 'darwin', have)).toBe('hevc_videotoolbox');
  });

  it('returns null on a platform with no candidate table rather than guessing', () => {
    const have = new Set(['h264_vaapi', 'h264_nvenc']);
    expect(pickHardwareEncoder('h264', 'linux', have)).toBeNull();
  });

  it('does not claim an encoder ffmpeg lacks, even on macOS', () => {
    expect(pickHardwareEncoder('h264', 'darwin', new Set(['libx264']))).toBeNull();
  });
});
