/* ═══════════════════════════════════════════════════════════════════
   Claude Code session state.

   Consumes the CLI's stream-json output and turns it into something the
   drawer can render. One turn produces many events; they are folded into
   a small, stable shape rather than kept raw, so the UI never has to
   know the wire format.
   ═══════════════════════════════════════════════════════════════════ */

import { create } from 'zustand';
import type { ClaudeEvent, ClaudeStatus } from '../types/electron';

export interface AgentToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Undefined while the call is still in flight. */
  ok?: boolean;
  resultPreview?: string;
  /** Wall clock, so the UI can show what was slow and why a turn took time. */
  startedAt: number;
  endedAt?: number;
}

export interface AgentTurn {
  id: string;
  role: 'user' | 'agent';
  text: string;
  toolCalls: AgentToolCall[];
  isError?: boolean;
  costUsd?: number;
  timestamp: number;
  /** Set when the turn finishes, so elapsed stops climbing. */
  endedAt?: number;
}

interface ClaudeAgentState {
  status: ClaudeStatus | null;
  turns: AgentTurn[];
  isRunning: boolean;
  /** What the agent is doing right now, for the progress strip. */
  activity: string;
  /** When the running turn started, for a live elapsed readout. */
  startedAt: number | null;
  /** True once a turn has completed, so the next one can --resume. */
  hasSession: boolean;

  refreshStatus: () => Promise<void>;
  send: (prompt: string) => Promise<void>;
  stop: () => void;
  clear: () => void;
  attach: () => () => void;
}

/** Friendly label for a tool name, hiding the mcp__auracut__ prefix. */
export function prettyToolName(name: string): string {
  return name.replace(/^mcp__auracut__/, '').replace(/_/g, ' ');
}

/** The single live subscription, shared by every caller of attach(). */
let detach: (() => void) | null = null;

export const useClaudeAgentStore = create<ClaudeAgentState>((set, get) => ({
  status: null,
  turns: [],
  isRunning: false,
  activity: '',
  startedAt: null,
  hasSession: false,

  refreshStatus: async () => {
    const api = window.electronAPI;
    if (!api?.claude) {
      set({ status: { installed: false, path: null, version: null, running: false } });
      return;
    }
    set({ status: await api.claude.status() });
  },

  send: async (prompt) => {
    const api = window.electronAPI;
    if (!api?.claude || get().isRunning) return;

    const userTurn: AgentTurn = {
      id: `u_${Date.now()}`,
      role: 'user',
      text: prompt,
      toolCalls: [],
      timestamp: Date.now(),
    };

    // The agent turn is created empty and filled in as events arrive.
    const agentTurn: AgentTurn = {
      id: `a_${Date.now()}`,
      role: 'agent',
      text: '',
      toolCalls: [],
      timestamp: Date.now(),
    };

    set((s) => ({
      turns: [...s.turns, userTurn, agentTurn],
      isRunning: true,
      activity: 'Starting…',
      startedAt: Date.now(),
    }));

    await api.claude.send(prompt, get().hasSession);
  },

  stop: () => {
    void window.electronAPI?.claude.stop();
    set({ isRunning: false, activity: '', startedAt: null });
  },

  clear: () => {
    void window.electronAPI?.claude.reset();
    set({ turns: [], hasSession: false, isRunning: false, activity: '', startedAt: null });
  },

  /**
   * Subscribe to the event stream. Returns an unsubscribe function.
   *
   * Idempotent on purpose. React StrictMode mounts effects twice, and any
   * component remounting mid-session would subscribe again — either would
   * apply every event twice and render the whole turn duplicated. Guarding
   * here is more robust than depending on every caller's cleanup running.
   */
  attach: () => {
    const api = window.electronAPI;
    if (!api?.claude) return () => {};

    if (detach) return detach;

    detach = api.claude.onEvent((event: ClaudeEvent) => {
      /** Mutate the trailing agent turn, which is always the last entry. */
      const patchLast = (fn: (turn: AgentTurn) => AgentTurn) =>
        set((s) => {
          if (s.turns.length === 0) return s;
          const turns = [...s.turns];
          const last = turns[turns.length - 1];
          if (last.role !== 'agent') return s;
          turns[turns.length - 1] = fn(last);
          return { turns };
        });

      switch (event.type) {
        case 'system':
          if (event.subtype === 'init') set({ activity: 'Reading your timeline…' });
          return;

        case 'assistant': {
          const content = (event.message as { content?: unknown[] })?.content ?? [];
          for (const raw of content) {
            const block = raw as { type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown> };

            if (block.type === 'text' && block.text) {
              patchLast((t) => ({ ...t, text: t.text ? `${t.text}\n${block.text}` : block.text! }));
            } else if (block.type === 'tool_use' && block.name) {
              set({ activity: prettyToolName(block.name) });
              patchLast((t) => ({
                ...t,
                toolCalls: [
                  ...t.toolCalls,
                  {
                    id: block.id ?? `t_${t.toolCalls.length}`,
                    name: block.name!,
                    input: block.input ?? {},
                    startedAt: Date.now(),
                  },
                ],
              }));
            }
          }
          return;
        }

        case 'user': {
          // Tool results come back as a synthetic user message.
          const content = (event.message as { content?: unknown[] })?.content ?? [];
          for (const raw of content) {
            const block = raw as { type: string; tool_use_id?: string; is_error?: boolean; content?: unknown };
            if (block.type !== 'tool_result') continue;

            const preview =
              typeof block.content === 'string'
                ? block.content
                : Array.isArray(block.content)
                  ? (block.content.find((c) => (c as { type: string }).type === 'text') as { text?: string } | undefined)?.text ?? ''
                  : '';

            patchLast((t) => ({
              ...t,
              toolCalls: t.toolCalls.map((c) =>
                c.id === block.tool_use_id
                  ? { ...c, ok: !block.is_error, resultPreview: preview.slice(0, 1200), endedAt: Date.now() }
                  : c
              ),
            }));
          }
          return;
        }

        case 'result':
          patchLast((t) => ({
            ...t,
            // The final `result` string repeats the last text block, so only
            // adopt it when nothing was streamed — otherwise it duplicates.
            text: t.text || String(event.result ?? ''),
            isError: Boolean(event.is_error),
            costUsd: typeof event.total_cost_usd === 'number' ? event.total_cost_usd : undefined,
            endedAt: Date.now(),
          }));
          set({ hasSession: true, activity: '' });
          return;

        case 'auracut_error':
          patchLast((t) => ({
            ...t,
            text: String(event.message ?? 'Something went wrong.'),
            isError: true,
            endedAt: Date.now(),
          }));
          set({ isRunning: false, activity: '', startedAt: null });
          return;

        case 'auracut_done':
          patchLast((t) => (t.endedAt ? t : { ...t, endedAt: Date.now() }));
          set({ isRunning: false, activity: '', startedAt: null });
          return;

        default:
          // rate_limit_event and friends — nothing the drawer needs to show.
          return;
      }
    });

    return () => {
      detach?.();
      detach = null;
    };
  },
}));
