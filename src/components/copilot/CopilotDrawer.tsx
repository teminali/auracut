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
import {
  Sparkles, X, ArrowUp, Cpu, ChevronDown, ChevronRight, Terminal,
  Trash2, Square, Activity, Check, AlertCircle, Loader2, Crosshair,
} from 'lucide-react';

const MODELS: { value: string; label: string; hint: string }[] = [
  { value: 'antigravity', label: 'Antigravity Agent', hint: 'IDE-connected' },
  { value: 'claude_code', label: 'Claude Code', hint: 'Terminal agent' },
  { value: 'codex_sonnet', label: 'Codex Sonnet', hint: 'Hosted' },
  { value: 'local_llm', label: 'Local LLM', hint: 'Ollama / MLX' },
];

export const CopilotDrawer: React.FC = () => {
  const isOpen = useProjectStore((s) => s.isCopilotOpen);
  const setCopilotOpen = useProjectStore((s) => s.setCopilotOpen);
  const copilotWidth = useLayoutStore((s) => s.copilotWidth);
  const setCopilotWidth = useLayoutStore((s) => s.setCopilotWidth);

  const {
    messages, currentRun, selectedModel, showThoughts, history,
    setSelectedModel, toggleThoughts, sendPrompt, cancelRun, clearChat,
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

  /*
    The Copilot prefers to BE Claude Code rather than imitate it. When the
    CLI is installed we hand the whole turn to it — it brings its own file,
    shell and web tools alongside AuraCut's, which is the difference
    between "understands the phrasings I hardcoded" and "understands you".
    Without it we fall back to the built-in planner.
  */
  const agent = useClaudeAgentStore();
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
    if (!text || currentRun || agent.isRunning) return;

    if (agentReady) {
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
          <Sparkles className="w-3.5 h-3.5 text-spectrum-accent flex-shrink-0" />
          <span className="text-ui font-semibold text-spectrum-text flex-shrink-0">Copilot</span>
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${agentReady ? 'bg-spectrum-green' : 'bg-spectrum-amber'}`}
            title={
              agentReady
                ? `Claude Code ${agent.status?.version ?? ''} — full agent`
                : 'Claude Code CLI not found — using the built-in planner'
            }
          />
          {agentReady && (
            <span className="text-[9px] font-mono text-spectrum-textFaint truncate">Claude Code</span>
          )}
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
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

      {/* Model — only the built-in planner has a model to choose. */}
      <div className={`px-2 py-1.5 border-b border-line flex items-center gap-1.5 flex-shrink-0 ${agentReady ? 'hidden' : ''}`}>
        <Cpu className="w-3.5 h-3.5 text-spectrum-textDim flex-shrink-0" />
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value as any)}
          className="pro-input select-native flex-1 h-[26px] px-2 text-ui-sm cursor-pointer min-w-0"
        >
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>{m.label} · {m.hint}</option>
          ))}
        </select>
      </div>

      {/*
        Quick actions scroll horizontally. The fade on the right edge is not
        decoration — without it a cut-off chip reads as a broken layout
        rather than as "there is more this way".
      */}
      <div className="relative flex-shrink-0 border-b border-line">
        <div className="px-2 py-2 flex items-center gap-1 overflow-x-auto scrollbar-none">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              onClick={() => { setInput(action.prompt); inputRef.current?.focus(); }}
              disabled={!!currentRun}
              className="pro-btn-filled h-[26px] px-2 gap-1.5 text-ui-xs whitespace-nowrap flex-shrink-0"
              title={`${action.prompt} — loads into the box so you can check the context first`}
            >
              <span>{action.icon}</span>
              {action.label}
            </button>
          ))}
        </div>
        <div className="absolute right-0 top-0 bottom-0 w-8 pointer-events-none bg-gradient-to-l from-spectrum-panel to-transparent" />
      </div>

      {/* Agent activity */}
      {agent.isRunning && (
        <div className="px-2.5 py-2 bg-spectrum-card border-b border-line flex items-center justify-between gap-2 flex-shrink-0 animate-fade-in">
          <div className="flex items-center gap-1.5 min-w-0">
            <Loader2 className="w-3 h-3 text-spectrum-accent animate-spin flex-shrink-0" />
            <span className="text-[10px] font-mono text-spectrum-accent truncate">
              {agent.activity || 'Working…'}
            </span>
          </div>
          <button onClick={agent.stop} className="btn-ghost-danger h-5 px-1.5 gap-1 text-[9px] flex-shrink-0">
            <Square className="w-2 h-2 fill-current" /> Stop
          </button>
        </div>
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
            <AgentIntro />
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
                  {msg.agentModel?.replace('_', ' ').toUpperCase() ?? 'AGENT'}
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

      {/* MCP log */}
      <div className="border-t border-line flex-shrink-0">
        <div className="px-2.5 py-1 flex items-center gap-1 text-[9px] font-semibold text-spectrum-textDim uppercase tracking-wider">
          <Activity className="w-2.5 h-2.5 text-spectrum-green" /> Live MCP calls
        </div>
        <McpActivityLog />
      </div>

      {/* Composer */}
      <div className="p-2 border-t border-line flex-shrink-0 space-y-2 max-h-[52vh] overflow-y-auto">
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

        <div className="pro-input flex items-end gap-1.5 p-1.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); if (preflightOpen) setPreflightOpen(false); }}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={agentReady ? 'Ask, or tell me what to change…' : 'Tell me what to change…'}
            disabled={!!currentRun}
            className="flex-1 bg-transparent outline-none text-[12px] text-spectrum-text placeholder:text-spectrum-textFaint resize-none max-h-24 min-w-0 leading-snug py-0.5"
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(96, el.scrollHeight)}px`;
            }}
          />
          <button
            onClick={submit}
            disabled={!!currentRun || agent.isRunning || !hasPrompt}
            className="btn-primary w-7 h-7 rounded-full flex-shrink-0"
            title={blocked ? 'Fix the context checks and send (Enter)' : 'Send (Enter)'}
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>

        <p className="text-[10px] text-spectrum-textFaint px-1 leading-snug">
          {agentReady
            ? 'Enter to send · ⇧Enter for a new line · full file, shell and web access'
            : blocked
              ? 'Send will sort the checks above first, then run this.'
              : 'Enter to send · ⇧Enter for a new line · ↑ for the last prompt'}
        </p>
      </div>

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

const AgentIntro: React.FC = () => (
  <div className="space-y-2.5 text-ui-sm text-spectrum-textMuted leading-relaxed">
    <p className="text-spectrum-text font-medium">Claude Code is driving this editor.</p>
    <p>
      It can see your timeline and change it, and it has its own tools too — reading files,
      downloading, searching the web.
    </p>
    <div className="space-y-1.5 pt-1">
      {[
        'import the newest video from my Downloads',
        'cut the silence out of the dialogue',
        'give the whole thing a warm cinematic grade',
        'what is on my timeline right now?',
      ].map((example) => (
        <div key={example} className="flex gap-1.5">
          <span className="text-spectrum-textFaint flex-shrink-0">›</span>
          <span className="italic">{example}</span>
        </div>
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
        your files. Install the Claude Code CLI and reopen AuraCut to get the full agent:
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
          ? 'playing — pause to lock a frame'
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
