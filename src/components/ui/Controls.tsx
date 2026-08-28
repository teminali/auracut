/* ═══════════════════════════════════════════════════════════════════
   Shared inspector controls.
   Every numeric control here supports drag-scrubbing on its label,
   which is what makes a properties panel feel like a real NLE.
   ═══════════════════════════════════════════════════════════════════ */

import React, { useCallback, useRef, useState, useEffect } from 'react';
import {
  ChevronRight, RotateCcw, Timer,
} from './icons';

/* ── Scrub behaviour ────────────────────────────────────────────── */

interface ScrubOptions {
  value: number;
  onChange: (v: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
  /** Units per pixel dragged. */
  sensitivity?: number;
  min?: number;
  max?: number;
  step?: number;
}

export function useScrub({ value, onChange, onStart, onEnd, sensitivity = 1, min = -Infinity, max = Infinity, step = 1 }: ScrubOptions) {
  const startRef = useRef({ x: 0, value: 0 });

  return useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startRef.current = { x: e.clientX, value };
      onStart?.();

      const move = (ev: PointerEvent) => {
        // Shift = fine control, Alt = coarse. Standard NLE muscle memory.
        const multiplier = ev.shiftKey ? 0.15 : ev.altKey ? 4 : 1;
        const raw = startRef.current.value + (ev.clientX - startRef.current.x) * sensitivity * multiplier;
        const stepped = step > 0 ? Math.round(raw / step) * step : raw;
        onChange(Math.max(min, Math.min(max, stepped)));
      };

      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.classList.remove('dragging-h');
        onEnd?.();
      };

      document.body.classList.add('dragging-h');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [value, onChange, onStart, onEnd, sensitivity, min, max, step]
  );
}

/* ── Number field ───────────────────────────────────────────────── */

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  sensitivity?: number;
  precision?: number;
  className?: string;
}

export const NumberField: React.FC<NumberFieldProps> = ({
  label, value, onChange, onCommit, unit, min = -Infinity, max = Infinity,
  step = 1, sensitivity = 1, precision = 0, className = '',
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const onScrub = useScrub({ value, onChange, onEnd: onCommit, sensitivity, min, max, step });

  const display = draft ?? value.toFixed(precision);

  return (
    <div className={`num-field group ${className}`}>
      {/* The label is a gutter, not a floating word: fixed width and a rule
          against the value, so a row of fields lines up on both edges. */}
      <span
        onPointerDown={onScrub}
        className="scrub-label text-micro font-mono font-semibold text-spectrum-textDim flex-shrink-0 select-none w-[13px] text-center border-r border-line pr-1 mr-0.5"
        title={`Drag to scrub ${label} · ⇧ fine · ⌥ coarse`}
      >
        {label}
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={display}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => { setDraft(value.toFixed(precision)); e.currentTarget.select(); }}
        onBlur={() => {
          const parsed = parseFloat(draft ?? '');
          if (!Number.isNaN(parsed)) onChange(Math.max(min, Math.min(max, parsed)));
          setDraft(null);
          onCommit?.();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const delta = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1) * step;
            onChange(Math.max(min, Math.min(max, value + delta)));
            setDraft(null);
          }
        }}
      />
      {unit && <span className="text-micro text-spectrum-textFaint font-mono flex-shrink-0">{unit}</span>}
    </div>
  );
};

/* ── Slider row ─────────────────────────────────────────────────── */

export interface SliderRowProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
  min: number;
  max: number;
  step?: number;
  /** Suffix shown next to the readout, e.g. `%` or `°`. */
  unit?: string;
  /** Multiply the stored value for display (e.g. 0..1 opacity shown as %). */
  displayScale?: number;
  precision?: number;
  defaultValue?: number;
  /** Draw the fill from this value instead of `min` — good for -50..50 ranges. */
  bipolar?: boolean;
  /** Keyframe stopwatch, when the property is animatable. */
  keyframe?: KeyframeToggleProps;
}

export const SliderRow: React.FC<SliderRowProps> = ({
  label, value, onChange, onCommit, min, max, step = 1, unit = '',
  displayScale = 1, precision = 0, defaultValue, bipolar, keyframe,
}) => {
  const displayed = (value * displayScale).toFixed(precision);
  const range = max - min;
  const pct = range > 0 ? ((value - min) / range) * 100 : 0;
  const zeroPct = bipolar && range > 0 ? ((0 - min) / range) * 100 : 0;

  const onScrub = useScrub({
    value,
    onChange,
    onEnd: onCommit,
    sensitivity: range / 220,
    min,
    max,
    step,
  });

  const isModified = defaultValue !== undefined && Math.abs(value - defaultValue) > 1e-6;

  return (
    <div className="group/slider space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {keyframe && <KeyframeToggle {...keyframe} />}
          <span
            onPointerDown={onScrub}
            className="scrub-label text-ui-sm text-spectrum-textMuted truncate select-none"
            title={`Drag to adjust ${label}`}
          >
            {label}
          </span>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {isModified && defaultValue !== undefined && (
            <button
              onClick={() => { onChange(defaultValue); onCommit?.(); }}
              className="opacity-0 group-hover/slider:opacity-100 text-spectrum-textFaint hover:text-spectrum-text transition-opacity"
              title={`Reset to ${defaultValue}`}
            
            aria-label={`Reset to ${defaultValue}`}>
              <RotateCcw className="w-2.5 h-2.5" />
            </button>
          )}
          {/* A value that has moved off its default says so in accent —
              the fastest way to see what you have actually touched. */}
          <span className={`text-micro font-mono tabular ${isModified ? 'text-spectrum-accent font-semibold' : 'text-spectrum-textDim'}`}>
            {displayed}{unit}
          </span>
        </div>
      </div>

      <div className="relative flex items-center">
        {/* Fill track drawn under the native range input */}
        <div className="absolute left-0 right-0 h-[4px] rounded-full bg-[#262b33] shadow-[inset_0_1px_1px_rgba(0,0,0,0.35)] pointer-events-none" />
        <div
          className="absolute h-[4px] rounded-full bg-spectrum-accent pointer-events-none"
          style={
            bipolar
              ? { left: `${Math.min(zeroPct, pct)}%`, width: `${Math.abs(pct - zeroPct)}%` }
              : { left: 0, width: `${pct}%` }
          }
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerUp={onCommit}
          className="relative w-full"
          style={{ background: 'transparent' }}
        />
      </div>
    </div>
  );
};

/* Native range tracks would cover the fill — hide them just here. */
const sliderTrackReset = `
.group\\/slider input[type='range']::-webkit-slider-runnable-track { background: transparent; }
`;

if (typeof document !== 'undefined' && !document.getElementById('kerf-slider-reset')) {
  const styleEl = document.createElement('style');
  styleEl.id = 'kerf-slider-reset';
  styleEl.textContent = sliderTrackReset;
  document.head.appendChild(styleEl);
}

/* ── Keyframe stopwatch ─────────────────────────────────────────── */

export interface KeyframeToggleProps {
  /** Does this property have any keyframes? */
  animated: boolean;
  /** Is there a keyframe exactly at the playhead? */
  atPlayhead: boolean;
  onToggle: () => void;
  title?: string;
}

export const KeyframeToggle: React.FC<KeyframeToggleProps> = ({ animated, atPlayhead, onToggle, title }) => (
  <button
    onClick={onToggle}
    className={`w-4 h-4 rounded-[3px] flex items-center justify-center flex-shrink-0 transition-colors ${
      animated ? 'text-spectrum-amber hover:bg-spectrum-amber/15' : 'text-spectrum-textFaint hover:text-spectrum-textMuted hover:bg-spectrum-hover'
    }`}
    title={title ?? (atPlayhead ? 'Remove keyframe at playhead' : 'Add keyframe at playhead')}
            aria-label={title ?? (atPlayhead ? 'Remove keyframe at playhead' : 'Add keyframe at playhead')}
  >
    {animated ? (
      <span
        className={`w-[7px] h-[7px] rotate-45 ${atPlayhead ? 'bg-spectrum-amber' : 'border border-spectrum-amber'}`}
      />
    ) : (
      <Timer className="w-3 h-3" />
    )}
  </button>
);

/* ── Section ────────────────────────────────────────────────────── */

export const Section: React.FC<{
  title: string;
  icon?: React.ElementType;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon: Icon, defaultOpen = true, action, children }) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-line last:border-b-0">
      <div className="w-full h-[30px] px-3 flex items-center justify-between gap-2 hover:bg-white/[0.022] transition-colors">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left group/sec"
          aria-label="Expand or collapse this section"
        >
          <ChevronRight
            className={`w-3 h-3 flex-shrink-0 text-spectrum-textFaint group-hover/sec:text-spectrum-textMuted transition-all ${open ? 'rotate-90' : ''}`}
          />
          {Icon && <Icon className="w-3 h-3 flex-shrink-0 text-spectrum-textDim" />}
          <span className="section-label truncate">{title}</span>
        </button>
        {action}
      </div>
      {open && <div className="px-3 pb-3.5 pt-1 space-y-3">{children}</div>}
    </div>
  );
};

/* ── Segmented picker ───────────────────────────────────────────── */

export function SegmentedControl<T extends string>({
  value, options, onChange, columns,
}: {
  value: T;
  /**
   * `disabled` is real, not decorative: a choice that cannot be taken
   * has to LOOK unavailable and refuse the click. Offering ProRes a
   * "Fast" encoder that silently becomes the slow one is worse than not
   * offering it.
   */
  options: { value: T; label: string; icon?: React.ElementType; title?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  columns?: number;
}) {
  return (
    <div
      className="grid gap-px p-[2px] rounded-squircle-sm bg-spectrum-sunken border border-line shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]"
      style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}
    >
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => !opt.disabled && onChange(opt.value)}
            disabled={opt.disabled}
            title={opt.title ?? opt.label}
            className={`h-[24px] rounded-[5px] border text-ui-xs font-medium flex items-center justify-center gap-1 transition-colors truncate px-1 ${
              opt.disabled
                ? 'border-transparent text-spectrum-textFaint opacity-45 cursor-not-allowed'
                : active
                  ? 'bg-spectrum-card border-line-strong text-spectrum-text shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_2px_rgba(0,0,0,0.4)]'
                  : 'border-transparent text-spectrum-textDim hover:text-spectrum-text hover:bg-white/[0.05]'
            }`}
          
            aria-label={opt.title ?? opt.label}>
            {Icon && <Icon className="w-3 h-3 flex-shrink-0" />}
            <span className="truncate">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Colour swatch ──────────────────────────────────────────────── */

export const ColorField: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  allowClear?: boolean;
}> = ({ label, value, onChange, allowClear }) => (
  <div className="flex items-center justify-between gap-2 min-h-[26px]">
    <span className="prop-label">{label}</span>
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <span className="text-micro font-mono text-spectrum-textFaint uppercase tabular">{value || 'none'}</span>
      <label className="w-[26px] h-[22px] rounded-squircle-xs border border-line-strong cursor-pointer overflow-hidden relative checkerboard">
        <span className="absolute inset-0" style={{ background: value || 'transparent' }} />
        <input
          type="color"
          value={value || '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="opacity-0 w-full h-full cursor-pointer"
        />
      </label>
      {allowClear && (
        <button onClick={() => onChange('')} className="pro-btn w-[22px] h-[22px]" title="Clear colour"
            aria-label="Clear colour">
          <RotateCcw className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  </div>
);

/* ── Toggle ─────────────────────────────────────────────────────── */

export const ToggleRow: React.FC<{
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}> = ({ label, checked, onChange, hint }) => (
  <label className="flex items-center justify-between gap-3 cursor-pointer group/toggle min-h-[26px]">
    <span className="flex flex-col min-w-0 gap-0.5">
      <span className="prop-label group-hover/toggle:text-spectrum-text transition-colors">{label}</span>
      {hint && <span className="text-micro text-spectrum-textFaint truncate leading-tight">{hint}</span>}
    </span>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
  </label>
);

/* ── Empty state ────────────────────────────────────────────────── */

export const EmptyState: React.FC<{
  icon: React.ElementType;
  title: string;
  detail?: string;
  action?: React.ReactNode;
}> = ({ icon: Icon, title, detail, action }) => (
  <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-2.5">
    <div className="w-11 h-11 rounded-squircle-md bg-spectrum-card flex items-center justify-center text-spectrum-textDim shadow-raised">
      <Icon className="w-[18px] h-[18px]" />
    </div>
    <p className="text-ui font-medium text-spectrum-text">{title}</p>
    {detail && <p className="text-ui-sm text-spectrum-textDim max-w-[230px] leading-relaxed">{detail}</p>}
    {action}
  </div>
);
