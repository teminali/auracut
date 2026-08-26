/* ═══════════════════════════════════════════════════════════════════
   Local RPC server.

   The one door into the running editor. The MCP stdio shim talks to
   this, and so could anything else on the machine — which is precisely
   why it binds to 127.0.0.1 only and checks a per-launch token. A port
   on 0.0.0.0 with no auth would let any page you visit reach into your
   project, since browsers can POST across origins freely.
   ═══════════════════════════════════════════════════════════════════ */

import http from 'http';
import crypto from 'crypto';
import { bridge, captureWindow, debugEval } from './toolBridge';

export const RPC_PORT = 3888;

/** Regenerated every launch, so a stale config cannot talk to a new session. */
export const RPC_TOKEN = crypto.randomBytes(24).toString('hex');

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    // Refuse anything implausibly large rather than buffering it.
    const LIMIT = 4 * 1024 * 1024;
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > LIMIT) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export function startRpcServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/rpc') {
      send(res, 404, { error: 'Not found' });
      return;
    }

    if (req.headers['x-kerf-token'] !== RPC_TOKEN) {
      send(res, 401, { error: 'Bad or missing token' });
      return;
    }

    try {
      const { method, params } = JSON.parse(await readBody(req)) as {
        method: string;
        params?: Record<string, unknown>;
      };

      if (!bridge.isReady()) {
        send(res, 503, { error: 'The Kerf window is not open.' });
        return;
      }

      switch (method) {
        case 'tools/list':
          send(res, 200, { result: await bridge.listTools() });
          return;

        case 'tools/call': {
          const name = String(params?.name ?? '');
          const args = (params?.arguments ?? {}) as Record<string, unknown>;
          send(res, 200, { result: await bridge.callTool(name, args) });
          return;
        }

        case 'ping':
          send(res, 200, { result: { ok: true } });
          return;

        /* A screenshot of the real window, for verifying the UI from
           outside the app. */
        /* Only with KERF_DEBUG=1 — arbitrary evaluation is not
           something a normal launch should expose, token or not. */
        case 'debug/eval':
          if (process.env.KERF_DEBUG !== '1') {
            send(res, 403, { error: 'debug/eval requires KERF_DEBUG=1' });
            return;
          }
          send(res, 200, { result: await debugEval(String(params?.expression ?? '1')) });
          return;

        case 'debug/capture':
          send(res, 200, { result: { pngBase64: await captureWindow() } });
          return;

        default:
          send(res, 400, { error: `Unknown method "${method}"` });
      }
    } catch (err) {
      send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  /*
    These are long local operations — a 4K render can run for many
    minutes. Node's default request timeout dropped the connection
    mid-export: the file completed on disk and the caller got nothing
    back, which looks exactly like a failure.
  */
  server.timeout = 0;
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.keepAliveTimeout = 0;
  server.on('connection', (socket) => socket.setTimeout(0));

  server.listen(RPC_PORT, '127.0.0.1', () => {
    console.log(`[Kerf] RPC bridge on http://127.0.0.1:${RPC_PORT}/rpc`);
  });

  return server;
}
