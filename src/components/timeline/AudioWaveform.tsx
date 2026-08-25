import React, { useMemo } from 'react';

interface AudioWaveformProps {
  width: number;
  height: number;
  color?: string;
  /** Stable string so the same clip always draws the same shape. */
  seed?: string;
  peaks?: number[];
}

/** Deterministic PRNG so a clip's waveform never changes between renders. */
function hashSeed(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Symmetrical peak envelope with an inner RMS body.
 *
 * Drawing peak and RMS as two shapes is what makes a waveform read as
 * audio rather than as a bar chart: the outline carries transients, the
 * solid core carries loudness, and you can judge both at a glance.
 */
export const AudioWaveform: React.FC<AudioWaveformProps> = ({
  width, height, color = '#7ce8bb', seed = 'wave', peaks,
}) => {
  const STEP = 2;
  const barCount = Math.max(2, Math.floor(width / STEP));

  const bars = useMemo(() => {
    if (peaks && peaks.length > 0) {
      const out: number[] = [];
      const stride = peaks.length / barCount;
      for (let i = 0; i < barCount; i++) {
        const start = Math.floor(i * stride);
        const end = Math.max(start + 1, Math.floor((i + 1) * stride));
        let max = 0;
        for (let j = start; j < end && j < peaks.length; j++) max = Math.max(max, peaks[j]);
        out.push(max);
      }
      return out;
    }

    const rand = hashSeed(seed);
    const out: number[] = [];
    let envelope = 0.55;
    for (let i = 0; i < barCount; i++) {
      // Slow-moving envelope + rare transients reads like real programme audio.
      envelope += (rand() - 0.5) * 0.16;
      envelope = Math.max(0.22, Math.min(0.95, envelope));
      const transient = rand() > 0.93 ? rand() * 0.4 : 0;
      out.push(Math.min(1, envelope * (0.6 + rand() * 0.4) + transient));
    }
    return out;
  }, [barCount, seed, peaks]);

  /* Build the peak outline and the RMS core as mirrored polygons. */
  const { peakPath, rmsPath } = useMemo(() => {
    const mid = height / 2;
    const amp = height * 0.46;
    const top: string[] = [];
    const bottom: string[] = [];
    const rmsTop: string[] = [];
    const rmsBottom: string[] = [];

    for (let i = 0; i < bars.length; i++) {
      const x = (i * STEP).toFixed(1);
      const v = bars[i];
      // RMS trails the peak — roughly 0.62× is what real programme audio shows.
      const r = v * 0.62;
      top.push(`${x},${(mid - v * amp).toFixed(1)}`);
      bottom.push(`${x},${(mid + v * amp).toFixed(1)}`);
      rmsTop.push(`${x},${(mid - r * amp).toFixed(1)}`);
      rmsBottom.push(`${x},${(mid + r * amp).toFixed(1)}`);
    }

    return {
      peakPath: [...top, ...bottom.reverse()].join(' '),
      rmsPath: [...rmsTop, ...rmsBottom.reverse()].join(' '),
    };
  }, [bars, height]);

  if (width < 4 || height < 4) return null;

  const mid = height / 2;

  return (
    <svg width={width} height={height} className="block" preserveAspectRatio="none">
      <polygon points={peakPath} fill={color} fillOpacity={0.34} />
      <polygon points={rmsPath} fill={color} fillOpacity={0.85} />
      <line x1={0} y1={mid} x2={width} y2={mid} stroke={color} strokeOpacity={0.5} strokeWidth={0.5} />
    </svg>
  );
};
