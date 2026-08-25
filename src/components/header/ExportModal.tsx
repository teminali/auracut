import React, { useState } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useTimelineStore, getContentEndMs } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { runHardwareExport } from '../../engine/exportPipeline';
import { formatDuration } from '../../utils/time';
import { SegmentedControl, ToggleRow, Section } from '../ui/Controls';
import { X, Download, Check, Film, Loader2 } from 'lucide-react';

const RESOLUTIONS = [
  { value: '720p', label: '720p', hint: 'Fast' },
  { value: '1080p', label: '1080p', hint: 'Standard' },
  { value: '4k', label: '4K', hint: 'Maximum' },
] as const;

const CODECS = [
  { value: 'h264', label: 'H.264', hint: 'Universal' },
  { value: 'hevc', label: 'HEVC', hint: 'Smaller' },
  { value: 'prores', label: 'ProRes', hint: 'Editing' },
] as const;

const PLATFORM_PRESETS = [
  { id: 'youtube', label: 'YouTube', detail: '1080p · H.264 · 30fps', resolution: '1080p', codec: 'h264' },
  { id: 'tiktok', label: 'TikTok / Reels', detail: '1080p · H.264 · vertical', resolution: '1080p', codec: 'h264' },
  { id: 'master', label: 'Master', detail: '4K · ProRes', resolution: '4k', codec: 'prores' },
] as const;

export const ExportModal: React.FC = () => {
  const isOpen = useProjectStore((s) => s.isExportModalOpen);
  const setOpen = useProjectStore((s) => s.setExportModalOpen);
  const project = useProjectStore((s) => s.project);
  const isExporting = useProjectStore((s) => s.isExporting);
  const exportProgress = useProjectStore((s) => s.exportProgress);
  const exportStatusText = useProjectStore((s) => s.exportStatusText);
  const setIsExporting = useProjectStore((s) => s.setIsExporting);
  const setExportProgress = useProjectStore((s) => s.setExportProgress);
  const setLastExportPath = useProjectStore((s) => s.setLastExportPath);

  const tracks = useTimelineStore((s) => s.tracks);
  const inPointMs = useTimelineStore((s) => s.inPointMs);
  const outPointMs = useTimelineStore((s) => s.outPointMs);
  const pushToast = useUiStore((s) => s.pushToast);

  const [resolution, setResolution] = useState<'720p' | '1080p' | '4k'>('1080p');
  const [codec, setCodec] = useState<'h264' | 'hevc' | 'prores'>('h264');
  const [rangeOnly, setRangeOnly] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  if (!isOpen) return null;

  const hasRange = inPointMs !== null || outPointMs !== null;
  const contentEnd = getContentEndMs(tracks);
  const exportDuration = rangeOnly && hasRange
    ? (outPointMs ?? project.durationMs) - (inPointMs ?? 0)
    : Math.max(contentEnd, project.durationMs);

  const clipCount = tracks.reduce((sum, t) => sum + t.clips.length, 0);

  const start = async () => {
    setDone(null);
    setIsExporting(true);
    setExportProgress(0, 'Preparing…', 'preparing');

    try {
      const result = await runHardwareExport(
        tracks,
        project,
        { resolution, fps: project.fps as 30 | 60, codec },
        (progress, statusText) => setExportProgress(progress, statusText, 'rendering')
      );
      setLastExportPath(result.outputPath);
      setDone(result.outputPath);
      setExportProgress(100, 'Complete', 'done');
      pushToast({
        kind: 'success',
        title: 'Export finished',
        // Say what actually landed on disk, not just where it was aimed.
        detail: `${result.outputPath} · ${(result.bytes / 1024 / 1024).toFixed(1)} MB · ${result.frames} frames`,
      });
    } catch (err) {
      setExportProgress(0, 'Failed', 'error');
      pushToast({ kind: 'error', title: 'Export failed', detail: (err as Error).message });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="scrim" onClick={() => !isExporting && setOpen(false)}>
      <div onClick={(e) => e.stopPropagation()} className="modal-shell w-[460px] max-w-[92vw]">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <Download className="w-3.5 h-3.5 text-spectrum-accent" />
            <span className="text-[12px] font-semibold text-spectrum-text">Export</span>
          </div>
          <button onClick={() => setOpen(false)} disabled={isExporting} className="pro-btn w-6 h-6">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {done ? (
          <div className="p-6 flex flex-col items-center text-center gap-2.5">
            <div className="w-11 h-11 rounded-full bg-spectrum-green/15 border border-spectrum-green/30 flex items-center justify-center">
              <Check className="w-5 h-5 text-spectrum-green" />
            </div>
            <p className="text-[13px] font-semibold text-spectrum-text">Export complete</p>
            <p className="text-[11px] font-mono text-spectrum-textDim break-all max-w-[320px]">{done}</p>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setDone(null)} className="pro-btn-filled h-7 px-3 text-[11px]">
                Export again
              </button>
              <button onClick={() => { setDone(null); setOpen(false); }} className="btn-primary h-7 px-3 text-[11px]">
                Done
              </button>
            </div>
          </div>
        ) : isExporting ? (
          <div className="p-6 space-y-3">
            <div className="flex items-center gap-2.5">
              <Loader2 className="w-4 h-4 text-spectrum-accent animate-spin flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-spectrum-text">{exportStatusText || 'Rendering…'}</p>
                <p className="text-[10px] text-spectrum-textDim">{Math.round(exportProgress)}% complete</p>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-spectrum-sunken overflow-hidden">
              <div
                className="h-full bg-spectrum-accent rounded-full transition-[width] duration-300"
                style={{ width: `${exportProgress}%` }}
              />
            </div>
          </div>
        ) : (
          <>
            <div className="max-h-[54vh] overflow-y-auto">
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
                      <span className="block text-[11px] font-medium text-spectrum-text">{preset.label}</span>
                      <span className="block text-[9px] text-spectrum-textFaint mt-0.5">{preset.detail}</span>
                    </button>
                  ))}
                </div>
              </Section>

              <Section title="Settings">
                <div className="space-y-1">
                  <span className="text-[11px] text-spectrum-textMuted">Resolution</span>
                  <SegmentedControl
                    value={resolution}
                    onChange={setResolution}
                    options={RESOLUTIONS.map((r) => ({ value: r.value, label: r.label, title: r.hint }))}
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[11px] text-spectrum-textMuted">Codec</span>
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

              <Section title="Summary">
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <SummaryCell label="Duration" value={formatDuration(exportDuration)} />
                  <SummaryCell label="Frame rate" value={`${project.fps} fps`} />
                  <SummaryCell label="Canvas" value={`${project.width}×${project.height}`} />
                  <SummaryCell label="Clips" value={`${clipCount} across ${tracks.length} tracks`} />
                </div>
              </Section>
            </div>

            <div className="p-3 border-t border-line flex items-center justify-end gap-2">
              <button onClick={() => setOpen(false)} className="pro-btn-filled h-8 px-3 text-[12px]">
                Cancel
              </button>
              <button onClick={start} className="btn-primary h-8 px-4 gap-1.5 text-[12px]">
                <Download className="w-3.5 h-3.5" />
                Start export
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const SummaryCell: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="card px-2 py-1.5">
    <span className="block text-[9px] text-spectrum-textFaint">{label}</span>
    <span className="block font-mono text-spectrum-text tabular truncate">{value}</span>
  </div>
);
