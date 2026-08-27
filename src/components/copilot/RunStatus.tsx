/* ═══════════════════════════════════════════════════════════════════
   Live status.

   The one line that answers "is this thing working, and on what?"
   without scrolling. It sits above the thread and stays put while the
   thread moves underneath it.

   The elapsed counter runs off its own interval rather than off the
   event stream, because the gap between events is exactly when a user
   starts wondering whether the agent has hung. A number that keeps
   moving during a 40-second tool call is the difference between
   "working" and "frozen".
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { Square } from '../ui/icons';

interface Props {
  activity: string;
  startedAt: number | null;
  toolCalls: number;
  costUsd?: number;
  onStop: () => void;
}

function formatElapsed(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`;
}

export const RunStatus: React.FC<Props> = ({ activity, startedAt, toolCalls, costUsd, onStop }) => {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (startedAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const elapsed = startedAt === null ? 0 : now - startedAt;

  return (
    <div className="flex-shrink-0 border-b border-line bg-spectrum-card/70 backdrop-blur-sm">
      <div className="px-2.5 pt-2 pb-1.5 flex items-start gap-2">
        {/* A pulsing dot rather than a spinner: a spinner next to a
            spinner in every phase header reads as chaos. */}
        <span className="relative flex w-2 h-2 mt-[3px] flex-shrink-0">
          <span className="absolute inline-flex w-full h-full rounded-full bg-spectrum-accent opacity-70 animate-ping" />
          <span className="relative inline-flex w-2 h-2 rounded-full bg-spectrum-accent" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-ui-sm text-spectrum-text font-medium truncate leading-tight">
            {activity || 'Working…'}
          </p>
          <p className="text-[9px] font-mono text-spectrum-textFaint tabular mt-0.5">
            {formatElapsed(elapsed)}
            {toolCalls > 0 && ` · ${toolCalls} call${toolCalls === 1 ? '' : 's'}`}
            {costUsd !== undefined && costUsd > 0 && ` · $${costUsd.toFixed(3)}`}
          </p>
        </div>

        <button
          onClick={onStop}
          className="btn-ghost-danger h-[20px] px-1.5 gap-1 text-[9px] flex-shrink-0 mt-[1px]"
          title="Stop the agent"
        >
          <Square className="w-2 h-2 fill-current" /> Stop
        </button>
      </div>

      {/* Indeterminate: the agent does not know how many steps are left,
          and a fake percentage would be a guess presented as a fact. */}
      <div className="h-[2px] bg-spectrum-sunken overflow-hidden">
        <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-spectrum-accent to-transparent animate-run-sweep" />
      </div>
    </div>
  );
};
