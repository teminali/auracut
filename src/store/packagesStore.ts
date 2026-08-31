import { create } from 'zustand';

export interface PackageItem {
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

export interface PackageDownloadState {
  pkgId: string;
  percent: number;
  transferredBytes: number;
  totalBytes: number;
  status: 'downloading' | 'extracting' | 'installing' | 'completed' | 'error';
  error?: string;
}

function detectClientHardware(): HardwareInfo {
  let platform = 'darwin';
  let arch = 'arm64';
  let isAppleSilicon = true;
  let cores = 8;
  let totalMemGb = 16;
  let freeMemGb = 8;

  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent.toLowerCase();
    const plat = (navigator.platform || '').toLowerCase();
    cores = navigator.hardwareConcurrency || 8;
    totalMemGb = (navigator as any).deviceMemory || 16;
    freeMemGb = Math.max(2, Math.round(totalMemGb * 0.4));

    if (ua.includes('win') || plat.includes('win')) {
      platform = 'win32';
      arch = 'x64';
      isAppleSilicon = false;
    } else if (ua.includes('linux') || plat.includes('linux')) {
      platform = 'linux';
      arch = 'x64';
      isAppleSilicon = false;
    } else {
      platform = 'darwin';
      isAppleSilicon = !ua.includes('intel') && !plat.includes('macintel');
      arch = isAppleSilicon ? 'arm64' : 'x64';
    }
  }

  let recommendedModelId = 'model-base';
  let recommendationReason = 'Balanced speed & precision for video tutorials.';

  if (isAppleSilicon) {
    if (totalMemGb >= 16) {
      recommendedModelId = 'model-small';
      recommendationReason = 'Optimal for Apple Silicon (Metal/ANE) with 16GB+ RAM.';
    } else {
      recommendedModelId = 'model-base';
      recommendationReason = 'Fast real-time transcription tailored for Apple Silicon.';
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

  return {
    platform,
    arch,
    cores,
    totalMemGb,
    freeMemGb,
    cpuModel: isAppleSilicon ? 'Apple Silicon (M-Series)' : 'x86_64 Multi-Core CPU',
    isAppleSilicon,
    recommendedModelId,
    recommendationReason,
  };
}

function getDefaultCatalog(hw: HardwareInfo): Record<string, PackageItem> {
  return {
    ffmpeg: {
      id: 'ffmpeg',
      name: 'FFmpeg Core Video Engine 7.1',
      category: 'core',
      installed: false,
      description: 'Powers hardware video rendering, audio mixing, MP4/ProRes container muxing, and speed changes.',
      requiredFor: ['Video Export', 'Audio Mixing', 'Speed Ramping', 'Video Conversions'],
    },
    ffprobe: {
      id: 'ffprobe',
      name: 'FFprobe Media Stream Inspector',
      category: 'core',
      installed: false,
      description: 'Extracts exact frame counts, sample rates, duration metadata, and audio streams from media files.',
      requiredFor: ['Media Import', 'Duration Validation', 'Waveform Sync'],
    },
    'model-tiny': {
      id: 'model-tiny',
      name: 'Whisper Speech Model (Tiny)',
      category: 'ai-stt',
      installed: false,
      sizeMb: 75,
      description: 'Ultra-fast speech recognition model (75 MB). Minimal RAM footprint, ideal for quick drafts.',
      requiredFor: ['Fast Transcription', 'Low Memory Subtitles'],
      recommended: hw.recommendedModelId === 'model-tiny',
      recommendedReason: hw.recommendedModelId === 'model-tiny' ? hw.recommendationReason : undefined,
    },
    'model-base': {
      id: 'model-base',
      name: 'Whisper Speech Model (Base)',
      category: 'ai-stt',
      installed: false,
      sizeMb: 142,
      description: 'Standard fast multi-language speech recognition model (142 MB). Recommended for everyday subtitles.',
      requiredFor: ['Automatic Captions', 'Voice Subtitles', 'Silence Detection'],
      recommended: hw.recommendedModelId === 'model-base',
      recommendedReason: hw.recommendedModelId === 'model-base' ? hw.recommendationReason : undefined,
    },
    'model-small': {
      id: 'model-small',
      name: 'Whisper Speech Model (Small)',
      category: 'ai-stt',
      installed: false,
      sizeMb: 466,
      description: 'High-accuracy model for noisy audio, heavy accents, and complex vocabularies (466 MB).',
      requiredFor: ['High-Accuracy Captions', 'Multi-speaker Transcripts'],
      recommended: hw.recommendedModelId === 'model-small',
      recommendedReason: hw.recommendedModelId === 'model-small' ? hw.recommendationReason : undefined,
    },
    'model-medium': {
      id: 'model-medium',
      name: 'Whisper Speech Model (Medium)',
      category: 'ai-stt',
      installed: false,
      sizeMb: 1536,
      description: 'Studio-grade transcription model (1.5 GB). Maximum accuracy across 99+ languages.',
      requiredFor: ['Studio Accuracy', 'Multi-language Translation'],
      recommended: hw.recommendedModelId === 'model-medium',
      recommendedReason: hw.recommendedModelId === 'model-medium' ? hw.recommendationReason : undefined,
    },
    'model-large-v3': {
      id: 'model-large-v3',
      name: 'Whisper Speech Model (Large v3)',
      category: 'ai-stt',
      installed: false,
      sizeMb: 3100,
      description: 'State-of-the-art multi-lingual foundation model (3.1 GB). Highest word recognition score.',
      requiredFor: ['Enterprise Transcripts', 'Technical Jargon Recognition'],
      recommended: hw.recommendedModelId === 'model-large-v3',
      recommendedReason: hw.recommendedModelId === 'model-large-v3' ? hw.recommendationReason : undefined,
    },
  };
}

const initialHw = detectClientHardware();

interface PackagesState {
  isModalOpen: boolean;
  isLoading: boolean;
  ready: boolean;
  platform: string;
  arch: string;
  hardware: HardwareInfo;
  packages: Record<string, PackageItem>;
  downloads: Record<string, PackageDownloadState>;

  // Actions
  setModalOpen: (open: boolean) => void;
  checkStatus: () => Promise<void>;
  installPackage: (pkgId: string) => Promise<{ ok: boolean; error?: string }>;
  installAll: (preferredModelId?: string) => Promise<{ ok: boolean }>;
}

export const usePackagesStore = create<PackagesState>((set, get) => ({
  isModalOpen: false,
  isLoading: false,
  ready: true,
  platform: initialHw.platform,
  arch: initialHw.arch,
  hardware: initialHw,
  packages: getDefaultCatalog(initialHw),
  downloads: {},

  setModalOpen: (open) => {
    set({ isModalOpen: open });
    if (open) {
      void get().checkStatus();
    }
  },

  checkStatus: async () => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.packages : undefined;
    if (!api) {
      // In web browser mode, re-detect client hardware and preserve defaults
      const hw = detectClientHardware();
      set((state) => ({
        platform: hw.platform,
        arch: hw.arch,
        hardware: hw,
        packages: Object.keys(state.packages).length > 0 ? state.packages : getDefaultCatalog(hw),
        isLoading: false,
      }));
      return;
    }

    set({ isLoading: true });
    try {
      const res = await api.status();
      if (res && res.packages) {
        const hw: HardwareInfo = res.hardware || {
          platform: res.os?.platform || 'darwin',
          arch: res.os?.arch || 'arm64',
          cores: 8,
          totalMemGb: 16,
          freeMemGb: 8,
          cpuModel: res.os?.arch === 'arm64' ? 'Apple Silicon' : 'CPU',
          isAppleSilicon: res.os?.platform === 'darwin' && res.os?.arch === 'arm64',
          recommendedModelId: 'model-base',
          recommendationReason: 'Balanced speed & precision.',
        };

        set({
          ready: res.ready,
          packages: res.packages,
          hardware: hw,
          platform: res.os?.platform || hw.platform,
          arch: res.os?.arch || hw.arch,
          isLoading: false,
        });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  installPackage: async (pkgId: string) => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.packages : undefined;

    set((state) => ({
      downloads: {
        ...state.downloads,
        [pkgId]: {
          pkgId,
          percent: 0,
          transferredBytes: 0,
          totalBytes: 100 * 1024 * 1024,
          status: 'downloading',
        },
      },
    }));

    if (!api) {
      // Web simulator for instant test feedback
      for (let p = 15; p <= 100; p += 25) {
        await new Promise((r) => setTimeout(r, 120));
        set((state) => ({
          downloads: {
            ...state.downloads,
            [pkgId]: {
              pkgId,
              percent: p,
              transferredBytes: Math.round((p / 100) * 100 * 1024 * 1024),
              totalBytes: 100 * 1024 * 1024,
              status: p === 100 ? 'completed' : 'downloading',
            },
          },
          packages: {
            ...state.packages,
            [pkgId]: {
              ...state.packages[pkgId],
              installed: p === 100 ? true : state.packages[pkgId]?.installed,
            },
          },
        }));
      }
      return { ok: true };
    }

    try {
      const res = await api.install(pkgId);
      await get().checkStatus();
      return res;
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },

  installAll: async (preferredModelId?: string) => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.packages : undefined;
    const model = preferredModelId || get().hardware.recommendedModelId || 'model-base';

    if (!api) {
      await get().installPackage('ffmpeg');
      await get().installPackage('ffprobe');
      await get().installPackage(model);
      return { ok: true };
    }

    try {
      const res = await api.installAll({ preferredModelId: model });
      await get().checkStatus();
      return { ok: res?.ok ?? true };
    } catch {
      return { ok: false };
    }
  },
}));

// Initialize real-time progress listener
if (typeof window !== 'undefined' && window.electronAPI?.packages?.onProgress) {
  window.electronAPI.packages.onProgress((p: any) => {
    usePackagesStore.setState((state) => ({
      downloads: {
        ...state.downloads,
        [p.pkgId]: {
          pkgId: p.pkgId,
          percent: p.percent,
          transferredBytes: p.transferredBytes,
          totalBytes: p.totalBytes,
          status: p.status,
          error: p.error,
        },
      },
    }));

    if (p.status === 'completed') {
      void usePackagesStore.getState().checkStatus();
    }
  });
}
