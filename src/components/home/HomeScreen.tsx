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
   hierarchy. What fills the composition is TeminaliCut's, and the two rules
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
import { NewProjectSheet } from './NewProjectSheet';
import { ProjectsSection } from './ProjectsSection';
import { SkillsView } from './SkillsView';
import { HomeSkillsRail } from './HomeSkillsRail';
import { HomeStatusBar } from './HomeStatusBar';
import { SignInDialog } from './SignInDialog';
import { useHomeActions } from './homeActions';
import { AgentPicker } from '../copilot/AgentPicker';
import { ShortcutsOverlay } from '../ui/ShortcutsOverlay';
import { useRecentsStore } from '../../store/recentsStore';
import { useClaudeAgentStore } from '../../store/claudeAgentStore';
import { useAccountStore } from '../../store/accountStore';
import { useProjectStore } from '../../store/projectStore';
import { useAgentChatStore } from '../../store/agentChatStore';
import { useLayoutStore } from '../../store/layoutStore';
import { hasAutosave, clearAutosave } from '../../engine/projectIO';
import { posterFromSnapshot } from '../../engine/posterCapture';

interface Props {
  onEnterEditor: () => void;
}

const VIEW_LABEL: Record<HomeView, string> = {
  home: 'Home',
  projects: 'Projects',
  skills: 'Skills',
  settings: 'Settings',
  account: 'Account',
};

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
  /* The right rail offers sign-in when nobody is signed in, and it
     opens the SAME dialog the top bar does rather than a second one. */
  const [signInOpen, setSignInOpen] = React.useState(false);

  const recents = useRecentsStore((s) => s.recents);
  const forget = useRecentsStore((s) => s.forget);
  const refreshStatus = useClaudeAgentStore((s) => s.refreshStatus);
  const initAccount = useAccountStore((s) => s.init);
  const actions = useHomeActions(onEnterEditor);
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  /*
    Home's own key map.

    The approved launcher prints ⌘N, ⇧R, ⌘J and ⌘O on the four tiles.
    Three of those did nothing on this screen, so the tiles would have
    been advertising bindings that were not there — the chips exist
    because the shortcuts do, not the other way round.

    Registered in the CAPTURE phase and scoped to this component, which
    only mounts on home, so none of it can reach the editor's map. ⌘J
    is deliberately left to that map: it already toggles the Copilot
    everywhere, and a second handler for one binding is how two
    behaviours end up fighting over one key.
  */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) return;

      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'n') { e.preventDefault(); setNewSheetOpen(true); return; }
      if (mod && key === 'o') { e.preventDefault(); fileInputRef.current?.click(); return; }
      if (e.shiftKey && !mod && key === 'r') { e.preventDefault(); actions.startRecording(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [actions]);

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
    <div className="home-stage w-full h-full flex flex-col overflow-hidden">
      <HomeTopBar
        onOpenAgentPicker={() => setPickerOpen(true)}
        onOpenAccount={() => setView('account')}
        onOpenCopilot={actions.openCopilot}
        viewLabel={VIEW_LABEL[view]}
      />

      <div className={`hp-workspace flex-1 min-h-0 ${view === 'home' ? 'hp-workspace-home' : ''}`}>
        <HomeSidebar
          view={view}
          onView={setView}
          onImport={() => fileInputRef.current?.click()}
          onOpenMedia={() => {
            setActiveTab('media');
            if (recents[0]) actions.openRecent(recents[0]);
            else actions.newProject();
          }}
        />

        <main className="hp-main min-w-0 overflow-y-auto relative">
          <div className="hp-main-inner">
            {/*
              Announcements, above everything and on every view: a
              version to install and a feature just arrived. It renders
              nothing when there is neither, so the ordinary home screen
              is unchanged. It spans both columns — an announcement that
              only covered the left of the page would read as belonging
              to whatever is under it.
            */}
            <div className="mb-5 empty:hidden">
              <PromoCarousel />
            </div>

            {view === 'home' ? (
              <div className="min-w-0 flex flex-col gap-5">
                <ActionRow
                  onNewProject={() => setNewSheetOpen(true)}
                  onOpenCopilot={actions.openCopilot}
                  onRecord={actions.startRecording}
                  onOpenFile={() => fileInputRef.current?.click()}
                  mostRecent={recents[0]}
                  onOpenRecent={actions.openRecent}
                  onPlayRecent={actions.playRecent}
                  recoverable={recoverable}
                  onRecover={actions.recover}
                  onDiscardRecovery={() => { clearAutosave(); setRecoverable(false); }}
                  onExport={() => useProjectStore.getState().setExportModalOpen(true)}
                />

                <div className="rise-in rise-4">
                  <ProjectsSection
                    recents={recents}
                    onOpen={actions.openRecent}
                    onForget={forget}
                    featuredId={recents[0]?.id}
                  />
                </div>
              </div>
            ) : view === 'projects' ? (
              /* The same wall, the same component, the whole width.
                 There is no second projects list to keep in step. */
              <ProjectsSection
                recents={recents}
                onOpen={actions.openRecent}
                onForget={forget}
              />
            ) : view === 'skills' ? (
              <SkillsView />
            ) : view === 'settings' ? (
              <SettingsView onOpenAgentPicker={() => setPickerOpen(true)} />
            ) : (
              <AccountView onOpenSkills={() => setView('skills')} />
            )}
          </div>
        </main>

        {view === 'home' && (
          <HomeSkillsRail
            onOpenSkills={() => setView('skills')}
            onOpenAccount={() => setView('account')}
            onSignIn={() => setSignInOpen(true)}
            onRunSkill={(name) => {
              actions.openCopilot();
              void useAgentChatStore.getState().sendPrompt(`Run the ${name} skill.`);
            }}
          />
        )}
      </div>

      <HomeStatusBar />

      <input
        ref={fileInputRef}
        type="file"
        accept=".temi,.json,.kerf.json,application/json"
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

      {signInOpen && <SignInDialog onClose={() => setSignInOpen(false)} />}

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
