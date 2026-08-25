/* ═══════════════════════════════════════════════════════════════════
   Left activity rail.

   Tiles are icon-over-label at a fixed size so the rail keeps a strict
   vertical rhythm. The active tile lifts out of the chrome and is
   anchored by a colour bar on the window edge — the same cue Resolve,
   VS Code and Figma use, and the fastest one to read peripherally.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useLayoutStore, SidebarTab } from '../../store/layoutStore';
import {
  FolderOpen, Music, Type, Subtitles, Layers, Sparkles, Sliders, Wand2,
} from 'lucide-react';

interface TabItem {
  id: SidebarTab;
  label: string;
  icon: React.ElementType;
  hotkey: string;
}

const TABS: TabItem[] = [
  { id: 'media', label: 'Media', icon: FolderOpen, hotkey: '1' },
  { id: 'audio', label: 'Audio', icon: Music, hotkey: '2' },
  { id: 'text', label: 'Text', icon: Type, hotkey: '3' },
  { id: 'captions', label: 'Captions', icon: Subtitles, hotkey: '4' },
  { id: 'transitions', label: 'Trans', icon: Layers, hotkey: '5' },
  { id: 'effects', label: 'VFX', icon: Sparkles, hotkey: '6' },
  { id: 'filters', label: 'Colour', icon: Sliders, hotkey: '7' },
  { id: 'ai', label: 'AI', icon: Wand2, hotkey: '8' },
];

export const SidebarNav: React.FC = () => {
  const activeTab = useLayoutStore((s) => s.activeTab);
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);
  const isCollapsed = useLayoutStore((s) => s.isSidebarCollapsed);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);

  return (
    <nav className="w-[58px] flex-shrink-0 bg-spectrum-panelHeader border-r border-line flex flex-col items-center py-2 gap-1 z-20">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id && !isCollapsed;

        return (
          <button
            key={tab.id}
            onClick={() => (activeTab === tab.id ? toggleSidebar() : setActiveTab(tab.id))}
            className={`group relative w-[46px] h-[46px] rounded-squircle-sm flex flex-col items-center justify-center gap-[3px] transition-colors duration-fast ${
              isActive
                ? 'bg-spectrum-card text-spectrum-text shadow-raised'
                : 'text-spectrum-textDim hover:text-spectrum-text hover:bg-white/[0.045]'
            }`}
            title={`${tab.label} · ${tab.hotkey}`}
          >
            {/* Edge marker — flush to the window, not to the tile. */}
            <span
              className={`absolute -left-2 top-3 bottom-3 w-[3px] rounded-r-full bg-spectrum-accent transition-opacity duration-fast ${
                isActive ? 'opacity-100' : 'opacity-0'
              }`}
            />
            <Icon
              className={`w-[18px] h-[18px] transition-colors ${isActive ? 'stroke-[1.9]' : 'stroke-[1.6]'}`}
            />
            <span className={`text-[9px] leading-none tracking-tight ${isActive ? 'font-semibold' : 'font-medium'}`}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
