import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

export const KERF_TCC_SERVICES = ['ScreenCapture', 'Accessibility', 'ListenEvent'] as const;
export type KerfTccService = typeof KERF_TCC_SERVICES[number];

interface PermissionResetState {
  schema: 1;
  preparedVersion?: string;
  pendingVersion?: string;
}

export interface PermissionResetFailure {
  service: KerfTccService;
  message: string;
}

export interface PermissionResetResult {
  needed: boolean;
  ok: boolean;
  cleared: KerfTccService[];
  failures: PermissionResetFailure[];
}

export type TccResetRunner = (service: KerfTccService, bundleId: string) => Promise<void>;

export function permissionResetStateFile(userDataDirectory: string): string {
  return path.join(userDataDirectory, 'permission-reset.json');
}

function readState(file: string): PermissionResetState {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<PermissionResetState>;
    return {
      schema: 1,
      ...(typeof parsed.preparedVersion === 'string'
        ? { preparedVersion: parsed.preparedVersion }
        : {}),
      ...(typeof parsed.pendingVersion === 'string'
        ? { pendingVersion: parsed.pendingVersion }
        : {}),
    };
  } catch {
    return { schema: 1 };
  }
}

function writeState(file: string, state: PermissionResetState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

/**
 * Record the obligation before replacing the application bundle.
 *
 * The marker belongs outside the bundle so it survives updates, rollbacks,
 * manual closes and reboots. If it cannot be written, the caller must not
 * perform an unsigned update: doing so would knowingly strand TCC grants.
 */
export function markPermissionResetPending(file: string, version: string): void {
  const current = readState(file);
  writeState(file, { ...current, schema: 1, pendingVersion: version });
}

/**
 * Prepare TCC for the build that is running now.
 *
 * A version mismatch also triggers the reset, so replacing TeminaliCut manually is
 * covered even when the in-app updater never had a chance to write a marker.
 * State advances only after every service succeeds; a partial or failed reset
 * is retried on the next launch instead of being silently forgotten.
 */
export async function preparePermissionsForBuild(options: {
  file: string;
  version: string;
  bundleId: string;
  reset: TccResetRunner;
}): Promise<PermissionResetResult> {
  const state = readState(options.file);
  const needed = Boolean(state.pendingVersion) || state.preparedVersion !== options.version;
  if (!needed) return { needed: false, ok: true, cleared: [], failures: [] };

  const cleared: KerfTccService[] = [];
  const failures: PermissionResetFailure[] = [];
  for (const service of KERF_TCC_SERVICES) {
    try {
      await options.reset(service, options.bundleId);
      cleared.push(service);
    } catch (error) {
      failures.push({
        service,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (failures.length > 0) return { needed: true, ok: false, cleared, failures };

  writeState(options.file, { schema: 1, preparedVersion: options.version });
  return { needed: true, ok: true, cleared, failures: [] };
}

export function resetTccService(
  service: KerfTccService,
  bundleId: string
): Promise<void> {
  return new Promise((resolve) => {
    const ids = Array.from(new Set([bundleId, 'com.teminalicut.editor', 'com.kerf.editor']));
    let remaining = ids.length;
    for (const id of ids) {
      execFile(
        '/usr/bin/tccutil',
        ['reset', service, id],
        { timeout: 15_000, maxBuffer: 1024 * 1024 },
        () => {
          remaining--;
          if (remaining === 0) resolve();
        }
      );
    }
  });
}
