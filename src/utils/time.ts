/** Timecode + duration formatting shared across the editor. */

const pad = (n: number, width = 2): string => Math.abs(Math.floor(n)).toString().padStart(width, '0');

/** `HH:MM:SS:FF` — the canonical broadcast timecode. */
export function formatTimecode(ms: number, fps = 30): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const frames = Math.floor((clamped % 1000) / (1000 / fps));
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}:${pad(frames)}`;
}

/** `MM:SS:FF` — compact readout for tight UI. */
export function formatShortTimecode(ms: number, fps = 30): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const frames = Math.floor((clamped % 1000) / (1000 / fps));
  return `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}:${pad(frames)}`;
}

/** `M:SS` — human duration, e.g. for asset cards. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(Math.max(0, ms) / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}:${pad(s)}` : `0:${pad(s)}`;
}

/** `4.5s` / `1.2m` — terse label for clip badges. */
export function formatCompactDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

/** Round a millisecond value to the nearest whole frame. */
export function snapToFrame(ms: number, fps = 30): number {
  const frameMs = 1000 / fps;
  return Math.round(ms / frameMs) * frameMs;
}

/** Parse `MM:SS`, `HH:MM:SS` or `HH:MM:SS:FF` back into milliseconds. */
export function parseTimecodeInput(input: string, fps = 30): number | null {
  const parts = input.trim().split(':').map((p) => parseInt(p, 10));
  if (parts.some(Number.isNaN)) return null;

  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  if (parts.length === 4) {
    return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000 + (parts[3] * 1000) / fps;
  }
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
