import React from 'react';
import { useUiStore } from '../../store/uiStore';
import {
  X, Keyboard,
} from 'lucide-react';

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
      <div onClick={(e) => e.stopPropagation()} className="modal-shell w-[720px] max-w-[92vw] max-h-[82vh] flex flex-col">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <Keyboard className="w-3.5 h-3.5 text-spectrum-accent" />
            <span className="text-[12px] font-semibold text-spectrum-text">Keyboard shortcuts</span>
          </div>
          <button onClick={() => setOpen(false)} className="pro-btn w-6 h-6">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 gap-x-6 gap-y-4">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="section-label mb-2">{group.title}</h3>
              <div className="space-y-1">
                {group.items.map(([keys, label]) => (
                  <div key={keys} className="flex items-center justify-between gap-3 py-0.5">
                    <span className="text-[12px] text-spectrum-textMuted truncate">{label}</span>
                    <span className="kbd !h-5 !px-1.5 !text-[10px] flex-shrink-0 whitespace-nowrap">{keys}</span>
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
