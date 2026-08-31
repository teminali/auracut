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
        className={`modal-shell ${maxWidth} max-w-[94vw] ${maxHeight} flex flex-col rounded-[3px] bg-[#232323] border border-[#3f3f3f] shadow-[0_18px_44px_rgba(0,0,0,0.6)] overflow-hidden`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#141414] bg-[#232323] sticky top-0 z-10 flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {Icon && <Icon className="w-4 h-4 flex-shrink-0" style={{ color: iconColor }} />}
            <span className="text-ui-xl font-bold text-[#e8e8e8] truncate">{title}</span>
            {badge && (
              <span
                className={`font-mono text-micro font-semibold px-1.5 py-0.5 rounded-[2px] border flex items-center gap-1.5 flex-shrink-0 ${badgeColorClass}`}
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
              className="w-[26px] h-[24px] rounded-[2px] grid place-items-center text-[#989898] hover:text-[#e8e8e8] hover:bg-[#3a3a3a] transition-colors"
              aria-label="Close dialog"
            >
              <X className="w-[15px] h-[15px]" />
            </button>
          </div>
        </div>

        {/* Stats Row */}
        {stats && stats.length > 0 && (
          <div
            className={`grid grid-cols-${Math.min(stats.length, 4)} gap-2.5 p-3.5 border-b border-[#141414] bg-[#1a1a1a] flex-shrink-0`}
            style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
          >
            {stats.map((stat, i) => (
              <div key={i} className="p-2.5 rounded-[2px] bg-[#262626] border border-[#141414] text-center min-w-0">
                <span className="block text-display font-bold text-[#e8e8e8] font-mono tabular-nums truncate">
                  {stat.value}
                </span>
                <span className="block font-mono text-micro font-bold text-[#8a8a8a] uppercase tracking-wider mt-0.5 truncate">
                  {stat.label}
                </span>
                {stat.hint && (
                  <span className="block text-micro text-[#6b6b6b] truncate mt-0.5 font-mono">
                    {stat.hint}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Tab Row */}
        {tabs && tabs.length > 0 && (
          <div className="flex items-center gap-4 px-4 border-b border-[#141414] bg-[#232323] flex-shrink-0">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange?.(tab.id)}
                  className={`relative h-9 px-1 text-ui-lg font-semibold transition-colors flex items-center gap-1.5 ${
                    active ? 'text-[#e8e8e8]' : 'text-[#8a8a8a] hover:text-[#c4c4c4]'
                  }`}
                >
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className="font-mono text-micro opacity-70">({tab.count})</span>
                  )}
                  {active && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#c9622f] rounded-t" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Search Row */}
        {onSearchChange && (
          <div className="p-3 border-b border-[#141414] bg-[#1f1f1f] flex-shrink-0">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-[3px] bg-[#141414] border border-[#3a3a3a]">
              <Search className="w-3.5 h-3.5 text-[#6b6b6b] flex-shrink-0" />
              <input
                value={searchQuery ?? ''}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="flex-1 bg-transparent outline-none text-ui-sm text-[#e8e8e8] placeholder:text-[#6b6b6b]"
              />
            </div>
          </div>
        )}

        {/* Main Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="px-4 h-9 border-t border-[#141414] bg-[#1a1a1a] flex items-center gap-3 font-mono text-ui-xs text-[#6b6b6b] flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
