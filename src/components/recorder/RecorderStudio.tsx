/* ═══════════════════════════════════════════════════════════════════
   The recorder, as one screen with five states.

   setup → countdown → recording → processing → review

   Kept as one modal rather than a wizard because only the first and the
   last of those need a decision from anybody; the middle three are the
   app telling you what it is doing. A wizard would put a Next button
   under a countdown.

   The window is usually HIDDEN during `recording`, which is the whole
   reason `RecorderBar` exists — so the recording state drawn here is
   what you see when you turned that off, and the bar is what you see
   when you did not. Both drive the same store actions.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useRecorderStore } from '../../store/recorderStore';
import { useUiStore } from '../../store/uiStore';
import { usePackagesStore } from '../../store/packagesStore';
import { applyTutorialSkill, openTakeRaw, generateTakeCaptions, TutorialProgress } from '../../engine/tutorialSkill';
import { SpeechCue } from '../../engine/recordingProject';
import { detectMoments } from '../../engine/cursorZoom';
import { SourceGrid } from './SourceGrid';
import { CaptureOptions } from './CaptureOptions';
import { formatDuration, formatFileSize } from '../../utils/time';
import {
  X, Record, Pause, Play, Square, Loader2, AlertTriangle, CheckCircle2, Check,
  FolderOpen, CursorClick, Camera, Monitor, Mic, Trash2, Sparkle, Waves,
  Download, Package,
} from '../ui/icons';

interface Props {
  /** Leave home and show the timeline, once a take has been assembled. */
  onEnterEditor: () => void;
}

export const RecorderStudio: React.FC<Props> = ({ onEnterEditor }) => {
  const store = useRecorderStore();
  const pushToast = useUiStore((s) => s.pushToast);
  const [building, setBuilding] = React.useState(false);
  const [progress, setProgress] = React.useState<TutorialProgress | null>(null);

  const isOpen = store.isOpen;
  const busy = store.phase === 'recording' || store.phase === 'paused' || store.phase === 'processing';

  /* Escape closes, unless a take is running — `close` refuses that
     anyway, and this is the belt for it. Declared before the early
     return, because a hook cannot live behind one. */
  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) useRecorderStore.getState().close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, busy]);

  if (!isOpen) return null;

  const selected = store.sources.find((s) => s.id === store.selectedSourceId);
  const canAutoZoom = selected?.kind === 'screen';

  /*
    Two ways out of the review screen, and the difference is what the
    skill is FOR. `raw` lays the take down and stops. `skill` transcribes
    the narration, places zooms on the real clicks, dresses the frame,
    cuts to the camera between sentences and captions the whole thing.

    Both leave a project made of ordinary clips, so choosing the skill is
    not a commitment: everything it did is on a track somebody can change
    their mind about.
  */
  const build = async (mode: 'skill' | 'raw') => {
    const take = store.take;
    if (!take) return;
    setBuilding(true);
    setProgress(mode === 'skill'
      ? { phase: 'listening', percent: 0, note: 'Starting' }
      : null);

    try {
      let report;
      if (mode === 'skill') {
        const outcome = await applyTutorialSkill(take, store.tutorialOptions(), setProgress);
        if (!outcome.ok || !outcome.report) {
          /*
            Refused, and the take is untouched. The trial is spent on
            OTHER footage, not on this: nothing that was already built
            with a run is taken away, and "Open raw" below is still
            there, so the recording is never held hostage.
          */
          pushToast({
            kind: 'info',
            title: 'The Tutorial skill needs buying',
            detail: `${outcome.status.message} Open raw to keep the take.`,
            ttl: 9000,
          });
          return;
        }
        report = outcome.report;
      } else {
        report = await openTakeRaw(take);
      }

      store.close();
      onEnterEditor();

      const bits = [
        `${formatDuration(report.durationMs)} · ${report.width}x${report.height}`,
        `${report.clips} clip${report.clips === 1 ? '' : 's'}`,
      ];
      if (report.zoomMoments > 0) {
        bits.push(`${report.zoomMoments} zoom${report.zoomMoments === 1 ? '' : 's'}`);
      }
      if (report.cameraTakeovers > 0) bits.push(`${report.cameraTakeovers} to camera`);
      if (report.captionLines > 0) bits.push(`${report.captionLines} captions`);

      pushToast({
        kind: 'success',
        title: mode === 'skill' ? 'Tutorial skill applied' : 'Take is on the timeline',
        detail: bits.join(' · '),
      });
      for (const note of report.notes.slice(0, 2)) {
        pushToast({ kind: 'info', title: 'About this take', detail: note, ttl: 9000 });
      }
    } catch (err) {
      pushToast({ kind: 'error', title: 'Could not build the project', detail: (err as Error).message });
    } finally {
      setBuilding(false);
      setProgress(null);
    }
  };

  return (
    <div className="scrim" onClick={() => { if (!busy) store.close(); }}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-shell w-[960px] max-w-[95vw] h-[620px] max-h-[92vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Screen recorder"
      >
        <div className="panel-header flex-shrink-0">
          <span className="flex items-center gap-2 min-w-0">
            <Record className="w-3.5 h-3.5 text-spectrum-accent" weight="fill" />
            <span className="text-ui font-semibold text-spectrum-text">Record the screen</span>
          </span>
          <button
            onClick={store.close}
            disabled={busy}
            className="pro-btn w-6 h-6"
            aria-label="Close the recorder"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {store.phase === 'setup' && (
          <>
            <div className="flex-1 flex min-h-0">
              <div className="flex-1 min-w-0">
                <SourceGrid
                  sources={store.sources}
                  loading={store.sourcesLoading}
                  selectedId={store.selectedSourceId}
                  onSelect={store.selectSource}
                  onRefresh={() => void store.refreshSources()}
                />
              </div>
              <CaptureOptions
                settings={store.settings}
                cameras={store.cameras}
                microphones={store.microphones}
                permissions={store.permissions}
                canAutoZoom={Boolean(canAutoZoom)}
                onChange={store.set}
                onRequestPermission={(kind) => void store.requestPermission(kind)}
              />
            </div>
            <SetupFooter />
          </>
        )}

        {store.phase === 'countdown' && <Countdown seconds={store.countdown} />}

        {(store.phase === 'recording' || store.phase === 'paused') && <Running />}

        {store.phase === 'processing' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-6 h-6 text-spectrum-accent animate-spin" />
            <p className="text-ui-xl text-spectrum-text">Converting the take</p>
            <p className="text-ui-sm text-spectrum-textDim max-w-[380px] text-center leading-relaxed">
              A raw capture carries no duration and no seek index, so it is remuxed before it
              reaches the timeline. Long takes take a moment.
            </p>
          </div>
        )}

        {store.phase === 'review' && store.take && (
          <Review onBuild={build} building={building} progress={progress} />
        )}

        {store.phase === 'error' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-10 text-center">
            <AlertTriangle className="w-7 h-7 text-spectrum-red" />
            <p className="text-ui-xl text-spectrum-text">The recording did not start</p>
            <p className="text-ui-sm text-spectrum-textMuted leading-relaxed max-w-[440px]">{store.error}</p>
            <button
              onClick={() => useRecorderStore.setState({ phase: 'setup', error: null })}
              className="btn-primary h-8 px-4 text-ui mt-2"
            >
              Back to setup
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/* ── Setup footer ───────────────────────────────────────────────── */

const SetupFooter: React.FC = () => {
  const store = useRecorderStore();
  const selected = store.sources.find((s) => s.id === store.selectedSourceId);
  const screenBlocked = store.permissions?.screen === 'denied'
    || store.permissions?.screen === 'not-determined'
    || store.permissions?.screen === 'restricted';

  return (
    <div className="flex-shrink-0 border-t border-line px-3 py-2.5 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        {/*
          The stale grant comes FIRST, before the ordinary denied case,
          because the two need opposite advice and only one of them is
          ever true at a time. Sending somebody to System Settings when
          the switch there is already on is sending them to look at the
          thing that is not the problem.
        */}
        {store.screenGrantStale ? (
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-spectrum-amber flex-shrink-0" />
            <span className="text-ui-sm text-spectrum-textMuted truncate"
              title={'FrontierCut permissions need refreshing on macOS update.'}>
              Screen recording looks enabled but macOS is refusing it. Updating FrontierCut does this.
            </span>
            <button
              onClick={() => void store.repairScreenPermission()}
              className="btn-primary h-6 px-2 text-ui-xs flex-shrink-0"
            >
              Fix and restart
            </button>
          </div>
        ) : screenBlocked ? (
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-spectrum-amber flex-shrink-0" />
            <span className="text-ui-sm text-spectrum-textMuted truncate">
              macOS has not allowed FrontierCut to record the screen yet.
            </span>
            <button
              onClick={() => void store.repairScreenPermission()}
              className="btn-secondary h-6 px-2 text-ui-xs flex-shrink-0"
              title="Reset macOS permission cache so macOS will prompt again"
            >
              Reset permissions
            </button>
            <button
              onClick={() => void store.requestPermission('screen')}
              className="pro-btn-filled h-6 px-2 text-ui-xs flex-shrink-0"
            >
              Open settings
            </button>
          </div>
        ) : (
          <span className="flex items-center gap-3 text-ui-sm text-spectrum-textDim min-w-0">
            <span className="flex items-center gap-1.5 min-w-0">
              <Monitor className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{selected ? selected.name : 'Nothing selected'}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5" />
              {store.settings.cameraDeviceId ? 'Camera on' : 'No camera'}
            </span>
            <span className="flex items-center gap-1.5">
              <Mic className="w-3.5 h-3.5" />
              {store.settings.micDeviceId ? 'Mic on' : 'Silent'}
            </span>
          </span>
        )}
      </div>

      <button
        data-recorder="start"
        onClick={() => void store.begin()}
        disabled={!selected}
        className="btn-primary h-8 px-4 text-ui gap-2 flex-shrink-0"
      >
        <Record className="w-3.5 h-3.5" weight="fill" />
        Start recording
      </button>
    </div>
  );
};

/* ── Countdown ──────────────────────────────────────────────────── */

const Countdown: React.FC<{ seconds: number }> = ({ seconds }) => (
  <div className="flex-1 flex flex-col items-center justify-center gap-4">
    <span
      key={seconds}
      className="text-spectrum-text font-semibold tabular animate-scale-in"
      style={{ fontSize: 128, lineHeight: 1 }}
    >
      {seconds}
    </span>
    <p className="text-ui-lg text-spectrum-textDim">Get your window in front</p>
  </div>
);

/* ── Recording ──────────────────────────────────────────────────── */

/** Registered in `electron/screenRecorder.ts`; kept in step by hand. */
const SHORTCUT_MEANING: Record<string, string> = {
  'Alt+Shift+R': 'stop',
  'Alt+Shift+P': 'pause',
  'Alt+Shift+Z': 'mark',
};

const Running: React.FC = () => {
  const store = useRecorderStore();
  const paused = store.phase === 'paused';

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5">
      <div className="flex items-center gap-3">
        <span
          className={`w-3 h-3 rounded-full bg-spectrum-red ${paused ? 'opacity-40' : 'animate-pulse'}`}
          aria-hidden="true"
        />
        <span className="font-mono tabular text-spectrum-text" style={{ fontSize: 48, lineHeight: 1 }}>
          {formatDuration(store.elapsedMs)}
        </span>
      </div>

      <p className="text-ui-sm text-spectrum-textDim">
        {paused ? 'Paused' : 'Recording'}
        {store.markCount > 0 ? ` · ${store.markCount} marked` : ''}
      </p>

      <div className="flex items-center gap-2">
        <button onClick={() => void store.togglePause()} className="pro-btn-filled h-8 px-3.5 text-ui gap-1.5">
          {paused ? <Play className="w-3.5 h-3.5" weight="fill" /> : <Pause className="w-3.5 h-3.5" weight="fill" />}
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button onClick={() => store.mark()} className="pro-btn-filled h-8 px-3.5 text-ui gap-1.5">
          <CursorClick className="w-3.5 h-3.5" />
          Mark a zoom
        </button>
        <button onClick={() => void store.stop()} className="btn-primary h-8 px-4 text-ui gap-1.5">
          <Square className="w-3 h-3" weight="fill" />
          Stop
        </button>
      </div>

      {/* The only way to throw a take away, and it is deliberately not a
          button on the floating bar: a destructive action one press from
          Stop, on a pill you cannot see the label of at a glance, would
          be a way to lose a recording. */}
      <button
        onClick={() => void store.discard()}
        className="btn-ghost-danger h-7 px-3 text-ui-sm gap-1.5"
        title="Stop, and delete what has been recorded so far"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Stop and discard
      </button>

      {store.shortcuts.length > 0 && (
        /* Named, not listed. `globalShortcut` takes these keys away from
           every other app for as long as a take runs, so it is worth
           saying which one does what and which ones registered at all. */
        <p className="text-micro text-spectrum-textFaint">
          {store.shortcuts
            .map((accelerator) => `${accelerator} ${SHORTCUT_MEANING[accelerator] ?? ''}`.trim())
            .join(' · ')}
        </p>
      )}
    </div>
  );
};

/* ── Review ─────────────────────────────────────────────────────── */

const Review: React.FC<{
  onBuild: (mode: 'skill' | 'raw') => void;
  building: boolean;
  progress: TutorialProgress | null;
}> = ({ onBuild, building, progress }) => {
  const store = useRecorderStore();
  const packagesStore = usePackagesStore();
  const take = store.take!;
  const [cues, setCues] = React.useState<SpeechCue[]>(take.transcript ?? []);
  const [generating, setGenerating] = React.useState(false);
  const [autoStarted, setAutoStarted] = React.useState(false);
  const [skippedCaptions, setSkippedCaptions] = React.useState(false);
  const [showModelPrompt, setShowModelPrompt] = React.useState(false);

  const packages = packagesStore.packages;
  const downloads = packagesStore.downloads;
  const hasWhisperModel = Object.values(packages).some(
    (p) => p.category === 'ai-stt' && p.installed
  );
  const recommendedModel = Object.values(packages).find(
    (p) => p.category === 'ai-stt' && (p.recommended || p.id === 'model-base')
  ) || packages['model-base'];
  const downloadingModel = recommendedModel ? downloads[recommendedModel.id] : null;
  const isDownloadingModel = downloadingModel && (downloadingModel.status === 'downloading' || downloadingModel.status === 'extracting');

  /* The same detector the assembler will use, run once so the review can
     state a number rather than promise one. */
  const detected = React.useMemo(
    () => (take.cursorTracked
      ? detectMoments({ cursor: take.cursor, events: take.events, marks: take.marks })
      : { moments: [], from: 'cursor' as const }),
    [take]
  );
  const moments = detected.moments;
  const clicks = take.events.filter((e) => e.kind === 'click' || e.kind === 'rightclick').length;

  React.useEffect(() => {
    if (progress?.cues && progress.cues.length > 0) {
      setCues(progress.cues);
    }
  }, [progress?.cues]);

  const runGenerateCaptions = React.useCallback(async () => {
    if (generating || cues.length > 0) return;
    setGenerating(true);
    try {
      const res = await generateTakeCaptions(take, store.tutorialOptions());
      if (res.cues.length > 0) {
        setCues(res.cues);
        take.transcript = res.cues;
      }
    } catch {
      /* non-fatal preview generation */
    } finally {
      setGenerating(false);
    }
  }, [generating, cues.length, take, store]);

  React.useEffect(() => {
    if (!autoStarted && (take.camera?.hasAudio || take.screen?.hasAudio) && cues.length === 0 && hasWhisperModel) {
      setAutoStarted(true);
      void runGenerateCaptions();
    }
  }, [autoStarted, take, cues.length, hasWhisperModel, runGenerateCaptions]);

  return (
    <>
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 p-3 flex flex-col gap-3">
          <div className="flex-1 min-h-0 rounded-squircle-sm overflow-hidden bg-black border border-line relative">
            {take.screen ? (
              <video
                src={take.screen.url}
                controls
                className="w-full h-full object-contain"
                aria-label="The screen take"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-ui-sm text-spectrum-textDim">
                No screen file was written.
              </div>
            )}

            {take.camera && (
              <video
                src={take.camera.url}
                muted
                loop
                autoPlay
                playsInline
                className="absolute bottom-3 right-3 w-[22%] rounded-squircle-xs border border-white/20
                           shadow-modal pointer-events-none"
                aria-hidden="true"
              />
            )}
          </div>

          <div className="flex items-center gap-4 flex-shrink-0">
            <Fact label="Length" value={formatDuration(take.durationMs)} />
            {take.screen && <Fact label="Screen" value={`${take.screen.width}x${take.screen.height}`} />}
            {take.camera && <Fact label="Camera" value={`${take.camera.width}x${take.camera.height}`} />}
            <Fact
              label="Size"
              value={formatFileSize((take.screen?.bytes ?? 0) + (take.camera?.bytes ?? 0))}
            />
            {cues.length > 0 && (
              <Fact label="Captions" value={`${cues.length} lines ready`} />
            )}
          </div>
        </div>

        <div className="w-[320px] flex-shrink-0 border-l border-line overflow-y-auto p-3 space-y-3 flex flex-col">
          <div className="flex items-center gap-2">
            {take.screen ? (
              <CheckCircle2 className="w-4 h-4 text-spectrum-green flex-shrink-0" weight="fill" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-spectrum-red flex-shrink-0" weight="fill" />
            )}
            <span className="text-ui font-medium text-spectrum-text">
              {take.screen ? 'Take saved' : 'The screen was not recorded'}
            </span>
          </div>

          {!take.screen && (
            <p className="text-ui-sm text-spectrum-textMuted leading-relaxed">
              Nothing was written for the display, so there is no take to open.
              {take.camera ? ' The camera file is on disk and can be imported by hand.' : ''}
              {' '}Record again, and if it happens twice the reasons below are the place to look.
            </p>
          )}

          {/* ── Generated Captions Preview or Missing Model Prompt in Review Flow ── */}
          {(take.camera?.hasAudio || take.screen?.hasAudio) && !hasWhisperModel && !skippedCaptions && cues.length === 0 ? (
            <div className="rounded-squircle-xs bg-[#f0a173]/10 border border-[#f0a173]/30 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-micro font-semibold text-[#f0a173] uppercase tracking-wider">
                  <Sparkle className="w-3 h-3 text-[#f0a173]" weight="fill" />
                  Speech Model Required
                </span>
                {isDownloadingModel ? (
                  <span className="flex items-center gap-1 text-micro text-[#f0a173] font-mono">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {downloadingModel.percent}%
                  </span>
                ) : (
                  <span className="text-micro text-spectrum-textDim font-mono">
                    {recommendedModel?.sizeMb ? `${recommendedModel.sizeMb} MB` : ''}
                  </span>
                )}
              </div>

              <p className="text-micro text-spectrum-textMuted leading-relaxed">
                FrontierCut needs a Whisper model to generate AI subtitles and speech-synced camera cuts.
              </p>

              {isDownloadingModel ? (
                <div className="space-y-1 pt-1">
                  <div className="flex items-center justify-between text-micro font-mono text-[#f0a173]">
                    <span className="truncate">Downloading {recommendedModel?.name || 'Whisper'}…</span>
                    <span>{downloadingModel.percent}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-[#1a1a1a] overflow-hidden border border-[#3a3a3a]">
                    <div
                      className="h-full bg-[#f0a173] transition-all duration-150"
                      style={{ width: `${downloadingModel.percent}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={async () => {
                      if (!recommendedModel) return;
                      await packagesStore.installPackage(recommendedModel.id);
                      await runGenerateCaptions();
                    }}
                    className="btn-primary h-7 px-2.5 text-micro gap-1.5 flex-1 justify-center"
                  >
                    <Download className="w-3 h-3" />
                    Install & Transcribe
                  </button>
                  <button
                    onClick={() => setSkippedCaptions(true)}
                    className="pro-btn-filled h-7 px-2 text-micro text-spectrum-textDim hover:text-spectrum-text"
                    title="Proceed without captions for this take"
                  >
                    Skip
                  </button>
                </div>
              )}
            </div>
          ) : (take.camera?.hasAudio || take.screen?.hasAudio || cues.length > 0) && (
            <div className="rounded-squircle-xs bg-white/[0.02] border border-line p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-micro font-semibold text-spectrum-accent uppercase tracking-wider">
                  <Sparkle className="w-3 h-3 text-spectrum-accent" weight="fill" />
                  Generated Captions {cues.length > 0 ? `(${cues.length})` : ''}
                </span>
                {generating ? (
                  <span className="flex items-center gap-1 text-micro text-spectrum-textDim">
                    <Loader2 className="w-3 h-3 animate-spin text-spectrum-accent" />
                    Transcribing...
                  </span>
                ) : cues.length > 0 ? (
                  <span className="flex items-center gap-1 text-micro text-spectrum-green font-medium">
                    <Check className="w-3 h-3 text-spectrum-green" />
                    Polished & Clean
                  </span>
                ) : (
                  <button
                    onClick={() => void runGenerateCaptions()}
                    className="text-micro text-spectrum-accent hover:underline"
                  >
                    Generate preview
                  </button>
                )}
              </div>

              {cues.length > 0 ? (
                <div className="max-h-[140px] overflow-y-auto space-y-1.5 pr-1">
                  {cues.map((cue, idx) => (
                    <div
                      key={idx}
                      className="flex items-baseline gap-2 text-ui-xs leading-snug bg-black/40 p-1.5 rounded border border-white/[0.04]"
                    >
                      <span className="font-mono text-micro text-spectrum-textDim tabular flex-shrink-0">
                        {formatDuration(cue.startMs)}
                      </span>
                      <span className="text-spectrum-text font-medium">{cue.text}</span>
                    </div>
                  ))}
                </div>
              ) : generating ? (
                <div className="py-3 text-center text-ui-xs text-spectrum-textDim animate-pulse">
                  Listening to voice narration and formatting subtitles...
                </div>
              ) : (
                <div className="text-micro text-spectrum-textDim leading-relaxed">
                  Captions are automatically transcribed and cleaned when you apply the Tutorial skill.
                </div>
              )}
            </div>
          )}

          {take.screen && (
            <p className="text-ui-sm text-spectrum-textMuted leading-relaxed">
              The Tutorial skill will:
            </p>
          )}

          <ul className={take.screen ? 'space-y-1.5' : 'hidden'}>
            <Bullet
              icon={CursorClick}
              text={
                moments.length === 0
                  ? 'Find no zooms in this take'
                  : detected.from === 'events'
                    ? `Zoom on ${moments.length} moment${moments.length === 1 ? '' : 's'}, from ${clicks} real click${clicks === 1 ? '' : 's'}`
                    : `Zoom on ${moments.length} moment${moments.length === 1 ? '' : 's'}, read from the cursor track`
              }
            />
            <Bullet icon={Monitor} text="Inset the screen on a backdrop, rounded, with an opening and a close" />
            {take.camera && (
              <Bullet icon={Camera} text="Give the camera the whole frame while you are talking, not doing" />
            )}
            {take.camera?.hasAudio && (
              <Bullet
                icon={Mic}
                text={
                  cues.length > 0
                    ? `Apply ${cues.length} generated kinetic captions in Inter Bold`
                    : 'Transcribe the narration, caption it in Inter Bold, split it onto its own track'
                }
              />
            )}
            {clicks > 0 && <Bullet icon={Waves} text="Put a tick under every click and air under every zoom" />}
          </ul>

          {take.input && !take.input.ok && (
            <div className="flex items-start gap-1.5 rounded-squircle-xs bg-spectrum-blue/10
                            border border-spectrum-blue/25 px-2 py-1.5">
              <AlertTriangle className="w-3 h-3 text-spectrum-blue flex-shrink-0 mt-px" />
              <span className="text-micro text-spectrum-textMuted leading-snug">{take.input.message}</span>
            </div>
          )}

          {store.warnings.length > 0 && (
            <div className="space-y-1.5 pt-1">
              {store.warnings.map((warning) => (
                <div
                  key={warning}
                  className="flex items-start gap-1.5 rounded-squircle-xs bg-spectrum-amber/10
                             border border-spectrum-amber/25 px-2 py-1.5"
                >
                  <AlertTriangle className="w-3 h-3 text-spectrum-amber flex-shrink-0 mt-px" />
                  <span className="text-micro text-spectrum-textMuted leading-snug">{warning}</span>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => void window.electronAPI?.recorder.reveal(take.screen?.path ?? take.dir)}
            className="flex items-center gap-1.5 text-micro text-spectrum-textDim hover:text-spectrum-text
                       transition-colors mt-auto pt-2"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Show the files
          </button>
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-line px-3 py-2.5 flex items-center gap-2">
        <button
          onClick={() => void store.discard()}
          disabled={building}
          className="pro-btn-filled h-8 px-3 text-ui gap-1.5"
          title="Go back to setup. The take stays on disk."
        >
          <Record className="w-3.5 h-3.5" />
          Record again
        </button>

        {building && progress && (
          <span className="flex items-center gap-2 min-w-0 flex-1 px-2">
            <span className="flex-1 h-1 rounded-full bg-spectrum-sunken overflow-hidden max-w-[160px] flex-shrink-0">
              <span
                className="block h-full bg-spectrum-accent transition-[width] duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </span>
            <div className="min-w-0 flex flex-col">
              <span className="text-micro text-spectrum-textDim min-w-0 leading-snug truncate">
                {progress.note}
              </span>
              {progress.currentCue && (
                <span className="text-micro text-spectrum-accent font-medium truncate max-w-[320px]">
                  "{progress.currentCue}"
                </span>
              )}
            </div>

            {progress.phase === 'transcribing' && (
              <button
                onClick={() => void window.electronAPI?.stt.cancel()}
                className="pro-btn-filled h-6 px-2 text-ui-xs flex-shrink-0 ml-auto"
                title="Build the edit now, without captions"
              >
                Skip captions
              </button>
            )}
          </span>
        )}

        {!take.screen && (
          <span className="ml-auto text-ui-sm text-spectrum-textDim">
            Nothing to open.
          </span>
        )}
        <button
          data-recorder="open-raw"
          onClick={() => void onBuild('raw')}
          disabled={building || !take.screen}
          className={`pro-btn-filled h-8 px-3 text-ui gap-1.5 ${take.screen ? 'ml-auto' : ''}`}
          title="Screen, camera and voice on the timeline. Nothing interpreted."
        >
          Open raw
        </button>
        <button
          data-recorder="open-take"
          onClick={() => {
            if (!hasWhisperModel && !skippedCaptions && (take.camera?.hasAudio || take.screen?.hasAudio) && cues.length === 0) {
              setShowModelPrompt(true);
              return;
            }
            void onBuild('skill');
          }}
          disabled={building || !take.screen}
          className="btn-primary h-8 px-4 text-ui gap-2"
        >
          {building ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkle className="w-3.5 h-3.5" />}
          Open with the Tutorial skill
        </button>
      </div>

      {/* ── Missing Speech Model Prompt Modal ── */}
      {showModelPrompt && (
        <div className="scrim z-50 flex items-center justify-center p-4" onClick={() => setShowModelPrompt(false)}>
          <div
            className="modal-shell w-[480px] max-w-full p-5 space-y-4 shadow-modal border border-line-strong"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-squircle-sm bg-[#f0a173]/15 border border-[#f0a173]/30 flex items-center justify-center text-[#f0a173] flex-shrink-0">
                <Package className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-ui font-semibold text-spectrum-text">Whisper Speech Model Required</h3>
                <p className="text-ui-sm text-spectrum-textMuted mt-1 leading-relaxed">
                  Automatic subtitles and speech-synced camera framing require a local Whisper AI model. Would you like to install the recommended model now or proceed without captions?
                </p>
              </div>
            </div>

            {isDownloadingModel ? (
              <div className="p-3 rounded-squircle-xs bg-[#1a1a1a] border border-[#3a3a3a] space-y-2">
                <div className="flex items-center justify-between text-ui-xs font-mono text-[#f0a173]">
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Downloading {recommendedModel?.name || 'Whisper Model'}…
                  </span>
                  <span className="font-bold">{downloadingModel.percent}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-[#141414] overflow-hidden border border-[#2a2a2a]">
                  <div
                    className="h-full bg-[#f0a173] transition-all duration-150"
                    style={{ width: `${downloadingModel.percent}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
                <button
                  onClick={() => {
                    setShowModelPrompt(false);
                    setSkippedCaptions(true);
                    void onBuild('skill');
                  }}
                  className="pro-btn-filled h-8 px-3 text-ui-sm"
                >
                  Continue Without Captions (Skip)
                </button>
                <button
                  onClick={async () => {
                    if (!recommendedModel) return;
                    try {
                      await packagesStore.installPackage(recommendedModel.id);
                      setShowModelPrompt(false);
                      void onBuild('skill');
                    } catch {
                      // handled in store
                    }
                  }}
                  className="btn-primary h-8 px-3.5 text-ui-sm gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  Install & Auto-Edit ({recommendedModel?.sizeMb || 142} MB)
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

const Fact: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="min-w-0">
    <p className="text-micro text-spectrum-textFaint uppercase tracking-wide">{label}</p>
    <p className="text-ui-sm font-mono tabular text-spectrum-textMuted truncate">{value}</p>
  </div>
);

const Bullet: React.FC<{ icon: React.ElementType; text: string }> = ({ icon: Icon, text }) => (
  <li className="flex items-start gap-2 text-ui-sm text-spectrum-textMuted leading-snug">
    <Icon className="w-3.5 h-3.5 flex-shrink-0 text-spectrum-textFaint mt-px" />
    <span>{text}</span>
  </li>
);
