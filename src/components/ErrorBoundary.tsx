/* ═══════════════════════════════════════════════════════════════════
   What a crashed React tree looks like.

   Before this, it looked like a black window. React unmounts the whole
   tree when a render throws and nothing above it catches — so the editor
   vanished, no message appeared anywhere, and in a packaged build there
   was no console to check and no file to read.

   The point of this component is not to be pretty. It is that the
   failure leaves EVIDENCE: the error and its component stack go to the
   log file main owns, and the person looking at the window is told where
   that file is rather than being asked to reproduce it.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';

interface State {
  error: Error | null;
  componentStack: string;
  logPath: string;
  copied: boolean;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, componentStack: '', logPath: '', copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const componentStack = info.componentStack ?? '';
    this.setState({ componentStack });

    /*
      Record it before doing anything else. `componentStack` is the part
      that says WHICH component threw, and it exists nowhere else — not
      in the console line, not in the stack trace.
    */
    void window.electronAPI?.crash
      ?.report({
        message: `React tree crashed: ${error.message}`,
        detail: `${error.stack ?? String(error)}\n\nComponent stack:${componentStack}`,
        source: 'ErrorBoundary',
      })
      .then((r) => this.setState({ logPath: r?.logPath ?? '' }))
      .catch(() => {
        /* Running outside Electron, or main is already gone. The screen
           below still renders, which is the part that matters. */
      });
  }

  private copy = (): void => {
    const { error, componentStack } = this.state;
    void navigator.clipboard
      ?.writeText(`${error?.stack ?? error?.message ?? 'unknown'}\n\nComponent stack:${componentStack}`)
      .then(() => this.setState({ copied: true }))
      .catch(() => {
        /* No clipboard permission. The text is on screen either way. */
      });
  };

  render(): React.ReactNode {
    const { error, componentStack, logPath, copied } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-spectrum-stage p-8 overflow-auto">
        <div className="max-w-2xl w-full">
          <h1 className="text-ui-lg font-semibold text-spectrum-amber mb-1">
            TeminaliCut hit an error and stopped drawing.
          </h1>
          <p className="text-ui-sm text-spectrum-textMuted mb-4">
            Your project is still in memory. It has not been written over. Reloading the
            window recovers the last autosave.
          </p>

          <pre className="text-ui-sm leading-relaxed font-mono text-spectrum-textMuted bg-black/40 border border-white/10 rounded-md p-3 mb-3 max-h-64 overflow-auto whitespace-pre-wrap">
            {error.stack ?? `${error.name}: ${error.message}`}
            {componentStack ? `\n\nComponent stack:${componentStack}` : ''}
          </pre>

          {logPath && (
            <p className="text-ui-sm font-mono text-spectrum-textFaint mb-4 break-all">
              Written to {logPath}
            </p>
          )}

          <div className="flex gap-2">
            <button className="pro-btn-filled h-[30px] px-3 text-ui-sm" onClick={() => window.location.reload()}>
              Reload the window
            </button>
            <button className="pro-btn h-[30px] px-3 text-ui-sm" onClick={this.copy}>
              {copied ? 'Copied' : 'Copy details'}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/**
 * Failures React never sees.
 *
 * An error boundary only catches throws during render, lifecycle and
 * constructors. A rejected promise in an event handler, or a throw in a
 * `setTimeout`, reaches neither — it lands on `window` and, before this,
 * went nowhere at all in a packaged build.
 */
export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (e) => {
    void window.electronAPI?.crash?.report({
      message: `Uncaught error: ${e.message}`,
      detail: e.error?.stack ?? `${e.filename}:${e.lineno}:${e.colno}`,
      source: 'window.onerror',
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    void window.electronAPI?.crash?.report({
      message: `Unhandled promise rejection: ${reason?.message ?? String(reason)}`,
      detail: reason?.stack ?? undefined,
      source: 'unhandledrejection',
    });
  });
}
