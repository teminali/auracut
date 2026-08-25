/* ═══════════════════════════════════════════════════════════════════
   Agent thread.

   Renders one Claude Code session. Tool calls are shown as they happen —
   an agent that edits your timeline silently is unnerving, and the list
   of what it touched is also the fastest way to spot it doing the wrong
   thing while there is still time to stop it.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { AgentTurn, AgentToolCall, prettyToolName } from '../../store/claudeAgentStore';
import { RichText } from './RichText';
import { Check, X, Loader2, Wrench, Terminal } from 'lucide-react';

/** Tools that belong to AuraCut, as opposed to Claude Code's own. */
const isEditorTool = (name: string) => name.startsWith('mcp__auracut__');

const ToolRow: React.FC<{ call: AgentToolCall }> = ({ call }) => {
  const [open, setOpen] = React.useState(false);
  const pending = call.ok === undefined;

  return (
    <div className="rounded-[5px] border border-line bg-spectrum-sunken/60 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-2 h-[24px] flex items-center gap-1.5 text-left hover:bg-white/[0.03] transition-colors"
      >
        {pending ? (
          <Loader2 className="w-3 h-3 text-spectrum-accent animate-spin flex-shrink-0" />
        ) : call.ok ? (
          <Check className="w-3 h-3 text-spectrum-green flex-shrink-0" />
        ) : (
          <X className="w-3 h-3 text-spectrum-red flex-shrink-0" />
        )}

        {isEditorTool(call.name) ? (
          <Wrench className="w-3 h-3 text-spectrum-textFaint flex-shrink-0" />
        ) : (
          <Terminal className="w-3 h-3 text-spectrum-textFaint flex-shrink-0" />
        )}

        <span className="text-[10px] font-mono text-spectrum-textMuted truncate flex-1 min-w-0">
          {prettyToolName(call.name)}
        </span>
      </button>

      {open && (
        <div className="px-2 pb-1.5 space-y-1 border-t border-line/60 pt-1.5">
          <pre className="text-[9px] font-mono text-spectrum-textDim whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
            {JSON.stringify(call.input, null, 2)}
          </pre>
          {call.resultPreview && (
            <pre className="text-[9px] font-mono text-spectrum-textFaint whitespace-pre-wrap break-all max-h-24 overflow-y-auto border-t border-line/60 pt-1">
              {call.resultPreview}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};

export const AgentThread: React.FC<{ turns: AgentTurn[] }> = ({ turns }) => (
  <>
    {turns.map((turn) =>
      turn.role === 'user' ? (
        <div key={turn.id} className="flex flex-col items-end gap-1 min-w-0">
          <span className="text-[9px] text-spectrum-textFaint font-mono px-0.5">You</span>
          <div className="rounded-squircle-sm bg-spectrum-accent text-white px-2.5 py-2 text-ui font-medium max-w-full min-w-0 break-words">
            {turn.text}
          </div>
        </div>
      ) : (
        <div key={turn.id} className="flex flex-col items-start gap-1 min-w-0 w-full">
          <span className="text-[9px] text-spectrum-accent font-mono px-0.5 flex items-center gap-1">
            <Terminal className="w-2.5 h-2.5" />
            CLAUDE CODE
          </span>

          <div
            className={`rounded-squircle-sm border px-2.5 py-2 text-ui leading-relaxed w-full min-w-0 space-y-2 ${
              turn.isError
                ? 'bg-spectrum-red/[0.07] border-spectrum-red/30 text-spectrum-text'
                : 'bg-spectrum-card border-line text-spectrum-text'
            }`}
          >
            {turn.toolCalls.length > 0 && (
              <div className="space-y-1">
                {turn.toolCalls.map((call) => (
                  <ToolRow key={call.id} call={call} />
                ))}
              </div>
            )}

            {turn.text ? (
              <RichText text={turn.text} />
            ) : (
              turn.toolCalls.length === 0 && (
                <span className="text-spectrum-textDim italic">Thinking…</span>
              )
            )}

            {turn.costUsd !== undefined && turn.costUsd > 0 && (
              <div className="text-[9px] font-mono text-spectrum-textFaint pt-1 border-t border-line/60">
                ${turn.costUsd.toFixed(4)}
              </div>
            )}
          </div>
        </div>
      )
    )}
  </>
);
