import path from 'path';

export type SupportedPlatform = NodeJS.Platform;

/** Directories a desktop app must add because GUI processes inherit a stale/minimal PATH. */
export function agentBinDirectories(options: {
  platform: SupportedPlatform;
  home: string;
  env: NodeJS.ProcessEnv;
}): string[] {
  const { platform, home, env } = options;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'win32') {
    const appData = env.APPDATA || pathApi.join(home, 'AppData', 'Roaming');
    const localAppData = env.LOCALAPPDATA || pathApi.join(home, 'AppData', 'Local');
    return unique([
      pathApi.join(appData, 'npm'),
      pathApi.join(home, '.local', 'bin'),
      pathApi.join(localAppData, 'Microsoft', 'WinGet', 'Links'),
      env.ProgramFiles ? pathApi.join(env.ProgramFiles, 'nodejs') : '',
      env['ProgramFiles(x86)'] ? pathApi.join(env['ProgramFiles(x86)']!, 'nodejs') : '',
    ]);
  }

  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.cargo', 'bin'),
  ];
}

/** npm exposes global commands as .cmd shims on Windows and plain files elsewhere. */
export function binaryFileNames(name: string, platform: SupportedPlatform): string[] {
  return platform === 'win32'
    ? [`${name}.cmd`, `${name}.exe`, `${name}.bat`, name]
    : [name];
}

export function binaryCandidatePaths(
  directories: string[],
  name: string,
  platform: SupportedPlatform
): string[] {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  return directories.flatMap((directory) =>
    binaryFileNames(name, platform).map((file) => pathApi.join(directory, file))
  );
}

export function npmGlobalBinDirectory(prefix: string, platform: SupportedPlatform): string {
  return platform === 'win32' ? prefix : path.posix.join(prefix, 'bin');
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
