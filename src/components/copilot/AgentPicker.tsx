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
  Check, Download, LogIn, Loader2, AlertTriangle, X,
} from '../ui/icons';

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

  return (
    <div className="scrim" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="modal-shell w-[430px] max-w-[92vw]">
        <div className="panel-header">
          <span className="text-ui font-semibold text-spectrum-text">Copilot agent</span>
          <button onClick={onClose} className="pro-btn w-6 h-6"><X className="w-3.5 h-3.5" /></button>
            aria-label="Close the agent picker"
        </div>

        <div className="p-2.5 space-y-1.5 max-h-[62vh] overflow-y-auto">
          <p className="text-micro text-spectrum-textDim leading-relaxed px-0.5 pb-1">
            Whichever you pick gets Kerf's {48} editing tools over MCP, plus its own
            file, shell and web access.
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

                  {backend.checked && !backend.installed && (
                    <button
                      onClick={() => install(backend)}
                      disabled={working}
                      className="pro-btn-filled h-[24px] px-2 gap-1 text-micro flex-shrink-0"
                      title={backend.installHint}
                    
            aria-label={backend.installHint}>
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
                    
            aria-label={backend.fix}>
                      <LogIn className="w-3 h-3" /> Sign in
                    </button>
                  )}
                </div>

                {/*
                  Model choice. Free text as well as the list, because
                  only cursor-agent can actually enumerate its models —
                  everything else here is a suggestion, and a fixed list
                  presented as complete goes stale and starts lying.
                */}
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
                  /* Say it up front rather than let the panel look broken
                     the first time this backend runs a turn. */
                  <p className="mt-1.5 flex items-start gap-1 text-micro text-spectrum-amber/90 leading-snug">
                    <AlertTriangle className="w-2.5 h-2.5 mt-[1px] flex-shrink-0" />
                    Kerf has not verified how this CLI streams its output. Edits still work;
                    the answer arrives without the step-by-step.
                  </p>
                )}

                {backend.checked && !backend.ready && backend.fix && (
                  <p className="mt-1.5 text-micro text-spectrum-textDim leading-snug">{backend.fix}</p>
                )}

                {/* When a key is what it needs, take one here rather than
                    sending the user off to edit a shell profile the app
                    cannot read anyway. */}
                {backend.checked && !backend.ready && backend.needsKey && (
                  <div className="mt-1.5 flex items-center gap-1.5">
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
