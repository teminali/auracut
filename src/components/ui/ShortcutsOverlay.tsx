import React from 'react';
import { useUiStore } from '../../store/uiStore';
import {
  X, Keyboard,
} from './icons';

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Playback',
    items: [
      ['Space', 'Play / pause'],
      ['← →', 'Step one frame'],
      ['⇧← ⇧→', 'Jump one second'],
      ['Home / End', 'Go to start / end'],
      ['I / O', 'Set in / out point'],
      ['L', 'Toggle loop'],
      ['M', 'Add marker'],
    ],
  },
  {
    title: 'Editing',
    items: [
      ['S  or  ⌘B', 'Split at playhead'],
      ['⌫ / Delete', 'Delete selection'],
      ['⌘D', 'Duplicate clip'],
      ['⌘G', 'Group selection'],
      ['⌘A', 'Select all on the track'],
      ['N', 'Toggle snapping'],
      ['R', 'Toggle ripple edit'],
      ['⌘Z / ⌘⇧Z', 'Undo / redo'],
    ],
  },
  {
    title: 'Canvas',
    items: [
      ['Arrows', 'Nudge the selected layer'],
      ['⇧ + arrows', 'Nudge by 10px'],
      ['⇧ + drag', 'Constrain to one axis'],
      ['⇧ + resize', 'Lock the aspect ratio'],
      ['⌥ + resize', 'Resize from the centre'],
      ['⇧ + rotate', 'Snap to 15°'],
      ['⌥ + drag', 'Ignore smart guides'],
      ['Esc', 'Cancel the drag'],
    ],
  },
  {
    title: 'View & app',
    items: [
      ['⌘K', 'Command palette'],
      ['⌘J', 'Toggle the AI copilot'],
      ['⌘S / ⌘O', 'Save / open project'],
      ['⌘E', 'Export'],
      ['+ / −', 'Timeline zoom'],
      ['⇧Z', 'Zoom to fit'],
      ['⌘ + wheel', 'Zoom around the cursor'],
      ['1 – 8', 'Switch sidebar tab'],
      ['?', 'This panel'],
    ],
  },
];

export const ShortcutsOverlay: React.FC = () => {
  const isOpen = useUiStore((s) => s.isShortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);

  if (!isOpen) return null;

  return (
    <div className="scrim" onClick={() => setOpen(false)}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-shell w-[720px] max-w-[92vw] max-h-[82vh] flex flex-col rounded-2xl bg-[#11141a] border border-[#232936] shadow-[0_24px_64px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.06)] overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <div className="panel-header px-6 py-4.5 border-b border-white/[0.06] bg-[#11141a] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center flex-shrink-0">
              <Keyboard className="w-4 h-4 text-[#f97316]" />
            </span>
            <span className="text-[17px] font-semibold text-white tracking-tight">Keyboard shortcuts</span>
          </div>
          <button onClick={() => setOpen(false)} className="w-7 h-7 rounded-lg text-[#9ca3af] hover:text-white hover:bg-white/[0.06] flex items-center justify-center transition-colors" aria-label="Close the shortcuts sheet">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 gap-x-8 gap-y-6">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-ui-xs font-bold text-white uppercase tracking-wider mb-3">{group.title}</h3>
              <div className="space-y-2">
                {group.items.map(([keys, label]) => (
                  <div key={keys} className="flex items-center justify-between gap-3 py-1 border-b border-white/[0.03]">
                    <span className="text-ui-sm text-[#94a3b8] truncate">{label}</span>
                    <span className="font-mono text-ui-xs px-2 py-0.5 rounded-[4px] bg-[#0b0e13] border border-[#232936] text-[#e2e8f0] flex-shrink-0 whitespace-nowrap">{keys}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
