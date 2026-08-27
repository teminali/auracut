import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { registerToolBridge } from './engine/toolBridgeClient';
import { ErrorBoundary, installGlobalErrorHandlers } from './components/ErrorBoundary';
import './index.css';

/* Serve external tool calls (Claude Code over MCP) from this process,
   which is the only one that holds the project. */
registerToolBridge();

/* Before the tree mounts, so a throw during the first render is recorded
   rather than leaving a black window and nothing else. */
installGlobalErrorHandlers();

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
  ]).then(([timeline, project, chat, ui, mcp, agent, layout]) => {
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
    };
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
