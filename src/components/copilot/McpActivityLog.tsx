import React from 'react';
import { useMcpStore } from '../../store/mcpStore';
import { Check, AlertCircle } from '../ui/icons';

export const McpActivityLog: React.FC = () => {
  const logs = useMcpStore((s) => s.logs);

  if (logs.length === 0) {
    return (
      <div className="px-2.5 py-2 text-[10px] text-spectrum-textFaint font-mono">
        No tool calls yet.
      </div>
    );
  }

  return (
    <div className="max-h-24 overflow-y-auto px-2 py-1 space-y-0.5">
      {logs.slice(0, 12).map((log) => (
        <div key={log.id} className="flex items-center gap-1.5 text-[10px] font-mono leading-tight">
          {log.status === 'success' ? (
            <Check className="w-2.5 h-2.5 text-spectrum-green flex-shrink-0" />
          ) : (
            <AlertCircle className="w-2.5 h-2.5 text-spectrum-red flex-shrink-0" />
          )}
          <span className="text-spectrum-textMuted truncate flex-1">{log.toolName}</span>
          <span className="text-spectrum-textFaint tabular flex-shrink-0">{log.durationMs}ms</span>
        </div>
      ))}
    </div>
  );
};
