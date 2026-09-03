/* ═══════════════════════════════════════════════════════════════════
   Agent thread.

   Two things have to be true at once, and they pull in opposite
   directions:

     • While the agent works you want NARRATIVE — what is it doing, is
       it doing the right thing, should I stop it. A flat list of tool
       names answers none of that.
     • Afterwards you want PRECISION — exactly which clip, exactly which
       property, exactly what value it was before.

   So: phases read as a sentence and stay collapsed, and any row opens
   into the real before → after. Narrative on the surface, exact
   underneath, nothing hidden behind a "show details" that loses you the
   thread.

   Rows show what happened, not what was requested. `patch_clip` reports
   before/after per path, so an edit reads `saturation 20 → 45` rather
   than echoing back the arguments it was handed — which would look
   identical whether or not the write actually landed.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { AgentTurn, AgentToolCall, prettyToolName } from '../../store/claudeAgentStore';
import { RichText } from './RichText';
import {
  groupCalls, PhaseGroup, PhaseKind, callSubject, callChanges, formatValue, formatPath,
  isEditorTool,
} from './agentPhases';
import {
  Check, X, Loader2, ChevronRight, Eye, Sparkle, ScanEye, Film, TerminalSquare, Lightbulb,
} from '../ui/icons';

/* ── Phase identity ─────────────────────────────────────────────── */

const PHASE_ICON: Record<PhaseKind, React.ComponentType<{ className?: string }>> = {
  understand: Eye,
  edit: Sparkle,
  verify: ScanEye,
  render: Film,
  shell: TerminalSquare,
  note: Lightbulb,
};

const PHASE_TINT: Record<PhaseKind, string> = {
  understand: 'text-spectrum-textDim',
  edit: 'text-spectrum-accent',
  verify: 'text-spectrum-teal',
  render: 'text-spectrum-purple',
  shell: 'text-spectrum-amber',
  note: 'text-spectrum-amber',
};

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

/* ── One tool call ──────────────────────────────────────────────── */

const ToolRow: React.FC<{ call: AgentToolCall }> = React.memo(({ call }) => {
  const [open, setOpen] = React.useState(false);

  const pending = call.ok === undefined;
  const failed = call.ok === false;
  const elapsed = call.endedAt ? call.endedAt - call.startedAt : null;

  const subject = callSubject(call);
  const changes = callChanges(call);
  const label = prettyToolName(call.name);

  /* A failed call is the one thing worth opening on its own — the error
     is the whole message, and hiding it behind a click means the user
     sees a red tick and no reason. */
  React.useEffect(() => {
    if (failed) setOpen(true);
  }, [failed]);

  return (
    <div className="group">
      <button
        aria-label="Expand or collapse this step"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-1.5 h-[var(--h-xs)] pl-1 pr-1.5 rounded-squircle-2xs text-left
          hover:bg-spectrum-hover transition-colors ${failed ? 'bg-spectrum-red/[0.06]' : ''}`}
      >
        <ChevronRight
          className={`w-2.5 h-2.5 flex-shrink-0 text-spectrum-textFaint transition-transform duration-150
            ${open ? 'rotate-90' : ''} ${changes.length || call.resultPreview ? 'opacity-100' : 'opacity-30'}`}
        />

        {pending ? (
          <Loader2 className="w-2.5 h-2.5 text-spectrum-accent animate-spin flex-shrink-0" />
        ) : failed ? (
          <X className="w-2.5 h-2.5 text-spectrum-red flex-shrink-0" />
        ) : (
          <Check className="w-2.5 h-2.5 text-spectrum-green/70 flex-shrink-0" />
        )}

        <span
          className={`text-micro font-mono truncate flex-shrink-0 ${
            isEditorTool(call.name) ? 'text-spectrum-textMuted' : 'text-spectrum-amber/80'
          }`}
        >
          {label}
        </span>

        {subject && (
          <span className="text-micro text-spectrum-textFaint truncate min-w-0 flex-1">{subject}</span>
        )}
        {!subject && <span className="flex-1" />}

        {/* A count beats an expand for the common case: the row already
            says "three properties changed" without being opened. */}
        {changes.length > 0 && !open && (
          <span className="text-micro font-mono text-spectrum-accent/70 flex-shrink-0 tabular">
            {changes.length}∆
          </span>
        )}

        {elapsed !== null && (
          <span className="text-micro font-mono text-spectrum-textFaint/70 flex-shrink-0 tabular w-[38px] text-right">
            {formatMs(elapsed)}
          </span>
        )}
      </button>

      {open && (
        <div className="ml-[14px] pl-2 border-l border-line/70 py-1 space-y-1">
          {changes.length > 0 && (
            <div className="space-y-[3px]">
              {changes.map((c) => (
                <div key={c.path} className="flex items-baseline gap-1.5 text-micro font-mono">
                  <span className="text-spectrum-textDim truncate min-w-0 flex-1">{formatPath(c.path)}</span>
                  <span className="text-spectrum-textFaint tabular flex-shrink-0 line-through decoration-spectrum-textFaint/40">
                    {formatValue(c.from)}
                  </span>
                  <span className="text-spectrum-textFaint flex-shrink-0">→</span>
                  <span className="text-spectrum-green tabular flex-shrink-0">{formatValue(c.to)}</span>
                </div>
              ))}
            </div>
          )}

          {Object.keys(call.input ?? {}).length > 0 && (
            <details className="group/args">
              <summary className="text-micro font-mono text-spectrum-textFaint cursor-pointer hover:text-spectrum-textDim list-none select-none">
                arguments
              </summary>
              <pre className="mt-1 text-micro font-mono text-spectrum-textDim whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                {JSON.stringify(call.input, null, 2)}
              </pre>
            </details>
          )}

          {call.resultPreview && (
            <pre
              className={`text-micro font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto ${
                failed ? 'text-spectrum-red/90' : 'text-spectrum-textFaint'
              }`}
            >
              {call.resultPreview}
            </pre>
          )}
        </div>
      )}
    </div>
  );
});
ToolRow.displayName = 'ToolRow';

/* ── One phase ──────────────────────────────────────────────────── */

const PhaseBlock: React.FC<{ group: PhaseGroup; defaultOpen: boolean }> = ({ group, defaultOpen }) => {
  const [open, setOpen] = React.useState(defaultOpen);
  const Icon = PHASE_ICON[group.kind];

  const running = group.calls.some((c) => c.ok === undefined);
  const failed = group.calls.some((c) => c.ok === false);

  const total = group.calls.reduce(
    (sum, c) => sum + (c.endedAt ? c.endedAt - c.startedAt : 0),
    0
  );

  /*
    A running phase opens itself so the user watches the work rather than
    a closed box with a spinner on it — and a FAILED one opens too. A
    failure folded inside a collapsed group is the one thing the panel
    must never do: the header goes red, the reason stays hidden, and the
    user has to go looking for what broke.
  */
  React.useEffect(() => {
    if (running || failed) setOpen(true);
  }, [running, failed]);

  return (
    <div className="rounded-squircle-xs border border-line/70 bg-spectrum-sunken/40 overflow-hidden">
      <button
        aria-label="Expand or collapse this group"
        onClick={() => setOpen((v) => !v)}
        className="w-full h-[var(--h-sm)] px-1.5 flex items-center gap-1.5 hover:bg-spectrum-hover transition-colors"
      >
        <ChevronRight
          className={`w-2.5 h-2.5 text-spectrum-textFaint flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        />
        <Icon className={`w-3 h-3 flex-shrink-0 ${failed ? 'text-spectrum-red' : PHASE_TINT[group.kind]}`} />
        <span className="text-micro font-medium text-spectrum-textMuted truncate flex-1 text-left min-w-0">
          {group.label}
        </span>

        {running && <Loader2 className="w-2.5 h-2.5 text-spectrum-accent animate-spin flex-shrink-0" />}

        <span className="text-micro font-mono text-spectrum-textFaint/80 flex-shrink-0 tabular">
          {group.calls.length}
          {total > 0 ? ` · ${formatMs(total)}` : ''}
        </span>
      </button>

      {open && (
        <div className="px-1 pb-1 pt-0.5 space-y-[1px] border-t border-line/50">
          {group.calls.map((call) => (
            <ToolRow key={call.id} call={call} />
          ))}
        </div>
      )}
    </div>
  );
};

/* ── The thread ─────────────────────────────────────────────────── */

export const AgentThread: React.FC<{ turns: AgentTurn[] }> = ({ turns }) => (
  <div className="space-y-3">
    {turns.map((turn, index) =>
      turn.role === 'user' ? (
        <UserTurn key={turn.id} text={turn.text} />
      ) : (
        <AgentTurnBlock key={turn.id} turn={turn} isLast={index === turns.length - 1} />
      )
    )}
  </div>
);

const UserTurn: React.FC<{ text: string }> = React.memo(({ text }) => (
  <div className="flex justify-end">
    <div className="max-w-[88%] rounded-squircle-sm bg-spectrum-accent/[0.13] border border-spectrum-accentLine/50
                    px-2 py-1.5 text-ui text-spectrum-text leading-relaxed whitespace-pre-wrap break-words">
      {text}
    </div>
  </div>
));
UserTurn.displayName = 'UserTurn';

const AgentTurnBlock: React.FC<{ turn: AgentTurn; isLast: boolean }> = React.memo(({ turn, isLast }) => {
  const groups = React.useMemo(() => groupCalls(turn.toolCalls), [turn.toolCalls]);
  const elapsed = turn.endedAt ? turn.endedAt - turn.timestamp : null;

  /* Count what actually CHANGED the project. Counting every editor tool
     included the read-only ones, so a turn that only looked around still
     reported edits. */
  const editCount = groups
    .filter((g) => g.kind === 'edit' || g.kind === 'render')
    .reduce((n, g) => n + g.calls.filter((c) => c.ok !== false).length, 0);

  return (
    <div className="space-y-1.5 min-w-0">
      {groups.map((group, i) => (
        <PhaseBlock
          key={group.id}
          group={group}
          // The newest phase of the newest turn is the one being watched.
          defaultOpen={isLast && i === groups.length - 1}
        />
      ))}

      {turn.text ? (
        <div
          className={`text-ui leading-relaxed min-w-0 break-words ${
            turn.isError ? 'text-spectrum-red/90' : 'text-spectrum-text'
          }`}
        >
          <RichText text={turn.text} />
        </div>
      ) : (
        groups.length === 0 && <span className="text-ui text-spectrum-textDim italic">Thinking…</span>
      )}

      {(elapsed !== null || turn.costUsd) && (
        <div className="flex items-center gap-2 text-micro font-mono text-spectrum-textFaint/70 tabular pt-0.5">
          {elapsed !== null && <span>{formatMs(elapsed)}</span>}
          {turn.toolCalls.length > 0 && <span>{turn.toolCalls.length} calls</span>}
          {editCount > 0 && <span className="text-spectrum-accent/60">{editCount} edits</span>}
          {turn.costUsd !== undefined && turn.costUsd > 0 && <span>${turn.costUsd.toFixed(4)}</span>}
        </div>
      )}
    </div>
  );
});
AgentTurnBlock.displayName = 'AgentTurnBlock';
