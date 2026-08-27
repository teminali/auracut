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
import { applyTutorialSkill, openTakeRaw, TutorialProgress } from '../../engine/tutorialSkill';
import { detectMoments } from '../../engine/cursorZoom';
import { SourceGrid } from './SourceGrid';
import { CaptureOptions } from './CaptureOptions';
import { formatDuration, formatFileSize } from '../../utils/time';
import {
  X, Record, Pause, Play, Square, Loader2, AlertTriangle, CheckCircle2,
  FolderOpen, CursorClick, Camera, Monitor, Mic, Trash2, Sparkle, Waves,
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
        {screenBlocked ? (
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-spectrum-amber flex-shrink-0" />
            <span className="text-ui-sm text-spectrum-textMuted truncate">
              macOS has not allowed Kerf to record the screen yet. Turn it on, then relaunch Kerf.
            </span>
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
  const take = store.take!;

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
          </div>
        </div>

        <div className="w-[288px] flex-shrink-0 border-l border-line overflow-y-auto p-3 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-spectrum-green flex-shrink-0" weight="fill" />
            <span className="text-ui font-medium text-spectrum-text">Take saved</span>
          </div>

          <p className="text-ui-sm text-spectrum-textMuted leading-relaxed">
            The Tutorial skill will:
          </p>

          <ul className="space-y-1.5">
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
              <Bullet icon={Mic} text="Transcribe the narration, caption it in Inter Bold, split it onto its own track" />
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
                       transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Show the files
          </button>
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-line px-3 py-2.5 flex items-center gap-2">
        {/* "Record again", not "Discard": the files stay where they were
            written. Deleting a take somebody just spent ten minutes
            making, because they pressed the button next to the one they
            wanted, is not a thing this should be able to do. The take is
            one line above, under Show the files. */}
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
            <span className="flex-1 h-1 rounded-full bg-spectrum-sunken overflow-hidden max-w-[220px]">
              <span
                className="block h-full bg-spectrum-accent transition-[width] duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </span>
            <span className="text-micro text-spectrum-textDim truncate">{progress.note}</span>
          </span>
        )}

        <button
          data-recorder="open-raw"
          onClick={() => void onBuild('raw')}
          disabled={building || !take.screen}
          className="pro-btn-filled h-8 px-3 text-ui gap-1.5 ml-auto"
          title="Screen, camera and voice on the timeline. Nothing interpreted."
        >
          Open raw
        </button>
        <button
          data-recorder="open-take"
          onClick={() => void onBuild('skill')}
          disabled={building || !take.screen}
          className="btn-primary h-8 px-4 text-ui gap-2"
        >
          {building ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkle className="w-3.5 h-3.5" />}
          Open with the Tutorial skill
        </button>
      </div>
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
