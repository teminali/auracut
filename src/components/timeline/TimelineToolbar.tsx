import React from 'react';
import { useTimelineStore, getContentEndMs } from '../../store/timelineStore';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { detectBeats } from '../../engine/beatDetect';
import {
  Scissors, Trash2, Copy, Magnet, ZoomIn, ZoomOut, Plus, ArrowLeftRight, Snowflake, RotateCcw, Unlink, Flag, Layers, Music4, Maximize,
} from '../ui/icons';

interface TimelineToolbarProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export const TimelineToolbar: React.FC<TimelineToolbarProps> = ({ scrollRef }) => {
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const snappingEnabled = useTimelineStore((s) => s.snappingEnabled);
  const rippleEditMode = useTimelineStore((s) => s.rippleEditMode);
  const zoomLevel = useTimelineStore((s) => s.zoomLevel);
  const markerCount = useTimelineStore((s) => s.markers.length);

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
    <div className="h-9 flex items-center justify-between px-2.5 gap-2 border-b border-line bg-spectrum-panelHeader flex-shrink-0">
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
          min={-1.3}
          max={1.3}
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

const IconButton: React.FC<{
  onClick: () => void;
  icon: React.ElementType;
  title: string;
  disabled?: boolean;
  badge?: number;
}> = ({ onClick, icon: Icon, title, disabled, badge }) => (
  <button onClick={onClick} disabled={disabled} className="pro-btn w-[26px] h-[26px] relative" title={title}
            aria-label={title}>
    <Icon className="w-3.5 h-3.5" />
    {badge !== undefined && (
      <span className="absolute -top-0.5 -right-0.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-spectrum-accent text-micro font-bold text-white flex items-center justify-center leading-none">
        {badge > 99 ? '99+' : badge}
      </span>
    )}
  </button>
);
