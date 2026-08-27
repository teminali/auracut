/* Speed ramping with a draggable curve editor. */

import React, { useCallback, useMemo, useRef } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { Clip, SpeedCurvePreset, SpeedCurvePoint } from '../../types/edl';
import { resolveSpeedPoints, getSpeedCurveMultiplier } from '../../engine/keyframeMath';
import { Section, SliderRow, ToggleRow, SegmentedControl } from '../ui/Controls';
import {
  Gauge, Rewind, Waves, RotateCcw, Plus,
} from '../ui/icons';

const PRESETS: { value: SpeedCurvePreset; label: string; hint: string }[] = [
  { value: 'linear', label: 'Normal', hint: 'Constant rate' },
  { value: 'montage', label: 'Montage', hint: 'Fast → slow → fast' },
  { value: 'hero', label: 'Hero', hint: 'Drop into slow-mo, exit fast' },
  { value: 'bullet_time', label: 'Bullet Time', hint: 'Freeze the moment' },
  { value: 'jump_cut', label: 'Jump Cut', hint: 'Blink-fast middle' },
  { value: 'flash_in', label: 'Flash In', hint: 'Fast start' },
  { value: 'flash_out', label: 'Flash Out', hint: 'Fast finish' },
  { value: 'custom', label: 'Custom', hint: 'Drag your own curve' },
];

const CURVE_H = 132;
const MAX_SPEED = 6;

export const SpeedInspector: React.FC<{ clip: Clip }> = ({ clip }) => {
  const updateClipSpeed = useTimelineStore((s) => s.updateClipSpeed);
  const setSpeedCurvePoints = useTimelineStore((s) => s.setSpeedCurvePoints);
  const commit = useTimelineStore((s) => s.commit);
  const beginTransaction = useTimelineStore((s) => s.beginTransaction);
  const commitTransaction = useTimelineStore((s) => s.commitTransaction);

  const boxRef = useRef<HTMLDivElement>(null);

  const points = useMemo(
    () => resolveSpeedPoints(clip.speed.curvePreset, clip.speed.customPoints),
    [clip.speed.curvePreset, clip.speed.customPoints]
  );

  const speedToY = useCallback((mult: number) => CURVE_H - (Math.min(MAX_SPEED, mult) / MAX_SPEED) * CURVE_H, []);
  const yToSpeed = useCallback((y: number) => Math.max(0.1, Math.min(MAX_SPEED, ((CURVE_H - y) / CURVE_H) * MAX_SPEED)), []);

  const curvePath = useMemo(() => {
    const SAMPLES = 100;
    const coords: string[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const mult = getSpeedCurveMultiplier(clip.speed.curvePreset, t, clip.speed.customPoints);
      coords.push(`${t * 100},${speedToY(mult)}`);
    }
    return `M ${coords.join(' L ')}`;
  }, [clip.speed.curvePreset, clip.speed.customPoints, speedToY]);

  /** Switching to custom seeds from whatever preset was showing. */
  const ensureCustom = (): SpeedCurvePoint[] => {
    if (clip.speed.curvePreset === 'custom' && clip.speed.customPoints?.length) {
      return [...clip.speed.customPoints];
    }
    const seeded = points.map((p) => ({ ...p }));
    setSpeedCurvePoints(clip.id, seeded);
    return seeded;
  };

  const dragPoint = (index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const working = ensureCustom();

    beginTransaction();

    const move = (ev: PointerEvent) => {
      const t = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const speed = yToSpeed(((ev.clientY - rect.top) / rect.height) * CURVE_H);

      const next = working.map((p, i) => (i === index ? { timePct: t, speedMult: Number(speed.toFixed(2)) } : p));
      // Endpoints stay pinned so the ramp always spans the whole clip.
      if (index === 0) next[0].timePct = 0;
      if (index === working.length - 1) next[next.length - 1].timePct = 1;

      setSpeedCurvePoints(clip.id, next);
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      commitTransaction('Edit speed curve');
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const addPointAt = (e: React.MouseEvent) => {
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const t = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width));
    const speed = yToSpeed(((e.clientY - rect.top) / rect.height) * CURVE_H);

    const working = ensureCustom();
    const next = [...working, { timePct: t, speedMult: Number(speed.toFixed(2)) }].sort((a, b) => a.timePct - b.timePct);
    setSpeedCurvePoints(clip.id, next);
    commit('Add speed point');
  };

  const removePoint = (index: number) => {
    const working = ensureCustom();
    if (working.length <= 2) return;
    setSpeedCurvePoints(clip.id, working.filter((_, i) => i !== index));
    commit('Remove speed point');
  };

  const effectiveDuration = clip.durationMs;
  const originalDuration = effectiveDuration * clip.speed.multiplier;

  return (
    <div>
      <Section title="Playback speed" icon={Gauge}>
        <SliderRow
          label="Speed"
          min={0.1}
          max={8}
          step={0.05}
          unit="×"
          precision={2}
          defaultValue={1}
          value={clip.speed.multiplier}
          onChange={(v) => updateClipSpeed(clip.id, { multiplier: v })}
          onCommit={() => commit('Set speed')}
        />

        <div className="grid grid-cols-4 gap-1">
          {[0.25, 0.5, 1, 2].map((v) => (
            <button
              key={v}
              onClick={() => { updateClipSpeed(clip.id, { multiplier: v }); commit(`Set ${v}× speed`); }}
              className={`h-6 rounded-squircle-xs border text-[10px] font-mono transition-colors ${
                Math.abs(clip.speed.multiplier - v) < 0.01
                  ? 'bg-spectrum-accentSoft border-spectrum-accentLine text-spectrum-accent'
                  : 'bg-spectrum-card border-line text-spectrum-textDim hover:text-spectrum-text'
              }`}
            >
              {v}×
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="card px-2 py-1.5">
            <span className="block text-[9px] text-spectrum-textFaint">Timeline length</span>
            <span className="font-mono text-[11px] text-spectrum-text tabular">{(effectiveDuration / 1000).toFixed(2)}s</span>
          </div>
          <div className="card px-2 py-1.5">
            <span className="block text-[9px] text-spectrum-textFaint">Source consumed</span>
            <span className="font-mono text-[11px] text-spectrum-textDim tabular">{(originalDuration / 1000).toFixed(2)}s</span>
          </div>
        </div>

        <ToggleRow
          label="Reverse"
          hint="Play the clip backwards"
          checked={clip.speed.reversed}
          onChange={(v) => { updateClipSpeed(clip.id, { reversed: v }); commit('Toggle reverse'); }}
        />
        <ToggleRow
          label="Preserve pitch"
          hint="Keep voices natural when ramping"
          checked={clip.speed.preservePitch}
          onChange={(v) => { updateClipSpeed(clip.id, { preservePitch: v }); commit('Toggle pitch lock'); }}
        />
      </Section>

      <Section title="Speed ramp" icon={Waves}>
        <SegmentedControl
          value={clip.speed.curvePreset}
          columns={4}
          onChange={(v) => { updateClipSpeed(clip.id, { curvePreset: v }); commit(`Apply ${v} ramp`); }}
          options={PRESETS.map((p) => ({ value: p.value, label: p.label, title: p.hint }))}
        />

        {/* Curve editor */}
        <div
          ref={boxRef}
          onDoubleClick={addPointAt}
          className="well relative overflow-visible mt-1"
          style={{ height: CURVE_H }}
          title="Double-click to add a control point"
        >
          {/* Speed reference lines */}
          {[1, 2, 4].map((mult) => (
            <div
              key={mult}
              className="absolute left-0 right-0 h-px bg-white/[0.06] pointer-events-none"
              style={{ top: speedToY(mult) }}
            >
              <span className="absolute left-1 -top-[7px] text-[9px] font-mono text-spectrum-textFaint">{mult}×</span>
            </div>
          ))}
          {[0.25, 0.5, 0.75].map((t) => (
            <div key={t} className="absolute top-0 bottom-0 w-px bg-white/[0.05] pointer-events-none" style={{ left: `${t * 100}%` }} />
          ))}

          <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 100 ${CURVE_H}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id="speedFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4c9dff" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#4c9dff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${curvePath} L 100,${CURVE_H} L 0,${CURVE_H} Z`} fill="url(#speedFill)" />
            <path d={curvePath} fill="none" stroke="#4c9dff" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          </svg>

          {points.map((point, i) => (
            <button
              key={i}
              onPointerDown={dragPoint(i)}
              onContextMenu={(e) => { e.preventDefault(); removePoint(i); }}
              className="absolute w-2.5 h-2.5 rounded-full bg-white border-[1.5px] border-spectrum-accent cursor-grab active:cursor-grabbing hover:scale-140 transition-transform shadow"
              style={{
                left: `${point.timePct * 100}%`,
                top: speedToY(point.speedMult),
                marginLeft: -5,
                marginTop: -5,
              }}
              title={`${point.speedMult.toFixed(2)}× at ${Math.round(point.timePct * 100)}% — right-click to remove`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between text-[9px] text-spectrum-textFaint">
          <span>Double-click to add a point · right-click to remove</span>
          {clip.speed.curvePreset === 'custom' && (
            <button
              onClick={() => { updateClipSpeed(clip.id, { curvePreset: 'linear' }); commit('Reset ramp'); }}
              className="pro-btn px-1.5 h-5 gap-1 text-[9px]"
            >
              <RotateCcw className="w-2.5 h-2.5" /> Reset
            </button>
          )}
        </div>
      </Section>
    </div>
  );
};
