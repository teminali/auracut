import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SidebarTab =
  | 'media' | 'audio' | 'text' | 'captions'
  | 'transitions' | 'effects' | 'filters' | 'ai';

interface LayoutState {
  sidebarWidth: number;
  inspectorWidth: number;
  timelineHeight: number;
  copilotWidth: number;

  isSidebarCollapsed: boolean;
  isInspectorCollapsed: boolean;
  activeTab: SidebarTab;

  /* Monitor overlays */
  showSafeAreas: boolean;
  showRuleOfThirds: boolean;
  showCinemaLetterbox: boolean;
  showScopes: boolean;

  setSidebarWidth: (width: number) => void;
  setInspectorWidth: (width: number) => void;
  setTimelineHeight: (height: number) => void;
  setCopilotWidth: (width: number) => void;
  setActiveTab: (tab: SidebarTab) => void;
  toggleSidebar: () => void;
  toggleInspector: () => void;
  toggleSafeAreas: () => void;
  toggleRuleOfThirds: () => void;
  toggleCinemaLetterbox: () => void;
  toggleScopes: () => void;
  resetLayout: () => void;
}

const DEFAULTS = {
  sidebarWidth: 272,
  inspectorWidth: 308,
  timelineHeight: 320,
  copilotWidth: 360,
};

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      isSidebarCollapsed: false,
      isInspectorCollapsed: false,
      activeTab: 'media',

      showSafeAreas: false,
      showRuleOfThirds: false,
      showCinemaLetterbox: false,
      showScopes: false,

      setSidebarWidth: (w) => set({ sidebarWidth: Math.max(200, Math.min(520, w)) }),
      setInspectorWidth: (w) => set({ inspectorWidth: Math.max(240, Math.min(520, w)) }),
      setTimelineHeight: (h) => set({ timelineHeight: Math.max(140, Math.min(620, h)) }),
      setCopilotWidth: (w) => set({ copilotWidth: Math.max(300, Math.min(640, w)) }),
      setActiveTab: (activeTab) => set({ activeTab, isSidebarCollapsed: false }),

      toggleSidebar: () => set((s) => ({ isSidebarCollapsed: !s.isSidebarCollapsed })),
      toggleInspector: () => set((s) => ({ isInspectorCollapsed: !s.isInspectorCollapsed })),
      toggleSafeAreas: () => set((s) => ({ showSafeAreas: !s.showSafeAreas })),
      toggleRuleOfThirds: () => set((s) => ({ showRuleOfThirds: !s.showRuleOfThirds })),
      toggleCinemaLetterbox: () => set((s) => ({ showCinemaLetterbox: !s.showCinemaLetterbox })),
      toggleScopes: () => set((s) => ({ showScopes: !s.showScopes })),

      resetLayout: () => set({ ...DEFAULTS, isSidebarCollapsed: false, isInspectorCollapsed: false }),
    }),
    {
      name: 'auracut.layout',
      // Overlay toggles are per-session; only persist the actual layout.
      partialize: (s) => ({
        sidebarWidth: s.sidebarWidth,
        inspectorWidth: s.inspectorWidth,
        timelineHeight: s.timelineHeight,
        copilotWidth: s.copilotWidth,
        activeTab: s.activeTab,
      }),
    }
  )
);
