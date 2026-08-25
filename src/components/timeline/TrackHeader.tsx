import React, { useState, useCallback } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { Track } from '../../types/edl';
import {
  Eye, EyeOff, Lock, Unlock, Volume2, VolumeX, Headphones,
  ChevronUp, ChevronDown, Trash2,
} from 'lucide-react';

const TYPE_STYLE: Record<Track['type'], { badge: string; color: string; ring: string }> = {
  video:   { badge: 'V', color: 'text-lane-video',   ring: 'bg-lane-video' },
  overlay: { badge: 'V', color: 'text-lane-overlay', ring: 'bg-lane-overlay' },
  text:    { badge: 'T', color: 'text-lane-text',    ring: 'bg-lane-text' },
  audio:   { badge: 'A', color: 'text-lane-audio',   ring: 'bg-lane-audio' },
  effect:  { badge: 'F', color: 'text-lane-effect',  ring: 'bg-lane-effect' },
};

/** Which lanes share a numbering series — video and overlay are both "V". */
const BADGE_FAMILY: Record<Track['type'], Track['type'][]> = {
  video: ['video', 'overlay'],
  overlay: ['video', 'overlay'],
  text: ['text'],
  audio: ['audio'],
  effect: ['effect'],
};

export const TrackHeader: React.FC<{ track: Track }> = ({ track }) => {
  const allTracks = useTimelineStore((s) => s.tracks);
  const selectedTrackId = useTimelineStore((s) => s.selectedTrackId);
  const setSelectedTrackId = useTimelineStore((s) => s.setSelectedTrackId);
  const toggleTrackMute = useTimelineStore((s) => s.toggleTrackMute);
  const toggleTrackSolo = useTimelineStore((s) => s.toggleTrackSolo);
  const toggleTrackLock = useTimelineStore((s) => s.toggleTrackLock);
  const setTrackVolume = useTimelineStore((s) => s.setTrackVolume);
  const setTrackHeight = useTimelineStore((s) => s.setTrackHeight);
  const renameTrack = useTimelineStore((s) => s.renameTrack);
  const reorderTrack = useTimelineStore((s) => s.reorderTrack);
  const removeTrack = useTimelineStore((s) => s.removeTrack);
  const selectAllOnTrack = useTimelineStore((s) => s.selectAllOnTrack);
  const openContextMenu = useUiStore((s) => s.openContextMenu);

  const [isRenaming, setIsRenaming] = useState(false);
  const [draft, setDraft] = useState(track.name);

  const isSelected = selectedTrackId === track.id;
  const style = TYPE_STYLE[track.type] ?? TYPE_STYLE.video;

  // Editors number lanes within their own family — V1, V2, A1, A2 — never globally.
  const laneNumber = React.useMemo(() => {
    const family = BADGE_FAMILY[track.type] ?? [track.type];
    // V1 sits closest to the audio, so video-family lanes count up from the bottom.
    const inFamily = allTracks.filter((t) => family.includes(t.type));
    const ordered = track.type === 'audio' ? inFamily : [...inFamily].reverse();
    return ordered.findIndex((t) => t.id === track.id) + 1;
  }, [allTracks, track.id, track.type]);
  const isAudio = track.type === 'audio';
  const isCompact = track.heightPx < 46;

  /* Drag the bottom edge to resize the lane. */
  const handleResize = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const startY = e.clientY;
      const startH = track.heightPx;

      const move = (ev: PointerEvent) => setTrackHeight(track.id, startH + (ev.clientY - startY));
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [track.id, track.heightPx, setTrackHeight]
  );

  const commitRename = () => {
    setIsRenaming(false);
    if (draft.trim() && draft !== track.name) renameTrack(track.id, draft.trim());
    else setDraft(track.name);
  };

  return (
    <div
      onClick={() => setSelectedTrackId(track.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        openContextMenu(e.clientX, e.clientY, [
          { id: 'selall', label: 'Select all clips on track', onSelect: () => selectAllOnTrack(track.id) },
          { id: 'rename', label: 'Rename track', onSelect: () => setIsRenaming(true) },
          { id: 'up', label: 'Move track up', icon: ChevronUp, separatorBefore: true, onSelect: () => reorderTrack(track.id, -1) },
          { id: 'down', label: 'Move track down', icon: ChevronDown, onSelect: () => reorderTrack(track.id, 1) },
          { id: 'del', label: 'Delete track', icon: Trash2, danger: true, separatorBefore: true, onSelect: () => removeTrack(track.id) },
        ]);
      }}
      style={{ height: track.heightPx }}
      className={`relative w-full flex items-center gap-2 pl-3 pr-2 border-b border-line cursor-pointer group transition-colors ${
        isSelected ? 'bg-spectrum-card' : 'bg-spectrum-panelHeader hover:bg-white/[0.028]'
      }`}
    >
      {/* Lane colour spine — the track's identity, flush to the window edge. */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-[3px] ${style.ring} transition-opacity`}
        style={{ opacity: isSelected ? 1 : 0.5 }}
      />

      {/*
        Fixed-width lane badge. Giving the number its own column is what
        keeps a stack of track headers reading as a list rather than as
        ragged text — every name starts at the same x.
      */}
      <span
        className={`flex-shrink-0 w-[22px] text-center text-[10px] font-mono font-bold tabular ${style.color}`}
      >
        {style.badge}{laneNumber}
      </span>

      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
        {isRenaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') { setDraft(track.name); setIsRenaming(false); }
            }}
            onClick={(e) => e.stopPropagation()}
            className="pro-input px-1.5 h-[20px] w-full min-w-0"
          />
        ) : (
          <span
            onDoubleClick={(e) => { e.stopPropagation(); setIsRenaming(true); }}
            className={`text-ui-sm truncate transition-colors ${
              isSelected ? 'text-spectrum-text font-medium' : 'text-spectrum-textMuted'
            }`}
            title={`${track.name} — double-click to rename`}
          >
            {track.name}
          </span>
        )}

        {/* Volume rail on taller audio lanes */}
        {isAudio && !isCompact && (
          <div className="flex items-center gap-1.5 pr-1">
            <input
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={track.volume}
              onChange={(e) => setTrackVolume(track.id, Number(e.target.value))}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 !h-3"
              title={`Track volume · ${Math.round(track.volume * 100)}%`}
            />
            <span className="text-[9px] font-mono text-spectrum-textFaint tabular w-6 text-right">
              {Math.round(track.volume * 100)}
            </span>
          </div>
        )}
      </div>

      {/*
        Toggles keep a reserved column so they never shift as solo appears
        on audio lanes — a control that moves between rows is a control you
        have to look for every time.
      */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {isAudio ? (
          <button
            onClick={(e) => { e.stopPropagation(); toggleTrackSolo(track.id); }}
            className={`pro-btn w-[22px] h-[22px] ${track.solo ? 'pro-btn-active' : ''}`}
            title={track.solo ? 'Un-solo track' : 'Solo track'}
          >
            <Headphones className="w-3 h-3" />
          </button>
        ) : (
          <span className="w-[22px]" />
        )}

        <button
          onClick={(e) => { e.stopPropagation(); toggleTrackMute(track.id); }}
          className={`pro-btn w-[22px] h-[22px] ${track.muted ? '!text-spectrum-red' : ''}`}
          title={isAudio ? (track.muted ? 'Unmute' : 'Mute') : track.muted ? 'Show track' : 'Hide track'}
        >
          {isAudio
            ? track.muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />
            : track.muted ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
        </button>

        <button
          onClick={(e) => { e.stopPropagation(); toggleTrackLock(track.id); }}
          className={`pro-btn w-[22px] h-[22px] ${track.locked ? 'pro-btn-active !text-spectrum-amber' : ''}`}
          title={track.locked ? 'Unlock track' : 'Lock track'}
        >
          {track.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3 opacity-40" />}
        </button>
      </div>

      {/* Lane resize grip */}
      <div
        onPointerDown={handleResize}
        className="absolute left-0 right-0 bottom-0 h-1.5 cursor-row-resize hover:bg-spectrum-accent/40 transition-colors"
        title="Drag to resize track height"
      />
    </div>
  );
};
