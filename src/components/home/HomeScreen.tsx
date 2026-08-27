/* ═══════════════════════════════════════════════════════════════════
   Home.

   Laid out after CapCut's: a left rail with an identity card and a
   labelled nav group, a top band that doubles as the titlebar, a big
   primary tile with a secondary card beneath it and a tall rail down
   the right, a row of tool tiles, and the projects wall under that.

   What sits in those slots is Kerf's, and only what exists. There is
   no account, no Pro tier, no cloud workspace and no project sync, so
   those slots hold the agent connection, the Copilot, the most recent
   project and the eight editor panels instead. Two of CapCut's rules
   are kept for the same reason they were written down in HANDOVER §7:

     1. Real content over chrome. Every project tile is a frame
        rendered from that project.
     3. No upsell in the workspace. Ever. CapCut runs advertisements
        in the rail and in the sidebar's bottom card; neither does.

   This REPLACED an intent-led home built around a prompt box — "what
   do you want to make?" — which started a Copilot turn straight from
   this screen. That entry point is gone; describing an edit now
   happens in the editor's Copilot drawer, which the second card here
   opens directly.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { HomeTopBar } from './HomeTopBar';
import { HomeSidebar, HomeView } from './HomeSidebar';
import { HeroRow } from './HeroRow';
import { MoreTools } from './MoreTools';
import { ProjectsSection } from './ProjectsSection';
import { SkillsView } from './SkillsView';
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
      the account is `unknown` rather than signed out — see §3 on the
      third value, which this codebase got wrong three times running.
    */
    void initAccount();
    /*
      Autosave has been writing to localStorage every 20 seconds since
      the app was built, and NOTHING ever read it back — `hasAutosave`
      and `restoreAutosave` were called from nowhere. A user whose app
      crashed had their work sitting right there and was never offered
      it. The sidebar's bottom card is the offer.
    */
    setRecoverable(hasAutosave());
  }, [refreshStatus, initAccount]);

  /*
    Backfill the frames. A tile without a poster falls back to an icon
    on a gradient, which is the file-dialog-with-extra-steps this screen
    exists to avoid — so any entry carrying a snapshot gets its frame
    rendered offscreen from that snapshot.

    Sequentially, and one at a time: each render primes the media cache
    and waits for decode, and four of them at once would thrash the
    decoder and produce four dark frames instead of one good one.

    The bundled starter has no snapshot — it is rebuilt from code, not
    reloaded — so it keeps the placeholder until it has been opened
    once, at which point leaving the editor captures a real frame.
  */
  React.useEffect(() => {
    let cancelled = false;

    /*
      Deferred, and idle if the browser will say so.

      Each capture is a full-resolution composite of every clip in the
      project — 87 of them for the bundled starter — drawn synchronously
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
      <HomeTopBar onOpenAgentPicker={() => setPickerOpen(true)} />

      <div className="flex-1 flex min-h-0">
        <HomeSidebar
          view={view}
          onView={setView}
          onOpenFile={() => fileInputRef.current?.click()}
          recoverable={recoverable}
          onRecover={actions.recover}
          onDiscardRecovery={() => { clearAutosave(); setRecoverable(false); }}
        />

        {/*
          Capped rather than fluid. Eight tool tiles spread across a 27"
          display land a hand's width apart and the row stops reading as
          a group — the Gestalt breaks long before the pixels run out.
        */}
        <main className="flex-1 min-w-0 overflow-y-auto pl-9 pr-12 pb-16">
          <div className="max-w-[1180px]">
          {view === 'home' ? (
            /* Rhythm, not a constant. The hero block and the tool row
               are one thought and sit closer together; the projects
               wall is a different one and gets air before it. */
            <div className="flex flex-col gap-14">
              <HeroRow
                onNewProject={actions.newProject}
                onOpenCopilot={actions.openCopilot}
                mostRecent={recents[0]}
                onOpenRecent={actions.openRecent}
              />
              <MoreTools onOpenPanel={actions.openPanel} />
              <div>
                <ProjectsSection
                  recents={recents}
                  onOpen={actions.openRecent}
                  onForget={forget}
                  featuredId={recents[0]?.id}
                />
              </div>
            </div>
          ) : (
            <SkillsView />
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
