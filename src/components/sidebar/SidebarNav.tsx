/* ═══════════════════════════════════════════════════════════════════
   Left activity rail.

   Tiles are icon-over-label at a fixed size so the rail keeps a strict
   vertical rhythm. The active tile lifts out of the chrome by light —
   a raised fill, a hairline and a filled glyph.

   The orange bar that used to sit flush to the window edge is gone.
   It was a fourth signal for a binary that already had three, and it
   is the same correction HANDOVER §7 made on the home screen twice.
   The geometry and the states live in `.rail-tile` in index.css, so
   anything else that needs this tile gets the identical one.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useLayoutStore, SidebarTab } from '../../store/layoutStore';
import {
  FolderOpen, Music, Type, Subtitles, Layers, Sparkle, Sliders, Zap, Blocks, Image,
} from '../ui/icons';

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
  /* `Sparkle` is the platform's ONE AI mark (HANDOVER, Iconography).
     VFX is not AI, and wearing the same symbol as the AI panel two
     tiles below it is how a set of one drifts back to a set of three. */
  { id: 'effects', label: 'VFX', icon: Zap, hotkey: '6' },
  { id: 'filters', label: 'Colour', icon: Sliders, hotkey: '7' },
  { id: 'skills', label: 'Skills', icon: Blocks, hotkey: '8' },
  { id: 'ai', label: 'AI', icon: Sparkle, hotkey: '9' },
  { id: 'image', label: 'Image', icon: Image, hotkey: '0' },
];

export const SidebarNav: React.FC = () => {
  const activeTab = useLayoutStore((s) => s.activeTab);
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);
  const isCollapsed = useLayoutStore((s) => s.isSidebarCollapsed);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);

  return (
    <nav className="editor-rail w-[60px] flex-shrink-0 bg-spectrum-panelHeader border-r border-line flex flex-col items-center py-2 gap-0.5 z-20">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id && !isCollapsed;

        return (
          <button
            key={tab.id}
            onClick={() => (activeTab === tab.id ? toggleSidebar() : setActiveTab(tab.id))}
            className={`group rail-tile ${isActive ? 'rail-tile-active' : ''}`}
            title={`${tab.label} · ${tab.hotkey}`}
            aria-current={isActive ? 'page' : undefined}
            aria-label={`${tab.label} · ${tab.hotkey}`}>
            {/* The reason the icon set changed. A stroke-only set can
                signal "selected" with colour alone; a filled glyph reads
                as selected at 18px before any colour is processed. */}
            <Icon className="w-[18px] h-[18px] transition-colors" weight={isActive ? 'fill' : 'regular'} />
            <span className={`text-micro leading-none tracking-tight ${isActive ? 'font-semibold' : 'font-medium'}`}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
