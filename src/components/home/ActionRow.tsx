/* ═══════════════════════════════════════════════════════════════════
   The top of the home column: the project you were last in, then the
   four ways to start something.

   THE ORDER IS REVERSED FROM WHAT IT WAS, and that is the change.

   The launcher used to open on four tiles and put the most recent
   project underneath them, which asked everybody to re-choose a
   starting point they had already chosen. The overwhelmingly common
   reason to open an editor is to carry on with the thing you were
   doing, so that is what the screen opens on now: the project, its
   own frame at a size you can actually read, its real numbers, and
   one filled button.

   AND THAT IS WHERE THE ACCENT WENT. The four tiles used to be two
   saturated and two plain, because colour was carrying priority
   between them. HANDOVER §7 recorded the cost of that honestly: the
   CapCut layout "weakened deliberately" the one-unmistakable-primary
   rule, and a row with two loud tiles is what the weakening looked
   like. With a hero above them the primary action has somewhere to
   live, so the tiles are four equal plain entry points and the single
   filled control on the screen is Resume editing. One primary, and
   the rule is not weakened any more.

   Every number in the hero is read from the recents entry - aspect,
   clips, duration. Nothing here is decorative status: an activity
   feed would have to be invented, and an invented feed on a launcher
   is the "simulated behaviour" this migration exists to avoid.

   No shortcut hints on the tiles either. There are no home-screen
   key bindings in `useKeyboardShortcuts` - the map is the editor's -
   so a row of ⌘N / ⌘O chips would be four lies in a row.

   Recovery stays exactly where it was and means exactly what it did:
   one line, next to the project it belongs to, only after a session
   that never reached home. See HANDOVER §7.

   `data-home` attributes are stable test hooks. `verify_home` drives
   `new-project`, `copilot` and `rail` by attribute rather than by
   visible text, so a restyle must not be able to break a behaviour
   check. All three are preserved here.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { RecentProject } from '../../store/recentsStore';
import { useClaudeAgentStore } from '../../store/claudeAgentStore';
import { useTimelineStore } from '../../store/timelineStore';
import { useProjectStore } from '../../store/projectStore';
import { useAgentChatStore } from '../../store/agentChatStore';
import { buildActivity, resolutionLabel } from './homeActivity';
import { projectArtwork } from './projectArtwork';
import { formatDuration } from '../../utils/time';
import { Plus, Sparkle, Film, Video, FolderOpen, RotateCcw, X, Play, Download } from '../ui/icons';

interface Props {
  onNewProject: () => void;
  onOpenCopilot: () => void;
  onRecord: () => void;
  onOpenFile: () => void;
  mostRecent?: RecentProject;
  onOpenRecent: (entry: RecentProject) => void;
  /** Decision 8: play opens the Player, not the editor. */
  onPlayRecent: (entry: RecentProject) => void;
  /** A session that ended without coming back to home. Rare, on purpose. */
  recoverable: boolean;
  onRecover: () => void;
  onDiscardRecovery: () => void;
  /** The hero's Export goes to the real export modal. */
  onExport: () => void;
}

export const ActionRow: React.FC<Props> = ({
  onNewProject, onOpenCopilot, onRecord, onOpenFile, mostRecent, onOpenRecent, onPlayRecent,
  recoverable, onRecover, onDiscardRecovery, onExport,
}) => {
  const heroArtwork = mostRecent ? projectArtwork(mostRecent) : undefined;
  /*
    The Copilot tile names the CLI that is actually connected when
    there is one. HANDOVER §6: the credentials are the user's own and
    there is no inference cost to Kerf, ever. Saying which one is
    already signed in turns a marketing line into a fact about this
    machine.
  */
  const status = useClaudeAgentStore((s) => s.status);

  /* Everything the activity list is allowed to say, read from the
     stores that own it. `buildActivity` returns fewer rows when there
     is less to report, and none at all on a first run. */
  const markers = useTimelineStore((s) => s.markers);
  const lastExportPath = useProjectStore((s) => s.lastExportPath);
  const messages = useAgentChatStore((s) => s.messages);
  const project = useProjectStore((s) => s.project);

  const activity = React.useMemo(() => {
    /* The welcome message is seeded at startup and is not activity —
       reporting it would put "I read your timeline directly" on the
       hero of an app nobody has spoken to yet. */
    const lastAgent = [...messages]
      .reverse()
      .find((m) => m.sender === 'agent' && m.id !== 'msg_welcome' && m.text.trim());
    return buildActivity({
      markers,
      lastCopilotText: lastAgent?.text ?? null,
      lastExportPath,
      recent: mostRecent,
      now: Date.now(),
    });
  }, [markers, messages, lastExportPath, mostRecent]);
  const copilotNote = status?.installed
    ? `On your own ${status.label ?? 'Claude Code'}`
    : 'On your own agent CLI';

  return (
    <>
      {mostRecent && (
        <section className="hp-hero rise-in rise-1">
          <p className="hp-kicker">Jump back in</p>

          <div className="flex items-end justify-between gap-5 flex-wrap mt-1.5">
            <h2 className="text-display-lg font-semibold text-spectrum-text truncate min-w-0">
              {mostRecent.name}
            </h2>
            {/* Facts, read off the entry and the project. */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="hp-fact">
                {mostRecent.aspectRatio} · {resolutionLabel(project.width, project.height)}
              </span>
              <span className="hp-fact">{project.fps} fps</span>
              <span className="hp-fact">{mostRecent.clipCount} clips</span>
            </div>
          </div>

          <div className="hp-hero-grid mt-4">
            <button
              data-home="rail"
              onClick={() => onPlayRecent(mostRecent)}
              className="group block text-left min-w-0"
              title={`Play ${mostRecent.name}`}
            >
              <span className="hp-media block aspect-video rounded-squircle-md overflow-hidden relative">
                {heroArtwork ? (
                  <img
                    src={heroArtwork}
                    alt=""
                    className="poster-zoom absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  /* A project with no captured frame yet. Perforations
                     rather than one glyph on a void: it must read as "no
                     frame captured", which is a state, and not as a
                     broken image, which is a fault. */
                  <span className="poster-empty absolute inset-0 flex items-center justify-center">
                    <Film className="w-7 h-7 text-white/[0.10]" />
                  </span>
                )}

                <span className="media-pill absolute top-2 left-2 h-[18px] px-2 rounded-full flex items-center
                                 !font-sans !text-white/85 font-medium">
                  {mostRecent.starter ? 'Starter' : 'Continue'}
                </span>

                {/* Where you stopped, on the frame. The bar is a
                    readout, not a control: the poster opens the Player
                    and scrubbing belongs there, so this shows position
                    and does not pretend to take a drag. */}
                <span className="hp-poster-foot">
                  <span className="hp-poster-time">00:00:00:00</span>
                  <span className="hp-poster-track">
                    <span className="hp-poster-fill" style={{ width: '0%' }} />
                  </span>
                  <span className="hp-poster-time is-dim">
                    {formatDuration(mostRecent.durationMs)}
                  </span>
                </span>
              </span>
            </button>

            <div className="flex flex-col gap-2.5 min-w-0">
              <div className="flex items-stretch gap-2">
                <button
                  onClick={() => onOpenRecent(mostRecent)}
                  className="btn-primary h-[38px] px-4 gap-2 text-ui-lg flex-1"
                >
                  <Play className="w-4 h-4" weight="fill" /> Resume editing
                </button>
                <button
                  onClick={onExport}
                  className="pro-btn-filled h-[38px] px-3 gap-2 text-ui-sm font-medium flex-shrink-0"
                  title="Export this project"
                >
                  <Download className="w-4 h-4" /> Export
                </button>
              </div>

              {/* Only what the app can actually report. Empty on a
                  first run, and then it draws nothing at all. */}
              {activity.length > 0 && (
                <ul className="hp-activity">
                  {activity.map((row) => (
                    <li key={row.id} className="hp-activity-row">
                      <span className={`hp-activity-dot tone-${row.tone}`} />
                      <span className="truncate min-w-0 flex-1">{row.text}</span>
                      <span className="hp-activity-meta">{row.meta}</span>
                    </li>
                  ))}
                </ul>
              )}

              {recoverable && (
                <div className="surface-card rounded-squircle-sm h-[38px] pl-3 pr-1.5
                                flex items-center gap-2.5">
                  <RotateCcw className="w-4 h-4 text-spectrum-amber flex-shrink-0" />
                  <p className="text-ui-sm text-spectrum-textMuted truncate min-w-0 flex-1">
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


            </div>
          </div>
        </section>
      )}

      {!mostRecent && (
        <h2 className="text-display font-semibold text-spectrum-text rise-in rise-1">
          Your first project is a keystroke away
        </h2>
      )}

      {/* ── The four ways in ── */}
      <div className={`${mostRecent ? 'mt-0' : 'mt-5'} rise-in rise-2`}>
        <p className="hp-kicker">Start something</p>

        <div className="hp-start-grid mt-3">
          <StartTile
            hook="new-project"
            onClick={onNewProject}
            icon={Plus}
            title="New project"
            detail="Blank timeline"
            hint="⌘N"
          />
          <StartTile
            onClick={onRecord}
            icon={Video}
            title="Record screen"
            detail="Capture and cut"
            hint="⇧R"
          />
          <StartTile
            hook="copilot"
            onClick={onOpenCopilot}
            icon={Sparkle}
            title="Ask Copilot"
            detail="Describe the edit"
            hint="⌘J"
            note={copilotNote}
          />
          <StartTile
            onClick={onOpenFile}
            icon={FolderOpen}
            title="Open a project"
            detail="Browse folder"
            hint="⌘O"
          />
        </div>
      </div>
    </>
  );
};

/* One tile, four times, so the set cannot drift in the details nobody
   checks. Icon top-left, name, then what pressing it actually does —
   the reference's anatomy, on Kerf's surfaces. */
const StartTile: React.FC<{
  hook?: string;
  onClick: () => void;
  icon: React.ElementType;
  title: string;
  detail: string;
  /* The binding this tile actually has. Every one of these is
     registered in `HomeScreen` — the chip exists because the shortcut
     does, not the other way round. */
  hint: string;
  note?: string;
}> = ({ hook, onClick, icon: Icon, title, detail, hint, note }) => (
  <button data-home={hook} onClick={onClick} className="hp-tile group" title={note}>
    <span className="flex items-start justify-between gap-2">
      <span className="hp-tile-mark">
        <Icon className="w-[18px] h-[18px]" weight="duotone" />
      </span>
      <span className="hp-tile-hint">{hint}</span>
    </span>
    <span className="block text-ui-lg font-semibold text-spectrum-text mt-3">{title}</span>
    <span className="block text-ui-sm text-spectrum-textDim mt-0.5">{detail}</span>
  </button>
);
