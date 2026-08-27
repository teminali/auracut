/* ═══════════════════════════════════════════════════════════════════
   CapCut's "More tools" row: eight tiles that launch a feature.

   Kerf's eight are its eight editor panels, which is what the row is
   for — a way into a capability without going through a menu. Each
   tile opens the editor with that panel already selected, so a tile
   that looks like it does something does exactly that and no more.

   The generic version of this row — an outlined square with a
   centred icon, repeated eight times — is the single most recognisable
   AI-generated layout there is, and giving each square a border and a
   shadow makes it worse rather than better.

   The fix is not to shrink the container, which is what was tried
   first: a 64px box centred in a 130px column leaves 66px of dead
   space between every tile and its neighbour, the eight boxes stop
   touching the grid they are laid out on, and the row reads as eight
   objects scattered across a band rather than as one band. THE CELL IS
   THE TILE now. The hover target, the fill and the label share one
   rectangle, the rectangles are the grid columns, and the row lines up
   with the hero above it and the projects wall below it because all
   three are measured from the same edges.

   What keeps it quiet is weight, not size: 1.8% of white and the
   faintest of the three hairlines. This is chrome, so it stays behind
   the hero until the cursor arrives.

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
  <section className="rise-in rise-3">
    <div className="section-rule" aria-hidden="true" />
    <h2 className="section-head mt-7">More tools</h2>

    <div className="grid grid-cols-8 gap-3 mt-5">
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
            className="tool-tile group relative rounded-squircle-lg h-[92px]
                       flex flex-col items-center justify-center gap-3 px-2"
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
