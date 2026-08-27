/* Canva-style align & distribute strip for the selected canvas layers. */

import React from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useProjectStore } from '../../store/projectStore';
import { getClipBox, getBoxAABB } from '../../engine/geometry';
import { alignToCanvas, AlignAction } from '../../engine/snapping';
import { getNaturalSize } from '../../engine/compositor';
import { Clip } from '../../types/edl';
import {
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignHorizontalSpaceAround, AlignVerticalSpaceAround, Maximize, RotateCcw, FlipHorizontal2, FlipVertical2,
} from '../ui/icons';

const ALIGN_BUTTONS: { action: AlignAction; icon: React.ElementType; label: string }[] = [
  { action: 'left', icon: AlignHorizontalJustifyStart, label: 'Align left' },
  { action: 'center-h', icon: AlignHorizontalJustifyCenter, label: 'Centre horizontally' },
  { action: 'right', icon: AlignHorizontalJustifyEnd, label: 'Align right' },
  { action: 'top', icon: AlignVerticalJustifyStart, label: 'Align top' },
  { action: 'center-v', icon: AlignVerticalJustifyCenter, label: 'Centre vertically' },
  { action: 'bottom', icon: AlignVerticalJustifyEnd, label: 'Align bottom' },
];

export const AlignmentBar: React.FC = () => {
  const project = useProjectStore((s) => s.project);
  const tracks = useTimelineStore((s) => s.tracks);
  const playheadMs = useTimelineStore((s) => s.playheadMs);
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const updateClipsTransform = useTimelineStore((s) => s.updateClipsTransform);
  const updateClipTransform = useTimelineStore((s) => s.updateClipTransform);
  const resetClipTransform = useTimelineStore((s) => s.resetClipTransform);
  const commit = useTimelineStore((s) => s.commit);

  const selected: Clip[] = React.useMemo(() => {
    const out: Clip[] = [];
    for (const id of selectedClipIds) {
      for (const track of tracks) {
        const clip = track.clips.find((c) => c.id === id);
        if (clip && clip.type !== 'audio') out.push(clip);
      }
    }
    return out;
  }, [tracks, selectedClipIds]);

  if (selected.length === 0) return null;

  const boxFor = (clip: Clip) => getClipBox(clip, project, playheadMs, getNaturalSize(clip));

  const handleAlign = (action: AlignAction) => {
    const updates = selected.map((clip) => {
      const { cx, cy } = alignToCanvas(boxFor(clip), project, action);
      return {
        clipId: clip.id,
        transform: {
          x: Math.round(cx - project.width / 2),
          y: Math.round(cy - project.height / 2),
        },
      };
    });
    updateClipsTransform(updates);
    commit(`Align ${action}`);
  };

  /** Space the selection evenly between its own outermost members. */
  const handleDistribute = (axis: 'x' | 'y') => {
    if (selected.length < 3) return;

    const entries = selected
      .map((clip) => ({ clip, rect: getBoxAABB(boxFor(clip)) }))
      .sort((a, b) => (axis === 'x' ? a.rect.x - b.rect.x : a.rect.y - b.rect.y));

    const first = entries[0].rect;
    const last = entries[entries.length - 1].rect;

    const spanStart = axis === 'x' ? first.x : first.y;
    const spanEnd = axis === 'x' ? last.x + last.width : last.y + last.height;
    const totalSize = entries.reduce(
      (sum, e) => sum + (axis === 'x' ? e.rect.width : e.rect.height),
      0
    );
    const gap = (spanEnd - spanStart - totalSize) / (entries.length - 1);

    let cursor = spanStart;
    const updates = entries.map(({ clip, rect }) => {
      const size = axis === 'x' ? rect.width : rect.height;
      const targetStart = cursor;
      cursor += size + gap;

      const box = boxFor(clip);
      // Preserve the offset between the AABB and the true centre when rotated.
      const offset = axis === 'x' ? box.cx - (rect.x + rect.width / 2) : box.cy - (rect.y + rect.height / 2);
      const newCenter = targetStart + size / 2 + offset;

      return {
        clipId: clip.id,
        transform:
          axis === 'x'
            ? { x: Math.round(newCenter - project.width / 2) }
            : { y: Math.round(newCenter - project.height / 2) },
      };
    });

    updateClipsTransform(updates);
    commit('Distribute layers');
  };

  /** Scale the layer so it exactly fills the frame. */
  const handleFitToFrame = () => {
    const updates = selected.map((clip) => {
      const box = boxFor(clip);
      const scale = Math.max(
        project.width / Math.max(1, box.baseWidth),
        project.height / Math.max(1, box.baseHeight)
      );
      return { clipId: clip.id, transform: { x: 0, y: 0, scaleX: scale, scaleY: scale, rotation: 0 } };
    });
    updateClipsTransform(updates);
    commit('Fit to frame');
  };

  const handleFlip = (axis: 'h' | 'v') => {
    for (const clip of selected) {
      updateClipTransform(clip.id,
        axis === 'h' ? { flipH: !clip.transform.flipH } : { flipV: !clip.transform.flipV });
    }
    commit(`Flip ${axis === 'h' ? 'horizontal' : 'vertical'}`);
  };

  const handleReset = () => {
    for (const clip of selected) resetClipTransform(clip.id);
  };

  const canDistribute = selected.length >= 3;

  return (
    /* The caller owns the surface — this is just the control row. */
    <div className="flex items-center gap-0.5">
      {ALIGN_BUTTONS.map(({ action, icon: Icon, label }, i) => (
        <React.Fragment key={action}>
          {i === 3 && <div className="w-px h-4 bg-line mx-0.5" />}
          <button onClick={() => handleAlign(action)} className="pro-btn w-6 h-6" title={label}>
            <Icon className="w-3.5 h-3.5" />
          </button>
        </React.Fragment>
      ))}

      <div className="w-px h-4 bg-line mx-0.5" />

      <button
        onClick={() => handleDistribute('x')}
        disabled={!canDistribute}
        className="pro-btn w-6 h-6"
        title={canDistribute ? 'Distribute horizontally' : 'Select 3+ layers to distribute'}
      >
        <AlignHorizontalSpaceAround className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => handleDistribute('y')}
        disabled={!canDistribute}
        className="pro-btn w-6 h-6"
        title={canDistribute ? 'Distribute vertically' : 'Select 3+ layers to distribute'}
      >
        <AlignVerticalSpaceAround className="w-3.5 h-3.5" />
      </button>

      <div className="w-px h-4 bg-line mx-0.5" />

      <button onClick={() => handleFlip('h')} className="pro-btn w-6 h-6" title="Flip horizontal">
        <FlipHorizontal2 className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => handleFlip('v')} className="pro-btn w-6 h-6" title="Flip vertical">
        <FlipVertical2 className="w-3.5 h-3.5" />
      </button>
      <button onClick={handleFitToFrame} className="pro-btn w-6 h-6" title="Fit layer to frame">
        <Maximize className="w-3.5 h-3.5" />
      </button>
      <button onClick={handleReset} className="pro-btn w-6 h-6" title="Reset transform">
        <RotateCcw className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
