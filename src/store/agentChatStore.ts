import { create } from 'zustand';
import { agentBridge, AgentExecutionRun, AgentThoughtStep, AgentModel } from '../engine/agentBridge';
import { ContextEnvelope } from '../types/context';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  agentModel?: AgentModel;
  thoughts?: AgentThoughtStep[];
  status?: AgentExecutionRun['status'];
  /** Snapshot of the editor state this message was sent against. */
  context?: ContextEnvelope;
  timestamp: number;
}

interface AgentChatState {
  messages: ChatMessage[];
  currentRun: AgentExecutionRun | null;
  selectedModel: AgentModel;
  showThoughts: boolean;
  /** Prompts the user has sent, newest last — ↑/↓ recall. */
  history: string[];

  setSelectedModel: (model: AgentModel) => void;
  toggleThoughts: () => void;
  sendPrompt: (prompt: string, context?: ContextEnvelope) => Promise<void>;
  cancelRun: () => void;
  clearChat: () => void;
}

const WELCOME: ChatMessage = {
  id: 'msg_welcome',
  sender: 'agent',
  text: [
    "I read your timeline directly — the exact frame you're parked on, every layer on it, and where each one sits in the frame.",
    '',
    'Ask me anything about the edit, or tell me what to change: “make this pop”, “move that to the corner”, “add snow”, “cut the silence”.',
    '',
    'For visual changes, park the playhead on the shot, attach the frame, and draw on it to point at things.',
  ].join('\n'),
  timestamp: Date.now(),
};

export const useAgentChatStore = create<AgentChatState>((set, get) => ({
  messages: [WELCOME],
  currentRun: null,
  selectedModel: 'antigravity',
  showThoughts: true,
  history: [],

  setSelectedModel: (selectedModel) => set({ selectedModel }),
  toggleThoughts: () => set((s) => ({ showThoughts: !s.showThoughts })),

  sendPrompt: async (prompt, context) => {
    const trimmed = prompt.trim();
    if (!trimmed || get().currentRun) return;

    const agentMsgId = `agent_${Date.now()}`;
    const model = get().selectedModel;

    set((s) => ({
      history: [...s.history.filter((h) => h !== trimmed), trimmed].slice(-40),
      messages: [
        ...s.messages,
        { id: `usr_${Date.now()}`, sender: 'user', text: trimmed, context, timestamp: Date.now() },
        { id: agentMsgId, sender: 'agent', text: '', agentModel: model, thoughts: [], status: 'planning', timestamp: Date.now() },
      ],
    }));

    const unsubscribe = agentBridge.subscribe((run) => {
      set((s) => {
        const messages = s.messages.map((m) =>
          m.id === agentMsgId
            ? {
                ...m,
                text: run.finalResponse || run.currentActivity,
                thoughts: run.thoughts,
                status: run.status,
              }
            : m
        );
        const settled = run.status === 'completed' || run.status === 'error' || run.status === 'cancelled';
        return { messages, currentRun: settled ? null : run };
      });
    });

    try {
      /* Prior turns, so a follow-up like "why?" has something to follow.
         The welcome card is scaffolding, not a turn — it is filtered out. */
      const chatHistory = get().messages
        .filter((m) => m.id !== 'msg_welcome' && m.text.trim().length > 0)
        .slice(-6)
        .map((m) => ({
          role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.text,
        }));

      await agentBridge.dispatchPrompt(trimmed, model, context, chatHistory);
    } finally {
      unsubscribe();
      set({ currentRun: null });
    }
  },

  cancelRun: () => {
    agentBridge.cancelActiveRun();
    set({ currentRun: null });
  },

  clearChat: () => set({ messages: [WELCOME], currentRun: null }),
}));
