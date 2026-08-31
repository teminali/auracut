/* ═══════════════════════════════════════════════════════════════════
   What "New project" means, now that it means two things.

   The hero tile used to go straight to an empty timeline, which was
   the only kind of project there was. There are two now, and the
   difference between them is not a setting — one of them takes over
   the screen and starts a capture — so it is a choice made before
   anything happens rather than a mode toggled afterwards.

   Two options, not a list of six. A chooser that opens onto a wall of
   templates is a second home screen, and the projects wall is already
   downstairs.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { Film, Monitor, ArrowRight, X, CursorClick, Video, Mic } from '../ui/icons';

interface Props {
  onBlank: () => void;
  onRecord: () => void;
  onClose: () => void;
}

export const NewProjectSheet: React.FC<Props> = ({ onBlank, onRecord, onClose }) => {
  /* Escape closes it. A modal that can only be dismissed by finding the
     right pixel is the one interaction every launcher gets wrong. */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="scrim" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-shell w-[720px] max-w-[94vw]"
        role="dialog"
        aria-modal="true"
        aria-label="Start a new project"
      >
        <div className="panel-header p-6 pb-4">
          <span className="text-[17px] font-semibold text-white tracking-tight">New project</span>
          <button onClick={onClose} className="w-7 h-7 rounded-lg text-[#9ca3af] hover:text-white hover:bg-white/[0.06] flex items-center justify-center transition-colors" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 pt-2 grid grid-cols-2 gap-4">
          <Option
            testId="new-record"
            icon={Monitor}
            title="Record the screen"
            blurb="Capture a display and your camera, then land both on the timeline as separate clips."
            bullets={[
              { icon: Video, text: 'Screen and camera at full resolution' },
              { icon: Mic, text: 'Narration on its own audio track' },
              { icon: CursorClick, text: 'Zooms built from where you worked' },
            ]}
            variant="amber"
            onSelect={onRecord}
          />

          <Option
            testId="new-blank"
            icon={Film}
            title="Blank timeline"
            blurb="An empty sequence. Bring your own footage, or describe the edit to the Copilot."
            bullets={[]}
            variant="cyan"
            onSelect={onBlank}
          />
        </div>
      </div>
    </div>
  );
};

/* ── One option ── */

interface OptionProps {
  testId: string;
  icon: React.ElementType;
  title: string;
  blurb: string;
  bullets: { icon: React.ElementType; text: string }[];
  variant?: 'cyan' | 'amber';
  onSelect: () => void;
}

const Option: React.FC<OptionProps> = ({ testId, icon: Icon, title, blurb, bullets, variant = 'cyan', onSelect }) => (
  <button
    data-home={testId}
    onClick={onSelect}
    className={`group relative overflow-hidden rounded-[14px] p-6 min-h-[260px] flex flex-col justify-between text-left transition-all duration-200 bg-[#0e1218] hover:bg-[#121720] border ${
      variant === 'amber'
        ? 'border-[#f59e0b]/60 hover:border-[#f59e0b] hover:shadow-[0_0_24px_rgba(245,158,11,0.2)]'
        : 'border-[#0284c7]/50 hover:border-[#0284c7] hover:shadow-[0_0_24px_rgba(2,132,199,0.18)]'
    }`}
  >
    <div>
      <span className="w-10 h-10 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center flex-shrink-0 text-white">
        <Icon className="w-5 h-5" />
      </span>

      <span className="block text-display font-semibold text-white tracking-tight mt-4">{title}</span>
      <span className="block text-ui text-[#94a3b8] leading-relaxed mt-2">{blurb}</span>

      {bullets.length > 0 && (
        <span className="block mt-4 space-y-2">
          {bullets.map((bullet) => (
            <span key={bullet.text} className="flex items-center gap-2 text-ui-xs text-[#848d9a]">
              <bullet.icon className="w-3.5 h-3.5 flex-shrink-0 text-[#64748b]" />
              <span>{bullet.text}</span>
            </span>
          ))}
        </span>
      )}
    </div>

    <span className="mt-6 pt-4 flex items-center gap-1.5 text-ui-sm font-medium text-white group-hover:text-[#38bdf8] transition-colors">
      <span>Start</span>
      <ArrowRight className="w-3.5 h-3.5 transition-transform duration-base ease-snap group-hover:translate-x-1" />
    </span>
  </button>
);
