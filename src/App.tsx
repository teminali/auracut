/* ═══════════════════════════════════════════════════════════════════
   AuraCut — application shell.
   Owns the resizable panel layout and mounts the global overlays.
   ═══════════════════════════════════════════════════════════════════ */

import React, { useCallback, useEffect } from 'react';
import { HeaderBar } from './components/header/HeaderBar';
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
import { ExportModal } from './components/header/ExportModal';
import { CommandPalette } from './components/ui/CommandPalette';
import { ContextMenu } from './components/ui/ContextMenu';
import { ShortcutsOverlay } from './components/ui/ShortcutsOverlay';
import { Toasts } from './components/ui/Toasts';
import { useLayoutStore } from './store/layoutStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { startAutosave } from './engine/projectIO';
import { PanelLeftClose, PanelRightClose } from 'lucide-react';

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
    activeTab,
  } = useLayoutStore();

  useKeyboardShortcuts();

  useEffect(() => startAutosave(), []);

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

  return (
    <div className="flex flex-col h-screen w-screen bg-spectrum-bg text-spectrum-text overflow-hidden font-sans select-none">
      <HeaderBar />

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
      <ExportModal />
      <CommandPalette />
      <ShortcutsOverlay />
      <ContextMenu />
      <Toasts />
    </div>
  );
};

export default App;
