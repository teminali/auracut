/* ═══════════════════════════════════════════════════════════════════
   The shared control set.

   Everything in here existed already — as a CSS class applied by hand
   in forty places, or as markup copied between three components. The
   classes are still the implementation; these are the ONE place that
   decides which class a given control wears, so a control cannot be a
   different shape in the inspector than it is in the toolbar.

   Each of these replaced a real duplication, and the duplication is
   named on the component so nobody re-creates it:

     Button      `.pro-btn` / `.pro-btn-filled` / `.btn-primary` were
                 applied by hand at 250+ call sites, with the size and
                 the gap re-typed each time.
     IconButton  a private component inside `TimelineToolbar`, copied
                 by eye everywhere else.
     Select      `pro-input appearance-none` plus an absolutely
                 positioned chevron, in three files.
     StatusDot   a coloured 6px circle with three states, in nine.
     Thumb       the media/skill frame with its badges, in three.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { ChevronDown } from './icons';

/* ── Button ─────────────────────────────────────────────────────── */

export type ButtonVariant = 'ghost' | 'filled' | 'primary' | 'danger';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  ghost: 'pro-btn',
  filled: 'pro-btn-filled',
  primary: 'btn-primary',
  danger: 'btn-ghost-danger',
};

/* The height rhythm every control snaps to — see --h-* in index.css. */
const SIZE: Record<ButtonSize, string> = {
  xs: 'h-[22px] px-2 gap-1 text-ui-xs',
  sm: 'h-[26px] px-2.5 gap-1.5 text-ui-sm',
  md: 'h-[30px] px-3 gap-1.5 text-ui-sm',
  lg: 'h-[38px] px-4 gap-2 text-ui-lg',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Accent on-state, for a toggle that is currently on. */
  on?: boolean;
  icon?: React.ElementType;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'filled', size = 'sm', on, icon: Icon, className = '', children, ...rest
}) => (
  <button
    className={`${VARIANT[variant]} ${SIZE[size]} font-medium ${on ? 'pro-btn-active' : ''} ${className}`}
    {...rest}
  >
    {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" />}
    {children}
  </button>
);

/* ── Icon button ────────────────────────────────────────────────── */

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ElementType;
  /** Required: an icon with no name is a button nobody can reach. */
  title: string;
  variant?: ButtonVariant;
  size?: 22 | 26 | 28 | 30;
  on?: boolean;
  /** A count pinned to the corner, e.g. how many markers exist. */
  badge?: number;
}

export const IconButton: React.FC<IconButtonProps> = ({
  icon: Icon, title, variant = 'ghost', size = 26, on, badge, className = '', ...rest
}) => (
  <button
    className={`${VARIANT[variant]} relative flex-shrink-0 ${on ? 'pro-btn-active' : ''} ${className}`}
    style={{ width: size, height: size }}
    title={title}
    aria-label={title}
    {...rest}
  >
    <Icon className="w-3.5 h-3.5" />
    {badge !== undefined && badge > 0 && (
      <span className="pro-badge">{badge > 99 ? '99+' : badge}</span>
    )}
  </button>
);

/* ── Select ─────────────────────────────────────────────────────── */

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
}

/**
 * A real `<select>`, drawn as one of ours.
 *
 * It gets keyboard, type-ahead and the platform popup for free, and
 * every hand-rolled replacement in this repo's history lost at least
 * one of the three. The chevron is ours because one OS widget in a
 * screen of drawn ones is more obviously foreign than eight would be.
 */
export function Select<T extends string | number>({
  value, options, onChange, title, size = 'sm', className = '',
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  title: string;
  size?: ButtonSize;
  className?: string;
}) {
  const h = size === 'md' ? 'h-[30px]' : size === 'lg' ? 'h-[38px]' : 'h-[26px]';
  return (
    <div className={`relative flex-shrink-0 ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(
          (typeof value === 'number' ? Number(e.target.value) : e.target.value) as T
        )}
        className={`pro-input appearance-none ${h} text-ui-sm pl-2.5 pr-7 cursor-pointer w-full`}
        title={title}
        aria-label={title}
      >
        {options.map((o) => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown
        className="w-3 h-3 text-spectrum-textDim absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
        aria-hidden="true"
      />
    </div>
  );
}

/* ── Status dot ─────────────────────────────────────────────────── */

/**
 * THREE states, never two.
 *
 * `unknown` is not a decorative third option: HANDOVER §3 records this
 * codebase getting it wrong three times in a row. A dot that is green
 * or grey has to claim one of them before anything has been looked up,
 * and "not connected" shown during that window is a claim the app
 * cannot support. Unknown pulses and says nothing.
 */
export const StatusDot: React.FC<{
  state: 'on' | 'off' | 'unknown' | 'busy' | 'error';
  className?: string;
}> = ({ state, className = '' }) => (
  <span
    className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
      state === 'on' ? 'bg-spectrum-green'
        : state === 'busy' ? 'bg-spectrum-accent animate-pulse'
          : state === 'error' ? 'bg-spectrum-red'
            : state === 'unknown' ? 'bg-spectrum-textFaint animate-pulse'
              : 'bg-spectrum-textFaint'
    } ${className}`}
    aria-hidden="true"
  />
);
