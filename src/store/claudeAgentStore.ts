/* ═══════════════════════════════════════════════════════════════════
   Claude Code session state.

   Consumes the CLI's stream-json output and turns it into something the
   drawer can render. One turn produces many events; they are folded into
   a small, stable shape rather than kept raw, so the UI never has to
   know the wire format.
   ═══════════════════════════════════════════════════════════════════ */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { buildTurnBrief } from '../engine/contextProtocol';
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
  queue: string[];

  refreshStatus: () => Promise<void>;
  send: (prompt: string) => Promise<void>;
  unqueue: (index: number) => string | null;
  drainQueue: () => void;
  clearQueue: () => void;
  stop: () => void;
  clear: () => void;
  attach: () => () => void;
}

/** Friendly label for a tool name, hiding the mcp__kerf__ prefix. */
export function prettyToolName(name: string): string {
  return name.replace(/^mcp__kerf__/, '').replace(/_/g, ' ');
}

/** The single live subscription, shared by every caller of attach(). */
let detach: (() => void) | null = null;

export const useClaudeAgentStore = create<ClaudeAgentState>()(
  persist(
    (set, get) => ({
  status: null,
  turns: [],
  isRunning: false,
  queue: [],
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

  unqueue: (index) => {
    const q = get().queue;
    if (index < 0 || index >= q.length) return null;
    const [removed] = q.slice(index, index + 1);
    set({ queue: q.filter((_, i) => i !== index) });
    return removed ?? null;
  },

  clearQueue: () => set({ queue: [] }),

  /*
    Start the next queued prompt, if there is one.

    Called wherever a run settles. `send` is re-entered rather than
    inlined so a queued prompt goes through exactly the same path as a
    typed one — including creating its turns and flipping isRunning —
    and a queue of three drains one at a time rather than racing.
  */
  drainQueue: () => {
    const { queue, isRunning } = get();
    if (isRunning || queue.length === 0) return;
    const [next, ...rest] = queue;
    set({ queue: rest });
    void get().send(next);
  },

  send: async (prompt) => {
    const api = window.electronAPI;
    if (!api?.claude) return;
    /*
      Busy: hold it instead of dropping it. This is the whole point of
      the queue — the previous behaviour returned here and the user's
      message ceased to exist.
    */
    if (get().isRunning) {
      const text = prompt.trim();
      if (text) set((s) => ({ queue: [...s.queue, text] }));
      return;
    }

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

    /*
      Hand the agent the timeline it is about to edit.

      Measured: "How many clips are on the timeline?" cost 16.7s and two
      model round-trips — ToolSearch, then describe_timeline — against a
      4.1s floor for a turn that calls no tools. The answer was in the
      renderer's stores the whole time. The built-in planner has always
      been given this (`buildEnvelope`); the CLI path sent bare text, so
      the PRIMARY backend was the less informed one.

      Sent every turn rather than once at session start, because the
      user moves the playhead and changes the selection between turns
      and a stale brief is worse than none.
    */
    const withContext =
      `<kerf-timeline>\n${buildTurnBrief()}\n</kerf-timeline>\n\n${prompt}`;
    await api.claude.send(withContext, get().hasSession);
  },

  stop: () => {
    /*
      Stopping is a decision about the whole run, not just the turn in
      flight: a user who presses Esc does not want the three prompts
      behind it to start firing one after another.
    */
    void window.electronAPI?.claude.stop();
    set({ isRunning: false, activity: '', startedAt: null, queue: [] });
  },

  clear: () => {
    void window.electronAPI?.claude.reset();
    set({ turns: [], hasSession: false, isRunning: false, activity: '', startedAt: null, queue: [] });
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

        case 'kerf_error':
          patchLast((t) => ({
            ...t,
            text: String(event.message ?? 'Something went wrong.'),
            isError: true,
            endedAt: Date.now(),
          }));
          set({ isRunning: false, activity: '', startedAt: null });
          queueMicrotask(() => useClaudeAgentStore.getState().drainQueue());
          return;

        case 'kerf_done':
          patchLast((t) => (t.endedAt ? t : { ...t, endedAt: Date.now() }));
          set({ isRunning: false, activity: '', startedAt: null });
          queueMicrotask(() => useClaudeAgentStore.getState().drainQueue());
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
    }),
    {
      name: 'teminali.claudeAgent.v2',
      partialize: (state) => ({
        turns: state.turns,
        hasSession: state.hasSession,
        queue: state.queue,
      }),
    }
  )
);
