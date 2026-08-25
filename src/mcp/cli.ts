/* ═══════════════════════════════════════════════════════════════════
   MCP stdio bridge.

   Exposes AuraCut's tool surface to an external agent (Claude Code,
   Antigravity, Codex …) over the Model Context Protocol. The renderer
   holds the actual project state, so this process forwards calls to it
   and relays the result.
   ═══════════════════════════════════════════════════════════════════ */

import { getToolManifest, executeTool, AURA_TOOLS } from './toolRegistry';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

const SERVER_INFO = {
  name: 'auracut',
  version: '2.0.0',
};

function respond(response: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

async function handle(request: JsonRpcRequest): Promise<void> {
  const { id, method, params } = request;

  try {
    switch (method) {
      case 'initialize':
        respond({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
          },
        });
        return;

      case 'tools/list':
        respond({ jsonrpc: '2.0', id, result: { tools: getToolManifest() } });
        return;

      case 'tools/call': {
        const name = String(params?.name ?? '');
        const args = (params?.arguments ?? {}) as Record<string, unknown>;
        const result = await executeTool(name, args, 'MCP stdio client');

        respond({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: result.success
                  ? JSON.stringify(result.data, null, 2)
                  : `Error: ${result.error}`,
              },
            ],
            isError: !result.success,
          },
        });
        return;
      }

      case 'ping':
        respond({ jsonrpc: '2.0', id, result: {} });
        return;

      default:
        // Notifications carry no id and expect no reply.
        if (id === undefined) return;
        respond({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method "${method}"` } });
    }
  } catch (err) {
    if (id === undefined) return;
    respond({
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
    });
  }
}

/* ── stdio loop ─────────────────────────────────────────────────── */

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;

  // Messages are newline-delimited JSON.
  let newlineIndex = buffer.indexOf('\n');
  while (newlineIndex !== -1) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);

    if (line.length > 0) {
      try {
        void handle(JSON.parse(line) as JsonRpcRequest);
      } catch {
        respond({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } });
      }
    }

    newlineIndex = buffer.indexOf('\n');
  }
});

process.stderr.write(`AuraCut MCP server ready — ${AURA_TOOLS.length} tools exposed.\n`);
