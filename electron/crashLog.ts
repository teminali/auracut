/* ═══════════════════════════════════════════════════════════════════
   Where failures go.

   Stage 1.3 has said "you still learn about failures by looking for
   them" since the app was built, and that was accurate. Before this:

     - `uncaughtException` and `unhandledRejection` in main had no
       handler at all, so a throw outside a try took the process down
       with output only a terminal could see — and a packaged app has no
       terminal;
     - renderer console messages, `render-process-gone` and
       `did-fail-load` were logged **only when `!app.isPackaged`**, which
       is precisely backwards. In development you have devtools and a
       terminal. In the packaged build, where you have neither, nothing
       was recorded;
     - a crashed React tree rendered a black window and left nothing
       behind to say so.

   So the one build where a user meets a crash was the one build that
   wrote nothing down. This module is the record: a single file on disk
   that survives the process that wrote it.

   It is deliberately NOT a reporting service. Nothing is uploaded and
   nothing leaves the machine — that is a product decision with privacy
   consequences and belongs to whoever ships it, not to a logging module.
   ═══════════════════════════════════════════════════════════════════ */

import { app } from 'electron';
import fs from 'fs';
import path from 'path';

/**
 * Keep the tail, not the head.
 *
 * A log that stops recording when it is full stops recording right when
 * a long session is going wrong, which is the opposite of what it is
 * for. When the file passes the cap it is truncated to the most recent
 * half — losing old entries rather than new ones.
 */
const MAX_BYTES = 2 * 1024 * 1024;

let logPath: string | null = null;

export function crashLogPath(): string {
  if (!logPath) {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    logPath = path.join(dir, 'kerf.log');
  }
  return logPath;
}

export type LogSource = 'main' | 'renderer' | 'gpu' | 'child' | 'export';

/**
 * Append one entry, synchronously.
 *
 * Synchronous on purpose. Every interesting caller here is on a path
 * where the process is about to stop existing, and an async write that
 * has not flushed when the process dies records nothing — which would
 * make this module a more elaborate version of the problem it replaces.
 */
export function logEvent(
  source: LogSource,
  level: 'error' | 'warn' | 'info',
  message: string,
  detail?: unknown
): void {
  try {
    const stamp = new Date().toISOString();
    let line = `${stamp} [${source}:${level}] ${message}`;
    if (detail !== undefined) {
      const text =
        detail instanceof Error
          ? (detail.stack ?? `${detail.name}: ${detail.message}`)
          : typeof detail === 'string'
            ? detail
            : safeJson(detail);
      // Indent so a stack is visibly one entry rather than many.
      line += '\n' + text.split('\n').map((l) => '    ' + l).join('\n');
    }
    fs.appendFileSync(crashLogPath(), line + '\n');
    trimIfHuge();
  } catch {
    /* A logger that throws would take down the thing it is recording. */
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    // Circular, or a getter that throws. The type is still worth having.
    return `[unserialisable ${Object.prototype.toString.call(value)}]`;
  }
}

function trimIfHuge(): void {
  try {
    const p = crashLogPath();
    const { size } = fs.statSync(p);
    if (size <= MAX_BYTES) return;
    const keep = fs.readFileSync(p).subarray(-Math.floor(MAX_BYTES / 2));
    // Start at a line boundary so the first surviving entry is not a
    // fragment that reads like corruption.
    const nl = keep.indexOf(0x0a);
    fs.writeFileSync(
      p,
      `--- trimmed at ${new Date().toISOString()}, older entries dropped ---\n` +
        keep.subarray(nl + 1).toString()
    );
  } catch {
    /* not worth failing a write over */
  }
}

/**
 * Install the handlers that were missing.
 *
 * Call once, as early in main as possible — earlier than window
 * creation, because a failure during startup is exactly the one nobody
 * can currently see.
 */
export function initCrashLog(): void {
  logEvent('main', 'info', `Kerf ${app.getVersion()} starting`, {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    packaged: app.isPackaged,
  });

  process.on('uncaughtException', (err) => {
    logEvent('main', 'error', 'uncaughtException', err);
  });

  process.on('unhandledRejection', (reason) => {
    logEvent('main', 'error', 'unhandledRejection', reason);
  });

  app.on('child-process-gone', (_e, details) => {
    logEvent('child', 'error', `${details.type} process gone: ${details.reason}`, details);
  });

  app.on('render-process-gone', (_e, _contents, details) => {
    logEvent('renderer', 'error', `render process gone: ${details.reason}`, details);
  });

  app.on('before-quit', () => logEvent('main', 'info', 'quitting'));
}
