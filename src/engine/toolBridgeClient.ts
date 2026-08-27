/* ═══════════════════════════════════════════════════════════════════
   Renderer half of the tool bridge.

   Main forwards every external tool call here, because this is the only
   process that holds the project. Registering this is what makes an MCP
   client edit the timeline you can see rather than an empty one.
   ═══════════════════════════════════════════════════════════════════ */

import { executeTool, getToolManifest } from '../mcp/toolRegistry';

export function registerToolBridge(): void {
  const api = window.electronAPI;
  if (!api?.bridge) return; // browser dev build. Nothing to serve

  api.bridge.onListTools(async (id) => {
    try {
      api.bridge.respond({ id, ok: true, data: getToolManifest() });
    } catch (err) {
      api.bridge.respond({ id, ok: false, error: (err as Error).message });
    }
  });

  api.bridge.onCallTool(async (id, name, args) => {
    try {
      // executeTool already catches per-tool failures and reports them in
      // its result, so a thrown error here means the call never ran.
      const result = await executeTool(name, args, 'Claude Code');
      api.bridge.respond({ id, ok: true, data: result });
    } catch (err) {
      api.bridge.respond({ id, ok: false, error: (err as Error).message });
    }
  });
}
