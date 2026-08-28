/* ═══════════════════════════════════════════════════════════════════
   Kerf — application shell.
   Owns the resizable panel layout and mounts the global overlays.
   ═══════════════════════════════════════════════════════════════════ */

import React, { useCallback, useEffect } from 'react';
import { HeaderBar } from './components/header/HeaderBar';
import { HomeScreen } from './components/home/HomeScreen';
import { SidebarNav } from './components/sidebar/SidebarNav';
import { MediaPanel } from './components/sidebar/MediaPanel';
import { AudioPanel } from './components/sidebar/AudioPanel';
import { TextPanel } from './components/sidebar/TextPanel';
import { CaptionsPanel } from './components/sidebar/CaptionsPanel';
import { TransitionsPanel } from './components/sidebar/TransitionsPanel';
import { EffectsPanel } from './components/sidebar/EffectsPanel';
import { FiltersPanel } from './components/sidebar/FiltersPanel';
import { AiToolsPanel } from './components/sidebar/AiToolsPanel';
import { PreviewPlayer } from './components/preview/PreviewPlayer';
import { InspectorPanel } from './components/inspector/InspectorPanel';
import { Timeline } from './components/timeline/Timeline';
import { CopilotDrawer } from './components/copilot/CopilotDrawer';
import { RecorderStudio } from './components/recorder/RecorderStudio';
import { ExportModal } from './components/header/ExportModal';
import { CommandPalette } from './components/ui/CommandPalette';
import { ContextMenu } from './components/ui/ContextMenu';
import { ShortcutsOverlay } from './components/ui/ShortcutsOverlay';
import { Toasts } from './components/ui/Toasts';
import { useLayoutStore } from './store/layoutStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { startAutosave, clearAutosave, serializeProject } from './engine/projectIO';
import { captureCurrentFrame } from './engine/contextProtocol';
import { posterFromSnapshot } from './engine/posterCapture';
import { useProjectStore } from './store/projectStore';
import { useTimelineStore, getContentEndMs } from './store/timelineStore';
import { useRecentsStore } from './store/recentsStore';
import {
  PanelLeftClose, PanelRightClose,
} from './components/ui/icons';

const PANELS = {
  media: MediaPanel,
  audio: AudioPanel,
  text: TextPanel,
  captions: CaptionsPanel,
  transitions: TransitionsPanel,
  effects: EffectsPanel,
  filters: FiltersPanel,
  ai: AiToolsPanel,
} as const;

export const App: React.FC = () => {
  const {
    sidebarWidth, setSidebarWidth,
    inspectorWidth, setInspectorWidth,
    timelineHeight, setTimelineHeight,
    isSidebarCollapsed, isInspectorCollapsed,
    toggleSidebar, toggleInspector,
    activeTab, showHome, setShowHome,
  } = useLayoutStore();

  useKeyboardShortcuts();

  /*
    Autosave runs in the EDITOR and nowhere else.

    It used to run for the life of the process, so it kept rewriting the
    slot while you sat on home with nothing open — which is why home
    could offer to "recover" work that was already on the recents wall,
    to everybody, permanently. Paired with the clear in `goHome` below,
    a surviving autosave now means one thing: this app did not get to
    say goodbye.
  */
  useEffect(() => (showHome ? undefined : startAutosave()), [showHome]);

  /*
    Tell main which screen is showing, so the window's close button can
    mean "back to home" in the editor and "quit" on home. Also listen for
    main's request to go home, which is what it sends instead of closing.
  */
  useEffect(() => {
    void window.electronAPI?.ui.setScreen(showHome ? 'home' : 'editor');
  }, [showHome]);

  /*
    Remember the project whenever you leave it for home, with a real
    frame rendered from the edit. A recents wall of grey rectangles is a
    file dialog with extra steps — the poster is the whole point.
  */
  const goHome = useCallback(() => {
    try {
      const proj = useProjectStore.getState().project;
      const timeline = useTimelineStore.getState();
      const clipCount = timeline.tracks.reduce((n, t) => n + t.clips.length, 0);

      if (clipCount > 0) {
        const frame = captureCurrentFrame();
        const snapshot = serializeProject();
        useRecentsStore.getState().remember({
          id: proj.id,
          name: proj.name,
          posterUrl: frame.unavailableReason ? undefined : frame.dataUrl,
          durationMs: getContentEndMs(timeline.tracks),
          aspectRatio: proj.aspectRatio,
          clipCount,
          snapshot,
        });

        /*
          Then render it again properly, in the background.

          The capture above is synchronous and takes whatever the media
          cache happens to hold at that instant. Leave the editor a
          second after opening a project and every clip is still
          decoding, so the "frame" is the compositor's dark placeholder
          gradient — which does not look like an error, it looks like a
          legitimately dark shot, and it sticks to the wall for ever.

          `posterFromSnapshot` waits for decode and samples a third of
          the way in rather than at zero, so this replaces a plausible
          black rectangle with the project's actual picture. It is fire
          and forget: nothing waits on it, and if it fails the frame
          captured above is still there.
        */
        void posterFromSnapshot(snapshot).then(({ dataUrl }) => {
          if (dataUrl) useRecentsStore.getState().setPoster(proj.id, dataUrl);
        });
      }
    } catch {
      /* Never let bookkeeping stop someone leaving the editor. */
    }

    /*
      The snapshot above IS the save. Leaving it in the autosave slot as
      well would mean home offering to recover the project it is showing
      you a poster of, which is the state the old "Unsaved work" card
      was permanently stuck in. Cleared unconditionally: an empty
      timeline wrote no entry and has nothing worth recovering either.
    */
    clearAutosave();
    setShowHome(true);
  }, [setShowHome]);

  useEffect(() => window.electronAPI?.ui.onGoHome(() => goHome()), [goHome]);

  /** Generic splitter drag. `sign` flips the direction for right/bottom edges. */
  const dragSplitter = useCallback(
    (axis: 'x' | 'y', sign: 1 | -1, current: number, apply: (v: number) => void) =>
      (e: React.PointerEvent) => {
        e.preventDefault();
        const start = axis === 'x' ? e.clientX : e.clientY;
        const startValue = current;

        const move = (ev: PointerEvent) => {
          const now = axis === 'x' ? ev.clientX : ev.clientY;
          apply(startValue + (now - start) * sign);
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          document.body.style.userSelect = '';
        };

        document.body.style.userSelect = 'none';
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      },
    []
  );

  const ActivePanel = PANELS[activeTab] ?? MediaPanel;

  /*
    Home replaces the whole editor rather than sitting beside it. The
    editor's own chrome — timeline, inspector, transport — is meaningless
    without a project in front of you, and showing it greyed out behind a
    launcher is how an app feels heavy before you have done anything.
  */
  if (showHome) {
    return (
      <div className="h-screen w-screen bg-spectrum-bg text-spectrum-text overflow-hidden font-sans">
        <HomeScreen onEnterEditor={() => setShowHome(false)} />
        {/*
          Mounted on BOTH screens, and driven by its own store rather
          than by which one is showing. A take started from home can only
          finish in the editor, and the window is hidden for most of the
          time in between — so the studio has to outlive the screen it
          was opened from.
        */}
        <RecorderStudio onEnterEditor={() => setShowHome(false)} />
        <Toasts />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-spectrum-bg text-spectrum-text overflow-hidden font-sans select-none">
      <HeaderBar onGoHome={goHome} />

      {/* Workspace */}
      <div className="flex-1 flex overflow-hidden relative min-h-0">
        <SidebarNav />

        {!isSidebarCollapsed && (
          <>
            <div style={{ width: sidebarWidth }} className="h-full flex-shrink-0 overflow-hidden">
              <ActivePanel />
            </div>
            <div
              onPointerDown={dragSplitter('x', 1, sidebarWidth, setSidebarWidth)}
              onDoubleClick={toggleSidebar}
              className="splitter-col"
              title="Drag to resize · double-click to collapse"
            />
          </>
        )}

        {/* Monitor */}
        <div className="flex-1 flex flex-col min-w-[280px] min-h-0 relative">
          <PreviewPlayer />

          {/* Collapse affordances live on the monitor edges */}
          {isSidebarCollapsed && (
            <button
              onClick={toggleSidebar}
              className="absolute left-1.5 top-1.5 pro-btn w-6 h-6 z-30 bg-spectrum-panel/80 backdrop-blur"
              title="Show the side panel"
            >
              <PanelLeftClose className="w-3.5 h-3.5 rotate-180" />
            </button>
          )}
          {isInspectorCollapsed && (
            <button
              onClick={toggleInspector}
              className="absolute right-1.5 top-1.5 pro-btn w-6 h-6 z-30 bg-spectrum-panel/80 backdrop-blur"
              title="Show the inspector"
            >
              <PanelRightClose className="w-3.5 h-3.5 rotate-180" />
            </button>
          )}
        </div>

        {!isInspectorCollapsed && (
          <>
            <div
              onPointerDown={dragSplitter('x', -1, inspectorWidth, setInspectorWidth)}
              onDoubleClick={toggleInspector}
              className="splitter-col"
              title="Drag to resize · double-click to collapse"
            />
            <div style={{ width: inspectorWidth }} className="h-full flex-shrink-0 overflow-hidden">
              <InspectorPanel />
            </div>
          </>
        )}

        <CopilotDrawer />
      </div>

      {/* Timeline */}
      <div
        onPointerDown={dragSplitter('y', -1, timelineHeight, setTimelineHeight)}
        onDoubleClick={() => setTimelineHeight(320)}
        className="splitter-row"
        title="Drag to resize the timeline · double-click to reset"
      />
      <div style={{ height: timelineHeight }} className="flex-shrink-0 min-h-0">
        <Timeline />
      </div>

      {/* Overlays */}
      <RecorderStudio onEnterEditor={() => setShowHome(false)} />
      <ExportModal />
      <CommandPalette />
      <ShortcutsOverlay />
      <ContextMenu />
      <Toasts />
    </div>
  );
};

export default App;
