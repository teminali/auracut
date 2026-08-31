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
}

export interface PackageDownloadState {
  pkgId: string;
  percent: number;
  transferredBytes: number;
  totalBytes: number;
  status: 'downloading' | 'extracting' | 'installing' | 'completed' | 'error';
  error?: string;
}

interface PackagesState {
  isModalOpen: boolean;
  isLoading: boolean;
  ready: boolean;
  platform: string;
  arch: string;
  packages: Record<string, PackageItem>;
  downloads: Record<string, PackageDownloadState>;
  
  // Actions
  setModalOpen: (open: boolean) => void;
  checkStatus: () => Promise<void>;
  installPackage: (pkgId: string) => Promise<{ ok: boolean; error?: string }>;
  installAll: () => Promise<{ ok: boolean }>;
}

export const usePackagesStore = create<PackagesState>((set, get) => ({
  isModalOpen: false,
  isLoading: false,
  ready: true,
  platform: '',
  arch: '',
  packages: {},
  downloads: {},

  setModalOpen: (open) => {
    set({ isModalOpen: open });
    if (open) {
      void get().checkStatus();
    }
  },

  checkStatus: async () => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.packages : undefined;
    if (!api) return;

    set({ isLoading: true });
    try {
      const res = await api.status();
      if (res && res.packages) {
        set({
          ready: res.ready,
          packages: res.packages,
          platform: res.os?.platform || '',
          arch: res.os?.arch || '',
          isLoading: false,
        });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  installPackage: async (pkgId: string) => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.packages : undefined;
    if (!api) return { ok: false, error: 'Desktop environment not detected' };

    set((state) => ({
      downloads: {
        ...state.downloads,
        [pkgId]: {
          pkgId,
          percent: 0,
          transferredBytes: 0,
          totalBytes: 0,
          status: 'downloading',
        },
      },
    }));

    try {
      const res = await api.install(pkgId);
      await get().checkStatus();
      return res;
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },

  installAll: async () => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.packages : undefined;
    if (!api) return { ok: false };

    try {
      const res = await api.installAll();
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
