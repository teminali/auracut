/* Colour looks — the same grades as the inspector, applied in bulk. */

import React from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { DEFAULT_FILTERS, Clip } from '../../types/edl';
import { Section } from '../ui/Controls';
import { Sliders, Layers, Check } from 'lucide-react';

const LOOKS: { id: string; label: string; swatch: string; hint: string; filters: Partial<Clip['filters']> }[] = [
  { id: 'teal_orange', label: 'Teal & Orange', hint: 'Blockbuster standard', swatch: 'linear-gradient(135deg,#0b3d4d 0%,#1c6b7a 45%,#ff9a4d 100%)', filters: { temperature: -14, tint: 10, contrast: 22, saturation: 18, vignette: 28 } },
  { id: 'noir', label: 'Noir', hint: 'High-contrast mono', swatch: 'linear-gradient(135deg,#0a0a0a,#8a8a8a,#e8e8e8)', filters: { saturation: -100, contrast: 34, brightness: -6, vignette: 44 } },
  { id: 'bleach', label: 'Bleach Bypass', hint: 'Desaturated grit', swatch: 'linear-gradient(135deg,#6e747c,#b9bec4,#e8e2d6)', filters: { saturation: -46, contrast: 38, brightness: 8, highlights: 20 } },
  { id: 'warm_film', label: 'Warm Film', hint: 'Golden-hour 35mm', swatch: 'linear-gradient(135deg,#3d2415,#a9713c,#f0c98a)', filters: { temperature: 22, saturation: 12, contrast: 12, grain: 18, vignette: 20 } },
  { id: 'cold_night', label: 'Cold Night', hint: 'Moonlit blue', swatch: 'linear-gradient(135deg,#070d1f,#1b3a6b,#4c9dff)', filters: { temperature: -34, tint: -8, brightness: -12, contrast: 20, saturation: -8 } },
  { id: 'vibrant', label: 'Vibrant Pop', hint: 'Social-ready punch', swatch: 'linear-gradient(135deg,#ff2d78,#ff8a3d,#f5d524)', filters: { saturation: 44, contrast: 20, brightness: 6, sharpen: 20 } },
  { id: 'faded', label: 'Faded Retro', hint: 'Lifted blacks', swatch: 'linear-gradient(135deg,#7a6b60,#b4a496,#d9c9b8)', filters: { saturation: -22, contrast: -16, brightness: 12, shadows: 24, grain: 24 } },
  { id: 'cyberpunk', label: 'Cyberpunk', hint: 'Magenta / cyan', swatch: 'linear-gradient(135deg,#12002e,#8a2be2,#00e5ff)', filters: { saturation: 38, contrast: 28, temperature: -20, tint: 26, vignette: 36 } },
  { id: 'sepia', label: 'Sepia', hint: 'Archival tone', swatch: 'linear-gradient(135deg,#3a2a18,#8a6a42,#d8c09a)', filters: { saturation: -60, temperature: 40, contrast: 10, grain: 20 } },
  { id: 'infrared', label: 'Infrared', hint: 'Surreal hue shift', swatch: 'linear-gradient(135deg,#2a003a,#ff2d78,#ffd0e0)', filters: { hueRotate: 140, saturation: 50, contrast: 18 } },
];

export const FiltersPanel: React.FC = () => {
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const tracks = useTimelineStore((s) => s.tracks);
  const updateClipFilters = useTimelineStore((s) => s.updateClipFilters);
  const patchClips = useTimelineStore((s) => s.patchClip);
  const commit = useTimelineStore((s) => s.commit);
  const pushToast = useUiStore((s) => s.pushToast);

  const apply = (look: typeof LOOKS[number], toAll: boolean) => {
    const targets = toAll
      ? tracks.flatMap((t) => t.clips.filter((c) => c.type === 'video' || c.type === 'image').map((c) => c.id))
      : selectedClipIds;

    if (targets.length === 0) {
      pushToast({ kind: 'error', title: 'Select a clip first' });
      return;
    }

    for (const id of targets) updateClipFilters(id, { ...DEFAULT_FILTERS, ...look.filters });
    commit(`Apply ${look.label}`);
    pushToast({
      kind: 'success',
      title: `${look.label} applied`,
      detail: `${targets.length} clip${targets.length === 1 ? '' : 's'}`,
    });
  };

  return (
    <div className="w-full h-full bg-spectrum-panel border-r border-line flex flex-col overflow-hidden">
      <div className="panel-header">
        <span className="panel-title">Colour Looks</span>
        {selectedClipIds.length > 0 && (
          <span className="chip !text-spectrum-accent !border-spectrum-accentLine">
            <Layers className="w-2.5 h-2.5" />
            {selectedClipIds.length}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {LOOKS.map((look) => (
          <div key={look.id} className="card-interactive p-2 flex items-center gap-2.5 group">
            <span
              className="w-11 h-11 rounded-squircle-xs border border-line flex-shrink-0"
              style={{ background: look.swatch }}
            />
            <span className="flex-1 min-w-0">
              <span className="block text-[11px] font-medium text-spectrum-text truncate">{look.label}</span>
              <span className="block text-[9px] text-spectrum-textFaint truncate">{look.hint}</span>
            </span>
            <span className="flex flex-col gap-0.5 flex-shrink-0">
              <button
                onClick={() => apply(look, false)}
                className="pro-btn-filled h-5 px-1.5 text-[9px]"
                title="Apply to the selected clips"
              >
                Selected
              </button>
              <button
                onClick={() => apply(look, true)}
                className="pro-btn h-5 px-1.5 text-[9px]"
                title="Apply to every video clip in the sequence"
              >
                All clips
              </button>
            </span>
          </div>
        ))}

        <button
          onClick={() => {
            for (const id of selectedClipIds) updateClipFilters(id, DEFAULT_FILTERS);
            commit('Reset grade');
          }}
          disabled={selectedClipIds.length === 0}
          className="pro-btn-filled w-full h-7 gap-1.5 text-[11px] mt-1"
        >
          <Sliders className="w-3 h-3" /> Reset grade on selection
        </button>
      </div>
    </div>
  );
};
