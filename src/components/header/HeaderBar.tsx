/* ═══════════════════════════════════════════════════════════════════
   Title bar.

   This is the OS titlebar, not a web navbar: the whole strip drags the
   window, a platform-sized gutter keeps the macOS traffic lights clear,
   and every control opts back out of the drag region.

   Layout is three fixed zones — identity, sequence format, actions —
   so nothing reflows as the project name or timecode changes width.
   ═══════════════════════════════════════════════════════════════════ */

import React, { useState, useRef } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { AspectRatio, ASPECT_DIMENSIONS } from '../../types/edl';
import { formatTimecode } from '../../utils/time';
import { McpStatusModal } from './McpStatusModal';
import { serializeProject, deserializeProject } from '../../engine/projectIO';
import { UpdateIndicator } from './UpdateIndicator';
import {
  Sparkles, Download, Undo2, Redo2, Command, Save, FolderOpen, Keyboard,
} from 'lucide-react';

/** A hairline rule between control clusters. */
const Divider: React.FC = () => <div className="w-px h-4 bg-line flex-shrink-0" />;

export const HeaderBar: React.FC = () => {
  const playheadMs = useTimelineStore((s) => s.playheadMs);
  const historyIndex = useTimelineStore((s) => s.historyIndex);
  const historyLength = useTimelineStore((s) => s.history.length);
  const lastLabel = useTimelineStore((s) => s.history[s.historyIndex]?.label);
  const undo = useTimelineStore((s) => s.undo);
  const redo = useTimelineStore((s) => s.redo);

  const project = useProjectStore((s) => s.project);
  const isCopilotOpen = useProjectStore((s) => s.isCopilotOpen);
  const setCopilotOpen = useProjectStore((s) => s.setCopilotOpen);
  const setExportModalOpen = useProjectStore((s) => s.setExportModalOpen);
  const setAspectRatio = useProjectStore((s) => s.setAspectRatio);
  const setProjectName = useProjectStore((s) => s.setProjectName);
  const setFps = useProjectStore((s) => s.setFps);

  const openCommandPalette = useUiStore((s) => s.openCommandPalette);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const pushToast = useUiStore((s) => s.pushToast);

  const [isMcpOpen, setMcpOpen] = useState(false);
  const [isEditingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(project.name);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const commitTitle = () => {
    setEditingTitle(false);
    if (titleDraft.trim()) setProjectName(titleDraft.trim());
    else setTitleDraft(project.name);
  };

  const saveProject = () => {
    const json = serializeProject();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.name.replace(/[^\w\-]+/g, '_')}.auracut.json`;
    link.click();
    URL.revokeObjectURL(url);
    pushToast({ kind: 'success', title: 'Project saved', detail: link.download });
  };

  const loadProject = async (file: File) => {
    try {
      const result = deserializeProject(await file.text());
      pushToast({
        kind: result.ok ? 'success' : 'error',
        title: result.ok ? 'Project loaded' : 'Could not load that file',
        detail: result.ok ? file.name : result.error,
      });
    } catch (err) {
      pushToast({ kind: 'error', title: 'Could not read the file', detail: (err as Error).message });
    }
  };

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < historyLength - 1;

  return (
    <header
      className="titlebar-drag h-10 flex-shrink-0 bg-spectrum-panelHeader border-b border-line flex items-center gap-3 pr-3 z-30"
    >
      {/* Window-control gutter — macOS only, sized by --titlebar-inset. */}
      <div className="titlebar-gutter" />

      {/* ── Identity ── */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex items-center gap-2 flex-shrink-0">
          <div
            className="w-[22px] h-[22px] rounded-[5px] flex items-center justify-center shadow-raised"
            style={{ background: 'linear-gradient(145deg,#6ba5ff,#3a6ff0)' }}
          >
            {/* A play triangle reads as "editor" faster than a lettermark. */}
            <svg viewBox="0 0 24 24" className="w-3 h-3" fill="#fff">
              <path d="M7 4.5v15l13-7.5z" />
            </svg>
          </div>
          <span className="font-semibold tracking-tight text-ui-lg text-spectrum-text">AuraCut</span>
        </div>

        <Divider />

        {isEditingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') { setTitleDraft(project.name); setEditingTitle(false); }
            }}
            className="pro-input h-[26px] px-2 text-ui font-medium w-52"
          />
        ) : (
          <button
            onClick={() => { setTitleDraft(project.name); setEditingTitle(true); }}
            className="pro-btn h-[26px] px-2 text-ui text-spectrum-textMuted hover:text-spectrum-text truncate max-w-[240px]"
            title="Click to rename the project"
          >
            {project.name}
          </button>
        )}
      </div>

      <Divider />

      {/* ── History & file ── */}
      <div className="flex items-center gap-px flex-shrink-0">
        <button
          onClick={undo}
          disabled={!canUndo}
          className="pro-btn w-[26px] h-[26px]"
          title={canUndo ? `Undo ${lastLabel ?? ''} (⌘Z)` : 'Nothing to undo'}
        >
          <Undo2 className="w-[15px] h-[15px]" />
        </button>
        <button onClick={redo} disabled={!canRedo} className="pro-btn w-[26px] h-[26px]" title="Redo (⌘⇧Z)">
          <Redo2 className="w-[15px] h-[15px]" />
        </button>
        <div className="w-1" />
        <button onClick={saveProject} className="pro-btn w-[26px] h-[26px]" title="Save project to a file (⌘S)">
          <Save className="w-[15px] h-[15px]" />
        </button>
        <button onClick={() => fileInputRef.current?.click()} className="pro-btn w-[26px] h-[26px]" title="Open a saved project (⌘O)">
          <FolderOpen className="w-[15px] h-[15px]" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && loadProject(e.target.files[0])}
        />
      </div>

      {/* ── Sequence format + master timecode (optically centred) ── */}
      <div className="flex-1 flex items-center justify-center gap-2 min-w-0">
        <div className="seg-group flex-shrink-0">
          <select
            value={project.aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
            className="seg-item select-native !pr-5 cursor-pointer bg-transparent"
            title="Canvas aspect ratio"
          >
            {(Object.keys(ASPECT_DIMENSIONS) as AspectRatio[]).map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio} · {ASPECT_DIMENSIONS[ratio].label}
              </option>
            ))}
          </select>
          <select
            value={project.fps}
            onChange={(e) => setFps(Number(e.target.value) as 24 | 30 | 60)}
            className="seg-item select-native !pr-5 font-mono cursor-pointer bg-transparent"
            title="Frame rate"
          >
            {[24, 30, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}
          </select>
        </div>

        {/* The master readout: current position bright, total dimmed. */}
        <div className="well h-[26px] px-2.5 flex items-center gap-1.5 font-mono flex-shrink-0">
          <span className="text-ui font-semibold text-spectrum-text tabular tracking-tight">
            {formatTimecode(playheadMs, project.fps)}
          </span>
          <span className="text-spectrum-textFaint">/</span>
          <span className="text-ui-xs text-spectrum-textDim tabular">
            {formatTimecode(project.durationMs, project.fps)}
          </span>
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Renders nothing unless there is an update to act on. */}
        <UpdateIndicator />

        <button onClick={openCommandPalette} className="pro-btn-filled h-[26px] px-2 gap-1.5 text-ui-xs" title="Command palette (⌘K)">
          <Command className="w-3 h-3" />
          <span className="hidden xl:inline">Commands</span>
          <span className="kbd hidden xl:inline-flex">⌘K</span>
        </button>

        <button onClick={() => setShortcutsOpen(true)} className="pro-btn w-[26px] h-[26px]" title="Keyboard shortcuts (?)">
          <Keyboard className="w-[15px] h-[15px]" />
        </button>

        <button
          onClick={() => setMcpOpen(true)}
          className="pro-btn-filled h-[26px] px-2 gap-1.5 text-ui-xs font-mono tracking-wide"
          title="MCP server & tools"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-spectrum-green animate-pulse-ring" />
          MCP
        </button>

        <Divider />

        <button
          onClick={() => setCopilotOpen(!isCopilotOpen)}
          className={`h-[26px] px-2.5 rounded-squircle-xs border text-ui-sm font-medium flex items-center gap-1.5 transition-colors ${
            isCopilotOpen
              ? 'bg-spectrum-accentSoft border-spectrum-accentLine text-spectrum-accent'
              : 'bg-spectrum-card border-line text-spectrum-textMuted hover:text-spectrum-text hover:bg-spectrum-cardHover'
          }`}
          title="AI Copilot (⌘J)"
        >
          <Sparkles className="w-[15px] h-[15px]" />
          Copilot
        </button>

        <button onClick={() => setExportModalOpen(true)} className="btn-primary h-[26px] px-3 gap-1.5 text-ui-sm">
          <Download className="w-[15px] h-[15px]" />
          Export
        </button>
      </div>

      {isMcpOpen && <McpStatusModal onClose={() => setMcpOpen(false)} />}
    </header>
  );
};
