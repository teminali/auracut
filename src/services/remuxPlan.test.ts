import { describe, it, expect } from 'vitest';
import { canStreamCopy, videoCodecFromFfmpeg } from './remuxPlan';

describe('canStreamCopy', () => {
  it('copies an H.264 take that asked to be copied', () => {
    expect(canStreamCopy(true, 'h264')).toBe(true);
  });

  it('re-encodes when the file is VP8 even though H.264 was requested', () => {
    /* The whole reason this function exists: isTypeSupported said yes
       and the platform encoder handed back something else. */
    expect(canStreamCopy(true, 'vp8')).toBe(false);
    expect(canStreamCopy(true, 'vp9')).toBe(false);
  });

  it('re-encodes when the codec could not be read', () => {
    expect(canStreamCopy(true, null)).toBe(false);
  });

  it('never copies when the mime was not a copyable one', () => {
    expect(canStreamCopy(false, 'h264')).toBe(false);
  });

  it('is not case or whitespace sensitive', () => {
    expect(canStreamCopy(true, ' H264 ')).toBe(true);
  });

  it('takes hevc and av1, which an MP4 also has tags for', () => {
    expect(canStreamCopy(true, 'hevc')).toBe(true);
    expect(canStreamCopy(true, 'av1')).toBe(true);
  });
});

describe('videoCodecFromFfmpeg', () => {
  it('reads the codec out of a real stream table', () => {
    const stderr = [
      "Input #0, matroska,webm, from 'screen.webm':",
      '  Duration: N/A, start: 0.000000, bitrate: N/A',
      '  Stream #0:0(eng): Audio: opus, 48000 Hz, mono, fltp',
      '  Stream #0:1(eng): Video: h264 (High), yuv420p(progressive), 1918x1246, 60 fps',
      'At least one output file must be specified',
    ].join('\n');
    expect(videoCodecFromFfmpeg(stderr)).toBe('h264');
  });

  it('reads a VP9 take, which is the case that must not be copied', () => {
    const stderr = '  Stream #0:0: Video: vp9 (Profile 0), yuv420p(tv), 1920x1080, SAR 1:1 DAR 16:9';
    expect(videoCodecFromFfmpeg(stderr)).toBe('vp9');
    expect(canStreamCopy(true, videoCodecFromFfmpeg(stderr))).toBe(false);
  });

  it('is null when there is no video stream at all', () => {
    expect(videoCodecFromFfmpeg('  Stream #0:0: Audio: opus, 48000 Hz')).toBeNull();
  });

  it('is null on empty output rather than throwing', () => {
    expect(videoCodecFromFfmpeg('')).toBeNull();
  });
});
