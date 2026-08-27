/* ═══════════════════════════════════════════════════════════════════
   The block above the fold: one primary tile, a secondary card under
   it, and a tall rail down the right.

   The primary tile is LEFT-ALIGNED with a supporting line, not a
   centred label. A 900px slab with two centred words in it is the
   shape of a placeholder — the space is doing nothing, and nothing on
   it says what pressing it will do. Left-aligning gives the type a
   hierarchy to sit in, and the arrow on the right is the affordance
   that makes it read as an action rather than a banner.

   BOTH CARDS IN THE COLUMN NOW SHARE ONE INTERNAL GRID: a 48px mark on
   the left edge, the type block at the same offset from it, and the
   arrow against the right edge. They used to disagree — the hero laid
   out horizontally and the Copilot card stacked vertically at a
   different inset — and two cards of the same width, stacked, whose
   contents start in different places is the single loudest thing a
   layout can get wrong. Nothing about it is visible as a mistake; it
   just reads as untidy, everywhere, at once.

   The empty half of the hero holds a RULER. Kerf's subject is a strip
   of frames with a scale under it, and this is the way into one, so
   the space carries the thing the product is about instead of 300px of
   gradient nobody chose.

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
const HERO_H = 208;
const CARD_H = 168;
const GAP = 14;

/* The shared grid. Two constants rather than two sets of utility
   classes, because "the same" is the whole point and a pair of numbers
   that must agree should be one number. */
const INSET = 'px-8';
const MARK = 'w-12 h-12 rounded-[15px] flex items-center justify-center flex-shrink-0';

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
    <div className="flex gap-3.5 items-stretch">

      {/* ── Left column ── */}
      <div className="flex-1 min-w-0 flex flex-col" style={{ gap: GAP }}>

        <button
          data-home="new-project"
          onClick={onNewProject}
          style={{ height: HERO_H }}
          className={`hero-tile rise-in rise-1 w-full rounded-squircle-lg group
                      flex items-center text-left ${INSET}`}
        >
          {/* Glass, not a dark chip: on a saturated field a black
              square reads as a hole punched through the surface. */}
          <span className={`${MARK} relative z-[2]
                           bg-white/[0.16] ring-1 ring-inset ring-white/25
                           shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]
                           transition-colors duration-base group-hover:bg-white/[0.22]`}>
            <Plus className="w-6 h-6 text-white" />
          </span>

          <span className="ml-5 min-w-0 relative z-[2]">
            <span className="block text-[30px] leading-[1.06] font-semibold text-white tracking-[-0.028em]
                             drop-shadow-[0_1px_2px_rgba(40,12,4,0.35)]">
              New project
            </span>
            <span className="block text-ui-xl text-white/[0.72] mt-1.5">
              Record your screen, or start from an empty timeline
            </span>
          </span>

          {/* The ruler. Two passes on one baseline: a short mark every
              16px and a tall one every 64px, which is how a scale reads
              as a scale rather than as hatching. It takes the leftover
              width instead of being given a width, so it is exactly as
              long as the space actually is at any window size. */}
          <span
            aria-hidden="true"
            className="hidden md:block flex-1 min-w-0 mx-8 relative h-[26px] opacity-[0.55] z-[2]"
          >
            <span className="frame-ticks absolute inset-x-0 bottom-0 h-[9px]" />
            <span className="frame-ticks-tall absolute inset-x-0 bottom-0 h-[24px]" />
          </span>

          <span className="ml-auto w-9 h-9 rounded-full bg-white/[0.12] ring-1 ring-inset ring-white/15
                           flex items-center justify-center flex-shrink-0 relative z-[2]
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
          className={`surface-card surface-card-hover rise-in rise-2 w-full
                      rounded-squircle-lg relative overflow-hidden text-left ${INSET} group
                      flex items-center`}
        >
          <span className={`${MARK} bg-spectrum-blue/[0.13] ring-1 ring-inset ring-spectrum-blue/20 relative z-[1]`}>
            <Sparkle className="w-[22px] h-[22px] text-spectrum-blue" />
          </span>

          <span className="ml-5 min-w-0 relative z-[1]">
            <span className="block text-display-lg font-semibold text-spectrum-text">
              Copilot
            </span>

            <span className="block text-ui-xl text-spectrum-textMuted mt-1.5 max-w-[430px]">
              Describe the edit and have an agent make it, on your timeline.
            </span>

            {/* The differentiator, and the reason there is no metering
                here: the inference is bought and paid for by the person
                using it. Never truncated — a claim cut off mid-word is
                worse than no claim. */}
            <span className="flex items-center gap-1.5 mt-2.5 text-ui-sm text-spectrum-blue/90 leading-snug">
              <KeyRound className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{runsOn}</span>
            </span>
          </span>

          <span className="ml-auto w-9 h-9 rounded-full bg-white/[0.05] ring-1 ring-inset ring-white/[0.09]
                           flex items-center justify-center flex-shrink-0 relative z-[1]
                           transition-transform duration-base ease-snap group-hover:translate-x-1">
            <ArrowRight className="w-[18px] h-[18px] text-spectrum-textMuted" />
          </span>

          <span
            aria-hidden="true"
            /* A wide, weak wash rather than a disc. A radial that ends
               inside the card has a visible edge, and a visible edge on
               a decorative glow is just a grey circle.

               Moved to the right half, where the space actually is. On
               the bottom-left it lit the one part of the card that was
               already full of type, and left the empty end flat. */
            className="absolute -right-32 top-1/2 -translate-y-1/2 w-[540px] h-[540px] rounded-full opacity-60
                       transition-opacity duration-slow group-hover:opacity-90 pointer-events-none"
            style={{ background: 'radial-gradient(circle at 50% 50%,rgba(74,144,255,0.19) 0%,rgba(74,144,255,0.06) 40%,transparent 70%)' }}
          />
        </button>
      </div>

      {/* ── The rail ── */}
      <div className="w-[276px] flex-shrink-0 rise-in rise-3" style={{ height: HERO_H + GAP + CARD_H }}>
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
              <span className="poster-empty absolute inset-0 flex items-center justify-center">
                <Film className="w-8 h-8 text-white/[0.10]" />
              </span>
            )}

            {/* Letterboxed, both ends. A poster with a scrim on only one
                edge reads as an image someone put a caption on; scrimmed
                top and bottom it reads as a frame, which is what it is.
                The top one also gives the pill a ground to sit on
                instead of floating over whatever the frame happens to
                be bright at. */}
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-24 pointer-events-none"
              style={{ background: 'linear-gradient(to bottom,rgba(4,6,9,0.72) 0%,rgba(4,6,9,0.22) 52%,transparent 100%)' }}
            />

            {/* Two stops, not one: a single ramp to black crushes the
                middle of the frame while still not being dark enough
                behind the type. */}
            <span
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-3/5 pointer-events-none"
              style={{
                background:
                  'linear-gradient(to top,rgba(4,6,9,0.94) 0%,rgba(4,6,9,0.72) 34%,transparent 100%)',
              }}
            />

            <span className="media-pill absolute top-3.5 left-3.5 h-[21px] px-2 rounded-full flex items-center
                             !font-sans !text-white/85 font-medium tracking-wide">
              {mostRecent.starter ? 'Starter' : 'Continue'}
            </span>

            <span className="absolute inset-x-0 bottom-0 p-4">
              <span className="block text-[17px] font-semibold text-white leading-tight truncate
                               drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
                {mostRecent.name}
              </span>
              <span className="flex items-center gap-2 mt-2">
                <span className="block text-micro font-mono text-white/60 tabular truncate">
                  {formatDuration(mostRecent.durationMs)} · {mostRecent.aspectRatio} · {mostRecent.clipCount} clips
                </span>
                <span className="ml-auto w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center
                                 bg-white/[0.10] ring-1 ring-inset ring-white/15
                                 opacity-0 translate-x-1 transition-all duration-base ease-snap
                                 group-hover:opacity-100 group-hover:translate-x-0">
                  <ArrowRight className="w-3.5 h-3.5 text-white/90" />
                </span>
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
