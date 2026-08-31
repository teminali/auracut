import { create } from 'zustand';
import { ProjectSettings, AspectRatio, ASPECT_DIMENSIONS } from '../types/edl';
import { INITIAL_PROJECT } from '../mcp/defaultMedia';

export type ExportPhase = 'idle' | 'preparing' | 'rendering' | 'encoding' | 'muxing' | 'done' | 'error';

/**
 * What a render is doing right now, beyond the percentage.
 *
 * Declared here rather than imported from `exportPipeline` on purpose:
 * the store must not depend on the engine, and the engine's
 * `ExportProgressDetail` is structurally the same shape. It lives in the
 * store so an export the AGENT started shows the same dialog as one the
 * user started — `render_export` sets this too.
 */
export interface ExportTelemetry {
  frame: number;
  totalFrames: number;
  /** Frames a second, right now. */
  fps: number;
  etaMs: number | null;
  engine: 'webcodecs' | 'ffmpeg';
  /** One per render window; empty when the render is not chunked. */
  lanes?: { worker: number; chunk: number; frames: number; totalFrames: number }[];
}

interface ProjectState {
  project: ProjectSettings;

  isExporting: boolean;
  exportProgress: number;
  exportStatusText: string;
  exportPhase: ExportPhase;
  exportTelemetry: ExportTelemetry | null;
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
  setExportProgress: (
    progress: number,
    statusText?: string,
    phase?: ExportPhase,
    telemetry?: ExportTelemetry | null
  ) => void;
  setLastExportPath: (path: string | null) => void;
  cancelActiveExport: () => void;
  setActiveExportCancelHandler: (fn: (() => void) | null) => void;
  toggleCopilot: () => void;
  setCopilotOpen: (open: boolean) => void;
  setMcpModalOpen: (open: boolean) => void;
  setExportModalOpen: (open: boolean) => void;
  loadProjectSettings: (settings: ProjectSettings) => void;
}

let activeExportCancelFn: (() => void) | null = null;

const touch = (p: ProjectSettings): ProjectSettings => ({ ...p, updatedAt: Date.now() });

export const useProjectStore = create<ProjectState>((set) => ({
  project: INITIAL_PROJECT,

  isExporting: false,
  exportProgress: 0,
  exportStatusText: '',
  exportPhase: 'idle',
  exportTelemetry: null,
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
  setExportProgress: (exportProgress, exportStatusText = '', exportPhase, telemetry) =>
    set((s) => ({
      exportProgress,
      exportStatusText,
      exportPhase: exportPhase ?? s.exportPhase,
      /* `undefined` leaves the last reading alone; `null` clears it.
         The distinction matters because the phase lines between frames
         ("Mixing audio…") carry no telemetry and must not blank the
         numbers the user was just reading. */
      exportTelemetry: telemetry === undefined ? s.exportTelemetry : telemetry,
    })),
  setLastExportPath: (lastExportPath) => set({ lastExportPath }),

  cancelActiveExport: () => {
    if (activeExportCancelFn) {
      try { activeExportCancelFn(); } catch { /* ignore */ }
    }
    set({ isExporting: false, exportPhase: 'idle', exportStatusText: 'Export cancelled' });
  },

  setActiveExportCancelHandler: (fn) => {
    activeExportCancelFn = fn;
  },

  toggleCopilot: () => set((s) => ({ isCopilotOpen: !s.isCopilotOpen })),
  setCopilotOpen: (isCopilotOpen) => set({ isCopilotOpen }),
  setMcpModalOpen: (isMcpModalOpen) => set({ isMcpModalOpen }),
  setExportModalOpen: (isExportModalOpen) => set({ isExportModalOpen }),

  loadProjectSettings: (project) => set({ project }),
}));
