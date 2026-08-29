/* ═══════════════════════════════════════════════════════════════════
   The projects wall, drawn as CapCut draws its template wall.

   The card is the thing worth copying and it is barely a card: a
   rounded frame, two badges sitting ON the frame, and then the title
   and one line of meta UNDER it, on the page. No fill behind the type,
   no border around the pair. The frame is the content and everything
   else is a caption, which is exactly what it is.

   What is NOT copied is the shape. CapCut's wall is 9:16 because a
   template is a vertical video; Kerf projects are whatever the user
   set, mostly 16:9, and cropping a 16:9 frame into a portrait card to
   match a reference would throw away the middle of every poster to win
   a resemblance. The card is the reference's; the aspect is the
   project's.

   CapCut's header controls are search, a view-mode select and a cloud
   "Project sync" button. Kerf has no cloud, so it has the first two,
   both of which do the thing they say, and not the third.

   The select is a real `<select>` drawn as one of ours: `appearance:
   none` and our own caret, because one OS widget in a screen of drawn
   ones is more obviously foreign than eight would be. What it is NOT
   is a div pretending. A select gets keyboard, type-ahead and the
   platform popup for free, and every hand-rolled replacement in this
   repo's history lost at least one of the three.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { RecentProject } from '../../store/recentsStore';
import { formatDuration } from '../../utils/time';
import { Search, Film, Clapperboard, X } from '../ui/icons';
import { Select } from '../ui/Primitives';
import { projectArtwork } from './projectArtwork';

interface Props {
  recents: RecentProject[];
  onOpen: (entry: RecentProject) => void;
  onForget: (id: string) => void;
  /**
   * The entry already featured above the tab bar.
   *
   * Shown once, not twice. The "pick up where you left off" block IS
   * the most recent project, so repeating it as the first tile here
   * made a wall of one project look like a wall of two and put the
   * same name on screen twice. A search still reaches it: filtering is
   * a different intent from browsing, and hiding a result somebody
   * typed the name of would be the wrong kind of clever.
   */
  featuredId?: string;
}

type ViewMode = 'grid' | 'list';

/* Every one of these orders by a field the entry actually has. */
type SortKey = 'recent' | 'name' | 'longest';

export const ProjectsSection: React.FC<Props> = ({ recents, onOpen, onForget, featuredId }) => {
  const [query, setQuery] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [mode, setMode] = React.useState<ViewMode>('grid');
  const [sort, setSort] = React.useState<SortKey>('recent');
  const inputRef = React.useRef<HTMLInputElement>(null);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) return recents.filter((r) => r.name.toLowerCase().includes(q));
    /*
      Only worth hiding when there is something left. With a single
      project, dropping it because the block above already shows it
      leaves an empty section under a heading, which reads as "you have
      no projects" directly beneath a tile of the project you have.
    */
    if (featuredId && recents.length > 1) return recents.filter((r) => r.id !== featuredId);
    return recents;
  }, [recents, query, featuredId]);

  const shown = React.useMemo(() => {
    const list = [...filtered];
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'longest') list.sort((a, b) => b.durationMs - a.durationMs);
    else list.sort((a, b) => b.openedAt - a.openedAt);
    return list;
  }, [filtered, sort]);

  const meta = (entry: RecentProject) =>
    `${formatDuration(entry.durationMs)} · ${entry.aspectRatio} · ${entry.clipCount} clips`;

  return (
    <section id="hp-projects" className="scroll-mt-4">
      {/* The category row: a small label on the left and the controls
          on the right, sharing one line. The reference's is "Business"
          with "View more" opposite it; ours is the wall's name with
          the two controls that are real. */}
      <div className="hp-projects-head flex items-center gap-2.5 h-[25px]">
        <h2 className="hp-kicker">Projects</h2>
        <span className="text-ui-sm text-spectrum-textDim tabular">{filtered.length} total</span>
        <span className="flex-1" />

        {/*
          The search is ON SCREEN, not behind a magnifier.

          It used to be an icon that swapped itself for a field. That
          is a control whose only job is to reveal another control, on
          a wall whose whole point is finding something — and it cost a
          click every single time. The approved launcher shows the
          field, and so does this.
        */}
        <div className="pro-input h-[24px] flex items-center gap-1.5 px-2.5 w-[180px]">
          <Search className="w-3.5 h-3.5 text-spectrum-textDim flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); } }}
            placeholder="Search projects…"
            aria-label="Search projects"
            className="flex-1 bg-transparent outline-none text-ui-sm text-spectrum-text
                       placeholder:text-spectrum-textFaint min-w-0"
          />
          {query && (
            <button onClick={() => setQuery('')} className="pro-btn w-4 h-4 flex-shrink-0"
                    title="Clear" aria-label="Clear the search">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Two layouts, and they are a choice between two things, which
            is what a segmented control is for. It was a two-option
            <select>: a popup to pick between Grid and List. */}
        <div className="seg-group">
          <button
            onClick={() => setMode('grid')}
            className={`seg-item ${mode === 'grid' ? 'seg-item-active' : ''}`}
            title="Lay the projects out as a grid"
            aria-pressed={mode === 'grid'}
          >
            Grid
          </button>
          <button
            onClick={() => setMode('list')}
            className={`seg-item ${mode === 'list' ? 'seg-item-active' : ''}`}
            title="Lay the projects out as a list"
            aria-pressed={mode === 'list'}
          >
            List
          </button>
        </div>

        {/* A real `<select>`, drawn as one of ours. It gets keyboard,
            type-ahead and the platform popup for free, and every
            hand-rolled replacement in this repo's history lost at least
            one of the three. */}
        <Select
          value={sort}
          onChange={setSort}
          size="md"
          title="How to order the projects"
          options={[
            { value: 'recent', label: 'Last edited' },
            { value: 'name', label: 'Name' },
            { value: 'longest', label: 'Longest' },
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="py-14 flex flex-col items-center text-center">
          <span className="w-14 h-14 rounded-squircle-lg surface-card flex items-center justify-center">
            <Clapperboard className="w-6 h-6 text-spectrum-textFaint" />
          </span>
          <p className="text-ui-lg text-spectrum-textDim mt-4 max-w-[400px] leading-relaxed">
            {query
              ? `Nothing here matches “${query.trim()}”.`
              : featuredId
                ? 'Your other projects appear here as you make them, each with a frame from the edit.'
                : 'Projects are saved as you work and show up here with a frame from the edit. Start one above.'}
          </p>
        </div>
      ) : mode === 'grid' ? (
        <div className="hp-project-grid grid mt-4">
          {shown.map((entry) => (
            <div key={entry.id} data-home="project-tile" className="hp-project-card group relative">
              <button onClick={() => onOpen(entry)} className="block w-full text-left">
                <span className="hp-media hp-project-frame block aspect-video overflow-hidden relative">
                  {projectArtwork(entry) ? (
                    <img src={projectArtwork(entry)} alt="" className="poster-zoom w-full h-full object-cover" />
                  ) : (
                    <span className="poster-empty w-full h-full flex items-center justify-center">
                      <Film className="w-5 h-5 text-white/[0.10]" />
                    </span>
                  )}

                  {/* Grounds the badges against a bright frame. */}
                  <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-12 pointer-events-none"
                        style={{ background: 'linear-gradient(to top,rgba(6,8,12,0.6),transparent)' }} />

                  <span className="media-pill absolute bottom-2 left-2 h-[18px] px-1.5 rounded-squircle-xs flex items-center">
                    {formatDuration(entry.durationMs)}
                  </span>
                  <span className="media-pill absolute bottom-2 right-2 h-[18px] px-1.5 rounded-squircle-xs flex items-center gap-1">
                    <Film className="w-2.5 h-2.5" />
                    {entry.clipCount}
                  </span>
                </span>

                <span data-home="project-name" className="hp-project-name block text-ui-lg font-medium text-spectrum-text truncate
                                 tracking-[-0.006em]">
                  {entry.name}
                </span>
                <span className="hp-project-meta block text-ui-sm text-spectrum-textDim truncate mt-0.5">
                  {entry.starter ? 'Starter project' : 'Recent'} · {entry.aspectRatio}
                </span>
              </button>

              {!entry.starter && (
                <button
                  onClick={() => onForget(entry.id)}
                  className="media-pill absolute top-2 right-2 w-6 h-6 rounded-full
                             text-white/70 hover:text-white flex items-center justify-center
                             opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                  title="Remove from this list"
                  aria-label={`Remove ${entry.name} from this list`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 flex flex-col">
          {shown.map((entry) => (
            <div key={entry.id} data-home="project-tile"
                 /* The padding bleeds OUTWARD, so a row starts on the
                    same vertical as the heading above it and as every
                    grid tile in the other view. */
                 className="group flex items-center gap-3.5 py-2.5 -mx-3 px-3 rounded-squircle-md
                            hover:bg-white/[0.035] transition-colors duration-fast">
              <button onClick={() => onOpen(entry)} className="flex items-center gap-3.5 flex-1 min-w-0 text-left">
                <span className="hp-media w-[68px] h-[38px] rounded-squircle-xs overflow-hidden flex-shrink-0
                                 flex items-center justify-center">
                  {projectArtwork(entry)
                    ? <img src={projectArtwork(entry)} alt="" className="poster-zoom w-full h-full object-cover" />
                    : <span className="poster-empty w-full h-full flex items-center justify-center">
                        <Film className="w-3.5 h-3.5 text-white/[0.10]" />
                      </span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-ui-lg font-medium text-spectrum-text truncate">{entry.name}</span>
                  <span className="block text-ui-sm text-spectrum-textDim truncate mt-0.5">{meta(entry)}</span>
                </span>
              </button>
              {!entry.starter && (
                <button
                  onClick={() => onForget(entry.id)}
                  className="pro-btn w-6 h-6 flex-shrink-0 opacity-0 group-hover:opacity-100
                             focus-visible:opacity-100 transition-opacity"
                  title="Remove from this list"
                  aria-label={`Remove ${entry.name} from this list`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
