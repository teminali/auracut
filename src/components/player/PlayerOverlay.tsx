/* ═══════════════════════════════════════════════════════════════════
   The fullscreen Player.

   ONE implementation, opened from two places: Home's "Resume editing"
   hero action and the Editor monitor's fullscreen button. There is no
   second copy of it anywhere, and everything inside it is the real
   thing — the real program loop, the real transport, the real Copilot,
   the real store actions. Nothing here simulates playback.

   WHAT IT REPLACED. `PreviewPlayer` had a local `isFullscreen` boolean
   that grew its own container to `position: fixed`. That is a bigger
   monitor, not a player: it kept the monitor bar, the overlay toggles
   and the zoom stepper on screen over the picture, it had no Copilot,
   and Home had no way to reach it at all.

   THE PROGRAM LOOP IS HANDED OVER, NOT DUPLICATED. `useProgramLoop`
   drives the audio graph and every <video> element as well as the
   canvas, so two active copies would sync the same media twice per
   frame. `PreviewPlayer` goes inactive while `isPlayerOpen`; this
   takes over; on close it hands back.

   WHAT OPENING IT DOES TO THE PROJECT: nothing. It reads the stores
   that are already loaded. From Home the project is loaded by the same
   `openRecent` path the editor uses, and `showHome` STAYS TRUE — so
   autosave (which runs only in the editor) never starts, no poster is
   captured, and closing the player returns to the launcher with the
   recents wall untouched. Watching a project is not editing it.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useLayoutStore } from '../../store/layoutStore';
import { useProjectStore } from '../../store/projectStore';
import { useTimelineStore } from '../../store/timelineStore';
import { useProgramLoop } from '../../hooks/useProgramLoop';
import { useMeasure } from '../../hooks/useMeasure';
import { PlaybackControls } from '../preview/PlaybackControls';
import { CopilotDrawer } from '../copilot/CopilotDrawer';
import { TeminaliCutMark } from '../ui/TeminaliCutMark';
import {
  ArrowLeft, Sparkle, Download, ScissorsLineDashed, Flag, Subtitles, Sliders, Rows3,
  DotsThree, Crop, Selection,
} from '../ui/icons';
import { Select, StatusDot } from '../ui/Primitives';
import { autosaveAgeMs } from '../../engine/projectIO';
import { ASPECT_DIMENSIONS, type AspectRatio } from '../../types/edl';
import { useUiStore } from '../../store/uiStore';

/** Pointer still for this long and the chrome recedes. */
const IDLE_MS = 2600;

/*
  The five quick actions, and every key on them is a key this product
  actually binds.

  `S` (split) and `M` (marker) are the editor's own global bindings and
  already work here — the chips report them rather than adding a second
  handler for one key. `T`, `C`, `F` and `A` were free and are
  registered by this component while it is open.

  `Trim` sets the visible range in and out rather than cutting
  anything, which is what "adjust the range without leaving" means and
  what `setInPoint` / `setOutPoint` really do.
*/
type QuickId = 'trim' | 'split' | 'captions' | 'reframe' | 'adjust';

const QUICK: { id: QuickId; label: string; key: string; icon: React.ElementType; detail: string }[] = [
  { id: 'trim', label: 'Trim', key: 'T', icon: Selection,
    detail: 'Set the in and out points at the playhead' },
  { id: 'split', label: 'Split', key: 'S', icon: ScissorsLineDashed,
    detail: 'Cut the selected clip where the playhead is' },
  { id: 'captions', label: 'Captions', key: 'C', icon: Subtitles,
    detail: 'Open the captions panel in the editor' },
  { id: 'reframe', label: 'Reframe', key: 'F', icon: Crop,
    detail: 'Step the canvas through the aspect ratios' },
  { id: 'adjust', label: 'Adjust', key: 'A', icon: Sliders,
    detail: 'Open the colour panel in the editor' },
];

interface Props {
  /** Leaves the player and opens the editor on this project. */
  onOpenTimeline: () => void;
}

/*
  A gate, and it is load-bearing rather than tidy.

  `PlayerStage` measures its own stage with `useMeasure`, whose
  ResizeObserver is attached in a mount effect. When this component
  rendered `null` while closed, that effect ran with no element to
  observe and never ran again — so the stage stayed 0x0 for ever and
  the picture came out one pixel square. Mounting only when open is
  what makes the measurement happen at all.
*/
export const PlayerOverlay: React.FC<Props> = ({ onOpenTimeline }) => {
  const isOpen = useLayoutStore((s) => s.isPlayerOpen);
  return isOpen ? <PlayerStage onOpenTimeline={onOpenTimeline} /> : null;
};

const PlayerStage: React.FC<Props> = ({ onOpenTimeline }) => {
  const closePlayer = useLayoutStore((s) => s.closePlayer);
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);

  const project = useProjectStore((s) => s.project);
  const isCopilotOpen = useProjectStore((s) => s.isCopilotOpen);
  const setCopilotOpen = useProjectStore((s) => s.setCopilotOpen);
  const setExportModalOpen = useProjectStore((s) => s.setExportModalOpen);
  const setAspectRatio = useProjectStore((s) => s.setAspectRatio);
  const openCommandPalette = useUiStore((s) => s.openCommandPalette);
  const [hovered, setHovered] = React.useState<string | null>(null);
  /* Read once on open and then every minute: the slot is written every
     20 seconds and nobody needs a second-by-second save clock. */
  const [savedAgeMs, setSavedAgeMs] = React.useState<number | null>(() => autosaveAgeMs());
  React.useEffect(() => {
    const t = window.setInterval(() => setSavedAgeMs(autosaveAgeMs()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const backdropRef = React.useRef<HTMLCanvasElement>(null);
  const [stageRef, stageSize] = useMeasure<HTMLDivElement>();

  const [chromeVisible, setChromeVisible] = React.useState(true);
  const idleTimer = React.useRef<number | undefined>(undefined);

  /* The same loop the monitor runs, and only one of them at a time.
     This component only exists while the player is open, so it is
     unconditionally the active one. */
  useProgramLoop({ canvasRef, project, active: true });

  /*
    Portrait media touches the top and the bottom, which leaves the
    sides to be dealt with. Two hard bars would be the obvious answer
    and the wrong one, so the sides carry a blurred, over-scaled copy
    of the SAME frame: the picture stays uncropped and the screen stops
    being two black slabs.

    It is a copy, not a second render. One `drawImage` per frame off
    the canvas that has already been composited — the compositor is
    never asked for the frame twice, and the program output itself is
    untouched, which matters because that canvas is what export and
    `get_frame_context` read.
  */
  /*
    The backdrop runs whenever the media does not fill the window on
    BOTH axes — which is nearly always, and was the bug: it was gated
    on portrait, so a 16:9 project in a 16:10 window got two hard black
    bars while a 9:16 one got the treatment. The letterbox is the same
    problem in both directions.
  */
  const needsBackdrop = true;

  React.useEffect(() => {
    if (!needsBackdrop) return;
    let frame = 0;
    const tick = () => {
      const src = canvasRef.current;
      const dst = backdropRef.current;
      if (src && dst && src.width > 0) {
        const ctx = dst.getContext('2d', { alpha: false });
        if (ctx) {
          if (dst.width !== 64 || dst.height !== 64) { dst.width = 64; dst.height = 64; }
          ctx.drawImage(src, 0, 0, 64, 64);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [needsBackdrop]);


  /* ── The chrome recedes, and comes back for pointer OR keyboard ── */

  const wake = React.useCallback(() => {
    setChromeVisible(true);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setChromeVisible(false), IDLE_MS);
  }, []);

  React.useEffect(() => {
    wake();
    return () => window.clearTimeout(idleTimer.current);
  }, [wake]);

  /*
    Escape closes, and every other key wakes the chrome. Keyboard users
    never move a pointer, so a pointer-only reveal would hide the
    controls from them permanently — decision 16 says these stay
    keyboard reachable, and this is what makes that true.
  */

  /* Contain, never cover: the frame is the work and cropping it to fill
     a window is the one thing a program monitor may not do. */
  const scale = Math.min(
    stageSize.width / Math.max(1, project.width),
    stageSize.height / Math.max(1, project.height)
  );
  const displayW = Math.max(1, Math.round(project.width * scale));
  const displayH = Math.max(1, Math.round(project.height * scale));

  /*
    The one way out of the player and into the editor. `null` means
    "leave the sidebar as it was", which is what the plain Open-timeline
    button wants: it is asking for the editor, not for a panel.
  */
  const enterEditorOn = (tab: Parameters<typeof setActiveTab>[0] | null) => {
    if (tab !== null) setActiveTab(tab);
    closePlayer();
    onOpenTimeline();
  };

  /* Every one of these calls the store action the editor calls. */
  const runQuick = React.useCallback((id: QuickId) => {
    const t = useTimelineStore.getState();
    switch (id) {
      case 'trim':
        /* In, then out, then clear. One key walks the whole range
           rather than needing two, which is what makes it usable
           without a timeline in front of you. */
        if (t.inPointMs === null) t.setInPoint(t.playheadMs);
        else if (t.outPointMs === null) t.setOutPoint(t.playheadMs);
        else { t.setInPoint(null); t.setOutPoint(null); }
        return;
      case 'split':
        for (const id2 of t.selectedClipIds) t.splitClip(id2, t.playheadMs);
        return;
      case 'captions':
        enterEditorOn('captions');
        return;
      case 'reframe': {
        const ratios = Object.keys(ASPECT_DIMENSIONS) as AspectRatio[];
        const next = ratios[(ratios.indexOf(project.aspectRatio) + 1) % ratios.length];
        setAspectRatio(next);
        return;
      }
      case 'adjust':
        enterEditorOn('filters');
    }
  }, [project.aspectRatio, setAspectRatio]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePlayer();
        return;
      }
      /* T / C / F / A. `S` and `M` belong to the editor's global map
         and already reach here, so they are deliberately not repeated:
         two handlers for one key is how two behaviours end up fighting
         over it. */
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const hit = QUICK.find((a) => a.key.toLowerCase() === e.key.toLowerCase() && a.id !== 'split');
        if (hit) { e.preventDefault(); runQuick(hit.id); }
      }

      wake();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [closePlayer, wake, runQuick]);

  return (
    <div
      className="kp-root"
      onPointerMove={wake}
      onPointerDown={wake}
      role="dialog"
      aria-label={`Player · ${project.name}`}
    >
      {/*
        The picture and its chrome are ONE in-flow child, and the
        Copilot is the other.

        The drawer is `flex-shrink-0` with a left hairline — it is
        built to be the right-hand column of a flex row, which is what
        it is in the editor. Without this wrapper the stage was
        `position: absolute` and out of flow, so the drawer became the
        only in-flow child and opened down the LEFT of the screen with
        the picture behind it. Same component, correct shell.
      */}
      <div className="kp-main">
      {/* ── The picture ── */}
      <div ref={stageRef} className="kp-stage">
        <canvas ref={backdropRef} className="kp-backdrop" aria-hidden="true" />
        <canvas
          ref={canvasRef}
          width={project.width}
          height={project.height}
          className="kp-canvas"
          style={{ width: displayW, height: displayH }}
        />
      </div>

      {/* ── Top ── */}
      <header className={`kp-top ${chromeVisible ? '' : 'kp-hidden'}`}>
        <button onClick={closePlayer} className="pro-btn w-8 h-8" title="Back (Esc)" aria-label="Leave the player">
          <ArrowLeft className="w-4 h-4" />
        </button>

        <span className="kp-mark">
          <TeminaliCutMark className="w-[14px] h-[6px]" />
        </span>

        <span className="min-w-0">
          <span className="block text-ui-lg font-semibold text-spectrum-text truncate">{project.name}</span>
          <span className="block text-ui-xs text-spectrum-textDim font-mono truncate tabular">
            {project.aspectRatio} · {project.width}×{project.height} · {project.fps} fps
          </span>
        </span>

        <span className="flex-1" />

        {/*
          What the app can actually say about saving, rather than "All
          changes saved" printed unconditionally.

          Autosave runs in the EDITOR only, so a player opened from
          home is genuinely not autosaving — and it says so, because
          that is the state the whole non-destructive viewing session
          depends on. In the editor it reports the real slot's age.
        */}
        <span className="kp-save" title={
          savedAgeMs === null
            ? 'Watching from home. Autosave runs in the editor.'
            : 'The editor autosaves every 20 seconds'
        }>
          <StatusDot state={savedAgeMs === null ? 'off' : 'on'} />
          {savedAgeMs === null ? 'Viewing' : `Saved ${Math.max(1, Math.round(savedAgeMs / 60000))}m ago`}
        </span>

        <Select
          value={project.aspectRatio}
          onChange={setAspectRatio}
          size="md"
          title="Canvas aspect ratio"
          options={(Object.keys(ASPECT_DIMENSIONS) as AspectRatio[]).map((r) => ({
            value: r, label: `${r} · ${ASPECT_DIMENSIONS[r].label}`,
          }))}
        />

        <button
          onClick={() => setCopilotOpen(!isCopilotOpen)}
          className={`pro-btn-filled h-[var(--h-md)] px-2 gap-1.5 text-ui-sm font-medium ${isCopilotOpen ? 'pro-btn-active' : ''}`}
          title="AI Copilot (⌘J)"
          aria-label="AI Copilot"
        >
          <Sparkle className="w-4 h-4" /> Copilot
        </button>

        {/*
          `enterEditorOn` rather than `onOpenTimeline` alone, and the
          difference is the whole bug this had.

          `onOpenTimeline` only clears `showHome`. Pressed from HOME
          that is enough to be going on with — but pressed from inside
          the EDITOR, where `showHome` is already false, it set a
          boolean to the value it already had and nothing else: the
          player stayed mounted at `z-index: 70` over the editor it had
          just "opened", and the button read as dead.

          Measured rather than reasoned about, because the markup looks
          right either way. Driving the built app: click the button,
          `.kp-root` is still in the document at 1512x916 afterwards and
          `.editor-shell` is present underneath it. Every other door out
          of the player — Escape, the back arrow, the five quick
          actions — went through `closePlayer` already; this was the one
          that did not.

          `null` keeps whichever library tab was already open, because
          "open timeline" is not a request to change the sidebar.
        */}
        <button
          onClick={() => enterEditorOn(null)}
          className="pro-btn-filled h-[var(--h-md)] px-2 gap-1.5 text-ui-sm font-medium"
        >
          <Rows3 className="w-4 h-4" /> Open timeline
        </button>

        <button onClick={() => setExportModalOpen(true)} className="btn-primary h-[var(--h-md)] px-3 gap-1.5 text-ui-sm">
          <Download className="w-4 h-4" /> Export
        </button>
      </header>

      {/* ── Bottom ──────────────────────────────────────────────────
          `PlaybackControls` is the real transport, unmodified, and it
          carries the ONLY play/pause control on this screen. A second
          one in the middle of the picture would be the obvious thing
          to add and is exactly what decision 13 forbids. */}
      <footer className={`kp-bottom ${chromeVisible ? '' : 'kp-hidden'}`}>
        <div className="kp-quick">
          <span className="kp-quick-label">
            <span className="hp-kicker block">Quick edit</span>
            <span className="kp-quick-detail">{hovered ?? 'Five things without leaving the picture'}</span>
          </span>

          {QUICK.map((action) => (
            <button
              key={action.id}
              onClick={() => runQuick(action.id)}
              onPointerEnter={() => setHovered(action.detail)}
              onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(action.detail)}
              onBlur={() => setHovered(null)}
              /* 38px at 600 weight, measured off the reference's tool
                 row — these are the player's primary verbs and it sizes
                 them accordingly. */
              className="pro-btn h-[38px] px-2 gap-1.5 text-ui-sm font-semibold text-spectrum-textMuted"
              title={`${action.label} · ${action.key}`}
            >
              <action.icon className="w-4 h-4" /> {action.label}
              <span className="kp-quick-key">{action.key}</span>
            </button>
          ))}

          {/* The marker, which `M` already drops from anywhere. Its own
              button because the design gives it one, and because
              dropping a mark is the thing you most want while watching
              rather than editing. */}
          <button
            onClick={() => useTimelineStore.getState().addMarker(useTimelineStore.getState().playheadMs)}
            onPointerEnter={() => setHovered('Drop a marker at the playhead')}
            onPointerLeave={() => setHovered(null)}
            onFocus={() => setHovered('Drop a marker at the playhead')}
            onBlur={() => setHovered(null)}
            className="pro-btn h-[28px] w-[28px]"
            title="Add marker · M"
            aria-label="Add a marker at the playhead"
          >
            <Flag className="w-4 h-4" />
          </button>

          <span className="w-px h-4 bg-spectrum-control mx-0.5" />

          {/* Everything else this app can do, from the real palette
              rather than a second menu that would have to be kept in
              step with it. */}
          <button
            onClick={openCommandPalette}
            className="pro-btn h-[28px] w-[28px]"
            title="More commands (⌘K)"
            aria-label="More commands"
          >
            <DotsThree className="w-4 h-4" />
          </button>
        </div>

        <div className="kp-transport">
          <PlaybackControls />
        </div>
      </footer>
      </div>

      {/* The real Copilot, in its own layout shell. Same component, same
          store, same behaviour as the editor's. */}
      <CopilotDrawer />
    </div>
  );
};
