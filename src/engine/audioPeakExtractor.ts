/* Waveform peak extraction for timeline clip rendering. */

const peakCache = new Map<string, number[]>();
const pending = new Map<string, Promise<number[]>>();

let ctx: AudioContext | null = null;

function audioContext(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) throw new Error('Web Audio is not available');
    ctx = new Ctor();
  }
  return ctx;
}

/**
 * Normalised peak buckets (0..1) for a media URL.
 * Cached, and de-duplicated so simultaneous callers share one decode.
 */
export async function extractPeaks(url: string, buckets = 800): Promise<number[]> {
  const key = `${url}#${buckets}`;
  const cached = peakCache.get(key);
  if (cached) return cached;

  const inflight = pending.get(key);
  if (inflight) return inflight;

  const job = (async () => {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) throw new Error(`Could not load audio (${response.status})`);

    const decoded = await audioContext().decodeAudioData(await response.arrayBuffer());
    const channel = decoded.getChannelData(0);
    const stride = channel.length / buckets;

    const peaks: number[] = new Array(buckets);
    let globalMax = 0;

    for (let i = 0; i < buckets; i++) {
      const start = Math.floor(i * stride);
      const end = Math.min(channel.length, Math.floor((i + 1) * stride));
      let peak = 0;
      for (let j = start; j < end; j++) {
        const v = Math.abs(channel[j]);
        if (v > peak) peak = v;
      }
      peaks[i] = peak;
      if (peak > globalMax) globalMax = peak;
    }

    // Normalise so quiet files still render a legible waveform.
    if (globalMax > 0) {
      for (let i = 0; i < buckets; i++) peaks[i] /= globalMax;
    }

    peakCache.set(key, peaks);
    pending.delete(key);
    return peaks;
  })();

  pending.set(key, job);
  job.catch(() => pending.delete(key));
  return job;
}

export function getCachedPeaks(url: string, buckets = 800): number[] | null {
  return peakCache.get(`${url}#${buckets}`) ?? null;
}
