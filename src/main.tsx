import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { RecorderBar } from './components/recorder/RecorderBar';
import { registerToolBridge } from './engine/toolBridgeClient';
import { ErrorBoundary, installGlobalErrorHandlers } from './components/ErrorBoundary';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

// Apply platform class to document.documentElement for styling and drag behavior
const detectedPlatform =
  window.electronAPI?.platform ||
  (typeof navigator !== 'undefined' && /Win/.test(navigator.platform)
    ? 'win32'
    : typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
      ? 'darwin'
      : 'linux');

if (detectedPlatform === 'darwin') {
  document.documentElement.classList.add('platform-darwin');
} else if (detectedPlatform === 'win32') {
  document.documentElement.classList.add('platform-win');
} else {
  document.documentElement.classList.add('platform-linux');
}

/* Before anything renders, and in BOTH windows: a throw during the first
   render should be recorded rather than leaving a black rectangle. The
   recorder bar is the window nobody is looking at while it matters. */
installGlobalErrorHandlers();

/*
  Which window is this?

  The recorder's floating control bar is a SECOND BrowserWindow loaded
  from this same bundle, told apart by a query parameter main sets when
  it opens the window.

  The branch has to come before `registerToolBridge`, and that is not a
  style preference. The bridge subscribes to the IPC channel Claude
  Code's tool calls arrive on, and main sends each call to a WINDOW
  rather than to a process. Two subscribed renderers means two replies
  to one call, and the second is an error about an id nobody is waiting
  for. The bar holds no project and can answer no tool call, so it must
  not be listening.

  The dev store bridge is skipped for the same reason: `__kerf` in two
  windows means the automated suites drive whichever answered first.
*/
const windowRole = new URLSearchParams(window.location.search).get('window');

if (windowRole === 'recorder-bar') {
  root.render(
    <React.StrictMode>
      <RecorderBar />
    </React.StrictMode>
  );
} else if (windowRole === 'render-worker') {
  /*
    A render-farm window. It draws nothing anybody will look at — the
    picture goes to a canvas and straight into an encoder — so it mounts
    no React at all, and for the same reason as the bar it must not
    register the tool bridge or the dev store: main sends a tool call to
    a WINDOW, and four subscribed renderers means four answers to one
    call.

    The root is left empty on purpose. Rendering a placeholder into a
    window nobody sees would be work competing with the render.
  */
  void import('./engine/renderWorker').then((m) => m.startRenderWorker());
} else {
  mountEditor();
}

function mountEditor(): void {
  /* Serve external tool calls (Claude Code over MCP) from this process,
     which is the only one that holds the project. */
  registerToolBridge();

  /* Expose the stores on window.__kerf so the app can be driven from the console
     and from automated smoke tests via debug/eval without adding hooks to components. */
  void Promise.all([
    import('./store/timelineStore'),
    import('./store/projectStore'),
    import('./store/agentChatStore'),
    import('./store/uiStore'),
    import('./mcp/toolRegistry'),
    import('./store/claudeAgentStore'),
    import('./store/layoutStore'),
    import('./store/recorderStore'),
    import('./engine/liveStream'),
    import('./store/recentsStore'),
  ]).then(([timeline, project, chat, ui, mcp, agent, layout, recorder, live, recents]) => {
    (window as any).__kerf = {
      timeline: timeline.useTimelineStore,
      project: project.useProjectStore,
      chat: chat.useAgentChatStore,
      ui: ui.useUiStore,
      executeTool: mcp.executeTool,
      tools: mcp.KERF_TOOLS,
      agent: agent.useClaudeAgentStore,
      /*
        Which screen is showing lives here, and without it no automated
        UI check could get off the home screen — `open_starter_project`
        loads a project into the stores and does NOT navigate, so a test
        that opened one and looked for the editor found the home screen
        and measured nothing. Cost an hour of a render-count measurement
        reading zero for the most boring possible reason.
      */
      layout: layout.useLayoutStore,
      /* The recorder, so `verify_home` can prove the New project
         chooser opens it without a real capture device. */
      recorder: recorder.useRecorderStore,
      /* The recents wall, so `verify_home` can put two projects on
         it and prove the sort really orders them. A one-project wall
         cannot be sorted wrong, so without this the sort check was a
         green tick that could not fail. */
      recents: recents.useRecentsStore,
      /*
        Live streaming, so `verify_stream` can run one end to end
        against a real RTMP ingest with SYNTHETIC colour sources.

        It is here rather than behind a tool because the thing that
        has to be controlled is the SOURCES: a stream fed from the
        real screen is a stream whose output nobody can assert
        anything about. Given a green screen and a blue camera, every
        claim the look makes becomes a measurement on the received
        picture.
      */
      liveStream: live,
    };
  });

  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
