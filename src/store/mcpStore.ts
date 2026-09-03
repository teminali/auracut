import { create } from 'zustand';
import { McpServerStatus, McpToolLogEntry } from '../types/mcp';

interface McpState {
  status: McpServerStatus;
  logs: McpToolLogEntry[];
  lastActiveToolName?: string;

  // Actions
  logToolExecution: (entry: Omit<McpToolLogEntry, 'id' | 'timestamp'>) => void;
  updateStatus: (partial: Partial<McpServerStatus>) => void;
  clearLogs: () => void;
}

export const useMcpStore = create<McpState>((set) => ({
  status: {
    isRunning: true,
    transport: 'both',
    ssePort: 3888,
    connectedClientsCount: 2,
    activeAgents: [
      { id: 'agent_antigravity', name: 'Antigravity IDE (Stdio)', connectedAt: Date.now() - 120000 },
      { id: 'agent_copilot', name: 'TeminaliCut Internal Copilot (SSE)', connectedAt: Date.now() - 45000 },
    ],
    totalToolCalls: 14,
    uptimeSeconds: 320,
  },
  logs: [
    {
      id: 'log_init_1',
      toolName: 'generate_auto_captions',
      parameters: { audioTrackId: 'track_text_v3', language: 'sw' },
      result: { status: 'success', wordsGenerated: 28, confidence: 0.98 },
      status: 'success',
      timestamp: Date.now() - 40000,
      durationMs: 820,
      agentName: 'TeminaliCut Copilot',
    },
    {
      id: 'log_init_2',
      toolName: 'apply_transition',
      parameters: { fromClipId: 'clip_vid_1', toClipId: 'clip_vid_2', transitionType: 'whip_pan', durationMs: 400 },
      result: { status: 'success', appliedToSeam: true },
      status: 'success',
      timestamp: Date.now() - 25000,
      durationMs: 45,
      agentName: 'Antigravity IDE',
    },
  ],
  lastActiveToolName: undefined,

  logToolExecution: (entry) =>
    set((state) => {
      const newEntry: McpToolLogEntry = {
        ...entry,
        id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: Date.now(),
      };
      return {
        logs: [newEntry, ...state.logs].slice(0, 100), // keep latest 100
        lastActiveToolName: entry.toolName,
        status: {
          ...state.status,
          totalToolCalls: state.status.totalToolCalls + 1,
        },
      };
    }),

  updateStatus: (partial) =>
    set((state) => ({
      status: { ...state.status, ...partial },
    })),

  clearLogs: () => set({ logs: [] }),
}));
