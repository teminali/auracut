import React from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { Clip, DEFAULT_FILTERS } from '../../types/edl';
import { Section, SliderRow, SegmentedControl } from '../ui/Controls';
import { Sun, Palette, Contrast, Sparkle, RotateCcw, Copy } from '../ui/icons';

/** One-click grades. Each is just a set of filter values. */
const LOOKS: { id: string; label: string; swatch: string; filters: Partial<Clip['filters']> }[] = [
  { id: 'none', label: 'None', swatch: 'linear-gradient(135deg,#333,#666)', filters: {} },
  { id: 'teal_orange', label: 'Teal & Orange', swatch: 'linear-gradient(135deg,#0b3d4d,#ff9a4d)', filters: { temperature: -14, tint: 10, contrast: 22, saturation: 18, vignette: 28 } },
  { id: 'noir', label: 'Noir', swatch: 'linear-gradient(135deg,#111,#ddd)', filters: { saturation: -100, contrast: 34, brightness: -6, vignette: 44 } },
  { id: 'bleach', label: 'Bleach Bypass', swatch: 'linear-gradient(135deg,#8a9099,#e8e2d6)', filters: { saturation: -46, contrast: 38, brightness: 8, highlights: 20 } },
  { id: 'warm_film', label: 'Warm Film', swatch: 'linear-gradient(135deg,#4a2f1c,#f0c98a)', filters: { temperature: 22, saturation: 12, contrast: 12, grain: 18, vignette: 20 } },
  { id: 'cold_night', label: 'Cold Night', swatch: 'linear-gradient(135deg,#0d1b3a,#4c9dff)', filters: { temperature: -34, tint: -8, brightness: -12, contrast: 20, saturation: -8 } },
  { id: 'vibrant', label: 'Vibrant Pop', swatch: 'linear-gradient(135deg,#ff2d78,#f5d524)', filters: { saturation: 44, contrast: 20, brightness: 6, sharpen: 20 } },
  { id: 'faded', label: 'Faded Retro', swatch: 'linear-gradient(135deg,#8f7f74,#d9c9b8)', filters: { saturation: -22, contrast: -16, brightness: 12, shadows: 24, grain: 24 } },
];

export const ColorInspector: React.FC<{ clip: Clip }> = ({ clip }) => {
  const updateClipFilters = useTimelineStore((s) => s.updateClipFilters);
  const updateClipChromaKey = useTimelineStore((s) => s.updateClipChromaKey);
  const commit = useTimelineStore((s) => s.commit);
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const patchClip = useTimelineStore((s) => s.patchClip);

  const f = clip.filters;
  const set = (patch: Partial<Clip['filters']>) => updateClipFilters(clip.id, patch);
  const done = (label: string) => commit(label);

  const applyLook = (look: typeof LOOKS[number]) => {
    updateClipFilters(clip.id, { ...DEFAULT_FILTERS, ...look.filters });
    commit(`Apply ${look.label}`);
  };

  const copyToSelection = () => {
    for (const id of selectedClipIds) {
      if (id === clip.id) continue;
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(f)) patch[`filters.${k}`] = v;
      patchClip(id, patch);
    }
  };

  return (
    <div>
      <Section title="Looks" icon={Sparkle}>
        <div className="grid grid-cols-4 gap-1.5">
          {LOOKS.map((look) => (
            <button
              key={look.id}
              onClick={() => applyLook(look)}
              className="group flex flex-col items-center gap-1"
              title={look.label}
            
            aria-label={look.label}>
              <span
                className="w-full h-9 rounded-squircle-xs border border-line group-hover:border-spectrum-accent transition-colors"
                style={{ background: look.swatch }}
              />
              <span className="text-micro text-spectrum-textDim group-hover:text-spectrum-text truncate w-full text-center leading-tight">
                {look.label}
              </span>
            </button>
          ))}
        </div>
        {selectedClipIds.length > 1 && (
          <button onClick={copyToSelection} className="pro-btn-filled w-full h-7 gap-1.5 text-ui-sm">
            <Copy className="w-3 h-3" />
            Apply this grade to all {selectedClipIds.length} selected
          </button>
        )}
      </Section>

      <Section
        title="Light"
        icon={Sun}
        action={
          <button
            onClick={() => { set({ brightness: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0 }); done('Reset light'); }}
            className="pro-btn w-5 h-5"
            title="Reset light"
          
            aria-label="Reset light">
            <RotateCcw className="w-3 h-3" />
          </button>
        }
      >
        <SliderRow label="Exposure" min={-100} max={100} bipolar defaultValue={0}
          value={f.exposure} onChange={(v) => set({ exposure: v })} onCommit={() => done('Set exposure')} />
        <SliderRow label="Brightness" min={-100} max={100} bipolar defaultValue={0}
          value={f.brightness} onChange={(v) => set({ brightness: v })} onCommit={() => done('Set brightness')} />
        <SliderRow label="Contrast" min={-100} max={100} bipolar defaultValue={0}
          value={f.contrast} onChange={(v) => set({ contrast: v })} onCommit={() => done('Set contrast')} />
        <SliderRow label="Highlights" min={-100} max={100} bipolar defaultValue={0}
          value={f.highlights} onChange={(v) => set({ highlights: v })} onCommit={() => done('Set highlights')} />
        <SliderRow label="Shadows" min={-100} max={100} bipolar defaultValue={0}
          value={f.shadows} onChange={(v) => set({ shadows: v })} onCommit={() => done('Set shadows')} />
      </Section>

      <Section title="Colour" icon={Palette}>
        <SliderRow label="Saturation" min={-100} max={200} bipolar defaultValue={0}
          value={f.saturation} onChange={(v) => set({ saturation: v })} onCommit={() => done('Set saturation')} />
        <SliderRow label="Temperature" min={-100} max={100} bipolar defaultValue={0}
          value={f.temperature} onChange={(v) => set({ temperature: v })} onCommit={() => done('Set temperature')} />
        <SliderRow label="Tint" min={-100} max={100} bipolar defaultValue={0}
          value={f.tint} onChange={(v) => set({ tint: v })} onCommit={() => done('Set tint')} />
        <SliderRow label="Hue rotate" min={-180} max={180} unit="°" bipolar defaultValue={0}
          value={f.hueRotate} onChange={(v) => set({ hueRotate: v })} onCommit={() => done('Set hue')} />
      </Section>

      <Section title="Detail & texture" icon={Contrast}>
        <SliderRow label="Sharpen" min={0} max={100} defaultValue={0}
          value={f.sharpen} onChange={(v) => set({ sharpen: v })} onCommit={() => done('Set sharpen')} />
        <SliderRow label="Blur" min={0} max={100} unit="px" defaultValue={0}
          value={f.blur} onChange={(v) => set({ blur: v })} onCommit={() => done('Set blur')} />
        <SliderRow label="Grain" min={0} max={100} defaultValue={0}
          value={f.grain} onChange={(v) => set({ grain: v })} onCommit={() => done('Set grain')} />
        <SliderRow label="Vignette" min={0} max={100} defaultValue={0}
          value={f.vignette} onChange={(v) => set({ vignette: v })} onCommit={() => done('Set vignette')} />
      </Section>

      <Section title="Chroma key" icon={Sparkle} defaultOpen={clip.chromaKey.enabled}
        action={
          <input
            type="checkbox"
            checked={clip.chromaKey.enabled}
            onChange={(e) => updateClipChromaKey(clip.id, { enabled: e.target.checked })}
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        {clip.chromaKey.enabled ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-ui-sm text-spectrum-textMuted">Key colour</span>
              <div className="flex items-center gap-1">
                {['#00ff00', '#0000ff', '#ffffff'].map((c) => (
                  <button
                    key={c}
                    onClick={() => updateClipChromaKey(clip.id, { targetColorHex: c })}
                    className={`w-5 h-5 rounded-squircle-xs border-2 transition-colors ${
                      clip.chromaKey.targetColorHex === c ? 'border-spectrum-accent' : 'border-line'
                    }`}
                    style={{ background: c }}
                  />
                ))}
                <label className="w-5 h-5 rounded-squircle-xs border border-line-strong cursor-pointer overflow-hidden">
                  <span className="block w-full h-full" style={{ background: clip.chromaKey.targetColorHex }}>
                    <input
                      type="color"
                      value={clip.chromaKey.targetColorHex}
                      onChange={(e) => updateClipChromaKey(clip.id, { targetColorHex: e.target.value })}
                      className="opacity-0 w-full h-full cursor-pointer"
                    />
                  </span>
                </label>
              </div>
            </div>
            <SliderRow label="Similarity" min={0} max={100} defaultValue={40}
              value={clip.chromaKey.similarity} onChange={(v) => updateClipChromaKey(clip.id, { similarity: v })} />
            <SliderRow label="Smoothness" min={0} max={100} defaultValue={10}
              value={clip.chromaKey.smoothness} onChange={(v) => updateClipChromaKey(clip.id, { smoothness: v })} />
            <SliderRow label="Spill suppression" min={0} max={100} defaultValue={10}
              value={clip.chromaKey.spill} onChange={(v) => updateClipChromaKey(clip.id, { spill: v })} />
          </>
        ) : (
          <p className="text-micro text-spectrum-textFaint">
            Enable to remove a green or blue screen background.
          </p>
        )}
      </Section>
    </div>
  );
};
