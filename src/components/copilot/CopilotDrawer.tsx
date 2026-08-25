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

  const submit = async () => {
    const text = input.trim();
    if (!text || currentRun || !report.ready) return;

    const envelope = buildEnvelope({
      annotations: frameAttached ? annotations : [],
      frame,
      includeFrame: frameAttached,
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
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles className="w-3.5 h-3.5 text-spectrum-accent flex-shrink-0" />
          <span className="text-[12px] font-semibold text-spectrum-text">AI Copilot</span>
          <span className={`chip !text-[9px] flex-shrink-0 ${hasModelEndpoint() ? '!text-spectrum-green !border-spectrum-green/30' : ''}`}>
            {hasModelEndpoint() ? 'model linked' : 'local planner'}
          </span>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button onClick={clearChat} className="pro-btn w-6 h-6" title="Clear the conversation">
            <Trash2 className="w-3 h-3" />
          </button>
          <button onClick={() => setCopilotOpen(false)} className="pro-btn w-6 h-6" title="Close">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Live context strip — always shows what "here" currently means */}
      <ContextStrip
        frameAttached={frameAttached}
        annotationCount={frameAttached ? annotations.length : 0}
      />

      {/* Model */}
      <div className="px-2.5 py-2 border-b border-line flex items-center gap-2 flex-shrink-0">
        <Cpu className="w-3.5 h-3.5 text-spectrum-textDim flex-shrink-0" />
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value as any)}
          className="pro-input flex-1 h-7 px-2 text-[11px] cursor-pointer min-w-0"
        >
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>{m.label} · {m.hint}</option>
          ))}
        </select>
      </div>

      {/* Quick actions */}
      <div className="px-2 py-2 border-b border-line flex items-center gap-1 overflow-x-auto scrollbar-none flex-shrink-0">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.label}
            onClick={() => setInput(action.prompt)}
            disabled={!!currentRun}
            className="pro-btn-filled h-6 px-2 gap-1 text-[10px] whitespace-nowrap flex-shrink-0"
            title={`${action.prompt} — loads into the box so you can check the context first`}
          >
            <span>{action.icon}</span>
            {action.label}
          </button>
        ))}
      </div>

      {/* Live run */}
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
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col gap-1 ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
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
              className={`rounded-squircle-sm text-[12px] leading-relaxed max-w-[94%] ${
                msg.sender === 'user'
                  ? 'bg-spectrum-accent text-white px-2.5 py-2 font-medium'
                  : 'bg-spectrum-card border border-line text-spectrum-text px-2.5 py-2'
              }`}
            >
              {msg.thoughts && msg.thoughts.length > 0 && (
                <ThoughtChain thoughts={msg.thoughts} expanded={showThoughts} onToggle={toggleThoughts} />
              )}
              {msg.text ? (
                <div className="whitespace-pre-wrap break-words">{msg.text}</div>
              ) : (
                <span className="text-spectrum-textDim italic">Thinking…</span>
              )}
            </div>
          </div>
        ))}
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
        {hasPrompt && (
          <ContextPreflight
            report={report}
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
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Tell me what to change…"
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
            disabled={!!currentRun || !hasPrompt || blocked}
            className="btn-primary w-6 h-6 rounded-full flex-shrink-0"
            title={blocked ? 'Resolve the context checks first' : 'Send (Enter)'}
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
        </div>

        <p className="text-[9px] text-spectrum-textFaint px-1">
          {blocked
            ? 'Sort the checks above and I will run this with no guesswork.'
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
          {toolCalls.length > 0 ? `${toolCalls.length} tool call${toolCalls.length === 1 ? '' : 's'}` : `${thoughts.length} steps`}
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
