/* ═══════════════════════════════════════════════════════════════════
   Capability gap log.

   The backlog, written by the people who ran into it. Sorted by how
   often each thing was asked for, because that ordering is the whole
   point — it is a feature list ranked by real demand rather than guess.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useGapStore } from '../../store/gapStore';
import { X, Copy, Check, Trash2, Lightbulb } from '../ui/icons';

export const GapLog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { gaps, toggleResolved, remove, clear, exportMarkdown } = useGapStore();
  const [copied, setCopied] = React.useState(false);

  const sorted = React.useMemo(
    () => [...gaps].sort((a, b) => Number(a.resolved) - Number(b.resolved) || b.count - a.count || b.lastSeen - a.lastSeen),
    [gaps]
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportMarkdown());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the list is still on screen to copy by hand */
    }
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="modal-shell w-[560px] max-h-[76vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <div className="flex items-center gap-2 min-w-0">
            <Lightbulb className="w-3.5 h-3.5 text-spectrum-amber flex-shrink-0" />
            <span className="text-ui font-semibold text-spectrum-text">Requested but missing</span>
            <span className="text-micro font-mono text-spectrum-textFaint tabular">{gaps.length}</span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={copy} className="pro-btn-filled h-[22px] px-2 gap-1.5 text-ui-xs" title="Copy as markdown">
              {copied ? <Check className="w-3 h-3 text-spectrum-green" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Export'}
            </button>
            <button onClick={onClose} className="pro-btn w-[22px] h-[22px]" title="Close">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {sorted.length === 0 ? (
            <p className="text-ui-sm text-spectrum-textDim text-center py-8 leading-relaxed">
              Nothing recorded yet.
              <br />
              When the Copilot hits something Kerf cannot do, it lands here.
            </p>
          ) : (
            sorted.map((gap) => (
              <div
                key={gap.id}
                className={`card p-2.5 space-y-1.5 ${gap.resolved ? 'opacity-45' : ''}`}
              >
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => toggleResolved(gap.id)}
                    className={`w-4 h-4 rounded-[4px] border flex-shrink-0 mt-px flex items-center justify-center transition-colors ${
                      gap.resolved
                        ? 'bg-spectrum-green border-spectrum-green'
                        : 'border-line-strong hover:border-spectrum-textMuted'
                    }`}
                    title={gap.resolved ? 'Mark as still missing' : 'Mark as done'}
                  >
                    {gap.resolved && <Check className="w-2.5 h-2.5 text-white" />}
                  </button>

                  <p className={`flex-1 min-w-0 text-ui-sm font-medium text-spectrum-text ${gap.resolved ? 'line-through' : ''}`}>
                    {gap.request}
                  </p>

                  {gap.count > 1 && (
                    <span className="chip !text-spectrum-amber !border-spectrum-amber/35 flex-shrink-0">
                      {gap.count}×
                    </span>
                  )}

                  <button
                    onClick={() => remove(gap.id)}
                    className="btn-ghost-danger w-[22px] h-[22px] flex-shrink-0"
                    title="Remove"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>

                <div className="pl-6 space-y-1 text-[10px] leading-relaxed">
                  <p className="text-spectrum-textDim">
                    <span className="text-spectrum-textFaint">Blocked by </span>
                    {gap.reason}
                  </p>
                  {gap.suggestion && (
                    <p className="text-spectrum-accent">
                      <span className="text-spectrum-textFaint">Would need </span>
                      {gap.suggestion}
                    </p>
                  )}
                  {gap.workaround && (
                    <p className="text-spectrum-textDim">
                      <span className="text-spectrum-textFaint">Worked around with </span>
                      {gap.workaround}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {gaps.length > 0 && (
          <div className="px-3 py-2 border-t border-line flex items-center justify-between flex-shrink-0">
            <span className="text-[10px] text-spectrum-textFaint">
              Sorted by how often each was asked for.
            </span>
            <button onClick={clear} className="btn-ghost-danger h-[22px] px-2 text-ui-xs">
              Clear all
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
