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

/*
  The height rhythm every control snaps to.

  These used to be hard-coded pixels that HAPPENED to sit near the
  --h-* tokens without being them, which is the worst of both: a token
  sheet that looks authoritative and a control set that ignores it. Now
  the token is the value, so moving the rhythm moves the buttons.

  Horizontal padding and the icon gap come off the spacing scale for the
  same reason — px-2 / px-2 / px-3 / px-4 was four numbers chosen four
  times, and `gap-1.5` beside `gap-1` was a 2px difference nobody could
  see but every reviewer had to check.
*/
const SIZE: Record<ButtonSize, string> = {
  xs: 'h-[var(--h-xs)] px-tight gap-hair text-ui-xs',
  sm: 'h-[var(--h-sm)] px-control gap-tight text-ui-sm',
  md: 'h-[var(--h-md)] px-panel gap-tight text-ui-sm',
  lg: 'h-[var(--h-lg)] px-section gap-control text-ui-lg',
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
  size?: 22 | 26 | 28 | 30 | 36;
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
  const h = size === 'md' ? 'h-[var(--h-md)]' : size === 'lg' ? 'h-[var(--h-lg)]' : 'h-[var(--h-sm)]';
  return (
    <div className={`relative flex-shrink-0 ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(
          (typeof value === 'number' ? Number(e.target.value) : e.target.value) as T
        )}
        className={`pro-input appearance-none ${h} text-ui-sm pl-control pr-7 cursor-pointer w-full`}
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

/* ── The rest of the TDS vocabulary ─────────────────────────────────

   Everything below existed in this app as markup copied between files,
   and each one is here for the same reason the controls above are: so
   there is ONE decision about what a section label or a keycap looks
   like, and changing it changes it everywhere.

   They are the same primitives Teminali Code ships, at the same
   measurements, so a panel can be moved between the two products
   without being re-styled on arrival.
   ─────────────────────────────────────────────────────────────────── */

/**
 * A heading over a group of controls.
 *
 * SENTENCE CASE, body size, one step down the ink ramp, separated by
 * space — never uppercase, never wide-tracked, never ruled off. An
 * uppercase 10px label with 0.13em tracking is the typographic grammar
 * of a hardware faceplate, and six of them stacked down a sidebar shout
 * six times about six things nobody is looking at.
 */
export const SectionLabel: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => (
  <div className={`section-label px-control pb-tight pt-panel ${className}`}>{children}</div>
);

/**
 * A row in a list — nav item, media item, conversation.
 *
 * The measurements are not approximate: a 30px row on a 31px pitch,
 * inset 8px from each edge, an 8px corner, a 16px glyph. Every list in
 * this app used to draw its own, which is why no two of them ever lined
 * up with each other.
 */
export const Row: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: React.ElementType;
    /** Aligns a row that has no icon with the rows that do. */
    indent?: boolean;
    active?: boolean;
    trailing?: React.ReactNode;
  }
> = ({ icon: Icon, indent, active, trailing, children, className = '', ...rest }) => (
  <button
    className={`row-item ${active ? 'row-item-active' : ''} text-ui-lg ${className}`}
    {...rest}
  >
    {Icon ? (
      <Icon className="w-4 h-4 flex-shrink-0" />
    ) : indent ? (
      <span className="w-4 flex-shrink-0" aria-hidden="true" />
    ) : null}
    <span className="min-w-0 flex-1 truncate text-left">{children}</span>
    {trailing}
  </button>
);

/** A keycap. Mono, because a shortcut is typed, not read. */
export const Kbd: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <kbd
    className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-hair rounded-squircle-2xs
      bg-spectrum-cardHover border border-line text-spectrum-textDim font-mono text-micro ${className}`}
  >
    {children}
  </kbd>
);

/** Code inside a sentence. Flush fill, no ring — see --accent-code-*. */
export const InlineCode: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <code
    className={`px-hair py-[1px] rounded-squircle-2xs bg-spectrum-cardHover
      text-spectrum-textBright font-mono text-ui-sm ${className}`}
  >
    {children}
  </code>
);

/**
 * An empty state.
 *
 * It says what is missing and what to do about it, in words. "State is
 * legible": a panel that is empty because nothing has been imported and
 * a panel that is empty because a filter matched nothing are two
 * different facts, and a centred glyph tells you neither.
 */
export const EmptyState: React.FC<{
  icon?: React.ElementType;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}> = ({ icon: Icon, title, hint, action, className = '' }) => (
  <div
    className={`flex flex-col items-center justify-center gap-tight px-section py-group text-center ${className}`}
  >
    {Icon && <Icon className="w-5 h-5 text-spectrum-textDisabled" aria-hidden="true" />}
    <div className="text-ui-lg text-spectrum-textMuted">{title}</div>
    {hint && <div className="text-ui-sm text-spectrum-textFaint max-w-[280px]">{hint}</div>}
    {action && <div className="pt-tight">{action}</div>}
  </div>
);
