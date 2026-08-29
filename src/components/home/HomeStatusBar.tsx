/* ═══════════════════════════════════════════════════════════════════
   The status strip along the foot of the launcher.

   Four facts and a build stamp, and every one of them is read rather
   than written: whether the agent has been found, whether the GPU
   stage actually has a context, when the autosave slot was last
   touched, and what this build is. The approved design has this strip
   and the platform had nowhere that answered any of it.

   NOTHING HERE IS DECORATIVE. "GPU on" asks the real WebGL2 context;
   if there is no context it says so, because a green light that is
   always green is worse than no light. The autosave line reads the
   real slot's timestamp and says "no autosave yet" when there is none
   — which, on home, is the correct and common answer, since coming
   back to home clears the slot on purpose (HANDOVER §7).
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useClaudeAgentStore } from '../../store/claudeAgentStore';
import { autosaveAgeMs } from '../../engine/projectIO';
import { CHANGELOG } from '../../services/changelog';
import { StatusDot } from '../ui/Primitives';
import { gpuAvailable } from '../../engine/gpuStage';

function ago(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)}h ago`;
}

export const HomeStatusBar: React.FC = () => {
  const status = useClaudeAgentStore((s) => s.status);
  const [age, setAge] = React.useState<number | null>(() => autosaveAgeMs());
  /* Asks for a real WebGL2 context. A light that is always green is
     worse than no light. */
  const [gpu] = React.useState<boolean>(() => { try { return gpuAvailable(); } catch { return false; } });

  /* The slot is written by the editor every 20s, so a minute is a
     generous poll and costs nothing on a screen that is idle. */
  React.useEffect(() => {
    const t = window.setInterval(() => setAge(autosaveAgeMs()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const platform =
    typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? 'macOS'
      : typeof navigator !== 'undefined' && /Win/.test(navigator.platform) ? 'Windows'
        : 'Linux';

  const agentReady = status !== null && status.installed;

  /* The build, from the one place that already knows it. */
  const version = CHANGELOG[0]?.version ?? '';

  return (
    <footer className="hp-statusbar" aria-label="Status">
      <span className="hp-status-item">
        <StatusDot state={status === null ? 'unknown' : agentReady ? 'on' : 'off'} />
        {status === null ? 'Checking…' : agentReady ? 'Ready' : 'No agent'}
      </span>

      <span className="hp-status-sep" />
      <span className="hp-status-item">{gpu ? 'GPU on' : 'GPU off'}</span>

      <span className="hp-status-sep" />
      <span className="hp-status-item">
        {age === null ? 'No autosave yet' : `Autosave ${ago(age)}`}
      </span>

      <span className="flex-1" />

      <span className="hp-status-item font-mono">Kerf {version} · {platform}</span>
    </footer>
  );
};
