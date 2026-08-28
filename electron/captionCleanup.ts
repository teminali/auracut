/* ═══════════════════════════════════════════════════════════════════
   One plain-text turn, for correcting captions.

   ── Why this is not `claudeSession.ts` ─────────────────────────────

   Kerf already drives an agent CLI: `startSession` spawns one with the
   MCP server wired up, streams its events, and lets it edit the project
   with tools. That is the right machinery for "make this shot warmer"
   and entirely the wrong machinery for this. Correcting a transcript
   needs no tools, no timeline access, no session to resume and no
   streaming — it is a string in and a string out — and giving a model
   write access to the project in order to fix a spelling mistake is a
   larger grant than the job needs.

   So this is the smallest thing that works: `execFile`, one turn, no
   MCP config, no `--add-dir`, nothing on stdin. The model cannot reach
   the project even if it decides it wants to.

   ── What it is allowed to be wrong about ───────────────────────────

   Everything. Nothing here trusts the reply: `parseCleanupReply` in
   `src/engine/captionQuality.ts` takes it apart and refuses it unless
   it is a correction rather than a rewrite, and that check is a pure
   function with tests precisely because this side cannot be tested
   without a model and a network. This file's only job is to get the
   text there and back, and to fail in a way that leaves the captions
   exactly as they were.
   ═══════════════════════════════════════════════════════════════════ */

import { execFile } from 'child_process';
import { ipcMain } from 'electron';
import { agentPath, getBackend, findBackendBinary } from './agentBackends';
import { getBackendId } from './claudeSession';

/**
 * How each CLI takes one plain-text turn with no tools.
 *
 * Separate from `buildArgs` on the backend, which builds the AGENTIC
 * turn: that one carries `--append-system-prompt`, an MCP config and
 * `--permission-mode bypassPermissions`, none of which belong on a
 * request to spell-check a paragraph.
 *
 * `null` means this CLI has no plain-text form that has been run and
 * watched here. It is null rather than a guess for the same reason
 * `streamVerified` exists on the backends: an adapter written from a
 * help page and never executed will fail at the worst moment, and a
 * feature that says "not available for this CLI" is better than one
 * that appears to work and silently returns the CLI's help text.
 */
const TEXT_TURN: Record<string, ((prompt: string) => string[]) | null> = {
  /* Verified: this is the shape `readiness` already probes with. */
  claude: (prompt) => ['-p', prompt, '--output-format', 'text'],
  gemini: (prompt) => ['-p', prompt, '--output-format', 'text'],
  cursor: (prompt) => ['-p', prompt, '--output-format', 'text'],
  /*
    Codex's one-shot form is `exec`, and its non-JSON output carries a
    banner and a footer around the answer rather than being the answer.
    Not run and watched here, so it is refused rather than guessed at.
  */
  codex: null,
};

export interface CleanupReply {
  ok: boolean;
  /** The model's raw text. Never parsed on this side. */
  text?: string;
  backend?: string;
  error?: string;
}

/** Past this, the turn is not coming back and the build should not wait. */
const TURN_TIMEOUT_MS = 180_000;

export async function runTextTurn(prompt: string): Promise<CleanupReply> {
  const id = getBackendId();
  const build = TEXT_TURN[id];
  if (!build) {
    return {
      ok: false,
      backend: id,
      error:
        `Cleaning captions has no verified plain-text turn for ${id}. Switch the agent backend, `
        + 'or leave the captions as the transcriber wrote them.',
    };
  }

  const backend = getBackend(id);
  if (!backend) return { ok: false, backend: id, error: `No agent backend called ${id}.` };

  const binPath = findBackendBinary(backend);
  if (!binPath) {
    return { ok: false, backend: id, error: `${backend.label} is not installed. ${backend.installHint}` };
  }

  return new Promise<CleanupReply>((resolve) => {
    const child = execFile(
      binPath,
      build(prompt),
      {
        timeout: TURN_TIMEOUT_MS,
        maxBuffer: 1024 * 1024 * 16,
        env: {
          ...process.env,
          PATH: agentPath(),
          /* Trap 1, and it reaches here too: inherited from a VS Code
             terminal this makes the CLI start as plain Node and exit. */
          ELECTRON_RUN_AS_NODE: undefined,
        } as NodeJS.ProcessEnv,
      },
      (err, stdout, stderr) => {
        if (err) {
          resolve({
            ok: false,
            backend: id,
            error: (stderr || stdout || err.message).trim().slice(-400),
          });
          return;
        }
        resolve({ ok: true, backend: id, text: stdout });
      }
    );
    /* No TTY to answer on: a CLI that decides to prompt would otherwise
       hold the build open for the whole timeout. */
    child.stdin?.end();
  });
}

export function initCaptionCleanup(): void {
  ipcMain.handle('captions:clean', (_e, p: { prompt: string }) =>
    runTextTurn(String(p?.prompt ?? '')));
}
