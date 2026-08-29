import React from 'react';
import { BASE_PX_PER_MS, MIN_ZOOM, MAX_ZOOM, useTimelineStore, getContentEndMs } from '../../store/timelineStore';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { detectBeats } from '../../engine/beatDetect';
import {
  Scissors, Trash2, Copy, Magnet, ZoomIn, ZoomOut, Plus, ArrowLeftRight, Snowflake, RotateCcw, Unlink, Flag, Layers, Music4, Maximize,
} from '../ui/icons';
import { IconButton } from '../ui/Primitives';

interface TimelineToolbarProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export const TimelineToolbar: React.FC<TimelineToolbarProps> = ({ scrollRef }) => {
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const snappingEnabled = useTimelineStore((s) => s.snappingEnabled);
  const rippleEditMode = useTimelineStore((s) => s.rippleEditMode);
  const zoomLevel = useTimelineStore((s) => s.zoomLevel);
  const markerCount = useTimelineStore((s) => s.markers.length);
  const playheadMs = useTimelineStore((s) => s.playheadMs);

  const splitAtPlayhead = useTimelineStore((s) => s.splitAtPlayhead);
  const deleteSelected = useTimelineStore((s) => s.deleteSelected);
  const duplicateClip = useTimelineStore((s) => s.duplicateClip);
  const toggleSnapping = useTimelineStore((s) => s.toggleSnapping);
  const toggleRippleEdit = useTimelineStore((s) => s.toggleRippleEdit);
  const setZoomLevel = useTimelineStore((s) => s.setZoomLevel);
  const zoomToFit = useTimelineStore((s) => s.zoomToFit);
  const addTrack = useTimelineStore((s) => s.addTrack);
  const addMarker = useTimelineStore((s) => s.addMarker);
  const setBeatMarkers = useTimelineStore((s) => s.setBeatMarkers);
  const groupSelected = useTimelineStore((s) => s.groupSelected);
  const freezeFrame = useTimelineStore((s) => s.freezeFrame);
  const reverseClip = useTimelineStore((s) => s.reverseClip);
  const detachAudio = useTimelineStore((s) => s.detachAudio);

  const pushToast = useUiStore((s) => s.pushToast);
  const project = useProjectStore((s) => s.project);

  /* One pixel is worth this many milliseconds at the current zoom, and
     the playhead is on this frame. Both derived from the same scale
     the lanes and the ruler use, so a readout cannot disagree with the
     picture beside it. */
  const pxPerMs = BASE_PX_PER_MS * zoomLevel;
  const frameAtPlayhead = Math.floor((playheadMs / 1000) * project.fps);

  const hasSelection = selectedClipIds.length > 0;
  const primaryId = selectedClipIds[0];

  const handleZoomFit = () => {
    const el = scrollRef.current;
    const state = useTimelineStore.getState();
    const contentEnd = Math.max(getContentEndMs(state.tracks), project.durationMs);
    if (el && contentEnd > 0) zoomToFit(el.clientWidth - 40, contentEnd);
  };

  const handleDetectBeats = async () => {
    const state = useTimelineStore.getState();
    const audioClip = state.tracks
      .filter((t) => t.type === 'audio')
      .flatMap((t) => t.clips)
      .find((c) => c.mediaUrl);

    if (!audioClip?.mediaUrl) {
      pushToast({ kind: 'error', title: 'No audio to analyse', detail: 'Add a music clip to an audio track first.' });
      return;
    }

    const id = pushToast({ kind: 'progress', title: 'Detecting beats…', progress: 20 });
    try {
      const result = await detectBeats(audioClip.mediaUrl, audioClip.startTimeMs);
      setBeatMarkers(result.beatsMs);
      useUiStore.getState().dismissToast(id);
      pushToast({
        kind: 'success',
        title: `${result.beatsMs.length} beats detected`,
        detail: `≈ ${Math.round(result.bpm)} BPM. Markers added to the timeline.`,
      });
    } catch (err) {
      useUiStore.getState().dismissToast(id);
      pushToast({ kind: 'error', title: 'Beat detection failed', detail: (err as Error).message });
    }
  };

  return (
    <div className="editor-timeline-toolbar h-[43px] flex items-center justify-between px-3 gap-2 border-b border-line bg-spectrum-panelHeader flex-shrink-0">
      <div className="flex items-center gap-1.5 min-w-0">
        {/* Destructive and constructive edits, kept apart from the modes. */}
        <div className="flex items-center gap-1">
          <ToolButton onClick={splitAtPlayhead} icon={Scissors} label="Split" title="Split at playhead (S)" />
          <ToolButton onClick={deleteSelected} icon={Trash2} label="Delete" title="Delete selection (⌫)" disabled={!hasSelection} danger />
          <ToolButton onClick={() => primaryId && duplicateClip(primaryId)} icon={Copy} label="Duplicate" title="Duplicate clip (⌘D)" disabled={!hasSelection} />
        </div>

        <Sep />

        {/* Sticky modes — these stay on, so they get the switch treatment. */}
        <div className="seg-group">
          <button onClick={toggleSnapping} className={`seg-item ${snappingEnabled ? 'seg-item-on' : ''}`} title="Magnetic snapping (N)"
            aria-label="Magnetic snapping (N)">
            <Magnet className="w-3 h-3" /> Snap
          </button>
          <button onClick={toggleRippleEdit} className={`seg-item ${rippleEditMode ? 'seg-item-on' : ''}`} title="Ripple edit, downstream clips follow (R)"
            aria-label="Ripple edit, downstream clips follow (R)">
            <ArrowLeftRight className="w-3 h-3" /> Ripple
          </button>
        </div>

        <Sep />

        {/* One-shot clip operations. */}
        <div className="flex items-center gap-0.5">
          <IconButton
            onClick={() => primaryId && freezeFrame(primaryId, useTimelineStore.getState().playheadMs)}
            icon={Snowflake}
            title="Freeze frame at playhead"
            disabled={!hasSelection}
          />
          <IconButton
            onClick={() => primaryId && reverseClip(primaryId)}
            icon={RotateCcw}
            title="Reverse clip"
            disabled={!hasSelection}
          />
          <IconButton
            onClick={() => primaryId && detachAudio(primaryId)}
            icon={Unlink}
            title="Detach audio from video"
            disabled={!hasSelection}
          />
          <IconButton
            onClick={groupSelected}
            icon={Layers}
            title="Group selected clips (⌘G)"
            disabled={selectedClipIds.length < 2}
          />
        </div>

        <Sep />

        <div className="flex items-center gap-0.5">
          <IconButton
            onClick={() => addMarker(useTimelineStore.getState().playheadMs)}
            icon={Flag}
            title="Add marker (M)"
            badge={markerCount > 0 ? markerCount : undefined}
          />
          <IconButton onClick={handleDetectBeats} icon={Music4} title="Detect beats from the music track" />
        </div>

        <Sep />

        <button
          onClick={() => addTrack('video')}
          className="pro-btn-filled h-[26px] px-2 gap-1 text-ui-xs font-medium"
          title="Add a new track"
        
            aria-label="Add a new track">
          <Plus className="w-3 h-3" />
          <span>Track</span>
        </button>
      </div>

      {/* Zoom */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button onClick={handleZoomFit} className="pro-btn w-[26px] h-[26px]" title="Zoom to fit sequence (⇧Z)"
            aria-label="Zoom to fit sequence (⇧Z)">
          <Maximize className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => setZoomLevel(zoomLevel / 1.4)} className="pro-btn w-[26px] h-[26px]" title="Zoom out (−)"
            aria-label="Zoom out (−)">
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <input
          type="range"
          /* Logarithmic, and its ends are the store's real limits rather
             than two numbers that used to match them. The slider read
             -1.3..1.3 (0.05x..20x) and would have pinned at 20 while
             every other zoom control went to 80. */
          min={Math.log10(MIN_ZOOM)}
          max={Math.log10(MAX_ZOOM)}
          step={0.01}
          value={Math.log10(zoomLevel)}
          onChange={(e) => setZoomLevel(Math.pow(10, Number(e.target.value)))}
          className="w-28 range-accent"
          title={`Timeline zoom · ${zoomLevel.toFixed(2)}×`}
        />
        <button onClick={() => setZoomLevel(zoomLevel * 1.4)} className="pro-btn w-[26px] h-[26px]" title="Zoom in (+)"
            aria-label="Zoom in (+)">
          <ZoomIn className="w-3.5 h-3.5" />
        </button>

        {/*
          What one pixel is worth at this zoom, and the frame it lands
          in. The design puts a readout here and it is the thing that
          makes the extra zoom range legible: without it 40x and 80x
          look the same until you try to land on something.

          `msPerPx` is the honest number — a frame at this project's
          fps is 1000/fps ms, and the readout says which frame the
          playhead is actually on rather than implying that a video
          frame exists between two frames.
        */}
        <span className="well h-[26px] px-2 flex items-center gap-1.5 font-mono flex-shrink-0" title={`${(1 / pxPerMs).toFixed(3)} ms per pixel at ${zoomLevel.toFixed(2)}×`}>
          <span className="text-ui-xs text-spectrum-text tabular">
            {(1 / pxPerMs).toFixed(1)}
          </span>
          <span className="text-micro text-spectrum-textFaint">ms/px</span>
          <span className="w-px h-3 bg-line" />
          <span className="text-ui-xs text-spectrum-textDim tabular">f{frameAtPlayhead}</span>
        </span>
      </div>
    </div>
  );
};

/* ── Buttons ────────────────────────────────────────────────────── */

const Sep: React.FC = () => <div className="w-px h-4 bg-line flex-shrink-0 mx-0.5" />;

const ToolButton: React.FC<{
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  title: string;
  disabled?: boolean;
  danger?: boolean;
}> = ({ onClick, icon: Icon, label, title, disabled, danger }) => (
  <button onClick={onClick} disabled={disabled} className="pro-btn-filled h-[26px] px-2 gap-1.5 text-ui-xs font-medium" title={title}
            aria-label={title}>
    <Icon className={`w-3 h-3 ${danger ? 'text-spectrum-red/85' : 'text-spectrum-textDim'}`} />
    <span>{label}</span>
  </button>
);
