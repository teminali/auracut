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
    <div className="scrim" onClick={close}>
      <div
        className="modal-shell w-[420px] max-w-[92vw]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kerf-sign-in-title"
      >

        <div className="panel-header p-6 pb-4 flex items-center justify-between border-b border-white/[0.06]">
          <h2 id="kerf-sign-in-title" className="text-[17px] font-semibold text-white tracking-tight">Sign in to FrontierCut</h2>
          <button onClick={close} className="w-7 h-7 rounded-lg text-[#9ca3af] hover:text-white hover:bg-white/[0.06] flex items-center justify-center transition-colors" title="Close"
            aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 pt-4">
          {signIn.phase === 'idle' && (
            <>
              <p className="text-ui text-[#94a3b8] leading-relaxed">
                An account is only needed to buy and install skills. The editor works
                without one, and nothing you edit is uploaded.
              </p>
              <div className="flex flex-col gap-2.5 mt-5">
                <button onClick={() => void begin('google')} className="btn-primary h-10 gap-2 text-ui font-medium">
                  Continue with Google
                </button>
                <button onClick={() => void begin('github')} className="pro-btn-filled h-10 gap-2 text-ui font-medium rounded-lg bg-[#0e1218] border border-[#232936] hover:border-[#384252] hover:bg-[#121720]">
                  Continue with GitHub
                </button>
              </div>
            </>
          )}

          {signIn.phase === 'starting' && (
            <div className="flex items-center gap-2.5 py-8 justify-center text-[#94a3b8]">
              <Loader2 className="w-4 h-4 animate-spin text-[#f97316]" />
              <span className="text-ui">Asking for a code…</span>
            </div>
          )}

          {signIn.phase === 'waiting' && (
            <>
              <p className="text-ui text-[#94a3b8] leading-relaxed">
                Open the page below and enter this code. Kerf is watching for it, so
                come back here when you are done.
              </p>

              <div className="mt-4 rounded-xl bg-[#0b0e13] border border-[#232936] p-5 text-center">
                <div className="font-mono text-[26px] font-semibold text-white tracking-[0.22em] tabular">
                  {signIn.auth.userCode}
                </div>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(signIn.auth.userCode);
                    pushToast({ kind: 'success', title: 'Code copied' });
                  }}
                  className="pro-btn h-7 px-3 gap-1.5 text-ui-xs mt-3 mx-auto rounded-md bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08]"
                >
                  <Copy className="w-3.5 h-3.5" /> Copy
                </button>
              </div>

              <a
                href={signIn.auth.verificationUriComplete ?? signIn.auth.verificationUri}
                target="_blank"
                rel="noreferrer"
                className="btn-primary h-10 w-full gap-2 text-ui font-medium mt-4"
              >
                <ExternalLink className="w-4 h-4" />
                {new URL(signIn.auth.verificationUri).host}
              </a>

              <div className="flex items-center gap-2 mt-4 text-[#64748b]">
                <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0 text-[#f97316]" />
                <span className="text-ui-xs">Waiting for you to finish in the browser…</span>
              </div>
            </>
          )}

          {signIn.phase === 'error' && (
            <>
              <div className="flex items-start gap-2.5 rounded-xl border border-spectrum-red/35
                              bg-spectrum-red/[0.07] p-4">
                <AlertTriangle className="w-4 h-4 text-spectrum-red flex-shrink-0 mt-0.5" />
                <p className="text-ui text-white leading-snug">{signIn.message}</p>
              </div>
              <button onClick={() => void begin('google')} className="btn-primary h-10 w-full mt-4 text-ui font-medium">
                Try again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
