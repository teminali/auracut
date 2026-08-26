/* ═══════════════════════════════════════════════════════════════════
   Agent backends.

   The Copilot drives a coding CLI in non-interactive mode and gives it
   AuraCut's 48 tools over MCP. Several CLIs can do that job, so this is
   the adapter layer that lets the user choose one.

   MCP is what makes this possible at all. The CLI is a separate OS
   process and cannot touch the zustand stores in the renderer, so it
   needs a channel to ask the window to act — and every one of these
   speaks MCP. The tools are written once and every backend inherits
   them. Without it each backend would need a bespoke integration.

   What differs between them, and therefore what an adapter must supply:

     • where the binary lives
     • how MCP servers are configured — a flag for one, a settings file
       for another, TOML for a third
     • the flags for a single non-interactive turn with tools approved
     • the shape of the streamed output

   NOT here: Antigravity. It is an IDE, and the `antigravity-ide` binary
   it ships is Visual Studio Code's file-opening launcher — the script
   still carries Microsoft's copyright header. There is no agent to
   drive. Listing it would recreate exactly the dropdown-that-selects-
   nothing this project already deleted once.

   The normalised event shape is Claude Code's `stream-json`, because
   the renderer already speaks it and it is the most expressive of the
   set. Every other adapter translates into it.
   ═══════════════════════════════════════════════════════════════════ */

import { execFile, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export type BackendId = 'claude' | 'gemini' | 'codex' | 'cursor';

/** One line of normalised agent output. Mirrors Claude Code stream-json. */
export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export interface McpServerSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface PreparedRun {
  cwd: string;
  extraArgs: string[];
  extraEnv: Record<string, string | undefined>;
}

export interface BackendReadiness {
  ready: boolean;
  /** Why it is not ready, in the user's terms. */
  reason?: string;
  /** What they should do about it. */
  fix?: string;
}

export interface AgentBackend {
  id: BackendId;
  label: string;
  vendor: string;
  /** Absolute paths worth trying before falling back to a login shell. */
  candidates: () => string[];
  /** Bare binary name, for the login-shell lookup. */
  bin: string;
  installHint: string;
  /**
   * Whether this adapter's streamed output has been verified against a
   * real run. An unverified adapter still works — it just falls back to
   * showing the final text without the per-tool timeline.
   */
  streamVerified: boolean;
  /** Set up whatever config this CLI needs to reach our MCP server. */
  prepare: (mcp: McpServerSpec, sessionDir: string) => PreparedRun;
  /** Flags for one non-interactive turn with tools auto-approved. */
  buildArgs: (prompt: string, opts: { systemPrompt: string; resumeId: string | null; extraDirs: string[] }) => string[];
  /** Translate one stdout line into zero or more normalised events. */
  translate: (line: string) => AgentEvent[];
  /** Beyond "the binary exists" — is it actually usable? */
  readiness: (binPath: string) => Promise<BackendReadiness>;
}

/* ── Shared helpers ─────────────────────────────────────────────── */

const home = os.homedir();

function bins(name: string): string[] {
  return [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    path.join(home, '.local', 'bin', name),
    path.join(home, '.bun', 'bin', name),
    path.join(home, '.cargo', 'bin', name),
  ];
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

/**
 * Read a CLI's own settings file so a per-run copy can carry the parts
 * we are not trying to change.
 *
 * Load-bearing for Gemini: its workspace settings REPLACE the user's
 * rather than merging into them, so a file containing only `mcpServers`
 * silently drops the auth configuration and every run fails with "set
 * an Auth method". Found by writing exactly that file.
 */
function readJsonIfPresent(file: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/* ── Claude Code ────────────────────────────────────────────────── */

const claude: AgentBackend = {
  id: 'claude',
  label: 'Claude Code',
  vendor: 'Anthropic',
  bin: 'claude',
  candidates: () => [...bins('claude'), path.join(home, '.claude', 'local', 'claude')],
  installHint: 'npm i -g @anthropic-ai/claude-code',
  streamVerified: true,

  prepare: (mcp, sessionDir) => {
    // Claude takes the config as a flag, so nothing global is touched.
    const file = path.join(sessionDir, 'mcp-claude.json');
    writeJson(file, { mcpServers: { auracut: mcp } });
    return {
      cwd: home,
      extraArgs: ['--mcp-config', file, '--strict-mcp-config'],
      extraEnv: { CLAUDECODE: undefined, CLAUDE_CODE_SSE_PORT: undefined },
    };
  },

  buildArgs: (prompt, { systemPrompt, resumeId, extraDirs }) => {
    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      // No TTY to approve on, so a prompt would hang the turn outright.
      '--permission-mode', 'bypassPermissions',
      '--append-system-prompt', systemPrompt,
    ];
    for (const dir of extraDirs) args.push('--add-dir', dir);
    if (resumeId) args.push('--resume', resumeId);
    return args;
  },

  // Already the normalised shape.
  translate: (line) => {
    try {
      return [JSON.parse(line) as AgentEvent];
    } catch {
      return [];
    }
  },

  readiness: async () => ({ ready: true }),
};

/* ── Gemini CLI ─────────────────────────────────────────────────── */

const gemini: AgentBackend = {
  id: 'gemini',
  label: 'Gemini CLI',
  vendor: 'Google',
  bin: 'gemini',
  candidates: () => bins('gemini'),
  installHint: 'npm i -g @google/gemini-cli',
  // The flags are documented by `gemini --help`; the stream-json shape
  // has not been seen on a real run here, so the text fallback carries it.
  streamVerified: false,

  prepare: (mcp, sessionDir) => {
    /*
      Gemini has no per-invocation MCP flag — servers come from settings.
      Writing to the user's global file would be rude and would outlive
      the session, so this makes a throwaway workspace and runs there.
      The user's settings are merged in FIRST because workspace settings
      replace rather than merge, and dropping `selectedAuthType` breaks
      authentication.
    */
    const workspace = path.join(sessionDir, 'gemini-workspace');
    const userSettings = readJsonIfPresent(path.join(home, '.gemini', 'settings.json'));
    writeJson(path.join(workspace, '.gemini', 'settings.json'), {
      ...userSettings,
      mcpServers: { auracut: mcp },
    });
    return { cwd: workspace, extraArgs: [], extraEnv: {} };
  },

  buildArgs: (prompt, { systemPrompt }) => [
    // Gemini has no system-prompt flag, so the instructions ride along
    // with the request itself.
    '-p', `${systemPrompt}\n\n---\n\n${prompt}`,
    '--output-format', 'stream-json',
    '--approval-mode', 'yolo',
    '--allowed-mcp-server-names', 'auracut',
  ],

  translate: (line) => translateGenericStream(line),

  readiness: async (binPath) => {
    /*
      Installed is not ready. This machine had gemini installed and
      authenticated, and every run still failed: the settings file was
      written under an older schema than the installed CLI reads.
      Checking for the binary alone would have called it ready.
    */
    const probe = await run(binPath, ['-p', 'ok'], 20000);
    const text = `${probe.stdout}${probe.stderr}`;
    if (/set an Auth method|GEMINI_API_KEY|not authenticated|login/i.test(text)) {
      return {
        ready: false,
        reason: 'Gemini CLI is installed but not signed in.',
        fix: 'Run `gemini` once in a terminal and complete sign-in, then reopen AuraCut.',
      };
    }
    return { ready: probe.ok || text.trim().length > 0 };
  },
};

/* ── Codex CLI ──────────────────────────────────────────────────── */

const codex: AgentBackend = {
  id: 'codex',
  label: 'Codex CLI',
  vendor: 'OpenAI',
  bin: 'codex',
  candidates: () => bins('codex'),
  installHint: 'npm i -g @openai/codex',
  streamVerified: false,

  prepare: (mcp, sessionDir) => {
    /*
      Codex reads MCP servers from TOML. `CODEX_HOME` moves the whole
      config directory, which keeps a per-run server out of the user's
      own configuration entirely.
    */
    const codexHome = path.join(sessionDir, 'codex-home');
    fs.mkdirSync(codexHome, { recursive: true });

    const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const toml = [
      '[mcp_servers.auracut]',
      `command = "${escape(mcp.command)}"`,
      `args = [${mcp.args.map((a) => `"${escape(a)}"`).join(', ')}]`,
      'env = { ' +
        Object.entries(mcp.env).map(([k, v]) => `${k} = "${escape(v)}"`).join(', ') +
        ' }',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(codexHome, 'config.toml'), toml, 'utf8');

    return { cwd: home, extraArgs: [], extraEnv: { CODEX_HOME: codexHome } };
  },

  buildArgs: (prompt, { systemPrompt }) => [
    'exec',
    '--json',
    // Sandboxing off: the whole point is reaching the editor and the
    // user's media, and there is no TTY to approve anything on.
    '--dangerously-bypass-approvals-and-sandbox',
    `${systemPrompt}\n\n---\n\n${prompt}`,
  ],

  translate: (line) => translateGenericStream(line),

  readiness: async (binPath) => {
    const probe = await run(binPath, ['--version'], 15000);
    const text = `${probe.stdout}${probe.stderr}`;
    if (/not logged in|login|OPENAI_API_KEY/i.test(text)) {
      return {
        ready: false,
        reason: 'Codex CLI is installed but not signed in.',
        fix: 'Run `codex login` in a terminal, then reopen AuraCut.',
      };
    }
    return { ready: probe.ok };
  },
};

/* ── Cursor Agent ───────────────────────────────────────────────── */

const cursor: AgentBackend = {
  id: 'cursor',
  label: 'Cursor Agent',
  vendor: 'Cursor',
  bin: 'cursor-agent',
  candidates: () => bins('cursor-agent'),
  installHint: 'curl https://cursor.com/install -fsS | bash',
  streamVerified: false,

  prepare: (mcp, sessionDir) => {
    const workspace = path.join(sessionDir, 'cursor-workspace');
    writeJson(path.join(workspace, '.cursor', 'mcp.json'), { mcpServers: { auracut: mcp } });
    return { cwd: workspace, extraArgs: [], extraEnv: {} };
  },

  buildArgs: (prompt, { systemPrompt }) => [
    '-p', `${systemPrompt}\n\n---\n\n${prompt}`,
    '--output-format', 'stream-json',
    '--approve-mcps',
  ],

  translate: (line) => translateGenericStream(line),

  readiness: async (binPath) => {
    const probe = await run(binPath, ['--version'], 15000);
    const text = `${probe.stdout}${probe.stderr}`;
    if (/not logged in|login|CURSOR_API_KEY/i.test(text)) {
      return {
        ready: false,
        reason: 'Cursor Agent is installed but not signed in.',
        fix: 'Run `cursor-agent login` in a terminal, then reopen AuraCut.',
      };
    }
    return { ready: probe.ok };
  },
};

/* ── Translating the other CLIs' output ─────────────────────────── */

/**
 * A tolerant reader for stream-json output that is not Claude's.
 *
 * These formats converge but do not match, and guessing at a shape
 * produces a UI that silently shows nothing. So: recognise the fields
 * that are common, ignore what is not understood, and let the session
 * layer fall back to raw text if a run produces no recognised events at
 * all. Degrading to "you get the answer without the tool timeline" is
 * honest; degrading to a blank panel is not.
 */
function translateGenericStream(line: string): AgentEvent[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }

  const out: AgentEvent[] = [];
  const type = String(parsed.type ?? '');

  // Assistant text, under any of the names these CLIs use for it.
  const text =
    pickString(parsed, 'text') ??
    pickString(parsed, 'delta') ??
    pickString(parsed, 'content') ??
    pickString(parsed, 'message');
  if (text && /text|message|assistant|item|agent/i.test(type)) {
    out.push({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
  }

  // A tool starting.
  const toolName =
    pickString(parsed, 'name') ??
    pickString(parsed, 'tool') ??
    pickString(parsed, 'tool_name');
  if (toolName && /tool|function|command/i.test(type) && !/result|output|end|complete/i.test(type)) {
    out.push({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: pickString(parsed, 'id') ?? pickString(parsed, 'call_id') ?? `t_${toolName}`,
          name: toolName,
          input: (parsed.input ?? parsed.arguments ?? parsed.args ?? {}) as Record<string, unknown>,
        }],
      },
    });
  }

  // A tool finishing.
  if (/result|output|end|complete/i.test(type) && (parsed.tool_use_id || parsed.call_id || parsed.id)) {
    const preview =
      pickString(parsed, 'output') ??
      pickString(parsed, 'result') ??
      pickString(parsed, 'content') ??
      '';
    out.push({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: String(parsed.tool_use_id ?? parsed.call_id ?? parsed.id),
          is_error: Boolean(parsed.is_error ?? parsed.error),
          content: preview,
        }],
      },
    });
  }

  if (/^(result|done|turn_complete|finished)$/i.test(type)) {
    out.push({
      type: 'result',
      result: pickString(parsed, 'result') ?? pickString(parsed, 'text') ?? '',
      is_error: Boolean(parsed.is_error),
      total_cost_usd: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : undefined,
    });
  }

  return out;
}

function pickString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (typeof value === 'string' && value.trim()) return value;
  // Some shapes nest the text one level down.
  if (value && typeof value === 'object' && 'text' in (value as Record<string, unknown>)) {
    const inner = (value as Record<string, unknown>).text;
    if (typeof inner === 'string' && inner.trim()) return inner;
  }
  return null;
}

/* ── Detection ──────────────────────────────────────────────────── */

function run(
  bin: string,
  args: string[],
  timeout: number
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

export const BACKENDS: AgentBackend[] = [claude, gemini, codex, cursor];

export function getBackend(id: BackendId): AgentBackend | undefined {
  return BACKENDS.find((b) => b.id === id);
}

const pathCache = new Map<BackendId, string | null>();

/**
 * Where this backend's binary is, or null.
 *
 * A GUI app launched from Finder has a minimal PATH with no Homebrew and
 * no user bin directories, so bare names do not resolve — hence the
 * explicit candidates and the login-shell fallback.
 */
export function findBackendBinary(backend: AgentBackend): string | null {
  const cached = pathCache.get(backend.id);
  if (cached !== undefined) return cached;

  for (const candidate of backend.candidates()) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      pathCache.set(backend.id, candidate);
      return candidate;
    } catch {
      /* keep looking */
    }
  }

  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const found = execFileSync(shell, ['-lic', `command -v ${backend.bin}`], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().split('\n').pop();

    if (found && fs.existsSync(found)) {
      pathCache.set(backend.id, found);
      return found;
    }
  } catch {
    /* not installed */
  }

  pathCache.set(backend.id, null);
  return null;
}

export interface BackendStatus {
  id: BackendId;
  label: string;
  vendor: string;
  installed: boolean;
  path: string | null;
  version: string | null;
  ready: boolean;
  reason?: string;
  fix?: string;
  installHint: string;
  streamVerified: boolean;
}

const versionCache = new Map<BackendId, string | null>();

async function versionOf(backend: AgentBackend, binPath: string): Promise<string | null> {
  const cached = versionCache.get(backend.id);
  if (cached !== undefined) return cached;
  const probe = await run(binPath, ['--version'], 2500);
  const value = probe.ok ? probe.stdout.trim().split('\n')[0] : null;
  versionCache.set(backend.id, value);
  return value;
}

/**
 * Survey every backend.
 *
 * `deep` runs each one's readiness probe, which can spawn the binary and
 * is therefore slow — the quick pass is for the picker's first paint, so
 * the UI never has to guess while it waits.
 */
export async function surveyBackends(deep = false): Promise<BackendStatus[]> {
  return Promise.all(
    BACKENDS.map(async (backend) => {
      const binPath = findBackendBinary(backend);
      const base: BackendStatus = {
        id: backend.id,
        label: backend.label,
        vendor: backend.vendor,
        installed: Boolean(binPath),
        path: binPath,
        version: null,
        ready: Boolean(binPath),
        installHint: backend.installHint,
        streamVerified: backend.streamVerified,
      };
      if (!binPath) {
        return { ...base, ready: false, reason: `${backend.label} is not installed.`, fix: backend.installHint };
      }

      base.version = await versionOf(backend, binPath);
      if (!deep) return base;

      const readiness = await backend.readiness(binPath);
      return { ...base, ...readiness };
    })
  );
}

/* ── Installing and signing in ──────────────────────────────────── */

/**
 * Install a backend's CLI from inside the app.
 *
 * Every one of these installs with a package manager, so this is a real
 * install and not a link to a download page. The npm ones need a Node
 * that a GUI app can actually find — the same minimal-PATH problem the
 * binaries have — so the command runs through a login shell.
 */
export async function installBackend(
  id: BackendId,
  onProgress: (line: string) => void
): Promise<{ ok: boolean; message: string }> {
  const backend = getBackend(id);
  if (!backend) return { ok: false, message: `Unknown agent "${id}".` };

  onProgress(`Running: ${backend.installHint}`);

  const shell = process.env.SHELL || '/bin/zsh';
  const result = await new Promise<{ ok: boolean; out: string }>((resolve) => {
    const child = execFile(
      shell,
      ['-lic', backend.installHint],
      { timeout: 600_000, maxBuffer: 1024 * 1024 * 8 },
      (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}` })
    );
    child.stdout?.on('data', (chunk: Buffer | string) => onProgress(String(chunk).trim()));
    child.stderr?.on('data', (chunk: Buffer | string) => onProgress(String(chunk).trim()));
  });

  // Detection is cached, and the whole point is that it just changed.
  pathCache.delete(id);
  versionCache.delete(id);

  const found = findBackendBinary(backend);
  if (!found) {
    return {
      ok: false,
      message:
        `The install command finished but ${backend.label} still is not on the path. ` +
        `Last output:\n${result.out.trim().slice(-600)}`,
    };
  }
  return { ok: true, message: `${backend.label} installed at ${found}.` };
}

/**
 * Open a real terminal running the backend's sign-in.
 *
 * Sign-in is an OAuth flow with a browser round trip and a prompt — it
 * cannot happen inside a headless child process, and pretending
 * otherwise would hang the turn. Handing the user a terminal that is
 * already running the right command is the honest version of a button.
 */
export function signInCommand(id: BackendId): string | null {
  switch (id) {
    case 'claude': return 'claude';
    case 'gemini': return 'gemini';
    case 'codex': return 'codex login';
    case 'cursor': return 'cursor-agent login';
    default: return null;
  }
}
