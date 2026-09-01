/* ═══════════════════════════════════════════════════════════════════
   Title bar.

   This is the OS titlebar, not a web navbar: the whole strip drags the
   window, a platform-sized gutter keeps the macOS traffic lights clear,
   and every control opts back out of the drag region.

   Layout is three fixed zones — identity, sequence format, actions —
   so nothing reflows as the project name or timecode changes width.
   ═══════════════════════════════════════════════════════════════════ */

import React, { useState, useRef, useEffect } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { AspectRatio, ASPECT_DIMENSIONS } from '../../types/edl';
import { formatTimecode } from '../../utils/time';
import { serializeProject, deserializeProject } from '../../engine/projectIO';
import { isTemiProjectFile, importTemiProject } from '../../engine/temiBundle';
import { UpdateIndicator } from './UpdateIndicator';
import { TeminaliCutMark } from '../ui/TeminaliCutMark';
import { usePackagesStore } from '../../store/packagesStore';
import {
  Sparkle, Download, Undo2, Redo2, Command, Save, FolderOpen, Keyboard, X, Package,
} from '../ui/icons';
import { useRecorderStore } from '../../store/recorderStore';
import { StatusDot } from '../ui/Primitives';

/** A hairline rule between control clusters. */
const Divider: React.FC = () => <div className="w-px h-4 bg-line flex-shrink-0" />;

export const HeaderBar: React.FC<{ onGoHome?: () => void }> = ({ onGoHome }) => {
  const historyIndex = useTimelineStore((s) => s.historyIndex);
  const historyLength = useTimelineStore((s) => s.history.length);
  const lastLabel = useTimelineStore((s) => s.history[s.historyIndex]?.label);
  const undo = useTimelineStore((s) => s.undo);
  const redo = useTimelineStore((s) => s.redo);

  const project = useProjectStore((s) => s.project);
  const isCopilotOpen = useProjectStore((s) => s.isCopilotOpen);
  const setCopilotOpen = useProjectStore((s) => s.setCopilotOpen);
  const setExportModalOpen = useProjectStore((s) => s.setExportModalOpen);
  const isExporting = useProjectStore((s) => s.isExporting);
  const exportProgress = useProjectStore((s) => s.exportProgress);
  const cancelActiveExport = useProjectStore((s) => s.cancelActiveExport);
  const setMcpModalOpen = useProjectStore((s) => s.setMcpModalOpen);

  const setPackagesModalOpen = usePackagesStore((s) => s.setModalOpen);
  const packages = usePackagesStore((s) => s.packages);
  const coreReady = Boolean(packages.ffmpeg?.installed && packages.ffprobe?.installed);
  const setAspectRatio = useProjectStore((s) => s.setAspectRatio);
  const setProjectName = useProjectStore((s) => s.setProjectName);
  const setFps = useProjectStore((s) => s.setFps);

  const openCommandPalette = useUiStore((s) => s.openCommandPalette);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const pushToast = useUiStore((s) => s.pushToast);

  const [isEditingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(project.name);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keep titleDraft in sync with store (e.g., when agent renames)
  useEffect(() => {
    if (!isEditingTitle) setTitleDraft(project.name);
  }, [project.name, isEditingTitle]);

  const commitTitle = () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== project.name) {
      setProjectName(trimmed);
    }
    setEditingTitle(false);
  };

  const saveProject = () => {
    const json = serializeProject();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.name.replace(/[^\w\-]+/g, '_')}.kerf.json`;
    link.click();
    URL.revokeObjectURL(url);
    pushToast({ kind: 'success', title: 'Project saved', detail: link.download });
  };

  const loadProject = async (file: File) => {
    try {
      const isTemi = file.name.endsWith('.temi') || (await isTemiProjectFile(file));
      if (isTemi) {
        const result = await importTemiProject(file);
        if (result.ok) {
          pushToast({
            kind: 'success',
            title: 'Project bundle loaded',
            detail: `${result.projectName || file.name} · ${result.assetCount} media assets extracted`,
          });
        } else {
          pushToast({
            kind: 'error',
            title: 'Could not load project bundle',
            detail: result.error,
          });
        }
        return;
      }

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
      className="editor-topbar titlebar-drag h-[52px] flex-shrink-0 bg-spectrum-panelHeader border-b border-line flex items-center gap-2.5 pr-[15px] z-30"
    >
      {/* Window-control gutter — macOS only, sized by --titlebar-inset. */}
      <div className="titlebar-gutter" />

      {/* ── Identity ── */}
      <div className="flex items-center gap-2.5 min-w-0">
        {/* The mark is the way back to home, which is where projects and
            skills live. Nothing else in the header should compete with it. */}
        <button
          onClick={onGoHome}
          disabled={!onGoHome}
          title={onGoHome ? 'Back to home' : undefined}
            aria-label={onGoHome ? 'Back to home' : undefined}
          className="flex items-center gap-2 flex-shrink-0 rounded-squircle-xs px-1 -mx-1 py-0.5
                     hover:bg-white/[0.05] transition-colors disabled:hover:bg-transparent"
        >
          <div className="w-[26px] h-[26px] rounded-lg bg-spectrum-accentSoft border border-spectrum-accentLine flex items-center justify-center flex-shrink-0 text-spectrum-accent shadow-[0_0_12px_rgba(59,130,246,0.15)]">
            <TeminaliCutMark className="w-[13px] h-[13px]" />
          </div>
          <span className="font-semibold tracking-tight text-ui-lg text-spectrum-text">TeminaliCut</span>
        </button>

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
          /* A tab, with the close that a tab implies. Closing it is
             the same `goHome` the mark performs — the project is
             remembered on the recents wall on the way out, so this
             cannot lose work. */
          <span className="editor-tab">
            <button
              onClick={() => { setTitleDraft(project.name); setEditingTitle(true); }}
              className="truncate max-w-[220px] text-ui text-spectrum-text"
              title="Click to rename the project"
              aria-label="Click to rename the project"
            >
              {project.name}
            </button>
            <button
              onClick={onGoHome}
              disabled={!onGoHome}
              className="editor-tab-close"
              title="Close the project and go home"
              aria-label="Close the project and go home"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
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
            aria-label={canUndo ? `Undo ${lastLabel ?? ''} (⌘Z)` : 'Nothing to undo'}
        >
          <Undo2 className="w-[15px] h-[15px]" />
        </button>
        <button onClick={redo} disabled={!canRedo} className="pro-btn w-[26px] h-[26px]" title="Redo (⌘⇧Z)"
            aria-label="Redo (⌘⇧Z)">
          <Redo2 className="w-[15px] h-[15px]" />
        </button>
        <div className="w-1" />
        <button onClick={saveProject} className="pro-btn w-[26px] h-[26px]" title="Save project to a file (⌘S)"
            aria-label="Save project to a file (⌘S)">
          <Save className="w-[15px] h-[15px]" />
        </button>
        <button onClick={() => fileInputRef.current?.click()} className="pro-btn w-[26px] h-[26px]" title="Open a saved project (⌘O)"
            aria-label="Open a saved project (⌘O)">
          <FolderOpen className="w-[15px] h-[15px]" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".temi,.json,.kerf.json,application/json"
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
        <HeaderTimecodeReadout fps={project.fps} durationMs={project.durationMs} />
      </div>

      {/* ── Actions ── */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Renders nothing unless there is an update to act on. */}
        <UpdateIndicator />

        {/* Recording is reachable from home only today, which means
            leaving the project to start one. The design puts it in the
            editor header and it opens the SAME recorder studio — one
            component, two doors, like the Player. */}
        <button
          onClick={() => useRecorderStore.getState().open()}
          className="pro-btn-filled h-[26px] px-2 gap-1.5 text-ui-xs"
          title="Record the screen"
          aria-label="Record the screen"
        >
          <StatusDot state="error" />
          Record
        </button>

        <button onClick={openCommandPalette} className="pro-btn-filled h-[26px] px-2 gap-1.5 text-ui-xs" title="Command palette (⌘K)"
            aria-label="Command palette (⌘K)">
          <Command className="w-3 h-3" />
          <span className="hidden xl:inline">Commands</span>
          <span className="kbd hidden xl:inline-flex">⌘K</span>
        </button>

        <button onClick={() => setShortcutsOpen(true)} className="pro-btn w-[26px] h-[26px]" title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts (?)">
          <Keyboard className="w-[15px] h-[15px]" />
        </button>

        <button
          onClick={() => setMcpModalOpen(true)}
          className="pro-btn-filled h-[26px] px-2 gap-1.5 text-ui-xs font-mono tracking-wide"
          title="MCP server & tools"
          aria-label="MCP server & tools"
        >
          <StatusDot state="on" className="animate-pulse-ring" />
          MCP
        </button>

        <button
          onClick={() => setPackagesModalOpen(true)}
          className="pro-btn-filled h-[26px] px-2 gap-1.5 text-ui-xs relative"
          title={coreReady ? 'Packages & Models Manager' : 'Recommended packages available for your machine. Click to install.'}
          aria-label="Packages & Models Manager"
        >
          <Package className="w-3 h-3 text-spectrum-accent" />
          <span className="hidden xl:inline">Packages</span>
          {!coreReady && (
            <span className="w-1.5 h-1.5 rounded-full bg-[#f0a173] animate-pulse" />
          )}
        </button>

        <Divider />

        <button
          onClick={() => setCopilotOpen(!isCopilotOpen)}
          /* The shared filled button plus the shared on-state, rather
             than a fifth hand-rolled button in the same 26px row. It
             had its own radius (6px against everything else's 8px),
             its own border and its own hover, which is how one control
             in a toolbar ends up a different shape from its neighbours. */
          className={`pro-btn-filled h-[26px] px-2.5 gap-1.5 text-ui-sm font-medium ${
            isCopilotOpen ? 'pro-btn-active' : ''
          }`}
          title="AI Copilot (⌘J)"
        
            aria-label="AI Copilot (⌘J)">
          <Sparkle className="w-[15px] h-[15px]" />
          Copilot
        </button>

        {isExporting ? (
          <div className="flex items-center gap-1 bg-spectrum-surfaceSoft border border-blue-500/40 rounded-md pl-2.5 pr-1 h-[26px] shadow-sm">
            <button
              onClick={() => setExportModalOpen(true)}
              className="flex items-center gap-1.5 text-ui-xs font-mono font-medium text-blue-400 hover:text-blue-300 transition-colors"
              title="Click to expand export progress"
            >
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span>Exporting {Math.round(exportProgress)}%</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                cancelActiveExport();
              }}
              className="w-5 h-5 rounded flex items-center justify-center text-spectrum-textMuted hover:text-red-400 hover:bg-red-500/15 transition-colors ml-0.5"
              title="Cancel export"
              aria-label="Cancel export"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <button onClick={() => setExportModalOpen(true)} className="btn-primary h-[26px] px-3 gap-1.5 text-ui-sm">
            <Download className="w-[15px] h-[15px]" />
            Export
          </button>
        )}
      </div>
    </header>
  );
};

const HeaderTimecodeReadout: React.FC<{ fps: number; durationMs: number }> = React.memo(
  ({ fps, durationMs }) => {
    const playheadMs = useTimelineStore((s) => s.playheadMs);
    return (
      <div className="well h-[26px] px-2.5 flex items-center gap-1.5 font-mono flex-shrink-0">
        <span className="text-ui font-semibold text-spectrum-text tabular tracking-tight">
          {formatTimecode(playheadMs, fps)}
        </span>
        <span className="text-spectrum-textFaint">/</span>
        <span className="text-ui-xs text-spectrum-textDim tabular">
          {formatTimecode(durationMs, fps)}
        </span>
      </div>
    );
  }
);
