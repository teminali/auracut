import React, { useMemo, useState } from 'react';
import { useMcpStore } from '../../store/mcpStore';
import { KERF_TOOLS } from '../../mcp/toolRegistry';
import { EFFECT_REGISTRY } from '../../engine/effectsRegistry';
import { PROPERTY_SCHEMA } from '../../engine/propertyPath';
import { Server } from '../ui/icons';
import { StandardModal } from '../ui/StandardModal';

export const McpStatusModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const status = useMcpStore((s) => s.status);
  const logs = useMcpStore((s) => s.logs);
  const clearLogs = useMcpStore((s) => s.clearLogs);

  const [tab, setTab] = useState<'tools' | 'log'>('tools');
  const [query, setQuery] = useState('');

  const tools = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return KERF_TOOLS;
    return KERF_TOOLS.filter(
      (t) => t.name.includes(needle) || t.description.toLowerCase().includes(needle) || t.category.includes(needle)
    );
  }, [query]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof KERF_TOOLS[number][]>();
    for (const tool of tools) {
      const list = map.get(tool.category) ?? [];
      list.push(tool);
      map.set(tool.category, list);
    }
    return [...map.entries()];
  }, [tools]);

  return (
    <StandardModal
      isOpen={true}
      onClose={onClose}
      title="Model Context Protocol"
      icon={Server}
      iconColor="var(--accent-ink)"
      badge={{
        text: 'LIVE',
        variant: 'green',
        pulse: true,
      }}
      stats={[
        { label: 'Tools', value: String(KERF_TOOLS.length) },
        { label: 'Effects', value: String(EFFECT_REGISTRY.length) },
        { label: 'Properties', value: String(PROPERTY_SCHEMA.length) },
        { label: 'Calls', value: String(status.totalToolCalls) },
      ]}
      tabs={[
        { id: 'tools', label: 'Tool surface' },
        { id: 'log', label: 'Activity', count: logs.length },
      ]}
      activeTab={tab}
      onTabChange={(t) => setTab(t as 'tools' | 'log')}
      searchQuery={tab === 'tools' ? query : undefined}
      onSearchChange={tab === 'tools' ? setQuery : undefined}
      searchPlaceholder="Search tools…"
      headerActions={
        tab === 'log' && logs.length > 0 ? (
          <button
            onClick={clearLogs}
            className="px-2 py-1 rounded-[3px] bg-spectrum-cardHover border border-line-bright text-ui-xs font-semibold text-spectrum-textFaint hover:text-spectrum-accent hover:bg-spectrum-borderStrong transition-colors"
          >
            Clear
          </button>
        ) : null
      }
      footer={
        <>
          <span className="flex items-center gap-1.5 text-spectrum-green">
            <span className="w-1.5 h-1.5 rounded-full bg-spectrum-green" />
            SSE :{status.ssePort}
          </span>
          <span>{status.connectedClientsCount} clients</span>
          <span className="ml-auto flex items-center gap-1 text-spectrum-textFaint">
            Agents address properties via <code className="text-spectrum-accent">patch_clip</code>
          </span>
        </>
      }
    >
      {tab === 'tools' ? (
        <div className="space-y-5">
          {grouped.map(([category, list]) => (
            <div key={category}>
              <h3 className="font-mono text-ui-xs font-bold tracking-[0.13em] text-spectrum-textFaint uppercase mb-3">
                {category}
              </h3>
              <div className="space-y-2">
                {list.map((tool) => (
                  <div
                    key={tool.name}
                    className="p-4 rounded-xl bg-spectrum-sunken border border-spectrum-cardHover hover:border-spectrum-borderStrong transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-ui-sm font-mono font-semibold text-spectrum-accent">{tool.name}</code>
                      <button
                        onClick={() => navigator.clipboard?.writeText(tool.name)}
                        className="px-2 py-1 rounded-md bg-spectrum-hover border border-line font-mono text-ui-xs text-spectrum-textDim hover:text-spectrum-textBright hover:bg-spectrum-cardHover transition-colors"
                      >
                        copy
                      </button>
                    </div>
                    <p className="text-ui text-spectrum-textDim mt-1.5 leading-relaxed">{tool.description}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {logs.length === 0 ? (
            <p className="text-ui text-spectrum-textFaint text-center py-8">No tool calls logged yet.</p>
          ) : (
            logs.map((log) => {
              const isErr = log.status === 'error';
              const errMsg = isErr ? (log.result?.error || log.result?.message || 'Tool call failed') : null;
              return (
                <div key={log.id} className="p-3 rounded-xl bg-spectrum-sunken border border-spectrum-cardHover font-mono text-ui-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-spectrum-textBright">{log.toolName}</span>
                    <span
                      className={`text-ui-xs px-2 py-0.5 rounded-[4px] font-semibold ${
                        isErr ? 'bg-spectrum-accent/15 text-spectrum-accent' : 'bg-spectrum-green/15 text-spectrum-green'
                      }`}
                    >
                      {isErr ? 'ERROR' : 'OK'}
                      {log.durationMs !== undefined ? ` · ${log.durationMs}ms` : ''}
                    </span>
                  </div>
                  {errMsg && <p className="text-spectrum-accent mt-1.5 text-ui-xs">{errMsg}</p>}
                </div>
              );
            })
          )}
        </div>
      )}
    </StandardModal>
  );
};
