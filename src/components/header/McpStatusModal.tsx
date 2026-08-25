import React, { useMemo, useState } from 'react';
import { useMcpStore } from '../../store/mcpStore';
import { AURA_TOOLS } from '../../mcp/toolRegistry';
import { EFFECT_REGISTRY } from '../../engine/effectsRegistry';
import { PROPERTY_SCHEMA } from '../../engine/propertyPath';
import { X, Server, Wrench, Activity, Check, AlertCircle, Search, Copy } from 'lucide-react';

export const McpStatusModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const status = useMcpStore((s) => s.status);
  const logs = useMcpStore((s) => s.logs);
  const clearLogs = useMcpStore((s) => s.clearLogs);

  const [tab, setTab] = useState<'tools' | 'log'>('tools');
  const [query, setQuery] = useState('');

  const tools = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return AURA_TOOLS;
    return AURA_TOOLS.filter(
      (t) => t.name.includes(needle) || t.description.toLowerCase().includes(needle) || t.category.includes(needle)
    );
  }, [query]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof AURA_TOOLS[number][]>();
    for (const tool of tools) {
      const list = map.get(tool.category) ?? [];
      list.push(tool);
      map.set(tool.category, list);
    }
    return [...map.entries()];
  }, [tools]);

  return (
    <div className="scrim" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="modal-shell w-[640px] max-w-[92vw] max-h-[80vh] flex flex-col">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <Server className="w-3.5 h-3.5 text-spectrum-accent" />
            <span className="text-[12px] font-semibold text-spectrum-text">Model Context Protocol</span>
            <span className="chip !text-spectrum-green !border-spectrum-green/30">
              <span className="w-1.5 h-1.5 rounded-full bg-spectrum-green" />
              running
            </span>
          </div>
          <button onClick={onClose} className="pro-btn w-6 h-6">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 p-3 border-b border-line flex-shrink-0">
          <Stat label="Tools" value={String(AURA_TOOLS.length)} />
          <Stat label="Effects" value={String(EFFECT_REGISTRY.length)} />
          <Stat label="Properties" value={String(PROPERTY_SCHEMA.length)} />
          <Stat label="Calls" value={String(status.totalToolCalls)} />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 px-3 border-b border-line flex-shrink-0">
          {(['tools', 'log'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative h-8 px-1 text-[11px] font-medium capitalize transition-colors ${
                tab === t ? 'text-spectrum-accent' : 'text-spectrum-textDim hover:text-spectrum-text'
              }`}
            >
              {t === 'tools' ? 'Tool surface' : `Activity (${logs.length})`}
              {tab === t && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-spectrum-accent rounded-t" />}
            </button>
          ))}
          {tab === 'log' && logs.length > 0 && (
            <button onClick={clearLogs} className="pro-btn h-6 px-2 text-[10px] ml-auto">Clear</button>
          )}
        </div>

        {tab === 'tools' && (
          <div className="p-3 border-b border-line flex-shrink-0">
            <div className="pro-input flex items-center gap-2 px-2 h-7">
              <Search className="w-3 h-3 text-spectrum-textDim flex-shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tools…"
                className="flex-1 bg-transparent outline-none text-[11px] text-spectrum-text placeholder:text-spectrum-textFaint"
              />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3">
          {tab === 'tools' ? (
            <div className="space-y-3">
              {grouped.map(([category, list]) => (
                <div key={category}>
                  <h3 className="section-label mb-1.5">{category}</h3>
                  <div className="space-y-1">
                    {list.map((tool) => (
                      <div key={tool.name} className="card p-2">
                        <div className="flex items-center justify-between gap-2">
                          <code className="text-[11px] font-mono text-spectrum-accent">{tool.name}</code>
                          <button
                            onClick={() => navigator.clipboard?.writeText(tool.name)}
                            className="pro-btn w-4 h-4 flex-shrink-0"
                            title="Copy the tool name"
                          >
                            <Copy className="w-2.5 h-2.5" />
                          </button>
                        </div>
                        <p className="text-[10px] text-spectrum-textDim leading-snug mt-0.5">{tool.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : logs.length === 0 ? (
            <p className="text-[11px] text-spectrum-textDim text-center py-8">No tool calls yet.</p>
          ) : (
            <div className="space-y-1">
              {logs.map((log) => (
                <div key={log.id} className="card p-2">
                  <div className="flex items-center gap-2">
                    {log.status === 'success' ? (
                      <Check className="w-3 h-3 text-spectrum-green flex-shrink-0" />
                    ) : (
                      <AlertCircle className="w-3 h-3 text-spectrum-red flex-shrink-0" />
                    )}
                    <code className="text-[11px] font-mono text-spectrum-text flex-1 truncate">{log.toolName}</code>
                    <span className="text-[9px] text-spectrum-textFaint font-mono tabular flex-shrink-0">
                      {log.durationMs}ms
                    </span>
                    <span className="text-[9px] text-spectrum-textFaint flex-shrink-0 truncate max-w-[110px]">
                      {log.agentName}
                    </span>
                  </div>
                  <pre className="mt-1 text-[9px] font-mono text-spectrum-textDim whitespace-pre-wrap break-all max-h-16 overflow-y-auto">
                    {JSON.stringify(log.parameters)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-3 h-9 border-t border-line flex items-center gap-3 text-[10px] text-spectrum-textFaint flex-shrink-0">
          <span className="flex items-center gap-1">
            <Activity className="w-2.5 h-2.5 text-spectrum-green" />
            SSE :{status.ssePort}
          </span>
          <span>{status.connectedClientsCount} clients</span>
          <span className="ml-auto flex items-center gap-1">
            <Wrench className="w-2.5 h-2.5" />
            Agents can address every property through <code className="text-spectrum-accent">patch_clip</code>
          </span>
        </div>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="card px-2 py-1.5 text-center">
    <span className="block text-[15px] font-semibold text-spectrum-text tabular">{value}</span>
    <span className="block text-[9px] text-spectrum-textFaint uppercase tracking-wider">{label}</span>
  </div>
);
