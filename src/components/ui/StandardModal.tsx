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
  iconColor = '#f0a173',
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
      ? 'text-[#9fc9ab] bg-[#9fc9ab]/10 border-[#9fc9ab]/25'
      : badge?.variant === 'amber'
        ? 'text-[#f5a524] bg-[#f5a524]/10 border-[#f5a524]/25'
        : badge?.variant === 'blue'
          ? 'text-[#4c9dff] bg-[#4c9dff]/10 border-[#4c9dff]/25'
          : 'text-[#8a8a8a] bg-[#8a8a8a]/10 border-[#8a8a8a]/25';

  const badgeDotClass =
    badge?.variant === 'green'
      ? 'bg-[#9fc9ab]'
      : badge?.variant === 'amber'
        ? 'bg-[#f5a524]'
        : badge?.variant === 'blue'
          ? 'bg-[#4c9dff]'
          : 'bg-[#8a8a8a]';

  return (
    <div className="scrim" onClick={onClose} role="presentation">
      <div
        onClick={(e) => e.stopPropagation()}
        className={`modal-shell ${maxWidth} max-w-[94vw] ${maxHeight} flex flex-col rounded-2xl bg-[#11141a] border border-[#232936] shadow-[0_24px_64px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.06)] overflow-hidden`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-white/[0.06] bg-[#11141a] sticky top-0 z-10 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {Icon && (
              <span className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4" style={{ color: iconColor }} />
              </span>
            )}
            <span className="text-[17px] font-semibold text-white tracking-tight truncate">{title}</span>
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
              className="w-7 h-7 rounded-lg text-[#9ca3af] hover:text-white hover:bg-white/[0.06] flex items-center justify-center transition-colors"
              aria-label="Close dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Stats Row */}
        {stats && stats.length > 0 && (
          <div
            className={`grid grid-cols-${Math.min(stats.length, 4)} gap-3 p-4 border-b border-[#232936] bg-[#0b0e13] flex-shrink-0`}
            style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
          >
            {stats.map((stat, i) => (
              <div key={i} className="p-3 rounded-lg bg-[#11141a] border border-[#232936] text-center min-w-0">
                <span className="block text-ui-xl font-bold text-white font-mono tabular-nums truncate">
                  {stat.value}
                </span>
                <span className="block font-mono text-ui-xs font-bold text-[#848d9a] uppercase tracking-wider mt-0.5 truncate">
                  {stat.label}
                </span>
                {stat.hint && (
                  <span className="block text-ui-xs text-[#64748b] truncate mt-0.5 font-mono">
                    {stat.hint}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Tab Row */}
        {tabs && tabs.length > 0 && (
          <div className="flex items-center gap-6 px-6 border-b border-[#232936] bg-[#11141a] flex-shrink-0">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange?.(tab.id)}
                  className={`relative h-10 px-1 text-ui font-semibold transition-colors flex items-center gap-1.5 ${
                    active ? 'text-white' : 'text-[#848d9a] hover:text-white'
                  }`}
                >
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className="font-mono text-ui-xs opacity-70">({tab.count})</span>
                  )}
                  {active && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#f97316] rounded-t" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Search Row */}
        {onSearchChange && (
          <div className="p-4 border-b border-[#232936] bg-[#0b0e13] flex-shrink-0">
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[#11141a] border border-[#232936] focus-within:border-[#f97316] transition-colors">
              <Search className="w-4 h-4 text-[#64748b] flex-shrink-0" />
              <input
                value={searchQuery ?? ''}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="flex-1 bg-transparent outline-none text-ui-sm text-white placeholder:text-[#64748b]"
              />
            </div>
          </div>
        )}

        {/* Main Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="px-6 py-3 border-t border-[#232936] bg-[#0b0e13] flex items-center gap-3 font-mono text-ui-xs text-[#848d9a] flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
