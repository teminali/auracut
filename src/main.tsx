import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

/* In development, expose the stores so the app can be driven from the console
   (and from automated smoke tests) without adding hooks to components. */
if (import.meta.env.DEV) {
  void Promise.all([
    import('./store/timelineStore'),
    import('./store/projectStore'),
    import('./store/agentChatStore'),
    import('./store/uiStore'),
    import('./mcp/toolRegistry'),
  ]).then(([timeline, project, chat, ui, mcp]) => {
    (window as any).__auracut = {
      timeline: timeline.useTimelineStore,
      project: project.useProjectStore,
      chat: chat.useAgentChatStore,
      ui: ui.useUiStore,
      executeTool: mcp.executeTool,
      tools: mcp.AURA_TOOLS,
    };
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
