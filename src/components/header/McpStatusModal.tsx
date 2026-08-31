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
      iconColor="#f0a173"
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
            className="px-2.5 py-1 rounded-[3px] bg-[#2d2d2d] border border-[#3a3a3a] text-ui-xs font-semibold text-[#8a8a8a] hover:text-[#e8e8e8] hover:bg-[#333333] transition-colors"
          >
            Clear
          </button>
        ) : null
      }
      footer={
        <>
          <span className="flex items-center gap-1.5 text-[#9fc9ab]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#9fc9ab]" />
            SSE :{status.ssePort}
          </span>
          <span>{status.connectedClientsCount} clients</span>
          <span className="ml-auto flex items-center gap-1 text-[#8a8a8a]">
            Agents address properties via <code className="text-[#f0a173]">patch_clip</code>
          </span>
        </>
      }
    >
      {tab === 'tools' ? (
        <div className="space-y-4">
          {grouped.map(([category, list]) => (
            <div key={category}>
              <h3 className="font-mono text-micro font-bold tracking-[0.13em] text-[#989898] uppercase mb-2">
                {category}
              </h3>
              <div className="space-y-1.5">
                {list.map((tool) => (
                  <div
                    key={tool.name}
                    className="p-3 rounded-[2px] bg-[#262626] border border-[#141414] hover:border-[#3a3a3a] transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-ui-sm font-mono font-semibold text-[#f0a173]">{tool.name}</code>
                      <button
                        onClick={() => navigator.clipboard?.writeText(tool.name)}
                        className="px-2 py-0.5 rounded-[2px] bg-[#1a1a1a] border border-[#3a3a3a] font-mono text-micro text-[#8a8a8a] hover:text-[#e8e8e8] hover:bg-[#2d2d2d] transition-colors"
                      >
                        copy
                      </button>
                    </div>
                    <p className="text-ui text-[#a6a6a6] mt-1.5 leading-relaxed">{tool.description}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-1.5">
          {logs.length === 0 ? (
            <p className="text-ui-sm text-[#8a8a8a] text-center py-8">No tool calls logged yet.</p>
          ) : (
            logs.map((log) => {
              const isErr = log.status === 'error';
              const errMsg = isErr ? (log.result?.error || log.result?.message || 'Tool call failed') : null;
              return (
                <div key={log.id} className="p-3 rounded-[2px] bg-[#262626] border border-[#141414] font-mono text-ui-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-[#e8e8e8]">{log.toolName}</span>
                    <span
                      className={`text-micro px-1.5 py-0.5 rounded-[2px] ${
                        isErr ? 'bg-[#c98a7a]/15 text-[#c98a7a]' : 'bg-[#9fc9ab]/15 text-[#9fc9ab]'
                      }`}
                    >
                      {isErr ? 'ERROR' : 'OK'}
                      {log.durationMs !== undefined ? ` · ${log.durationMs}ms` : ''}
                    </span>
                  </div>
                  {errMsg && <p className="text-[#c98a7a] mt-1 text-micro">{errMsg}</p>}
                </div>
              );
            })
          )}
        </div>
      )}
    </StandardModal>
  );
};
