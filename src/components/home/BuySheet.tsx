/* ═══════════════════════════════════════════════════════════════════
   Buying a skill with mobile money.

   This is not a checkout form. Nothing is entered here except a phone
   number: the actual payment happens on the buyer's handset, as a PIN
   prompt Selcom pushes to them, and the single most important job of
   this component is to SAY that clearly enough that nobody sits
   watching a spinner while their phone buzzes unnoticed in a pocket.

   The wallet is derived from the number's prefix and only asked for
   when the prefix is unrecognised — a wrong network sends the push
   nowhere at all, and prefix tables go stale, so guessing is worse
   than one extra tap.

   The timeout message is deliberately not "it failed". A push can be
   confirmed late, and telling somebody nothing was charged when it may
   have been is the one thing here that must never be a guess.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useAccountStore } from '../../store/accountStore';
import { formatPrice, looksLikeTzMsisdn, WALLETS, type StoreSkill } from '../../services/storeClient';
import { X, Smartphone, Loader2, CheckCircle2, AlertTriangle } from '../ui/icons';

interface Props {
  skill: StoreSkill;
  onClose: () => void;
}

export const BuySheet: React.FC<Props> = ({ skill, onClose }) => {
  const user = useAccountStore((s) => s.user);
  const purchase = useAccountStore((s) => s.purchase);
  const buy = useAccountStore((s) => s.buy);
  const reset = useAccountStore((s) => s.resetPurchase);

  // Prefilled from the account: the number is the one field a repeat
  // buyer should never type twice.
  const [msisdn, setMsisdn] = React.useState(user?.msisdn ?? '');
  const [wallet, setWallet] = React.useState<string>('');
  const [showWallet, setShowWallet] = React.useState(false);

  const valid = looksLikeTzMsisdn(msisdn);

  const close = () => { reset(); onClose(); };

  const submit = () => {
    if (!valid) return;
    void buy(skill.id, msisdn, wallet || undefined);
  };

  /* An unknown prefix comes back from the server as `unknown_provider`;
     that is when — and only when — the network picker appears. */
  React.useEffect(() => {
    if (purchase.phase === 'error' && purchase.message.toLowerCase().includes('network')) {
      setShowWallet(true);
    }
  }, [purchase]);

  const busy = purchase.phase === 'creating' || purchase.phase === 'awaiting_pin';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-[420px] rounded-squircle-lg bg-spectrum-panel border border-line shadow-modal animate-scale-in">

        <div className="flex items-center justify-between px-4 h-11 border-b border-line">
          <h2 className="text-ui-lg font-semibold text-spectrum-text truncate">{skill.name}</h2>
          <button onClick={close} disabled={busy} className="pro-btn w-6 h-6" title="Close">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-4">
          {/* ── done ── */}
          {purchase.phase === 'done' && (
            <div className="text-center py-4">
              <CheckCircle2 className="w-10 h-10 text-spectrum-green mx-auto" />
              <p className="text-display font-semibold text-spectrum-text mt-3">Paid</p>
              <p className="text-ui-lg text-spectrum-textMuted mt-1 leading-relaxed">
                {skill.name} is yours. It is in your skills now.
              </p>
              <button onClick={close} className="btn-primary h-9 w-full mt-4 text-ui-lg">Done</button>
            </div>
          )}

          {/* ── the PIN prompt is on their phone ── */}
          {purchase.phase === 'awaiting_pin' && (
            <div className="text-center py-4">
              <span className="relative inline-flex">
                <Smartphone className="w-10 h-10 text-spectrum-accent" />
                <span className="absolute inset-0 rounded-full animate-pulse-ring" />
              </span>
              <p className="text-display font-semibold text-spectrum-text mt-3">Check your phone</p>
              <p className="text-ui-lg text-spectrum-textMuted mt-1 leading-relaxed max-w-[300px] mx-auto">
                A prompt for {formatPrice(skill.price.amount, skill.price.currency)} has been sent
                to <span className="font-mono text-spectrum-text">{msisdn}</span>. Enter your
                mobile-money PIN to approve it.
              </p>
              <div className="flex items-center gap-2 justify-center mt-4 text-spectrum-textDim">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="text-ui-sm">Waiting for confirmation…</span>
              </div>
            </div>
          )}

          {/* ── failed, or ran out of patience ── */}
          {purchase.phase === 'error' && (
            <>
              <div className="flex items-start gap-2.5 rounded-squircle-md border border-spectrum-amber/35
                              bg-spectrum-amber/[0.07] p-3">
                <AlertTriangle className="w-4 h-4 text-spectrum-amber flex-shrink-0 mt-0.5" />
                <p className="text-ui-lg text-spectrum-text leading-snug">{purchase.message}</p>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => reset()} className="pro-btn-filled h-8 flex-1 text-ui-lg">
                  Try again
                </button>
                <button onClick={close} className="pro-btn h-8 px-3 text-ui-lg">Close</button>
              </div>
            </>
          )}

          {/* ── the form ── */}
          {(purchase.phase === 'idle' || purchase.phase === 'creating') && (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-ui-lg text-spectrum-textMuted">One-time, version {skill.majorVersion}.x</span>
                <span className="text-display-lg font-semibold text-spectrum-text tabular">
                  {formatPrice(skill.price.amount, skill.price.currency)}
                </span>
              </div>

              <label className="block mt-4">
                <span className="text-ui-sm font-medium text-spectrum-textMuted">Mobile money number</span>
                <input
                  value={msisdn}
                  onChange={(e) => setMsisdn(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && valid) submit(); }}
                  inputMode="tel"
                  autoFocus
                  placeholder="0712 345 678"
                  className="pro-input w-full h-9 px-2.5 mt-1.5 text-ui-lg font-mono"
                />
              </label>

              {msisdn && !valid && (
                <p className="text-ui-sm text-spectrum-amber mt-1.5">
                  That does not look like a Tanzanian mobile number yet.
                </p>
              )}

              {showWallet && (
                <label className="block mt-3">
                  <span className="text-ui-sm font-medium text-spectrum-textMuted">Which network?</span>
                  <select
                    value={wallet}
                    onChange={(e) => setWallet(e.target.value)}
                    className="pro-input w-full h-9 px-2 mt-1.5 text-ui-lg"
                  >
                    <option value="">Choose…</option>
                    {WALLETS.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                  </select>
                </label>
              )}

              <button
                onClick={submit}
                disabled={!valid || purchase.phase === 'creating'}
                className="btn-primary h-9 w-full mt-4 gap-2 text-ui-lg"
              >
                {purchase.phase === 'creating'
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending the prompt…</>
                  : <>Pay {formatPrice(skill.price.amount, skill.price.currency)}</>}
              </button>

              <p className="text-micro text-spectrum-textFaint text-center mt-2.5 leading-snug">
                You approve the payment on your own handset. Kerf never sees your PIN,
                and the number is stored only to save you typing it next time.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
