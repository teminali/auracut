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
        aria-label="Start a new project"
      >
        <div className="panel-header">
          <span className="text-ui font-semibold text-spectrum-text">New project</span>
          <button onClick={onClose} className="pro-btn w-6 h-6" aria-label="Close">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-3 grid grid-cols-2 gap-3">
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
            accent
            onSelect={onRecord}
          />

          <Option
            testId="new-blank"
            icon={Film}
            title="Blank timeline"
            blurb="An empty sequence. Bring your own footage, or describe the edit to the Copilot."
            bullets={[]}
            onSelect={onBlank}
          />
        </div>
      </div>
    </div>
  );
};

/* ── One option ─────────────────────────────────────────────────── */

interface OptionProps {
  testId: string;
  icon: React.ElementType;
  title: string;
  blurb: string;
  bullets: { icon: React.ElementType; text: string }[];
  accent?: boolean;
  onSelect: () => void;
}

const Option: React.FC<OptionProps> = ({ testId, icon: Icon, title, blurb, bullets, accent, onSelect }) => (
  <button
    data-home={testId}
    onClick={onSelect}
    className={`group relative overflow-hidden rounded-squircle-lg border text-left p-5 min-h-[248px]
                flex flex-col transition-colors duration-base ${
      accent
        ? 'border-spectrum-accentLine bg-spectrum-accent/[0.07] hover:bg-spectrum-accent/[0.11]'
        : 'border-line bg-spectrum-sunken/50 hover:bg-spectrum-card'
    }`}
  >
    <span
      className={`w-11 h-11 rounded-[13px] flex items-center justify-center flex-shrink-0 ${
        accent ? 'bg-spectrum-accent/20' : 'bg-spectrum-card'
      }`}
    >
      <Icon className={`w-[22px] h-[22px] ${accent ? 'text-spectrum-accent' : 'text-spectrum-textMuted'}`} />
    </span>

    <span className="block text-display font-semibold text-spectrum-text mt-4">{title}</span>
    <span className="block text-ui-lg text-spectrum-textMuted leading-relaxed mt-2 max-w-[300px]">{blurb}</span>

    {bullets.length > 0 && (
      <span className="block mt-4 space-y-2">
        {bullets.map((bullet) => (
          <span key={bullet.text} className="flex items-center gap-2 text-ui-sm text-spectrum-textDim">
            <bullet.icon className="w-3.5 h-3.5 flex-shrink-0 text-spectrum-textFaint" />
            <span>{bullet.text}</span>
          </span>
        ))}
      </span>
    )}

    <span className="mt-auto pt-4 flex items-center gap-1.5 text-ui-sm font-medium text-spectrum-textMuted
                     group-hover:text-spectrum-text transition-colors">
      <span>Start</span>
      <ArrowRight className="w-3.5 h-3.5 transition-transform duration-base ease-snap group-hover:translate-x-0.5" />
    </span>
  </button>
);
