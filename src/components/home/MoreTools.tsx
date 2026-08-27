/* ═══════════════════════════════════════════════════════════════════
   CapCut's "More tools" row: eight tiles that launch a feature.

   Kerf's eight are its eight editor panels, which is what the row is
   for — a way into a capability without going through a menu. Each
   tile opens the editor with that panel already selected, so a tile
   that looks like it does something does exactly that and no more.

   The generic version of this row — an outlined square with a
   centred icon, repeated eight times — is the single most recognisable
   AI-generated layout there is, and giving each square a border and a
   shadow makes it worse rather than better: eight bordered boxes in a
   row is eight things competing with the one thing above them.

   So they are `.ghost-tile`. No border, no fill and no shadow until
   the cursor arrives. At rest this row is eight icons and eight words
   on the page, which is what it actually is.

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
    <h2 className="section-head">More tools</h2>

    <div className="grid grid-cols-8 gap-2.5 mt-5">
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
            className="group flex flex-col items-center gap-2.5 pt-1"
          >
            {/* The container belongs to the ICON, which is what needs
                grouping — a bare glyph floating over the page has
                nothing holding it to its label. Wrapping the whole
                tile instead put eight bordered boxes in a row and made
                the section shout louder than the hero above it. */}
            <span
              className="w-16 h-16 rounded-squircle-lg bg-[#16191f] flex items-center justify-center
                         relative transition-colors duration-base ease-snap group-hover:bg-[#1f242c]"
            >
              <Icon
                className="w-6 h-6 text-spectrum-textMuted
                           transition-colors duration-fast group-hover:text-spectrum-text"
              />
              {tool.ai && (
                <span
                  className="absolute top-1.5 right-1.5 h-[14px] px-[5px] rounded-[4px]
                             bg-spectrum-blue/16 text-spectrum-blue text-[8.5px] font-bold
                             tracking-[0.06em] flex items-center"
                  aria-hidden="true"
                >
                  AI
                </span>
              )}
            </span>

            <span className="text-ui font-medium text-spectrum-textDim text-center leading-tight
                             transition-colors duration-fast group-hover:text-spectrum-text">
              {tool.label}
            </span>
          </button>
        );
      })}
    </div>
  </section>
);
