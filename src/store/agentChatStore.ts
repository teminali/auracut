import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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
  /** Typed while a run was in flight, oldest first. See `sendPrompt`. */
  queue: string[];

  setSelectedModel: (model: AgentModel) => void;
  toggleThoughts: () => void;
  sendPrompt: (prompt: string, context?: ContextEnvelope) => Promise<void>;
  cancelRun: () => void;
  clearChat: () => void;
  unqueue: (index: number) => void;
  clearQueue: () => void;
}

const WELCOME: ChatMessage = {
  id: 'msg_welcome',
  sender: 'agent',
  text: [
    "I read your timeline directly. The exact frame you're parked on, every layer on it, and where each one sits in the frame.",
    '',
    'Ask me anything about the edit, or tell me what to change: “make this pop”, “move that to the corner”, “add snow”, “cut the silence”.',
    '',
    'For visual changes, park the playhead on the shot, attach the frame, and draw on it to point at things.',
  ].join('\n'),
  timestamp: Date.now(),
};

export const useAgentChatStore = create<AgentChatState>()(
  persist(
    (set, get) => ({
      messages: [WELCOME],
      currentRun: null,
      selectedModel: 'builtin',
      showThoughts: true,
      history: [],
      queue: [],

      setSelectedModel: (selectedModel) => set({ selectedModel }),
      toggleThoughts: () => set((s) => ({ showThoughts: !s.showThoughts })),

      sendPrompt: async (prompt, context) => {
        const trimmed = prompt.trim();
        if (!trimmed) return;
        /*
          Busy: queue it rather than drop it.
        */
        if (get().currentRun) {
          set((s) => ({ queue: [...s.queue, trimmed] }));
          return;
        }

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
          /* Prior turns with caching, so follow-up requests retain conversational context */
          const chatHistory = get().messages
            .filter((m) => m.id !== 'msg_welcome' && m.text.trim().length > 0)
            .slice(-10)
            .map((m) => ({
              role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
              content: m.text,
            }));

          await agentBridge.dispatchPrompt(trimmed, model, context, chatHistory);
        } finally {
          unsubscribe();
          set({ currentRun: null });
          /* Drain one, through the same path a typed prompt takes. */
          const next = get().queue[0];
          if (next) {
            set((s) => ({ queue: s.queue.slice(1) }));
            void get().sendPrompt(next, context);
          }
        }
      },

      cancelRun: () => {
        agentBridge.cancelActiveRun();
        set({ currentRun: null, queue: [] });
      },

      unqueue: (index) => set((s) => ({ queue: s.queue.filter((_, i) => i !== index) })),
      clearQueue: () => set({ queue: [] }),

      clearChat: () => set({ messages: [WELCOME], currentRun: null, queue: [] }),
    }),
    {
      name: 'teminali.agentChat.v2',
      partialize: (state) => ({
        messages: state.messages,
        history: state.history,
        selectedModel: state.selectedModel,
        showThoughts: state.showThoughts,
      }),
    }
  )
);
