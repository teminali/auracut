import React from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useProjectStore } from '../../store/projectStore';
import { Clip, AnimatableProperty } from '../../types/edl';
import { interpolateKeyframes, keyframeAt } from '../../engine/keyframeMath';
import { Section, NumberField, SliderRow, SegmentedControl, ToggleRow } from '../ui/Controls';
import {
  Move3d, Crop, Layers2, Wind, Square, Circle, Columns2, Star, Heart, Film, FlipHorizontal2, FlipVertical2, RotateCcw, Route,
} from 'lucide-react';

const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
] as const;

const MASK_SHAPES = [
  { value: 'rectangle', label: 'Rect', icon: Square },
  { value: 'circle', label: 'Circle', icon: Circle },
  { value: 'ellipse', label: 'Oval', icon: Circle },
  { value: 'split', label: 'Split', icon: Columns2 },
  { value: 'star', label: 'Star', icon: Star },
  { value: 'heart', label: 'Heart', icon: Heart },
  { value: 'film', label: 'Film', icon: Film },
] as const;

export const TransformInspector: React.FC<{ clip: Clip }> = ({ clip }) => {
  const playheadMs = useTimelineStore((s) => s.playheadMs);
  const updateClipTransform = useTimelineStore((s) => s.updateClipTransform);
  const updateClipMask = useTimelineStore((s) => s.updateClipMask);
  const setClipBlendMode = useTimelineStore((s) => s.setClipBlendMode);
  const setClipFitMode = useTimelineStore((s) => s.setClipFitMode);
  const resetClipTransform = useTimelineStore((s) => s.resetClipTransform);
  const upsertKeyframeAt = useTimelineStore((s) => s.upsertKeyframeAt);
  const removeKeyframe = useTimelineStore((s) => s.removeKeyframe);
  const patchClip = useTimelineStore((s) => s.patchClip);
  const setMotionPath = useTimelineStore((s) => s.setMotionPath);
  const beginTransaction = useTimelineStore((s) => s.beginTransaction);
  const commitTransaction = useTimelineStore((s) => s.commitTransaction);
  const project = useProjectStore((s) => s.project);

  const offsetMs = Math.max(0, Math.min(clip.durationMs, playheadMs - clip.startTimeMs));
  const t = clip.transform;

  /* Wrap live edits in one undo step per gesture. */
  const startEdit = () => beginTransaction();
  const endEdit = (label: string) => commitTransaction(label);

  /** Wire a slider/field to a transform field, writing keyframes when animated. */
  const bind = (
    field: keyof typeof t,
    property?: AnimatableProperty
  ) => ({
    value: (() => {
      if (!property) return t[field] as number;
      return interpolateKeyframes(clip.keyframes, property, offsetMs, t[field] as number);
    })(),
    onChange: (v: number) => {
      const animated = property && clip.keyframes.some((k) => k.property === property);
      if (animated) upsertKeyframeAt(clip.id, property!, offsetMs, v);
      else updateClipTransform(clip.id, { [field]: v } as any);
    },
  });

  const keyframeProps = (property: AnimatableProperty, currentValue: number) => ({
    animated: clip.keyframes.some((k) => k.property === property),
    atPlayhead: Boolean(keyframeAt(clip.keyframes, property, offsetMs)),
    onToggle: () => {
      const existing = keyframeAt(clip.keyframes, property, offsetMs);
      if (existing) removeKeyframe(clip.id, existing.id);
      else upsertKeyframeAt(clip.id, property, offsetMs, currentValue);
    },
  });

  const uniformScale = Math.abs(t.scaleX - t.scaleY) < 0.001;

  return (
    <div>
      <Section
        title="Transform"
        icon={Move3d}
        action={
          <button onClick={() => resetClipTransform(clip.id)} className="pro-btn w-5 h-5" title="Reset transform">
            <RotateCcw className="w-3 h-3" />
          </button>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="X"
            unit="px"
            {...bind('x', 'positionX')}
            onCommit={() => endEdit('Set position X')}
            sensitivity={2}
          />
          <NumberField
            label="Y"
            unit="px"
            {...bind('y', 'positionY')}
            onCommit={() => endEdit('Set position Y')}
            sensitivity={2}
          />
        </div>

        <SliderRow
          label="Scale"
          min={0.05}
          max={4}
          step={0.01}
          displayScale={100}
          unit="%"
          defaultValue={1}
          keyframe={keyframeProps('scaleX', t.scaleX)}
          value={interpolateKeyframes(clip.keyframes, 'scaleX', offsetMs, t.scaleX)}
          onChange={(v) => {
            const animated = clip.keyframes.some((k) => k.property === 'scaleX');
            if (animated) {
              upsertKeyframeAt(clip.id, 'scaleX', offsetMs, v);
              upsertKeyframeAt(clip.id, 'scaleY', offsetMs, v);
            } else {
              // Non-uniform scale stays non-uniform: keep the existing ratio.
              const ratio = uniformScale ? 1 : t.scaleY / (t.scaleX || 1);
              updateClipTransform(clip.id, { scaleX: v, scaleY: uniformScale ? v : v * ratio });
            }
          }}
          onCommit={() => endEdit('Set scale')}
        />

        {!uniformScale && (
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="W" value={t.scaleX * 100} precision={0} unit="%" min={5} max={400}
              onChange={(v) => updateClipTransform(clip.id, { scaleX: v / 100 })} onCommit={() => endEdit('Set width')} />
            <NumberField label="H" value={t.scaleY * 100} precision={0} unit="%" min={5} max={400}
              onChange={(v) => updateClipTransform(clip.id, { scaleY: v / 100 })} onCommit={() => endEdit('Set height')} />
          </div>
        )}

        <SliderRow
          label="Rotation"
          min={-180}
          max={180}
          step={0.5}
          unit="°"
          precision={1}
          bipolar
          defaultValue={0}
          keyframe={keyframeProps('rotation', t.rotation)}
          {...bind('rotation', 'rotation')}
          onCommit={() => endEdit('Set rotation')}
        />

        <SliderRow
          label="Opacity"
          min={0}
          max={1}
          step={0.01}
          displayScale={100}
          unit="%"
          defaultValue={1}
          keyframe={keyframeProps('opacity', t.opacity)}
          {...bind('opacity', 'opacity')}
          onCommit={() => endEdit('Set opacity')}
        />

        <div className="grid grid-cols-2 gap-1 pt-0.5">
          <button
            onClick={() => { updateClipTransform(clip.id, { flipH: !t.flipH }); endEdit('Flip H'); }}
            className={`h-7 rounded-squircle-xs border text-[10px] flex items-center justify-center gap-1 transition-colors ${
              t.flipH ? 'bg-spectrum-accentSoft border-spectrum-accentLine text-spectrum-accent' : 'bg-spectrum-card border-line text-spectrum-textDim hover:text-spectrum-text'
            }`}
          >
            <FlipHorizontal2 className="w-3 h-3" /> Flip H
          </button>
          <button
            onClick={() => { updateClipTransform(clip.id, { flipV: !t.flipV }); endEdit('Flip V'); }}
            className={`h-7 rounded-squircle-xs border text-[10px] flex items-center justify-center gap-1 transition-colors ${
              t.flipV ? 'bg-spectrum-accentSoft border-spectrum-accentLine text-spectrum-accent' : 'bg-spectrum-card border-line text-spectrum-textDim hover:text-spectrum-text'
            }`}
          >
            <FlipVertical2 className="w-3 h-3" /> Flip V
          </button>
        </div>
      </Section>

      {/* ── Compositing ── */}
      <Section title="Compositing" icon={Layers2}>
        <div className="space-y-1">
          <span className="text-[11px] text-spectrum-textMuted">Blend mode</span>
          <select
            value={clip.blendMode}
            onChange={(e) => setClipBlendMode(clip.id, e.target.value as any)}
            className="pro-input w-full h-7 px-2 text-[11px] cursor-pointer capitalize"
          >
            {BLEND_MODES.map((m) => (
              <option key={m} value={m}>{m.replace(/-/g, ' ')}</option>
            ))}
          </select>
        </div>

        {clip.type !== 'text' && clip.type !== 'shape' && (
          <div className="space-y-1">
            <span className="text-[11px] text-spectrum-textMuted">Fit to frame</span>
            <SegmentedControl
              value={clip.fitMode}
              onChange={(v) => setClipFitMode(clip.id, v)}
              options={[
                { value: 'cover', label: 'Cover', title: 'Fill the frame, cropping the overflow' },
                { value: 'contain', label: 'Fit', title: 'Fit inside the frame' },
                { value: 'fill', label: 'Stretch', title: 'Stretch to the frame, ignoring aspect' },
                { value: 'none', label: 'Native', title: 'Use the media\'s own pixel size' },
              ]}
            />
          </div>
        )}
      </Section>

      {/* ── Motion blur ── */}
      <Section title="Motion blur" icon={Wind} defaultOpen={false}>
        <ToggleRow
          label="Enable motion blur"
          hint="Samples the layer across the shutter interval"
          checked={clip.motionBlur.enabled}
          onChange={(v) => patchClip(clip.id, { 'motionBlur.enabled': v })}
        />
        {clip.motionBlur.enabled && (
          <>
            <SliderRow
              label="Shutter angle"
              min={0} max={720} step={5} unit="°"
              defaultValue={180}
              value={clip.motionBlur.shutterAngle}
              onChange={(v) => patchClip(clip.id, { 'motionBlur.shutterAngle': v })}
            />
            <SliderRow
              label="Samples"
              min={2} max={16} step={1}
              defaultValue={6}
              value={clip.motionBlur.samples}
              onChange={(v) => patchClip(clip.id, { 'motionBlur.samples': v })}
            />
            <p className="text-[10px] text-spectrum-textFaint leading-relaxed">
              More samples look smoother but cost roughly that many extra renders per frame.
            </p>
          </>
        )}
      </Section>

      {/* ── Motion path ── */}
      <Section title="Motion path" icon={Route} defaultOpen={false}>
        <ToggleRow
          label="Travel along a path"
          hint="Overrides position keyframes"
          checked={Boolean(clip.motionPath?.enabled)}
          onChange={(v) => {
            if (v && (!clip.motionPath || clip.motionPath.points.length < 2)) {
              // Seed a gentle left-to-right arc through the frame.
              setMotionPath(clip.id, {
                enabled: true,
                points: [
                  { x: project.width * 0.2, y: project.height * 0.5 },
                  { x: project.width * 0.5, y: project.height * 0.3 },
                  { x: project.width * 0.8, y: project.height * 0.5 },
                ],
              });
            } else {
              setMotionPath(clip.id, { enabled: v });
            }
          }}
        />

        {clip.motionPath?.enabled && (
          <>
            <ToggleRow
              label="Orient to path"
              hint="Rotate the layer to follow the direction of travel"
              checked={clip.motionPath.orientToPath}
              onChange={(v) => setMotionPath(clip.id, { orientToPath: v })}
            />
            <ToggleRow
              label="Closed loop"
              checked={clip.motionPath.closed}
              onChange={(v) => setMotionPath(clip.id, { closed: v })}
            />
            <div className="space-y-1">
              <span className="text-[11px] text-spectrum-textMuted">Travel easing</span>
              <select
                value={clip.motionPath.easing}
                onChange={(e) => setMotionPath(clip.id, { easing: e.target.value as any })}
                className="pro-input w-full h-7 px-2 text-[11px] cursor-pointer"
              >
                {['linear', 'easeIn', 'easeOut', 'easeInOut'].map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
            </div>
            <p className="text-[10px] text-spectrum-textFaint">
              {clip.motionPath.points.length} points — drag them in the program monitor.
            </p>
          </>
        )}
      </Section>

      {/* ── Mask ── */}
      <Section
        title="Mask"
        icon={Crop}
        defaultOpen={clip.mask.enabled}
        action={
          <input
            type="checkbox"
            checked={clip.mask.enabled}
            onChange={(e) => updateClipMask(clip.id, { enabled: e.target.checked })}
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        {clip.mask.enabled ? (
          <>
            <SegmentedControl
              value={clip.mask.type}
              columns={4}
              onChange={(v) => updateClipMask(clip.id, { type: v })}
              options={MASK_SHAPES.map((s) => ({ value: s.value, label: s.label, icon: s.icon }))}
            />
            <SliderRow label="Width" min={1} max={200} unit="%" defaultValue={80}
              value={clip.mask.sizeX} onChange={(v) => updateClipMask(clip.id, { sizeX: v })} />
            <SliderRow label="Height" min={1} max={200} unit="%" defaultValue={80}
              value={clip.mask.sizeY} onChange={(v) => updateClipMask(clip.id, { sizeY: v })} />
            <SliderRow label="Offset X" min={-100} max={100} unit="%" bipolar defaultValue={0}
              value={clip.mask.offsetX} onChange={(v) => updateClipMask(clip.id, { offsetX: v })} />
            <SliderRow label="Offset Y" min={-100} max={100} unit="%" bipolar defaultValue={0}
              value={clip.mask.offsetY} onChange={(v) => updateClipMask(clip.id, { offsetY: v })} />
            <SliderRow label="Corner radius" min={0} max={300} unit="px" defaultValue={12}
              value={clip.mask.roundness} onChange={(v) => updateClipMask(clip.id, { roundness: v })} />
            <SliderRow label="Feather" min={0} max={200} unit="px" defaultValue={0}
              value={clip.mask.featherPx} onChange={(v) => updateClipMask(clip.id, { featherPx: v })} />
            <ToggleRow label="Invert mask" checked={clip.mask.inverted}
              onChange={(v) => updateClipMask(clip.id, { inverted: v })} />
          </>
        ) : (
          <p className="text-[10px] text-spectrum-textFaint">
            Turn the mask on to crop this layer to a shape.
          </p>
        )}
      </Section>
    </div>
  );
};
