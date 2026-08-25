import React, { useState } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { TransitionType } from '../../types/edl';
import { SliderRow, SegmentedControl, Section } from '../ui/Controls';
import { Layers, ArrowLeftRight } from 'lucide-react';

const TRANSITIONS: { id: TransitionType; label: string; glyph: string; hint: string }[] = [
  { id: 'crossfade', label: 'Dissolve', glyph: '🎬', hint: 'Classic film dissolve' },
  { id: 'blur_dissolve', label: 'Blur Dissolve', glyph: '🌫️', hint: 'Soft defocus blend' },
  { id: 'dip_to_black', label: 'Dip to Black', glyph: '⚫', hint: 'Fade through black' },
  { id: 'dip_to_white', label: 'Dip to White', glyph: '⚪', hint: 'Fade through white' },
  { id: 'flash', label: 'Impact Flash', glyph: '💥', hint: 'Hard white hit' },
  { id: 'whip_pan', label: 'Whip Pan', glyph: '⚡', hint: 'Motion-blurred swish' },
  { id: 'zoom_in', label: 'Zoom In', glyph: '🔍', hint: 'Punch into the frame' },
  { id: 'zoom_out', label: 'Zoom Out', glyph: '🔭', hint: 'Pull back' },
  { id: 'glitch', label: 'Glitch', glyph: '👾', hint: 'RGB tear' },
  { id: 'diagonal_split', label: 'Diagonal', glyph: '⚔️', hint: 'Corner slide' },
  { id: 'push_left', label: 'Push Left', glyph: '⬅️', hint: 'Slide the frame out' },
  { id: 'push_right', label: 'Push Right', glyph: '➡️', hint: 'Slide the frame in' },
  { id: 'slide_up', label: 'Slide Up', glyph: '⬆️', hint: 'Vertical push' },
  { id: 'spin', label: 'Spin', glyph: '🌀', hint: 'Rotate and scale' },
];

export const TransitionsPanel: React.FC = () => {
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const tracks = useTimelineStore((s) => s.tracks);
  const applyTransitionToClip = useTimelineStore((s) => s.applyTransitionToClip);
  const removeTransition = useTimelineStore((s) => s.removeTransition);
  const pushToast = useUiStore((s) => s.pushToast);

  const [durationMs, setDurationMs] = useState(400);
  const [position, setPosition] = useState<'in' | 'out' | 'seam'>('seam');

  const clip = React.useMemo(() => {
    const id = selectedClipIds[0];
    if (!id) return null;
    for (const track of tracks) {
      const found = track.clips.find((c) => c.id === id);
      if (found) return { clip: found, track };
    }
    return null;
  }, [tracks, selectedClipIds]);

  const apply = (type: TransitionType) => {
    if (!clip) {
      pushToast({ kind: 'error', title: 'Select a clip first' });
      return;
    }

    if (position === 'seam') {
      // Place it across the cut with the clip that follows on the same track.
      const sorted = [...clip.track.clips].sort((a, b) => a.startTimeMs - b.startTimeMs);
      const index = sorted.findIndex((c) => c.id === clip.clip.id);
      const next = sorted[index + 1];

      applyTransitionToClip(clip.clip.id, 'out', type, durationMs);
      if (next) applyTransitionToClip(next.id, 'in', type, durationMs);

      pushToast({
        kind: 'success',
        title: `${type.replace(/_/g, ' ')} applied`,
        detail: next ? `Across the cut into "${next.name}"` : 'On the clip tail',
      });
      return;
    }

    applyTransitionToClip(clip.clip.id, position, type, durationMs);
    pushToast({ kind: 'success', title: `${type.replace(/_/g, ' ')} applied`, detail: `On the clip ${position}-point` });
  };

  return (
    <div className="w-full h-full bg-spectrum-panel border-r border-line flex flex-col overflow-hidden">
      <div className="panel-header">
        <span className="panel-title">Transitions</span>
      </div>

      <div className="p-2.5 border-b border-line space-y-2.5 flex-shrink-0">
        <div className="space-y-1">
          <span className="text-[11px] text-spectrum-textMuted">Placement</span>
          <SegmentedControl
            value={position}
            onChange={setPosition}
            options={[
              { value: 'seam', label: 'Across cut', title: 'Split across the cut between two clips' },
              { value: 'in', label: 'Clip in', title: 'On the start of this clip' },
              { value: 'out', label: 'Clip out', title: 'On the end of this clip' },
            ]}
          />
        </div>

        <SliderRow
          label="Duration"
          min={100}
          max={2000}
          step={50}
          unit="ms"
          defaultValue={400}
          value={durationMs}
          onChange={setDurationMs}
        />

        {clip && (clip.clip.transitionIn || clip.clip.transitionOut) && (
          <div className="flex items-center gap-1.5">
            {clip.clip.transitionIn && (
              <button
                onClick={() => removeTransition(clip.clip.id, 'in')}
                className="btn-ghost-danger flex-1 h-6 text-[10px] gap-1"
              >
                Clear in · {clip.clip.transitionIn.type.replace(/_/g, ' ')}
              </button>
            )}
            {clip.clip.transitionOut && (
              <button
                onClick={() => removeTransition(clip.clip.id, 'out')}
                className="btn-ghost-danger flex-1 h-6 text-[10px] gap-1"
              >
                Clear out · {clip.clip.transitionOut.type.replace(/_/g, ' ')}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 grid grid-cols-2 gap-1.5 content-start">
        {TRANSITIONS.map((item) => (
          <button
            key={item.id}
            onClick={() => apply(item.id)}
            className="card-interactive p-2.5 flex flex-col items-center justify-center text-center gap-1 group"
            title={item.hint}
          >
            <span className="text-[18px] leading-none">{item.glyph}</span>
            <span className="text-[11px] font-medium text-spectrum-text group-hover:text-spectrum-accent transition-colors">
              {item.label}
            </span>
            <span className="text-[9px] text-spectrum-textFaint truncate w-full">{item.hint}</span>
          </button>
        ))}
      </div>

      {!clip && (
        <div className="p-2 border-t border-line flex-shrink-0">
          <p className="text-[10px] text-spectrum-textFaint text-center">
            Select a clip to apply a transition.
          </p>
        </div>
      )}
    </div>
  );
};
