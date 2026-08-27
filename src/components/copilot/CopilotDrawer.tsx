/* ═══════════════════════════════════════════════════════════════════
   AI Copilot.

   Every prompt goes through the context protocol before dispatch:
   classify → pre-flight → envelope. The user sees exactly what the agent
   will be told, and blockers are fixed in one click rather than in a
   round of "which clip did you mean?".
   ═══════════════════════════════════════════════════════════════════ */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useAgentChatStore } from '../../store/agentChatStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useClaudeAgentStore } from '../../store/claudeAgentStore';
import { useTimelineStore } from '../../store/timelineStore';
import { QUICK_ACTIONS, hasModelEndpoint, AgentThoughtStep } from '../../engine/agentBridge';
import {
  runPreflight, buildEnvelope, captureCurrentFrame, summariseEnvelope,
  resolveAnnotationTargets,
} from '../../engine/contextProtocol';
import { Annotation, CapturedFrame } from '../../types/context';
import { McpActivityLog } from './McpActivityLog';
import { ContextPreflight } from './ContextPreflight';
import { FrameAnnotator } from './FrameAnnotator';
import { RichText } from './RichText';
import { AgentThread } from './AgentThread';
import { RunStatus } from './RunStatus';
import { AgentPicker } from './AgentPicker';
import * as Icons from '../ui/icons';
import { GapLog } from './GapLog';
import { useGapStore } from '../../store/gapStore';
import {
  Sparkle, X, ArrowUp, Cpu, ChevronDown, ChevronRight, Terminal, Trash2, Square, Activity, Check, AlertCircle, Loader2, Crosshair, Lightbulb, Eye, EyeOff,
} from '../ui/icons';

/** A keycap, so the hint line reads as keys rather than as punctuation. */
/** Display names for the selectable backends. */
const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  gemini: 'Gemini CLI',
  codex: 'Codex CLI',
  cursor: 'Cursor Agent',
};

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="px-1 h-[14px] inline-flex items-center rounded-[3px] border border-line bg-spectrum-sunken font-mono text-[9px] text-spectrum-textDim">
    {children}
  </kbd>
);

/**
 * Maps a quick action's icon NAME to the platform icon set.
 *
 * The names live in `agentBridge` (the portable engine layer, which
 * must not import React components) and are resolved here, in the
 * renderer, which is the layer that knows what an icon is.
 */
const QuickIcon: React.FC<{ name: string }> = ({ name }) => {
  const Cmp = (Icons as Record<string, React.ElementType>)[name];
  return Cmp ? <Cmp className="w-3.5 h-3.5 flex-shrink-0" /> : null;
};

export const CopilotDrawer: React.FC = () => {
  const isOpen = useProjectStore((s) => s.isCopilotOpen);
  const setCopilotOpen = useProjectStore((s) => s.setCopilotOpen);
  const copilotWidth = useLayoutStore((s) => s.copilotWidth);
  const setCopilotWidth = useLayoutStore((s) => s.setCopilotWidth);
  const followAgent = useLayoutStore((s) => s.followAgent);
  const toggleFollowAgent = useLayoutStore((s) => s.toggleFollowAgent);

  const {
    messages, currentRun, showThoughts, history,
    toggleThoughts, sendPrompt, cancelRun, clearChat,
    queue: chatQueue, unqueue: chatUnqueue, clearQueue: chatClearQueue,
  } = useAgentChatStore();

  /* The protocol depends on live editor state, so subscribe to the bits
     that can invalidate a pre-flight. */
  const playheadMs = useTimelineStore((s) => s.playheadMs);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const tracks = useTimelineStore((s) => s.tracks);

  const [input, setInput] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [frame, setFrame] = useState<CapturedFrame | null>(null);
  const [frameAttached, setFrameAttached] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isAnnotating, setAnnotating] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [gapLogOpen, setGapLogOpen] = useState(false);
  const [showMcpLog, setShowMcpLog] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /*
    A prompt typed while the agent is still working.

    Sending it immediately is not possible — one CLI session, one turn at
    a time — and throwing away what the user typed is worse. Holding it
    and firing when the turn ends means an interruption is never lost.
  */
  /*
    The queue lives in the stores now, not here. A single `useState`
    slot meant the SECOND thing you typed while the agent worked
    overwrote the first, silently — and it died with the drawer.
  */
  const openGaps = useGapStore((g) => g.gaps.filter((x) => !x.resolved).length);

  /*
    The Copilot prefers to BE Claude Code rather than imitate it. When the
    CLI is installed we hand the whole turn to it — it brings its own file,
    shell and web tools alongside Kerf's, which is the difference
    between "understands the phrasings I hardcoded" and "understands you".
    Without it we fall back to the built-in planner.
  */
  const agent = useClaudeAgentStore();
  /*
    Three states, not two. `status === null` means the check has not come
    back yet — and treating that as "not installed" made the drawer claim
    the CLI was missing during startup AND route the first prompt to the
    fallback planner. Unknown is not the same as absent.
  */
  const [agentLabel, setAgentLabel] = useState('Claude Code');
  const agentChecked = agent.status !== null;
  // Main reports which backend is selected; trust that over local state.
  const reportedLabel = agent.status?.label ?? agentLabel;
  const agentReady = Boolean(agent.status?.installed);

  useEffect(() => {
    void agent.refreshStatus();
    return agent.attach();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* ── Keep the attached frame in step with the playhead ──
     Compositing and JPEG-encoding a full frame is not cheap, so this waits
     for scrubbing to settle rather than re-encoding on every pointer move. */
  useEffect(() => {
    if (!frameAttached || isPlaying) return;

    const timer = window.setTimeout(() => {
      setFrame(captureCurrentFrame());
      // Marks were drawn against a different moment — re-resolve what they hit.
      setAnnotations((prev) => prev.map((a) => ({ ...a, targets: resolveAnnotationTargets(a) })));
    }, 180);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playheadMs, frameAttached, isPlaying, tracks]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, currentRun?.thoughts.length]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  /* Draining is the stores' job — they know when a run actually ends. */
  const queue = agentReady ? agent.queue : chatQueue;
  const unqueue = agentReady ? agent.unqueue : chatUnqueue;
  const clearQueue = agentReady ? agent.clearQueue : chatClearQueue;

  /* Esc stops the agent — the shortcut people reach for without thinking. */
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (agent.isRunning) { agent.stop(); e.preventDefault(); }
      else if (currentRun) { cancelRun(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, agent.isRunning, currentRun]);

  const attachFrame = useCallback(() => {
    const captured = captureCurrentFrame();
    setFrame(captured);
    setFrameAttached(true);
  }, []);

  const detachFrame = useCallback(() => {
    setFrameAttached(false);
    setAnnotations([]);
  }, []);

  /* ── Pre-flight, recomputed as the user types or the editor moves ── */
  const report = useMemo(
    () =>
      runPreflight({
        prompt: input,
        annotations: frameAttached ? annotations : [],
        frame,
        frameAttached,
        onAttachFrame: attachFrame,
      }),
    // Editor state is read inside runPreflight, so list the triggers explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input, annotations, frame, frameAttached, attachFrame, playheadMs, isPlaying, selectedClipIds, tracks]
  );

  if (!isOpen) return null;

  const hasPrompt = input.trim().length > 0;
  const blocked = hasPrompt && !report.ready;
  const busy = Boolean(currentRun) || agent.isRunning;

  /* Calls made so far in the turn that is running right now. */
  const runningToolCalls = agent.turns.length
    ? agent.turns[agent.turns.length - 1].toolCalls.length
    : 0;

  /*
    The intro already offers examples, so the pill row would be a second
    menu of the same thing stacked under the first. Pills are for LATER —
    once there is a conversation above them and the intro is gone.
  */
  const threadEmpty = agentReady ? agent.turns.length === 0 : messages.length === 0;
  const showSuggestions = !busy && !hasPrompt && !threadEmpty;

  /*
    Send never dead-ends.

    A disabled button with no explanation is the worst possible answer to
    "your context is not ready" — the user types, presses Enter, and
    nothing happens at all. Every blocker the pre-flight raises already
    carries a one-click remedy, so pressing Send applies them and goes.
    Only if something still cannot be resolved automatically do we stop,
    and then we open the pre-flight so the reason is on screen.
  */
  const submit = async () => {
    const text = input.trim();
    if (!text) return;

    /* Busy: hold it rather than swallow the keypress. The stores queue
       it and drain it when the run ends. */
    if (currentRun || agent.isRunning) {
      if (agentReady) void agent.send(text);
      else void sendPrompt(text);
      setInput('');
      setHistoryIndex(-1);
      return;
    }

    /*
      Never fall back on an unknown. If the CLI check has not returned
      yet, wait for it — sending to the built-in planner because the
      answer had not arrived is how a user with Claude Code installed
      got the regex planner for typing quickly after launch.
    */
    let ready = agentReady;
    if (!agentChecked) {
      await agent.refreshStatus();
      ready = Boolean(useClaudeAgentStore.getState().status?.installed);
    }

    if (ready) {
      setInput('');
      setHistoryIndex(-1);
      await agent.send(text);
      return;
    }

    let liveFrame = frame;
    let liveAttached = frameAttached;

    if (!report.ready) {
      for (const issue of report.issues) {
        if (issue.severity !== 'blocker') continue;
        if (issue.id === 'no-frame') {
          // Resolve locally too: setState is async and we need it this tick.
          liveFrame = captureCurrentFrame();
          liveAttached = true;
          setFrame(liveFrame);
          setFrameAttached(true);
        } else {
          issue.fix?.();
        }
      }

      // Re-check against the now-updated stores plus the frame we just took.
      const recheck = runPreflight({
        prompt: text,
        annotations: liveAttached ? annotations : [],
        frame: liveFrame,
        frameAttached: liveAttached,
        onAttachFrame: attachFrame,
      });

      if (!recheck.ready) {
        setPreflightOpen(true);
        return;
      }
    }

    const envelope = buildEnvelope({
      annotations: liveAttached ? annotations : [],
      frame: liveFrame,
      includeFrame: liveAttached,
    });

    setInput('');
    setHistoryIndex(-1);
    await sendPrompt(text, envelope);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
      return;
    }
    if (e.key === 'ArrowUp' && (input === '' || historyIndex >= 0)) {
      e.preventDefault();
      const next = Math.min(history.length - 1, historyIndex + 1);
      if (history[history.length - 1 - next] !== undefined) {
        setHistoryIndex(next);
        setInput(history[history.length - 1 - next]);
      }
    }
    if (e.key === 'ArrowDown' && historyIndex >= 0) {
      e.preventDefault();
      const next = historyIndex - 1;
      setHistoryIndex(next);
      setInput(next < 0 ? '' : history[history.length - 1 - next]);
    }
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = copilotWidth;
    const move = (ev: PointerEvent) => setCopilotWidth(startWidth + (startX - ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <aside
      style={{ width: copilotWidth }}
      className="relative flex-shrink-0 bg-spectrum-panel border-l border-line flex flex-col h-full z-40 animate-slide-in-right"
    >
      <div onPointerDown={startResize} className="absolute left-0 top-0 bottom-0 w-1 -ml-0.5 cursor-col-resize hover:bg-spectrum-accent/60 z-10" />

      {/* Header */}
      <div className="panel-header">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkle className="w-3.5 h-3.5 text-spectrum-accent flex-shrink-0" />
          <span className="text-ui font-semibold text-spectrum-text flex-shrink-0">Copilot</span>
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1 flex-shrink-0 min-w-0 rounded-[4px] px-1 -mx-1 hover:bg-white/[0.05] transition-colors"
            title={
              !agentChecked
                ? 'Looking for the Claude Code CLI…'
                : agentReady
                  ? `Claude Code ${agent.status?.version ?? ''}, full agent, with file, shell and web access`
                  : 'Claude Code CLI not found, using the built-in planner'
            }
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                !agentChecked ? 'bg-spectrum-textFaint animate-pulse'
                  : agentReady ? 'bg-spectrum-green'
                  : 'bg-spectrum-amber'
              }`}
            />
            <span className="text-[9px] font-mono text-spectrum-textFaint truncate">
              {!agentChecked ? 'checking…' : agentReady ? reportedLabel : 'built-in'}
            </span>
            <ChevronDown className="w-2.5 h-2.5 text-spectrum-textFaint flex-shrink-0" />
          </button>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {openGaps > 0 && (
            <button
              onClick={() => setGapLogOpen(true)}
              className="h-[20px] px-1.5 rounded-[5px] border border-spectrum-amber/35 bg-spectrum-amber/10 text-spectrum-amber text-[10px] font-medium flex items-center gap-1 mr-1"
              title={`${openGaps} thing${openGaps === 1 ? '' : 's'} asked for that Kerf cannot do yet`}
            >
              <Lightbulb className="w-2.5 h-2.5" />
              {openGaps}
            </button>
          )}
          <button
            onClick={toggleFollowAgent}
            className={`pro-btn w-[22px] h-[22px] ${followAgent ? 'text-spectrum-accent' : ''}`}
            title={
              followAgent
                ? 'The editor follows the Copilot. Panels, selection and playhead move with its work. Click to stop following.'
                : 'The editor stays put while the Copilot works. Click to follow along.'
            }
          >
            {followAgent ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          </button>
          <button
            onClick={() => setShowMcpLog((v) => !v)}
            className={`pro-btn w-[22px] h-[22px] ${showMcpLog ? 'text-spectrum-green' : ''}`}
            title={showMcpLog ? 'Hide the raw MCP call log' : 'Show the raw MCP call log'}
          >
            <Activity className="w-3 h-3" />
          </button>
          <button
            onClick={() => { clearChat(); agent.clear(); }}
            className="pro-btn w-[22px] h-[22px]"
            title="Clear the conversation"
          >
            <Trash2 className="w-3 h-3" />
          </button>
          <button onClick={() => setCopilotOpen(false)} className="pro-btn w-[22px] h-[22px]" title="Close">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Live context strip — always shows what "here" currently means */}
      <ContextStrip
        frameAttached={frameAttached}
        annotationCount={frameAttached ? annotations.length : 0}
      />

      {/*
        There used to be a four-option model picker here — Antigravity /
        Claude Code / Codex Sonnet / Local LLM. It chose nothing.
        `configureModelEndpoint` is defined and never called, so picking
        "Local LLM" changed one string in a log and no behaviour at all.
        A control that does nothing is worse than no control: it makes a
        user believe they configured something.
      */}
      {agentChecked && !agentReady && (
        <div className="px-2.5 py-1.5 border-b border-line flex items-center gap-1.5 flex-shrink-0 bg-spectrum-sunken/40">
          <Cpu className="w-3 h-3 text-spectrum-amber flex-shrink-0" />
          <span className="text-[10px] text-spectrum-textDim truncate">
            Built-in planner · pattern matching, no model
          </span>
        </div>
      )}

      {/*
        Live status — the one line that says whether this thing is working
        and on what, without scrolling the thread.
      */}
      {agent.isRunning && (
        <RunStatus
          activity={agent.activity}
          startedAt={agent.startedAt}
          toolCalls={runningToolCalls}
          costUsd={undefined}
          onStop={agent.stop}
        />
      )}

      {/* Live run (built-in planner) */}
      {currentRun && (
        <div className="px-2.5 py-2 bg-spectrum-card border-b border-line space-y-1.5 flex-shrink-0 animate-fade-in">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Loader2 className="w-3 h-3 text-spectrum-accent animate-spin flex-shrink-0" />
              <span className="text-[10px] font-mono text-spectrum-accent truncate">
                {currentRun.currentActivity}
              </span>
            </div>
            <button onClick={cancelRun} className="btn-ghost-danger h-5 px-1.5 gap-1 text-[9px] flex-shrink-0">
              <Square className="w-2 h-2 fill-current" /> Stop
            </button>
          </div>
          <div className="h-1 rounded-full bg-spectrum-sunken overflow-hidden">
            <div
              className="h-full bg-spectrum-accent rounded-full transition-[width] duration-300"
              style={{ width: `${currentRun.progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Thread */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[96px]">
        {agentReady ? (
          agent.turns.length === 0 ? (
            <AgentIntro onPick={(text) => { setInput(text); inputRef.current?.focus(); }} />
          ) : (
            <AgentThread turns={agent.turns} />
          )
        ) : (
          <>
            <CliMissingNotice status={agent.status} />
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col gap-1 min-w-0 ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
            <div className="flex items-center gap-1.5 px-0.5 text-[9px] text-spectrum-textFaint font-mono">
              {msg.sender === 'user' ? (
                <span>You</span>
              ) : (
                <span className="flex items-center gap-1 text-spectrum-accent">
                  <Terminal className="w-2.5 h-2.5" />
                  BUILT-IN PLANNER
                </span>
              )}
            </div>

            {/* What the agent was actually given */}
            {msg.sender === 'user' && msg.context && (
              <div className="max-w-[94%] w-full flex flex-col items-end gap-1">
                {msg.context.frame?.dataUrl && !msg.context.frame.unavailableReason && (
                  <img
                    src={msg.context.frame.dataUrl}
                    alt={`Frame at ${msg.context.frame.timecode}`}
                    className="rounded-squircle-xs border border-line max-w-[190px]"
                  />
                )}
                <span className="chip !text-[9px] font-mono">
                  <Crosshair className="w-2.5 h-2.5" />
                  {summariseEnvelope(msg.context)}
                </span>
              </div>
            )}

            <div
              className={`rounded-squircle-sm text-ui leading-relaxed max-w-full min-w-0 ${
                msg.sender === 'user'
                  ? 'bg-spectrum-accent text-white px-2.5 py-2 font-medium'
                  : 'bg-spectrum-card border border-line text-spectrum-text px-2.5 py-2'
              }`}
            >
              {msg.thoughts && msg.thoughts.length > 0 && (
                <ThoughtChain thoughts={msg.thoughts} expanded={showThoughts} onToggle={toggleThoughts} />
              )}
              {msg.text ? (
                <RichText text={msg.text} />
              ) : (
                <span className="text-spectrum-textDim italic">Thinking…</span>
              )}
            </div>
          </div>
        ))}
          </>
        )}
        <div ref={endRef} />
      </div>

      {/*
        The raw MCP log is off by default now. Every call already appears
        in the thread, grouped and readable; a second permanently-visible
        copy of the same information was costing vertical space the
        conversation needed more.
      */}
      {showMcpLog && (
        <div className="border-t border-line flex-shrink-0 animate-fade-in">
          <div className="px-2.5 py-1 flex items-center gap-1 text-[9px] font-semibold text-spectrum-textDim uppercase tracking-wider">
            <Activity className="w-2.5 h-2.5 text-spectrum-green" /> Live MCP calls
          </div>
          <McpActivityLog />
        </div>
      )}

      {/* Composer */}
      <div className="p-2 border-t border-line flex-shrink-0 space-y-2 max-h-[52vh] overflow-y-auto">
        {/*
          Queued prompts, shown as themselves.

          A count alone would repeat the old mistake in a quieter way:
          the point of queueing is that you can keep thinking out loud
          while the agent works, and you cannot do that if you cannot
          see — or take back — what you have already lined up.
        */}
        {queue.length > 0 && (
          <div className="space-y-1">
            {queue.map((q, i) => (
              <div
                key={`${i}-${q.slice(0, 24)}`}
                className="group flex items-start gap-1.5 rounded-squircle-sm border border-spectrum-accentLine/40
                           bg-spectrum-accent/[0.07] px-2 py-1"
              >
                <span className="mt-[3px] text-[9px] font-mono text-spectrum-accent tabular-nums">
                  {i + 1}
                </span>
                <span className="flex-1 min-w-0 text-[11px] text-spectrum-textDim leading-snug break-words">
                  {q}
                </span>
                <button
                  onClick={() => unqueue(i)}
                  title="Remove from the queue"
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded
                             hover:bg-spectrum-sunken text-spectrum-textFaint hover:text-spectrum-text"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            {queue.length > 1 && (
              <button
                onClick={clearQueue}
                className="text-[9px] text-spectrum-textFaint hover:text-spectrum-text px-1"
              >
                Clear all {queue.length}
              </button>
            )}
          </div>
        )}

        {hasPrompt && !agentReady && (
          <ContextPreflight
            report={report}
            forceOpen={preflightOpen}
            frame={frame}
            frameAttached={frameAttached}
            annotations={annotations}
            onToggleFrame={frameAttached ? detachFrame : attachFrame}
            onAnnotate={() => {
              if (!frameAttached) attachFrame();
              setAnnotating(true);
            }}
            onClearAnnotations={() => setAnnotations([])}
          />
        )}

        {/*
          Suggestions live next to the box, and only when there is nothing
          to read above them. As a permanent strip they pushed the
          conversation down the panel forever to save one sentence of
          typing on the first prompt only.
        */}
        {showSuggestions && (
          <div className="relative">
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none pb-0.5">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  onClick={() => { setInput(action.prompt); inputRef.current?.focus(); }}
                  className="h-[24px] px-2 gap-1.5 text-ui-xs whitespace-nowrap flex-shrink-0 flex items-center
                             rounded-full border border-line text-spectrum-textMuted
                             hover:border-spectrum-accentLine hover:text-spectrum-text transition-colors"
                  title={`${action.prompt}, loads into the box so you can check the context first`}
                >
                  <QuickIcon name={action.icon} />
                  {action.label}
                </button>
              ))}
            </div>
            <div className="absolute right-0 top-0 bottom-0 w-8 pointer-events-none bg-gradient-to-l from-spectrum-panel to-transparent" />
          </div>
        )}

        <div className="pro-input flex items-end gap-1.5 p-1.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); if (preflightOpen) setPreflightOpen(false); }}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={
              busy
                ? 'Working… ⌘⏎ to queue this next'
                : agentReady || !agentChecked
                  ? 'Ask anything, or tell me what to change…'
                  : 'Tell me what to change…'
            }
            className="flex-1 bg-transparent outline-none text-[12px] text-spectrum-text placeholder:text-spectrum-textFaint resize-none max-h-28 min-w-0 leading-snug py-0.5"
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(112, el.scrollHeight)}px`;
            }}
          />
          {busy ? (
            <button
              onClick={agent.isRunning ? agent.stop : cancelRun}
              className="btn-ghost-danger w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center"
              title="Stop the agent (Esc)"
            >
              <Square className="w-3 h-3 fill-current" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!hasPrompt}
              className="btn-primary w-7 h-7 rounded-full flex-shrink-0"
              title={blocked ? 'Fix the context checks and send (Enter)' : 'Send (Enter)'}
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 px-1 text-[9px] text-spectrum-textFaint leading-snug flex-wrap">
          {queue.length > 0 ? (
            <span className="text-spectrum-accent">
              {queue.length === 1 ? '1 message queued' : `${queue.length} messages queued`}
              {', they send in order as each turn finishes.'}
            </span>
          ) : blocked && !agentReady ? (
            <span>Send will sort the checks above first, then run this.</span>
          ) : (
            <>
              <Kbd>⏎</Kbd><span>send</span>
              <Kbd>⇧⏎</Kbd><span>new line</span>
              <Kbd>↑</Kbd><span>history</span>
              {busy && (<><Kbd>esc</Kbd><span>stop</span></>)}
            </>
          )}
        </div>
      </div>

      {pickerOpen && (
        <AgentPicker
          onClose={() => setPickerOpen(false)}
          onSelected={(id) => {
            setAgentLabel(AGENT_LABELS[id] ?? id);
            void agent.refreshStatus();
            // A session id belongs to the CLI that made it, so the next
            // turn starts fresh rather than trying to resume someone
            // else's conversation.
            agent.clear();
            setPickerOpen(false);
          }}
        />
      )}

      {gapLogOpen && <GapLog onClose={() => setGapLogOpen(false)} />}

      {isAnnotating && frame && (
        <FrameAnnotator
          frame={frame}
          initial={annotations}
          onClose={() => setAnnotating(false)}
          onConfirm={(next) => {
            setAnnotations(next);
            setFrameAttached(true);
            setAnnotating(false);
          }}
        />
      )}
    </aside>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Empty states
   ═══════════════════════════════════════════════════════════════════ */

const EXAMPLES = [
  { text: 'What is on my timeline right now?', hint: 'reads the edit' },
  { text: 'Import the newest video from my Downloads', hint: 'uses your files' },
  { text: 'Cut the silence out of the dialogue', hint: 'edits the timeline' },
  { text: 'Give the whole thing a warm cinematic grade', hint: 'grades every clip' },
];

const AgentIntro: React.FC<{ onPick: (text: string) => void }> = ({ onPick }) => (
  <div className="pt-1 space-y-3">
    <div className="space-y-1.5">
      <p className="text-ui-lg text-spectrum-text font-semibold">Claude Code is driving this editor.</p>
      <p className="text-ui-sm text-spectrum-textMuted leading-relaxed">
        It can read your timeline and change it, and it brings its own tools too. Your files,
        the shell, the web. Ask in plain language; it will show you every step it takes.
      </p>
    </div>

    <div className="space-y-1">
      {EXAMPLES.map((example) => (
        <button
          key={example.text}
          onClick={() => onPick(example.text)}
          className="w-full text-left rounded-squircle-xs border border-line/70 bg-spectrum-sunken/40
                     px-2 py-1 hover:border-spectrum-accentLine hover:bg-spectrum-card/60
                     transition-colors group"
        >
          <span className="block text-ui-sm text-spectrum-textMuted group-hover:text-spectrum-text transition-colors">
            {example.text}
          </span>
          <span className="block text-[9px] font-mono text-spectrum-textFaint mt-0.5">{example.hint}</span>
        </button>
      ))}
    </div>
  </div>
);

const CliMissingNotice: React.FC<{ status: { installed: boolean } | null }> = ({ status }) => {
  // Null means we have not checked yet — say nothing rather than accuse.
  if (status === null || status.installed) return null;

  return (
    <div className="rounded-squircle-sm border border-spectrum-amber/35 bg-spectrum-amber/[0.06] p-2.5 space-y-1.5">
      <p className="text-ui-sm font-medium text-spectrum-text">Running on the built-in planner</p>
      <p className="text-[10px] text-spectrum-textDim leading-relaxed">
        It understands common editing phrasings, but it cannot hold a conversation or touch
        your files. Install the Claude Code CLI and reopen Kerf to get the full agent:
      </p>
      <code className="block text-[10px] font-mono text-spectrum-accent bg-black/30 rounded-[3px] px-1.5 py-1">
        npm i -g @anthropic-ai/claude-code
      </code>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Live context strip
   ═══════════════════════════════════════════════════════════════════ */

const ContextStrip: React.FC<{ frameAttached: boolean; annotationCount: number }> = ({
  frameAttached, annotationCount,
}) => {
  const playheadMs = useTimelineStore((s) => s.playheadMs);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const fps = useProjectStore((s) => s.project.fps);

  const target = useTimelineStore((s) => {
    const id = s.selectedClipIds[0];
    if (!id) return null;
    for (const t of s.tracks) {
      const c = t.clips.find((x) => x.id === id);
      if (c) return c.name;
    }
    return null;
  });

  const frameNumber = Math.round((playheadMs / 1000) * fps);
  const timecode = new Date(0);

  return (
    <div className="px-2.5 py-1.5 border-b border-line bg-spectrum-sunken/60 flex items-center gap-2 flex-shrink-0 overflow-hidden">
      <Crosshair className={`w-3 h-3 flex-shrink-0 ${isPlaying ? 'text-spectrum-amber' : 'text-spectrum-green'}`} />
      <span className="text-[10px] font-mono text-spectrum-textMuted tabular flex-shrink-0">
        {formatClock(playheadMs, fps)} · f{frameNumber}
      </span>
      <span className="text-[9px] text-spectrum-textFaint truncate flex-1 min-w-0">
        {isPlaying
          ? 'playing, pause to lock a frame'
          : target
            ? `target: ${target}`
            : 'no layer selected'}
      </span>
      {frameAttached && (
        <span className="chip !text-[9px] !text-spectrum-accent !border-spectrum-accentLine flex-shrink-0">
          frame{annotationCount > 0 ? ` +${annotationCount}` : ''}
        </span>
      )}
    </div>
  );
};

function formatClock(ms: number, fps: number): string {
  const total = Math.floor(ms / 1000);
  const f = Math.floor((ms % 1000) / (1000 / fps));
  const pad = (n: number) => String(Math.abs(Math.floor(n))).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}:${pad(f)}`;
}

/* ═══════════════════════════════════════════════════════════════════
   Reasoning stream
   ═══════════════════════════════════════════════════════════════════ */

const ThoughtChain: React.FC<{
  thoughts: AgentThoughtStep[];
  expanded: boolean;
  onToggle: () => void;
}> = ({ thoughts, expanded, onToggle }) => {
  const toolCalls = thoughts.filter((t) => t.toolName);

  return (
    <div className="mb-2 rounded-squircle-xs border border-line overflow-hidden bg-spectrum-sunken">
      <button
        onClick={onToggle}
        className="w-full px-2 py-1 flex items-center justify-between text-[9px] font-mono text-spectrum-textDim hover:text-spectrum-text transition-colors"
      >
        <span className="flex items-center gap-1 text-spectrum-accent font-medium">
          {toolCalls.length > 0 ? `${toolCalls.length} tool call${toolCalls.length === 1 ? '' : 's'}` : `${thoughts.length} step${thoughts.length === 1 ? '' : 's'}`}
        </span>
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {expanded && (
        <div className="px-2 py-1.5 space-y-1 max-h-52 overflow-y-auto border-t border-line">
          {thoughts.map((step) => (
            <div key={step.id} className="text-[10px] font-mono leading-snug">
              {step.toolName ? (
                <div className="space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`flex items-center gap-1 font-medium ${step.ok ? 'text-spectrum-green' : 'text-spectrum-red'}`}>
                      {step.ok ? <Check className="w-2.5 h-2.5" /> : <AlertCircle className="w-2.5 h-2.5" />}
                      {step.toolName}
                    </span>
                    {step.durationMs !== undefined && (
                      <span className="text-[9px] text-spectrum-textFaint tabular flex-shrink-0">{step.durationMs}ms</span>
                    )}
                  </div>
                  <p className="text-spectrum-textDim pl-3.5">{step.content}</p>
                  {!step.ok && step.toolResult !== undefined && (
                    <p className="text-spectrum-red/80 pl-3.5 break-words">{formatToolError(step.toolResult)}</p>
                  )}
                </div>
              ) : (
                <p className={
                  step.type === 'error' ? 'text-spectrum-amber italic'
                  : step.type === 'status' ? 'text-spectrum-accent'
                  : 'text-spectrum-textDim italic'
                }>
                  {step.content}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/** Tool errors arrive as strings or objects; render either readably. */
function formatToolError(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object' && 'error' in result) {
    return String((result as { error: unknown }).error);
  }
  return JSON.stringify(result);
}
