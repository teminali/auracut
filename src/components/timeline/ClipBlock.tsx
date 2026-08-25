/* ═══════════════════════════════════════════════════════════════════
   A clip on the timeline: select, drag (across tracks), trim, and the
   fade / transition affordances that sit on its edges.
   ═══════════════════════════════════════════════════════════════════ */

import React, { useCallback, useRef, useState, useMemo, useEffect } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { Clip, Track } from '../../types/edl';
import { AudioWaveform } from './AudioWaveform';
import { extractPeaks } from '../../engine/audioPeakExtractor';
import { formatCompactDuration } from '../../utils/time';
import {
  Type, Film, Music, Image as ImageIcon, Lock, Diamond, Gauge, Layers,
  Copy, Trash2, Scissors, Split, Snowflake, RotateCcw, Unlink,
} from 'lucide-react';

interface ClipBlockProps {
  clip: Clip;
  track: Track;
  pxPerMs: number;
  trackHeightPx: number;
  collectSnapPoints: (exclude?: string[]) => number[];
  snapTime: (ms: number, candidates: number[]) => { value: number; snappedTo: number | null };
  onSnapLine: (ms: number | null) => void;
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  text: Type,
  audio: Music,
  image: ImageIcon,
  sticker: Layers,
  shape: Layers,
  adjustment: Gauge,
  video: Film,
};

const MIN_CLIP_MS = 100;

export const ClipBlock: React.FC<ClipBlockProps> = ({
  clip, track, pxPerMs, trackHeightPx, collectSnapPoints, snapTime, onSnapLine,
}) => {
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const selectClip = useTimelineStore((s) => s.selectClip);
  const trimClip = useTimelineStore((s) => s.trimClip);
  const moveClips = useTimelineStore((s) => s.moveClips);
  const updateClipAudio = useTimelineStore((s) => s.updateClipAudio);
  const beginTransaction = useTimelineStore((s) => s.beginTransaction);
  const commitTransaction = useTimelineStore((s) => s.commitTransaction);
  const cancelTransaction = useTimelineStore((s) => s.cancelTransaction);
  const openContextMenu = useUiStore((s) => s.openContextMenu);

  const [interaction, setInteraction] = useState<'move' | 'trim-l' | 'trim-r' | 'fade-in' | 'fade-out' | null>(null);
  const suppressClick = useRef(false);

  const isSelected = selectedClipIds.includes(clip.id);
  const leftPx = clip.startTimeMs * pxPerMs;
  const widthPx = Math.max(8, clip.durationMs * pxPerMs);
  const Icon = TYPE_ICONS[clip.type] ?? Film;

  const isCompact = widthPx < 72;
  const isTiny = widthPx < 28;

  /*
    Real peaks, decoded from the actual file.

    The waveform used to be generated from a hash of the clip id — it
    looked like audio and correlated with nothing. You cannot spot a beat,
    a breath or a silence in a picture of noise, which is most of what a
    waveform is for.
  */
  const [peaks, setPeaks] = useState<number[] | undefined>();
  useEffect(() => {
    if (clip.type !== 'audio' || !clip.mediaUrl) return;
    let alive = true;
    void extractPeaks(clip.mediaUrl).then((p) => { if (alive) setPeaks(p); }).catch(() => {});
    return () => { alive = false; };
  }, [clip.mediaUrl, clip.type]);

  /* ── Drag to move (multi-clip, cross-track) ── */

  const handleMoveDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || clip.locked || track.locked) return;
      e.stopPropagation();

      const state = useTimelineStore.getState();
      // Dragging an unselected clip selects it first.
      const ids = state.selectedClipIds.includes(clip.id)
        ? state.selectedClipIds
        : (selectClip(clip.id, e.shiftKey), [clip.id]);

      // Group members come along for the ride.
      const groupIds = new Set(ids);
      if (clip.groupId) {
        for (const t of state.tracks) {
          for (const c of t.clips) if (c.groupId === clip.groupId) groupIds.add(c.id);
        }
      }
      const dragIds = [...groupIds];

      const origins = dragIds
        .map((id) => {
          for (const t of state.tracks) {
            const c = t.clips.find((x) => x.id === id);
            if (c) return { id, startTimeMs: c.startTimeMs, trackId: t.id, trackIndex: t.index };
          }
          return null;
        })
        .filter((o): o is NonNullable<typeof o> => o !== null);

      if (origins.length === 0) return;

      const anchor = origins.find((o) => o.id === clip.id) ?? origins[0];
      const candidates = collectSnapPoints(dragIds);
      const trackOrder = state.tracks.map((t) => t.id);
      const startTrackRow = trackOrder.indexOf(anchor.trackId);

      const startX = e.clientX;
      const startY = e.clientY;
      let moved = false;

      beginTransaction();
      setInteraction('move');

      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        suppressClick.current = true;

        const deltaMs = dx / pxPerMs;
        const rawStart = Math.max(0, anchor.startTimeMs + deltaMs);

        // Snap the anchor's head OR tail, whichever lands closer.
        const headSnap = snapTime(rawStart, candidates);
        const tailSnap = snapTime(rawStart + clip.durationMs, candidates);

        let anchorStart = rawStart;
        let guide: number | null = null;
        if (headSnap.snappedTo !== null && tailSnap.snappedTo !== null) {
          const headDist = Math.abs(headSnap.value - rawStart);
          const tailDist = Math.abs(tailSnap.value - (rawStart + clip.durationMs));
          if (headDist <= tailDist) { anchorStart = headSnap.value; guide = headSnap.snappedTo; }
          else { anchorStart = tailSnap.value - clip.durationMs; guide = tailSnap.snappedTo; }
        } else if (headSnap.snappedTo !== null) {
          anchorStart = headSnap.value; guide = headSnap.snappedTo;
        } else if (tailSnap.snappedTo !== null) {
          anchorStart = tailSnap.value - clip.durationMs; guide = tailSnap.snappedTo;
        }
        onSnapLine(guide);

        const appliedDelta = anchorStart - anchor.startTimeMs;

        // Vertical movement shifts every dragged clip by the same row count.
        const rowHeight = Math.max(24, trackHeightPx);
        const rowShift = Math.round(dy / rowHeight);
        const targetRow = Math.max(0, Math.min(trackOrder.length - 1, startTrackRow + rowShift));
        const rowDelta = targetRow - startTrackRow;

        moveClips(
          origins.map((o) => {
            const ownRow = trackOrder.indexOf(o.trackId);
            const newRow = Math.max(0, Math.min(trackOrder.length - 1, ownRow + rowDelta));
            return {
              clipId: o.id,
              trackId: trackOrder[newRow],
              startTimeMs: Math.max(0, o.startTimeMs + appliedDelta),
            };
          })
        );
      };

      const finish = (cancelled: boolean) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('keydown', onKey);
        onSnapLine(null);
        setInteraction(null);
        if (cancelled || !moved) cancelTransaction();
        else commitTransaction(dragIds.length > 1 ? `Move ${dragIds.length} clips` : 'Move clip');
        window.setTimeout(() => { suppressClick.current = false; }, 0);
      };

      const up = () => finish(false);
      const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') finish(true); };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('keydown', onKey);
    },
    [
      clip, track, pxPerMs, trackHeightPx, selectClip, collectSnapPoints, snapTime,
      onSnapLine, moveClips, beginTransaction, commitTransaction, cancelTransaction,
    ]
  );

  /* ── Trim handles ── */

  const handleTrimDown = useCallback(
    (e: React.PointerEvent, side: 'left' | 'right') => {
      if (e.button !== 0 || clip.locked || track.locked) return;
      e.stopPropagation();
      e.preventDefault();

      selectClip(clip.id);
      const candidates = collectSnapPoints([clip.id]);
      const startX = e.clientX;
      const originStart = clip.startTimeMs;
      const originDuration = clip.durationMs;
      let moved = false;

      beginTransaction();
      setInteraction(side === 'left' ? 'trim-l' : 'trim-r');

      const move = (ev: PointerEvent) => {
        const deltaMs = (ev.clientX - startX) / pxPerMs;
        if (!moved && Math.abs(ev.clientX - startX) < 2) return;
        moved = true;
        suppressClick.current = true;

        if (side === 'left') {
          const raw = Math.max(0, Math.min(originStart + originDuration - MIN_CLIP_MS, originStart + deltaMs));
          const snapped = snapTime(raw, candidates);
          onSnapLine(snapped.snappedTo);
          trimClip(clip.id, Math.round(snapped.value), undefined, ev.altKey);
        } else {
          const raw = Math.max(originStart + MIN_CLIP_MS, originStart + originDuration + deltaMs);
          const snapped = snapTime(raw, candidates);
          onSnapLine(snapped.snappedTo);
          trimClip(clip.id, undefined, Math.round(snapped.value), ev.altKey);
        }
      };

      const finish = (cancelled: boolean) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('keydown', onKey);
        onSnapLine(null);
        setInteraction(null);
        if (cancelled || !moved) cancelTransaction();
        else commitTransaction('Trim clip');
        window.setTimeout(() => { suppressClick.current = false; }, 0);
      };

      const up = () => finish(false);
      const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') finish(true); };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('keydown', onKey);
    },
    [clip, track, pxPerMs, selectClip, collectSnapPoints, snapTime, onSnapLine, trimClip, beginTransaction, commitTransaction, cancelTransaction]
  );

  /* ── Fade handles (audio + video) ── */

  const handleFadeDown = useCallback(
    (e: React.PointerEvent, side: 'in' | 'out') => {
      if (e.button !== 0 || clip.locked) return;
      e.stopPropagation();
      e.preventDefault();

      const startX = e.clientX;
      const origin = side === 'in' ? clip.audio.fadeInMs : clip.audio.fadeOutMs;
      const maxFade = clip.durationMs / 2;

      beginTransaction();
      setInteraction(side === 'in' ? 'fade-in' : 'fade-out');

      const move = (ev: PointerEvent) => {
        suppressClick.current = true;
        const deltaMs = ((ev.clientX - startX) / pxPerMs) * (side === 'in' ? 1 : -1);
        const next = Math.max(0, Math.min(maxFade, origin + deltaMs));
        updateClipAudio(clip.id, side === 'in' ? { fadeInMs: Math.round(next) } : { fadeOutMs: Math.round(next) });
      };

      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setInteraction(null);
        commitTransaction(`Set fade ${side}`);
        window.setTimeout(() => { suppressClick.current = false; }, 0);
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [clip, pxPerMs, updateClipAudio, beginTransaction, commitTransaction]
  );

  /* ── Context menu ── */

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      selectClip(clip.id, e.shiftKey);

      const s = useTimelineStore.getState();
      openContextMenu(e.clientX, e.clientY, [
        { id: 'split', label: 'Split at playhead', shortcut: 'S', icon: Scissors, onSelect: () => s.splitClip(clip.id, s.playheadMs) },
        { id: 'duplicate', label: 'Duplicate', shortcut: '⌘D', icon: Copy, onSelect: () => s.duplicateClip(clip.id) },
        { id: 'freeze', label: 'Freeze frame', icon: Snowflake, disabled: clip.type === 'audio' || clip.type === 'text', onSelect: () => s.freezeFrame(clip.id, s.playheadMs) },
        { id: 'reverse', label: clip.speed.reversed ? 'Un-reverse' : 'Reverse', icon: RotateCcw, onSelect: () => s.reverseClip(clip.id) },
        { id: 'detach', label: 'Detach audio', icon: Unlink, separatorBefore: true, disabled: clip.type !== 'video', onSelect: () => s.detachAudio(clip.id) },
        { id: 'group', label: s.selectedClipIds.length > 1 ? 'Group selection' : 'Ungroup', icon: Layers, onSelect: () => (s.selectedClipIds.length > 1 ? s.groupSelected() : s.ungroupSelected()) },
        { id: 'lock', label: clip.locked ? 'Unlock clip' : 'Lock clip', icon: Lock, onSelect: () => s.toggleClipLock(clip.id) },
        { id: 'gaps', label: 'Close gaps on track', icon: Split, separatorBefore: true, onSelect: () => s.closeGapsOnTrack(track.id) },
        { id: 'delete', label: 'Delete', shortcut: '⌫', icon: Trash2, danger: true, onSelect: () => s.deleteSelected() },
      ]);
    },
    [clip, track.id, selectClip, openContextMenu]
  );

  /* ── Visuals ── */

  const keyframeMarks = useMemo(() => {
    if (clip.keyframes.length === 0 || widthPx < 40) return [];
    const seen = new Set<number>();
    return clip.keyframes
      .filter((k) => {
        const bucket = Math.round((k.timeOffsetMs * pxPerMs) / 4);
        if (seen.has(bucket)) return false;
        seen.add(bucket);
        return true;
      })
      .slice(0, 60);
  }, [clip.keyframes, pxPerMs, widthPx]);

  const fadeInPx = clip.audio.fadeInMs * pxPerMs;
  const fadeOutPx = clip.audio.fadeOutMs * pxPerMs;
  const hasSpeedRamp = clip.speed.multiplier !== 1 || clip.speed.curvePreset !== 'linear';

  /*
    A clip's identity colour is worn as a top rail and a faint wash, never
    as the fill. A saturated body fights the thumbnail and the waveform for
    attention, and a timeline of them reads as decoration rather than data
    — the single biggest thing separating a toy NLE from a working one.
  */
  const tint = clip.color;

  return (
    <div
      onPointerDown={handleMoveDown}
      onClick={(e) => {
        e.stopPropagation();
        if (suppressClick.current) return;
        selectClip(clip.id, e.shiftKey || e.metaKey);
      }}
      onContextMenu={handleContextMenu}
      style={{ left: leftPx, width: widthPx, height: trackHeightPx - 6 }}
      className={`clip-body absolute top-[3px] rounded-[5px] overflow-hidden select-none group transition-shadow ${
        clip.locked || track.locked ? 'cursor-not-allowed' : 'cursor-grab'
      } ${interaction === 'move' ? 'cursor-grabbing opacity-90 z-20' : ''} ${
        isSelected ? 'z-10 shadow-clipSelected' : 'shadow-clip'
      } ${clip.hidden ? 'opacity-40' : ''}`}
    >
      {/* Identity wash — strongest at the top, gone by mid-height. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `linear-gradient(180deg, ${tint}4d 0%, ${tint}1a 42%, ${tint}0d 100%)` }}
      />
      {/* Thumbnail strip */}
      {clip.thumbnailUrl && clip.type !== 'audio' && !isTiny && (
        <div
          className="absolute inset-0 opacity-60 pointer-events-none"
          style={{
            backgroundImage: `url(${clip.thumbnailUrl})`,
            backgroundSize: `${Math.max(trackHeightPx * 1.78, 48)}px 100%`,
            backgroundRepeat: 'repeat-x',
          }}
        />
      )}

      {/* Gradient scrim keeps the label readable over any thumbnail */}
      <div className="absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />

      {/* Lane identity rail */}
      <div className="clip-rail" style={{ background: tint }} />

      {/* Label row */}
      {!isTiny && (
        <div className="relative h-[17px] mt-[2px] px-1.5 flex items-center justify-between gap-1 pointer-events-none">
          <span className="flex items-center gap-1 min-w-0 text-micro font-medium text-white/95 leading-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            <Icon className="w-2.5 h-2.5 flex-shrink-0 opacity-75" />
            {!isCompact && <span className="truncate tracking-normal normal-case">{clip.name}</span>}
          </span>
          {!isCompact && (
            <span className="text-micro font-mono text-white/60 flex-shrink-0 tabular tracking-normal">
              {formatCompactDuration(clip.durationMs)}
            </span>
          )}
        </div>
      )}

      {/* Waveform */}
      {clip.type === 'audio' && !isTiny && (
        <div className="absolute inset-x-0 bottom-0 pointer-events-none" style={{ top: 19 }}>
          <AudioWaveform
            width={widthPx}
            height={Math.max(4, trackHeightPx - 25)}
            color="#7ce8bb"
            seed={clip.id}
            peaks={peaks}
          />
        </div>
      )}

      {/* Fade ramps */}
      {fadeInPx > 1 && (
        <div
          className="absolute top-0 bottom-0 left-0 pointer-events-none"
          style={{
            width: fadeInPx,
            background: 'linear-gradient(to right, rgba(0,0,0,0.75), transparent)',
            clipPath: 'polygon(0 0, 100% 0, 0 100%)',
          }}
        />
      )}
      {fadeOutPx > 1 && (
        <div
          className="absolute top-0 bottom-0 right-0 pointer-events-none"
          style={{
            width: fadeOutPx,
            background: 'linear-gradient(to left, rgba(0,0,0,0.75), transparent)',
            clipPath: 'polygon(100% 0, 100% 100%, 0 0)',
          }}
        />
      )}

      {/* Keyframe diamonds */}
      {keyframeMarks.length > 0 && (
        <div className="absolute bottom-0.5 left-0 right-0 h-2 pointer-events-none">
          {keyframeMarks.map((kf) => (
            <div
              key={kf.id}
              className="absolute w-[5px] h-[5px] rotate-45 bg-spectrum-amber border border-black/60"
              style={{ left: Math.min(widthPx - 6, kf.timeOffsetMs * pxPerMs) }}
              title={`${kf.property} @ ${Math.round(kf.timeOffsetMs)}ms`}
            />
          ))}
        </div>
      )}

      {/* Badges */}
      {!isCompact && (
        <div className="absolute bottom-0.5 right-1 flex items-center gap-1 pointer-events-none">
          {hasSpeedRamp && (
            <span className="px-1 rounded-[3px] bg-black/65 text-[9px] font-mono text-spectrum-amber leading-[13px] tracking-normal">
              {clip.speed.reversed ? '◀' : ''}{clip.speed.multiplier.toFixed(2).replace(/0$/, '')}×
            </span>
          )}
          {clip.blendMode !== 'normal' && (
            <span className="px-1 rounded-[3px] bg-black/65 text-[9px] text-spectrum-purple leading-[13px] tracking-normal">
              {clip.blendMode.slice(0, 4)}
            </span>
          )}
          {clip.groupId && <Layers className="w-2.5 h-2.5 text-white/70" />}
          {clip.locked && <Lock className="w-2.5 h-2.5 text-spectrum-amber" />}
        </div>
      )}

      {/* Transition wedges */}
      {clip.transitionIn && clip.transitionIn.type !== 'none' && (
        <div
          className="absolute top-0 bottom-0 left-0 pointer-events-none border-r border-white/25"
          style={{
            width: Math.min(widthPx / 2, clip.transitionIn.durationMs * pxPerMs),
            background: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.16) 0 3px, transparent 3px 6px)',
          }}
          title={`In: ${clip.transitionIn.type}`}
        />
      )}
      {clip.transitionOut && clip.transitionOut.type !== 'none' && (
        <div
          className="absolute top-0 bottom-0 right-0 pointer-events-none border-l border-white/25"
          style={{
            width: Math.min(widthPx / 2, clip.transitionOut.durationMs * pxPerMs),
            background: 'repeating-linear-gradient(-45deg, rgba(255,255,255,0.16) 0 3px, transparent 3px 6px)',
          }}
          title={`Out: ${clip.transitionOut.type}`}
        />
      )}

      {/* Fade grips */}
      {isSelected && widthPx > 56 && (
        <>
          <div
            onPointerDown={(e) => handleFadeDown(e, 'in')}
            className="absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white border border-black/50 cursor-ew-resize z-30 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ left: Math.max(2, fadeInPx - 5) }}
            title="Drag to set fade in"
          />
          <div
            onPointerDown={(e) => handleFadeDown(e, 'out')}
            className="absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white border border-black/50 cursor-ew-resize z-30 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ right: Math.max(2, fadeOutPx - 5) }}
            title="Drag to set fade out"
          />
        </>
      )}

      {/* Trim handles */}
      {!clip.locked && !track.locked && (
        <>
          <div
            onPointerDown={(e) => handleTrimDown(e, 'left')}
            className={`absolute top-0 left-0 bottom-0 w-2 cursor-ew-resize z-20 transition-colors ${
              interaction === 'trim-l' ? 'bg-spectrum-accent' : 'hover:bg-white/35'
            }`}
          >
            <div className="absolute inset-y-1.5 left-[3px] w-[2px] rounded-full bg-white/0 group-hover:bg-white/50 transition-colors" />
          </div>
          <div
            onPointerDown={(e) => handleTrimDown(e, 'right')}
            className={`absolute top-0 right-0 bottom-0 w-2 cursor-ew-resize z-20 transition-colors ${
              interaction === 'trim-r' ? 'bg-spectrum-accent' : 'hover:bg-white/35'
            }`}
          >
            <div className="absolute inset-y-1.5 right-[3px] w-[2px] rounded-full bg-white/0 group-hover:bg-white/50 transition-colors" />
          </div>
        </>
      )}
    </div>
  );
};
