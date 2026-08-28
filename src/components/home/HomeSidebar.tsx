/* ═══════════════════════════════════════════════════════════════════
   Home's left rail, laid out after CapCut's.

   Top to bottom it is the reference exactly: the mark, ONE filled
   primary button, an unlabelled nav group, a labelled second group,
   and a card pinned to the bottom.

   What sits in those slots is Kerf's, and only things that exist.
   CapCut's second group is "Spaces" and holds a cloud workspace; there
   is no cloud here, so ours is "Library" and holds the two other ways
   a project starts on this machine. CapCut's bottom card advertises a
   feature; §7 rule 3 says never, so ours is the unsaved work that is
   genuinely waiting for you, and otherwise it says how saving works.

   The rail is its own plane now rather than a transparent strip of the
   stage, because the reference reads as two columns and a column that
   shares its background with the page is not one. It also owns the
   first 48px of the window: on macOS that is where the traffic lights
   are, so nothing may be drawn there and it must be draggable.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { KerfMark } from '../ui/KerfMark';
import { useAccountStore } from '../../store/accountStore';
import { Scissors, Blocks, FolderOpen, Record, RotateCcw, X, Plus } from '../ui/icons';
import { VersionFooter } from './VersionFooter';
import { UpdateBanner } from './UpdateBanner';

export type HomeView = 'home' | 'skills';

interface Props {
  view: HomeView;
  onView: (view: HomeView) => void;
  onNewProject: () => void;
  onOpenFile: () => void;
  onRecord: () => void;
  recoverable: boolean;
  onRecover: () => void;
  onDiscardRecovery: () => void;
}

const NAV: { id: HomeView; label: string; icon: React.ElementType }[] = [
  { id: 'home', label: 'Home', icon: Scissors },
  { id: 'skills', label: 'Skills', icon: Blocks },
];

/* One row shape for both groups, so a nav item and an action item in
   the rail cannot drift apart. The reference draws them identically
   and so does this. */
const ROW = 'hp-nav h-[36px] px-3 rounded-squircle-md flex items-center gap-3 text-ui-lg w-full text-left';

export const HomeSidebar: React.FC<Props> = ({
  view, onView, onNewProject, onOpenFile, onRecord,
  recoverable, onRecover, onDiscardRecovery,
}) => {
  const owned = useAccountStore((s) => s.owned);

  return (
    <aside className="hp-rail w-[248px] flex-shrink-0 flex flex-col min-h-0 rise-in rise-1">

      {/* The traffic-light strip. Empty on purpose, and draggable. */}
      <div className="titlebar-drag h-12 flex-shrink-0" />

      {/* ── The mark ── */}
      <div className="px-4">
        <div className="flex items-center gap-2.5">
          <span
            className="w-7 h-7 rounded-[9px] flex items-center justify-center flex-shrink-0
                       shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_2px_8px_-2px_rgba(196,96,63,0.5)]"
            style={{ background: 'linear-gradient(148deg,#efa78e,#c4603f)' }}
          >
            <KerfMark className="w-4 h-4" />
          </span>
          <span className="text-[17px] font-semibold text-spectrum-text tracking-[-0.022em]">Kerf</span>
        </div>

        {/* The rail's one saturated element, in the reference's slot and
            doing the reference's job. Dark ink on it, not white. */}
        <button
          onClick={onNewProject}
          className="hp-create w-full h-[38px] mt-4 rounded-squircle-md
                     flex items-center justify-center gap-2 text-ui-lg font-semibold"
        >
          <Plus className="w-4 h-4" weight="bold" />
          New project
        </button>
      </div>

      {/* ── Views ── */}
      <nav className="px-2.5 mt-6 flex flex-col gap-0.5">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              data-home={`nav-${item.id}`}
              onClick={() => onView(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`${ROW} ${active ? 'hp-nav-on' : ''}`}
            >
              <Icon
                className={`w-[18px] h-[18px] flex-shrink-0 ${active ? 'text-spectrum-accent' : ''}`}
                weight={active ? 'fill' : 'regular'}
              />
              {item.label}
              {item.id === 'skills' && owned.length > 0 && (
                <span className="ml-auto chip tabular">{owned.length}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ── The other two ways in ── */}
      <p className="hp-rail-label px-4 mt-7 mb-2">Library</p>

      <div className="px-2.5 flex flex-col gap-0.5">
        <button onClick={onOpenFile} className={ROW}>
          <FolderOpen className="w-[18px] h-[18px] flex-shrink-0" />
          Open project…
        </button>
        <button onClick={onRecord} className={ROW}>
          <Record className="w-[18px] h-[18px] flex-shrink-0" />
          Record the screen
        </button>
      </div>

      <div className="flex-1" />

      {/* ── The bottom of the rail ──

          The version and the update check live here permanently; the
          recovery card appears ABOVE them when there is something to
          recover, rather than instead of them.

          Not a compromise on "replace the recover component": what was
          replaced is what occupied this slot when there was nothing to
          recover, which was a sentence about autosave that nobody needs
          twice. Recovery itself is the only route back to unsaved work
          and there is no other way to reach it, so it keeps its place
          on the takes where it matters. */}
      <div className="px-4 pb-4 space-y-3">
        {recoverable && (
          <div className="surface-card rounded-squircle-lg p-3">
            <div className="flex items-start gap-2.5">
              <RotateCcw className="w-4 h-4 text-spectrum-amber flex-shrink-0 mt-px" />
              <div className="min-w-0 flex-1">
                <p className="text-ui-lg font-medium text-spectrum-text leading-tight">Unsaved work</p>
                <p className="text-ui-sm text-spectrum-textDim leading-snug mt-1">
                  From your last session.
                </p>
              </div>
              <button
                onClick={onDiscardRecovery}
                className="pro-btn w-5 h-5 flex-shrink-0 -mt-0.5 -mr-0.5"
                title="Discard it"
                aria-label="Discard the unsaved work"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <button onClick={onRecover} className="pro-btn-filled w-full h-[30px] mt-3 text-ui-sm">
              Recover
            </button>
          </div>
        )}

        {/* An update announces itself in the same card the unsaved-work
            notice uses, because it is the same kind of message: something
            happened while you were away, and here is the one thing to do
            about it. It renders nothing when there is no update. */}
        <UpdateBanner kind="app" />
        <UpdateBanner kind="skill" onOpenSkills={() => onView('skills')} />

        <VersionFooter />
      </div>
    </aside>
  );
};
