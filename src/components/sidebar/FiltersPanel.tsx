/* Colour looks — the same grades as the inspector, applied in bulk. */

import React from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { DEFAULT_FILTERS, Clip } from '../../types/edl';
import { Section } from '../ui/Controls';
import {
  Sliders, Layers, Check,
} from '../ui/icons';
import { PanelSearch, matchesQuery } from './PanelSearch';
import { MotionThumb } from '../ui/MotionThumb';
import { lookPreview } from '../../engine/previewRender';

const LOOKS: { id: string; label: string; hint: string; filters: Partial<Clip['filters']> }[] = [
  { id: 'teal_orange', label: 'Teal & Orange', hint: 'Blockbuster standard', filters: { temperature: -14, tint: 10, contrast: 22, saturation: 18, vignette: 28 } },
  { id: 'noir', label: 'Noir', hint: 'High-contrast mono', filters: { saturation: -100, contrast: 34, brightness: -6, vignette: 44 } },
  { id: 'bleach', label: 'Bleach Bypass', hint: 'Desaturated grit', filters: { saturation: -46, contrast: 38, brightness: 8, highlights: 20 } },
  { id: 'warm_film', label: 'Warm Film', hint: 'Golden-hour 35mm', filters: { temperature: 22, saturation: 12, contrast: 12, grain: 18, vignette: 20 } },
  { id: 'cold_night', label: 'Cold Night', hint: 'Moonlit blue', filters: { temperature: -34, tint: -8, brightness: -12, contrast: 20, saturation: -8 } },
  { id: 'vibrant', label: 'Vibrant Pop', hint: 'Social-ready punch', filters: { saturation: 44, contrast: 20, brightness: 6, sharpen: 20 } },
  { id: 'faded', label: 'Faded Retro', hint: 'Lifted blacks', filters: { saturation: -22, contrast: -16, brightness: 12, shadows: 24, grain: 24 } },
  { id: 'cyberpunk', label: 'Cyberpunk', hint: 'Magenta / cyan', filters: { saturation: 38, contrast: 28, temperature: -20, tint: 26, vignette: 36 } },
  { id: 'sepia', label: 'Sepia', hint: 'Archival tone', filters: { saturation: -60, temperature: 40, contrast: 10, grain: 20 } },
  { id: 'infrared', label: 'Infrared', hint: 'Surreal hue shift', filters: { hueRotate: 140, saturation: 50, contrast: 18 } },
];

export const FiltersPanel: React.FC = () => {
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const tracks = useTimelineStore((s) => s.tracks);
  const updateClipFilters = useTimelineStore((s) => s.updateClipFilters);
  const patchClips = useTimelineStore((s) => s.patchClip);
  const commit = useTimelineStore((s) => s.commit);
  const pushToast = useUiStore((s) => s.pushToast);

  const [query, setQuery] = React.useState('');
  const shown = React.useMemo(
    () => LOOKS.filter((l) => matchesQuery(query, l.label, l.hint, l.id)),
    [query]
  );

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

      <div className="p-2 pb-0 flex-shrink-0">
        <PanelSearch
          value={query}
          onChange={setQuery}
          noun="looks"
          countLabel={`${shown.length}/${LOOKS.length}`}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {shown.length === 0 && (
          <p className="text-[10px] text-spectrum-textFaint text-center py-4">Nothing matches “{query}”.</p>
        )}
        {shown.map((look) => (
          <div key={look.id} className="card-interactive p-2 flex items-center gap-2.5 group">
            {/* The grade itself, rendered by the compositor over a
                full-range scene. This was a hand-authored CSS gradient:
                three colours somebody guessed would suggest the result,
                free to drift away from the actual filter values for
                ever without anything noticing. */}
            <MotionThumb
              load={() => lookPreview(look.id, look.filters)}
              label={`${look.label} preview`}
              className="w-[58px] aspect-video rounded-[5px] flex-shrink-0"
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
