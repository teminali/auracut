/* ⌘K palette — every editor action, searchable. */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { useLayoutStore } from '../../store/layoutStore';
import { EFFECT_REGISTRY } from '../../engine/effectsRegistry';
import { executeTool } from '../../mcp/toolRegistry';
import { MOTION_PRESET_LABELS } from '../../store/timelineStore';
import { ASPECT_DIMENSIONS, AspectRatio } from '../../types/edl';
import {
  Search, Scissors, Copy, Trash2, Flag, Sparkles, Play, Undo2, Redo2,
  Layers, Snowflake, RotateCcw, Unlink, Music4, Subtitles, Download,
  Smartphone, Magnet, Wand2, Command as CommandIcon,
} from 'lucide-react';

interface CommandItem {
  id: string;
  label: string;
  group: string;
  icon: React.ElementType;
  shortcut?: string;
  keywords?: string;
  run: () => void;
}

export const CommandPalette: React.FC = () => {
  const isOpen = useUiStore((s) => s.isCommandPaletteOpen);
  const close = useUiStore((s) => s.closeCommandPalette);
  const pushToast = useUiStore((s) => s.pushToast);

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<CommandItem[]>(() => {
    const t = () => useTimelineStore.getState();
    const p = () => useProjectStore.getState();
    const l = () => useLayoutStore.getState();
    const selected = () => t().selectedClipIds[0];

    const base: CommandItem[] = [
      /* Edit */
      { id: 'split', label: 'Split at playhead', group: 'Edit', icon: Scissors, shortcut: 'S', run: () => t().splitAtPlayhead() },
      { id: 'delete', label: 'Delete selection', group: 'Edit', icon: Trash2, shortcut: '⌫', run: () => t().deleteSelected() },
      { id: 'duplicate', label: 'Duplicate clip', group: 'Edit', icon: Copy, shortcut: '⌘D', run: () => { const id = selected(); if (id) t().duplicateClip(id); } },
      { id: 'undo', label: 'Undo', group: 'Edit', icon: Undo2, shortcut: '⌘Z', run: () => t().undo() },
      { id: 'redo', label: 'Redo', group: 'Edit', icon: Redo2, shortcut: '⌘⇧Z', run: () => t().redo() },
      { id: 'group', label: 'Group selected clips', group: 'Edit', icon: Layers, shortcut: '⌘G', run: () => t().groupSelected() },
      { id: 'freeze', label: 'Freeze frame here', group: 'Edit', icon: Snowflake, run: () => { const id = selected(); if (id) t().freezeFrame(id, t().playheadMs); } },
      { id: 'reverse', label: 'Reverse clip', group: 'Edit', icon: RotateCcw, run: () => { const id = selected(); if (id) t().reverseClip(id); } },
      { id: 'detach', label: 'Detach audio', group: 'Edit', icon: Unlink, run: () => { const id = selected(); if (id) t().detachAudio(id); } },
      { id: 'snap', label: 'Toggle snapping', group: 'Edit', icon: Magnet, shortcut: 'N', run: () => t().toggleSnapping() },
      { id: 'ripple', label: 'Toggle ripple edit', group: 'Edit', icon: Layers, shortcut: 'R', run: () => t().toggleRippleEdit() },

      /* Playback */
      { id: 'play', label: 'Play / pause', group: 'Playback', icon: Play, shortcut: 'Space', run: () => t().togglePlay() },
      { id: 'marker', label: 'Add marker', group: 'Playback', icon: Flag, shortcut: 'M', run: () => t().addMarker(t().playheadMs) },
      { id: 'start', label: 'Go to start', group: 'Playback', icon: Play, shortcut: 'Home', run: () => t().setPlayheadMs(0) },
      { id: 'beats', label: 'Detect beats in the music', group: 'Playback', icon: Music4, run: async () => {
        const r = await executeTool('detect_beats', {}, 'Command palette');
        pushToast(r.success
          ? { kind: 'success', title: 'Beats detected' }
          : { kind: 'error', title: 'Beat detection failed', detail: r.error });
      } },

      /* Create */
      { id: 'text', label: 'Add text layer', group: 'Create', icon: Wand2, run: () => {
        const tracks = t().tracks;
        const textTrack = tracks.find((x) => x.type === 'text') ?? tracks[0];
        t().addTextLayer(textTrack.id, 'Your text here', t().playheadMs);
      } },
      { id: 'rect', label: 'Add rectangle', group: 'Create', icon: Wand2, run: () => {
        const tracks = t().tracks;
        const overlay = tracks.find((x) => x.type === 'overlay') ?? tracks[0];
        t().addShapeLayer(overlay.id, 'rectangle', t().playheadMs);
      } },
      { id: 'circle', label: 'Add ellipse', group: 'Create', icon: Wand2, run: () => {
        const tracks = t().tracks;
        const overlay = tracks.find((x) => x.type === 'overlay') ?? tracks[0];
        t().addShapeLayer(overlay.id, 'ellipse', t().playheadMs);
      } },
      { id: 'adjustment', label: 'Add adjustment layer', group: 'Create', icon: Layers, run: () => {
        t().addAdjustmentLayer(t().tracks[0].id, t().playheadMs);
      } },

      /* AI */
      { id: 'captions', label: 'Generate auto captions', group: 'AI', icon: Subtitles, run: async () => {
        const r = await executeTool('generate_auto_captions', { language: 'sw' }, 'Command palette');
        pushToast(r.success ? { kind: 'success', title: 'Captions generated' } : { kind: 'error', title: 'Failed', detail: r.error });
      } },
      { id: 'copilot', label: 'Open the AI copilot', group: 'AI', icon: Sparkles, shortcut: '⌘J', run: () => p().setCopilotOpen(true) },

      /* Project */
      { id: 'export', label: 'Export video', group: 'Project', icon: Download, shortcut: '⌘E', run: () => p().setExportModalOpen(true) },
      { id: 'reset-layout', label: 'Reset panel layout', group: 'Project', icon: Layers, run: () => l().resetLayout() },
    ];

    /* Aspect ratios */
    for (const ratio of Object.keys(ASPECT_DIMENSIONS) as AspectRatio[]) {
      base.push({
        id: `aspect-${ratio}`,
        label: `Set canvas to ${ratio} · ${ASPECT_DIMENSIONS[ratio].label}`,
        group: 'Project',
        icon: Smartphone,
        keywords: ratio,
        run: () => p().setAspectRatio(ratio),
      });
    }

    /* Every effect is directly reachable */
    for (const effect of EFFECT_REGISTRY) {
      base.push({
        id: `fx-${effect.type}`,
        label: `Add effect · ${effect.label}`,
        group: 'Effects',
        icon: Sparkles,
        keywords: `${effect.type} ${effect.category} ${effect.description}`,
        run: () => {
          const ids = t().selectedClipIds;
          if (ids.length === 0) {
            pushToast({ kind: 'error', title: 'Select a layer first' });
            return;
          }
          for (const id of ids) t().addEffect(id, effect.type);
        },
      });
    }

    /* Motion presets */
    for (const preset of MOTION_PRESET_LABELS) {
      base.push({
        id: `motion-${preset.id}`,
        label: `Animate · ${preset.label}`,
        group: 'Motion',
        icon: Wand2,
        keywords: preset.hint,
        run: () => {
          const id = selected();
          if (!id) {
            pushToast({ kind: 'error', title: 'Select a layer first' });
            return;
          }
          t().applyMotionPreset(id, preset.id);
        },
      });
    }

    return base;
  }, [pushToast]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands.slice(0, 40);

    // Rank: label prefix > label contains > keyword contains.
    return commands
      .map((cmd) => {
        const label = cmd.label.toLowerCase();
        const keywords = (cmd.keywords ?? '').toLowerCase();
        let score = -1;
        if (label.startsWith(needle)) score = 100;
        else if (label.includes(needle)) score = 60;
        else if (keywords.includes(needle)) score = 30;
        else if (cmd.group.toLowerCase().includes(needle)) score = 10;
        return { cmd, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((r) => r.cmd);
  }, [commands, query]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (!isOpen) setQuery('');
  }, [isOpen]);

  // Keep the highlighted row visible.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!isOpen) return null;

  const runAt = (index: number) => {
    const cmd = results[index];
    if (!cmd) return;
    close();
    // Defer so the palette is gone before the action redraws anything.
    requestAnimationFrame(() => cmd.run());
  };

  return (
    <div className="scrim items-start pt-[12vh]" onClick={close}>
      <div onClick={(e) => e.stopPropagation()} className="modal-shell w-[580px] max-w-[92vw] flex flex-col max-h-[62vh]">
        <div className="flex items-center gap-2 px-3 h-11 border-b border-line flex-shrink-0">
          <Search className="w-4 h-4 text-spectrum-textDim flex-shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(results.length - 1, c + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
              if (e.key === 'Enter') { e.preventDefault(); runAt(cursor); }
              if (e.key === 'Escape') { e.preventDefault(); close(); }
            }}
            placeholder="Search commands, effects, animations…"
            className="flex-1 bg-transparent outline-none text-[13px] text-spectrum-text placeholder:text-spectrum-textFaint"
          />
          <span className="kbd">esc</span>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto py-1">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12px] text-spectrum-textDim">
              Nothing matches “{query}”.
            </p>
          ) : (
            results.map((cmd, index) => {
              const Icon = cmd.icon;
              const active = index === cursor;
              const showGroup = index === 0 || results[index - 1].group !== cmd.group;

              return (
                <React.Fragment key={cmd.id}>
                  {showGroup && (
                    <div className="px-3 pt-2 pb-1 text-[9px] font-semibold text-spectrum-textFaint uppercase tracking-wider">
                      {cmd.group}
                    </div>
                  )}
                  <button
                    data-index={index}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => runAt(index)}
                    className={`w-full px-3 h-8 flex items-center gap-2.5 text-left transition-colors ${
                      active ? 'bg-spectrum-accentSoft' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${active ? 'text-spectrum-accent' : 'text-spectrum-textDim'}`} />
                    <span className={`flex-1 text-[12px] truncate ${active ? 'text-spectrum-text' : 'text-spectrum-textMuted'}`}>
                      {cmd.label}
                    </span>
                    {cmd.shortcut && <span className="kbd flex-shrink-0">{cmd.shortcut}</span>}
                  </button>
                </React.Fragment>
              );
            })
          )}
        </div>

        <div className="px-3 h-8 border-t border-line flex items-center gap-3 text-[10px] text-spectrum-textFaint flex-shrink-0">
          <span className="flex items-center gap-1"><span className="kbd">↑↓</span> navigate</span>
          <span className="flex items-center gap-1"><span className="kbd">↵</span> run</span>
          <span className="flex items-center gap-1 ml-auto"><CommandIcon className="w-2.5 h-2.5" /> {commands.length} commands</span>
        </div>
      </div>
    </div>
  );
};
