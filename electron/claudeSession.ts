/* ═══════════════════════════════════════════════════════════════════
   Claude Code session.

   The Copilot does not implement an agent — it runs one. Each turn
   spawns the Claude Code CLI in non-interactive streaming mode with
   AuraCut registered as an MCP server, so the model gets its whole
   native toolset (Bash, Read, Write, WebFetch, downloads) alongside
   every AuraCut editing tool, and edits land in the live window.

   That is why this exists at all: writing our own loop would have meant
   re-implementing file access, downloads and web fetch by hand, badly,
   and paying per token for the privilege. The CLI already has them and
   bills against the user's existing subscription.
   ═══════════════════════════════════════════════════════════════════ */

import { spawn, ChildProcessWithoutNullStreams, execFile } from 'child_process';
import { app, BrowserWindow } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { RPC_PORT, RPC_TOKEN } from './rpcServer';

export interface ClaudeEvent {
  type: string;
  [key: string]: unknown;
}

let active: ChildProcessWithoutNullStreams | null = null;
let lastSessionId: string | null = null;

/* ── Locating the CLI ─────────────────────────────────────────────
   A GUI app launched from Finder inherits a minimal PATH that usually
   excludes Homebrew and nvm, so `claude` is very often not on it even
   though it works fine in the user's terminal. Search the usual homes
   before giving up.                                                    */

const CANDIDATE_PATHS = [
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  path.join(os.homedir(), '.claude', 'local', 'claude'),
  path.join(os.homedir(), '.local', 'bin', 'claude'),
  path.join(os.homedir(), '.bun', 'bin', 'claude'),
];

let cachedCliPath: string | null | undefined;

export function findClaudeCli(): string | null {
  if (cachedCliPath !== undefined) return cachedCliPath;

  for (const candidate of CANDIDATE_PATHS) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      cachedCliPath = candidate;
      return candidate;
    } catch {
      /* keep looking */
    }
  }

  // Last resort: ask a login shell, which has the user's real PATH.
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const { execFileSync } = require('child_process') as typeof import('child_process');
    const found = execFileSync(shell, ['-lic', 'command -v claude'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split('\n')
      .pop();
    if (found && fs.existsSync(found)) {
      cachedCliPath = found;
      return found;
    }
  } catch {
    /* not installed */
  }

  cachedCliPath = null;
  return null;
}

let cachedVersion: string | null | undefined;

/**
 * The CLI's version string.
 *
 * Cached and time-boxed, because the status call that uses it gates the
 * whole Copilot: `claude --version` spawns the binary and takes ~0.6s
 * cold, and while it ran the drawer showed "built-in" and routed
 * prompts to the fallback planner. The version is cosmetic; whether the
 * binary EXISTS is the load-bearing fact, and that is a file check.
 */
export function getCliVersion(cliPath: string): Promise<string | null> {
  if (cachedVersion !== undefined) return Promise.resolve(cachedVersion);

  return new Promise((resolve) => {
    const settle = (value: string | null) => {
      cachedVersion = value;
      resolve(value);
    };
    // Never let a wedged CLI hold the status open.
    const timer = setTimeout(() => settle(null), 2500);

    execFile(cliPath, ['--version'], { timeout: 8000 }, (err, stdout) => {
      clearTimeout(timer);
      settle(err ? null : stdout.trim());
    });
  });
}

/* ── MCP config ───────────────────────────────────────────────────
   Written fresh per launch because it carries the session token.      */

export function writeMcpConfig(): string {
  const dir = app.getPath('userData');
  const file = path.join(dir, 'mcp-auracut.json');

  /*
    The shim runs as its own process, so it must be a real file. Inside a
    packaged app __dirname points into app.asar, which nothing can spawn
    from — electron-builder is told to unpack this one file, and the path
    is rewritten to match.
  */
  const shim = path
    .join(__dirname, 'mcpStdio.cjs')
    .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

  const config = {
    mcpServers: {
      auracut: {
        // Electron's own binary, run as plain Node — no separate install.
        command: process.execPath,
        args: [shim],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          AURACUT_RPC_PORT: String(RPC_PORT),
          AURACUT_RPC_TOKEN: RPC_TOKEN,
        },
      },
    },
  };

  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8');
  return file;
}

const SYSTEM_APPEND = [
  'You are the editing agent inside AuraCut, a desktop video editor.',
  '',
  'The AuraCut MCP tools (mcp__auracut__*) act on the project the user is',
  'looking at right now — changes appear immediately in their window. Call',
  'describe_timeline first when you need to know what is loaded.',
  '',
  'You also have your normal tools. Use them: read media off disk, download',
  'a file the user links, inspect a folder. To bring media in, get the file',
  'onto disk and then call mcp__auracut__import_media_from_path.',
  '',
  'When AuraCut cannot do what was asked:',
  '  1. Say so plainly. Do not quietly substitute something else and call it done.',
  '  2. Call mcp__auracut__report_capability_gap so the developer sees the request.',
  '  3. Offer the closest thing AuraCut CAN do, and only build it if the user agrees',
  '     — or, if you did build a workaround, log that too and say what differs.',
  '',
  'Be brief. This is a chat panel beside a video timeline, not a terminal —',
  'a sentence about what you did beats a report. Do not restate the tool',
  'calls the UI already shows.',
].join('\n');

export interface StartOptions {
  prompt: string;
  /** Continue the previous exchange rather than starting cold. */
  resume?: boolean;
  /** Extra folders the agent may read from. */
  extraDirs?: string[];
}

export function isRunning(): boolean {
  return active !== null;
}

export function stopSession(): void {
  active?.kill('SIGTERM');
  active = null;
}

export function resetSession(): void {
  stopSession();
  lastSessionId = null;
}

/**
 * Run one turn. Events stream to the renderer as they arrive; the promise
 * settles when the CLI exits.
 */
export function startSession(window: BrowserWindow, options: StartOptions): Promise<void> {
  const cli = findClaudeCli();
  if (!cli) {
    window.webContents.send('claude:event', {
      type: 'auracut_error',
      message:
        'The Claude Code CLI was not found. Install it with:\n\n  npm i -g @anthropic-ai/claude-code\n\nthen reopen AuraCut.',
    });
    return Promise.resolve();
  }

  stopSession();

  const mediaDirs = ['Downloads', 'Movies', 'Desktop', 'Pictures']
    .map((d) => path.join(os.homedir(), d))
    .filter((d) => fs.existsSync(d));

  const args = [
    '-p',
    options.prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--mcp-config', writeMcpConfig(),
    // Only our server: the user's other MCP servers and plugins would add
    // startup latency and a much larger system prompt for no benefit here.
    '--strict-mcp-config',
    // There is no TTY to approve anything on, so a prompt would simply
    // hang the turn. The surface is bounded by --allowedTools instead.
    '--permission-mode', 'bypassPermissions',
    '--append-system-prompt', SYSTEM_APPEND,
  ];

  for (const dir of [...mediaDirs, ...(options.extraDirs ?? [])]) {
    args.push('--add-dir', dir);
  }

  if (options.resume && lastSessionId) {
    args.push('--resume', lastSessionId);
  }

  const child = spawn(cli, args, {
    cwd: os.homedir(),
    env: {
      ...process.env,
      // Never let a nested-session guard or a stray key from our own
      // environment leak into the user's session.
      CLAUDECODE: undefined,
      CLAUDE_CODE_SSE_PORT: undefined,
      ELECTRON_RUN_AS_NODE: undefined,
    } as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  active = child;

  const emit = (event: ClaudeEvent) => {
    if (!window.isDestroyed()) window.webContents.send('claude:event', event);
  };

  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        try {
          const event = JSON.parse(line) as ClaudeEvent;
          // Remember the session so the next turn can continue it.
          if (typeof event.session_id === 'string') lastSessionId = event.session_id;
          emit(event);
        } catch {
          /* a non-JSON line is diagnostic noise — ignore it */
        }
      }
      newline = buffer.indexOf('\n');
    }
  });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });

  return new Promise<void>((resolve) => {
    child.on('error', (err) => {
      emit({ type: 'auracut_error', message: `Could not start Claude Code: ${err.message}` });
      active = null;
      resolve();
    });

    child.on('close', (code) => {
      if (code !== 0 && code !== null) {
        emit({
          type: 'auracut_error',
          message: stderr.trim() || `Claude Code exited with code ${code}.`,
        });
      }
      emit({ type: 'auracut_done' });
      active = null;
      resolve();
    });
  });
}
