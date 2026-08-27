import React from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { Clip, ShapeKind } from '../../types/edl';
import { Section, SliderRow, ColorField, ToggleRow, SegmentedControl } from '../ui/Controls';
import { Shapes, PaintBucket, Scissors, Square, Circle, Triangle, Star, Minus, MoveRight, Heart, Hexagon, Spline } from '../ui/icons';

const SHAPES: { value: ShapeKind; label: string; icon: React.ElementType }[] = [
  { value: 'rectangle', label: 'Rect', icon: Square },
  { value: 'ellipse', label: 'Oval', icon: Circle },
  { value: 'triangle', label: 'Tri', icon: Triangle },
  { value: 'polygon', label: 'Poly', icon: Hexagon },
  { value: 'star', label: 'Star', icon: Star },
  { value: 'line', label: 'Line', icon: Minus },
  { value: 'arrow', label: 'Arrow', icon: MoveRight },
  { value: 'heart', label: 'Heart', icon: Heart },
  { value: 'blob', label: 'Blob', icon: Spline },
];

export const ShapeInspector: React.FC<{ clip: Clip }> = ({ clip }) => {
  const updateShapeStyle = useTimelineStore((s) => s.updateShapeStyle);
  const commit = useTimelineStore((s) => s.commit);
  const patchClip = useTimelineStore((s) => s.patchClip);

  const style = clip.shapeStyle;
  if (!style) return null;

  const set = (patch: Partial<typeof style>) => updateShapeStyle(clip.id, patch);
  const usesPoints = style.kind === 'polygon' || style.kind === 'star';
  const isStroke = style.kind === 'line' || style.kind === 'arrow';

  return (
    <div>
      <Section title="Shape" icon={Shapes}>
        <SegmentedControl
          value={style.kind}
          columns={5}
          onChange={(v) => { set({ kind: v }); commit('Change shape'); }}
          options={SHAPES.map((s) => ({ value: s.value, label: s.label, icon: s.icon }))}
        />

        {style.kind === 'rectangle' && (
          <SliderRow label="Corner radius" min={0} max={300} defaultValue={16}
            value={style.cornerRadius} onChange={(v) => set({ cornerRadius: v })} onCommit={() => commit('Set corner radius')} />
        )}

        {usesPoints && (
          <SliderRow label="Points" min={3} max={24} step={1} defaultValue={5}
            value={style.points} onChange={(v) => set({ points: v })} onCommit={() => commit('Set point count')} />
        )}

        {style.kind === 'star' && (
          <SliderRow label="Inner radius" min={0.05} max={1} step={0.01} precision={2} defaultValue={0.45}
            value={style.innerRatio} onChange={(v) => set({ innerRatio: v })} onCommit={() => commit('Set inner radius')} />
        )}

        {style.kind === 'path' && (
          <div className="space-y-1">
            <span className="text-ui-sm text-spectrum-textMuted">SVG path data (0–100 viewBox)</span>
            <textarea
              value={style.pathData ?? ''}
              onChange={(e) => set({ pathData: e.target.value })}
              onBlur={() => commit('Set path data')}
              rows={3}
              placeholder="M 10 50 C 30 10, 70 10, 90 50"
              className="pro-input w-full px-2 py-1.5 text-micro font-mono resize-y"
            />
          </div>
        )}
      </Section>

      <Section title="Fill & stroke" icon={PaintBucket}>
        {!isStroke && (
          <>
            <ColorField label="Fill" value={style.fill} onChange={(v) => { set({ fill: v }); commit('Set fill'); }} />
            <ToggleRow
              label="Gradient fill"
              checked={Boolean(style.gradient)}
              onChange={(v) =>
                set({ gradient: v ? { from: style.fill, to: '#a78bfa', angle: 45 } : undefined })
              }
            />
            {style.gradient && (
              <>
                <ColorField label="Gradient from" value={style.gradient.from}
                  onChange={(v) => set({ gradient: { ...style.gradient!, from: v } })} />
                <ColorField label="Gradient to" value={style.gradient.to}
                  onChange={(v) => set({ gradient: { ...style.gradient!, to: v } })} />
                <SliderRow label="Gradient angle" min={-180} max={180} unit="°" bipolar defaultValue={45}
                  value={style.gradient.angle} onChange={(v) => set({ gradient: { ...style.gradient!, angle: v } })} />
              </>
            )}
            <div className="hairline" />
          </>
        )}

        <ColorField label={isStroke ? 'Line colour' : 'Stroke'} value={isStroke ? style.fill : style.stroke}
          onChange={(v) => { set(isStroke ? { fill: v } : { stroke: v }); commit('Set stroke'); }} />
        <SliderRow label="Stroke width" min={0} max={80} defaultValue={isStroke ? 6 : 0}
          value={style.strokeWidth} onChange={(v) => set({ strokeWidth: v })} onCommit={() => commit('Set stroke width')} />
      </Section>

      <Section title="Trim path" icon={Scissors} defaultOpen={style.trimStart > 0 || style.trimEnd < 1}>
        <p className="text-micro text-spectrum-textFaint leading-relaxed">
          Animate trim end from 0 → 1 for a “draw on” reveal. Add keyframes from the Keys tab.
        </p>
        <SliderRow label="Trim start" min={0} max={1} step={0.01} precision={2} displayScale={100} unit="%" defaultValue={0}
          value={style.trimStart} onChange={(v) => set({ trimStart: v })} onCommit={() => commit('Set trim start')} />
        <SliderRow label="Trim end" min={0} max={1} step={0.01} precision={2} displayScale={100} unit="%" defaultValue={1}
          value={style.trimEnd} onChange={(v) => set({ trimEnd: v })} onCommit={() => commit('Set trim end')} />
      </Section>

      <Section title="Shadow" icon={PaintBucket} defaultOpen={Boolean(style.shadow)}>
        <ToggleRow
          label="Drop shadow"
          checked={Boolean(style.shadow)}
          onChange={(v) => set({ shadow: v ? { color: '#000000aa', blur: 24, offsetX: 0, offsetY: 10 } : undefined })}
        />
        {style.shadow && (
          <>
            <ColorField label="Shadow colour" value={style.shadow.color}
              onChange={(v) => set({ shadow: { ...style.shadow!, color: v } })} />
            <SliderRow label="Blur" min={0} max={120} defaultValue={24}
              value={style.shadow.blur} onChange={(v) => set({ shadow: { ...style.shadow!, blur: v } })} />
            <SliderRow label="Offset Y" min={-100} max={100} bipolar defaultValue={10}
              value={style.shadow.offsetY} onChange={(v) => set({ shadow: { ...style.shadow!, offsetY: v } })} />
          </>
        )}
      </Section>
    </div>
  );
};
