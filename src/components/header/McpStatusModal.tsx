import React, { useMemo, useState } from 'react';
import { useMcpStore } from '../../store/mcpStore';
import { KERF_TOOLS } from '../../mcp/toolRegistry';
import { EFFECT_REGISTRY } from '../../engine/effectsRegistry';
import { PROPERTY_SCHEMA } from '../../engine/propertyPath';
import { X, Server, Wrench, Activity, Check, AlertCircle, Search, Copy } from '../ui/icons';

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
    <div className="scrim" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-shell w-[640px] max-w-[92vw] max-h-[82vh] flex flex-col rounded-[3px] bg-[#232323] border border-[#3f3f3f] shadow-[0_18px_44px_rgba(0,0,0,0.6)] overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Model Context Protocol"
      >
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#141414] bg-[#232323] sticky top-0 z-10 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <Server className="w-4 h-4 text-[#f0a173]" />
            <span className="text-ui-xl font-bold text-[#e8e8e8]">Model Context Protocol</span>
            <span className="font-mono text-micro font-semibold text-[#9fc9ab] px-1.5 py-0.5 rounded-[2px] bg-[#9fc9ab]/10 border border-[#9fc9ab]/25 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#9fc9ab] animate-pulse" />
              LIVE
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-[26px] h-[24px] rounded-[2px] grid place-items-center text-[#989898] hover:text-[#e8e8e8] hover:bg-[#3a3a3a] transition-colors"
            aria-label="Close"
          >
            <X className="w-[15px] h-[15px]" />
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2.5 p-3.5 border-b border-[#141414] bg-[#1a1a1a] flex-shrink-0">
          <Stat label="Tools" value={String(KERF_TOOLS.length)} />
          <Stat label="Effects" value={String(EFFECT_REGISTRY.length)} />
          <Stat label="Properties" value={String(PROPERTY_SCHEMA.length)} />
          <Stat label="Calls" value={String(status.totalToolCalls)} />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-4 px-4 border-b border-[#141414] bg-[#232323] flex-shrink-0">
          {(['tools', 'log'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative h-9 px-1 text-ui-lg font-semibold capitalize transition-colors ${
                tab === t ? 'text-[#e8e8e8]' : 'text-[#8a8a8a] hover:text-[#c4c4c4]'
              }`}
            >
              {t === 'tools' ? 'Tool surface' : `Activity (${logs.length})`}
              {tab === t && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#c9622f] rounded-t" />}
            </button>
          ))}
          {tab === 'log' && logs.length > 0 && (
            <button
              onClick={clearLogs}
              className="px-2.5 py-1 rounded-[3px] bg-[#2d2d2d] border border-[#3a3a3a] text-ui-xs font-semibold text-[#8a8a8a] hover:text-[#e8e8e8] hover:bg-[#333333] transition-colors ml-auto"
            >
              Clear
            </button>
          )}
        </div>

        {tab === 'tools' && (
          <div className="p-3.5 border-b border-[#141414] bg-[#1f1f1f] flex-shrink-0">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-[3px] bg-[#141414] border border-[#3a3a3a]">
              <Search className="w-3.5 h-3.5 text-[#6b6b6b] flex-shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tools…"
                className="flex-1 bg-transparent outline-none text-ui-sm text-[#e8e8e8] placeholder:text-[#6b6b6b]"
              />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
          {tab === 'tools' ? (
            <div className="space-y-4">
              {grouped.map(([category, list]) => (
                <div key={category}>
                  <h3 className="font-mono text-micro font-bold tracking-[0.13em] text-[#989898] uppercase mb-2">
                    {category}
                  </h3>
                  <div className="space-y-1.5">
                    {list.map((tool) => (
                      <div key={tool.name} className="p-3 rounded-[2px] bg-[#262626] border border-[#141414] hover:border-[#3a3a3a] transition-colors">
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
                        <span className={`text-micro px-1.5 py-0.5 rounded-[2px] ${isErr ? 'bg-[#c98a7a]/15 text-[#c98a7a]' : 'bg-[#9fc9ab]/15 text-[#9fc9ab]'}`}>
                          {isErr ? 'ERROR' : 'OK'}{log.durationMs !== undefined ? ` · ${log.durationMs}ms` : ''}
                        </span>
                      </div>
                      {errMsg && <p className="text-[#c98a7a] mt-1 text-micro">{errMsg}</p>}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div className="px-4 h-9 border-t border-[#141414] bg-[#1a1a1a] flex items-center gap-3 font-mono text-ui-xs text-[#6b6b6b] flex-shrink-0">
          <span className="flex items-center gap-1.5 text-[#9fc9ab]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#9fc9ab]" />
            SSE :{status.ssePort}
          </span>
          <span>{status.connectedClientsCount} clients</span>
          <span className="ml-auto flex items-center gap-1 text-[#8a8a8a]">
            Agents address properties via <code className="text-[#f0a173]">patch_clip</code>
          </span>
        </div>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="p-2.5 rounded-[2px] bg-[#262626] border border-[#141414] text-center">
    <span className="block text-display font-bold text-[#e8e8e8] font-mono tabular-nums">{value}</span>
    <span className="block font-mono text-micro font-bold text-[#8a8a8a] uppercase tracking-wider mt-0.5">{label}</span>
  </div>
);
