import React, { useMemo, useCallback } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useProjectStore } from '../../store/projectStore';

interface TimelineRulerProps {
  pxPerMs: number;
  durationMs: number;
  height: number;
}

/** Tick ladder — pick the first step that keeps labels ≥64px apart. */
const TICK_STEPS_MS = [
  100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000,
  60_000, 120_000, 300_000, 600_000,
];

function pickStep(pxPerMs: number): { major: number; minor: number } {
  const major = TICK_STEPS_MS.find((s) => s * pxPerMs >= 64) ?? TICK_STEPS_MS[TICK_STEPS_MS.length - 1];
  const idx = TICK_STEPS_MS.indexOf(major);
  const minor = idx > 0 ? TICK_STEPS_MS[idx - 1] : major / 2;
  return { major, minor };
}

function labelFor(ms: number, majorStep: number): string {
  const totalSeconds = ms / 1000;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  // Sub-second steps need a decimal to stay distinguishable.
  if (majorStep < 1000) return `${m}:${s.toFixed(1).padStart(4, '0')}`;
  return `${m}:${Math.floor(s).toString().padStart(2, '0')}`;
}

export const TimelineRuler: React.FC<TimelineRulerProps> = ({ pxPerMs, durationMs, height }) => {
  const setPlayheadMs = useTimelineStore((s) => s.setPlayheadMs);
  const setInPoint = useTimelineStore((s) => s.setInPoint);
  const setOutPoint = useTimelineStore((s) => s.setOutPoint);
  const project = useProjectStore((s) => s.project);

  const { major, minor } = useMemo(() => pickStep(pxPerMs), [pxPerMs]);

  // Draw a bit past the project end so the ruler never stops mid-scroll.
  const spanMs = durationMs + major * 2;

  const majorTicks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= spanMs; t += major) out.push(t);
    return out;
  }, [spanMs, major]);

  const minorTicks = useMemo(() => {
    if (minor * pxPerMs < 7) return [];
    const out: number[] = [];
    for (let t = 0; t <= spanMs; t += minor) {
      if (t % major !== 0) out.push(t);
    }
    return out;
  }, [spanMs, minor, major, pxPerMs]);

  const scrub = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const rect = e.currentTarget.getBoundingClientRect();

      const apply = (clientX: number) => {
        setPlayheadMs(Math.max(0, Math.min(durationMs, (clientX - rect.left) / pxPerMs)));
      };
      apply(e.clientX);

      const move = (ev: PointerEvent) => apply(ev.clientX);
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [pxPerMs, durationMs, setPlayheadMs]
  );

  return (
    <div
      onPointerDown={scrub}
      onDoubleClick={(e) => {
        // Double-click marks an in point; ⌥ double-click marks the out point.
        const rect = e.currentTarget.getBoundingClientRect();
        const ms = Math.max(0, (e.clientX - rect.left) / pxPerMs);
        if (e.altKey) setOutPoint(Math.round(ms));
        else setInPoint(Math.round(ms));
      }}
      style={{ height }}
      className="relative cursor-ew-resize bg-spectrum-panelHeader select-none"
      title="Drag to scrub · double-click sets in point · ⌥ double-click sets out point"
    >
      {/*
        Three tick weights — minor, major, and the labelled major — give the
        eye a ladder to read position against. A single tick weight is why
        most timelines feel hard to judge distance on.
      */}
      {minorTicks.map((t) => (
        <div
          key={`m${t}`}
          className="absolute bottom-0 w-px bg-white/[0.08]"
          style={{ left: t * pxPerMs, height: 5 }}
        />
      ))}

      {majorTicks.map((t) => (
        <div key={`M${t}`} className="absolute bottom-0 top-0 pointer-events-none" style={{ left: t * pxPerMs }}>
          <div className="absolute bottom-0 w-px bg-white/[0.22]" style={{ height: 9 }} />
          <span className="absolute top-[4px] left-[5px] text-[9px] font-mono font-medium text-spectrum-textDim tabular whitespace-nowrap tracking-tight">
            {labelFor(t, major)}
          </span>
        </div>
      ))}

      {/* Everything past the sequence end is out of bounds, and looks it. */}
      <div
        className="absolute top-0 bottom-0 right-0 bg-black/35 pointer-events-none"
        style={{ left: durationMs * pxPerMs }}
      />
      <div
        className="absolute top-0 bottom-0 w-px bg-spectrum-red/45 pointer-events-none"
        style={{ left: durationMs * pxPerMs }}
        title={`Sequence end · ${(durationMs / 1000).toFixed(1)}s`}
      />

      {/* Seats the ruler on the lanes below it. */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-line" />
    </div>
  );
};
