/* ═══════════════════════════════════════════════════════════════════
   Home.

   Rebuilt against CapCut's launcher and its templates page, closely.
   Top to bottom: a full-height left rail carrying the mark, one filled
   primary button and two nav groups; a top bar that ends in the agent,
   the settings and the account; a row of four launch tiles of which
   two are saturated; the project you were last in, with its frame; a
   tab bar; and the walls under it.

   The templates page is the OTHER view. Its banner, its search and its
   tab bar are what Skills wears now, which is the right match: both
   are a titled page over a catalogue you browse.

   What is copied is the composition. The palette is Kerf's throughout,
   and the two rules that survive from §7 are unchanged:

     1. Real content over chrome. Every project tile is a frame
        rendered from that project.
     3. No upsell in the workspace. Ever. CapCut runs advertisements in
        the rail and in the sidebar's bottom card; neither does.

   The tab bar is a jump bar, not a switch. Both walls stay mounted and
   clicking a tab scrolls to one. A tab that unmounted the other wall
   would look identical and would mean the tools row does not exist
   until you ask for it, which is a worse launcher and a broken one for
   anything driving the screen from outside.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { HomeTopBar } from './HomeTopBar';
import { HomeSidebar, HomeView } from './HomeSidebar';
import { ActionRow } from './ActionRow';
import { MoreTools } from './MoreTools';
import { NewProjectSheet } from './NewProjectSheet';
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

const WALLS = [
  { id: 'tools', label: 'Editor tools' },
  { id: 'projects', label: 'Recent projects' },
] as const;

export const HomeScreen: React.FC<Props> = ({ onEnterEditor }) => {
  const [view, setView] = React.useState<HomeView>('home');
  const [recoverable, setRecoverable] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [wall, setWall] = React.useState<string>('tools');
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
  const scrollRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    void refreshStatus();
    /*
      Reads the 0600 session file, then the catalogue. Until it answers,
      the account is `unknown` rather than signed out: see §3 on the
      third value, which this codebase got wrong three times running.
    */
    void initAccount();
    /*
      Autosave has been writing to localStorage every 20 seconds since
      the app was built, and NOTHING ever read it back. `hasAutosave`
      and `restoreAutosave` were called from nowhere, so a user whose
      app crashed had their work sitting right there and was never
      offered it. The rail's bottom card is the offer.
    */
    setRecoverable(hasAutosave());
  }, [refreshStatus, initAccount]);

  /*
    Which wall the tab bar is pointing at, read from the scroll position
    rather than from the last click. A tab bar whose underline only
    moves when you press it is wrong the moment you use the wheel, and
    on a page this short that is immediately.
  */
  React.useEffect(() => {
    const root = scrollRef.current;
    if (!root || view !== 'home') return;

    const read = () => {
      const top = root.getBoundingClientRect().top;
      let current = WALLS[0].id as string;
      for (const w of WALLS) {
        const el = document.getElementById(`hp-${w.id}`);
        if (el && el.getBoundingClientRect().top - top <= 140) current = w.id;
      }
      setWall(current);
    };

    read();
    root.addEventListener('scroll', read, { passive: true });
    return () => root.removeEventListener('scroll', read);
  }, [view]);

  const jumpTo = (id: string) => {
    const root = scrollRef.current;
    const el = document.getElementById(`hp-${id}`);
    if (!root || !el) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.scrollTo({ top: Math.max(0, el.offsetTop - 20), behavior: smooth ? 'smooth' : 'auto' });
  };

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
      <HomeSidebar
        view={view}
        onView={setView}
        onNewProject={() => setNewSheetOpen(true)}
        onOpenFile={() => fileInputRef.current?.click()}
        onRecord={actions.startRecording}
        recoverable={recoverable}
        onRecover={actions.recover}
        onDiscardRecovery={() => { clearAutosave(); setRecoverable(false); }}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <HomeTopBar onOpenAgentPicker={() => setPickerOpen(true)} />

        {/*
          Capped rather than fluid. Eight tool tiles spread across a 27"
          display land a hand's width apart and the row stops reading as
          a group: the Gestalt breaks long before the pixels run out.
        */}
        <main ref={scrollRef} className="flex-1 min-w-0 overflow-y-auto relative px-8 pb-20">
          <div className="max-w-[1360px]">
            {view === 'home' ? (
              <>
                <ActionRow
                  onNewProject={() => setNewSheetOpen(true)}
                  onOpenCopilot={actions.openCopilot}
                  onRecord={actions.startRecording}
                  onOpenFile={() => fileInputRef.current?.click()}
                  mostRecent={recents[0]}
                  onOpenRecent={actions.openRecent}
                />

                {/* The tab bar, in the reference's slot: above the walls
                    and under the featured block. */}
                <div className="flex items-center gap-6 mt-10 mb-6 rise-in rise-3">
                  {WALLS.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => jumpTo(w.id)}
                      aria-current={wall === w.id ? 'true' : undefined}
                      className={`hp-tab text-ui-xl pb-2.5 ${wall === w.id ? 'hp-tab-on' : ''}`}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-col gap-12 rise-in rise-4">
                  <MoreTools onOpenPanel={actions.openPanel} />
                  <ProjectsSection
                    recents={recents}
                    onOpen={actions.openRecent}
                    onForget={forget}
                    featuredId={recents[0]?.id}
                  />
                </div>
              </>
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
