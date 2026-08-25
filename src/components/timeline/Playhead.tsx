import React, { useCallback } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useProjectStore } from '../../store/projectStore';

interface PlayheadProps {
  pxPerMs: number;
  height: number;
}

/** Shared drag: converts pointer X within `parent` into a playhead time. */
function usePlayheadDrag(pxPerMs: number) {
  const setPlayheadMs = useTimelineStore((s) => s.setPlayheadMs);
  const durationMs = useProjectStore((s) => s.project.durationMs);

  return useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();

      const parent = (e.currentTarget as HTMLElement).parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();

      const move = (ev: PointerEvent) => {
        setPlayheadMs(Math.max(0, Math.min(durationMs, (ev.clientX - rect.left) / pxPerMs)));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.classList.remove('dragging-h');
      };

      document.body.classList.add('dragging-h');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [pxPerMs, durationMs, setPlayheadMs]
  );
}

/**
 * The grab handle, drawn in the ruler.
 *
 * A bare 1px needle is precise but almost impossible to grab. Giving the
 * playhead a visible head in the ruler — the way every hardware transport
 * and every professional NLE does — makes it a target, and tells you which
 * of the several vertical lines on the timeline is the one you can move.
 */
export const PlayheadHead: React.FC<{ pxPerMs: number; height: number }> = ({ pxPerMs, height }) => {
  const playheadMs = useTimelineStore((s) => s.playheadMs);
  const onDown = usePlayheadDrag(pxPerMs);

  return (
    <div
      onPointerDown={onDown}
      style={{ transform: `translateX(${playheadMs * pxPerMs}px)`, height }}
      className="absolute top-0 left-0 z-40 w-0 cursor-ew-resize"
    >
      <div className="absolute top-0 bottom-0 -left-3 w-6" />
      <svg
        viewBox="0 0 14 16"
        className="absolute -left-[7px] top-0 w-[14px] h-4 drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]"
      >
        <path d="M0 0h14v9l-7 7-7-7z" fill="#4a90ff" />
      </svg>
      <div className="absolute top-0 bottom-0 left-0 w-px bg-spectrum-accent" />
    </div>
  );
};

/** The needle through the lanes. */
export const Playhead: React.FC<PlayheadProps> = ({ pxPerMs, height }) => {
  const playheadMs = useTimelineStore((s) => s.playheadMs);
  const onDown = usePlayheadDrag(pxPerMs);

  return (
    <div
      onPointerDown={onDown}
      style={{ transform: `translateX(${playheadMs * pxPerMs}px)`, height }}
      className="absolute top-0 z-40 w-0 cursor-ew-resize"
    >
      {/* Wider invisible grab strip than the visible needle */}
      <div className="absolute top-0 bottom-0 -left-2 w-4" />
      <div className="absolute top-0 bottom-0 left-0 w-px bg-spectrum-accent shadow-[0_0_4px_rgba(74,144,255,0.8)]" />
    </div>
  );
};
