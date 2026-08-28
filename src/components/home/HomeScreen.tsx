/* ═══════════════════════════════════════════════════════════════════
   Home.

   Rebuilt against CapCut's launcher and its templates page, closely.
   Top to bottom: a full-height left rail carrying the mark and the two
   views; a top bar that ends in the agent and the account; a row of
   four launch tiles of which two are saturated; the project you were
   last in, with its frame; and the three walls under it.

   The templates page is the OTHER view. Its banner, its search and its
   tab bar are what Skills wears now, which is the right match: both
   are a titled page over a catalogue you browse.

   What is copied is the composition and its light, pastel visual
   hierarchy. What fills the composition is Kerf's, and the two rules
   that survive from §7 are unchanged:

     1. Real content over chrome. Every project tile is a frame
        rendered from that project.
     3. No upsell in the workspace. Ever. CapCut runs advertisements in
        the rail and in the sidebar's bottom card; neither does.

   THE TAB BAR IS GONE, and this is the third rule the screen now
   keeps: nothing on it says the same word twice.

   It read "Skills" and "Recent projects", and it sat directly above a
   heading that read "Skills" and a heading that read "Projects". Two
   of the three labels for each wall, on one screen, one scroll apart —
   and the tabs were not even a switch, they were two buttons that
   scrolled you to the thing you were already looking at. Every wall
   has exactly one name now, at the top of itself, and the page scrolls
   the way a page scrolls.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { HomeTopBar } from './HomeTopBar';
import { PromoCarousel } from './PromoCarousel';
import { SettingsView } from './SettingsView';
import { AccountView } from './AccountView';
import { HomeSidebar, HomeView } from './HomeSidebar';
import { ActionRow } from './ActionRow';
import { MoreTools } from './MoreTools';
import { NewProjectSheet } from './NewProjectSheet';
import { ProjectsSection } from './ProjectsSection';
import { SkillsView } from './SkillsView';
import { HomeSkillsShelf } from './HomeSkillsShelf';
import { useHomeActions } from './homeActions';
import { AgentPicker } from '../copilot/AgentPicker';
import { ShortcutsOverlay } from '../ui/ShortcutsOverlay';
import { useRecentsStore } from '../../store/recentsStore';
import { useClaudeAgentStore } from '../../store/claudeAgentStore';
import { useAccountStore } from '../../store/accountStore';
import { hasAutosave, clearAutosave } from '../../engine/projectIO';
import { posterFromSnapshot } from '../../engine/posterCapture';

interface Props {
  onEnterEditor: () => void;
}

export const HomeScreen: React.FC<Props> = ({ onEnterEditor }) => {
  const [view, setView] = React.useState<HomeView>('home');
  const [recoverable, setRecoverable] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  /*
    "New project" means two things now, so it opens a chooser rather
    than doing one of them. The tile keeps its `data-home` attribute: it
    is still the same slot, and `verify_home` still starts from it, then
    clicks through to `new-blank` or `new-record`.
  */
  const [newSheetOpen, setNewSheetOpen] = React.useState(false);

  const recents = useRecentsStore((s) => s.recents);
  const forget = useRecentsStore((s) => s.forget);
  const refreshStatus = useClaudeAgentStore((s) => s.refreshStatus);
  const initAccount = useAccountStore((s) => s.init);
  const actions = useHomeActions(onEnterEditor);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    void refreshStatus();
    /*
      Reads the 0600 session file, then the catalogue. Until it answers,
      the account is `unknown` rather than signed out: see §3 on the
      third value, which this codebase got wrong three times running.
    */
    void initAccount();
    /*
      True only after a session that never got a clean exit.

      Autosave now runs while the editor is open and is cleared the
      moment you come back to home, because coming back to home is what
      writes the project onto the recents wall — the work is saved, and
      an "Unsaved work" card describing it was the screen's loudest
      lie. What survives that clearing is a crash or a kill, which is
      the only case worth interrupting anybody about.
    */
    setRecoverable(hasAutosave());
  }, [refreshStatus, initAccount]);

  /*
    Backfill the frames. A tile without a poster falls back to an icon
    on a gradient, which is the file-dialog-with-extra-steps this screen
    exists to avoid, so any entry carrying a snapshot gets its frame
    rendered offscreen from that snapshot.

    Sequentially, and one at a time: each render primes the media cache
    and waits for decode, and four of them at once would thrash the
    decoder and produce four dark frames instead of one good one.

    The bundled starter has no snapshot. It is rebuilt from code, not
    reloaded, so it keeps the placeholder until it has been opened once,
    at which point leaving the editor captures a real frame.
  */
  React.useEffect(() => {
    let cancelled = false;

    /*
      Deferred, and idle if the browser will say so.

      Each capture is a full-resolution composite of every clip in the
      project, 87 of them for the bundled starter, drawn synchronously
      on the main thread. Starting that during mount competes with the
      renderer registering its IPC handlers, which is what the MCP
      bridge and every automated check talk to. A thumbnail is never
      worth delaying the app being answerable.
    */
    const idle = (fn: () => void) =>
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback(fn, { timeout: 3000 })
        : window.setTimeout(fn, 1200);

    idle(() => { if (!cancelled) void run(); });

    async function run() {
      const pending = useRecentsStore.getState().recents.filter((r) => !r.posterUrl && r.snapshot);
      for (const entry of pending) {
        if (cancelled) return;
        const { dataUrl } = await posterFromSnapshot(entry.snapshot!);
        if (cancelled) return;
        if (dataUrl) useRecentsStore.getState().setPoster(entry.id, dataUrl);
        await new Promise((r) => setTimeout(r, 60));
      }
    }

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="home-stage w-full h-full flex overflow-hidden">
      <HomeSidebar view={view} onView={setView} />

      <div className="flex-1 min-w-0 flex flex-col">
        <HomeTopBar
          onOpenAgentPicker={() => setPickerOpen(true)}
          onOpenAccount={() => setView('account')}
        />

        {/*
          Capped rather than fluid. Eight tool tiles spread across a 27"
          display land a hand's width apart and the row stops reading as
          a group: the Gestalt breaks long before the pixels run out.
        */}
        <main className="hp-main flex-1 min-w-0 overflow-y-auto relative px-7 pb-14">
          <div className="max-w-[1360px] mx-auto">
            {/*
              Announcements, above everything and on every view: a
              version to install and a feature just arrived. It renders
              nothing when there is neither, so the ordinary home screen
              is unchanged.
            */}
            <div className="mb-5 empty:hidden">
              <PromoCarousel />
            </div>

            {view === 'home' ? (
              <>
                <ActionRow
                  onNewProject={() => setNewSheetOpen(true)}
                  onOpenCopilot={actions.openCopilot}
                  onRecord={actions.startRecording}
                  onOpenFile={() => fileInputRef.current?.click()}
                  mostRecent={recents[0]}
                  onOpenRecent={actions.openRecent}
                  recoverable={recoverable}
                  onRecover={actions.recover}
                  onDiscardRecovery={() => { clearAutosave(); setRecoverable(false); }}
                />

                <div className="flex flex-col gap-9 rise-in rise-4">
                  <HomeSkillsShelf onOpenSkills={() => setView('skills')} />
                  <ProjectsSection
                    recents={recents}
                    onOpen={actions.openRecent}
                    onForget={forget}
                    featuredId={recents[0]?.id}
                  />
                  <MoreTools onOpenPanel={actions.openPanel} />
                </div>
              </>
            ) : view === 'skills' ? (
              <SkillsView />
            ) : view === 'settings' ? (
              <SettingsView onOpenAgentPicker={() => setPickerOpen(true)} />
            ) : (
              <AccountView onOpenSkills={() => setView('skills')} />
            )}
          </div>
        </main>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.kerf.json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset first, so choosing the same file twice fires again.
          e.target.value = '';
          if (file) void actions.openFile(file);
        }}
      />

      {newSheetOpen && (
        <NewProjectSheet
          onClose={() => setNewSheetOpen(false)}
          onBlank={() => { setNewSheetOpen(false); actions.newProject(); }}
          onRecord={() => { setNewSheetOpen(false); actions.startRecording(); }}
        />
      )}

      {pickerOpen && (
        <AgentPicker
          onClose={() => setPickerOpen(false)}
          onSelected={() => { void refreshStatus(); setPickerOpen(false); }}
        />
      )}

      <ShortcutsOverlay />
    </div>
  );
};
