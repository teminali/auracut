/* ═══════════════════════════════════════════════════════════════════
   The top of the home column: four launch tiles, then the project you
   were last in.

   This is CapCut's opening row, slot for slot. Four tiles across, and
   the first two are saturated while the last two are plain, because
   colour is carrying PRIORITY: the two things you nearly always want
   are coloured and the two you sometimes want are not. That is the one
   job this codebase lets colour have, and it is the reason the row
   works at a glance rather than being four equal rectangles.

   Which four is Kerf's answer, not CapCut's. Theirs are two authoring
   modes and two AI features; ours are the four entry points that
   exist: a new project, the recorder, the Copilot, and a file.

   All four are the accent now, at three strengths: two saturated
   fields, two accent-tinted glyph chips, and the eight panel tiles
   below on neutral. The row used to be cyan, lilac, violet and blue —
   four hues, none of which meant anything, in a product whose first
   rule is that colour is information. Rank is carried by HOW MUCH
   accent a tile wears, which is a scale a reader can actually order;
   four different hues is a set, and a set has no order.

   The block under it is CapCut's "Create your first video in minutes"
   with its thumbnail. Ours holds the most recent project, poster and
   all. §7 rule 1, real content over chrome, is why the recents list
   carries a rendered frame at all, and this is where that frame earns
   its cost. The type sits UNDER the frame on the page, not inside a
   card, which is how the reference draws every media card it has.

   Recovery lives here now, as one line under that heading, and only
   after a session that never reached home. It was a permanent card in
   the rail titled "Unsaved work", shown to everybody for ever, because
   autosave writes every twenty seconds and the card only asked whether
   a key existed. Coming home is what saves a project to the wall, so
   coming home now clears the autosave: what is left in it is a crash,
   and a crash is worth one quiet line next to the project it belongs
   to — not a permanent card two feet away in the furniture.

   `data-home` attributes are stable test hooks. `verify_home` used to
   find things by their visible text, which went red the day a string
   changed; a restyle must not be able to break a behaviour check.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { RecentProject } from '../../store/recentsStore';
import { useClaudeAgentStore } from '../../store/claudeAgentStore';
import { formatDuration } from '../../utils/time';
import { Plus, Sparkle, Film, Video, FolderOpen, RotateCcw, X } from '../ui/icons';

interface Props {
  onNewProject: () => void;
  onOpenCopilot: () => void;
  onRecord: () => void;
  onOpenFile: () => void;
  mostRecent?: RecentProject;
  onOpenRecent: (entry: RecentProject) => void;
  /** A session that ended without coming back to home. Rare, on purpose. */
  recoverable: boolean;
  onRecover: () => void;
  onDiscardRecovery: () => void;
}

const TILE = 'hp-tile rounded-[10px] h-[92px] flex flex-col items-center justify-center gap-2 px-3';
const MARK = 'hp-launch-icon w-10 h-10 rounded-[10px] flex items-center justify-center flex-shrink-0';

export const ActionRow: React.FC<Props> = ({
  onNewProject, onOpenCopilot, onRecord, onOpenFile, mostRecent, onOpenRecent,
  recoverable, onRecover, onDiscardRecovery,
}) => {
  /*
    The Copilot tile names the CLI that is actually connected when
    there is one. HANDOVER §6: the credentials are the user's own and
    there is no inference cost to Kerf, ever. Saying which one is
    already signed in turns a marketing line into a fact about this
    machine.
  */
  const status = useClaudeAgentStore((s) => s.status);
  const copilotNote = status?.installed
    ? `On your own ${status.label ?? 'Claude Code'}`
    : 'On your own agent CLI';

  return (
    <>
      <div className="grid grid-cols-[1.34fr_1.34fr_.86fr_.86fr] gap-3 max-w-[860px] rise-in rise-1">

        <button
          data-home="new-project"
          onClick={onNewProject}
          className={`${TILE} hp-tile-primary`}
        >
          <span className={`${MARK} hp-tile-mark relative z-[1]`}>
            <Plus className="w-[22px] h-[22px]" weight="bold" />
          </span>
          <span className="text-ui-lg font-semibold relative z-[1]">New project</span>
        </button>

        <button
          onClick={onRecord}
          className={`${TILE} hp-tile-primary-deep`}
        >
          <span className={`${MARK} hp-tile-mark relative z-[1]`}>
            <Video className="w-[22px] h-[22px]" weight="duotone" />
          </span>
          <span className="text-ui-lg font-semibold relative z-[1]">Record screen</span>
        </button>

        <button data-home="copilot" onClick={onOpenCopilot} className={`${TILE} hp-tile-plain group`} title={copilotNote}>
          <span className={`${MARK} hp-mark-accent`}>
            <Sparkle className="w-[22px] h-[22px] text-spectrum-accent" weight="duotone" />
          </span>
          <span className="text-ui-lg font-medium text-spectrum-text">
            Copilot
          </span>
        </button>

        <button onClick={onOpenFile} className={`${TILE} hp-tile-plain group`}>
          <span className={`${MARK} hp-mark-accent`}>
            <FolderOpen className="w-[22px] h-[22px] text-spectrum-accent" weight="duotone" />
          </span>
          <span className="text-ui-lg font-medium text-spectrum-text">
            Open a project
          </span>
        </button>
      </div>

      {/* ── The one you were last in ── */}
      <div className="mt-7 rise-in rise-2">
        <h2 className="text-display font-semibold text-spectrum-text">
          {mostRecent ? 'Pick up where you left off' : 'Your first project is a keystroke away'}
        </h2>

        {recoverable && (
          <div className="surface-card rounded-squircle-md mt-3.5 h-[38px] pl-3 pr-1.5
                          flex items-center gap-2.5 max-w-[520px]">
            <RotateCcw className="w-4 h-4 text-spectrum-amber flex-shrink-0" />
            <p className="text-ui-lg text-spectrum-textMuted truncate min-w-0 flex-1">
              Kerf closed with a project still open.
            </p>
            <button onClick={onRecover} className="pro-btn-filled h-[26px] px-2.5 text-ui-sm flex-shrink-0">
              Recover it
            </button>
            <button
              onClick={onDiscardRecovery}
              className="pro-btn w-[26px] h-[26px] flex-shrink-0"
              title="Discard it"
              aria-label="Discard the recovered session"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {mostRecent ? (
          <button
            data-home="rail"
            onClick={() => onOpenRecent(mostRecent)}
            className="group block w-[236px] mt-4 text-left"
          >
            <span className="hp-media block aspect-video rounded-squircle-lg overflow-hidden relative">
              {mostRecent.posterUrl ? (
                <img
                  src={mostRecent.posterUrl}
                  alt=""
                  className="poster-zoom absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                /* A project with no captured frame yet. Perforations
                   rather than one glyph on a void: it must read as "no
                   frame captured", which is a state, and not as a
                   broken image, which is a fault. */
                <span className="poster-empty absolute inset-0 flex items-center justify-center">
                  <Film className="w-6 h-6 text-white/[0.10]" />
                </span>
              )}

              <span className="media-pill absolute bottom-2 left-2 h-[18px] px-1.5 rounded-[5px] flex items-center">
                {formatDuration(mostRecent.durationMs)}
              </span>

              <span className="media-pill absolute top-2 left-2 h-[18px] px-2 rounded-full flex items-center
                               !font-sans !text-white/85 font-medium">
                {mostRecent.starter ? 'Starter' : 'Continue'}
              </span>
            </span>

            <span className="block text-ui-lg font-medium text-spectrum-text truncate mt-2.5">
              {mostRecent.name}
            </span>
            <span className="block text-ui-sm text-spectrum-textDim truncate mt-1">
              {mostRecent.aspectRatio} · {mostRecent.clipCount} clips · opens where you left it
            </span>
          </button>
        ) : (
          <p className="text-ui-lg text-spectrum-textDim leading-relaxed mt-3 max-w-[420px]">
            Start one above and it shows up here, with a frame rendered from the edit itself.
          </p>
        )}
      </div>
    </>
  );
};
