import React from 'react';
import { loadFonts, loadedFonts, FontOption } from '../../engine/systemFonts';
import { useTimelineStore } from '../../store/timelineStore';
import { Clip, KineticAnimation } from '../../types/edl';
import { Section, SliderRow, ColorField, ToggleRow, SegmentedControl, NumberField } from '../ui/Controls';
import {
  Type, Sparkle, PaintBucket, AlignLeft, AlignCenter, AlignRight, Bold, Italic, CaseUpper,
} from 'lucide-react';

/*
  The font list used to be these nine names, hardcoded and identical on
  every machine — so a Mac with hundreds of families could use nine, and
  several of the nine are Windows fonts a Mac does not have, which fell
  back to the default with no indication. Now measured per machine.
*/

const ANIMATIONS: { value: KineticAnimation; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'pop_in', label: 'Pop In' },
  { value: 'kinetic_stack', label: 'Word Stack' },
  { value: 'typewriter', label: 'Typewriter' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'karaoke_highlight', label: 'Karaoke' },
  { value: 'fade_slide', label: 'Fade Slide' },
  { value: 'glitch_pop', label: 'Glitch' },
];

/** Ready-made title looks. */
const TEXT_PRESETS = [
  { id: 'clean', label: 'Clean', style: { color: '#ffffff', strokeWidth: 0, shadowBlur: 12, fontWeight: 600, background: undefined } },
  { id: 'viral', label: 'Viral Bold', style: { color: '#ffffff', strokeColor: '#000000', strokeWidth: 10, fontWeight: 900, uppercase: true, shadowBlur: 24 } },
  { id: 'boxed', label: 'Boxed', style: { color: '#0a0b0e', background: '#f5d524', strokeWidth: 0, backgroundPadding: 22, backgroundRadius: 8, fontWeight: 800 } },
  { id: 'neon', label: 'Neon', style: { color: '#4cf0ff', strokeColor: '#0a3d4d', strokeWidth: 4, shadowColor: '#4cf0ff', shadowBlur: 40, fontWeight: 800 } },
  { id: 'elegant', label: 'Elegant', style: { color: '#f6f1e7', fontFamily: 'Georgia', italic: true, strokeWidth: 0, letterSpacing: 4, fontWeight: 400 } },
  { id: 'impact', label: 'Impact', style: { color: '#ffffff', fontFamily: 'Impact', strokeColor: '#ff2d78', strokeWidth: 6, uppercase: true, fontWeight: 900 } },
];

export const TextInspector: React.FC<{ clip: Clip }> = ({ clip }) => {
  const updateClipText = useTimelineStore((s) => s.updateClipText);
  const commit = useTimelineStore((s) => s.commit);

  /* Enumerating the system list is async, so render what is known and
     fill in the rest — a picker that appears empty reads as broken. */
  const [fonts, setFonts] = React.useState<FontOption[]>(() => loadedFonts());
  React.useEffect(() => {
    let live = true;
    void loadFonts().then((all) => { if (live) setFonts(all); });
    return () => { live = false; };
  }, []);

  const style = clip.textStyle;
  if (!style) return null;

  const set = (patch: Partial<typeof style>) => updateClipText(clip.id, patch);

  return (
    <div>
      <Section title="Content" icon={Type}>
        <textarea
          value={style.text}
          onChange={(e) => set({ text: e.target.value })}
          onBlur={() => commit('Edit text')}
          rows={3}
          placeholder="Type your text…"
          className="pro-input w-full px-2 py-1.5 text-[12px] resize-y leading-snug"
        />

        <div className="grid grid-cols-3 gap-1">
          <button
            onClick={() => { set({ fontWeight: style.fontWeight >= 700 ? 400 : 800 }); commit('Toggle bold'); }}
            className={`h-7 rounded-squircle-xs border text-[10px] flex items-center justify-center gap-1 transition-colors ${
              style.fontWeight >= 700 ? 'bg-spectrum-accentSoft border-spectrum-accentLine text-spectrum-accent' : 'bg-spectrum-card border-line text-spectrum-textDim'
            }`}
          >
            <Bold className="w-3 h-3" /> Bold
          </button>
          <button
            onClick={() => { set({ italic: !style.italic }); commit('Toggle italic'); }}
            className={`h-7 rounded-squircle-xs border text-[10px] flex items-center justify-center gap-1 transition-colors ${
              style.italic ? 'bg-spectrum-accentSoft border-spectrum-accentLine text-spectrum-accent' : 'bg-spectrum-card border-line text-spectrum-textDim'
            }`}
          >
            <Italic className="w-3 h-3" /> Italic
          </button>
          <button
            onClick={() => { set({ uppercase: !style.uppercase }); commit('Toggle caps'); }}
            className={`h-7 rounded-squircle-xs border text-[10px] flex items-center justify-center gap-1 transition-colors ${
              style.uppercase ? 'bg-spectrum-accentSoft border-spectrum-accentLine text-spectrum-accent' : 'bg-spectrum-card border-line text-spectrum-textDim'
            }`}
          >
            <CaseUpper className="w-3 h-3" /> Caps
          </button>
        </div>

        <div className="space-y-1">
          <span className="text-[11px] text-spectrum-textMuted">Font</span>
          <select
            value={style.fontFamily}
            onChange={(e) => { set({ fontFamily: e.target.value }); commit('Set font'); }}
            className="pro-input w-full h-7 px-2 text-[11px] cursor-pointer"
          >
            {fonts.map((f) => (
              <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>
                {f.family}
              </option>
            ))}
          </select>
        </div>

        <SegmentedControl
          value={style.align}
          onChange={(v) => { set({ align: v }); commit('Set alignment'); }}
          options={[
            { value: 'left', label: 'Left', icon: AlignLeft },
            { value: 'center', label: 'Centre', icon: AlignCenter },
            { value: 'right', label: 'Right', icon: AlignRight },
          ]}
        />
      </Section>

      <Section title="Presets" icon={Sparkle}>
        <div className="grid grid-cols-3 gap-1.5">
          {TEXT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => { set(preset.style as any); commit(`Apply ${preset.label}`); }}
              className="card-interactive h-11 flex items-center justify-center px-1"
            >
              <span
                className="text-[11px] truncate"
                style={{
                  color: preset.style.color,
                  fontFamily: (preset.style as any).fontFamily ?? 'Inter',
                  fontWeight: preset.style.fontWeight,
                  fontStyle: (preset.style as any).italic ? 'italic' : 'normal',
                  textShadow: (preset.style as any).shadowColor
                    ? `0 0 8px ${(preset.style as any).shadowColor}`
                    : undefined,
                  background: (preset.style as any).background,
                  padding: (preset.style as any).background ? '2px 5px' : undefined,
                  borderRadius: 4,
                  WebkitTextStroke: preset.style.strokeWidth
                    ? `0.6px ${(preset.style as any).strokeColor ?? '#000'}`
                    : undefined,
                }}
              >
                {preset.label}
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Typography" icon={Type}>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Size" unit="px" min={6} max={500} value={style.fontSize}
            onChange={(v) => set({ fontSize: v })} onCommit={() => commit('Set font size')} />
          <NumberField label="Weight" min={100} max={900} step={100} value={style.fontWeight}
            onChange={(v) => set({ fontWeight: v })} onCommit={() => commit('Set weight')} />
        </div>
        <SliderRow label="Letter spacing" min={-20} max={120} bipolar defaultValue={0}
          value={style.letterSpacing} onChange={(v) => set({ letterSpacing: v })} onCommit={() => commit('Set tracking')} />
        <SliderRow label="Line height" min={0.6} max={3} step={0.05} precision={2} defaultValue={1.15}
          value={style.lineHeight} onChange={(v) => set({ lineHeight: v })} onCommit={() => commit('Set leading')} />
      </Section>

      <Section title="Fill, stroke & shadow" icon={PaintBucket}>
        <ColorField label="Text colour" value={style.color} onChange={(v) => { set({ color: v }); commit('Set text colour'); }} />
        <ColorField label="Highlight colour" value={style.highlightColor ?? '#4c9dff'}
          onChange={(v) => { set({ highlightColor: v }); commit('Set highlight'); }} />

        <div className="hairline" />

        <ColorField label="Stroke colour" value={style.strokeColor ?? '#000000'}
          onChange={(v) => { set({ strokeColor: v }); commit('Set stroke colour'); }} />
        <SliderRow label="Stroke width" min={0} max={40} defaultValue={6}
          value={style.strokeWidth} onChange={(v) => set({ strokeWidth: v })} onCommit={() => commit('Set stroke')} />

        <div className="hairline" />

        <ColorField label="Shadow colour" value={style.shadowColor ?? '#000000'}
          onChange={(v) => { set({ shadowColor: v }); commit('Set shadow colour'); }} />
        <SliderRow label="Shadow blur" min={0} max={120} defaultValue={18}
          value={style.shadowBlur} onChange={(v) => set({ shadowBlur: v })} onCommit={() => commit('Set shadow blur')} />
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="dX" unit="px" min={-100} max={100} value={style.shadowOffsetX}
            onChange={(v) => set({ shadowOffsetX: v })} onCommit={() => commit('Set shadow offset')} />
          <NumberField label="dY" unit="px" min={-100} max={100} value={style.shadowOffsetY}
            onChange={(v) => set({ shadowOffsetY: v })} onCommit={() => commit('Set shadow offset')} />
        </div>
      </Section>

      <Section title="Background plate" icon={PaintBucket} defaultOpen={Boolean(style.background)}>
        <ToggleRow
          label="Show background"
          checked={Boolean(style.background)}
          onChange={(v) => { set({ background: v ? '#000000cc' : undefined }); commit('Toggle text background'); }}
        />
        {style.background && (
          <>
            <ColorField label="Plate colour" value={style.background} onChange={(v) => { set({ background: v }); commit('Set plate colour'); }} />
            <SliderRow label="Padding" min={0} max={120} defaultValue={18}
              value={style.backgroundPadding} onChange={(v) => set({ backgroundPadding: v })} onCommit={() => commit('Set padding')} />
            <SliderRow label="Corner radius" min={0} max={80} defaultValue={10}
              value={style.backgroundRadius} onChange={(v) => set({ backgroundRadius: v })} onCommit={() => commit('Set radius')} />
          </>
        )}
      </Section>

      <Section title="Animation" icon={Sparkle}>
        <SegmentedControl
          value={style.kineticAnimation}
          columns={2}
          onChange={(v) => { set({ kineticAnimation: v }); commit('Set text animation'); }}
          options={ANIMATIONS.map((a) => ({ value: a.value, label: a.label }))}
        />
      </Section>
    </div>
  );
};
