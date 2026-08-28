import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KERF_TCC_SERVICES,
  markPermissionResetPending,
  preparePermissionsForBuild,
} from './permissionReset';

const temporaryDirectories: string[] = [];

function stateFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kerf-permission-reset-test-'));
  temporaryDirectories.push(dir);
  return path.join(dir, 'permission-reset.json');
}

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('launch-time permission reset', () => {
  it('prepares a build once and does not rely on an updater restart button', async () => {
    const file = stateFile();
    const reset = vi.fn(async () => undefined);

    const first = await preparePermissionsForBuild({
      file, version: '1.8.1', bundleId: 'com.kerf.editor', reset,
    });
    const second = await preparePermissionsForBuild({
      file, version: '1.8.1', bundleId: 'com.kerf.editor', reset,
    });

    expect(first).toMatchObject({ needed: true, ok: true, cleared: KERF_TCC_SERVICES });
    expect(second).toEqual({ needed: false, ok: true, cleared: [], failures: [] });
    expect(reset).toHaveBeenCalledTimes(KERF_TCC_SERVICES.length);
  });

  it('survives the bundle swap and clears the pending marker only after success', async () => {
    const file = stateFile();
    markPermissionResetPending(file, '1.8.1');

    const result = await preparePermissionsForBuild({
      file,
      version: '1.8.1',
      bundleId: 'com.kerf.editor',
      reset: async () => undefined,
    });

    expect(result.ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      schema: 1,
      preparedVersion: '1.8.1',
    });
  });

  it('retains the obligation and retries every service after a partial failure', async () => {
    const file = stateFile();
    markPermissionResetPending(file, '1.8.1');
    const failingReset = vi.fn(async (service: string) => {
      if (service === 'ScreenCapture') throw new Error('TCC attribution failed');
    });

    const failed = await preparePermissionsForBuild({
      file, version: '1.8.1', bundleId: 'com.kerf.editor', reset: failingReset,
    });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      schema: 1,
      pendingVersion: '1.8.1',
    });

    const retry = vi.fn(async () => undefined);
    const recovered = await preparePermissionsForBuild({
      file, version: '1.8.1', bundleId: 'com.kerf.editor', reset: retry,
    });

    expect(failed).toMatchObject({
      needed: true,
      ok: false,
      failures: [{ service: 'ScreenCapture', message: 'TCC attribution failed' }],
    });
    expect(recovered.ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      schema: 1,
      preparedVersion: '1.8.1',
    });
    expect(retry).toHaveBeenCalledTimes(KERF_TCC_SERVICES.length);
  });

  it('detects a manually replaced build without an updater marker', async () => {
    const file = stateFile();
    await preparePermissionsForBuild({
      file, version: '1.8.0', bundleId: 'com.kerf.editor', reset: async () => undefined,
    });
    const reset = vi.fn(async () => undefined);

    const result = await preparePermissionsForBuild({
      file, version: '1.8.1', bundleId: 'com.kerf.editor', reset,
    });

    expect(result).toMatchObject({ needed: true, ok: true });
    expect(reset).toHaveBeenCalledTimes(KERF_TCC_SERVICES.length);
  });
});
