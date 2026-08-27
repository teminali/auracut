/* ═══════════════════════════════════════════════════════════════════
   Signing in, by device code.

   A desktop app cannot catch an OAuth redirect, so the browser half and
   the app half are joined by a short code the person types. That is not
   a workaround — it is RFC 8628, and it is the flow that lets the
   provider's client secret stay on the server instead of shipping
   inside an MIT-licensed Electron bundle.

   The code is the whole screen. Everything else here is subordinate to
   it being readable across a room and impossible to mistype: monospace,
   wide tracking, and a copy button, because dictating it to yourself
   from one machine to another is the actual situation.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useAccountStore } from '../../store/accountStore';
import { useUiStore } from '../../store/uiStore';
import { X, Copy, ExternalLink, Loader2, AlertTriangle } from '../ui/icons';

export const SignInDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const signIn = useAccountStore((s) => s.signIn);
  const status = useAccountStore((s) => s.status);
  const begin = useAccountStore((s) => s.beginSignIn);
  const cancel = useAccountStore((s) => s.cancelSignIn);
  const pushToast = useUiStore((s) => s.pushToast);

  // Signing in from another window, or completing, closes this.
  React.useEffect(() => {
    if (status === 'signed_in') onClose();
  }, [status, onClose]);

  const close = () => { cancel(); onClose(); };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-[420px] rounded-squircle-lg bg-spectrum-panel border border-line shadow-modal animate-scale-in">

        <div className="flex items-center justify-between px-4 h-11 border-b border-line">
          <h2 className="text-ui-lg font-semibold text-spectrum-text">Sign in to Kerf</h2>
          <button onClick={close} className="pro-btn w-6 h-6" title="Close"
            aria-label="Close">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-4">
          {signIn.phase === 'idle' && (
            <>
              <p className="text-ui-lg text-spectrum-textMuted leading-relaxed">
                An account is only needed to buy and install skills. The editor works
                without one, and nothing you edit is uploaded.
              </p>
              <div className="flex flex-col gap-2 mt-4">
                <button onClick={() => void begin('google')} className="btn-primary h-9 gap-2 text-ui-lg">
                  Continue with Google
                </button>
                <button onClick={() => void begin('github')} className="pro-btn-filled h-9 gap-2 text-ui-lg">
                  Continue with GitHub
                </button>
              </div>
            </>
          )}

          {signIn.phase === 'starting' && (
            <div className="flex items-center gap-2.5 py-8 justify-center text-spectrum-textMuted">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-ui-lg">Asking for a code…</span>
            </div>
          )}

          {signIn.phase === 'waiting' && (
            <>
              <p className="text-ui-lg text-spectrum-textMuted leading-relaxed">
                Open the page below and enter this code. Kerf is watching for it, so
                come back here when you are done.
              </p>

              <div className="mt-4 rounded-squircle-md bg-spectrum-sunken border border-line p-4 text-center">
                <div className="font-mono text-[26px] font-semibold text-spectrum-text tracking-[0.22em] tabular">
                  {signIn.auth.userCode}
                </div>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(signIn.auth.userCode);
                    pushToast({ kind: 'success', title: 'Code copied' });
                  }}
                  className="pro-btn h-6 px-2 gap-1.5 text-ui-sm mt-2 mx-auto"
                >
                  <Copy className="w-3 h-3" /> Copy
                </button>
              </div>

              <a
                href={signIn.auth.verificationUriComplete ?? signIn.auth.verificationUri}
                target="_blank"
                rel="noreferrer"
                className="btn-primary h-9 w-full gap-2 text-ui-lg mt-3"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {new URL(signIn.auth.verificationUri).host}
              </a>

              <div className="flex items-center gap-2 mt-4 text-spectrum-textDim">
                <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                <span className="text-ui-sm">Waiting for you to finish in the browser…</span>
              </div>
            </>
          )}

          {signIn.phase === 'error' && (
            <>
              <div className="flex items-start gap-2.5 rounded-squircle-md border border-spectrum-red/35
                              bg-spectrum-red/[0.07] p-3">
                <AlertTriangle className="w-4 h-4 text-spectrum-red flex-shrink-0 mt-0.5" />
                <p className="text-ui-lg text-spectrum-text leading-snug">{signIn.message}</p>
              </div>
              <button onClick={() => void begin('google')} className="pro-btn-filled h-8 w-full mt-3 text-ui-lg">
                Try again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
