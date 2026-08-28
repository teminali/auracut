/* ═══════════════════════════════════════════════════════════════════
   Home's left rail.

   The rail is NAVIGATION and system state. Nothing else.

   It used to be navigation plus a second copy of the launcher: a
   filled "New project" that sat 200px from the warm "New project"
   tile, an "Open project…" and a "Record the screen" that were the
   third and fourth tiles of the same row, an "AI tools" row that was
   the eighth panel tile, and a "Recent projects" row that was the tab
   directly above the wall it scrolled to. Five actions, each on screen
   twice. A launcher that offers the same thing twice reads as a screen
   nobody decided the shape of, and every duplicate also steals a
   little authority from the copy that was meant to be primary.

   So: where you are, and what changed while you were away. The canvas
   owns what you can DO — the four tiles at the top of it are the entry
   points, and they are the only copy of them.

   The bottom card is the update, and only the update. Recovery used to
   live there permanently and it was permanently wrong: autosave writes
   every twenty seconds, so "Unsaved work" was on screen for everyone,
   for ever, describing work that was already safely on the recents
   wall. It is now offered where it belongs — in the hero, next to the
   project you were last in — and only after a session that never got a
   clean exit.

   The rail owns the first 48px of the window: on macOS that is where
   the traffic lights are, so nothing may be drawn there and it must be
   draggable.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { KerfMark } from '../ui/KerfMark';
import { HomeIcon, Blocks, Settings, UserCircle } from '../ui/icons';
import { VersionFooter } from './VersionFooter';
import { UpdateBanner } from './UpdateBanner';

export type HomeView = 'home' | 'skills' | 'settings' | 'account';

interface Props {
  view: HomeView;
  onView: (view: HomeView) => void;
}

/* One row shape for both nav items, so they cannot drift apart. */
const ROW = 'hp-nav h-[36px] px-3 rounded-squircle-md flex items-center gap-3 text-ui-lg w-full text-left';

export const HomeSidebar: React.FC<Props> = ({ view, onView }) => (
  <aside className="hp-rail w-[224px] flex-shrink-0 flex flex-col min-h-0 rise-in rise-1">

    {/* The traffic-light strip. Empty on purpose, and draggable. */}
    <div className="titlebar-drag h-12 flex-shrink-0" />

    {/* ── The mark ── */}
    <div className="px-4">
      <div className="flex items-center gap-2.5">
        <span className="hp-brand-mark w-7 h-7 rounded-[8px] flex items-center justify-center flex-shrink-0">
          <KerfMark className="w-4 h-4" />
        </span>
        <span className="text-[17px] font-semibold text-spectrum-text tracking-[-0.022em]">Kerf</span>
      </div>
    </div>

    {/* ── Views ──

        The Skills row carried a count of the owned skills, which was a
        third number for skills on a screen that already shows the
        shelf's own count beside its heading — and the two counted
        different things, which is worse than counting nothing.

        Settings and Account are down here, separated by space rather
        than by a rule: they are where you go once, not where you work.
        Neither existed as a place before — settings were scattered
        across four modals and the account was an avatar and a
        sign-out glyph in the top bar with nowhere to read what you
        actually own. */}
    <nav className="px-2.5 mt-5 flex flex-col gap-0.5">
      <NavRow view={view} onView={onView} to="home" icon={HomeIcon} label="Home" />
      <NavRow view={view} onView={onView} to="skills" icon={Blocks} label="Skills" />
    </nav>

    <div className="flex-1" />

    <nav className="px-2.5 pb-3 flex flex-col gap-0.5">
      <NavRow view={view} onView={onView} to="account" icon={UserCircle} label="Account" />
      <NavRow view={view} onView={onView} to="settings" icon={Settings} label="Settings" />
    </nav>

    {/* ── The bottom of the rail ──

        An update, when there is one, and the version row underneath it
        where checking and rolling back live. Both render nothing to say
        when nothing has happened. */}
    <div className="px-4 pb-4 space-y-3">
      <UpdateBanner kind="app" />
      <UpdateBanner kind="skill" onOpenSkills={() => onView('skills')} />
      <VersionFooter />
    </div>
  </aside>
);

/* One row, four times. The set has grown from two to four, which is
   exactly the point at which four copies of the same markup start to
   drift apart in the details nobody checks. */
const NavRow: React.FC<{
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
      className={`${ROW} ${on ? 'hp-nav-on' : ''}`}
    >
      <Icon className="w-[18px] h-[18px] flex-shrink-0" weight={on ? 'fill' : 'regular'} />
      {label}
    </button>
  );
};
