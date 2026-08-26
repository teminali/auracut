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
import {
  BackendId, AgentBackend, getBackend, findBackendBinary, surveyBackends, BackendStatus,
} from './agentBackends';

export interface ClaudeEvent {
  type: string;
  [key: string]: unknown;
}

let active: ChildProcessWithoutNullStreams | null = null;

/** Which CLI drives the Copilot. Claude Code is the verified default. */
let selectedBackendId: BackendId = 'claude';

export function setBackend(id: BackendId): void {
  if (getBackend(id)) {
    selectedBackendId = id;
    lastSessionId = null; // a session id belongs to the CLI that made it
  }
}

export function getBackendId(): BackendId {
  return selectedBackendId;
}

export function listBackends(deep = false): Promise<BackendStatus[]> {
  return surveyBackends(deep);
}

/** Scratch space for per-run config files, cleaned up with the app. */
function sessionDir(): string {
  const dir = path.join(app.getPath('userData'), 'agent-session');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
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

/** Claude specifically — kept for the status IPC and the default path. */
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

/** The one server spec, in a form each backend can render its own way. */
export function mcpServerSpec(): { command: string; args: string[]; env: Record<string, string> } {
  /*
    The shim runs as its own process, so it must be a real file. Inside a
    packaged app __dirname points into app.asar, which nothing can spawn
    from — electron-builder is told to unpack this one file, and the path
    is rewritten to match.
  */
  const shim = path
    .join(__dirname, 'mcpStdio.cjs')
    .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

  return {
    // Electron's own binary, run as plain Node — no separate install.
    command: process.execPath,
    args: [shim],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      AURACUT_RPC_PORT: String(RPC_PORT),
      AURACUT_RPC_TOKEN: RPC_TOKEN,
    },
  };
}

export function writeMcpConfig(): string {
  const dir = app.getPath('userData');
  const file = path.join(dir, 'mcp-auracut.json');

  /*
    The shim runs as its own process, so it must be a real file. Inside a
    packaged app __dirname points into app.asar, which nothing can spawn
    from — electron-builder is told to unpack this one file, and the path
    is rewritten to match.
  */
  const config = { mcpServers: { auracut: mcpServerSpec() } };
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
  const chosen = getBackend(selectedBackendId)!;
  const cli = findBackendBinary(chosen);
  if (!cli) {
    window.webContents.send('claude:event', {
      type: 'auracut_error',
      message:
        `${chosen.label} was not found. Install it with:\n\n  ${chosen.installHint}\n\n` +
        'then reopen AuraCut — or pick a different agent from the Copilot header.',
    });
    return Promise.resolve();
  }

  stopSession();

  const mediaDirs = ['Downloads', 'Movies', 'Desktop', 'Pictures']
    .map((d) => path.join(os.homedir(), d))
    .filter((d) => fs.existsSync(d));

  const backend = getBackend(selectedBackendId)!;
  const dir = sessionDir();

  /*
    Each CLI reaches our MCP server a different way — a flag for Claude,
    a workspace settings file for Gemini, a TOML config directory for
    Codex. The adapter writes whatever it needs and tells us where to run.
  */
  const prepared = backend.prepare(mcpServerSpec(), dir);

  const args = [
    ...backend.buildArgs(options.prompt, {
      systemPrompt: SYSTEM_APPEND,
      resumeId: options.resume ? lastSessionId : null,
      extraDirs: [...mediaDirs, ...(options.extraDirs ?? [])],
    }),
    ...prepared.extraArgs,
  ];

  const child = spawn(cli, args, {
    cwd: prepared.cwd,
    env: {
      ...process.env,
      // Never let a nested-session guard or a stray key from our own
      // environment leak into the user's session.
      ELECTRON_RUN_AS_NODE: undefined,
      ...prepared.extraEnv,
    } as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  active = child;

  const emit = (event: ClaudeEvent) => {
    if (!window.isDestroyed()) window.webContents.send('claude:event', event);
  };

  let buffer = '';
  /*
    Everything stdout produced, and whether anything was recognised.

    Only the Claude adapter's stream shape has been verified against a
    real run. If another CLI emits something this build does not
    understand, the panel would otherwise sit empty while the turn
    succeeded — so the raw output becomes the answer instead. Losing the
    per-tool timeline is a fair degradation; a blank panel is not.
  */
  let rawOutput = '';
  let recognisedAnything = false;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    rawOutput += chunk;
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        for (const event of backend.translate(line)) {
          recognisedAnything = true;
          // Remember the session so the next turn can continue it.
          if (typeof event.session_id === 'string') lastSessionId = event.session_id as string;
          emit(event as ClaudeEvent);
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
      emit({ type: 'auracut_error', message: `Could not start ${backend.label}: ${err.message}` });
      active = null;
      resolve();
    });

    child.on('close', (code) => {
      if (code !== 0 && code !== null) {
        emit({
          type: 'auracut_error',
          message: stderr.trim() || `${backend.label} exited with code ${code}.`,
        });
        emit({ type: 'auracut_done' });
        active = null;
        resolve();
        return;
      }

      /*
        The turn succeeded but nothing in its output was recognised —
        this adapter's stream shape is not the one the CLI produced.
        Hand over what it said rather than showing an empty panel, and
        say why the step-by-step is missing.
      */
      if (!recognisedAnything) {
        const text = plainTextFrom(rawOutput);
        emit({
          type: 'result',
          result: text || `${backend.label} finished without producing readable output.`,
          is_error: false,
        });
        if (text) {
          emit({
            type: 'auracut_notice',
            message:
              `AuraCut does not yet parse ${backend.label}'s streamed output, so the ` +
              'per-tool steps are not shown. The answer above is what it returned.',
          });
        }
      }

      emit({ type: 'auracut_done' });
      active = null;
      resolve();
    });
  });
}

/**
 * Salvage readable text from output we could not structure.
 *
 * Takes any `text`-ish field out of JSON lines, and otherwise keeps the
 * line as-is, so a plain-text CLI and a JSON one both survive.
 */
function plainTextFrom(raw: string): string {
  const parts: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      for (const key of ['result', 'text', 'content', 'message', 'response']) {
        const value = parsed[key];
        if (typeof value === 'string' && value.trim()) { parts.push(value.trim()); break; }
      }
    } catch {
      parts.push(trimmed);
    }
  }
  return parts.join('\n').trim().slice(0, 8000);
}
