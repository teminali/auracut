import React, { useEffect } from 'react';
import {
  Package,
  Download,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
  HardDrive,
  Cpu,
  Layers,
  Sparkle,
  ExternalLink,
} from '../ui/icons';
import { usePackagesStore, PackageItem } from '../../store/packagesStore';

export const PackagesModal: React.FC = () => {
  const {
    isModalOpen,
    setModalOpen,
    packages,
    downloads,
    platform,
    isLoading,
    checkStatus,
    installPackage,
    installAll,
  } = usePackagesStore();

  useEffect(() => {
    if (isModalOpen) {
      void checkStatus();
    }
  }, [isModalOpen, checkStatus]);

  if (!isModalOpen) return null;

  const pkgList = Object.values(packages);
  const corePackages = pkgList.filter((p) => p.category === 'core');
  const aiModels = pkgList.filter((p) => p.category === 'ai-stt');

  const allCoreInstalled = corePackages.length > 0 && corePackages.every((p) => p.installed);
  const isAnyDownloading = Object.values(downloads).some(
    (d) => d.status === 'downloading' || d.status === 'extracting'
  );

  const getPlatformName = (plt: string) => {
    if (plt === 'win32') return 'Windows';
    if (plt === 'darwin') return 'macOS';
    if (plt === 'linux') return 'Linux';
    return plt || 'System';
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="packages-modal-title"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/75 backdrop-blur-md animate-fade-in p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isAnyDownloading) {
          setModalOpen(false);
        }
      }}
    >
      <div className="relative w-full max-w-3xl bg-layer-surface border border-border-subtle rounded-panel shadow-modal overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-border-subtle flex items-center justify-between bg-layer-base/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-input bg-accent-default/10 border border-accent-default/25 flex items-center justify-center text-accent-default">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="packages-modal-title" className="text-ui-lg font-semibold text-ui-fg">
                  Packages & Models Manager
                </h2>
                <span className="px-2 py-0.5 rounded text-micro font-medium bg-layer-hover text-ui-fg-subtle border border-border-subtle">
                  {getPlatformName(platform)}
                </span>
              </div>
              <p className="text-ui-xs text-ui-fg-muted mt-0.5">
                Download standalone video engines and AI speech models directly inside FrontierCut.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void checkStatus()}
              disabled={isLoading}
              className="p-2 rounded-input hover:bg-layer-hover text-ui-fg-subtle hover:text-ui-fg transition-colors"
              title="Refresh status"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setModalOpen(false)}
              disabled={isAnyDownloading}
              className="p-2 rounded-input hover:bg-layer-hover text-ui-fg-subtle hover:text-ui-fg transition-colors disabled:opacity-30"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Master Action Banner */}
        <div className="px-6 py-4 bg-gradient-to-r from-accent-default/10 via-layer-surface to-accent-default/5 border-b border-border-subtle flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="text-ui font-medium text-ui-fg flex items-center gap-2">
              <Sparkle className="w-4 h-4 text-accent-default" />
              <span>1-Click Core Package Pack</span>
            </div>
            <p className="text-ui-xs text-ui-fg-muted mt-0.5">
              Installs standalone FFmpeg, FFprobe, and Whisper Base model for full offline rendering.
            </p>
          </div>
          <button
            onClick={() => void installAll()}
            disabled={allCoreInstalled || isAnyDownloading}
            className={`px-4 py-2 rounded-input text-ui font-medium flex items-center gap-2 transition-all shadow-sm shrink-0 ${
              allCoreInstalled
                ? 'bg-layer-hover text-ui-fg-muted cursor-default border border-border-subtle'
                : 'bg-accent-default hover:bg-accent-hover text-accent-contrast active:scale-[0.98]'
            }`}
          >
            {allCoreInstalled ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-accent-default" />
                <span>All Core Ready</span>
              </>
            ) : isAnyDownloading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Downloading...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Download All Packages</span>
              </>
            )}
          </button>
        </div>

        {/* Package List */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Core Engine Section */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <HardDrive className="w-4 h-4 text-accent-default" />
              <h3 className="text-ui-xs font-semibold uppercase tracking-wider text-ui-fg-muted">
                Core Video & Media Engine
              </h3>
            </div>
            <div className="grid gap-3">
              {corePackages.map((pkg) => (
                <PackageCard
                  key={pkg.id}
                  pkg={pkg}
                  download={downloads[pkg.id]}
                  onInstall={() => void installPackage(pkg.id)}
                />
              ))}
            </div>
          </div>

          {/* AI Speech Models Section */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Cpu className="w-4 h-4 text-accent-default" />
              <h3 className="text-ui-xs font-semibold uppercase tracking-wider text-ui-fg-muted">
                AI Speech-To-Text Models
              </h3>
            </div>
            <div className="grid gap-3">
              {aiModels.map((pkg) => (
                <PackageCard
                  key={pkg.id}
                  pkg={pkg}
                  download={downloads[pkg.id]}
                  onInstall={() => void installPackage(pkg.id)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border-subtle bg-layer-base/40 flex items-center justify-between text-ui-xs text-ui-fg-subtle">
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5" />
            <span>Packages are stored locally inside FrontierCut user data and never conflict with system binaries.</span>
          </div>
          <button
            onClick={() => setModalOpen(false)}
            className="px-3 py-1.5 rounded-input bg-layer-hover hover:bg-layer-selected text-ui-fg transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

interface PackageCardProps {
  pkg: PackageItem;
  download?: {
    percent: number;
    transferredBytes: number;
    totalBytes: number;
    status: string;
    error?: string;
  };
  onInstall: () => void;
}

const PackageCard: React.FC<PackageCardProps> = ({ pkg, download, onInstall }) => {
  const isDownloading = download && (download.status === 'downloading' || download.status === 'extracting');
  const percent = download?.percent ?? 0;

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '';
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(1)} MB`;
  };

  return (
    <div className="p-4 rounded-input border border-border-subtle bg-layer-base/60 hover:bg-layer-base transition-colors flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 flex-1">
          <div className="flex items-center gap-2.5">
            <span className="text-ui font-medium text-ui-fg">{pkg.name}</span>
            {pkg.installed ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-micro font-medium bg-accent-default/15 text-accent-default border border-accent-default/30">
                <CheckCircle2 className="w-3 h-3" />
                <span>Installed</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-micro font-medium bg-layer-hover text-ui-fg-subtle border border-border-subtle">
                <span>Not Installed</span>
              </span>
            )}
            {pkg.sizeMb ? (
              <span className="text-micro text-ui-fg-muted font-mono">{pkg.sizeMb} MB</span>
            ) : null}
          </div>
          <p className="text-ui-xs text-ui-fg-muted">{pkg.description}</p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {pkg.requiredFor.map((req) => (
              <span
                key={req}
                className="px-1.5 py-0.5 rounded text-micro bg-layer-hover text-ui-fg-subtle border border-border-subtle/50"
              >
                {req}
              </span>
            ))}
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-2">
          {pkg.installed ? (
            <button
              onClick={onInstall}
              disabled={isDownloading}
              className="px-3 py-1.5 rounded-input text-ui-xs font-medium text-ui-fg-subtle hover:text-ui-fg hover:bg-layer-hover border border-border-subtle transition-colors"
            >
              Reinstall
            </button>
          ) : (
            <button
              onClick={onInstall}
              disabled={isDownloading}
              className="px-3.5 py-1.5 rounded-input text-ui-xs font-medium bg-accent-default hover:bg-accent-hover text-accent-contrast transition-all flex items-center gap-1.5 shadow-sm"
            >
              {isDownloading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>{percent}%</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      {isDownloading && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-micro text-ui-fg-subtle">
            <span className="capitalize">{download.status}...</span>
            <span>
              {formatBytes(download.transferredBytes)}
              {download.totalBytes > 0 ? ` / ${formatBytes(download.totalBytes)}` : ''} ({percent}%)
            </span>
          </div>
          <div className="w-full h-1.5 bg-layer-hover rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-default transition-all duration-200"
              style={{ width: `${Math.max(5, percent)}%` }}
            />
          </div>
        </div>
      )}

      {download?.error && (
        <div className="flex items-center gap-2 text-ui-xs text-status-error bg-status-error/10 p-2 rounded border border-status-error/20">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{download.error}</span>
        </div>
      )}
    </div>
  );
};
