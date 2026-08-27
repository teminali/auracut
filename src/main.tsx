import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { RecorderBar } from './components/recorder/RecorderBar';
import { registerToolBridge } from './engine/toolBridgeClient';
import { ErrorBoundary, installGlobalErrorHandlers } from './components/ErrorBoundary';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

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
if (new URLSearchParams(window.location.search).get('window') === 'recorder-bar') {
  root.render(
    <React.StrictMode>
      <RecorderBar />
    </React.StrictMode>
  );
} else {
  mountEditor();
}

function mountEditor(): void {
  /* Serve external tool calls (Claude Code over MCP) from this process,
     which is the only one that holds the project. */
  registerToolBridge();

  /* In development, expose the stores so the app can be driven from the console
     (and from automated smoke tests) without adding hooks to components. */
  if (import.meta.env.DEV) {
    void Promise.all([
      import('./store/timelineStore'),
      import('./store/projectStore'),
      import('./store/agentChatStore'),
      import('./store/uiStore'),
      import('./mcp/toolRegistry'),
      import('./store/claudeAgentStore'),
      import('./store/layoutStore'),
      import('./store/recorderStore'),
    ]).then(([timeline, project, chat, ui, mcp, agent, layout, recorder]) => {
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
      };
    });
  }

  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
