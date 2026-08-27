/* Titles, shapes and graphic layers. */

import React from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { ShapeKind, ClipTextStyle } from '../../types/edl';
import { Section } from '../ui/Controls';
import {
  Type, Plus, Square, Circle, Triangle, Star, Minus, MoveRight, Heart, Hexagon, Spline, Layers,
} from '../ui/icons';
import { PanelSearch, matchesQuery } from './PanelSearch';
import { MotionThumb } from '../ui/MotionThumb';
import { textPreview } from '../../engine/previewRender';

/* Typed rather than inferred, so `kineticAnimation` stays a
   KineticAnimation and not a widened `string`. */
const TITLE_PRESETS: {
  id: string; label: string; text: string;
  style: Partial<ClipTextStyle>;
}[] = [
  { id: 'headline', label: 'Bold Headline', text: 'YOUR HEADLINE', style: { fontSize: 108, fontWeight: 900, uppercase: true, strokeWidth: 10, kineticAnimation: 'pop_in' } },
  { id: 'lower_third', label: 'Lower Third', text: 'Name Surname\nRole · Company', style: { fontSize: 46, fontWeight: 600, align: 'left', strokeWidth: 0, background: '#0a0b0ecc', backgroundPadding: 20, kineticAnimation: 'fade_slide' } },
  { id: 'subtitle', label: 'Subtitle', text: 'Supporting line of copy', style: { fontSize: 44, fontWeight: 500, strokeWidth: 4, kineticAnimation: 'fade_slide' } },
  { id: 'callout', label: 'Callout Chip', text: 'NEW', style: { fontSize: 40, fontWeight: 800, color: '#0a0b0e', background: '#f5d524', backgroundPadding: 16, backgroundRadius: 999, strokeWidth: 0, kineticAnimation: 'bounce' } },
  { id: 'typewriter', label: 'Typewriter', text: 'Typed one letter at a time…', style: { fontSize: 52, fontFamily: 'JetBrains Mono', fontWeight: 500, strokeWidth: 0, kineticAnimation: 'typewriter' } },
  { id: 'credit', label: 'End Credit', text: 'Directed by\nYOUR NAME', style: { fontSize: 56, fontWeight: 300, letterSpacing: 8, strokeWidth: 0, kineticAnimation: 'fade_slide' } },
];

const SHAPES: { kind: ShapeKind; label: string; icon: React.ElementType }[] = [
  { kind: 'rectangle', label: 'Rectangle', icon: Square },
  { kind: 'ellipse', label: 'Ellipse', icon: Circle },
  { kind: 'triangle', label: 'Triangle', icon: Triangle },
  { kind: 'polygon', label: 'Polygon', icon: Hexagon },
  { kind: 'star', label: 'Star', icon: Star },
  { kind: 'line', label: 'Line', icon: Minus },
  { kind: 'arrow', label: 'Arrow', icon: MoveRight },
  { kind: 'heart', label: 'Heart', icon: Heart },
  { kind: 'blob', label: 'Blob', icon: Spline },
];

export const TextPanel: React.FC = () => {
  const addTextLayer = useTimelineStore((s) => s.addTextLayer);
  const addShapeLayer = useTimelineStore((s) => s.addShapeLayer);
  const addAdjustmentLayer = useTimelineStore((s) => s.addAdjustmentLayer);
  const patchClip = useTimelineStore((s) => s.patchClip);
  const playheadMs = useTimelineStore((s) => s.playheadMs);
  const selectedTrackId = useTimelineStore((s) => s.selectedTrackId);
  const tracks = useTimelineStore((s) => s.tracks);

  const textTrackId = tracks.find((t) => t.type === 'text')?.id ?? tracks[0]?.id ?? '';
  const overlayTrackId = tracks.find((t) => t.type === 'overlay')?.id ?? selectedTrackId ?? tracks[0]?.id ?? '';

  const addTitle = (preset: typeof TITLE_PRESETS[number]) => {
    const id = addTextLayer(textTrackId, preset.text, playheadMs, 4000);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(preset.style)) patch[`textStyle.${k}`] = v;
    // Lower thirds sit low-left rather than centred.
    if (preset.id === 'lower_third') { patch['transform.x'] = -420; patch['transform.y'] = 320; }
    patchClip(id, patch);
  };

  const [query, setQuery] = React.useState('');
  const titles = React.useMemo(
    () => TITLE_PRESETS.filter((p) => matchesQuery(query, p.label, p.text, p.id)),
    [query]
  );
  const shapes = React.useMemo(
    () => SHAPES.filter((sh) => matchesQuery(query, sh.label, sh.kind)),
    [query]
  );

  return (
    <div className="w-full h-full bg-spectrum-panel border-r border-line flex flex-col overflow-hidden">
      <div className="panel-header">
        <span className="panel-title">Titles & Graphics</span>
      </div>

      <div className="p-2 pb-0 flex-shrink-0">
        <PanelSearch
          value={query}
          onChange={setQuery}
          noun="titles & shapes"
          countLabel={`${titles.length + shapes.length}/${TITLE_PRESETS.length + SHAPES.length}`}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {titles.length === 0 && shapes.length === 0 && (
          <p className="text-micro text-spectrum-textFaint text-center py-5">Nothing matches “{query}”.</p>
        )}
        {titles.length > 0 && (
        <Section title="Titles" icon={Type}>
          <div className="space-y-1.5">
            {titles.map((preset) => (
              <button
                key={preset.id}
                onClick={() => addTitle(preset)}
                className="card-interactive w-full p-2 flex items-center gap-2.5 group text-left"
              >
                {/* Each preset carries a kinetic animation. Showing it
                    is the difference between picking a title by name
                    and picking one by what it does. */}
                <MotionThumb
                  load={() => textPreview(preset.style.kineticAnimation ?? 'none', preset.label)}
                  label={`${preset.label} preview`}
                  restAt={0.5}
                  className="w-[52px] aspect-video rounded-[4px] flex-shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-ui-sm font-medium text-spectrum-text truncate group-hover:text-spectrum-accent transition-colors">
                    {preset.label}
                  </span>
                  <span className="block text-micro text-spectrum-textFaint truncate">
                    {preset.text.split('\n')[0]}
                  </span>
                </span>
                <span className="w-5 h-5 rounded-full bg-spectrum-panel group-hover:bg-spectrum-accent text-spectrum-textDim group-hover:text-[#2a1806] flex items-center justify-center transition-colors flex-shrink-0">
                  <Plus className="w-3 h-3" />
                </span>
              </button>
            ))}
          </div>
        </Section>
        )}

        {shapes.length > 0 && (
        <Section title="Shapes" icon={Square}>
          <div className="grid grid-cols-3 gap-1.5">
            {shapes.map((shape) => {
              const Icon = shape.icon;
              return (
                <button
                  key={shape.kind}
                  onClick={() => addShapeLayer(overlayTrackId, shape.kind, playheadMs)}
                  className="card-interactive h-14 flex flex-col items-center justify-center gap-1 group"
                  title={`Add ${shape.label}`}
                
            aria-label={`Add ${shape.label}`}>
                  <Icon className="w-4 h-4 text-spectrum-textDim group-hover:text-spectrum-accent transition-colors" />
                  <span className="text-micro text-spectrum-textFaint group-hover:text-spectrum-textMuted">
                    {shape.label}
                  </span>
                </button>
              );
            })}
          </div>
        </Section>
        )}

        {/* Utility layers are not assets to browse, so a search never hides them. */}
        <Section title="Utility layers" icon={Layers}>
          <button
            onClick={() => addAdjustmentLayer(overlayTrackId, playheadMs)}
            className="card-interactive w-full p-2 flex items-center justify-between gap-2 group text-left"
          >
            <span className="min-w-0">
              <span className="block text-ui-sm font-medium text-spectrum-text group-hover:text-spectrum-accent transition-colors">
                Adjustment layer
              </span>
              <span className="block text-micro text-spectrum-textFaint">
                Grades every layer beneath it
              </span>
            </span>
            <Plus className="w-3.5 h-3.5 text-spectrum-textDim group-hover:text-spectrum-accent flex-shrink-0 transition-colors" />
          </button>
        </Section>
      </div>
    </div>
  );
};
