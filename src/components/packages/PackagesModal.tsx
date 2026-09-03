import React, { useEffect, useMemo, useState } from 'react';
import {
  Package,
  Download,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Cpu,
  Layers,
  Sparkle,
  HardDrive,
  Check,
  Play,
  Volume2,
  Activity,
  Server,
  Lock,
} from '../ui/icons';
import { usePackagesStore, PackageItem } from '../../store/packagesStore';
import { StandardModal } from '../ui/StandardModal';

export const PackagesModal: React.FC = () => {
  const {
    isModalOpen,
    setModalOpen,
    packages,
    downloads,
    hardware,
    platform,
    arch,
    isLoading,
    checkStatus,
    installPackage,
    installAll,
  } = usePackagesStore();

  const [tab, setTab] = useState<'all' | 'core' | 'ai-stt' | 'device'>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (isModalOpen) {
      void checkStatus();
    }
  }, [isModalOpen, checkStatus]);

  if (!isModalOpen) return null;

  const pkgList = Object.values(packages);
  const corePackages = pkgList.filter((p) => p.category === 'core');
  const aiModels = pkgList.filter((p) => p.category === 'ai-stt');

  const coreInstalledCount = corePackages.filter((p) => p.installed).length;
  const modelInstalledCount = aiModels.filter((p) => p.installed).length;
  const allCoreInstalled = corePackages.length > 0 && corePackages.every((p) => p.installed);

  const filteredPackages = pkgList.filter((p) => {
    if (tab === 'core' && p.category !== 'core') return false;
    if (tab === 'ai-stt' && p.category !== 'ai-stt') return false;
    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    return (
      p.name.toLowerCase().includes(needle) ||
      p.description.toLowerCase().includes(needle) ||
      p.id.toLowerCase().includes(needle) ||
      p.requiredFor.some((r) => r.toLowerCase().includes(needle))
    );
  });

  const isAnyDownloading = Object.values(downloads).some(
    (d) => d.status === 'downloading' || d.status === 'extracting'
  );

  const recommendedModel = aiModels.find((m) => m.recommended) || aiModels.find((m) => m.id === 'model-base');

  return (
    <StandardModal
      isOpen={isModalOpen}
      onClose={() => {
        if (!isAnyDownloading) setModalOpen(false);
      }}
      title="Packages & Models Manager"
      icon={Package}
      iconColor="var(--accent-ink)"
      maxWidth="w-[720px]"
      badge={{
        text: hardware.isAppleSilicon
          ? 'APPLE SILICON · ARM64'
          : `${(platform || 'SYSTEM').toUpperCase()} · ${(arch || 'X64').toUpperCase()}`,
        variant: allCoreInstalled ? 'green' : 'amber',
        pulse: true,
      }}
      stats={[
        {
          label: 'Hardware',
          value: `${hardware.cores} Cores`,
          hint: `${hardware.totalMemGb} GB RAM`,
        },
        {
          label: 'Architecture',
          value: hardware.isAppleSilicon ? 'Apple Silicon' : (arch || 'x64').toUpperCase(),
          hint: platform === 'darwin' ? 'macOS Metal' : platform === 'win32' ? 'Windows' : 'Linux',
        },
        {
          label: 'Core Engines',
          value: `${coreInstalledCount} / ${corePackages.length}`,
          hint: allCoreInstalled ? 'Engines Ready' : 'Setup needed',
        },
        {
          label: 'AI STT Models',
          value: `${modelInstalledCount} / ${aiModels.length}`,
          hint: 'Whisper Local',
        },
      ]}
      tabs={[
        { id: 'all', label: 'All Packages', count: pkgList.length },
        { id: 'core', label: 'Core Engines', count: corePackages.length },
        { id: 'ai-stt', label: 'AI Speech Models', count: aiModels.length },
        { id: 'device', label: 'Device & Hardware' },
      ]}
      activeTab={tab}
      onTabChange={(t) => setTab(t as any)}
      searchQuery={tab !== 'device' ? query : undefined}
      onSearchChange={tab !== 'device' ? setQuery : undefined}
      searchPlaceholder="Search engines, models, capabilities…"
      headerActions={
        <button
          onClick={() => void checkStatus()}
          disabled={isLoading}
          className="w-[26px] h-[24px] rounded-[2px] grid place-items-center text-spectrum-textDim hover:text-spectrum-accent hover:bg-line-bright transition-colors"
          title="Refresh package status"
          aria-label="Refresh package status"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-spectrum-accent' : ''}`} />
        </button>
      }
      footer={
        <>
          <span className="flex items-center gap-1.5 text-spectrum-green">
            <span className="w-1.5 h-1.5 rounded-full bg-spectrum-green" />
            Local Isolated Storage
          </span>
          <span className="truncate max-w-[340px] text-spectrum-textFaint">
            Packages stored in TeminaliCut user data
          </span>
          <div className="ml-auto flex items-center gap-2">
            {!allCoreInstalled ? (
              <button
                onClick={() => void installAll(recommendedModel?.id)}
                disabled={isAnyDownloading}
                className="px-3 h-6 rounded-[2px] bg-spectrum-accent hover:bg-spectrum-accent text-spectrum-onAccent font-semibold text-ui-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <Download className="w-3 h-3" />
                Install Recommended Pack
              </button>
            ) : (
              <span className="flex items-center gap-1.5 text-spectrum-green text-ui-xs font-semibold">
                <Check className="w-3.5 h-3.5" />
                Core Packages Ready
              </span>
            )}
          </div>
        </>
      }
    >
      {/* Smart Device Recommendation Banner */}
      {recommendedModel && !recommendedModel.installed && tab !== 'device' && (
        <div className="p-3 rounded-[2px] bg-spectrum-cardHover border border-spectrum-cardHover flex items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-8 h-8 rounded-[2px] bg-spectrum-accent/15 border border-spectrum-accent/30 grid place-items-center text-spectrum-accent flex-shrink-0 mt-0.5">
              <Sparkle className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-ui-sm font-bold text-spectrum-accent">
                  Recommended for your machine: {recommendedModel.name}
                </span>
                <span className="font-mono text-micro px-1.5 py-0.5 rounded-[2px] bg-spectrum-accent/20 text-spectrum-accent font-semibold">
                  {recommendedModel.sizeMb} MB
                </span>
              </div>
              <p className="text-ui-xs text-spectrum-accent mt-1 leading-relaxed">
                {recommendedModel.recommendedReason || hardware.recommendationReason}
              </p>
            </div>
          </div>
          <button
            onClick={() => void installPackage(recommendedModel.id)}
            disabled={Boolean(downloads[recommendedModel.id])}
            className="px-3 h-7 rounded-[2px] bg-spectrum-accent hover:bg-spectrum-accent text-spectrum-onAccent font-semibold text-ui-xs flex items-center gap-1.5 flex-shrink-0 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Download
          </button>
        </div>
      )}

      {/* Device & Hardware Specifications Tab */}
      {tab === 'device' ? (
        <div className="space-y-4">
          <div className="p-4 rounded-[2px] bg-spectrum-cardHover border border-spectrum-panelHeader space-y-3">
            <div className="flex items-center gap-2 border-b border-spectrum-card pb-2">
              <Cpu className="w-4 h-4 text-spectrum-accent" />
              <h3 className="text-ui-lg font-bold text-spectrum-accent">Detected Hardware Profile</h3>
              <span className="font-mono text-micro px-1.5 py-0.5 rounded-[2px] bg-spectrum-green/10 text-spectrum-green border border-spectrum-green/25 ml-auto">
                OPTIMAL
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-ui-sm">
              <div className="p-2 rounded-[2px] bg-spectrum-panelHeader border border-spectrum-panelHeader">
                <span className="text-micro text-spectrum-textFaint font-mono block uppercase">Processor & Cores</span>
                <span className="font-semibold text-spectrum-accent block mt-0.5">{hardware.cpuModel}</span>
                <span className="text-micro text-spectrum-textPlaceholder font-mono">{hardware.cores} Logical Execution Threads</span>
              </div>
              <div className="p-2 rounded-[2px] bg-spectrum-panelHeader border border-spectrum-panelHeader">
                <span className="text-micro text-spectrum-textFaint font-mono block uppercase">System Memory</span>
                <span className="font-semibold text-spectrum-accent block mt-0.5">{hardware.totalMemGb} GB Total RAM</span>
                <span className="text-micro text-spectrum-textPlaceholder font-mono">~{hardware.freeMemGb} GB Available for Models</span>
              </div>
              <div className="p-2 rounded-[2px] bg-spectrum-panelHeader border border-spectrum-panelHeader">
                <span className="text-micro text-spectrum-textFaint font-mono block uppercase">Hardware Acceleration</span>
                <span className="font-semibold text-spectrum-green block mt-0.5">
                  {hardware.isAppleSilicon ? 'Apple Neural Engine + Metal GPU' : 'Multi-threaded SIMD Vector'}
                </span>
                <span className="text-micro text-spectrum-textPlaceholder font-mono">Zero-copy unified memory access</span>
              </div>
              <div className="p-2 rounded-[2px] bg-spectrum-panelHeader border border-spectrum-panelHeader">
                <span className="text-micro text-spectrum-textFaint font-mono block uppercase">Optimal AI Model Tier</span>
                <span className="font-semibold text-spectrum-accent block mt-0.5">
                  {recommendedModel ? recommendedModel.name : 'Whisper Base'}
                </span>
                <span className="text-micro text-spectrum-textPlaceholder font-mono">Auto-configured for instant transcription</span>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-[2px] bg-spectrum-cardHover border border-spectrum-panelHeader space-y-2">
            <h4 className="font-mono text-micro font-bold tracking-[0.13em] text-spectrum-textDim uppercase">
              How TeminaliCut Tunes AI Models
            </h4>
            <p className="text-ui text-spectrum-textDim leading-relaxed">
              TeminaliCut dynamically matches quantized speech-to-text models to your host machine.
              On Apple Silicon, ggml models execute directly on Metal and Neural Engine cores with sub-2-second latency for 90-second voice clips.
            </p>
          </div>
        </div>
      ) : (
        /* Packages List */
        <div className="space-y-4">
          {/* Core Engines Section */}
          {(tab === 'all' || tab === 'core') && corePackages.length > 0 && (
            <div>
              <h3 className="font-mono text-micro font-bold tracking-[0.13em] text-spectrum-textDim uppercase mb-2 flex items-center justify-between">
                <span>Core Video & Media Engines</span>
                <span className="text-spectrum-textPlaceholder font-normal">{coreInstalledCount}/{corePackages.length} Installed</span>
              </h3>
              <div className="space-y-2">
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
          )}

          {/* AI STT Models Section */}
          {(tab === 'all' || tab === 'ai-stt') && aiModels.length > 0 && (
            <div>
              <h3 className="font-mono text-micro font-bold tracking-[0.13em] text-spectrum-textDim uppercase mb-2 flex items-center justify-between">
                <span>AI Speech-to-Text Models (Whisper)</span>
                <span className="text-spectrum-textPlaceholder font-normal">{modelInstalledCount}/{aiModels.length} Installed</span>
              </h3>
              <div className="space-y-2">
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
          )}

          {filteredPackages.length === 0 && (
            <p className="text-ui text-spectrum-textFaint text-center py-10">
              No packages or models match "{query}".
            </p>
          )}
        </div>
      )}
    </StandardModal>
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
  const isError = download?.status === 'error';

  return (
    <div className="p-3 rounded-[2px] bg-spectrum-cardHover border border-spectrum-panelHeader hover:border-line-bright transition-colors space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-ui-sm font-mono font-semibold text-spectrum-accent">{pkg.name}</code>
            {pkg.sizeMb && (
              <span className="font-mono text-micro px-1.5 py-0.5 rounded-[2px] bg-spectrum-panelHeader border border-line-bright text-spectrum-textFaint">
                {pkg.sizeMb} MB
              </span>
            )}
            {pkg.recommended && (
              <span className="font-mono text-micro px-1.5 py-0.5 rounded-[2px] bg-spectrum-accent/15 text-spectrum-accent border border-spectrum-accent/30 font-semibold flex items-center gap-1">
                <Sparkle className="w-3 h-3 text-spectrum-accent" /> Recommended for your device
              </span>
            )}
            {pkg.installed && (
              <span className="font-mono text-micro px-1.5 py-0.5 rounded-[2px] bg-spectrum-green/15 text-spectrum-green border border-spectrum-green/30 font-semibold flex items-center gap-1">
                <Check className="w-3 h-3" /> Ready
              </span>
            )}
          </div>
          <p className="text-ui text-spectrum-textDim mt-1 leading-relaxed">{pkg.description}</p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {pkg.installed ? (
            <button
              onClick={onInstall}
              disabled={isDownloading}
              className="px-2 py-1 rounded-[2px] bg-spectrum-card border border-line-bright text-ui-xs font-semibold text-spectrum-textFaint hover:text-spectrum-accent hover:bg-spectrum-cardHover transition-colors flex items-center gap-1.5"
              title="Re-download / Verify package"
            >
              <RefreshCw className="w-3 h-3" />
              Reinstall
            </button>
          ) : (
            <button
              onClick={onInstall}
              disabled={isDownloading}
              className="px-3 h-7 rounded-[2px] bg-spectrum-accent hover:bg-spectrum-accent text-spectrum-onAccent font-semibold text-ui-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              {isDownloading ? `${download.percent}%` : 'Download'}
            </button>
          )}
        </div>
      </div>

      {/* Download Progress Bar */}
      {isDownloading && (
        <div className="space-y-1 pt-1">
          <div className="flex items-center justify-between text-micro font-mono text-spectrum-textFaint">
            <span>{download.status === 'extracting' ? 'Extracting package…' : 'Downloading…'}</span>
            <span>{download.percent}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-spectrum-panelHeader overflow-hidden border border-line-bright">
            <div
              className="h-full bg-spectrum-accent transition-all duration-200"
              style={{ width: `${download.percent}%` }}
            />
          </div>
        </div>
      )}

      {isError && download?.error && (
        <div className="p-2 rounded-[2px] bg-spectrum-cardHover border border-spectrum-cardHover text-micro text-spectrum-red font-mono">
          Download error: {download.error}
        </div>
      )}

      {/* Required for tags */}
      {pkg.requiredFor.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          <span className="text-micro text-spectrum-textPlaceholder font-mono">Enables:</span>
          {pkg.requiredFor.map((feat) => (
            <span
              key={feat}
              className="font-mono text-micro px-1.5 py-0.2 rounded-[2px] bg-spectrum-panelHeader text-spectrum-textFaint"
            >
              {feat}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
