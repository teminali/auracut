/* ═══════════════════════════════════════════════════════════════════
   Keyframe editor — per-property lanes plus a value-graph mode.

   Lane view    : drag diamonds along time, right-click for easing.
   Graph view   : drag diamonds in BOTH axes, with the interpolated curve
                  drawn between them so ease shapes are visible.
   Both views share one time ruler that maps the clip's own 0..duration.
   ═══════════════════════════════════════════════════════════════════ */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { Clip, AnimatableProperty, KeyframePoint, Easing } from '../../types/edl';
import { interpolateKeyframes, keyframesFor, applyEasing } from '../../engine/keyframeMath';
import { MOTION_PRESET_LABELS } from '../../store/timelineStore';
import { Section, SegmentedControl, EmptyState } from '../ui/Controls';
import {
  Check, ChevronLeft, ChevronRight, Diamond, LineChart, Plus, Rows3, Sparkle, Timer, Trash2,
} from '../ui/icons';

interface KeyframeEditorProps {
  clip: Clip;
}

/* ── Property metadata ──────────────────────────────────────────── */

interface PropertyMeta {
  id: AnimatableProperty;
  label: string;
  unit: string;
  /** Graph range; the editor widens it when values exceed it. */
  min: number;
  max: number;
  defaultOf: (clip: Clip) => number;
  precision: number;
  color: string;
}

const PROPERTIES: PropertyMeta[] = [
  { id: 'positionX', label: 'Position X', unit: 'px', min: -960, max: 960, defaultOf: (c) => c.transform.x, precision: 0, color: '#ff6b6b' },
  { id: 'positionY', label: 'Position Y', unit: 'px', min: -540, max: 540, defaultOf: (c) => c.transform.y, precision: 0, color: '#51cf66' },
  { id: 'scaleX', label: 'Scale X', unit: '×', min: 0, max: 4, defaultOf: (c) => c.transform.scaleX, precision: 2, color: '#4c9dff' },
  { id: 'scaleY', label: 'Scale Y', unit: '×', min: 0, max: 4, defaultOf: (c) => c.transform.scaleY, precision: 2, color: '#22b8cf' },
  { id: 'rotation', label: 'Rotation', unit: '°', min: -360, max: 360, defaultOf: (c) => c.transform.rotation, precision: 1, color: '#f5a524' },
  { id: 'opacity', label: 'Opacity', unit: '', min: 0, max: 1, defaultOf: (c) => c.transform.opacity, precision: 2, color: '#a78bfa' },
  { id: 'volume', label: 'Volume', unit: '', min: 0, max: 2, defaultOf: (c) => c.audio.volume, precision: 2, color: '#2fc98d' },
];

const EASING_OPTIONS: { value: Easing; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'easeIn', label: 'Ease In' },
  { value: 'easeOut', label: 'Ease Out' },
  { value: 'easeInOut', label: 'Ease In-Out' },
  { value: 'bezier', label: 'Custom Bezier' },
  { value: 'hold', label: 'Hold (step)' },
];

const LANE_HEIGHT = 22;
const GRAPH_HEIGHT = 168;

export const KeyframeEditor: React.FC<KeyframeEditorProps> = ({ clip }) => {
  const playheadMs = useTimelineStore((s) => s.playheadMs);
  const setPlayheadMs = useTimelineStore((s) => s.setPlayheadMs);
  const upsertKeyframeAt = useTimelineStore((s) => s.upsertKeyframeAt);
  const removeKeyframe = useTimelineStore((s) => s.removeKeyframe);
  const moveKeyframe = useTimelineStore((s) => s.moveKeyframe);
  const setKeyframeEasing = useTimelineStore((s) => s.setKeyframeEasing);
  const clearKeyframes = useTimelineStore((s) => s.clearKeyframes);
  const applyMotionPreset = useTimelineStore((s) => s.applyMotionPreset);
  const beginTransaction = useTimelineStore((s) => s.beginTransaction);
  const commitTransaction = useTimelineStore((s) => s.commitTransaction);
  const openContextMenu = useUiStore((s) => s.openContextMenu);

  const [mode, setMode] = useState<'lanes' | 'graph'>('lanes');
  const [focusProperty, setFocusProperty] = useState<AnimatableProperty>('opacity');
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);

  const trackRef = useRef<HTMLDivElement>(null);

  const clipOffsetMs = Math.max(0, Math.min(clip.durationMs, playheadMs - clip.startTimeMs));
  const isPlayheadOverClip = playheadMs >= clip.startTimeMs && playheadMs <= clip.startTimeMs + clip.durationMs;

  const animatedProperties = useMemo(() => {
    const set = new Set(clip.keyframes.map((k) => k.property));
    return PROPERTIES.filter((p) => set.has(p.id));
  }, [clip.keyframes]);

  const visibleProperties = animatedProperties.length > 0 ? animatedProperties : [];

  /* ── Time ⇄ pixel helpers ── */

  const timeToPct = useCallback(
    (ms: number) => (clip.durationMs > 0 ? (ms / clip.durationMs) * 100 : 0),
    [clip.durationMs]
  );

  const pxToTime = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return pct * clip.durationMs;
    },
    [clip.durationMs]
  );

  /* ── Keyframe interactions ── */

  const toggleKeyframe = useCallback(
    (property: AnimatableProperty) => {
      const meta = PROPERTIES.find((p) => p.id === property)!;
      const existing = clip.keyframes.find(
        (k) => k.property === property && Math.abs(k.timeOffsetMs - clipOffsetMs) < 40
      );
      if (existing) {
        removeKeyframe(clip.id, existing.id);
      } else {
        // Capture the CURRENT animated value so adding a key never jumps.
        const current = interpolateKeyframes(clip.keyframes, property, clipOffsetMs, meta.defaultOf(clip));
        upsertKeyframeAt(clip.id, property, clipOffsetMs, current);
      }
    },
    [clip, clipOffsetMs, removeKeyframe, upsertKeyframeAt]
  );

  const dragKeyframe = useCallback(
    (e: React.PointerEvent, kf: KeyframePoint, meta: PropertyMeta, graph: boolean, range: { min: number; max: number }) => {
      e.preventDefault();
      e.stopPropagation();
      setSelectedKeyframeId(kf.id);

      const startX = e.clientX;
      const startY = e.clientY;
      const startTime = kf.timeOffsetMs;
      const startValue = kf.value;
      let moved = false;

      beginTransaction();

      const move = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 2) return;
        moved = true;

        const el = trackRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();

        const deltaTime = ((ev.clientX - startX) / rect.width) * clip.durationMs;
        // Shift locks to a single axis, matching every other drag in the app.
        const lockValue = ev.shiftKey && Math.abs(ev.clientX - startX) > Math.abs(ev.clientY - startY);
        const lockTime = ev.shiftKey && !lockValue;

        const nextTime = lockTime ? startTime : Math.max(0, Math.min(clip.durationMs, startTime + deltaTime));

        if (graph && !lockValue) {
          const span = range.max - range.min;
          const deltaValue = -((ev.clientY - startY) / GRAPH_HEIGHT) * span;
          const nextValue = Math.max(range.min, Math.min(range.max, startValue + deltaValue));
          moveKeyframe(clip.id, kf.id, nextTime, nextValue);
        } else {
          moveKeyframe(clip.id, kf.id, nextTime);
        }
      };

      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (moved) commitTransaction('Move keyframe');
        else useTimelineStore.getState().cancelTransaction();
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [clip.id, clip.durationMs, moveKeyframe, beginTransaction, commitTransaction]
  );

  const keyframeContextMenu = useCallback(
    (e: React.MouseEvent, kf: KeyframePoint) => {
      e.preventDefault();
      e.stopPropagation();
      setSelectedKeyframeId(kf.id);

      openContextMenu(e.clientX, e.clientY, [
        ...EASING_OPTIONS.map((opt) => ({
          id: opt.value,
          label: opt.label,
          // A real icon, not a tick character padded with spaces. The
          // text version misaligned every unselected row by three
          // characters and could not be styled.
          icon: kf.easing === opt.value ? Check : undefined,
          onSelect: () => setKeyframeEasing(clip.id, kf.id, opt.value),
        })),
        {
          id: 'goto',
          label: 'Move playhead here',
          separatorBefore: true,
          onSelect: () => setPlayheadMs(clip.startTimeMs + kf.timeOffsetMs),
        },
        {
          id: 'delete',
          label: 'Delete keyframe',
          icon: Trash2,
          danger: true,
          onSelect: () => removeKeyframe(clip.id, kf.id),
        },
      ]);
    },
    [clip.id, clip.startTimeMs, openContextMenu, setKeyframeEasing, setPlayheadMs, removeKeyframe]
  );

  /* ── Nav between keys ── */

  const jumpToAdjacentKey = (direction: -1 | 1) => {
    const all = [...clip.keyframes].sort((a, b) => a.timeOffsetMs - b.timeOffsetMs);
    const target =
      direction === 1
        ? all.find((k) => k.timeOffsetMs > clipOffsetMs + 5)
        : [...all].reverse().find((k) => k.timeOffsetMs < clipOffsetMs - 5);
    if (target) setPlayheadMs(clip.startTimeMs + target.timeOffsetMs);
  };

  /* ── Graph geometry ── */

  const graphKeys = useMemo(() => keyframesFor(clip.keyframes, focusProperty), [clip.keyframes, focusProperty]);
  const graphMeta = PROPERTIES.find((p) => p.id === focusProperty)!;

  const graphRange = useMemo(() => {
    if (graphKeys.length === 0) return { min: graphMeta.min, max: graphMeta.max };
    const values = graphKeys.map((k) => k.value);
    const lo = Math.min(graphMeta.min, ...values);
    const hi = Math.max(graphMeta.max, ...values);
    // Pad so keys never sit exactly on the frame edge.
    const pad = (hi - lo) * 0.08 || 1;
    return { min: lo - pad, max: hi + pad };
  }, [graphKeys, graphMeta]);

  const valueToY = useCallback(
    (v: number) => {
      const span = graphRange.max - graphRange.min;
      return span > 0 ? GRAPH_HEIGHT - ((v - graphRange.min) / span) * GRAPH_HEIGHT : GRAPH_HEIGHT / 2;
    },
    [graphRange]
  );

  const graphPath = useMemo(() => {
    if (graphKeys.length === 0) return '';

    const SAMPLES = 140;
    const points: string[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = (i / SAMPLES) * clip.durationMs;
      const v = interpolateKeyframes(clip.keyframes, focusProperty, t, graphMeta.defaultOf(clip));
      points.push(`${(i / SAMPLES) * 100},${valueToY(v)}`);
    }
    return `M ${points.join(' L ')}`;
  }, [graphKeys, clip, focusProperty, graphMeta, valueToY]);

  /* ── Empty state ── */

  if (clip.keyframes.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <EmptyState
          icon={Diamond}
          title="No keyframes yet"
          detail="Turn on a stopwatch in the Transform tab, or drop in a motion preset below."
        />
        <Section title="Motion presets" icon={Sparkle}>
          <div className="grid grid-cols-2 gap-1">
            {MOTION_PRESET_LABELS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => applyMotionPreset(clip.id, preset.id)}
                className="card-interactive p-2 text-left"
              >
                <span className="block text-ui-sm font-medium text-spectrum-text">{preset.label}</span>
                <span className="block text-micro text-spectrum-textFaint truncate">{preset.hint}</span>
              </button>
            ))}
          </div>
        </Section>
      </div>
    );
  }

  const selectedKeyframe = clip.keyframes.find((k) => k.id === selectedKeyframeId) ?? null;

  return (
    <div className="flex flex-col">
      {/* ── Toolbar ── */}
      <div className="h-9 px-3 flex items-center justify-between gap-2 border-b border-line bg-spectrum-panelHeader/50 flex-shrink-0">
        <div className="seg-group">
          <button onClick={() => setMode('lanes')} className={`seg-item ${mode === 'lanes' ? 'seg-item-active' : ''}`} title="Lane view"
            aria-label="Lane view">
            <Rows3 className="w-3 h-3" /> Lanes
          </button>
          <button onClick={() => setMode('graph')} className={`seg-item ${mode === 'graph' ? 'seg-item-active' : ''}`} title="Value graph"
            aria-label="Value graph">
            <LineChart className="w-3 h-3" /> Graph
          </button>
        </div>

        <div className="flex items-center gap-0.5">
          <button onClick={() => jumpToAdjacentKey(-1)} className="pro-btn w-6 h-6" title="Previous keyframe"
            aria-label="Previous keyframe">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => toggleKeyframe(mode === 'graph' ? focusProperty : visibleProperties[0]?.id ?? 'opacity')}
            className="pro-btn w-6 h-6"
            disabled={!isPlayheadOverClip}
            title="Add keyframe at playhead"
          
            aria-label="Add keyframe at playhead">
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => jumpToAdjacentKey(1)} className="pro-btn w-6 h-6" title="Next keyframe"
            aria-label="Next keyframe">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => clearKeyframes(clip.id)}
            className="btn-ghost-danger w-6 h-6"
            title="Delete all keyframes on this clip"
          
            aria-label="Delete all keyframes on this clip">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Time ruler ── */}
      <div className="px-3 pt-2 flex-shrink-0">
        <div className="flex items-center justify-between text-micro font-mono text-spectrum-textFaint mb-1">
          <span>0.0s</span>
          <span className={isPlayheadOverClip ? 'text-spectrum-accent font-semibold' : ''}>
            {(clipOffsetMs / 1000).toFixed(2)}s
          </span>
          <span>{(clip.durationMs / 1000).toFixed(1)}s</span>
        </div>
      </div>

      {/* ── Editor body ── */}
      <div className="px-3 pb-3">
        <div
          ref={trackRef}
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget) return;
            setPlayheadMs(clip.startTimeMs + pxToTime(e.clientX));
          }}
          className="relative well overflow-hidden"
          style={{ height: mode === 'graph' ? GRAPH_HEIGHT + 8 : visibleProperties.length * LANE_HEIGHT + 8 }}
        >
          {/* Vertical grid */}
          {[0, 25, 50, 75, 100].map((pct) => (
            <div key={pct} className="absolute top-0 bottom-0 w-px bg-white/[0.05] pointer-events-none" style={{ left: `${pct}%` }} />
          ))}

          {mode === 'graph' ? (
            <>
              {/* Horizontal value grid */}
              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                <div key={f} className="absolute left-0 right-0 h-px bg-white/[0.05] pointer-events-none" style={{ top: 4 + f * GRAPH_HEIGHT }}>
                  <span className="absolute left-1 -top-[7px] text-micro font-mono text-spectrum-textFaint tabular">
                    {(graphRange.max - f * (graphRange.max - graphRange.min)).toFixed(graphMeta.precision)}
                  </span>
                </div>
              ))}

              <svg className="absolute inset-x-0 pointer-events-none" style={{ top: 4, height: GRAPH_HEIGHT }} viewBox={`0 0 100 ${GRAPH_HEIGHT}`} preserveAspectRatio="none">
                <path d={graphPath} fill="none" stroke={graphMeta.color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              </svg>

              {graphKeys.map((kf) => (
                <button
                  key={kf.id}
                  onPointerDown={(e) => dragKeyframe(e, kf, graphMeta, true, graphRange)}
                  onContextMenu={(e) => keyframeContextMenu(e, kf)}
                  className="absolute w-2.5 h-2.5 rotate-45 border transition-transform hover:scale-150 cursor-move z-10"
                  style={{
                    left: `${timeToPct(kf.timeOffsetMs)}%`,
                    top: 4 + valueToY(kf.value),
                    marginLeft: -5,
                    marginTop: -5,
                    background: selectedKeyframeId === kf.id ? '#ffffff' : graphMeta.color,
                    borderColor: '#000000aa',
                  }}
                  title={`${graphMeta.label} = ${kf.value.toFixed(graphMeta.precision)}${graphMeta.unit} @ ${(kf.timeOffsetMs / 1000).toFixed(2)}s · ${kf.easing}`}
                
            aria-label={`${graphMeta.label} = ${kf.value.toFixed(graphMeta.precision)}${graphMeta.unit} @ ${(kf.timeOffsetMs / 1000).toFixed(2)}s · ${kf.easing}`}
            />
              ))}
            </>
          ) : (
            visibleProperties.map((meta, laneIndex) => {
              const keys = keyframesFor(clip.keyframes, meta.id);
              return (
                <div
                  key={meta.id}
                  className="absolute left-0 right-0 flex items-center group/lane"
                  style={{ top: 4 + laneIndex * LANE_HEIGHT, height: LANE_HEIGHT }}
                >
                  <div className="absolute inset-x-0 h-px bg-white/[0.06]" style={{ top: LANE_HEIGHT / 2 }} />

                  {/* Easing segments between consecutive keys */}
                  {keys.slice(0, -1).map((kf, i) => {
                    const next = keys[i + 1];
                    const left = timeToPct(kf.timeOffsetMs);
                    const width = timeToPct(next.timeOffsetMs) - left;
                    return (
                      <div
                        key={`seg-${kf.id}`}
                        className="absolute h-[3px] rounded-full opacity-45"
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          top: LANE_HEIGHT / 2 - 1.5,
                          background: kf.easing === 'hold'
                            ? `repeating-linear-gradient(90deg, ${meta.color} 0 3px, transparent 3px 6px)`
                            : meta.color,
                        }}
                      />
                    );
                  })}

                  <span
                    className="absolute left-1.5 text-micro font-medium pointer-events-none z-10 px-1 rounded bg-spectrum-sunken/85"
                    style={{ color: meta.color }}
                  >
                    {meta.label}
                  </span>

                  {keys.map((kf) => (
                    <button
                      key={kf.id}
                      onPointerDown={(e) => dragKeyframe(e, kf, meta, false, graphRange)}
                      onContextMenu={(e) => keyframeContextMenu(e, kf)}
                      className="absolute w-2.5 h-2.5 rotate-45 border border-black/60 transition-transform hover:scale-150 cursor-ew-resize z-10"
                      style={{
                        left: `${timeToPct(kf.timeOffsetMs)}%`,
                        top: LANE_HEIGHT / 2 - 5,
                        marginLeft: -5,
                        background: selectedKeyframeId === kf.id ? '#ffffff' : meta.color,
                      }}
                      title={`${meta.label} = ${kf.value.toFixed(meta.precision)}${meta.unit} @ ${(kf.timeOffsetMs / 1000).toFixed(2)}s · ${kf.easing}`}
                    
            aria-label={`${meta.label} = ${kf.value.toFixed(meta.precision)}${meta.unit} @ ${(kf.timeOffsetMs / 1000).toFixed(2)}s · ${kf.easing}`}
            />
                  ))}
                </div>
              );
            })
          )}

          {/* Playhead */}
          {isPlayheadOverClip && (
            <div
              className="absolute top-0 bottom-0 w-px bg-spectrum-accent pointer-events-none z-20 shadow-[0_0_5px_rgba(76,157,255,0.8)]"
              style={{ left: `${timeToPct(clipOffsetMs)}%` }}
            />
          )}
        </div>
      </div>

      {/* ── Graph property picker ── */}
      {mode === 'graph' && (
        <div className="px-3 pb-3">
          <SegmentedControl
            value={focusProperty}
            columns={4}
            onChange={setFocusProperty}
            options={PROPERTIES.map((p) => ({ value: p.id, label: p.label.replace('Position ', 'Pos ').replace('Scale ', 'Scl ') }))}
          />
        </div>
      )}

      {/* ── Selected keyframe editor ── */}
      {selectedKeyframe && (
        <Section title="Selected keyframe" icon={Diamond}>
          <div className="grid grid-cols-2 gap-2 text-micro">
            <div className="card px-2 py-1.5">
              <span className="block text-micro text-spectrum-textFaint">Time</span>
              <span className="font-mono text-spectrum-text tabular">{(selectedKeyframe.timeOffsetMs / 1000).toFixed(3)}s</span>
            </div>
            <div className="card px-2 py-1.5">
              <span className="block text-micro text-spectrum-textFaint">Value</span>
              <span className="font-mono text-spectrum-text tabular">
                {selectedKeyframe.value.toFixed(3)}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-micro text-spectrum-textMuted">Easing out of this key</span>
            <select
              value={selectedKeyframe.easing}
              onChange={(e) => setKeyframeEasing(clip.id, selectedKeyframe.id, e.target.value as Easing)}
              className="pro-input w-full h-7 px-2 text-ui-sm cursor-pointer"
            >
              {EASING_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <EasingPreview easing={selectedKeyframe.easing} bezier={selectedKeyframe.bezierPoints} />

          {selectedKeyframe.easing === 'bezier' && (
            <BezierEditor
              points={selectedKeyframe.bezierPoints ?? [0.25, 0.1, 0.25, 1]}
              onChange={(pts) => setKeyframeEasing(clip.id, selectedKeyframe.id, 'bezier', pts)}
            />
          )}

          <button
            onClick={() => { removeKeyframe(clip.id, selectedKeyframe.id); setSelectedKeyframeId(null); }}
            className="btn-ghost-danger w-full h-7 gap-1.5 text-ui-sm"
          >
            <Trash2 className="w-3 h-3" /> Delete keyframe
          </button>
        </Section>
      )}

      {/* ── Presets ── */}
      <Section title="Motion presets" icon={Sparkle} defaultOpen={false}>
        <div className="grid grid-cols-2 gap-1">
          {MOTION_PRESET_LABELS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => applyMotionPreset(clip.id, preset.id)}
              className="card-interactive p-2 text-left"
            >
              <span className="block text-ui-sm font-medium text-spectrum-text">{preset.label}</span>
              <span className="block text-micro text-spectrum-textFaint truncate">{preset.hint}</span>
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
};

/* ── Easing curve preview ───────────────────────────────────────── */

const EasingPreview: React.FC<{ easing: Easing; bezier?: [number, number, number, number] }> = ({ easing, bezier }) => {
  const path = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const v = applyEasing(t, easing, bezier);
      pts.push(`${t * 100},${100 - v * 100}`);
    }
    return `M ${pts.join(' L ')}`;
  }, [easing, bezier]);

  return (
    <div className="well h-16 relative overflow-hidden">
      <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <line x1="0" y1="100" x2="100" y2="0" stroke="rgba(255,255,255,0.08)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path d={path} fill="none" stroke="#4c9dff" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
};

/* ── Draggable cubic-bezier editor ──────────────────────────────── */

const BezierEditor: React.FC<{
  points: [number, number, number, number];
  onChange: (pts: [number, number, number, number]) => void;
}> = ({ points, onChange }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const [p1x, p1y, p2x, p2y] = points;

  const dragHandle = (index: 0 | 1) => (e: React.PointerEvent) => {
    e.preventDefault();
    const el = boxRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    const move = (ev: PointerEvent) => {
      // X stays inside 0..1 (a bezier can't run backwards); Y may overshoot.
      const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const y = Math.max(-0.6, Math.min(1.6, 1 - (ev.clientY - rect.top) / rect.height));
      onChange(
        index === 0
          ? [Number(x.toFixed(3)), Number(y.toFixed(3)), p2x, p2y]
          : [p1x, p1y, Number(x.toFixed(3)), Number(y.toFixed(3))]
      );
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const toPx = (x: number, y: number) => ({ left: `${x * 100}%`, top: `${(1 - y) * 100}%` });

  return (
    <div className="space-y-1.5">
      <div ref={boxRef} className="well relative h-28 overflow-visible">
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line x1="0" y1="100" x2="100" y2="0" stroke="rgba(255,255,255,0.07)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1="0" y1="100" x2={p1x * 100} y2={100 - p1y * 100} stroke="rgba(76,157,255,0.4)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1="100" y1="0" x2={p2x * 100} y2={100 - p2y * 100} stroke="rgba(245,165,36,0.4)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <path
            d={`M 0 100 C ${p1x * 100} ${100 - p1y * 100}, ${p2x * 100} ${100 - p2y * 100}, 100 0`}
            fill="none"
            stroke="#4c9dff"
            strokeWidth="1.6"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        <div
          onPointerDown={dragHandle(0)}
          style={toPx(p1x, p1y)}
          className="absolute w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full bg-spectrum-accent border border-white/70 cursor-grab active:cursor-grabbing hover:scale-125 transition-transform"
        />
        <div
          onPointerDown={dragHandle(1)}
          style={toPx(p2x, p2y)}
          className="absolute w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full bg-spectrum-amber border border-white/70 cursor-grab active:cursor-grabbing hover:scale-125 transition-transform"
        />
      </div>
      <div className="text-micro font-mono text-spectrum-textFaint text-center tabular">
        cubic-bezier({p1x}, {p1y}, {p2x}, {p2y})
      </div>
    </div>
  );
};
