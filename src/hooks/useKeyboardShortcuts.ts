/* ═══════════════════════════════════════════════════════════════════
   Global keyboard map.

   Everything is registered in one place so bindings can't silently
   collide, and typing in a field never triggers an edit action.
   ═══════════════════════════════════════════════════════════════════ */

import { useEffect } from 'react';
import { useTimelineStore } from '../store/timelineStore';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { useLayoutStore, SidebarTab } from '../store/layoutStore';
import { serializeProject } from '../engine/projectIO';

/** True when focus is inside something the user is typing into. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

const SIDEBAR_TABS: SidebarTab[] = [
  'media', 'audio', 'text', 'captions', 'transitions', 'effects', 'filters', 'ai',
];

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const timeline = useTimelineStore.getState();
      const project = useProjectStore.getState();
      const ui = useUiStore.getState();
      const layout = useLayoutStore.getState();

      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;

      /* ── Bindings that work even while typing ── */

      if (mod && key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.toggleCommandPalette();
        return;
      }

      if (key === 'Escape') {
        if (ui.isCommandPaletteOpen) { ui.closeCommandPalette(); return; }
        if (ui.isShortcutsOpen) { ui.setShortcutsOpen(false); return; }
        if (ui.contextMenu) { ui.closeContextMenu(); return; }
      }

      if (isTypingTarget(e.target)) return;

      /* ── Modifier combos ── */

      if (mod) {
        switch (key.toLowerCase()) {
          case 'z':
            e.preventDefault();
            e.shiftKey ? timeline.redo() : timeline.undo();
            return;
          case 'y':
            e.preventDefault();
            timeline.redo();
            return;
          case 'd':
            e.preventDefault();
            if (timeline.selectedClipIds[0]) timeline.duplicateClip(timeline.selectedClipIds[0]);
            return;
          case 'g':
            e.preventDefault();
            e.shiftKey ? timeline.ungroupSelected() : timeline.groupSelected();
            return;
          case 'a':
            e.preventDefault();
            if (timeline.selectedTrackId) timeline.selectAllOnTrack(timeline.selectedTrackId);
            return;
          case 'b':
            e.preventDefault();
            timeline.splitAtPlayhead();
            return;
          case 'j':
            e.preventDefault();
            project.setCopilotOpen(!project.isCopilotOpen);
            return;
          case 'e':
            e.preventDefault();
            project.setExportModalOpen(true);
            return;
          case 's': {
            e.preventDefault();
            const blob = new Blob([serializeProject()], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${project.project.name.replace(/[^\w\-]+/g, '_')}.auracut.json`;
            link.click();
            URL.revokeObjectURL(url);
            ui.pushToast({ kind: 'success', title: 'Project saved' });
            return;
          }
          default:
            return;
        }
      }

      /* ── Single keys ── */

      switch (key) {
        case ' ':
          e.preventDefault();
          timeline.togglePlay();
          return;

        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault();
          const direction = key === 'ArrowRight' ? 1 : -1;

          // With a layer selected, arrows nudge it; otherwise they scrub.
          if (timeline.selectedClipIds.length > 0 && e.altKey) {
            const step = e.shiftKey ? 10 : 1;
            for (const id of timeline.selectedClipIds) {
              const clip = timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
              if (clip) timeline.updateClipTransform(id, { x: clip.transform.x + direction * step });
            }
            timeline.commit('Nudge layer');
            return;
          }

          const frameMs = 1000 / project.project.fps;
          timeline.nudgePlayhead(direction * (e.shiftKey ? 1000 : frameMs));
          return;
        }

        case 'ArrowUp':
        case 'ArrowDown': {
          if (timeline.selectedClipIds.length === 0) return;
          e.preventDefault();
          const direction = key === 'ArrowDown' ? 1 : -1;
          const step = e.shiftKey ? 10 : 1;
          for (const id of timeline.selectedClipIds) {
            const clip = timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
            if (clip) timeline.updateClipTransform(id, { y: clip.transform.y + direction * step });
          }
          timeline.commit('Nudge layer');
          return;
        }

        case 'Home':
          e.preventDefault();
          timeline.setPlayheadMs(0);
          return;

        case 'End':
          e.preventDefault();
          timeline.setPlayheadMs(project.project.durationMs);
          return;

        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          timeline.deleteSelected();
          return;

        case '?':
          e.preventDefault();
          ui.setShortcutsOpen(true);
          return;

        case '+':
        case '=':
          e.preventDefault();
          timeline.setZoomLevel(timeline.zoomLevel * 1.4);
          return;

        case '-':
        case '_':
          e.preventDefault();
          timeline.setZoomLevel(timeline.zoomLevel / 1.4);
          return;

        default:
          break;
      }

      /* ── Letter keys ── */

      switch (key.toLowerCase()) {
        case 's':
          e.preventDefault();
          timeline.splitAtPlayhead();
          return;
        case 'n':
          e.preventDefault();
          timeline.toggleSnapping();
          return;
        case 'r':
          e.preventDefault();
          timeline.toggleRippleEdit();
          return;
        case 'm':
          e.preventDefault();
          timeline.addMarker(timeline.playheadMs);
          return;
        case 'i':
          e.preventDefault();
          timeline.setInPoint(timeline.inPointMs === null ? timeline.playheadMs : null);
          return;
        case 'o':
          e.preventDefault();
          timeline.setOutPoint(timeline.outPointMs === null ? timeline.playheadMs : null);
          return;
        case 'l':
          e.preventDefault();
          timeline.toggleLoop();
          return;
        case 'z':
          if (e.shiftKey) {
            e.preventDefault();
            // Fit the whole sequence into the visible timeline width.
            const width = document.querySelector('[data-timeline-scroll]')?.clientWidth ?? window.innerWidth - 200;
            timeline.zoomToFit(width - 40, project.project.durationMs);
          }
          return;
        default:
          break;
      }

      /* ── Sidebar tabs 1–8 ── */
      const digit = parseInt(key, 10);
      if (!Number.isNaN(digit) && digit >= 1 && digit <= SIDEBAR_TABS.length) {
        e.preventDefault();
        layout.setActiveTab(SIDEBAR_TABS[digit - 1]);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
