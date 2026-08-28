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
   exist: a new project, the Copilot, the recorder, and a file.

   The block under it is CapCut's "Create your first video in minutes"
   with its thumbnail. Ours holds the most recent project, poster and
   all. §7 rule 1, real content over chrome, is why the recents list
   carries a rendered frame at all, and this is where that frame earns
   its cost. The type sits UNDER the frame on the page, not inside a
   card, which is how the reference draws every media card it has.

   `data-home` attributes are stable test hooks. `verify_home` used to
   find things by their visible text, which went red the day a string
   changed; a restyle must not be able to break a behaviour check.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { RecentProject } from '../../store/recentsStore';
import { useClaudeAgentStore } from '../../store/claudeAgentStore';
import { formatDuration } from '../../utils/time';
import { Plus, Sparkle, Film, Record, FolderOpen } from '../ui/icons';

interface Props {
  onNewProject: () => void;
  onOpenCopilot: () => void;
  onRecord: () => void;
  onOpenFile: () => void;
  mostRecent?: RecentProject;
  onOpenRecent: (entry: RecentProject) => void;
}

const TILE = 'hp-tile rounded-squircle-lg h-[104px] flex flex-col items-center justify-center gap-2.5 px-3';
const MARK = 'w-10 h-10 rounded-[12px] flex items-center justify-center flex-shrink-0';

export const ActionRow: React.FC<Props> = ({
  onNewProject, onOpenCopilot, onRecord, onOpenFile, mostRecent, onOpenRecent,
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
      <div className="grid grid-cols-4 gap-3.5 max-w-[736px] rise-in rise-1">

        <button
          data-home="new-project"
          onClick={onNewProject}
          className={`${TILE} hp-tile-warm`}
        >
          <span className={`${MARK} hp-tile-mark relative z-[1]`}>
            <Plus className="w-[22px] h-[22px]" weight="bold" />
          </span>
          <span className="text-ui-lg font-semibold relative z-[1]">New project</span>
        </button>

        <button
          data-home="copilot"
          onClick={onOpenCopilot}
          className={`${TILE} hp-tile-cool`}
          title={copilotNote}
        >
          <span className={`${MARK} hp-tile-mark relative z-[1]`}>
            <Sparkle className="w-[22px] h-[22px]" weight="fill" />
          </span>
          <span className="text-ui-lg font-semibold relative z-[1]">Copilot</span>
        </button>

        <button onClick={onRecord} className={`${TILE} hp-tile-plain group`}>
          <span className={`${MARK} bg-spectrum-accent/[0.14]`}>
            <Record className="w-[22px] h-[22px] text-spectrum-accent" />
          </span>
          <span className="text-ui-lg font-medium text-spectrum-text">
            Record the screen
          </span>
        </button>

        <button onClick={onOpenFile} className={`${TILE} hp-tile-plain group`}>
          <span className={`${MARK} bg-spectrum-blue/[0.13]`}>
            <FolderOpen className="w-[22px] h-[22px] text-spectrum-blue" />
          </span>
          <span className="text-ui-lg font-medium text-spectrum-text">
            Open a project
          </span>
        </button>
      </div>

      {/* ── The one you were last in ── */}
      <div className="mt-9 rise-in rise-2">
        <h2 className="text-display font-semibold text-spectrum-text">
          {mostRecent ? 'Pick up where you left off' : 'Your first project is a keystroke away'}
        </h2>

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
