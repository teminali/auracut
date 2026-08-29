/* ═══════════════════════════════════════════════════════════════════
   Home's left rail.

   A narrow column of square icon-over-label tiles, which is what the
   approved launcher has and what the editor's activity rail already
   was — so the two rails are now the same object in two places rather
   than a wide text list on one screen and a tile column on the other.
   They share `.rail-tile`.

   THE RAIL IS NAVIGATION AND SYSTEM STATE. NOTHING ELSE. It used to be
   navigation plus a second copy of the launcher — a filled "New
   project" 200px from the "New project" tile, an "Open project…" that
   was the fourth tile of the same row. Five actions, each on screen
   twice. A launcher that offers the same thing twice reads as a screen
   nobody decided the shape of.

   WHAT THE REFERENCE HAS THAT THIS DOES NOT, and why. Its rail lists
   Projects, Skills, Media, Cloud, Import and Settings. `Cloud` is not
   here because Kerf has no cloud — HANDOVER §7 records that decision,
   and a rail item leading nowhere is exactly the disconnected control
   this migration exists to remove. `Media` and `Import` are not here
   because neither is a home DESTINATION: importing is one of the four
   tiles on the canvas, and media belongs to a project. `Projects` IS
   here — it is the same wall the home view carries, given the whole
   width, which is what you want when you are looking for something
   rather than starting something.

   The mark moved to the top bar with the breadcrumb, which is what
   lets this column be 76px instead of 224px.

   The rail still owns the window's top-left corner on macOS, so the
   first 48px stay empty and draggable for the traffic lights.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { HomeIcon, Blocks, Clapperboard, Settings, FolderOpen, Film } from '../ui/icons';
import { VersionFooter } from './VersionFooter';
import { UpdateBanner } from './UpdateBanner';

export type HomeView = 'home' | 'projects' | 'skills' | 'settings' | 'account';

interface Props {
  view: HomeView;
  onView: (view: HomeView) => void;
  onImport: () => void;
  onOpenMedia: () => void;
}

export const HomeSidebar: React.FC<Props> = ({ view, onView, onImport, onOpenMedia }) => (
  <aside className="hp-rail relative z-20 flex flex-col items-center min-h-0 rise-in rise-1">
    <nav className="flex flex-col items-center gap-1">
      <NavTile view={view} onView={onView} to="home" icon={HomeIcon} label="Home" />
      <NavTile view={view} onView={onView} to="projects" icon={Clapperboard} label="Projects" />
      <NavTile view={view} onView={onView} to="skills" icon={Blocks} label="Skills" />
      <ActionTile onClick={onOpenMedia} icon={Film} label="Media" />
    </nav>

    <div className="flex-1" />

    <nav className="flex flex-col items-center gap-1">
      <ActionTile onClick={onImport} icon={FolderOpen} label="Import" />
      <NavTile view={view} onView={onView} to="settings" icon={Settings} label="Settings" />
    </nav>

    {/* ── The foot of the rail ──

        An update, when there is one, and the version row underneath it
        where checking and rolling back live. Both render nothing to
        say when nothing has happened — which is why a 76px column can
        carry them: on an ordinary launch there is nothing here at all. */}
    <div className="w-full px-1.5 pb-2.5 pt-3 space-y-2 relative z-30 flex flex-col items-center">
      <UpdateBanner kind="app" />
      <UpdateBanner kind="skill" onOpenSkills={() => onView('skills')} />
      <VersionFooter />
    </div>
  </aside>
);

/* One tile, four times, on the same primitive the editor's rail uses. */
const NavTile: React.FC<{
  view: HomeView;
  onView: (v: HomeView) => void;
  to: HomeView;
  icon: React.ElementType;
  label: string;
}> = ({ view, onView, to, icon: Icon, label }) => {
  const on = view === to;
  return (
    <button
      data-home={`nav-${to}`}
      onClick={() => onView(to)}
      aria-current={on ? 'page' : undefined}
      className={`rail-tile ${on ? 'rail-tile-active' : ''}`}
      title={label}
    >
      <Icon className="w-[18px] h-[18px]" weight={on ? 'fill' : 'regular'} />
      <span className={`text-micro leading-none tracking-tight ${on ? 'font-semibold' : 'font-medium'}`}>
        {label}
      </span>
    </button>
  );
};

const ActionTile: React.FC<{
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}> = ({ onClick, icon: Icon, label }) => (
  <button onClick={onClick} className="rail-tile" title={label} aria-label={label}>
    <Icon className="w-[18px] h-[18px]" weight="regular" />
    <span className="text-micro leading-none tracking-tight font-medium">{label}</span>
  </button>
);
