/* ═══════════════════════════════════════════════════════════════════
   The block above the fold: one primary tile, a secondary card under
   it, and a tall rail down the right.

   The primary tile is LEFT-ALIGNED with a supporting line, not a
   centred label. A 900px slab with two centred words in it is the
   shape of a placeholder — the space is doing nothing, and nothing on
   it says what pressing it will do. Left-aligning gives the type a
   hierarchy to sit in, and the arrow on the right is the affordance
   that makes it read as an action rather than a banner.

   CapCut runs an advertising carousel in the rail. This runs the most
   recent project, poster and all — §7 rule 1, real content over
   chrome, is why the recents list carries a rendered frame at all, and
   this is the largest place that frame can be shown.

   `data-home` attributes are stable test hooks. `verify_home` used to
   find things by their visible text, which went red the day a string
   changed; a restyle should not be able to break a behaviour check.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { RecentProject } from '../../store/recentsStore';
import { useClaudeAgentStore } from '../../store/claudeAgentStore';
import { formatDuration } from '../../utils/time';
import { Plus, Sparkle, Film, KeyRound, ArrowRight } from '../ui/icons';

interface Props {
  onNewProject: () => void;
  onOpenCopilot: () => void;
  mostRecent?: RecentProject;
  onOpenRecent: (entry: RecentProject) => void;
}

/* Hero + gap + secondary card — the rail matches the pair exactly. */
/* Taller, and the gap is wider. The reference gives its hero about
   a fifth of the window height and lets the type inside it be big;
   cramming the same words into 172px is what made ours look dense. */
const HERO_H = 200;
const CARD_H = 156;
const GAP = 16;

export const HeroRow: React.FC<Props> = ({ onNewProject, onOpenCopilot, mostRecent, onOpenRecent }) => {
  /*
    The card names the CLI that is actually connected when there is one.
    "your own Claude Code or Codex" is the general claim and it is true
    either way — HANDOVER §6: credentials are the user's own, and there
    is no inference cost to Kerf, ever. Saying which one is already
    signed in turns a marketing line into a fact about this machine.
  */
  const status = useClaudeAgentStore((s) => s.status);
  const runsOn = status?.installed
    ? `Runs on your own ${status.label ?? 'Claude Code'}, already signed in`
    : 'Runs on your own Claude Code or Codex';

  return (
    <div className="flex gap-4 items-stretch">

      {/* ── Left column ── */}
      <div className="flex-1 min-w-0 flex flex-col" style={{ gap: GAP }}>

        <button
          data-home="new-project"
          onClick={onNewProject}
          style={{ height: HERO_H }}
          className="hero-tile rise-in rise-1 w-full rounded-squircle-lg group
                     flex items-center text-left px-9"
        >
          {/* Glass, not a dark chip: on a saturated field a black
              square reads as a hole punched through the surface. */}
          <span className="w-12 h-12 rounded-[14px] flex items-center justify-center flex-shrink-0
                           bg-white/[0.16] ring-1 ring-inset ring-white/25
                           shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]
                           transition-colors duration-base group-hover:bg-white/[0.22]">
            <Plus className="w-6 h-6 text-white" />
          </span>

          <span className="ml-5 min-w-0">
            <span className="block text-[30px] leading-[1.08] font-semibold text-white tracking-[-0.028em]
                             drop-shadow-[0_1px_2px_rgba(0,20,32,0.35)]">
              New project
            </span>
            <span className="block text-ui-xl text-white/70 mt-1.5">
              Start from an empty timeline
            </span>
          </span>

          <span className="ml-auto w-9 h-9 rounded-full bg-white/[0.12] ring-1 ring-inset ring-white/15
                           flex items-center justify-center flex-shrink-0
                           transition-transform duration-base ease-snap group-hover:translate-x-1">
            <ArrowRight className="w-[18px] h-[18px] text-white/90" />
          </span>
        </button>

        {/* CapCut's "Video Studio" slot. Kerf's second way in is the
            Copilot, which is the thing nothing else here does. */}
        <button
          data-home="copilot"
          onClick={onOpenCopilot}
          style={{ height: CARD_H }}
          /* Full width of the column, not a 320px card floating in
             700px of nothing. The empty half was the weakest thing on
             the screen, and this is the differentiator — it should not
             be the smallest element above the fold. */
          className="surface-card surface-card-hover rise-in rise-2 w-full
                     rounded-squircle-lg relative overflow-hidden text-left px-6 py-5 group
                     flex flex-col justify-center"
        >
          <span className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-[11px] flex items-center justify-center flex-shrink-0
                             bg-spectrum-teal/12">
              <Sparkle className="w-[19px] h-[19px] text-spectrum-teal" />
            </span>
            <span className="text-[17px] leading-tight font-semibold text-spectrum-text tracking-[-0.016em]">Copilot</span>
          </span>

          <span className="block mt-3 text-ui-xl text-spectrum-textMuted leading-relaxed max-w-[440px]">
            Describe the edit and have an agent make it, on your timeline.
          </span>

          {/* The differentiator, and the reason there is no metering
              here: the inference is bought and paid for by the person
              using it. Never truncated — a claim cut off mid-word is
              worse than no claim. */}
          <span className="flex items-center gap-1.5 mt-3 text-ui-sm text-spectrum-teal/90 leading-snug">
            <KeyRound className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{runsOn}</span>
          </span>

          <span
            aria-hidden="true"
            /* A wide, weak wash rather than a disc. A radial that ends
               inside the card has a visible edge, and a visible edge on
               a decorative glow is just a grey circle. */
            className="absolute -right-40 -bottom-56 w-[520px] h-[520px] rounded-full opacity-55
                       transition-opacity duration-slow group-hover:opacity-80 pointer-events-none"
            style={{ background: 'radial-gradient(circle at 50% 50%,rgba(45,212,191,0.20) 0%,rgba(45,212,191,0.07) 38%,transparent 70%)' }}
          />
        </button>
      </div>

      {/* ── The rail ── */}
      <div className="w-[272px] flex-shrink-0 rise-in rise-3" style={{ height: HERO_H + GAP + CARD_H }}>
        {mostRecent ? (
          <button
            data-home="rail"
            onClick={() => onOpenRecent(mostRecent)}
            className="surface-card surface-card-hover group w-full h-full rounded-squircle-lg
                       overflow-hidden relative text-left"
          >
            {mostRecent.posterUrl ? (
              <img
                src={mostRecent.posterUrl}
                alt=""
                className="poster-zoom absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              /* A project with no captured frame yet. Faint film
                 perforations rather than one centred glyph on a void —
                 it reads as "no frame yet", not as a broken image. */
              <span
                className="absolute inset-0 flex items-center justify-center"
                style={{
                  background:
                    'repeating-linear-gradient(90deg,rgba(255,255,255,0.028) 0 2px,transparent 2px 22px),'
                    + 'linear-gradient(158deg,#1e2836 0%,#0e1219 100%)',
                }}
              >
                <Film className="w-8 h-8 text-white/12" />
              </span>
            )}

            {/* Two stops, not one: a single ramp to black crushes the
                middle of the frame while still not being dark enough
                behind the type. */}
            <span
              className="absolute inset-x-0 bottom-0 h-3/5 pointer-events-none"
              style={{
                background:
                  'linear-gradient(to top,rgba(4,6,9,0.94) 0%,rgba(4,6,9,0.72) 34%,transparent 100%)',
              }}
            />

            <span className="media-pill absolute top-3 left-3 h-[20px] px-2 rounded-full flex items-center
                             !font-sans !text-white/85 font-medium tracking-wide">
              {mostRecent.starter ? 'Starter' : 'Continue'}
            </span>

            <span className="absolute inset-x-0 bottom-0 p-3.5">
              <span className="block text-[17px] font-semibold text-white leading-tight truncate
                               drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
                {mostRecent.name}
              </span>
              <span className="block text-micro font-mono text-white/60 tabular mt-1.5">
                {formatDuration(mostRecent.durationMs)} · {mostRecent.aspectRatio} · {mostRecent.clipCount} clips
              </span>
            </span>
          </button>
        ) : (
          <div className="w-full h-full rounded-squircle-lg surface-card
                          flex items-center justify-center px-5 text-center">
            <p className="text-ui-sm text-spectrum-textDim leading-snug">
              The project you were last in shows up here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
