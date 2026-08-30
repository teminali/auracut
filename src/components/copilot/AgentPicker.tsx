/* ═══════════════════════════════════════════════════════════════════
   Choosing which CLI drives the Copilot.

   This is the second model picker this project has had. The first one
   listed four vendors and selected nothing — the value it wrote became
   a label and changed no behaviour — and it was deleted for that.

   The difference is that every row here is measured. A backend appears
   as ready only when its binary was found AND its own readiness probe
   passed, because installed is not the same as usable: this machine had
   Gemini installed and signed in, and every run still failed because
   the settings file used an older schema than the CLI reads.

   So there are four states, and the row says which one it is:

     ready        the binary is there and answered a probe
     needs setup  installed, but not signed in — opens a real terminal,
                  because OAuth cannot happen inside a child process
     missing      not installed — installs it, here, for real
     unverified   works, but Kerf has not confirmed how it streams
                  its output, so the answer arrives without the
                  step-by-step
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { AgentBackendStatus } from '../../types/electron';
import { useUiStore } from '../../store/uiStore';
import {
  Check, Download, LogIn, Loader2, AlertTriangle, X, ExternalLink,
} from '../ui/icons';

const KEY_PROVIDERS: Record<string, { label: string; url: string; free?: boolean }> = {
  gemini: {
    label: 'Get free key (Google AI Studio)',
    url: 'https://aistudio.google.com/apikey',
    free: true,
  },
  claude: {
    label: 'Get key (Anthropic Console)',
    url: 'https://console.anthropic.com/settings/keys',
  },
  codex: {
    label: 'Get key (OpenAI Platform)',
    url: 'https://platform.openai.com/api-keys',
  },
  cursor: {
    label: 'Get key (Cursor Dashboard)',
    url: 'https://www.cursor.com/settings',
  },
};

const RANK_BADGES: Record<string, { badge: string; color: string; tooltip: string }> = {
  opencode: { badge: '#1 Local & Zero Cost', color: 'bg-[#22c55e]/15 text-[#22c55e]', tooltip: 'Sub-second local Devstral execution with smart cloud escalation' },
  claude: { badge: '#1 Heavy Tasks', color: 'bg-[#4c9dff]/15 text-[#4c9dff]', tooltip: 'Best for complex reasoning and architecture' },
  antigravity: { badge: '#1 Agentic Editing', color: 'bg-[#a78bfa]/15 text-[#a78bfa]', tooltip: 'Best for autonomous video editing workflows' },
  gemini: { badge: 'Fast Reasoning', color: 'bg-[#2fc98d]/15 text-[#2fc98d]', tooltip: 'Good balance of speed and intelligence' },
  codex: { badge: 'Legacy', color: 'bg-[#3a3a3a] text-[#8a8a8a]', tooltip: 'Older generation code models' },
  cursor: { badge: 'Code Assistant', color: 'bg-[#ff9a4d]/15 text-[#ff9a4d]', tooltip: 'Integrated code intelligence' }
};

interface Props {
  onClose: () => void;
  onSelected: (id: string) => void;
}

export const AgentPicker: React.FC<Props> = ({ onClose, onSelected }) => {
  const [backends, setBackends] = React.useState<AgentBackendStatus[]>([]);
  const [selected, setSelected] = React.useState<string>('claude');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<string>('');
  const [loading, setLoading] = React.useState(true);
  const [keyDraft, setKeyDraft] = React.useState<Record<string, string>>({});
  const [models, setModels] = React.useState<
    Record<string, { models: string[]; source: 'queried' | 'suggested'; selected: string }>
  >({});
  const pushToast = useUiStore((s) => s.pushToast);

  const refresh = React.useCallback(async (deep: boolean) => {
    const api = window.electronAPI;
    if (!api?.agents) return;
    const result = await api.agents.list(deep);
    setBackends(result.backends);
    setSelected(result.selected);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // Paint from the quick pass, then fill in the readiness probes, which
    // spawn each binary and are too slow to block the first render on.
    void refresh(false).then(() => refresh(true));
    return window.electronAPI?.agents.onInstallProgress((p) => setProgress(p.line));
  }, [refresh]);

  /* Model options are loaded per backend, and only for ones that can
     actually run — asking a CLI that cannot authenticate is wasted time. */
  React.useEffect(() => {
    const api = window.electronAPI;
    if (!api?.agents) return;
    for (const backend of backends) {
      if (!backend.ready || models[backend.id]) continue;
      void api.agents.models(backend.id).then((m) =>
        setModels((prev) => ({ ...prev, [backend.id]: m }))
      );
    }
  }, [backends, models]);

  const pickModel = async (backend: AgentBackendStatus, model: string) => {
    await window.electronAPI!.agents.setModel(backend.id, model);
    setModels((prev) => ({
      ...prev,
      [backend.id]: { ...prev[backend.id], selected: model },
    }));
  };

  const choose = async (backend: AgentBackendStatus) => {
    if (!backend.ready) return;
    await window.electronAPI?.agents.select(backend.id);
    setSelected(backend.id);
    onSelected(backend.id);
  };

  const install = async (backend: AgentBackendStatus) => {
    setBusy(backend.id);
    setProgress(`Installing ${backend.label}…`);
    try {
      const result = await window.electronAPI!.agents.install(backend.id);
      pushToast({
        kind: result.ok ? 'success' : 'error',
        title: result.ok ? `${backend.label} installed` : `Could not install ${backend.label}`,
        detail: result.message,
      });
      await refresh(true);
    } finally {
      setBusy(null);
      setProgress('');
    }
  };

  /**
   * Store a pasted key and re-probe.
   *
   * Kept in Kerf's own data directory rather than the user's shell
   * profile: a GUI app launched from Finder cannot see that profile
   * anyway, which is why keys set there are invisible here.
   */
  const saveKey = async (backend: AgentBackendStatus) => {
    const variable = backend.needsKey!;
    const value = keyDraft[backend.id] ?? '';
    setBusy(backend.id);
    try {
      await window.electronAPI!.agents.setKey(variable, value);
      await window.electronAPI!.agents.recheck();
      setKeyDraft((d) => ({ ...d, [backend.id]: '' }));
      await refresh(true);
    } finally {
      setBusy(null);
    }
  };

  const signIn = async (backend: AgentBackendStatus) => {
    const result = await window.electronAPI!.agents.signIn(backend.id);
    pushToast({
      kind: result.ok ? 'info' : 'error',
      title: result.ok ? 'Finish signing in' : 'Sign in from a terminal',
      detail: result.message,
      ttl: 10000,
    });
  };

  const openUrl = (url: string) => {
    if (window.electronAPI?.shell?.openExternal) {
      void window.electronAPI.shell.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-shell w-[580px] max-w-[92vw] max-h-[88vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Copilot agent"
      >
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#141414] bg-[#232323] sticky top-0 z-10 flex-shrink-0">
          <span className="text-ui-xl font-bold text-[#e8e8e8]">Copilot agent</span>
          <button
            onClick={onClose}
            className="w-[26px] h-[24px] rounded-[2px] grid place-items-center text-[#989898] hover:text-[#e8e8e8] hover:bg-[#3a3a3a] transition-colors"
            aria-label="Close the agent picker"
          >
            <X className="w-[15px] h-[15px]" />
          </button>
        </div>

        <div className="p-4 space-y-3.5 overflow-y-auto min-h-0 flex-1">
          <p className="text-ui-sm text-[#a6a6a6] leading-relaxed">
            Whichever you pick gets Kerf&apos;s 58 editing tools over MCP, plus its own file, shell and web access.
          </p>

          {loading && (
            <div className="flex items-center gap-2 py-6 justify-center text-ui text-[#8a8a8a]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Looking for installed agents…
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            {backends.map((backend) => {
              const isSelected = backend.id === selected;
              const working = busy === backend.id;
              const isAntigravity = backend.id === 'antigravity';

              const statusColor = !backend.checked
                ? 'text-[#8a8a8a]'
                : backend.ready
                  ? 'text-[#9fc9ab]'
                  : 'text-[#c98a7a]';

              const statusText = !backend.checked
                ? 'checking…'
                : isAntigravity
                  ? 'Connected via live MCP on port 3888'
                  : backend.ready
                    ? backend.version ?? backend.path ?? 'Ready'
                    : backend.reason ?? 'Authentication required';

              return (
                <div
                  key={backend.id}
                  onClick={() => {
                    if (backend.ready) void choose(backend);
                  }}
                  className={`p-3.5 rounded-[2px] transition-colors ${
                    backend.ready ? 'cursor-pointer' : 'cursor-default'
                  } ${
                    isSelected
                      ? 'bg-[#2b2520] border border-[#c9622f]'
                      : 'bg-[#262626] border border-[#141414] hover:border-[#3a3a3a]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-ui-lg font-bold text-[#e8e8e8]">{backend.label}</span>
                    <span className="text-ui text-[#8a8a8a]">{backend.vendor}</span>

                    {RANK_BADGES[backend.id] && (
                      <span 
                        className={`ml-1 text-micro font-semibold px-1.5 py-0.5 rounded-[2px] ${RANK_BADGES[backend.id].color}`}
                        title={RANK_BADGES[backend.id].tooltip}
                      >
                        {RANK_BADGES[backend.id].badge}
                      </span>
                    )}

                    {isSelected && (
                      <Check className="w-3.5 h-3.5 text-[#e0854d] flex-shrink-0" />
                    )}

                    {!backend.checked && (
                      <Loader2 className="w-3 h-3 animate-spin text-[#8a8a8a] flex-shrink-0 ml-1" />
                    )}

                    {isAntigravity && (
                      <span className="ml-2 font-mono text-micro font-semibold text-[#9fc9ab] px-1.5 py-0.5 rounded-[2px] bg-[#9fc9ab]/10 border border-[#9fc9ab]/25">
                        MCP Live · Port 3888
                      </span>
                    )}

                    <div className="ml-auto flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      {isAntigravity && (
                        <button
                          onClick={() => void window.electronAPI?.agents.openAntigravity()}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-[3px] bg-[#2d2d2d] border border-[#3f3f3f] text-ui font-semibold text-[#c4c4c4] hover:bg-[#333333] hover:text-[#e8e8e8] transition-colors"
                          title="Bring Antigravity IDE to the foreground"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Open IDE
                        </button>
                      )}

                      {backend.checked && !backend.installed && !isAntigravity && (
                        <button
                          onClick={() => install(backend)}
                          disabled={working}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-[3px] bg-[#2d2d2d] border border-[#3f3f3f] text-ui font-semibold text-[#c4c4c4] hover:bg-[#333333] hover:text-[#e8e8e8] transition-colors disabled:opacity-50"
                          title={backend.installHint}
                        >
                          {working ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                          Install
                        </button>
                      )}

                      {backend.checked && backend.installed && !backend.ready && (
                        <button
                          onClick={() => signIn(backend)}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-[3px] bg-[#2d2d2d] border border-[#3f3f3f] text-ui font-semibold text-[#c4c4c4] hover:bg-[#333333] hover:text-[#e8e8e8] transition-colors"
                          title={backend.fix}
                        >
                          <LogIn className="w-3 h-3" />
                          Sign in
                        </button>
                      )}
                    </div>
                  </div>

                  <div className={`font-mono text-ui-xs mt-1.5 leading-relaxed truncate ${statusColor}`}>
                    {statusText}
                  </div>

                  {backend.checked && !backend.ready && backend.fix && (
                    <div className="text-ui text-[#a6a6a6] mt-1 leading-snug">
                      {backend.fix}
                    </div>
                  )}

                  {/* Model Choice when ready */}
                  {backend.ready && models[backend.id] && (
                    <div
                      className="flex items-center gap-2.5 mt-2.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-ui text-[#989898] flex-none">Model</span>
                      <input
                        list={`models-${backend.id}`}
                        value={models[backend.id].selected}
                        onChange={(e) => pickModel(backend, e.target.value)}
                        placeholder={`${backend.label} default`}
                        className="flex-1 px-2.5 py-1.5 rounded-[3px] bg-[#1a1a1a] border border-[#3a3a3a] font-mono text-ui-xs text-[#e8e8e8] placeholder-[#6b6b6b] outline-none focus:border-[#c9622f]"
                      />
                      <datalist id={`models-${backend.id}`}>
                        {models[backend.id].models.map((m) => <option key={m} value={m} />)}
                      </datalist>
                      <span
                        className="flex-none font-mono text-micro text-[#6b6b6b]"
                        title={
                          models[backend.id].source === 'queried'
                            ? 'This list came from the CLI itself.'
                            : 'Suggestions: any model name this CLI accepts will work.'
                        }
                      >
                        {models[backend.id].source === 'queried' ? 'listed' : 'suggested'}
                      </span>
                    </div>
                  )}

                  {/* Key provider quick link and key input */}
                  {backend.checked && !backend.ready && backend.needsKey && (
                    <div
                      className="mt-2.5 pt-2 border-t border-[#1e1e1e] space-y-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {KEY_PROVIDERS[backend.id] && (
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => openUrl(KEY_PROVIDERS[backend.id].url)}
                            className="text-ui text-[#f0a173] hover:underline flex items-center gap-1 font-medium"
                          >
                            <ExternalLink className="w-3 h-3" />
                            {KEY_PROVIDERS[backend.id].label}
                          </button>
                          {KEY_PROVIDERS[backend.id].free && (
                            <span className="text-micro uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-spectrum-green/15 text-spectrum-green">
                              100% Free Tier
                            </span>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <input
                          type="password"
                          value={keyDraft[backend.id] ?? ''}
                          onChange={(e) => setKeyDraft((d) => ({ ...d, [backend.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') void saveKey(backend); }}
                          placeholder={backend.hasKey ? `${backend.needsKey} stored. Paste to replace` : backend.needsKey}
                          className="flex-1 px-2.5 py-1.5 rounded-[3px] bg-[#1a1a1a] border border-[#3a3a3a] font-mono text-ui-xs text-[#e8e8e8] placeholder-[#6b6b6b] outline-none focus:border-[#c9622f]"
                        />
                        <button
                          onClick={() => saveKey(backend)}
                          disabled={busy === backend.id || !(keyDraft[backend.id] ?? '').trim()}
                          className="flex-none px-3.5 py-1.5 rounded-[3px] bg-[#2d2d2d] border border-[#3a3a3a] text-ui font-semibold text-[#8a8a8a] hover:text-[#e8e8e8] hover:bg-[#333333] transition-colors disabled:opacity-40"
                        >
                          {busy === backend.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {progress && (
            <pre className="text-micro font-mono text-[#8a8a8a] whitespace-pre-wrap break-all max-h-20 overflow-y-auto border-t border-[#141414] pt-2 mt-2">
              {progress}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
