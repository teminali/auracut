import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SidebarTab =
  | 'media' | 'audio' | 'text' | 'captions'
  | 'transitions' | 'effects' | 'filters' | 'skills' | 'ai';

interface LayoutState {
  sidebarWidth: number;
  inspectorWidth: number;
  timelineHeight: number;
  copilotWidth: number;

  isSidebarCollapsed: boolean;
  isInspectorCollapsed: boolean;
  activeTab: SidebarTab;

  /* Monitor overlays */
  /**
   * Whether the editor follows the Copilot's work — opening the panel it
   * is using, selecting the clip it changed, moving the playhead to what
   * it is looking at. Nothing is simulated; every movement is a real
   * consequence of a tool that really ran.
   */
  /** The home screen, shown before a project is being worked on. */
  showHome: boolean;
  /**
   * The fullscreen Player, over whichever screen is showing.
   *
   * It lives here rather than in either screen's local state because
   * BOTH open it — Home's Play action and the Editor monitor's
   * fullscreen button — and it must be the same one. It is also what
   * tells `PreviewPlayer` to hand over the program loop, so a local
   * boolean in one component could not have expressed it.
   *
   * Deliberately NOT persisted: the app must never start up inside a
   * player over a project nobody has opened yet.
   */
  isPlayerOpen: boolean;
  followAgent: boolean;
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
  setShowHome: (show: boolean) => void;
  openPlayer: () => void;
  closePlayer: () => void;
  toggleFollowAgent: () => void;
  toggleSafeAreas: () => void;
  toggleRuleOfThirds: () => void;
  toggleCinemaLetterbox: () => void;
  toggleScopes: () => void;
  resetLayout: () => void;
}

const DEFAULTS = {
  sidebarWidth: 272,
  inspectorWidth: 296,
  timelineHeight: 291,
  copilotWidth: 360,
};

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      isSidebarCollapsed: false,
      isInspectorCollapsed: false,
      activeTab: 'media',

      showHome: true,
      isPlayerOpen: false,
      followAgent: true,

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
      setShowHome: (showHome) => set({ showHome }),
      openPlayer: () => set({ isPlayerOpen: true }),
      closePlayer: () => set({ isPlayerOpen: false }),
      toggleFollowAgent: () => set((st) => ({ followAgent: !st.followAgent })),
      toggleSafeAreas: () => set((s) => ({ showSafeAreas: !s.showSafeAreas })),
      toggleRuleOfThirds: () => set((s) => ({ showRuleOfThirds: !s.showRuleOfThirds })),
      toggleCinemaLetterbox: () => set((s) => ({ showCinemaLetterbox: !s.showCinemaLetterbox })),
      toggleScopes: () => set((s) => ({ showScopes: !s.showScopes })),

      resetLayout: () => set({ ...DEFAULTS, isSidebarCollapsed: false, isInspectorCollapsed: false }),
    }),
    {
      name: 'kerf.layout',
      version: 2,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<Pick<
          LayoutState,
          'sidebarWidth' | 'inspectorWidth' | 'timelineHeight' | 'copilotWidth' | 'activeTab' | 'followAgent'
        >>;
        return {
          sidebarWidth: state.sidebarWidth ?? DEFAULTS.sidebarWidth,
          // Only move the former factory values. Deliberately preserve
          // widths and heights a user actually resized themselves.
          inspectorWidth: version < 2 && state.inspectorWidth === 308
            ? 296
            : state.inspectorWidth ?? DEFAULTS.inspectorWidth,
          timelineHeight: version < 2 && state.timelineHeight === 320
            ? 291
            : state.timelineHeight ?? DEFAULTS.timelineHeight,
          copilotWidth: state.copilotWidth ?? DEFAULTS.copilotWidth,
          activeTab: state.activeTab ?? 'media',
          followAgent: state.followAgent ?? true,
        };
      },
      // Overlay toggles are per-session; only persist the actual layout.
      partialize: (s) => ({
        sidebarWidth: s.sidebarWidth,
        inspectorWidth: s.inspectorWidth,
        timelineHeight: s.timelineHeight,
        copilotWidth: s.copilotWidth,
        activeTab: s.activeTab,
        // A preference, not a layout, but the user set it deliberately
        // and expects it to still be set next launch.
        followAgent: s.followAgent,
      }),
    }
  )
);
