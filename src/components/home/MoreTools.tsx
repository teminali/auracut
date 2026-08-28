/* ═══════════════════════════════════════════════════════════════════
   The eight editor panels, as tiles.

   In CapCut this row does not exist as a row: its tools ARE the four
   cards at the top of the page. Kerf has eight panels and four entry
   points, so the four keep the reference's saturated-then-plain row
   and the eight sit below it wearing the reference's PLAIN card, which
   is the right relationship. These are launchers for a panel, not ways
   to start work, and they should not compete with the four above.

   The cell is the tile. A 64px box centred in a 130px column leaves
   66px of dead space between every icon and its neighbour, the eight
   boxes stop touching the grid they are laid out on, and the row reads
   as eight objects scattered across a band rather than as one band.

   The AI badge is on the two panels that genuinely run a model:
   captions (Whisper transcription) and the AI tool recipes. Badging
   the other six would be the decoration this codebase keeps deleting.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { SidebarTab } from '../../store/layoutStore';
import {
  FolderOpen, Music, Type, Subtitles, Layers, Zap, Sliders, Sparkle,
} from '../ui/icons';

interface Tool {
  id: SidebarTab;
  label: string;
  icon: React.ElementType;
  ai?: true;
}

const TOOLS: Tool[] = [
  { id: 'media', label: 'Media', icon: FolderOpen },
  { id: 'audio', label: 'Audio', icon: Music },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'captions', label: 'Captions', icon: Subtitles, ai: true },
  { id: 'transitions', label: 'Transitions', icon: Layers },
  { id: 'effects', label: 'Effects', icon: Zap },
  { id: 'filters', label: 'Colour', icon: Sliders },
  { id: 'ai', label: 'AI tools', icon: Sparkle, ai: true },
];

export const MoreTools: React.FC<{ onOpenPanel: (tab: SidebarTab) => void }> = ({ onOpenPanel }) => (
  <section id="hp-tools" className="scroll-mt-4">
    <div className="flex items-center gap-3">
      <h3 className="text-ui-lg font-semibold text-spectrum-textMuted">Panels</h3>
      <span className="flex-1" />
      <span className="section-note hidden sm:block">Opens the editor with that panel selected</span>
    </div>

    <div className="grid grid-cols-8 gap-3 mt-4">
      {TOOLS.map((tool) => {
        const Icon = tool.icon;
        return (
          <button
            key={tool.id}
            data-home="tool"
            data-tab={tool.id}
            onClick={() => onOpenPanel(tool.id)}
            title={`Open the ${tool.label} panel`}
            aria-label={`Open the ${tool.label} panel`}
            className="hp-tile hp-tile-plain group rounded-squircle-lg h-[92px]
                       flex flex-col items-center justify-center gap-2.5 px-2"
          >
            <Icon
              className="w-[22px] h-[22px] text-spectrum-textMuted flex-shrink-0
                         transition-colors duration-fast group-hover:text-spectrum-text"
            />

            <span className="text-ui font-medium text-spectrum-textDim text-center leading-tight truncate max-w-full
                             transition-colors duration-fast group-hover:text-spectrum-text">
              {tool.label}
            </span>

            {tool.ai && (
              <span
                className="absolute top-2 right-2 h-[15px] px-[5px] rounded-[4px]
                           bg-spectrum-blue/[0.14] text-spectrum-blue text-[8.5px] font-bold
                           tracking-[0.06em] flex items-center"
                aria-hidden="true"
              >
                AI
              </span>
            )}
          </button>
        );
      })}
    </div>
  </section>
);
