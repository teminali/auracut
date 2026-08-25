import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useUiStore } from '../../store/uiStore';

export const ContextMenu: React.FC = () => {
  const menu = useUiStore((s) => s.contextMenu);
  const close = useUiStore((s) => s.closeContextMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  // Flip the menu when it would run off the edge of the window.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPosition({
      x: menu.x + rect.width > window.innerWidth - 8 ? Math.max(8, menu.x - rect.width) : menu.x,
      y: menu.y + rect.height > window.innerHeight - 8 ? Math.max(8, menu.y - rect.height) : menu.y,
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [menu, close]);

  if (!menu) return null;

  return (
    <div
      ref={ref}
      style={{ left: position.x, top: position.y }}
      className="fixed z-[80] min-w-[196px] py-1 rounded-squircle-sm bg-spectrum-panel border border-line-strong shadow-pop animate-scale-in"
    >
      {menu.items.map((item) => {
        const Icon = item.icon;
        return (
          <React.Fragment key={item.id}>
            {item.separatorBefore && <div className="my-1 h-px bg-line" />}
            <button
              disabled={item.disabled}
              onClick={() => {
                close();
                requestAnimationFrame(() => item.onSelect());
              }}
              className={`w-full px-2.5 h-7 flex items-center gap-2 text-left text-[12px] transition-colors ${
                item.disabled
                  ? 'text-spectrum-textFaint cursor-not-allowed'
                  : item.danger
                    ? 'text-spectrum-textMuted hover:bg-spectrum-red/12 hover:text-spectrum-red'
                    : 'text-spectrum-textMuted hover:bg-spectrum-hover hover:text-spectrum-text'
              }`}
            >
              {Icon && <Icon className="w-3 h-3 flex-shrink-0" />}
              <span className="flex-1 truncate">{item.label}</span>
              {item.shortcut && <span className="kbd flex-shrink-0">{item.shortcut}</span>}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};
