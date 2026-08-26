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
     unverified   works, but AuraCut has not confirmed how it streams
                  its output, so the answer arrives without the
                  step-by-step
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { AgentBackendStatus } from '../../types/electron';
import { useUiStore } from '../../store/uiStore';
import { Check, Download, LogIn, Loader2, AlertTriangle, X } from 'lucide-react';

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
          <span className="text-[12px] font-semibold text-spectrum-text">Copilot agent</span>
          <button onClick={onClose} className="pro-btn w-6 h-6"><X className="w-3.5 h-3.5" /></button>
        </div>

        <div className="p-2.5 space-y-1.5 max-h-[62vh] overflow-y-auto">
          <p className="text-[10px] text-spectrum-textDim leading-relaxed px-0.5 pb-1">
            Whichever you pick gets AuraCut's {48} editing tools over MCP, plus its own
            file, shell and web access.
          </p>

          {loading && (
            <div className="flex items-center gap-2 py-4 justify-center text-[10px] text-spectrum-textDim">
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
                    disabled={!backend.ready}
                    className="flex-1 min-w-0 text-left disabled:cursor-not-allowed"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium text-spectrum-text truncate">
                        {backend.label}
                      </span>
                      <span className="text-[9px] text-spectrum-textFaint">{backend.vendor}</span>
                      {isSelected && <Check className="w-3 h-3 text-spectrum-accent flex-shrink-0" />}
                    </span>
                    <span className="block text-[9px] font-mono text-spectrum-textFaint truncate mt-0.5">
                      {backend.ready
                        ? backend.version ?? backend.path ?? 'ready'
                        : backend.reason ?? 'not available'}
                    </span>
                  </button>

                  {!backend.installed && (
                    <button
                      onClick={() => install(backend)}
                      disabled={working}
                      className="pro-btn-filled h-[24px] px-2 gap-1 text-[10px] flex-shrink-0"
                      title={backend.installHint}
                    >
                      {working
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Download className="w-3 h-3" />}
                      Install
                    </button>
                  )}

                  {backend.installed && !backend.ready && (
                    <button
                      onClick={() => signIn(backend)}
                      className="pro-btn-filled h-[24px] px-2 gap-1 text-[10px] flex-shrink-0"
                      title={backend.fix}
                    >
                      <LogIn className="w-3 h-3" /> Sign in
                    </button>
                  )}
                </div>

                {backend.ready && !backend.streamVerified && (
                  /* Say it up front rather than let the panel look broken
                     the first time this backend runs a turn. */
                  <p className="mt-1.5 flex items-start gap-1 text-[9px] text-spectrum-amber/90 leading-snug">
                    <AlertTriangle className="w-2.5 h-2.5 mt-[1px] flex-shrink-0" />
                    AuraCut has not verified how this CLI streams its output. Edits still work;
                    the answer arrives without the step-by-step.
                  </p>
                )}

                {!backend.ready && backend.fix && (
                  <p className="mt-1.5 text-[9px] text-spectrum-textDim leading-snug">{backend.fix}</p>
                )}
              </div>
            );
          })}

          {progress && (
            <pre className="text-[9px] font-mono text-spectrum-textFaint whitespace-pre-wrap break-all max-h-20 overflow-y-auto border-t border-line pt-1.5 mt-1">
              {progress}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
