import React from 'react';
import { X, Search } from './icons';

export interface StandardModalStat {
  label: string;
  value: string;
  hint?: string;
}

export interface StandardModalTab {
  id: string;
  label: string;
  count?: number;
}

export interface StandardModalBadge {
  text: string;
  variant?: 'green' | 'amber' | 'blue' | 'gray';
  pulse?: boolean;
}

export interface StandardModalProps {
  isOpen?: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ElementType;
  iconColor?: string;
  badge?: StandardModalBadge;
  stats?: StandardModalStat[];
  tabs?: StandardModalTab[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchPlaceholder?: string;
  headerActions?: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
  maxHeight?: string;
  children: React.ReactNode;
}

export const StandardModal: React.FC<StandardModalProps> = ({
  isOpen = true,
  onClose,
  title,
  icon: Icon,
  iconColor = 'var(--accent-ink)',
  badge,
  stats,
  tabs,
  activeTab,
  onTabChange,
  searchQuery,
  onSearchChange,
  searchPlaceholder = 'Search…',
  headerActions,
  footer,
  maxWidth = 'w-[680px]',
  maxHeight = 'max-h-[85vh]',
  children,
}) => {
  if (!isOpen) return null;

  const badgeColorClass =
    badge?.variant === 'green'
      ? 'text-spectrum-green bg-spectrum-green/10 border-spectrum-green/25'
      : badge?.variant === 'amber'
        ? 'text-spectrum-amber bg-spectrum-amber/10 border-spectrum-amber/25'
        : badge?.variant === 'blue'
          ? 'text-spectrum-blue bg-spectrum-blue/10 border-spectrum-blue/25'
          : 'text-spectrum-textFaint bg-spectrum-textFaint/10 border-spectrum-textFaint/25';

  const badgeDotClass =
    badge?.variant === 'green'
      ? 'bg-spectrum-green'
      : badge?.variant === 'amber'
        ? 'bg-spectrum-amber'
        : badge?.variant === 'blue'
          ? 'bg-spectrum-blue'
          : 'bg-spectrum-textFaint';

  return (
    <div className="scrim" onClick={onClose} role="presentation">
      <div
        onClick={(e) => e.stopPropagation()}
        className={`modal-shell ${maxWidth} max-w-[94vw] ${maxHeight} flex flex-col rounded-2xl bg-spectrum-panelHeader border border-spectrum-cardHover shadow-modal overflow-hidden`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-spectrum-panelHeader sticky top-0 z-10 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {Icon && (
              <span className="w-8 h-8 rounded-lg bg-spectrum-hover border border-line flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4" style={{ color: iconColor }} />
              </span>
            )}
            <span className="text-display font-semibold text-spectrum-textBright tracking-tight truncate">{title}</span>
            {badge && (
              <span
                className={`font-mono text-ui-xs font-semibold px-2 py-0.5 rounded-[4px] border flex items-center gap-1.5 flex-shrink-0 ${badgeColorClass}`}
              >
                {badge.pulse && (
                  <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${badgeDotClass}`} />
                )}
                {badge.text}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {headerActions}
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg text-spectrum-textDim hover:text-spectrum-textBright hover:bg-spectrum-cardHover flex items-center justify-center transition-colors"
              aria-label="Close dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Stats Row */}
        {stats && stats.length > 0 && (
          <div
            className={`grid grid-cols-${Math.min(stats.length, 4)} gap-3 p-4 border-b border-spectrum-cardHover bg-spectrum-sunken flex-shrink-0`}
            style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
          >
            {stats.map((stat, i) => (
              <div key={i} className="p-3 rounded-lg bg-spectrum-panelHeader border border-spectrum-cardHover text-center min-w-0">
                <span className="block text-ui-xl font-bold text-spectrum-textBright font-mono tabular-nums truncate">
                  {stat.value}
                </span>
                <span className="block font-mono text-ui-xs font-bold text-spectrum-textFaint uppercase tracking-wider mt-0.5 truncate">
                  {stat.label}
                </span>
                {stat.hint && (
                  <span className="block text-ui-xs text-spectrum-textFaint truncate mt-0.5 font-mono">
                    {stat.hint}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Tab Row */}
        {tabs && tabs.length > 0 && (
          <div className="flex items-center gap-6 px-6 border-b border-spectrum-cardHover bg-spectrum-panelHeader flex-shrink-0">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange?.(tab.id)}
                  className={`relative h-10 px-1 text-ui font-semibold transition-colors flex items-center gap-1.5 ${
                    active ? 'text-spectrum-textBright' : 'text-spectrum-textFaint hover:text-spectrum-textBright'
                  }`}
                >
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className="font-mono text-ui-xs opacity-70">({tab.count})</span>
                  )}
                  {active && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-spectrum-accent rounded-t" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Search Row */}
        {onSearchChange && (
          <div className="p-4 border-b border-spectrum-cardHover bg-spectrum-sunken flex-shrink-0">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-spectrum-panelHeader border border-spectrum-cardHover focus-within:border-spectrum-accent transition-colors">
              <Search className="w-4 h-4 text-spectrum-textFaint flex-shrink-0" />
              <input
                value={searchQuery ?? ''}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="flex-1 bg-transparent outline-none text-ui-sm text-spectrum-textBright placeholder:text-spectrum-textFaint"
              />
            </div>
          </div>
        )}

        {/* Main Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="px-6 py-3 border-t border-spectrum-cardHover bg-spectrum-sunken flex items-center gap-3 font-mono text-ui-xs text-spectrum-textFaint flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
