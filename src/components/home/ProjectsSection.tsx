/* ═══════════════════════════════════════════════════════════════════
   The projects wall.

   CapCut's header controls are search, a view-mode select and a cloud
   "Project sync" button. Kerf has no cloud, so it has the first two —
   both of which do the thing they say — and not the third.

   Every tile carries a frame rendered from that project on the way out
   of the editor. That is the reason this screen exists rather than a
   file dialog, and it is the one thing not to trade away for density.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { RecentProject } from '../../store/recentsStore';
import { formatDuration } from '../../utils/time';
import { Search, Film, Clapperboard, X } from '../ui/icons';

interface Props {
  recents: RecentProject[];
  onOpen: (entry: RecentProject) => void;
  onForget: (id: string) => void;
  /**
   * The entry already featured in the rail above.
   *
   * Shown once, not twice. The rail IS the most recent project, so
   * repeating it as the first tile below made a wall of one project
   * look like a wall of two and put the same name on screen twice.
   * A search still reaches it — filtering is a different intent from
   * browsing, and hiding a result somebody typed the name of would be
   * the wrong kind of clever.
   */
  featuredId?: string;
}

type ViewMode = 'grid' | 'list';

export const ProjectsSection: React.FC<Props> = ({ recents, onOpen, onForget, featuredId }) => {
  const [query, setQuery] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [mode, setMode] = React.useState<ViewMode>('grid');
  const inputRef = React.useRef<HTMLInputElement>(null);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) return recents.filter((r) => r.name.toLowerCase().includes(q));
    /*
      Only worth hiding when there is something left. With a single
      project, dropping it because the rail already shows it leaves an
      empty section under a heading — which reads as "you have no
      projects" directly beneath a tile of the project you have.
    */
    if (featuredId && recents.length > 1) return recents.filter((r) => r.id !== featuredId);
    return recents;
  }, [recents, query, featuredId]);

  const meta = (entry: RecentProject) =>
    `${formatDuration(entry.durationMs)} · ${entry.aspectRatio} · ${entry.clipCount} clips`;

  return (
    <section className="rise-in rise-4">
      <div className="flex items-center gap-3">
        <h2 className="section-head">Projects</h2>
        {filtered.length > 1 && (
          <span className="section-note tabular">
            {filtered.length}
          </span>
        )}
        <span className="flex-1" />

        {searching || query ? (
          <div className="pro-input h-[30px] flex items-center gap-1.5 px-2.5 w-[220px]">
            <Search className="w-3.5 h-3.5 text-spectrum-textDim flex-shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => { if (!query) setSearching(false); }}
              onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); setSearching(false); } }}
              placeholder="Search projects…"
              className="flex-1 bg-transparent outline-none text-ui-sm text-spectrum-text
                         placeholder:text-spectrum-textFaint min-w-0"
            />
            {query && (
              <button onClick={() => setQuery('')} className="pro-btn w-4 h-4 flex-shrink-0" title="Clear" aria-label="Clear the search">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={() => { setSearching(true); requestAnimationFrame(() => inputRef.current?.focus()); }}
            className="pro-btn-filled w-[30px] h-[30px]"
            title="Search projects"
            aria-label="Search projects"
          >
            <Search className="w-3.5 h-3.5" />
          </button>
        )}

        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as ViewMode)}
          className="pro-input h-[30px] text-ui-sm pl-2.5 pr-6"
          title="How to lay the projects out"
        >
          <option value="grid">Grid</option>
          <option value="list">List</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="py-24 flex flex-col items-center text-center">
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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-4 mt-6">
          {filtered.map((entry) => (
            <div key={entry.id} data-home="project-tile" className="group relative">
              <button
                onClick={() => onOpen(entry)}
                className="surface-card surface-card-hover w-full text-left rounded-squircle-lg overflow-hidden"
              >
                <span className="block aspect-video bg-spectrum-sunken overflow-hidden relative">
                  {entry.posterUrl ? (
                    <img src={entry.posterUrl} alt="" className="poster-zoom w-full h-full object-cover" />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center"
                          style={{ background: 'linear-gradient(158deg,#1a212c 0%,#0d1116 100%)' }}>
                      <Film className="w-5 h-5 text-white/12" />
                    </span>
                  )}
                  {/* Grounds the poster against the card body below it;
                      a hard cut between image and chrome is what makes a
                      thumbnail look pasted on. */}
                  <span className="absolute inset-x-0 bottom-0 h-10 pointer-events-none"
                        style={{ background: 'linear-gradient(to top,rgba(6,8,12,0.55),transparent)' }} />
                  <span className="media-pill absolute bottom-2 right-2 h-[17px] px-1.5 rounded-[5px] flex items-center">
                    {formatDuration(entry.durationMs)}
                  </span>
                </span>
                <span className="block px-3.5 py-3">
                  <span className="block text-ui-lg font-medium text-spectrum-text truncate tracking-[-0.006em]">
                    {entry.name}
                  </span>
                  <span className="block text-micro font-mono text-spectrum-textFaint tabular mt-1 truncate">
                    {entry.aspectRatio} · {entry.clipCount} clips
                  </span>
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
          {filtered.map((entry) => (
            <div key={entry.id} data-home="project-tile"
                 className="group flex items-center gap-3 py-2 px-2.5 rounded-squircle-md
                            hover:bg-white/[0.04] transition-colors duration-fast">
              <button onClick={() => onOpen(entry)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                <span className="w-[64px] h-[36px] rounded-[5px] bg-spectrum-sunken overflow-hidden flex-shrink-0
                                 flex items-center justify-center border border-line">
                  {entry.posterUrl
                    ? <img src={entry.posterUrl} alt="" className="poster-zoom w-full h-full object-cover" />
                    : <Film className="w-3.5 h-3.5 text-spectrum-textFaint" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-ui-lg font-medium text-spectrum-text truncate">{entry.name}</span>
                  <span className="block text-micro font-mono text-spectrum-textFaint tabular">{meta(entry)}</span>
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
