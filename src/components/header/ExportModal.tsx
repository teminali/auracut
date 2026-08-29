import React, { useEffect, useRef, useState } from 'react';
import { useProjectStore, ExportTelemetry } from '../../store/projectStore';
import { useTimelineStore, getContentEndMs } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { runHardwareExport, ExportResolution, ExportResult } from '../../engine/exportPipeline';
import { formatDuration } from '../../utils/time';
import { SegmentedControl, ToggleRow, Section } from '../ui/Controls';
import {
  X, Download, Check, Film, Zap, Cpu, Layers, FolderOpen, ExternalLink,
} from '../ui/icons';

/* The short edge — the long edge follows the project's aspect ratio. */
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

  `fast` is WebCodecs: the frame goes from the canvas to the platform
  encoder and ffmpeg stream-copies the result, so nothing is read back,
  compressed to JPEG, or encoded a second time. `precise` is the original
  path — JPEG stills into libx264 at `-crf 18`, which is quality-targeted
  rather than bitrate-targeted and is the only way to get ProRes.

  Named for what they DO, not which library they use. "Hardware" would be
  the wrong word: the ffmpeg path can use VideoToolbox too.
*/
const ENGINES = [
  { value: 'auto', label: 'Fast', hint: 'Hardware encode, nothing re-encoded' },
  { value: 'ffmpeg', label: 'Precise', hint: 'Constant quality, slower' },
] as const;

/*
  More windows is SLOWER, and the control says so rather than implying
  otherwise. Chromium decodes video in the shared GPU process, so extra
  render windows queue onto one decoder instead of getting their own.
  Measured on 900 frames of 1080p: one window 7889ms, four windows
  47488ms. `Auto` is one window.
*/
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

/** "4m 12s", "38s" — short enough to sit in a stat cell. */
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

  const tracks = useTimelineStore((s) => s.tracks);
  const inPointMs = useTimelineStore((s) => s.inPointMs);
  const outPointMs = useTimelineStore((s) => s.outPointMs);
  const pushToast = useUiStore((s) => s.pushToast);

  const [resolution, setResolution] = useState<ExportResolution>('1080p');
  const [codec, setCodec] = useState<'h264' | 'hevc' | 'prores'>('h264');
  const [engine, setEngine] = useState<'auto' | 'ffmpeg'>('auto');
  const [workerChoice, setWorkerChoice] = useState<'2' | '4' | 'auto'>('auto');
  const [rangeOnly, setRangeOnly] = useState(false);
  const [done, setDone] = useState<ExportResult | null>(null);

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
    setDone(null);
    setIsExporting(true);
    setExportProgress(0, 'Preparing…', 'preparing', null);

    try {
      /*
        `rangeOnly` used to reach nothing but a label. `exportDuration`
        was computed right here, shown as the hint under the checkbox,
        and then dropped — the export ran 0 -> project.durationMs
        whatever the box said. Ticking it changed the text and not the
        file.
      */
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
        },
        (progress, statusText, detail) =>
          setExportProgress(
            progress,
            statusText,
            detail?.phase === 'audio' ? 'muxing' : 'rendering',
            detail ? (detail as ExportTelemetry) : undefined
          )
      );
      setLastExportPath(result.outputPath);
      setDone(result);
      setExportProgress(100, 'Complete', 'done', null);
      pushToast({
        kind: 'success',
        title: 'Export finished',
        // Say what actually landed on disk, not just where it was aimed.
        detail: `${result.outputPath} · ${(result.bytes / 1024 / 1024).toFixed(1)} MB · ${result.frames} frames`
          + (result.subtitlePaths?.length ? ` · ${result.subtitlePaths.length} subtitle files` : ''),
      });
    } catch (err) {
      setExportProgress(0, 'Failed', 'error', null);
      pushToast({ kind: 'error', title: 'Export failed', detail: (err as Error).message });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="scrim" onClick={() => !isExporting && setOpen(false)}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`modal-shell max-w-[92vw] ${isExporting || done ? 'w-[520px]' : 'w-[460px]'}`}
        role="dialog"
        aria-modal="true"
        aria-label="Export"
      >
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <Download className="w-3.5 h-3.5 text-spectrum-accent" />
            <span className="text-ui font-semibold text-spectrum-text">Export</span>
          </div>
          <button
            onClick={() => setOpen(false)}
            disabled={isExporting}
            className="pro-btn w-6 h-6"
            aria-label="Close the export dialog"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {done ? (
          <ExportDone
            result={done}
            onAgain={() => setDone(null)}
            onClose={() => { setDone(null); setOpen(false); }}
          />
        ) : isExporting ? (
          <ExportRunning
            progress={exportProgress}
            statusText={exportStatusText}
            telemetry={telemetry}
          />
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

            <div className="p-3 border-t border-line flex items-center justify-end gap-2">
              <button onClick={() => setOpen(false)} className="pro-btn-filled h-8 px-3 text-ui">
                Cancel
              </button>
              <button onClick={start} className="btn-primary h-8 px-4 gap-1.5 text-ui">
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

/* ── While it runs ─────────────────────────────────────────────────

   The old panel was a spinner, a line of text and a bar. That is enough
   to know something is happening and not enough to know anything else —
   and a render is the one thing in this app a user WAITS for, so the
   dialog they are staring at is the one place worth spending a design
   on. What is on screen now is what the render is actually doing: the
   rate, the time left, the encoder, and one bar per render window.   */

const ExportRunning: React.FC<{
  progress: number;
  statusText: string;
  telemetry: ExportTelemetry | null;
}> = ({ progress, statusText, telemetry }) => {
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
    <div className="p-6 flex flex-col items-center text-center gap-2.5">
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
        knows it is there — and being able to upload it is the entire
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
