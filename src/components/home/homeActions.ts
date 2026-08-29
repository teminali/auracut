/* ═══════════════════════════════════════════════════════════════════
   Everything the home screen can actually do.

   Kept out of the layout components so that every slot on the screen
   is wired to a real store action rather than to a handler only that
   tile knows about. If a slot has nothing here, it has no behaviour —
   which is deliberate: nothing on this screen pretends to work.
   ═══════════════════════════════════════════════════════════════════ */

import { useCallback, useMemo } from 'react';
import { useLayoutStore } from '../../store/layoutStore';
import { useProjectStore } from '../../store/projectStore';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { useRecorderStore } from '../../store/recorderStore';
import { RecentProject } from '../../store/recentsStore';
import { buildStarterProject } from '../../engine/starterProject';
import { deserializeProject, restoreAutosave } from '../../engine/projectIO';
import { INITIAL_PROJECT } from '../../mcp/defaultMedia';

export interface HomeActions {
  /** Empty timeline, fresh settings, straight into the editor. */
  newProject: () => void;
  /** Open the recorder. The project is built from the take, not from here. */
  startRecording: () => void;
  /** Enter the editor with one of its eight panels already open. */
  /** Enter the editor with the Copilot drawer open. */
  openCopilot: () => void;
  openRecent: (entry: RecentProject) => void;
  playRecent: (entry: RecentProject) => void;
  openFile: (file: File) => Promise<void>;
  recover: () => void;
}

export function useHomeActions(onEnterEditor: () => void): HomeActions {
  const pushToast = useUiStore((s) => s.pushToast);
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);
  const openPlayer = useLayoutStore((s) => s.openPlayer);
  const setCopilotOpen = useProjectStore((s) => s.setCopilotOpen);

  const newProject = useCallback(() => {
    /*
      There was no "new project" anywhere in the app — the home screen's
      old button entered the editor with whatever happened to be loaded,
      so leaving a project and pressing New handed you the same project
      back. `loadProject([], [])` is what the starter builder uses to
      start from nothing; the settings are reset alongside it so the
      title bar does not keep the previous project's name.
    */
    useTimelineStore.getState().loadProject([], []);
    const now = Date.now();
    useProjectStore.getState().loadProjectSettings({
      ...INITIAL_PROJECT,
      id: `proj_${now.toString(36)}`,
      name: 'Untitled project',
      createdAt: now,
      updatedAt: now,
    });
    setActiveTab('media');
    onEnterEditor();
  }, [onEnterEditor, setActiveTab]);

  /*
    Opens the studio and stops. Nothing about the project is decided
    yet — the canvas size comes from the display that gets captured, the
    clips from the files that get written — so there is deliberately no
    `loadProject` here. `assembleRecording` builds the whole thing at the
    end, from a take that exists.
  */
  const startRecording = useCallback(() => {
    useRecorderStore.getState().open();
  }, []);

  const openCopilot = useCallback(() => {
    setCopilotOpen(true);
    onEnterEditor();
  }, [onEnterEditor, setCopilotOpen]);

  /*
    Loading is separated from where you land, because there are two
    destinations now and only one correct way to load.

    `loadRecent` puts the project into the real stores and reports
    whether it got there. `openRecent` then enters the editor, exactly
    as it always did. `playRecent` opens the Player and STAYS ON HOME,
    which is what keeps watching from being editing: autosave only runs
    in the editor, so a project that was only played never writes a
    slot, never captures a poster and never touches the recents wall.
  */
  const loadRecent = useCallback(
    (entry: RecentProject): boolean => {
      // The starter is rebuilt from code, not reloaded from a snapshot.
      if (entry.starter) {
        buildStarterProject();
        pushToast({
          kind: 'info',
          title: 'Opened the starter project',
          detail: 'Kerf’s own brand film, 11.5s, thirteen cuts on detected beats. Edit it freely.',
        });
        return true;
      }

      if (!entry.snapshot) {
        pushToast({
          kind: 'info',
          title: 'This one is not stored locally',
          detail: entry.filePath ? `Open ${entry.filePath} from the editor.` : 'Reopen it from a file.',
        });
        return false;
      }

      // deserializeProject applies straight to the stores; it returns only
      // whether it worked and what could not be relinked.
      const result = deserializeProject(entry.snapshot);
      if (!result.ok) {
        pushToast({ kind: 'error', title: 'Could not open', detail: result.error });
        return false;
      }
      if (result.migratedFrom !== undefined) {
        pushToast({
          kind: 'info',
          title: 'Project upgraded',
          detail: `It was saved in format ${result.migratedFrom} and has been brought up to date. ` +
            'Save it to keep the newer form.',
        });
      }
      if (result.relinkNeeded?.length) {
        pushToast({
          kind: 'info',
          title: `${result.relinkNeeded.length} file${result.relinkNeeded.length > 1 ? 's' : ''} need relinking`,
          detail: 'Their original paths are gone. Re-import them from the Media panel.',
        });
      }
      return true;
    },
    [pushToast]
  );

  const openRecent = useCallback(
    (entry: RecentProject) => {
      if (loadRecent(entry)) onEnterEditor();
    },
    [loadRecent, onEnterEditor]
  );

  /* Decision 8: playing a project from home opens the Player, not the
     editor. It is the same Player the editor's monitor opens. */
  const playRecent = useCallback(
    (entry: RecentProject) => {
      if (loadRecent(entry)) openPlayer();
    },
    [loadRecent, openPlayer]
  );

  const openFile = useCallback(
    async (file: File) => {
      try {
        const result = deserializeProject(await file.text());
        if (!result.ok) {
          pushToast({ kind: 'error', title: 'Could not load that file', detail: result.error });
          return;
        }
        pushToast({ kind: 'success', title: 'Project loaded', detail: file.name });
        onEnterEditor();
      } catch (err) {
        pushToast({ kind: 'error', title: 'Could not read the file', detail: (err as Error).message });
      }
    },
    [onEnterEditor, pushToast]
  );

  const recover = useCallback(() => {
    const result = restoreAutosave();
    if (!result.ok) {
      pushToast({ kind: 'error', title: 'Could not recover', detail: result.error });
      return;
    }
    onEnterEditor();
    pushToast({ kind: 'success', title: 'Recovered your last session' });
  }, [onEnterEditor, pushToast]);

  return useMemo(
    () => ({ newProject, startRecording, openCopilot, openRecent, playRecent, openFile, recover }),
    [newProject, startRecording, openCopilot, openRecent, playRecent, openFile, recover]
  );
}
