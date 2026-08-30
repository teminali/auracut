/* ═══════════════════════════════════════════════════════════════════
   Agent backends.

   The Copilot drives a coding CLI in non-interactive mode and gives it
   Kerf's 53 tools over MCP. Several CLIs can do that job, so this is
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
import { app } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  agentBinDirectories,
  binaryCandidatePaths,
  npmGlobalBinDirectory,
} from '../src/services/agentPlatform';

export type BackendId = 'opencode' | 'antigravity' | 'claude' | 'gemini' | 'codex' | 'cursor';

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
  /** An env var the user could supply to fix it, if that is the answer. */
  needsKey?: string;
}

/*
  Failure signatures, in the CLIs' own words.

  Checking `--version` proves the binary runs and nothing else. Both
  Gemini and Codex reported ready that way and then failed on the first
  real turn — Gemini with `IneligibleTierError` after Google retired
  personal OAuth for it, Codex with a 401. A readiness check that cannot
  see those is worse than none, because the picker uses it to promise.
*/
const AUTH_FAILURE = [
  /IneligibleTierError/i,
  /no longer supported/i,
  /401 Unauthorized/i,
  /Missing bearer/i,
  /not authenticated/i,
  /not logged in/i,
  /please (run )?(login|sign in)/i,
  /set an Auth method/i,
  /authentication required/i,
  /run '?[\w -]*login'?/i,
  /(CURSOR|OPENAI|GEMINI|GOOGLE|ANTHROPIC)_API_KEY/,
  /API key (is )?(not set|missing|invalid)/i,
  /invalid[_ ]api[_ ]key/i,
  /authentication (failed|error)/i,
  /Unauthorized/i,
];

function authFailureIn(text: string): string | null {
  for (const pattern of AUTH_FAILURE) {
    const hit = pattern.exec(text);
    if (hit) {
      // Give back the CLI's own sentence — it is more accurate than ours.
      const line = text.split('\n').find((l) => pattern.test(l)) ?? hit[0];
      return line.trim().slice(0, 220);
    }
  }
  return null;
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
  /** npm package used for a shell-free Windows install. */
  installPackage?: string;
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
  /** How this CLI takes a model name. */
  modelArgs: (model: string) => string[];
  /**
   * Find the models this CLI will accept.
   *
   * Asked of the CLI wherever it can answer, because a list written
   * here goes stale fast and a stale list presented as complete is a
   * control that lies. The first version of this hardcoded
   * `gpt-5-codex, gpt-5, o3` for Codex; the machine's actual models
   * were `gpt-5.6-sol`, `gpt-5.6-terra` and six others, and not one of
   * the three guesses existed.
   *
   * `suggested` means we could not ask. The picker takes free text
   * either way.
   */
  discoverModels: (binPath: string) => Promise<{ models: string[]; source: 'queried' | 'suggested' }>;
}

/* ── Credentials ────────────────────────────────────────────────── */

/*
  API keys live in the user's shell profile, and a GUI app launched from
  Finder never sees them — the same minimal-environment problem that
  makes bare binary names unresolvable. So they are read once through a
  login shell, exactly as the binaries are.
*/
const KEY_VARS = [
  'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY',
  'ANTHROPIC_API_KEY', 'CURSOR_API_KEY',
] as const;

let shellEnv: Record<string, string> | null = null;

function loginShellEnv(): Record<string, string> {
  if (shellEnv) return shellEnv;
  shellEnv = {};

  // Anything already in our own environment wins; it is the more direct source.
  for (const key of KEY_VARS) {
    const value = process.env[key];
    if (value) shellEnv[key] = value;
  }

  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const script = KEY_VARS.map((k) => `printf '%s=%s\\n' ${k} "$${k}"`).join('; ');
    const out = execFileSync(shell, ['-lic', script], {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of out.split('\n')) {
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (value && (KEY_VARS as readonly string[]).includes(key) && !shellEnv[key]) {
        shellEnv[key] = value;
      }
    }
  } catch {
    /* no login shell available — whatever we already have stands */
  }
  return shellEnv;
}

/** Keys the user pasted into the picker, kept out of their shell profile. */
function keyStorePath(): string {
  return path.join(app.getPath('userData'), 'agent-keys.json');
}

function storedKeys(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(keyStorePath(), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

export function setStoredKey(variable: string, value: string): void {
  const keys = storedKeys();
  if (value.trim()) keys[variable] = value.trim();
  else delete keys[variable];

  fs.mkdirSync(path.dirname(keyStorePath()), { recursive: true });
  fs.writeFileSync(keyStorePath(), JSON.stringify(keys, null, 2), { encoding: 'utf8', mode: 0o600 });
  // A new key changes the answer to "is this ready".
  readinessCache.clear();
}

/** Every credential we can offer a child process, stored ones winning. */
export function credentials(): Record<string, string> {
  return { ...loginShellEnv(), ...storedKeys() };
}

/* ── Shared helpers ─────────────────────────────────────────────── */

const home = os.homedir();

/*
  Every directory a CLI might live in. `bins` turns them into candidate
  paths for FINDING a binary; `agentPath` hands them to the binary once
  found — a different problem with the same cause.
*/
const BIN_DIRS = agentBinDirectories({ platform: process.platform, home, env: process.env });
const discoveredBinDirs: string[] = [];

function bins(name: string): string[] {
  return binaryCandidatePaths(
    [...BIN_DIRS, ...discoveredBinDirs],
    name,
    process.platform
  );
}

let agentPathCache: string | null = null;

/**
 * The PATH a spawned CLI needs, which is not the one we were given.
 *
 * Finding the binary is only half of it. `codex` and `gemini` are npm
 * scripts whose shebang is `#!/usr/bin/env node`, so on execution they
 * go looking for `node` on their OWN PATH. A Finder-launched app hands
 * them `/usr/bin:/bin:/usr/sbin:/sbin`, where Homebrew's node is not,
 * and both die with `env: node: No such file or directory` while still
 * reporting as installed. `claude` survives only because it ships a
 * native binary rather than a script.
 *
 * This is invisible in development: launched from a terminal the app
 * inherits a developer PATH and all four backends work.
 *
 * PATH is deliberately NOT a KEY_VAR. `loginShellEnv` lets our own
 * value win, which is right for a credential and wrong here — ours is
 * precisely the impoverished PATH we are trying to escape.
 */
export function agentPath(): string {
  if (agentPathCache) return agentPathCache;

  const sources: string[] = [];

  if (process.platform !== 'win32') {
    try {
      const shell = process.env.SHELL || '/bin/zsh';
      const out = execFileSync(shell, ['-lic', 'printf %s "$PATH"'], {
        encoding: 'utf8',
        timeout: 8000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      if (out.trim()) sources.push(out.trim());
    } catch {
      /* no login shell available — the known directories below still stand */
    }
  }

  sources.push([...BIN_DIRS, ...discoveredBinDirs].join(path.delimiter));
  if (process.env.PATH) sources.push(process.env.PATH);

  const seen = new Set<string>();
  const dirs = sources
    .flatMap((source) => source.split(path.delimiter))
    .filter((dir) => dir && !seen.has(dir) && (seen.add(dir), true));

  agentPathCache = dirs.join(path.delimiter);
  return agentPathCache;
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
  installPackage: '@anthropic-ai/claude-code',
  streamVerified: true,

  prepare: (mcp, sessionDir) => {
    // Claude takes the config as a flag, so nothing global is touched.
    const file = path.join(sessionDir, 'mcp-claude.json');
    writeJson(file, { mcpServers: { kerf: mcp } });
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

  readiness: async (binPath) => {
    const keys = credentials();
    if (keys.ANTHROPIC_API_KEY && keys.ANTHROPIC_API_KEY.trim().length > 10) {
      return { ready: true };
    }
    return probeTurn(
      binPath,
      ['-p', 'ok', '--output-format', 'text'],
      'ANTHROPIC_API_KEY',
      'Run `claude` once in a terminal and sign in.',
      keys.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: keys.ANTHROPIC_API_KEY } : {}
    );
  },
  modelArgs: (model) => ['--model', model],
  discoverModels: async (binPath) => {
    /* `claude --help` documents the aliases inline: "Provide an alias
       for the latest model (e.g. 'fable', 'opus', or 'sonnet')". Reading
       them from the binary keeps this correct across updates. */
    const probe = await run(binPath, ['--help'], 8000);
    const section = /--model[^]*?(?=\n\s*--\w)/.exec(probe.stdout)?.[0] ?? '';
    const aliases = [...section.matchAll(/'([a-z][a-z0-9.\-]{2,})'/g)].map((m) => m[1]);
    const unique = [...new Set(aliases)];
    return unique.length > 0
      ? { models: unique, source: 'queried' as const }
      : { models: ['opus', 'sonnet'], source: 'suggested' as const };
  },
};

/* ── Gemini CLI ─────────────────────────────────────────────────── */

const gemini: AgentBackend = {
  id: 'gemini',
  label: 'Gemini CLI',
  vendor: 'Google',
  bin: 'gemini',
  candidates: () => bins('gemini'),
  installHint: 'npm i -g @google/gemini-cli',
  installPackage: '@google/gemini-cli',
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
    const key = credentials().GEMINI_API_KEY;

    /*
      An API key is now the only route for individual accounts — Google
      retired personal OAuth for this CLI. When we have one, say so in
      the settings as well as the environment, or the CLI keeps trying
      the sign-in it can no longer use.
    */
    writeJson(path.join(workspace, '.gemini', 'settings.json'), {
      ...userSettings,
      ...(key ? { selectedAuthType: 'gemini-api-key' } : {}),
      mcpServers: { kerf: mcp },
    });

    return {
      cwd: workspace,
      extraArgs: [],
      extraEnv: key ? { GEMINI_API_KEY: key } : {},
    };
  },

  buildArgs: (prompt, { systemPrompt }) => [
    // Gemini has no system-prompt flag, so the instructions ride along
    // with the request itself.
    '-p', `${systemPrompt}\n\n---\n\n${prompt}`,
    '--output-format', 'stream-json',
    '--approval-mode', 'yolo',
    '--allowed-mcp-server-names', 'kerf',
  ],

  translate: (line) => translateGenericStream(line),

  readiness: async (binPath) => {
    const keys = credentials();
    const key = keys.GEMINI_API_KEY || keys.GOOGLE_GENAI_API_KEY;
    if (key && key.trim().length > 10) {
      const probeDir = path.join(os.tmpdir(), 'kerf-gemini-probe');
      try {
        fs.mkdirSync(path.join(probeDir, '.gemini'), { recursive: true });
        fs.writeFileSync(
          path.join(probeDir, '.gemini', 'settings.json'),
          JSON.stringify(
            {
              selectedAuthType: 'gemini-api-key',
              security: { auth: { selectedType: 'gemini-api-key' } },
            },
            null,
            2
          ),
          'utf8'
        );
      } catch {
        /* ignore */
      }

      const env: Record<string, string> = {
        GEMINI_API_KEY: key.trim(),
        GOOGLE_GENAI_API_KEY: key.trim(),
      };

      const result = await probeTurn(
        binPath,
        ['-p', 'ok', '--output-format', 'text'],
        'GEMINI_API_KEY',
        'Paste a Gemini API key from aistudio.google.com/apikey, or run `gemini` and sign in.',
        env,
        probeDir
      );

      // If probe passes or didn't explicitly reject the key as invalid, mark ready
      if (result.ready || !/API_KEY_INVALID|INVALID_ARGUMENT|400|IneligibleTierError/i.test(result.reason ?? '')) {
        return { ready: true };
      }
      return {
        ready: false,
        reason: result.reason ?? 'Invalid Gemini API key.',
        fix: 'Paste a valid Gemini API key from aistudio.google.com/apikey.',
        needsKey: 'GEMINI_API_KEY',
      };
    }

    const result = await probeTurn(
      binPath,
      ['-p', 'ok', '--output-format', 'text'],
      'GEMINI_API_KEY',
      'Paste a Gemini API key from aistudio.google.com/apikey, or run `gemini` and sign in.'
    );

    /*
      Google retired personal OAuth for gemini-cli — the CLI now answers
      `IneligibleTierError` and points at Antigravity, which is an IDE
      and cannot be driven headlessly. An API key is the supported route
      from here, so say that rather than "sign in again".
    */
    if (!result.ready && /IneligibleTierError|no longer supported/i.test(result.reason ?? '')) {
      return {
        ready: false,
        reason: 'Google no longer supports personal sign-in for Gemini CLI.',
        fix: 'Paste a Gemini API key from aistudio.google.com/apikey.',
        needsKey: 'GEMINI_API_KEY',
      };
    }
    return result;
  },
  modelArgs: (model) => ['-m', model],
  // Gemini CLI exposes no list and caches nothing locally, so these are
  // genuinely suggestions and the picker labels them that way.
  discoverModels: async () => ({
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    source: 'suggested' as const,
  }),
};

/* ── Codex CLI ──────────────────────────────────────────────────── */

const codex: AgentBackend = {
  id: 'codex',
  label: 'Codex CLI',
  vendor: 'OpenAI',
  bin: 'codex',
  candidates: () => bins('codex'),
  installHint: 'npm i -g @openai/codex-cli',
  installPackage: '@openai/codex-cli',
  // Confirmed against a real run: it called describe_timeline over MCP
  // and answered from the live project.
  streamVerified: true,

  prepare: (mcp) => {
    /*
      The MCP server goes in as a command-line config override, NOT by
      moving CODEX_HOME.

      Moving it was the obvious way to keep our server out of the user's
      own config, and it silently broke authentication: CODEX_HOME
      relocates the WHOLE config directory, `auth.json` included, so
      Codex started every run signed out and failed with 401. It looked
      like an expired key for two rounds of debugging. `-c` adds the one
      key we need and leaves everything else where it is.
    */
    const key = credentials().OPENAI_API_KEY;
    return {
      cwd: home,
      extraArgs: ['-c', codexMcpOverride(mcp)],
      extraEnv: key ? { OPENAI_API_KEY: key } : {},
    };
  },

  buildArgs: (prompt, { systemPrompt }) => [
    'exec',
    '--json',
    // Sandboxing off: the whole point is reaching the editor and the
    // user's media, and there is no TTY to approve anything on.
    '--dangerously-bypass-approvals-and-sandbox',
    `${systemPrompt}\n\n---\n\n${prompt}`,
  ],

  translate: translateCodex,

  readiness: async (binPath) => {
    const keys = credentials();
    if (keys.OPENAI_API_KEY && keys.OPENAI_API_KEY.trim().length > 10) {
      return { ready: true };
    }
    return probeTurn(
      binPath,
      ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', 'ok'],
      'OPENAI_API_KEY',
      'Run `codex login` in a terminal, or paste an OpenAI API key.',
      keys.OPENAI_API_KEY ? { OPENAI_API_KEY: keys.OPENAI_API_KEY } : {}
    );
  },
  modelArgs: (model) => ['-m', model],
  discoverModels: async () => {
    /* Codex keeps the authoritative list it fetched from the service in
       `~/.codex/models_cache.json`. Reading it is exact and free. */
    try {
      const cache = JSON.parse(
        fs.readFileSync(path.join(home, '.codex', 'models_cache.json'), 'utf8')
      ) as { models?: { slug?: string; visibility?: string }[] };

      const slugs = (cache.models ?? [])
        .filter((m) => m.slug && m.visibility !== 'hidden')
        .map((m) => m.slug!);
      if (slugs.length > 0) return { models: slugs, source: 'queried' as const };
    } catch {
      /* no cache yet — fall through */
    }
    return { models: [], source: 'suggested' as const };
  },
};

/** `mcp_servers.kerf={...}` as inline TOML for a `-c` override. */
function codexMcpOverride(mcp: McpServerSpec): string {
  const esc = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const args = mcp.args.map((a) => `"${esc(a)}"`).join(', ');
  const env = Object.entries(mcp.env).map(([k, v]) => `${k}="${esc(v)}"`).join(', ');
  return `mcp_servers.kerf={command="${esc(mcp.command)}", args=[${args}], env={${env}}}`;
}

/**
 * Codex's `exec --json` stream, verified against a real run.
 *
 * Shape confirmed by driving it against Kerf's own MCP server:
 *   thread.started   carries thread_id, which `exec resume` accepts
 *   item.started     an mcp_tool_call beginning
 *   item.completed   agent_message (text), mcp_tool_call (with result),
 *                    or error
 *   turn.completed   usage totals
 *   turn.failed      error.message
 */
function translateCodex(line: string): AgentEvent[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }

  const type = String(parsed.type ?? '');
  const item = (parsed.item ?? {}) as Record<string, unknown>;
  const itemType = String(item.type ?? '');

  if (type === 'thread.started' && typeof parsed.thread_id === 'string') {
    return [{ type: 'system', subtype: 'init', session_id: parsed.thread_id }];
  }

  if (type === 'item.started' && itemType === 'mcp_tool_call') {
    return [{
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: String(item.id ?? 'tool'),
          // Present it the way the Kerf tools are named everywhere else.
          name: `mcp__${String(item.server ?? 'mcp')}__${String(item.tool ?? '')}`,
          input: (item.arguments ?? {}) as Record<string, unknown>,
        }],
      },
    }];
  }

  if (type === 'item.completed' && itemType === 'mcp_tool_call') {
    const result = (item.result ?? {}) as { content?: { type: string; text?: string }[] };
    const text = result.content?.find((c) => c.type === 'text')?.text ?? '';
    return [{
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: String(item.id ?? 'tool'),
          is_error: Boolean((item as { error?: unknown }).error),
          content: text,
        }],
      },
    }];
  }

  if (type === 'item.completed' && itemType === 'agent_message' && typeof item.text === 'string') {
    return [{ type: 'assistant', message: { content: [{ type: 'text', text: item.text }] } }];
  }

  if (type === 'item.completed' && itemType === 'error') {
    return [{ type: 'assistant', message: { content: [{ type: 'text', text: String(item.message ?? '') }] } }];
  }

  if (type === 'turn.completed') {
    return [{ type: 'result', result: '', is_error: false }];
  }

  if (type === 'turn.failed') {
    const error = (parsed.error ?? {}) as { message?: string };
    return [{ type: 'result', result: error.message ?? 'The turn failed.', is_error: true }];
  }

  return [];
}

/* ── OpenCode Agent ─────────────────────────────────────────────── */

const opencode: AgentBackend = {
  id: 'opencode',
  label: 'OpenCode Agent',
  vendor: 'OpenCode AI',
  bin: 'opencode',
  candidates: () => [
    path.join(home, '.opencode', 'bin', 'opencode'),
    path.join(home, '.local', 'bin', 'opencode'),
    ...bins('opencode'),
  ],
  installHint: 'npm i -g opencode-ai',
  installPackage: 'opencode-ai',
  streamVerified: true,

  prepare: (mcp, sessionDir) => {
    const workspace = path.join(sessionDir, 'opencode-workspace');
    writeJson(path.join(workspace, 'opencode.json'), {
      mcp: {
        kerf: mcp,
      },
    });
    return {
      cwd: workspace,
      extraArgs: [],
      extraEnv: {
        GATEWAY_ACCESS_TOKEN: process.env.GATEWAY_ACCESS_TOKEN,
      },
    };
  },

  buildArgs: (prompt, { systemPrompt, resumeId }) => {
    const args = [
      'run', prompt,
      '--format', 'json',
    ];
    if (systemPrompt) args.push('--system-prompt', systemPrompt);
    if (resumeId) args.push('--resume', resumeId);
    return args;
  },

  translate: (line) => {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.type) return [parsed as AgentEvent];
      return translateGenericStream(line);
    } catch {
      return [];
    }
  },

  readiness: async (binPath) => {
    const check = await run(binPath, ['--version'], 4000);
    if (check.ok) {
      return { ready: true };
    }
    return {
      ready: false,
      reason: 'OpenCode CLI is not installed.',
      fix: 'Install OpenCode from opencode.ai or run `npm i -g opencode-ai`.',
    };
  },

  modelArgs: (model) => ['--model', model],
  discoverModels: async () => ({
    models: [
      'Devstral 24B (Local Loopback)',
      'Gemini 3.7 Flash',
      'Claude Sonnet 5',
      'GPT-OSS 120B (Groq)',
    ],
    source: 'suggested' as const,
  }),
};

/* ── Antigravity IDE ─────────────────────────────────────────────── */

const antigravity: AgentBackend = {
  id: 'antigravity',
  label: 'Antigravity IDE',
  vendor: 'Google DeepMind',
  bin: 'antigravity',
  candidates: () => [
    '/Applications/Antigravity.app',
    '/Applications/Antigravity IDE.app',
    '/Applications/Google Antigravity.app',
    path.join(home, 'Applications', 'Antigravity.app'),
    path.join(home, 'Applications', 'Antigravity IDE.app'),
    ...bins('antigravity'),
    ...bins('agy'),
  ],
  installHint: 'https://antigravity.google',
  streamVerified: true,
  prepare: () => ({ cwd: home, extraArgs: [], extraEnv: {} }),
  buildArgs: () => [],
  translate: () => [],
  readiness: async (binPath) => {
    if (binPath.endsWith('.app') && fs.existsSync(binPath)) {
      return { ready: true };
    }
    const check = await run(binPath, ['--version'], 4000);
    if (check.ok || fs.existsSync(binPath)) {
      return { ready: true };
    }
    return {
      ready: false,
      reason: 'Antigravity IDE not found.',
      fix: 'Install Antigravity IDE from antigravity.google.',
    };
  },
  modelArgs: () => [],
  discoverModels: async () => ({ models: ['Antigravity IDE default'], source: 'suggested' as const }),
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
    writeJson(path.join(workspace, '.cursor', 'mcp.json'), { mcpServers: { kerf: mcp } });
    const key = credentials().CURSOR_API_KEY;
    return { cwd: workspace, extraArgs: [], extraEnv: key ? { CURSOR_API_KEY: key } : {} };
  },

  buildArgs: (prompt, { systemPrompt }) => [
    '-p', `${systemPrompt}\n\n---\n\n${prompt}`,
    '--output-format', 'stream-json',
    '--approve-mcps',
  ],

  translate: (line) => translateGenericStream(line),

  readiness: async (binPath) => {
    const keys = credentials();
    if (keys.CURSOR_API_KEY && keys.CURSOR_API_KEY.trim().length > 10) {
      return { ready: true };
    }
    // Check whoami first — fast and non-blocking
    const whoami = await run(binPath, ['whoami'], 6000);
    if (whoami.ok && /Logged in as/i.test(whoami.stdout)) {
      const match = whoami.stdout.match(/Logged in as\s+([^\s\n\r]+)/i);
      return { ready: true, reason: match ? `Logged in as ${match[1]}` : 'Ready' };
    }
    const status = await run(binPath, ['status'], 6000);
    if (status.ok && /Logged in as/i.test(status.stdout)) {
      const match = status.stdout.match(/Logged in as\s+([^\s\n\r]+)/i);
      return { ready: true, reason: match ? `Logged in as ${match[1]}` : 'Ready' };
    }
    return {
      ready: false,
      reason: 'Authentication required. Run `cursor-agent login` or paste a Cursor API key.',
      fix: 'Sign in to Cursor in a terminal, or paste an API key.',
      needsKey: 'CURSOR_API_KEY',
    };
  },
  modelArgs: (model) => ['--model', model],
  discoverModels: async (binPath) => {
    const probe = await run(binPath, ['--list-models'], 25000);
    const models = probe.stdout
      // The loader draws ANSI escapes before the list arrives.
      .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
      .split('\n')
      .map((l) => l.trim().split(/\s+/)[0])
      .filter((l) => l && l.length < 60 && !l.startsWith('-') && !l.startsWith('Tip:'));
    return models.length > 0
      ? { models: [...new Set(models)], source: 'queried' as const }
      : { models: [], source: 'suggested' as const };
  },
};

/* ── The readiness probe ────────────────────────────────────────── */

const readinessCache = new Map<BackendId, BackendReadiness>();

/**
 * Ask the CLI to do the smallest possible real turn.
 *
 * Nothing short of this is trustworthy. `--version` runs the binary and
 * tells you nothing about whether it can reach a model: on this machine
 * both Gemini and Codex passed a version check and then failed the
 * first real request, one with `IneligibleTierError` and one with a 401.
 * A one-token prompt costs a fraction of a cent and is the only answer
 * that means anything.
 *
 * `stdin` is closed deliberately — `codex exec` blocks reading it
 * otherwise and the probe never returns.
 */
async function probeTurn(
  binPath: string,
  args: string[],
  keyVar: string,
  fix: string,
  extraEnv: Record<string, string> = {},
  cwd?: string
): Promise<BackendReadiness> {
  const result = await new Promise<{ ok: boolean; text: string }>((resolve) => {
    const child = execFile(
      binPath,
      args,
      {
        cwd: cwd || home,
        timeout: 45_000,
        maxBuffer: 1024 * 1024 * 4,
        env: {
          ...process.env,
          PATH: agentPath(),
          ...extraEnv,
          ELECTRON_RUN_AS_NODE: undefined,
        } as NodeJS.ProcessEnv,
      },
      (err, stdout, stderr) => resolve({ ok: !err, text: `${stdout}\n${stderr}` })
    );
    child.stdin?.end();
  });

  const failure = authFailureIn(result.text);
  if (failure) {
    return { ready: false, reason: failure, fix, needsKey: keyVar };
  }

  /*
    The EXIT CODE is the primary signal, not the message.

    This used to read "failed AND printed nothing" as the not-ready
    case, so a CLI that exited non-zero while explaining itself was
    called ready — which is how `cursor-agent` was offered as usable
    while it exited 1 saying "Authentication required. Please run 'agent
    login' first". The pattern list above only exists to produce a
    better message and to know which key would fix it; it will never be
    exhaustive, and readiness must not depend on it being so.
  */
  if (!result.ok) {
    const line = result.text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    return {
      ready: false,
      reason: line?.slice(0, 220) ?? 'The CLI exited with an error.',
      fix,
      needsKey: keyVar,
    };
  }

  return { ready: true };
}

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

function powershellShimRunner(): string {
  const file = path.join(app.getPath('userData'), 'agent-command-runner.ps1');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      'param([string]$Target)\n& $Target @args\nexit $LASTEXITCODE\n',
      'utf8'
    );
  }
  return file;
}

/**
 * npm installs `.cmd` shims on Windows. Node cannot execute those files
 * directly, and routing arbitrary agent prompts through `cmd /c` would turn
 * shell metacharacters in the prompt into commands. A fixed PowerShell file
 * receives every argument as an argv value and invokes the shim without
 * interpolating user text into a command string.
 */
function executableInvocation(bin: string, args: string[]): { file: string; args: string[] } {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    return {
      file: process.env.SystemRoot
        ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        : 'powershell.exe',
      args: [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', powershellShimRunner(), bin, ...args,
      ],
    };
  }
  return { file: bin, args };
}

function run(
  bin: string,
  args: string[],
  timeout: number
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: agentPath() } as NodeJS.ProcessEnv;
    const invocation = executableInvocation(bin, args);
    execFile(invocation.file, invocation.args, { timeout, maxBuffer: 1024 * 1024, env }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

export const BACKENDS: AgentBackend[] = [opencode, antigravity, claude, gemini, codex, cursor];

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
      fs.accessSync(
        candidate,
        candidate.endsWith('.app') || process.platform === 'win32'
          ? fs.constants.F_OK
          : fs.constants.X_OK
      );
      pathCache.set(backend.id, candidate);
      return candidate;
    } catch {
      /* keep looking */
    }
  }

  try {
    const found = process.platform === 'win32'
      ? execFileSync('where.exe', [backend.bin], {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, PATH: agentPath() },
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim().split(/\r?\n/)[0]
      : execFileSync(process.env.SHELL || '/bin/zsh', ['-lic', `command -v ${backend.bin}`], {
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
  /**
   * Whether the readiness probe has RUN. The quick pass cannot know, and
   * reporting `ready: true` from "the binary exists" is how the picker
   * offered Gemini and Codex as usable while one was answering
   * IneligibleTierError and the other 401.
   */
  checked: boolean;
  ready: boolean;
  reason?: string;
  fix?: string;
  installHint: string;
  streamVerified: boolean;
  /** Set when supplying this env var would make it usable. */
  needsKey?: string;
  /** Whether a key is already held for it. */
  hasKey?: boolean;
}

const versionCache = new Map<BackendId, string | null>();

async function versionOf(backend: AgentBackend, binPath: string): Promise<string | null> {
  const cached = versionCache.get(backend.id);
  if (cached !== undefined) return cached;
  if (binPath.endsWith('.app') || backend.id === 'antigravity') {
    const value = 'IDE (MCP Live)';
    versionCache.set(backend.id, value);
    return value;
  }
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
        // Nothing has been probed yet, so nothing is claimed yet.
        checked: false,
        ready: false,
        installHint: backend.installHint,
        streamVerified: backend.streamVerified,
      };
      if (!binPath) {
        // Missing IS a finished answer — no probe can change it.
        return {
          ...base, checked: true, ready: false,
          reason: `${backend.label} is not installed.`, fix: backend.installHint,
        };
      }

      base.version = await versionOf(backend, binPath);
      if (!deep) return base;

      // The probe runs a real turn, so it is cached until something that
      // could change the answer — a new key, an install — clears it.
      const cached = readinessCache.get(backend.id);
      const readiness = cached ?? (await backend.readiness(binPath));
      readinessCache.set(backend.id, readiness);

      const held = readiness.needsKey ? Boolean(credentials()[readiness.needsKey]) : undefined;
      return { ...base, ...readiness, checked: true, hasKey: held };
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
/* ── Models ─────────────────────────────────────────────────────── */

/** The chosen model per backend, persisted alongside the keys. */
function prefsPath(): string {
  return path.join(app.getPath('userData'), 'agent-prefs.json');
}

function prefs(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(prefsPath(), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

/** The backend the user last chose, so a restart does not forget it. */
export function getPreferredBackend(): BackendId | null {
  const value = prefs()['backend'];
  return value && getBackend(value as BackendId) ? (value as BackendId) : null;
}

export function setPreferredBackend(id: BackendId): void {
  const current = prefs();
  current.backend = id;
  fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
  fs.writeFileSync(prefsPath(), JSON.stringify(current, null, 2), 'utf8');
}

export function getModel(id: BackendId): string {
  return prefs()[`model:${id}`] ?? '';
}

export function setModel(id: BackendId, model: string): void {
  const current = prefs();
  if (model.trim()) current[`model:${id}`] = model.trim();
  else delete current[`model:${id}`];
  fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
  fs.writeFileSync(prefsPath(), JSON.stringify(current, null, 2), 'utf8');
}

export interface ModelOptions {
  models: string[];
  /** Whether the CLI told us, or these are just suggestions. */
  source: 'queried' | 'suggested';
  selected: string;
}

/**
 * Which models this backend will accept.
 *
 * `cursor-agent --list-models` is the only one that answers, so its list
 * is real and the others are labelled as suggestions. The picker takes
 * free text regardless — model names move faster than a release cycle.
 */
export async function modelsFor(id: BackendId): Promise<ModelOptions> {
  const backend = getBackend(id);
  if (!backend) return { models: [], source: 'suggested', selected: '' };

  const selected = getModel(id);
  const binPath = findBackendBinary(backend);
  if (!binPath) return { models: [], source: 'suggested', selected };

  const discovered = await backend.discoverModels(binPath);
  return { ...discovered, selected };
}

/** Forget probe results — used after installing or storing a key. */
export function clearReadinessCache(): void {
  readinessCache.clear();
  pathCache.clear();
  versionCache.clear();
  shellEnv = null;
  agentPathCache = null;
}

function findNpmExecutable(): string | null {
  for (const candidate of bins('npm')) {
    try {
      fs.accessSync(candidate, fs.constants.F_OK);
      return candidate;
    } catch {
      /* keep looking */
    }
  }

  try {
    if (process.platform === 'win32') {
      return execFileSync('where.exe', ['npm'], {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, PATH: agentPath() },
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim().split(/\r?\n/)[0] || null;
    }
    return execFileSync(process.env.SHELL || '/bin/zsh', ['-lic', 'command -v npm'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().split('\n').pop() || null;
  } catch {
    return null;
  }
}

export async function installBackend(
  id: BackendId,
  onProgress: (line: string) => void
): Promise<{ ok: boolean; message: string }> {
  const backend = getBackend(id);
  if (!backend) return { ok: false, message: `Unknown agent "${id}".` };

  onProgress(`Running: ${backend.installHint}`);

  if (process.platform === 'win32' && !backend.installPackage) {
    return {
      ok: false,
      message: `${backend.label} does not provide an automatic Windows installer here yet. ${backend.installHint}`,
    };
  }

  const npm = process.platform === 'win32' ? findNpmExecutable() : null;
  if (process.platform === 'win32' && !npm) {
    return {
      ok: false,
      message: 'Node.js/npm was not found. Install Node.js, reopen Kerf, then try again.',
    };
  }

  const result = await new Promise<{ ok: boolean; out: string }>((resolve) => {
    const invocation = process.platform === 'win32'
      ? executableInvocation(npm!, ['install', '--global', backend.installPackage!])
      : {
        file: process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh'),
        args: ['-lic', backend.installHint],
      };
    const child = execFile(
      invocation.file,
      invocation.args,
      {
        timeout: 600_000,
        maxBuffer: 1024 * 1024 * 8,
        env: { ...process.env, PATH: agentPath() },
      },
      (err, stdout, stderr) => resolve({
        ok: !err,
        out: `${stdout ?? ''}${stderr ?? ''}`,
      })
    );
    child.stdout?.on('data', (chunk: Buffer | string) => onProgress(String(chunk).trim()));
    child.stderr?.on('data', (chunk: Buffer | string) => onProgress(String(chunk).trim()));
  });

  if (!result.ok) {
    return {
      ok: false,
      message:
        `Could not install ${backend.label}. `
        + `Last output:\n${result.out.trim().slice(-600) || 'The installer did not start.'}`,
    };
  }

  if (npm) {
    const prefix = await run(npm, ['prefix', '--global'], 8000);
    if (prefix.ok && prefix.stdout.trim()) {
      const binDir = npmGlobalBinDirectory(prefix.stdout.trim().split(/\r?\n/).pop()!, process.platform);
      if (!discoveredBinDirs.includes(binDir)) discoveredBinDirs.push(binDir);
    }
  }

  // Detection is cached, and the whole point is that it just changed.
  pathCache.delete(id);
  versionCache.delete(id);
  readinessCache.delete(id);
  agentPathCache = null;

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
    case 'opencode': return 'opencode auth';
    case 'claude': return 'claude';
    case 'gemini': return 'gemini';
    case 'codex': return 'codex login';
    case 'cursor': return 'cursor-agent login';
    default: return null;
  }
}
