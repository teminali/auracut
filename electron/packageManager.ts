/* ═══════════════════════════════════════════════════════════════════
   Cross-platform Package & Model Manager for FrontierCut.

   Enables in-app 1-click automatic downloading, installation, and
   discovery of FFmpeg, FFprobe, and AI Whisper models across
   Windows, macOS, and Linux.
   ═══════════════════════════════════════════════════════════════════ */

import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import https from 'https';
import http from 'http';
import zlib from 'zlib';
import { execFileSync } from 'child_process';

export interface PackageDownloadProgress {
  pkgId: string;
  name: string;
  percent: number;
  transferredBytes: number;
  totalBytes: number;
  status: 'downloading' | 'extracting' | 'installing' | 'completed' | 'error';
  error?: string;
}

export interface PackageItemStatus {
  id: string;
  name: string;
  category: 'core' | 'ai-stt' | 'ai-agent';
  installed: boolean;
  version?: string;
  path?: string;
  sizeMb?: number;
  description: string;
  requiredFor: string[];
  recommended?: boolean;
  recommendedReason?: string;
}

export interface HardwareInfo {
  platform: string;
  arch: string;
  cores: number;
  totalMemGb: number;
  freeMemGb: number;
  cpuModel: string;
  isAppleSilicon: boolean;
  recommendedModelId: string;
  recommendationReason: string;
}

export interface PackagesStatusReport {
  ready: boolean;
  binDir: string;
  packages: Record<string, PackageItemStatus>;
  hardware: HardwareInfo;
  os: {
    platform: string;
    arch: string;
  };
}

let progressListeners: Array<(p: PackageDownloadProgress) => void> = [];

export function onPackageProgress(listener: (p: PackageDownloadProgress) => void): () => void {
  progressListeners.push(listener);
  return () => {
    progressListeners = progressListeners.filter((l) => l !== listener);
  };
}

function broadcastProgress(progress: PackageDownloadProgress): void {
  for (const listener of progressListeners) {
    try { listener(progress); } catch { /* ignore */ }
  }
}

/** The internal app directory where standalone binaries are installed. */
export function getAppBinDir(): string {
  const dir = path.join(app.getPath('userData'), 'packages', 'bin');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch { /* best effort */ }
  return dir;
}

/** Ensure the app bin dir is prepended to process.env.PATH */
export function initAppBinPath(): void {
  const binDir = getAppBinDir();
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const currentPath = process.env.PATH || '';
  if (!currentPath.split(delimiter).includes(binDir)) {
    process.env.PATH = `${binDir}${delimiter}${currentPath}`;
  }
}

/** Check if a binary exists and is executable in candidate directories or PATH */
export function findBinary(name: string, extraCandidates: string[] = []): string | null {
  const isWin = process.platform === 'win32';
  const binName = isWin && !name.endsWith('.exe') ? `${name}.exe` : name;
  const appBin = path.join(getAppBinDir(), binName);

  if (fs.existsSync(appBin)) {
    try {
      if (!isWin) fs.chmodSync(appBin, 0o755);
      return appBin;
    } catch { /* continue */ }
  }

  const candidates: string[] = [
    ...extraCandidates,
    appBin,
  ];

  if (isWin) {
    const localApp = process.env.LOCALAPPDATA || '';
    const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const progData = process.env.ProgramData || 'C:\\ProgramData';
    const userProfile = process.env.USERPROFILE || '';

    candidates.push(
      `C:\\ffmpeg\\bin\\${binName}`,
      path.join(progFiles, 'ffmpeg', 'bin', binName),
      path.join(localApp, 'Programs', 'ffmpeg', 'bin', binName),
      path.join(progData, 'chocolatey', 'bin', binName),
      path.join(userProfile, 'scoop', 'shims', binName)
    );
  } else {
    candidates.push(
      `/opt/homebrew/bin/${name}`,
      `/usr/local/bin/${name}`,
      `/usr/bin/${name}`,
      path.join(os.homedir(), '.local', 'bin', name),
      `/snap/bin/${name}`
    );
  }

  for (const cand of candidates) {
    if (!cand) continue;
    try {
      if (fs.existsSync(cand)) {
        if (!isWin) {
          try { fs.accessSync(cand, fs.constants.X_OK); } catch { fs.chmodSync(cand, 0o755); }
        }
        return cand;
      }
    } catch { /* continue */ }
  }

  // Probe OS PATH via where (Windows) or which/shell (macOS/Linux)
  try {
    if (isWin) {
      const output = execFileSync('where', [name], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
      const found = output.trim().split(/\r?\n/)[0];
      if (found && fs.existsSync(found)) return found;
    } else {
      const shell = process.env.SHELL || '/bin/bash';
      const output = execFileSync(shell, ['-lic', `command -v ${name}`], {
        encoding: 'utf8',
        timeout: 4000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const found = output.trim().split('\n').pop();
      if (found && fs.existsSync(found)) return found;
    }
  } catch { /* not in PATH */ }

  return null;
}

/** Get download URL for ffmpeg/ffprobe based on platform and architecture */
function getBinaryUrl(binary: 'ffmpeg' | 'ffprobe'): string | null {
  const platform = process.platform;
  const arch = process.arch;

  // eugeneware static releases: single compressed gzip binary, highly reliable and fast
  const base = `https://github.com/eugeneware/${binary}-static/releases/download/b6.1`;

  if (platform === 'win32') {
    return `${base}/${binary}-win32-${arch === 'arm64' ? 'arm64' : 'x64'}.gz`;
  }
  if (platform === 'darwin') {
    return `${base}/${binary}-darwin-${arch === 'arm64' ? 'arm64' : 'x64'}.gz`;
  }
  if (platform === 'linux') {
    return `${base}/${binary}-linux-${arch === 'arm64' ? 'arm64' : 'x64'}.gz`;
  }
  return null;
}

/** Whisper models stored in ~/.cache/whisper or app userData/models */
export function getModelsDir(): string {
  const dir = path.join(os.homedir(), '.cache', 'whisper');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* best effort */ }
  return dir;
}

/** Download a remote file with redirect following and progress reporting */
function downloadFile(
  url: string,
  destPath: string,
  pkgId: string,
  name: string,
  isGzip = false
): Promise<void> {
  return new Promise((resolve, reject) => {
    broadcastProgress({
      pkgId, name, percent: 0, transferredBytes: 0, totalBytes: 0, status: 'downloading',
    });

    const tempPath = `${destPath}.tmp_${Date.now()}`;
    const fileStream = fs.createWriteStream(tempPath);

    function fetchUrl(targetUrl: string, redirects = 0) {
      if (redirects > 8) {
        reject(new Error('Too many redirects while downloading package'));
        return;
      }

      const client = targetUrl.startsWith('https:') ? https : http;
      client.get(targetUrl, (res) => {
        if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const nextUrl = new URL(res.headers.location, targetUrl).toString();
          fetchUrl(nextUrl, redirects + 1);
          return;
        }

        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(new Error(`Server returned HTTP ${res.statusCode}`));
          return;
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let transferredBytes = 0;
        let lastReport = 0;

        res.on('data', (chunk: Buffer) => {
          transferredBytes += chunk.length;
          const now = Date.now();
          if (now - lastReport >= 100 || (totalBytes > 0 && transferredBytes >= totalBytes)) {
            lastReport = now;
            const percent = totalBytes > 0 ? Math.min(99, Math.round((transferredBytes / totalBytes) * 100)) : 50;
            broadcastProgress({
              pkgId, name, percent, transferredBytes, totalBytes, status: 'downloading',
            });
          }
        });

        if (isGzip) {
          const gunzip = zlib.createGunzip();
          gunzip.on('error', (err) => {
            fileStream.close();
            try { fs.unlinkSync(tempPath); } catch { /* best effort */ }
            reject(new Error(`Extraction error: ${err.message}`));
          });
          res.pipe(gunzip).pipe(fileStream);
        } else {
          res.pipe(fileStream);
        }

        fileStream.on('finish', () => {
          fileStream.close(() => {
            try {
              if (process.platform !== 'win32') {
                fs.chmodSync(tempPath, 0o755);
              }
              if (fs.existsSync(destPath)) {
                try { fs.unlinkSync(destPath); } catch { /* ignore */ }
              }
              fs.renameSync(tempPath, destPath);
              broadcastProgress({
                pkgId, name, percent: 100, transferredBytes, totalBytes, status: 'completed',
              });
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        });

        fileStream.on('error', (err) => {
          try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
          reject(err);
        });
      }).on('error', (err) => {
        fileStream.close();
        try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
        reject(err);
      });
    }

    fetchUrl(url);
  });
}

/** Install a specific package */
export async function installPackage(pkgId: string): Promise<{ ok: boolean; error?: string }> {
  initAppBinPath();
  const binDir = getAppBinDir();
  const isWin = process.platform === 'win32';

  try {
    if (pkgId === 'ffmpeg') {
      const url = getBinaryUrl('ffmpeg');
      if (!url) throw new Error(`Automated ffmpeg download is not supported for ${process.platform}/${process.arch}`);
      const dest = path.join(binDir, isWin ? 'ffmpeg.exe' : 'ffmpeg');
      await downloadFile(url, dest, 'ffmpeg', 'FFmpeg Video Engine', true);
      return { ok: true };
    }

    if (pkgId === 'ffprobe') {
      const url = getBinaryUrl('ffprobe');
      if (!url) throw new Error(`Automated ffprobe download is not supported for ${process.platform}/${process.arch}`);
      const dest = path.join(binDir, isWin ? 'ffprobe.exe' : 'ffprobe');
      await downloadFile(url, dest, 'ffprobe', 'FFprobe Analyzer', true);
      return { ok: true };
    }

    if (pkgId.startsWith('model-')) {
      const modelName = pkgId.replace('model-', '');
      const modelsDir = getModelsDir();
      const filename = `ggml-${modelName}.bin`;
      const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${filename}`;
      const dest = path.join(modelsDir, filename);
      await downloadFile(url, dest, pkgId, `Whisper Model (${modelName})`, false);
      return { ok: true };
    }

    throw new Error(`Unknown package identifier: ${pkgId}`);
  } catch (err) {
    const errorMsg = (err as Error).message || 'Download failed';
    broadcastProgress({
      pkgId, name: pkgId, percent: 0, transferredBytes: 0, totalBytes: 0, status: 'error', error: errorMsg,
    });
    return { ok: false, error: errorMsg };
  }
}

/** Install all core packages (FFmpeg + FFprobe + Recommended Whisper model) in one click */
export async function installAllCorePackages(preferredModelId?: string): Promise<{ ok: boolean; errors?: string[] }> {
  const errors: string[] = [];

  const r1 = await installPackage('ffmpeg');
  if (!r1.ok && r1.error) errors.push(`FFmpeg: ${r1.error}`);

  const r2 = await installPackage('ffprobe');
  if (!r2.ok && r2.error) errors.push(`FFprobe: ${r2.error}`);

  const status = await getPackagesStatus();
  const modelToInstall = preferredModelId || status.hardware.recommendedModelId || 'model-base';

  const r3 = await installPackage(modelToInstall);
  if (!r3.ok && r3.error) errors.push(`Model (${modelToInstall}): ${r3.error}`);

  return { ok: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
}

/** Query the full status of all packages, models, and device hardware specs */
export async function getPackagesStatus(): Promise<PackagesStatusReport> {
  initAppBinPath();
  const isWin = process.platform === 'win32';
  const ffmpegBin = findBinary('ffmpeg');
  const ffprobeBin = findBinary('ffprobe');

  const modelsDir = getModelsDir();
  const models = ['tiny', 'base', 'small', 'medium', 'large-v3'].map((m) => {
    const file = path.join(modelsDir, `ggml-${m}.bin`);
    const exists = fs.existsSync(file);
    let sizeMb = 0;
    if (exists) {
      try { sizeMb = Math.round((fs.statSync(file).size / 1024 / 1024) * 10) / 10; } catch { /* ignore */ }
    }
    return { name: m, file, installed: exists, sizeMb };
  });

  // Compute device hardware specifications
  const totalMemBytes = os.totalmem();
  const freeMemBytes = os.freemem();
  const totalMemGb = Math.round((totalMemBytes / (1024 * 1024 * 1024)) * 10) / 10;
  const freeMemGb = Math.round((freeMemBytes / (1024 * 1024 * 1024)) * 10) / 10;
  const cpus = os.cpus() || [];
  const cores = cpus.length;
  const cpuModel = cpus[0]?.model || (process.arch === 'arm64' ? 'Apple Silicon' : 'CPU');
  const isAppleSilicon = process.platform === 'darwin' && process.arch === 'arm64';

  let recommendedModelId = 'model-base';
  let recommendationReason = 'Standard multi-language balance of speed and precision.';

  if (isAppleSilicon) {
    if (totalMemGb >= 16) {
      recommendedModelId = 'model-small';
      recommendationReason = 'Optimal for Apple Silicon (Metal/ANE) with 16GB+ RAM for high precision.';
    } else {
      recommendedModelId = 'model-base';
      recommendationReason = 'Fast real-time transcription tailored for Apple Silicon Unified Memory.';
    }
  } else if (totalMemGb >= 32 && cores >= 12) {
    recommendedModelId = 'model-medium';
    recommendationReason = 'High-end workstation detected: studio-precision transcription.';
  } else if (totalMemGb >= 16) {
    recommendedModelId = 'model-small';
    recommendationReason = 'High-accuracy model for 16GB+ system memory.';
  } else if (totalMemGb < 8) {
    recommendedModelId = 'model-tiny';
    recommendationReason = 'Lightweight fast model optimized for low memory usage.';
  }

  const packages: Record<string, PackageItemStatus> = {
    ffmpeg: {
      id: 'ffmpeg',
      name: 'FFmpeg Core Video Engine 7.1',
      category: 'core',
      installed: ffmpegBin !== null,
      path: ffmpegBin ?? undefined,
      description: 'Powers hardware video rendering, audio mixing, MP4/ProRes container muxing, and speed changes.',
      requiredFor: ['Video Export', 'Audio Mixing', 'Speed Ramping', 'Video Conversions'],
    },
    ffprobe: {
      id: 'ffprobe',
      name: 'FFprobe Media Stream Inspector',
      category: 'core',
      installed: ffprobeBin !== null,
      path: ffprobeBin ?? undefined,
      description: 'Extracts exact frame counts, sample rates, duration metadata, and audio streams from media files.',
      requiredFor: ['Media Import', 'Duration Validation', 'Waveform Sync'],
    },
    'model-tiny': {
      id: 'model-tiny',
      name: 'Whisper Speech Model (Tiny)',
      category: 'ai-stt',
      installed: models.find((m) => m.name === 'tiny')?.installed ?? false,
      sizeMb: models.find((m) => m.name === 'tiny')?.sizeMb || 75,
      description: 'Ultra-fast speech recognition model (75 MB). Minimal RAM footprint, ideal for quick drafts.',
      requiredFor: ['Fast Transcription', 'Low Memory Subtitles'],
      recommended: recommendedModelId === 'model-tiny',
      recommendedReason: recommendedModelId === 'model-tiny' ? recommendationReason : undefined,
    },
    'model-base': {
      id: 'model-base',
      name: 'Whisper Speech Model (Base)',
      category: 'ai-stt',
      installed: models.find((m) => m.name === 'base')?.installed ?? false,
      sizeMb: models.find((m) => m.name === 'base')?.sizeMb || 142,
      description: 'Standard fast multi-language speech recognition model (142 MB). Recommended for everyday subtitles.',
      requiredFor: ['Automatic Captions', 'Voice Subtitles', 'Silence Detection'],
      recommended: recommendedModelId === 'model-base',
      recommendedReason: recommendedModelId === 'model-base' ? recommendationReason : undefined,
    },
    'model-small': {
      id: 'model-small',
      name: 'Whisper Speech Model (Small)',
      category: 'ai-stt',
      installed: models.find((m) => m.name === 'small')?.installed ?? false,
      sizeMb: models.find((m) => m.name === 'small')?.sizeMb || 466,
      description: 'High-accuracy model for noisy audio, heavy accents, and complex vocabularies (466 MB).',
      requiredFor: ['High-Accuracy Captions', 'Multi-speaker Transcripts'],
      recommended: recommendedModelId === 'model-small',
      recommendedReason: recommendedModelId === 'model-small' ? recommendationReason : undefined,
    },
    'model-medium': {
      id: 'model-medium',
      name: 'Whisper Speech Model (Medium)',
      category: 'ai-stt',
      installed: models.find((m) => m.name === 'medium')?.installed ?? false,
      sizeMb: models.find((m) => m.name === 'medium')?.sizeMb || 1536,
      description: 'Studio-grade transcription model (1.5 GB). Maximum accuracy across 99+ languages.',
      requiredFor: ['Studio Accuracy', 'Multi-language Translation'],
      recommended: recommendedModelId === 'model-medium',
      recommendedReason: recommendedModelId === 'model-medium' ? recommendationReason : undefined,
    },
    'model-large-v3': {
      id: 'model-large-v3',
      name: 'Whisper Speech Model (Large v3)',
      category: 'ai-stt',
      installed: models.find((m) => m.name === 'large-v3')?.installed ?? false,
      sizeMb: models.find((m) => m.name === 'large-v3')?.sizeMb || 3100,
      description: 'State-of-the-art multi-lingual foundation model (3.1 GB). Highest word recognition score.',
      requiredFor: ['Enterprise Transcripts', 'Technical Jargon Recognition'],
      recommended: recommendedModelId === 'model-large-v3',
      recommendedReason: recommendedModelId === 'model-large-v3' ? recommendationReason : undefined,
    },
  };

  const isReady = ffmpegBin !== null;

  return {
    ready: isReady,
    binDir: getAppBinDir(),
    packages,
    hardware: {
      platform: process.platform,
      arch: process.arch,
      cores,
      totalMemGb,
      freeMemGb,
      cpuModel,
      isAppleSilicon,
      recommendedModelId,
      recommendationReason,
    },
    os: {
      platform: process.platform,
      arch: process.arch,
    },
  };
}
