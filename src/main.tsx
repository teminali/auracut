import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { registerToolBridge } from './engine/toolBridgeClient';
import './index.css';

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
  ]).then(([timeline, project, chat, ui, mcp, agent]) => {
    (window as any).__kerf = {
      timeline: timeline.useTimelineStore,
      project: project.useProjectStore,
      chat: chat.useAgentChatStore,
      ui: ui.useUiStore,
      executeTool: mcp.executeTool,
      tools: mcp.KERF_TOOLS,
      agent: agent.useClaudeAgentStore,
    };
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
