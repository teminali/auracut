/* ═══════════════════════════════════════════════════════════════════
   The floating control bar.

   This renders in its OWN BrowserWindow — frameless, transparent,
   always on top, and marked `setContentProtection(true)` in main so it
   does not appear in the recording it is controlling.

   Which means it is a second renderer process, with no access to the
   recorder store: none of that state exists here. Everything it shows
   arrives as one `recorder:state` message, and every button it has is a
   message back. That is not a limitation to work around, it is the
   right shape — there is exactly one place a take can be paused, and it
   is the window that owns the MediaRecorders.

   It exists because the editor window is hidden while a take runs. A
   recording you can only stop by unhiding the app you just hid is not a
   screen recorder.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { formatDuration } from '../../utils/time';
import { Pause, Play, Square, CursorClick } from '../ui/icons';

interface BarState {
  phase: string;
  elapsedMs: number;
  markCount: number;
}

export const RecorderBar: React.FC = () => {
  const [state, setState] = React.useState<BarState>({ phase: 'recording', elapsedMs: 0, markCount: 0 });
  /* Local, so pressing Mark acknowledges instantly rather than waiting
     for the next state push from the other window. Cleared on a timer
     rather than compared against `Date.now()` in the render: nothing
     re-renders this component when a moment passes, so the comparison
     would leave the button lit until something else happened. */
  const [flash, setFlash] = React.useState(false);

  React.useEffect(() => {
    document.documentElement.classList.add('recorder-bar-window');
    const off = window.electronAPI?.recorder.onState((incoming) => {
      setState({
        phase: String(incoming.phase ?? 'recording'),
        elapsedMs: Number(incoming.elapsedMs ?? 0),
        markCount: Number(incoming.markCount ?? 0),
      });
    });
    return () => { off?.(); };
  }, []);

  React.useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(false), 380);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const send = (action: string) => {
    if (action === 'mark') setFlash(true);
    void window.electronAPI?.recorder.barCommand(action);
  };

  const paused = state.phase === 'paused';
  const finishing = state.phase === 'processing';

  return (
    <div
      className="w-full h-full flex items-center gap-2 px-2.5 rounded-full select-none"
      /* The whole pill drags the window; the buttons opt back out below.
         Without this the bar is nailed to wherever main first put it,
         which is guaranteed to be over something you needed to see. */
      style={{
        WebkitAppRegion: 'drag',
        background: 'rgba(14,16,20,0.92)',
        backdropFilter: 'blur(18px) saturate(150%)',
        WebkitBackdropFilter: 'blur(18px) saturate(150%)',
        border: '1px solid rgba(255,255,255,0.10)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
      } as React.CSSProperties}
    >
      <span
        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ml-1 ${
          finishing ? 'bg-spectrum-textDim' : paused ? 'bg-spectrum-amber' : 'bg-spectrum-red animate-pulse'
        }`}
        aria-hidden="true"
      />

      <span className="font-mono tabular text-ui-lg text-white/95 min-w-[54px]">
        {formatDuration(state.elapsedMs)}
      </span>

      {state.markCount > 0 && (
        <span className="text-micro font-mono tabular text-white/45">{state.markCount}</span>
      )}

      <span className="ml-auto flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <BarButton
          onClick={() => send('mark')}
          disabled={finishing || paused}
          label="Mark a zoom moment"
          highlight={flash}
        >
          <CursorClick className="w-4 h-4" />
        </BarButton>

        <BarButton onClick={() => send('pause')} disabled={finishing} label={paused ? 'Resume' : 'Pause'}>
          {paused ? <Play className="w-4 h-4" weight="fill" /> : <Pause className="w-4 h-4" weight="fill" />}
        </BarButton>

        <button
          onClick={() => send('stop')}
          disabled={finishing}
          aria-label="Stop recording"
          title="Stop recording"
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0
                     bg-spectrum-red text-white transition-transform duration-base
                     hover:scale-105 active:scale-95 disabled:opacity-40"
        >
          <Square className="w-3.5 h-3.5" weight="fill" />
        </button>
      </span>
    </div>
  );
};

const BarButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  label: string;
  highlight?: boolean;
  children: React.ReactNode;
}> = ({ onClick, disabled, label, highlight, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors
                disabled:opacity-30 ${
      highlight ? 'bg-spectrum-accent text-white' : 'text-white/70 hover:text-white hover:bg-white/10'
    }`}
  >
    {children}
  </button>
);
