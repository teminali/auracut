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
     unverified   works, but TeminaliCut has not confirmed how it streams
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
  opencode: { badge: '#1 Local & Frontier Cloud', color: 'bg-spectrum-green/15 text-spectrum-green', tooltip: 'Frontier Code: Sub-second local Devstral execution with intelligent cloud escalation' },
  claude: { badge: '#1 Heavy Tasks', color: 'bg-spectrum-blue/15 text-spectrum-blue', tooltip: 'Best for complex reasoning and architecture' },
  antigravity: { badge: '#1 Agentic Editing', color: 'bg-spectrum-purple/15 text-spectrum-purple', tooltip: 'Best for autonomous video editing workflows' },
  gemini: { badge: 'Fast Reasoning', color: 'bg-spectrum-green/15 text-spectrum-green', tooltip: 'Good balance of speed and intelligence' },
  codex: { badge: 'Legacy', color: 'bg-line-bright text-spectrum-textFaint', tooltip: 'Older generation code models' },
  cursor: { badge: 'Code Assistant', color: 'bg-spectrum-accent/15 text-spectrum-accent', tooltip: 'Integrated code intelligence' }
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
   * Kept in TeminaliCut's own data directory rather than the user's shell
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
        className="modal-shell w-[600px] max-w-[92vw] max-h-[88vh] flex flex-col rounded-2xl bg-spectrum-panelHeader border border-spectrum-cardHover shadow-modal overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Copilot agent"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-spectrum-panelHeader sticky top-0 z-10 flex-shrink-0">
          <span className="text-display font-semibold text-spectrum-textBright tracking-tight">Copilot agent</span>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg text-spectrum-textDim hover:text-spectrum-textBright hover:bg-spectrum-cardHover flex items-center justify-center transition-colors"
            aria-label="Close the agent picker"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto min-h-0 flex-1">
          <p className="text-ui text-spectrum-textDim leading-relaxed">
            Whichever you pick gets TeminaliCut&apos;s 58 editing tools over MCP, plus its own file, shell and web access.
          </p>

          {loading && (
            <div className="flex items-center gap-2 py-6 justify-center text-ui text-spectrum-textFaint">
              <Loader2 className="w-4 h-4 animate-spin text-spectrum-accent" /> Looking for installed agents…
            </div>
          )}

          <div className="flex flex-col gap-3">
            {backends.map((backend) => {
              const isSelected = backend.id === selected;
              const working = busy === backend.id;
              const isAntigravity = backend.id === 'antigravity';

              const statusColor = !backend.checked
                ? 'text-spectrum-textFaint'
                : backend.ready
                  ? 'text-spectrum-green'
                  : 'text-spectrum-accent';

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
                  className={`p-4 rounded-xl transition-all ${
                    backend.ready ? 'cursor-pointer' : 'cursor-default'
                  } ${
                    isSelected
                      ? 'bg-spectrum-panelHeader border border-spectrum-accent/75 shadow-[0_0_16px_rgba(232,232,232,0.14)]'
                      : 'bg-spectrum-sunken hover:bg-spectrum-panelHeader border border-spectrum-cardHover hover:border-spectrum-borderStrong'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-ui-lg font-bold text-spectrum-textBright">{backend.label}</span>
                    <span className="text-ui text-spectrum-textFaint">{backend.vendor}</span>

                    {RANK_BADGES[backend.id] && (
                      <span 
                        className={`ml-1 text-micro font-semibold px-1.5 py-0.5 rounded-[2px] ${RANK_BADGES[backend.id].color}`}
                        title={RANK_BADGES[backend.id].tooltip}
                      >
                        {RANK_BADGES[backend.id].badge}
                      </span>
                    )}

                    {isSelected && (
                      <Check className="w-3.5 h-3.5 text-spectrum-accent flex-shrink-0" />
                    )}

                    {!backend.checked && (
                      <Loader2 className="w-3 h-3 animate-spin text-spectrum-textFaint flex-shrink-0 ml-1" />
                    )}

                    {isAntigravity && (
                      <span className="ml-2 font-mono text-micro font-semibold text-spectrum-green px-1.5 py-0.5 rounded-[2px] bg-spectrum-green/10 border border-spectrum-green/25">
                        MCP Live · Port 3888
                      </span>
                    )}

                    <div className="ml-auto flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      {isAntigravity && (
                        <button
                          onClick={() => void window.electronAPI?.agents.openAntigravity()}
                          className="flex items-center gap-1.5 px-2 py-1 rounded-[3px] bg-spectrum-cardHover border border-spectrum-borderStrong text-ui font-semibold text-spectrum-textMuted hover:bg-spectrum-borderStrong hover:text-spectrum-accent transition-colors"
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
                          className="flex items-center gap-1.5 px-2 py-1 rounded-[3px] bg-spectrum-cardHover border border-spectrum-borderStrong text-ui font-semibold text-spectrum-textMuted hover:bg-spectrum-borderStrong hover:text-spectrum-accent transition-colors disabled:opacity-50"
                          title={backend.installHint}
                        >
                          {working ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                          Install
                        </button>
                      )}

                      {backend.checked && backend.installed && !backend.ready && (
                        <button
                          onClick={() => signIn(backend)}
                          className="flex items-center gap-1.5 px-2 py-1 rounded-[3px] bg-spectrum-cardHover border border-spectrum-borderStrong text-ui font-semibold text-spectrum-textMuted hover:bg-spectrum-borderStrong hover:text-spectrum-accent transition-colors"
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
                    <div className="text-ui text-spectrum-textDim mt-1 leading-snug">
                      {backend.fix}
                    </div>
                  )}

                  {/* Model Choice when ready */}
                  {backend.ready && models[backend.id] && (
                    <div
                      className="flex items-center gap-2 mt-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-ui text-spectrum-textDim flex-none">Model</span>
                      <input
                        list={`models-${backend.id}`}
                        value={models[backend.id].selected}
                        onChange={(e) => pickModel(backend, e.target.value)}
                        placeholder={`${backend.label} default`}
                        className="flex-1 px-2 py-1.5 rounded-[3px] bg-spectrum-panelHeader border border-line-bright font-mono text-ui-xs text-spectrum-accent placeholder-[#6b6b6b] outline-none focus:border-spectrum-accent"
                      />
                      <datalist id={`models-${backend.id}`}>
                        {models[backend.id].models.map((m) => <option key={m} value={m} />)}
                      </datalist>
                      <span
                        className="flex-none font-mono text-micro text-spectrum-textPlaceholder"
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
                      className="mt-2 pt-2 border-t border-spectrum-card space-y-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {KEY_PROVIDERS[backend.id] && (
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => openUrl(KEY_PROVIDERS[backend.id].url)}
                            className="text-ui text-spectrum-accent hover:underline flex items-center gap-1 font-medium"
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
                          className="flex-1 px-2 py-1.5 rounded-[3px] bg-spectrum-panelHeader border border-line-bright font-mono text-ui-xs text-spectrum-accent placeholder-[#6b6b6b] outline-none focus:border-spectrum-accent"
                        />
                        <button
                          onClick={() => saveKey(backend)}
                          disabled={busy === backend.id || !(keyDraft[backend.id] ?? '').trim()}
                          className="flex-none px-3 py-1.5 rounded-[3px] bg-spectrum-cardHover border border-line-bright text-ui font-semibold text-spectrum-textFaint hover:text-spectrum-accent hover:bg-spectrum-borderStrong transition-colors disabled:opacity-40"
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
            <pre className="text-micro font-mono text-spectrum-textFaint whitespace-pre-wrap break-all max-h-20 overflow-y-auto border-t border-spectrum-panelHeader pt-2 mt-2">
              {progress}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
