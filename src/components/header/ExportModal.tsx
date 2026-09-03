import React, { useEffect, useRef, useState } from 'react';
import { useProjectStore, ExportTelemetry } from '../../store/projectStore';
import { useTimelineStore, getContentEndMs } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { runHardwareExport, ExportResolution, ExportResult } from '../../engine/exportPipeline';
import { exportTemiProjectBundle, TemiExportProgress, TemiExportResult } from '../../engine/temiBundle';
import { formatDuration, formatFileSize } from '../../utils/time';
import { notifyExportComplete } from '../../utils/soundEffects';
import { usePackagesStore } from '../../store/packagesStore';
import { SegmentedControl, ToggleRow, Section } from '../ui/Controls';
import {
  X, Download, Check, Film, Zap, Cpu, Layers, FolderOpen, ExternalLink, RefreshCw, AlertTriangle, Package,
  ShieldCheck, Lock, Image as ImageIcon, Music, Video,
} from '../ui/icons';

/* The short edge - the long edge follows the project's aspect ratio. */
const RESOLUTIONS = [
  { value: '720p', label: '720p', hint: 'Fast' },
  { value: '1080p', label: '1080p', hint: 'Standard' },
  { value: '1440p', label: '2K', hint: 'Sharper' },
  { value: '4k', label: '4K', hint: 'Maximum' },
] as const;

const CODECS = [
  { value: 'h264', label: 'H.264', hint: 'Universal' },
  { value: 'hevc', label: 'HEVC', hint: 'Smaller' },
  { value: 'prores', label: 'ProRes', hint: 'Editing' },
] as const;

/*
  The two encoders, in the user's terms rather than the pipeline's.
*/
const ENGINES = [
  { value: 'auto', label: 'Fast', hint: 'Hardware encode, nothing re-encoded' },
  { value: 'ffmpeg', label: 'Precise', hint: 'Constant quality, slower' },
] as const;

const WORKER_CHOICES = [
  { value: 'auto', label: 'Auto', hint: 'One window. The fastest option on every project measured' },
  { value: '2', label: '2', hint: 'Two windows. Slower unless the render is compositing-bound' },
  { value: '4', label: '4', hint: 'Four windows. Much slower on anything that decodes video' },
] as const;

const PLATFORM_PRESETS = [
  { id: 'youtube', label: 'YouTube', detail: '1080p · H.264 · 30fps', resolution: '1080p', codec: 'h264' },
  { id: 'tiktok', label: 'TikTok / Reels', detail: '1080p · H.264 · vertical', resolution: '1080p', codec: 'h264' },
  { id: 'master', label: 'Master', detail: '4K · ProRes', resolution: '4k', codec: 'prores' },
] as const;

/** "4m 12s", "38s" - short enough to sit in a stat cell. */
function shortDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

/** Thousands separated, so a five-digit frame count is readable at a glance. */
function grouped(n: number): string {
  return n.toLocaleString('en-GB');
}

export const ExportModal: React.FC = () => {
  const isOpen = useProjectStore((s) => s.isExportModalOpen);
  const setOpen = useProjectStore((s) => s.setExportModalOpen);
  const project = useProjectStore((s) => s.project);
  const isExporting = useProjectStore((s) => s.isExporting);
  const exportProgress = useProjectStore((s) => s.exportProgress);
  const exportStatusText = useProjectStore((s) => s.exportStatusText);
  const telemetry = useProjectStore((s) => s.exportTelemetry);
  const setIsExporting = useProjectStore((s) => s.setIsExporting);
  const setExportProgress = useProjectStore((s) => s.setExportProgress);
  const setLastExportPath = useProjectStore((s) => s.setLastExportPath);
  const setActiveExportCancelHandler = useProjectStore((s) => s.setActiveExportCancelHandler);

  const tracks = useTimelineStore((s) => s.tracks);
  const inPointMs = useTimelineStore((s) => s.inPointMs);
  const outPointMs = useTimelineStore((s) => s.outPointMs);
  const pushToast = useUiStore((s) => s.pushToast);

  const packages = usePackagesStore((s) => s.packages);
  const downloads = usePackagesStore((s) => s.downloads);
  const installPackage = usePackagesStore((s) => s.installPackage);
  const checkStatus = usePackagesStore((s) => s.checkStatus);
  const setPackagesModalOpen = usePackagesStore((s) => s.setModalOpen);

  useEffect(() => {
    if (isOpen) {
      void checkStatus();
    }
  }, [isOpen, checkStatus]);

  const ffmpegInstalled = packages.ffmpeg?.installed ?? true;
  const ffmpegDownload = downloads.ffmpeg;
  const isFfmpegDownloading =
    ffmpegDownload &&
    (ffmpegDownload.status === 'downloading' || ffmpegDownload.status === 'extracting');

  const [resolution, setResolution] = useState<ExportResolution>('1080p');
  const [codec, setCodec] = useState<'h264' | 'hevc' | 'prores'>('h264');
  const [engine, setEngine] = useState<'auto' | 'ffmpeg'>('auto');
  const [workerChoice, setWorkerChoice] = useState<'2' | '4' | 'auto'>('auto');
  const [rangeOnly, setRangeOnly] = useState(false);
  const [done, setDone] = useState<ExportResult | null>(null);

  // Tab: 'video' | 'project'
  const [exportTab, setExportTab] = useState<'video' | 'project'>('video');

  // .temi Project export state
  const mediaPool = useTimelineStore((s) => s.mediaPool);
  const [isTemiExporting, setIsTemiExporting] = useState(false);
  const [temiProgress, setTemiProgress] = useState<TemiExportProgress | null>(null);
  const [temiDone, setTemiDone] = useState<TemiExportResult | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const startTemiExport = async () => {
    setIsTemiExporting(true);
    setTemiDone(null);
    setTemiProgress({ phase: 'collecting', percent: 5, statusText: 'Preparing project bundle…' });

    try {
      const result = await exportTemiProjectBundle({
        onProgress: setTemiProgress,
      });

      if (!result.ok || !result.blob) {
        throw new Error(result.error || 'Failed to export project bundle.');
      }

      // Download / trigger save
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.fileName || `${project.name}.temi`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      setTemiDone(result);
      notifyExportComplete('TeminaliCut Project Exported', `${result.fileName} (${formatFileSize(result.sizeBytes || 0)})`);
      pushToast({
        kind: 'success',
        title: 'Project bundle exported',
        detail: `${result.fileName} · ${formatFileSize(result.sizeBytes || 0)} · ${result.assetCount} media assets`,
      });
    } catch (err) {
      pushToast({ kind: 'error', title: 'Project export failed', detail: (err as Error).message });
    } finally {
      setIsTemiExporting(false);
    }
  };

  const handleCancelExport = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsExporting(false);
    setExportProgress(0, 'Cancelled', 'idle', null);
    pushToast({ kind: 'info', title: 'Export cancelled' });
  };

  const handleMinimize = () => {
    setOpen(false);
    if (isExporting) {
      pushToast({
        kind: 'info',
        title: 'Export running in background',
        detail: 'Track progress in the top bar.',
      });
    }
  };

  if (!isOpen) return null;

  const hasRange = inPointMs !== null || outPointMs !== null;
  const contentEnd = getContentEndMs(tracks);
  const exportDuration = rangeOnly && hasRange
    ? (outPointMs ?? project.durationMs) - (inPointMs ?? 0)
    : Math.max(contentEnd, project.durationMs);

  const clipCount = tracks.reduce((sum, t) => sum + t.clips.length, 0);
  const frameCount = Math.max(1, Math.round((exportDuration / 1000) * project.fps));

  /* ProRes has no WebCodecs encoder, so offering the fast path for it
     would be offering something that silently becomes the other one. */
  const fastAvailable = codec !== 'prores';

  const start = async () => {
    if (!ffmpegInstalled) {
      pushToast({ kind: 'info', title: 'Downloading FFmpeg engine...' });
      const r = await installPackage('ffmpeg');
      if (!r.ok) {
        pushToast({ kind: 'error', title: 'Failed to download FFmpeg', detail: r.error });
        return;
      }
    }

    setDone(null);
    setIsExporting(true);
    setExportProgress(0, 'Preparing…', 'preparing', null);

    const abort = new AbortController();
    abortRef.current = abort;
    setActiveExportCancelHandler(() => {
      abort.abort();
    });

    try {
      const range = rangeOnly && hasRange
        ? { startMs: inPointMs ?? 0, durationMs: exportDuration }
        : {};

      const result = await runHardwareExport(
        tracks,
        project,
        {
          resolution,
          fps: project.fps as 30 | 60,
          codec,
          engine: fastAvailable ? engine : 'ffmpeg',
          ...(workerChoice === 'auto' ? {} : { workers: Number(workerChoice) }),
          ...range,
          signal: abort.signal,
        },
        (progress, statusText, detail) =>
          setExportProgress(
            progress,
            statusText,
            detail?.phase === 'audio' ? 'muxing' : 'rendering',
            detail ? (detail as ExportTelemetry) : undefined
          ),
        abort.signal
      );

      setLastExportPath(result.outputPath);
      setDone(result);
      setExportProgress(100, 'Complete', 'done', null);

      // Trigger success audio chime and desktop notification
      const fileName = result.outputPath.split(/[\\/]/).pop() ?? result.outputPath;
      notifyExportComplete('TeminaliCut Export Complete', `${fileName} (${(result.bytes / 1024 / 1024).toFixed(1)} MB)`);

      pushToast({
        kind: 'success',
        title: 'Export finished',
        detail: `${result.outputPath} · ${(result.bytes / 1024 / 1024).toFixed(1)} MB · ${result.frames} frames`
          + (result.subtitlePaths?.length ? ` · ${result.subtitlePaths.length} subtitle files` : ''),
      });
    } catch (err) {
      if (abort.signal.aborted || (err as Error).name === 'AbortError' || /cancel|abort/i.test((err as Error).message)) {
        setExportProgress(0, 'Cancelled', 'idle', null);
        pushToast({ kind: 'info', title: 'Export cancelled' });
      } else {
        setExportProgress(0, 'Failed', 'error', null);
        pushToast({ kind: 'error', title: 'Export failed', detail: (err as Error).message });
      }
    } finally {
      abortRef.current = null;
      setActiveExportCancelHandler(null);
      setIsExporting(false);
    }
  };

  const isAnyExporting = isExporting || isTemiExporting;
  const isAnyDone = Boolean(done || temiDone);

  return (
    <div className="scrim" onClick={() => (isAnyExporting ? handleMinimize() : setOpen(false))}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`modal-shell max-w-[92vw] rounded-2xl bg-spectrum-panelHeader border border-spectrum-cardHover shadow-modal overflow-hidden ${isAnyExporting || isAnyDone ? 'w-[520px]' : 'w-[500px]'}`}
        role="dialog"
        aria-modal="true"
        aria-label="Export"
      >
        <div className="panel-header px-6 py-4 border-b border-line bg-spectrum-panelHeader flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-spectrum-hover border border-line flex items-center justify-center flex-shrink-0">
              {exportTab === 'project' ? (
                <ShieldCheck className="w-4 h-4 text-spectrum-accent" />
              ) : (
                <Download className="w-4 h-4 text-spectrum-accent" />
              )}
            </span>
            <span className="text-display font-semibold text-spectrum-textBright tracking-tight">Export</span>
            {isExporting && (
              <span className="px-2 py-0.5 rounded-[4px] text-ui-xs bg-spectrum-blue/10 text-spectrum-blue border border-spectrum-blue/20 animate-pulse font-mono">
                Rendering Video
              </span>
            )}
            {isTemiExporting && (
              <span className="px-2 py-0.5 rounded-[4px] text-ui-xs bg-spectrum-accentSoft text-spectrum-accent border border-spectrum-accentLine animate-pulse font-mono">
                Bundling .temi
              </span>
            )}
          </div>
          <button
            onClick={() => (isAnyExporting ? handleMinimize() : setOpen(false))}
            className="w-7 h-7 rounded-lg text-spectrum-textDim hover:text-spectrum-textBright hover:bg-spectrum-cardHover flex items-center justify-center transition-colors"
            title={isAnyExporting ? 'Minimize to background' : 'Close'}
            aria-label={isAnyExporting ? 'Minimize to background' : 'Close the export dialog'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher (shown when not exporting and not finished) */}
        {!isAnyExporting && !isAnyDone && (
          <div className="px-6 pt-3 pb-2 border-b border-line flex items-center gap-2 bg-spectrum-sunken">
            <button
              onClick={() => setExportTab('video')}
              className={`px-3 py-1.5 rounded-lg text-ui font-medium flex items-center gap-2 transition-all ${
                exportTab === 'video'
                  ? 'bg-spectrum-accentSoft text-spectrum-accent border border-spectrum-accentLine shadow-sm'
                  : 'text-spectrum-textMuted hover:text-spectrum-textBright hover:bg-spectrum-hover border border-transparent'
              }`}
            >
              <Film className="w-4 h-4" />
              Video Master
            </button>
            <button
              onClick={() => setExportTab('project')}
              className={`px-3 py-1.5 rounded-lg text-ui font-medium flex items-center gap-2 transition-all ${
                exportTab === 'project'
                  ? 'bg-spectrum-accentSoft text-spectrum-accent border border-spectrum-accentLine shadow-sm'
                  : 'text-spectrum-textMuted hover:text-spectrum-textBright hover:bg-spectrum-hover border border-transparent'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              Project File (.temi)
            </button>
          </div>
        )}

        {/* Video Done View */}
        {done ? (
          <ExportDone
            result={done}
            onAgain={() => setDone(null)}
            onClose={() => { setDone(null); setOpen(false); }}
          />
        ) : isExporting ? (
          /* Video Running View */
          <ExportRunning
            progress={exportProgress}
            statusText={exportStatusText}
            telemetry={telemetry}
            onCancel={handleCancelExport}
            onMinimize={handleMinimize}
          />
        ) : exportTab === 'project' ? (
          /* Temi Project Export Flow */
          temiDone ? (
            <TemiExportDone
              result={temiDone}
              projectName={project.name}
              onAgain={() => setTemiDone(null)}
              onClose={() => { setTemiDone(null); setOpen(false); }}
            />
          ) : isTemiExporting ? (
            <TemiExportRunning progress={temiProgress} />
          ) : (
            <>
              <div className="max-h-[54vh] overflow-y-auto p-0">
                <Section title="Project Overview" icon={ShieldCheck}>
                  <div className="grid grid-cols-2 gap-2 text-ui-sm">
                    <SummaryCell label="Project Name" value={project.name} />
                    <SummaryCell label="Duration" value={formatDuration(exportDuration)} />
                    <SummaryCell label="Canvas" value={`${project.width}×${project.height} (${project.aspectRatio})`} />
                    <SummaryCell label="Timeline Structure" value={`${clipCount} clips · ${tracks.length} tracks`} />
                  </div>
                </Section>

                <Section title={`Bundled Media Assets (${mediaPool.length})`} icon={Package}>
                  {mediaPool.length === 0 ? (
                    <div className="p-3 rounded-lg bg-spectrum-sunken border border-line text-micro text-spectrum-textMuted">
                      No external media assets in pool. All timeline tracks, shapes, text, animations, and effects will be packaged.
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {mediaPool.map((asset) => (
                        <div
                          key={asset.id}
                          className="flex items-center justify-between p-2 rounded-lg bg-spectrum-sunken border border-line text-ui-sm"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {asset.type === 'video' ? (
                              <Video className="w-3.5 h-3.5 text-spectrum-blue shrink-0" />
                            ) : asset.type === 'audio' ? (
                              <Music className="w-3.5 h-3.5 text-spectrum-purple shrink-0" />
                            ) : (
                              <ImageIcon className="w-3.5 h-3.5 text-spectrum-green shrink-0" />
                            )}
                            <span className="truncate text-spectrum-text text-ui-xs font-mono">{asset.name}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-micro font-mono text-spectrum-textFaint">
                              {formatDuration(asset.durationMs)}
                            </span>
                            {asset.fileSizeFormatted && (
                              <span className="text-micro font-mono text-spectrum-textDim">
                                {asset.fileSizeFormatted}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-micro text-spectrum-textFaint pt-1">
                    All video footage, audio beds, and images are embedded directly into the encrypted .temi file so any recipient can open and start editing immediately without missing assets.
                  </p>
                </Section>

                <Section title="Encryption" icon={Lock}>
                  <div className="p-3 rounded-lg bg-spectrum-accentSoft border border-spectrum-accentLine flex items-start gap-2">
                    <ShieldCheck className="w-4 h-4 text-spectrum-accent shrink-0 mt-0.5" />
                    <div className="text-micro text-spectrum-text space-y-0.5">
                      <span className="font-semibold block">AES-256-GCM Encrypted</span>
                      <p className="text-spectrum-textMuted leading-relaxed">
                        Your project bundle is compressed with GZIP and encrypted with AES-256-GCM.
                        The file can only be opened in TeminaliCut and cannot be extracted for use in other editors.
                      </p>
                    </div>
                  </div>
                </Section>
              </div>

              <div className="p-4 px-6 border-t border-spectrum-cardHover bg-spectrum-sunken flex items-center justify-end gap-3">
                <button
                  onClick={() => setOpen(false)}
                  className="pro-btn-filled h-9 px-4 rounded-lg text-ui font-medium bg-spectrum-sunken border border-spectrum-cardHover hover:border-spectrum-borderStrong text-spectrum-textBright"
                >
                  Cancel
                </button>
                <button
                  onClick={startTemiExport}
                  className="btn-primary h-9 px-5 rounded-lg gap-2 text-ui font-medium"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Export .temi Project
                </button>
              </div>
            </>
          )
        ) : (
          /* Video Settings Form */
          <>
            <div className="max-h-[54vh] overflow-y-auto">
              {!ffmpegInstalled && (
                <div className="m-3 p-3 rounded-squircle-sm bg-spectrum-accentSoft border border-spectrum-accentLine flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 text-ui-sm font-semibold text-spectrum-text">
                        <Package className="w-4 h-4 text-spectrum-accent" />
                        <span>FFmpeg Video Engine Required</span>
                      </div>
                      <p className="text-micro text-spectrum-textMuted">
                        TeminaliCut requires standalone FFmpeg to render and mix videos on Windows, macOS, and Linux.
                      </p>
                    </div>
                    <button
                      onClick={() => void installPackage('ffmpeg')}
                      disabled={isFfmpegDownloading}
                      className="px-3 py-1.5 rounded-squircle-sm text-ui-xs font-medium bg-spectrum-accent hover:opacity-90 text-spectrum-onAccent transition-all flex items-center gap-1.5 shrink-0 shadow-sm disabled:opacity-50"
                    >
                      {isFfmpegDownloading ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>{ffmpegDownload.percent}%</span>
                        </>
                      ) : (
                        <>
                          <Download className="w-3.5 h-3.5" />
                          <span>1-Click Install</span>
                        </>
                      )}
                    </button>
                  </div>
                  {isFfmpegDownloading && (
                    <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-spectrum-accent transition-all duration-200"
                        style={{ width: `${Math.max(5, ffmpegDownload.percent)}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              <Section title="Presets" icon={Film}>
                <div className="grid grid-cols-3 gap-1.5">
                  {PLATFORM_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => { setResolution(preset.resolution as any); setCodec(preset.codec as any); }}
                      className={`card-interactive p-2 text-left ${
                        resolution === preset.resolution && codec === preset.codec
                          ? '!bg-spectrum-accentSoft !border-spectrum-accentLine'
                          : ''
                      }`}
                    >
                      <span className="block text-ui-sm font-medium text-spectrum-text">{preset.label}</span>
                      <span className="block text-micro text-spectrum-textFaint mt-0.5">{preset.detail}</span>
                    </button>
                  ))}
                </div>
              </Section>

              <Section title="Settings">
                <div className="space-y-1">
                  <span className="text-ui-sm text-spectrum-textMuted">Resolution</span>
                  <SegmentedControl
                    value={resolution}
                    onChange={setResolution}
                    options={RESOLUTIONS.map((r) => ({ value: r.value, label: r.label, title: r.hint }))}
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-ui-sm text-spectrum-textMuted">Codec</span>
                  <SegmentedControl
                    value={codec}
                    onChange={setCodec}
                    options={CODECS.map((c) => ({ value: c.value, label: c.label, title: c.hint }))}
                  />
                </div>
                {hasRange && (
                  <ToggleRow
                    label="Export the in/out range only"
                    hint={`${formatDuration((outPointMs ?? project.durationMs) - (inPointMs ?? 0))} of ${formatDuration(project.durationMs)}`}
                    checked={rangeOnly}
                    onChange={setRangeOnly}
                  />
                )}
              </Section>

              <Section title="Speed" icon={Zap}>
                <div className="space-y-1">
                  <span className="text-ui-sm text-spectrum-textMuted">Encoder</span>
                  <SegmentedControl
                    value={fastAvailable ? engine : 'ffmpeg'}
                    onChange={setEngine}
                    options={ENGINES.map((e) => ({
                      value: e.value,
                      label: e.label,
                      title: e.hint,
                      disabled: e.value === 'auto' && !fastAvailable,
                    }))}
                  />
                  <p className="text-micro text-spectrum-textFaint pt-0.5">
                    {!fastAvailable
                      ? 'ProRes has no hardware encoder, so it always takes the precise path.'
                      : engine === 'auto'
                        ? 'The frame goes straight from the canvas to the platform encoder and is never re-encoded.'
                        : 'Constant quality, one JPEG per frame through libx264. Slower, and the right choice for a master.'}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-ui-sm text-spectrum-textMuted">Render windows</span>
                  <SegmentedControl
                    value={workerChoice}
                    onChange={setWorkerChoice}
                    options={WORKER_CHOICES.map((w) => ({ value: w.value, label: w.label, title: w.hint }))}
                  />
                  <p className={`text-micro pt-0.5 ${workerChoice === 'auto' ? 'text-spectrum-textFaint' : 'text-spectrum-amber'}`}>
                    {workerChoice === 'auto'
                      ? 'One window renders the whole timeline. Splitting it across more was measured '
                        + 'and is slower: video is decoded in one shared process however many windows ask.'
                      : 'Slower on anything that decodes video, and it will make the machine '
                        + 'sluggish while it runs. Worth trying only if a render is limited by '
                        + 'compositing rather than by footage.'}
                  </p>
                </div>
              </Section>

              <Section title="Summary">
                <div className="grid grid-cols-2 gap-2 text-ui-sm">
                  <SummaryCell label="Duration" value={formatDuration(exportDuration)} />
                  <SummaryCell label="Frames" value={`${grouped(frameCount)} at ${project.fps} fps`} />
                  <SummaryCell label="Canvas" value={`${project.width}×${project.height}`} />
                  <SummaryCell label="Clips" value={`${clipCount} across ${tracks.length} tracks`} />
                </div>
              </Section>
            </div>

            <div className="p-4 px-6 border-t border-spectrum-cardHover bg-spectrum-sunken flex items-center justify-end gap-3">
              <button onClick={() => setOpen(false)} className="pro-btn-filled h-9 px-4 rounded-lg text-ui font-medium bg-spectrum-sunken border border-spectrum-cardHover hover:border-spectrum-borderStrong text-spectrum-textBright">
                Cancel
              </button>
              <button onClick={start} className="btn-primary h-9 px-5 rounded-lg gap-2 text-ui font-medium">
                <Download className="w-4 h-4" />
                Start export
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/* ── While it runs ─────────────────────────────────────────────────

   The old panel was a spinner, a line of text and a bar. That is enough
   to know something is happening and not enough to know anything else -
   and a render is the one thing in this app a user WAITS for, so the
   dialog they are staring at is the one place worth spending a design
   on. What is on screen now is what the render is actually doing: the
   rate, the time left, the encoder, and one bar per render window.   */

const ExportRunning: React.FC<{
  progress: number;
  statusText: string;
  telemetry: ExportTelemetry | null;
  onCancel: () => void;
  onMinimize: () => void;
}> = ({ progress, statusText, telemetry, onCancel, onMinimize }) => {
  const lanes = telemetry?.lanes ?? [];
  const phase: 'render' | 'audio' | 'write' =
    progress >= 96 ? 'write' : progress >= 92 ? 'audio' : 'render';

  return (
    <div className="p-5 space-y-4">
      {/* The headline number. Tabular, so it does not jitter as it counts. */}
      <div className="text-center pt-1">
        <div className="export-figure tabular">{Math.round(progress)}<span className="export-figure-unit">%</span></div>
        <p className="text-ui-sm text-spectrum-textDim tabular mt-0.5">
          {telemetry
            ? `frame ${grouped(telemetry.frame)} of ${grouped(telemetry.totalFrames)}`
            : statusText || 'Rendering…'}
        </p>
      </div>

      <div className="export-track">
        <div className="export-track-fill" style={{ width: `${Math.max(1, progress)}%` }}>
          <span className="export-track-sheen" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatCell
          icon={<Zap className="w-3 h-3" />}
          label="Rate"
          value={telemetry && telemetry.fps > 0 ? `${Math.round(telemetry.fps)} fps` : '-'}
        />
        <StatCell
          icon={<Film className="w-3 h-3" />}
          label="Remaining"
          value={telemetry?.etaMs != null ? shortDuration(telemetry.etaMs) : '-'}
        />
        <StatCell
          icon={<Cpu className="w-3 h-3" />}
          label="Encoder"
          value={telemetry?.engine === 'webcodecs' ? 'Hardware' : telemetry ? 'ffmpeg' : '-'}
        />
      </div>

      {lanes.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Layers className="w-3 h-3 text-spectrum-textFaint" />
            <span className="text-micro uppercase tracking-wide text-spectrum-textFaint">
              {lanes.length} render windows
            </span>
          </div>
          {lanes.map((lane) => (
            <div key={lane.worker} className="flex items-center gap-2">
              <span className="text-micro font-mono text-spectrum-textFaint w-3 tabular">{lane.worker + 1}</span>
              <div className="export-lane flex-1">
                <div
                  className="export-lane-fill"
                  style={{
                    width: `${lane.totalFrames > 0 ? Math.round((lane.frames / lane.totalFrames) * 100) : 0}%`,
                  }}
                />
              </div>
              <span className="text-micro font-mono text-spectrum-textFaint tabular w-14 text-right">
                chunk {lane.chunk + 1}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Where the render is in its own life, so "Mixing audio" at 92%
          reads as a step rather than a stall. */}
      <div className="flex items-center gap-1.5 pt-0.5">
        <PhaseChip label="Render" state={phase === 'render' ? 'live' : 'done'} />
        <PhaseChip label="Audio" state={phase === 'audio' ? 'live' : phase === 'write' ? 'done' : 'todo'} />
        <PhaseChip label="Write" state={phase === 'write' ? 'live' : 'todo'} />
        <span className="text-micro text-spectrum-textFaint truncate ml-auto">{statusText}</span>
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-line">
        <button
          type="button"
          onClick={onCancel}
          className="pro-btn-filled h-8 px-3 text-ui text-spectrum-textMuted hover:text-spectrum-red hover:border-spectrum-red/30 transition-colors flex items-center gap-1.5"
          title="Cancel this export"
        >
          <X className="w-3.5 h-3.5" />
          Cancel export
        </button>
        <button
          type="button"
          onClick={onMinimize}
          className="btn-primary h-8 px-3 text-ui flex items-center gap-1.5"
          title="Keep exporting in the background and continue editing"
        >
          <Download className="w-3.5 h-3.5" />
          Continue in background
        </button>
      </div>
    </div>
  );
};

const PhaseChip: React.FC<{ label: string; state: 'todo' | 'live' | 'done' }> = ({ label, state }) => (
  <span className={`export-phase export-phase-${state}`}>
    <span className="export-phase-dot" />
    {label}
  </span>
);

const StatCell: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="card px-2 py-1.5">
    <span className="flex items-center gap-1 text-micro text-spectrum-textFaint">{icon}{label}</span>
    <span className="block font-mono text-spectrum-text tabular truncate">{value}</span>
  </div>
);

/* ── When it is finished ───────────────────────────────────────────

   A path a user cannot act on is a path they have to copy by hand. The
   two buttons are the two things anyone does next: look at the file, or
   watch it.                                                          */

const ExportDone: React.FC<{
  result: ExportResult;
  onAgain: () => void;
  onClose: () => void;
}> = ({ result, onAgain, onClose }) => {
  const pushToast = useUiStore((s) => s.pushToast);
  const [busy, setBusy] = useState<'reveal' | 'open' | null>(null);
  /* Cleared on unmount, so a reply arriving after the dialog closed does
     not set state on a component that is gone. */
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const fileName = result.outputPath.split(/[\\/]/).pop() ?? result.outputPath;
  const rate = result.elapsedMs > 0 ? Math.round((result.frames / result.elapsedMs) * 1000) : 0;

  const reveal = async () => {
    setBusy('reveal');
    try {
      await window.electronAPI?.shell?.reveal(result.outputPath);
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const open = async () => {
    setBusy('open');
    try {
      const r = await window.electronAPI?.shell?.open(result.outputPath);
      /* `openPath` answers with a reason rather than throwing, and a
         button that silently does nothing is worse than one that says
         why it could not. */
      if (r && !r.ok) {
        pushToast({ kind: 'error', title: 'Could not open the file', detail: r.error ?? 'The system refused.' });
      }
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  return (
    <div className="p-6 flex flex-col items-center text-center gap-2">
      <div className="export-tick">
        <Check className="w-5 h-5 text-spectrum-green" />
      </div>
      <p className="text-ui-lg font-semibold text-spectrum-text">Export complete</p>
      <p className="text-ui-sm font-mono text-spectrum-textDim break-all max-w-[360px]">{fileName}</p>

      <p className="text-micro text-spectrum-textFaint tabular">
        {result.width}×{result.height} · {formatDuration(result.durationMs)} ·{' '}
        {(result.bytes / 1024 / 1024).toFixed(1)} MB · {grouped(result.frames)} frames
      </p>
      <p className="text-micro text-spectrum-textFaint tabular">
        {shortDuration(result.elapsedMs)}{rate > 0 ? ` at ${rate} fps` : ''}
        {' · '}
        {result.engine === 'webcodecs' ? 'hardware encode' : 'ffmpeg encode'}
        {result.farm.workers > 1 ? ` · ${result.farm.workers} windows, ${result.farm.chunks} chunks` : ''}
      </p>
      {result.audioError && (
        <p className="text-micro text-spectrum-amber max-w-[360px]">{result.audioError}</p>
      )}

      {/*
        Named rather than merely written. A subtitle file that appears
        silently beside the video is one nobody uploads, because nobody
        knows it is there - and being able to upload it is the entire
        reason it is written.
      */}
      {result.subtitlePaths && result.subtitlePaths.length > 0 && (
        <p className="text-micro text-spectrum-textFaint max-w-[360px]">
          {result.subtitlePaths
            .map((p) => (p.split(/[\\/]/).pop() ?? p).split('.').pop()?.toUpperCase())
            .join(' and ')}
          {' subtitles written beside it, for YouTube and the rest.'}
        </p>
      )}
      {result.subtitleNote && (
        <p className="text-micro text-spectrum-textFaint max-w-[360px]">{result.subtitleNote}</p>
      )}

      <div className="flex flex-wrap justify-center gap-2 pt-2">
        <button onClick={reveal} disabled={busy !== null} className="pro-btn-filled h-7 px-3 gap-1.5 text-ui-sm">
          <FolderOpen className="w-3.5 h-3.5" />
          Show in folder
        </button>
        <button onClick={open} disabled={busy !== null} className="pro-btn-filled h-7 px-3 gap-1.5 text-ui-sm">
          <ExternalLink className="w-3.5 h-3.5" />
          Open
        </button>
        <button onClick={onAgain} className="pro-btn-filled h-7 px-3 text-ui-sm">
          Export again
        </button>
        <button onClick={onClose} className="btn-primary h-7 px-3 text-ui-sm">
          Done
        </button>
      </div>
    </div>
  );
};

const SummaryCell: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="card px-2 py-1.5">
    <span className="block text-micro text-spectrum-textFaint">{label}</span>
    <span className="block font-mono text-spectrum-text tabular truncate">{value}</span>
  </div>
);

const TemiExportRunning: React.FC<{ progress: TemiExportProgress | null }> = ({ progress }) => {
  const percent = Math.min(100, Math.max(0, progress?.percent ?? 0));
  const phase = progress?.phase ?? 'collecting';

  return (
    <div className="p-6 space-y-5">
      <div className="text-center pt-2">
        <div className="export-figure tabular">
          {Math.round(percent)}
          <span className="export-figure-unit">%</span>
        </div>
        <p className="text-ui font-medium text-spectrum-text mt-1">
          {progress?.statusText || 'Bundling project…'}
        </p>
        {progress?.currentAsset && (
          <p className="text-micro font-mono text-spectrum-textFaint truncate max-w-[360px] mx-auto mt-0.5">
            {progress.currentAsset}
          </p>
        )}
      </div>

      <div className="export-track">
        <div className="export-track-fill" style={{ width: `${Math.max(2, percent)}%` }}>
          <span className="export-track-sheen" />
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 pt-1">
        <PhaseChip label="Collect Media" state={phase === 'collecting' ? 'live' : percent > 40 ? 'done' : 'todo'} />
        <PhaseChip label="Compress" state={phase === 'compressing' ? 'live' : percent > 70 ? 'done' : 'todo'} />
        <PhaseChip label="AES-256 Encrypt" state={phase === 'encrypting' ? 'live' : percent >= 100 ? 'done' : 'todo'} />
        <PhaseChip label="Download" state={phase === 'done' ? 'done' : 'todo'} />
      </div>

      <p className="text-micro text-spectrum-textFaint text-center max-w-[340px] mx-auto pt-1">
        Bundling all assets and compressing the editing timeline into a self-contained encrypted package.
      </p>
    </div>
  );
};

const TemiExportDone: React.FC<{
  result: TemiExportResult;
  projectName: string;
  onAgain: () => void;
  onClose: () => void;
}> = ({ result, projectName, onAgain, onClose }) => {
  const pushToast = useUiStore((s) => s.pushToast);

  const downloadAgain = () => {
    if (!result.blob) return;
    const url = URL.createObjectURL(result.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = result.fileName || `${projectName}.temi`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    pushToast({ kind: 'info', title: 'Download triggered' });
  };

  return (
    <div className="p-6 flex flex-col items-center text-center gap-3">
      <div className="w-12 h-12 rounded-2xl bg-spectrum-accentSoft border border-spectrum-accentLine flex items-center justify-center shadow-lg shadow-spectrum-accent/10">
        <ShieldCheck className="w-6 h-6 text-spectrum-accent" />
      </div>
      <div>
        <p className="text-ui-lg font-semibold text-spectrum-text">Project Exported (.temi)</p>
        <p className="text-ui-sm font-mono text-spectrum-textDim break-all max-w-[380px] mt-0.5">
          {result.fileName}
        </p>
      </div>

      <div className="p-3 rounded-xl bg-spectrum-sunken border border-line w-full max-w-[380px] text-left space-y-1.5">
        <div className="flex justify-between text-ui-xs">
          <span className="text-spectrum-textMuted">File Size:</span>
          <span className="font-mono text-spectrum-text font-medium">{formatFileSize(result.sizeBytes || 0)}</span>
        </div>
        <div className="flex justify-between text-ui-xs">
          <span className="text-spectrum-textMuted">Bundled Assets:</span>
          <span className="font-mono text-spectrum-text font-medium">{result.assetCount} media files</span>
        </div>
        <div className="flex justify-between text-ui-xs">
          <span className="text-spectrum-textMuted">Encryption:</span>
          <span className="font-mono text-spectrum-accent font-medium">
            AES-256-GCM (TeminaliCut)
          </span>
        </div>
      </div>

      <p className="text-micro text-spectrum-textFaint max-w-[380px] leading-relaxed">
        This file contains all footage, audio, and timeline edits. Send it to anyone - they can open it in TeminaliCut and immediately begin editing.
      </p>

      <div className="flex flex-wrap justify-center gap-2 pt-2">
        <button onClick={downloadAgain} className="pro-btn-filled h-8 px-3 gap-1.5 text-ui-sm">
          <Download className="w-3.5 h-3.5" />
          Download again
        </button>
        <button onClick={onAgain} className="pro-btn-filled h-8 px-3 text-ui-sm">
          Export settings
        </button>
        <button onClick={onClose} className="btn-primary h-8 px-4 text-ui-sm">
          Done
        </button>
      </div>
    </div>
  );
};

