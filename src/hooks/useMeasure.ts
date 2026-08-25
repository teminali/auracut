import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export interface Size {
  width: number;
  height: number;
}

/**
 * Track an element's content-box size via ResizeObserver.
 * Returns a ref to attach and the live size (0×0 until first measurement).
 */
export function useMeasure<T extends HTMLElement = HTMLDivElement>(): [
  React.RefObject<T | null>,
  Size,
] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = (width: number, height: number) => {
      setSize((prev) =>
        Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5
          ? prev
          : { width, height }
      );
    };

    update(el.clientWidth, el.clientHeight);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const box = entry.contentRect;
      update(box.width, box.height);
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}

/**
 * Imperative pointer-drag helper.
 *
 * Captures the pointer, streams deltas, and guarantees the `onEnd` callback
 * fires exactly once — including when the drag is cancelled with Escape.
 */
export interface DragHandlers {
  onStart?: (e: React.PointerEvent) => void;
  onMove: (delta: { dx: number; dy: number }, e: PointerEvent) => void;
  onEnd?: (cancelled: boolean) => void;
  cursor?: string;
}

export function useDrag({ onStart, onMove, onEnd, cursor }: DragHandlers) {
  const stateRef = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false });

  return useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      stateRef.current = { x: e.clientX, y: e.clientY, active: true };
      onStart?.(e);

      const prevCursor = document.body.style.cursor;
      if (cursor) document.body.style.cursor = cursor;

      const handleMove = (ev: PointerEvent) => {
        if (!stateRef.current.active) return;
        onMove({ dx: ev.clientX - stateRef.current.x, dy: ev.clientY - stateRef.current.y }, ev);
      };

      const finish = (cancelled: boolean) => {
        if (!stateRef.current.active) return;
        stateRef.current.active = false;
        document.body.style.cursor = prevCursor;
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('pointercancel', handleCancel);
        window.removeEventListener('keydown', handleKey);
        onEnd?.(cancelled);
      };

      const handleUp = () => finish(false);
      const handleCancel = () => finish(true);
      const handleKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') finish(true);
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('pointercancel', handleCancel);
      window.addEventListener('keydown', handleKey);
    },
    [onStart, onMove, onEnd, cursor]
  );
}
