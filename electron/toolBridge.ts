/* ═══════════════════════════════════════════════════════════════════
   Tool bridge.

   The editing tools operate on the zustand stores, which live in the
   RENDERER — the window you are looking at. Anything outside that
   process (an MCP client, Claude Code) therefore cannot just call them:
   it has to ask the window to do it.

   This is the asking. Main holds a table of in-flight requests, pushes
   each to the renderer over IPC, and resolves when the renderer answers.
   Without it an external agent runs the tools against a fresh, empty
   store and edits a project nobody can see — which is exactly what the
   original stdio server did.
   ═══════════════════════════════════════════════════════════════════ */

import { BrowserWindow, ipcMain } from 'electron';

export interface ToolCallResult {
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs?: number;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, Pending>();
let seq = 0;
let targetWindow: BrowserWindow | null = null;

/** How long one tool may take before the caller gets an answer anyway. */
const TOOL_TIMEOUT_MS = 60_000;

export function setBridgeWindow(window: BrowserWindow | null): void {
  targetWindow = window;
}

export function initToolBridge(): void {
  ipcMain.on(
    'bridge:response',
    (_event, payload: { id: string; ok: boolean; data?: unknown; error?: string }) => {
      const entry = pending.get(payload.id);
      if (!entry) return; // already timed out — its rejection has been delivered
      pending.delete(payload.id);
      clearTimeout(entry.timer);

      if (payload.ok) entry.resolve(payload.data);
      else entry.reject(new Error(payload.error ?? 'Tool failed'));
    }
  );
}

/** Ask the renderer to do something, and wait for its reply. */
function ask<T>(channel: string, payload: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!targetWindow || targetWindow.isDestroyed()) {
      reject(new Error('AuraCut is not running — open the app and try again.'));
      return;
    }

    const id = `req_${++seq}_${process.pid}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out after ${TOOL_TIMEOUT_MS / 1000}s waiting for the editor.`));
    }, TOOL_TIMEOUT_MS);

    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    targetWindow.webContents.send(channel, { id, payload });
  });
}

export const bridge = {
  /** The tool manifest, read from the live registry rather than a copy. */
  listTools: () => ask<unknown[]>('bridge:list-tools', {}),
  callTool: (name: string, args: Record<string, unknown>) =>
    ask<ToolCallResult>('bridge:call-tool', { name, args }),
  isReady: () => Boolean(targetWindow && !targetWindow.isDestroyed()),
};
