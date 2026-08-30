/* ═══════════════════════════════════════════════════════════════════
   MCP stdio shim.

   Claude Code (or any MCP client) speaks JSON-RPC to this over stdio.
   It owns no state of its own: every tool call is forwarded to the
   running Kerf window through the local RPC bridge, so edits land in
   the project actually on screen.

   Runs under Electron's bundled Node via ELECTRON_RUN_AS_NODE=1, so
   there is no dependency on the user having node installed.

   Note: MCP framing here is newline-delimited JSON, matching what the
   original bridge spoke. Every response is written as a single line.
   ═══════════════════════════════════════════════════════════════════ */

import fs from 'fs';
import path from 'path';
import os from 'os';

const PORT = Number(process.env.KERF_RPC_PORT ?? 3888);

function findToken(): string {
  if (process.env.KERF_RPC_TOKEN) return process.env.KERF_RPC_TOKEN;

  const possiblePaths = [
    path.join(os.homedir(), 'Library', 'Application Support', 'Kerf', `mcp-kerf${PORT === 3888 ? '' : `-${PORT}`}.json`),
    path.join(os.homedir(), 'Library', 'Application Support', 'kerf', `mcp-kerf${PORT === 3888 ? '' : `-${PORT}`}.json`),
    path.join(process.env.APPDATA ?? '', 'Kerf', `mcp-kerf${PORT === 3888 ? '' : `-${PORT}`}.json`),
    path.join(os.homedir(), '.config', 'Kerf', `mcp-kerf${PORT === 3888 ? '' : `-${PORT}`}.json`),
    path.join(os.homedir(), '.config', 'kerf', `mcp-kerf${PORT === 3888 ? '' : `-${PORT}`}.json`),
  ];

  for (const file of possiblePaths) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        mcpServers?: { kerf?: { env?: { KERF_RPC_TOKEN?: string } } };
      };
      const envToken = data?.mcpServers?.kerf?.env?.KERF_RPC_TOKEN;
      if (envToken) return envToken;
    } catch {
      /* try next */
    }
  }
  return '';
}

const TOKEN = findToken();

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

const SERVER_INFO = { name: 'kerf', version: '1.0.0' };

function respond(body: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...body })}\n`);
}

async function rpc(method: string, params?: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${PORT}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-kerf-token': TOKEN },
    body: JSON.stringify({ method, params }),
  });

  const data = (await response.json()) as { result?: unknown; error?: string };
  if (!response.ok || data.error) {
    throw new Error(data.error ?? `Bridge returned ${response.status}`);
  }
  return data.result;
}

async function handle(request: JsonRpcRequest): Promise<void> {
  const { id, method, params } = request;

  try {
    switch (method) {
      case 'initialize':
        respond({
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
          },
        });
        return;

      case 'notifications/initialized':
        return; // notification — no reply

      case 'tools/list': {
        let tools: unknown[] = [];
        try {
          tools = ((await rpc('tools/list')) as unknown[]) ?? [];
        } catch {
          // Kerf desktop app is not running; return empty list instead of failing MCP initialization
          tools = [];
        }
        respond({ id, result: { tools } });
        return;
      }

      case 'tools/call': {
        const result = (await rpc('tools/call', {
          name: params?.name,
          arguments: params?.arguments ?? {},
        })) as { success: boolean; data?: unknown; error?: string };

        respond({
          id,
          result: {
            content: [
              {
                type: 'text',
                text: result.success
                  ? JSON.stringify(result.data ?? { ok: true }, null, 2)
                  : `Error: ${result.error}`,
              },
            ],
            isError: !result.success,
          },
        });
        return;
      }

      case 'ping':
        respond({ id, result: {} });
        return;

      default:
        if (id === undefined) return; // unknown notification
        respond({ id, error: { code: -32601, message: `Unknown method "${method}"` } });
    }
  } catch (err) {
    if (id === undefined) return;
    /*
      Report tool failures as a tool RESULT rather than a protocol error
      where we can — an agent can read "Kerf is not running" and tell
      the user, but a JSON-RPC error code usually just aborts the turn.
    */
    const message = err instanceof Error ? err.message : String(err);
    if (method === 'tools/call') {
      respond({ id, result: { content: [{ type: 'text', text: `Error: ${message}` }], isError: true } });
    } else {
      respond({ id, error: { code: -32603, message } });
    }
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;

  let newline = buffer.indexOf('\n');
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);

    if (line.length > 0) {
      try {
        void handle(JSON.parse(line) as JsonRpcRequest);
      } catch {
        respond({ error: { code: -32700, message: 'Parse error' } });
      }
    }
    newline = buffer.indexOf('\n');
  }
});

process.stderr.write('Kerf MCP shim ready — forwarding to the live editor.\n');
