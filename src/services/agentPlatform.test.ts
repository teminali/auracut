import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  agentBinDirectories,
  binaryCandidatePaths,
  binaryFileNames,
  npmGlobalBinDirectory,
} from './agentPlatform';

describe('desktop agent paths', () => {
  it('finds npm global shims in the Windows user profile', () => {
    const dirs = agentBinDirectories({
      platform: 'win32',
      home: 'C:\\Users\\Yohana',
      env: {
        APPDATA: 'C:\\Users\\Yohana\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\Yohana\\AppData\\Local',
        ProgramFiles: 'C:\\Program Files',
      },
    });
    const candidates = binaryCandidatePaths(dirs, 'claude', 'win32');

    expect(dirs).toContain(path.win32.join('C:\\Users\\Yohana\\AppData\\Roaming', 'npm'));
    expect(candidates).toContain(
      path.win32.join('C:\\Users\\Yohana\\AppData\\Roaming', 'npm', 'claude.cmd')
    );
  });

  it('tries Windows executable extensions in deterministic order', () => {
    expect(binaryFileNames('codex', 'win32')).toEqual([
      'codex.cmd', 'codex.exe', 'codex.bat', 'codex',
    ]);
    expect(binaryFileNames('codex', 'darwin')).toEqual(['codex']);
  });

  it('uses the prefix itself for Windows npm shims', () => {
    expect(npmGlobalBinDirectory('D:\\npm-global', 'win32')).toBe('D:\\npm-global');
    expect(npmGlobalBinDirectory('/usr/local', 'darwin')).toBe('/usr/local/bin');
  });
});
