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

/*
  One Kerf per port, so more than one can run at a time.

  This was a bare 3888, and it made the whole verification apparatus
  serial: all 107 checks in `tools/` drive a live app over this port, so
  two of anything — two agents, two suites, a packaged build and a dev
  build — fought over it. The loser's `writeMcpConfig` overwrote the
  winner's token file and every call came back "Bad or missing token",
  which is trap 4 in NEXT.md and cost real time more than once.

  `mcpStdio.ts` already read `KERF_RPC_PORT`; it was only the server that
  could not be told. With this, N instances coexist on N ports and their
  suites can run in parallel — and it is also what a headless CI runner
  needs, since it cannot assume the port is free.
*/
export const RPC_PORT = Number(process.env.KERF_RPC_PORT ?? 3888);

/** Regenerated every launch, so a stale config cannot talk to a new session. */
export const RPC_TOKEN = crypto.randomBytes(24).toString('hex');

/** Whether this instance actually holds the port. */
let listening = false;
export function rpcBridgeListening(): boolean {
  return listening;
}

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

export function startRpcServer(onReady?: () => void): http.Server {
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
          send(res, 200, { result: await captureWindow() });
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

  /*
    An occupied port used to take the whole app down.

    `listen` emits 'error' rather than throwing, and with no handler an
    EADDRINUSE became an unhandled 'error' event — main dies, and the
    window with it. Harmless while the port was a hardcoded 3888 that
    only ever had one claimant; now that KERF_RPC_PORT selects it, asking
    for a busy port is an ordinary mistake and should not be fatal.

    Kerf stays up without its RPC bridge. The editor is still an editor
    with no agent attached, which is a far better outcome than exiting,
    and the message says exactly what to do.
  */
  server.on('error', (err: NodeJS.ErrnoException) => {
    listening = false;
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[Kerf] port ${RPC_PORT} is already in use, so there is no RPC bridge in this ` +
        'instance. Another Kerf is probably running. Relaunch with a different ' +
        'KERF_RPC_PORT to run both at once.'
      );
      return;
    }
    console.error('[Kerf] RPC bridge failed to start:', err.message);
  });

  server.listen(RPC_PORT, '127.0.0.1', () => {
    listening = true;
    console.log(`[Kerf] RPC bridge on http://127.0.0.1:${RPC_PORT}/rpc`);
    /*
      The token file is written HERE and nowhere else on startup, because
      it may only ever describe an instance that actually owns the port.
      It used to be written unconditionally right after this call — and
      `listen` is asynchronous, so a second instance asking for a port it
      could not have still overwrote the first one's credentials before
      failing. The first instance kept serving and answering 401 to every
      call, which is trap 4 wearing a different hat.
    */
    onReady?.();
  });

  return server;
}
