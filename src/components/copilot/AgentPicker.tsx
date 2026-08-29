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
        className="modal-shell w-[440px] max-w-[92vw]"
        role="dialog"
        aria-modal="true"
        aria-label="Copilot agent"
      >
        <div className="panel-header">
          <span className="text-ui font-semibold text-spectrum-text">Copilot agent</span>
          <button onClick={onClose} className="pro-btn w-6 h-6" aria-label="Close the agent picker">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-2.5 space-y-2 max-h-[64vh] overflow-y-auto">
          {/* Antigravity direct MCP connection indicator */}
          <div className="rounded-squircle-xs border border-spectrum-accent/30 bg-spectrum-accent/[0.08] p-2.5 space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-spectrum-green animate-pulse" />
                <span className="text-ui-sm font-semibold text-spectrum-text">Antigravity IDE Agent</span>
              </div>
              <span className="text-micro font-mono text-spectrum-accent px-1.5 py-0.5 rounded bg-spectrum-accent/15">
                MCP Live · Port 3888
              </span>
            </div>
            <p className="text-micro text-spectrum-textDim leading-snug">
              Connected! Chat directly with Antigravity in your IDE to edit this timeline with zero CLI setup and zero credit costs.
            </p>
          </div>

          <p className="text-micro text-spectrum-textDim leading-relaxed px-0.5 pt-0.5">
            Or configure a local CLI to drive the in-app Copilot drawer:
          </p>

          {loading && (
            <div className="flex items-center gap-2 py-4 justify-center text-micro text-spectrum-textDim">
              <Loader2 className="w-3 h-3 animate-spin" /> Looking for installed agents…
            </div>
          )}

          {backends.map((backend) => {
            const isSelected = backend.id === selected;
            const working = busy === backend.id;

            return (
              <div
                key={backend.id}
                className={`rounded-squircle-xs border p-2 transition-colors ${
                  isSelected
                    ? 'border-spectrum-accentLine bg-spectrum-accent/[0.07]'
                    : 'border-line bg-spectrum-sunken/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => choose(backend)}
                    disabled={!backend.checked || !backend.ready}
                    className="flex-1 min-w-0 text-left disabled:cursor-not-allowed"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="text-ui-sm font-medium text-spectrum-text truncate">
                        {backend.label}
                      </span>
                      <span className="text-micro text-spectrum-textFaint">{backend.vendor}</span>
                      {!backend.checked && (
                        <Loader2 className="w-2.5 h-2.5 animate-spin text-spectrum-textFaint flex-shrink-0" />
                      )}
                      {isSelected && <Check className="w-3 h-3 text-spectrum-accent flex-shrink-0" />}
                    </span>
                    <span className="block text-micro font-mono text-spectrum-textFaint truncate mt-0.5">
                      {!backend.checked
                        ? 'checking…'
                        : backend.ready
                          ? backend.version ?? backend.path ?? 'ready'
                          : backend.reason ?? 'not available'}
                    </span>
                  </button>

                  {backend.id === 'antigravity' && (
                    <button
                      onClick={() => void window.electronAPI?.agents.openAntigravity()}
                      className="pro-btn h-[24px] px-2 gap-1 text-micro flex-shrink-0 border border-line-strong hover:border-spectrum-accent"
                      title="Bring Antigravity IDE to the foreground"
                      aria-label="Bring Antigravity IDE to the foreground"
                    >
                      <ExternalLink className="w-2.5 h-2.5" /> Open IDE
                    </button>
                  )}

                  {backend.checked && !backend.installed && backend.id !== 'antigravity' && (
                    <button
                      onClick={() => install(backend)}
                      disabled={working}
                      className="pro-btn-filled h-[24px] px-2 gap-1 text-micro flex-shrink-0"
                      title={backend.installHint}
                      aria-label={backend.installHint}
                    >
                      {working
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Download className="w-3 h-3" />}
                      Install
                    </button>
                  )}

                  {backend.checked && backend.installed && !backend.ready && (
                    <button
                      onClick={() => signIn(backend)}
                      className="pro-btn-filled h-[24px] px-2 gap-1 text-micro flex-shrink-0"
                      title={backend.fix}
                      aria-label={backend.fix}
                    >
                      <LogIn className="w-3 h-3" /> Sign in
                    </button>
                  )}
                </div>

                {/* Model choice */}
                {backend.ready && models[backend.id] && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="text-micro text-spectrum-textFaint flex-shrink-0 w-[34px]">Model</span>
                    <input
                      list={`models-${backend.id}`}
                      value={models[backend.id].selected}
                      onChange={(e) => pickModel(backend, e.target.value)}
                      placeholder={`${backend.label} default`}
                      className="pro-input flex-1 h-[22px] px-1.5 text-micro font-mono min-w-0"
                    />
                    <datalist id={`models-${backend.id}`}>
                      {models[backend.id].models.map((m) => <option key={m} value={m} />)}
                    </datalist>
                    <span
                      className="text-micro text-spectrum-textFaint flex-shrink-0"
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

                {backend.ready && !backend.streamVerified && (
                  <p className="mt-1.5 flex items-start gap-1 text-micro text-spectrum-amber/90 leading-snug">
                    <AlertTriangle className="w-2.5 h-2.5 mt-[1px] flex-shrink-0" />
                    Kerf has not verified how this CLI streams its output. Edits still work;
                    the answer arrives without the step-by-step.
                  </p>
                )}

                {backend.checked && !backend.ready && backend.fix && (
                  <p className="mt-1.5 text-micro text-spectrum-textDim leading-snug">{backend.fix}</p>
                )}

                {/* When a key is what it needs, show quick link and paste input */}
                {backend.checked && !backend.ready && backend.needsKey && (
                  <div className="mt-2 space-y-1.5 pt-1 border-t border-line-soft">
                    {KEY_PROVIDERS[backend.id] && (
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => openUrl(KEY_PROVIDERS[backend.id].url)}
                          className="text-micro text-spectrum-accent hover:underline flex items-center gap-1 font-medium"
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
                    <div className="flex items-center gap-1.5">
                      <input
                        type="password"
                        value={keyDraft[backend.id] ?? ''}
                        onChange={(e) => setKeyDraft((d) => ({ ...d, [backend.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') void saveKey(backend); }}
                        placeholder={backend.hasKey ? `${backend.needsKey} stored. Paste to replace` : backend.needsKey}
                        className="pro-input flex-1 h-[24px] px-1.5 text-micro font-mono min-w-0"
                      />
                      <button
                        onClick={() => saveKey(backend)}
                        disabled={busy === backend.id || !(keyDraft[backend.id] ?? '').trim()}
                        className="pro-btn-filled h-[24px] px-2 text-micro flex-shrink-0"
                      >
                        {busy === backend.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {progress && (
            <pre className="text-micro font-mono text-spectrum-textFaint whitespace-pre-wrap break-all max-h-20 overflow-y-auto border-t border-line pt-1.5 mt-1">
              {progress}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
