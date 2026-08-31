/* ═══════════════════════════════════════════════════════════════════
   Notification sound & feedback synthesizer for FrontierCut.

   Generates a polished, harmonic completion chime via Web Audio API.
   Zero external asset dependencies, zero network requests, instant playback.
   ═══════════════════════════════════════════════════════════════════ */

let audioCtx: AudioContext | null = null;

function getSharedContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) {
      audioCtx = new Ctor();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Play a soothing, crystal-clear success chime when a render/export completes.
 */
export function playCompletionChime(): void {
  try {
    const ctx = getSharedContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.35, now);
    masterGain.connect(ctx.destination);

    // Filter to warm the chime
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, now);
    filter.connect(masterGain);

    // Note 1: E5 (659.25 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.exponentialRampToValueAtTime(0.45, now + 0.03);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc1.connect(gain1);
    gain1.connect(filter);
    osc1.start(now);
    osc1.stop(now + 0.58);

    // Note 2: B5 (987.77 Hz) - enters at +0.08s
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(987.77, now + 0.08);
    gain2.gain.setValueAtTime(0.001, now);
    gain2.gain.setValueAtTime(0.001, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.55, now + 0.11);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
    osc2.connect(gain2);
    gain2.connect(filter);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.88);

    // Note 3: E6 (1318.51 Hz) - high overtone sparkle at +0.15s
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(1318.51, now + 0.15);
    gain3.gain.setValueAtTime(0.001, now);
    gain3.gain.setValueAtTime(0.001, now + 0.15);
    gain3.gain.exponentialRampToValueAtTime(0.28, now + 0.18);
    gain3.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    osc3.connect(gain3);
    gain3.connect(filter);
    osc3.start(now + 0.15);
    osc3.stop(now + 1.15);
  } catch (err) {
    // Non-critical audio playback fallback
  }
}

/**
 * Trigger an OS-level desktop notification with optional chime.
 */
export function notifyExportComplete(title: string, body: string): void {
  playCompletionChime();

  if (typeof window !== 'undefined' && 'Notification' in window) {
    try {
      if (Notification.permission === 'granted') {
        new Notification(title, { body, silent: true });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then((perm) => {
          if (perm === 'granted') {
            new Notification(title, { body, silent: true });
          }
        }).catch(() => {});
      }
    } catch {
      // Ignore notification failures on restricted runtimes
    }
  }
}
