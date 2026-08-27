/* ═══════════════════════════════════════════════════════════════════
   The band above the home screen.

   It is the OS titlebar as well, so it drags the window and reserves
   the macOS traffic-light gutter on the left. CapCut puts three things
   at its right end; these are the three Kerf actually has.

   The agent chip has THREE states, not two. `status === null` means
   nobody has asked yet, and a "not connected" dot shown during that
   window is a claim the app cannot support — HANDOVER §3, which this
   codebase got wrong three times in a row before writing it down.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useClaudeAgentStore } from '../../store/claudeAgentStore';
import { useUiStore } from '../../store/uiStore';
import { Keyboard, Settings } from '../ui/icons';

interface Props {
  onOpenAgentPicker: () => void;
}

export const HomeTopBar: React.FC<Props> = ({ onOpenAgentPicker }) => {
  const status = useClaudeAgentStore((s) => s.status);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);

  const state: 'unknown' | 'ready' | 'absent' =
    status === null ? 'unknown' : status.installed ? 'ready' : 'absent';

  const label =
    state === 'unknown' ? 'checking…' : state === 'ready' ? (status?.label ?? 'Claude Code') : 'no agent';

  const dot =
    state === 'unknown'
      ? 'bg-spectrum-textFaint animate-pulse'
      : state === 'ready'
        ? 'bg-spectrum-green'
        : 'bg-spectrum-textFaint';

  return (
    <header className="titlebar-drag h-12 flex-shrink-0 flex items-center pr-5">
      <div className="titlebar-gutter" />
      <div className="flex-1" />

      <div className="flex items-center gap-1.5">
        <button
          onClick={onOpenAgentPicker}
          className="pro-btn h-[28px] pl-2 pr-2.5 gap-1.5 text-ui-sm rounded-full"
          title={
            state === 'unknown'
              ? 'Looking for an agent CLI'
              : state === 'ready'
                ? `${label} is connected, click to change`
                : 'No agent CLI found, the editor still works. Click to set one up'
          }
            aria-label={
            state === 'unknown'
              ? 'Looking for an agent CLI'
              : state === 'ready'
                ? `${label} is connected, click to change`
                : 'No agent CLI found, the editor still works. Click to set one up'
          }
        >
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
          {label}
        </button>

        <button
          onClick={() => setShortcutsOpen(true)}
          className="pro-btn w-[28px] h-[28px] rounded-full"
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
        >
          <Keyboard className="w-4 h-4" />
        </button>

        <button
          onClick={onOpenAgentPicker}
          className="pro-btn w-[28px] h-[28px] rounded-full"
          title="Settings, agent and API keys"
          aria-label="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
