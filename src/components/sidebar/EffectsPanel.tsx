/* VFX library browser — click or drag an effect onto the selected layer. */

import React, { useMemo, useState } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { EFFECT_REGISTRY, EFFECT_CATEGORIES } from '../../engine/effectsRegistry';
import {
  Search, Sparkle, Plus, Layers,
} from 'lucide-react';

export const EffectsPanel: React.FC = () => {
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const addEffect = useTimelineStore((s) => s.addEffect);
  const pushToast = useUiStore((s) => s.pushToast);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return EFFECT_REGISTRY.filter((e) => {
      if (category !== 'all' && e.category !== category) return false;
      if (!needle) return true;
      return (
        e.label.toLowerCase().includes(needle) ||
        e.type.includes(needle) ||
        e.description.toLowerCase().includes(needle)
      );
    });
  }, [query, category]);

  const apply = (type: string) => {
    if (selectedClipIds.length === 0) {
      pushToast({ kind: 'error', title: 'Select a layer first', detail: 'Effects are applied to the selected clip.' });
      return;
    }
    for (const id of selectedClipIds) addEffect(id, type);
    const def = EFFECT_REGISTRY.find((e) => e.type === type);
    pushToast({
      kind: 'success',
      title: `${def?.label} applied`,
      detail: selectedClipIds.length > 1 ? `Added to ${selectedClipIds.length} layers` : def?.description,
    });
  };

  return (
    <div className="w-full h-full bg-spectrum-panel border-r border-line flex flex-col overflow-hidden">
      <div className="panel-header">
        <span className="panel-title">VFX Library · {EFFECT_REGISTRY.length}</span>
        {selectedClipIds.length > 1 && (
          <span className="chip !text-spectrum-accent !border-spectrum-accentLine">
            <Layers className="w-2.5 h-2.5" />
            {selectedClipIds.length} selected
          </span>
        )}
      </div>

      <div className="p-2 border-b border-line space-y-2 flex-shrink-0">
        <div className="pro-input flex items-center gap-1.5 px-2 h-7">
          <Search className="w-3 h-3 text-spectrum-textDim flex-shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search effects…"
            className="flex-1 bg-transparent outline-none text-[11px] text-spectrum-text placeholder:text-spectrum-textFaint min-w-0"
          />
        </div>

        <div className="flex flex-wrap gap-1">
          <button onClick={() => setCategory('all')} className={`seg-item ${category === 'all' ? 'seg-item-active' : ''}`}>
            All
          </button>
          {EFFECT_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`seg-item ${category === cat.id ? 'seg-item-active' : ''}`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {results.length === 0 ? (
          <p className="text-[11px] text-spectrum-textDim text-center py-6">
            Nothing matches “{query}”.
          </p>
        ) : (
          results.map((effect) => (
            <button
              key={effect.type}
              onClick={() => apply(effect.type)}
              className="card-interactive w-full p-2 flex items-start gap-2.5 text-left group"
              title={`Add ${effect.label}`}
            >
              <span className="text-[18px] leading-none mt-0.5 flex-shrink-0">{effect.glyph}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-spectrum-text truncate group-hover:text-spectrum-accent transition-colors">
                    {effect.label}
                  </span>
                  <Plus className="w-3 h-3 text-spectrum-textFaint group-hover:text-spectrum-accent flex-shrink-0 transition-colors" />
                </span>
                <span className="block text-[10px] text-spectrum-textDim leading-snug mt-0.5">
                  {effect.description}
                </span>
              </span>
            </button>
          ))
        )}
      </div>

      {selectedClipIds.length === 0 && (
        <div className="p-2 border-t border-line flex-shrink-0">
          <p className="text-[10px] text-spectrum-textFaint text-center">
            Select a layer to apply effects to it.
          </p>
        </div>
      )}
    </div>
  );
};
