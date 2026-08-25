import { useEffect, useRef } from 'react';

/**
 * requestAnimationFrame loop whose callback is always the latest one without
 * ever tearing down the loop. Passing a fresh arrow function each render is
 * safe — the loop keeps running and simply calls the newest version.
 */
export function useRafLoop(callback: (deltaMs: number, now: number) => void, active = true): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!active) return;

    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      // Clamp the delta so a backgrounded tab doesn't jump the playhead.
      const delta = Math.min(100, now - last);
      last = now;
      callbackRef.current(delta, now);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);
}
