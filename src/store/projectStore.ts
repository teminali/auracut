import { create } from 'zustand';
import { ProjectSettings, AspectRatio, ASPECT_DIMENSIONS } from '../types/edl';
import { INITIAL_PROJECT } from '../mcp/defaultMedia';

export type ExportPhase = 'idle' | 'preparing' | 'rendering' | 'encoding' | 'muxing' | 'done' | 'error';

interface ProjectState {
  project: ProjectSettings;

  isExporting: boolean;
  exportProgress: number;
  exportStatusText: string;
  exportPhase: ExportPhase;
  lastExportPath: string | null;

  isCopilotOpen: boolean;
  isMcpModalOpen: boolean;
  isExportModalOpen: boolean;

  setProjectName: (name: string) => void;
  setAspectRatio: (aspect: AspectRatio) => void;
  setFps: (fps: 24 | 30 | 60) => void;
  setDurationMs: (durationMs: number) => void;
  setBackgroundColor: (color: string) => void;
  setIsExporting: (exporting: boolean) => void;
  setExportProgress: (progress: number, statusText?: string, phase?: ExportPhase) => void;
  setLastExportPath: (path: string | null) => void;
  toggleCopilot: () => void;
  setCopilotOpen: (open: boolean) => void;
  setMcpModalOpen: (open: boolean) => void;
  setExportModalOpen: (open: boolean) => void;
  loadProjectSettings: (settings: ProjectSettings) => void;
}

const touch = (p: ProjectSettings): ProjectSettings => ({ ...p, updatedAt: Date.now() });

export const useProjectStore = create<ProjectState>((set) => ({
  project: INITIAL_PROJECT,

  isExporting: false,
  exportProgress: 0,
  exportStatusText: '',
  exportPhase: 'idle',
  lastExportPath: null,

  isCopilotOpen: false,
  isMcpModalOpen: false,
  isExportModalOpen: false,

  setProjectName: (name) => set((s) => ({ project: touch({ ...s.project, name }) })),

  setAspectRatio: (aspectRatio) =>
    set((s) => {
      const dims = ASPECT_DIMENSIONS[aspectRatio] ?? ASPECT_DIMENSIONS['16:9'];
      return { project: touch({ ...s.project, aspectRatio, width: dims.width, height: dims.height }) };
    }),

  setFps: (fps) => set((s) => ({ project: touch({ ...s.project, fps }) })),
  setDurationMs: (durationMs) =>
    set((s) => ({ project: touch({ ...s.project, durationMs: Math.max(1000, Math.round(durationMs)) }) })),
  setBackgroundColor: (backgroundColor) => set((s) => ({ project: touch({ ...s.project, backgroundColor }) })),

  setIsExporting: (isExporting) => set({ isExporting }),
  setExportProgress: (exportProgress, exportStatusText = '', exportPhase) =>
    set((s) => ({ exportProgress, exportStatusText, exportPhase: exportPhase ?? s.exportPhase })),
  setLastExportPath: (lastExportPath) => set({ lastExportPath }),

  toggleCopilot: () => set((s) => ({ isCopilotOpen: !s.isCopilotOpen })),
  setCopilotOpen: (isCopilotOpen) => set({ isCopilotOpen }),
  setMcpModalOpen: (isMcpModalOpen) => set({ isMcpModalOpen }),
  setExportModalOpen: (isExportModalOpen) => set({ isExportModalOpen }),

  loadProjectSettings: (project) => set({ project }),
}));
