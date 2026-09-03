/* ═══════════════════════════════════════════════════════════════════
   Effect stack — add, order, tune and keyframe VFX on a layer.

   The whole UI is generated from the effect registry's parameter schema,
   so a new effect needs no UI work at all.
   ═══════════════════════════════════════════════════════════════════ */

import React, { useMemo, useState } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { Clip, ClipEffect } from '../../types/edl';
import {
  EFFECT_REGISTRY, EFFECT_CATEGORIES, getEffectDefinition, EffectParam,
} from '../../engine/effectsRegistry';
import { SliderRow, Section, ColorField, ToggleRow, EmptyState } from '../ui/Controls';
import { MotionThumb } from '../ui/MotionThumb';
import { effectPreview } from '../../engine/previewRender';
import {
  Sparkle, Plus, Trash2, ChevronUp, ChevronDown, Eye, EyeOff, Search, X, Copy, Timer, Diamond,
} from '../ui/icons';

export const EffectStackInspector: React.FC<{ clip: Clip }> = ({ clip }) => {
  const [isBrowserOpen, setBrowserOpen] = useState(false);
  const addEffect = useTimelineStore((s) => s.addEffect);
  const clearEffects = useTimelineStore((s) => s.clearEffects);
  const copyEffectsTo = useTimelineStore((s) => s.copyEffectsTo);
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const pushToast = useUiStore((s) => s.pushToast);

  const handleAdd = (type: string) => {
    const def = getEffectDefinition(type);
    addEffect(clip.id, type);
    setBrowserOpen(false);
    if (def) pushToast({ kind: 'success', title: `${def.label} added`, detail: def.description });
  };

  return (
    <div className="flex flex-col">
      <div className="h-9 px-3 flex items-center justify-between gap-2 border-b border-line bg-spectrum-panelHeader/50 flex-shrink-0">
        <span className="section-label">
          Effect stack {clip.effects.length > 0 && `· ${clip.effects.length}`}
        </span>
        <div className="flex items-center gap-1">
          {clip.effects.length > 0 && selectedClipIds.length > 1 && (
            <button
              onClick={() => {
                copyEffectsTo(clip.id, selectedClipIds.filter((id) => id !== clip.id));
                pushToast({ kind: 'success', title: `Stack copied to ${selectedClipIds.length - 1} clips` });
              }}
              className="pro-btn w-6 h-6"
              title="Copy this stack to the rest of the selection"
            
            aria-label="Copy this stack to the rest of the selection">
              <Copy className="w-3.5 h-3.5" />
            </button>
          )}
          {clip.effects.length > 0 && (
            <button onClick={() => clearEffects(clip.id)} className="btn-ghost-danger w-6 h-6" title="Remove all effects"
            aria-label="Remove all effects">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setBrowserOpen(true)}
            className="btn-primary h-6 px-2 gap-1 text-ui-sm"
            title="Browse the VFX library"
          
            aria-label="Browse the VFX library">
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
      </div>

      {clip.effects.length === 0 ? (
        <EmptyState
          icon={Sparkle}
          title="No effects on this layer"
          detail="The VFX library has glow, grain, particles, light leaks, glitch, shake and more. All keyframable."
          action={
            <button onClick={() => setBrowserOpen(true)} className="btn-primary h-7 px-3 gap-1.5 text-ui-sm mt-1">
              <Plus className="w-3 h-3" /> Browse effects
            </button>
          }
        />
      ) : (
        <div className="divide-y divide-line">
          {clip.effects.map((effect, index) => (
            <EffectRow
              key={effect.id}
              clip={clip}
              effect={effect}
              index={index}
              total={clip.effects.length}
            />
          ))}
        </div>
      )}

      {isBrowserOpen && <EffectBrowser onPick={handleAdd} onClose={() => setBrowserOpen(false)} clipType={clip.type} />}
    </div>
  );
};

/* ── One effect in the stack ────────────────────────────────────── */

const EffectRow: React.FC<{
  clip: Clip;
  effect: ClipEffect;
  index: number;
  total: number;
}> = ({ clip, effect, index, total }) => {
  const [expanded, setExpanded] = useState(index === total - 1);

  const removeEffect = useTimelineStore((s) => s.removeEffect);
  const toggleEffect = useTimelineStore((s) => s.toggleEffect);
  const reorderEffect = useTimelineStore((s) => s.reorderEffect);
  const setEffectParam = useTimelineStore((s) => s.setEffectParam);
  const setEffectIntensity = useTimelineStore((s) => s.setEffectIntensity);
  const addEffectKeyframe = useTimelineStore((s) => s.addEffectKeyframe);
  const removeEffectKeyframe = useTimelineStore((s) => s.removeEffectKeyframe);
  const hasKeyframes = (effect.keyframes?.length ?? 0) > 0;
  const playheadMs = useTimelineStore((s) => (hasKeyframes ? s.playheadMs : 0));
  const commit = useTimelineStore((s) => s.commit);

  const def = getEffectDefinition(effect.type);
  if (!def) {
    return (
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-ui-sm text-spectrum-red">Unknown effect "{effect.type}"</span>
        <button
          onClick={() => removeEffect(clip.id, effect.id)}
          className="btn-ghost-danger w-5 h-5"
          aria-label="Remove this effect"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    );
  }

  const offsetMs = Math.max(0, Math.min(clip.durationMs, playheadMs - clip.startTimeMs));

  const keyframedParams = useMemo(
    () => new Set((effect.keyframes ?? []).map((k) => k.param)),
    [effect.keyframes]
  );

  const keyAtPlayhead = (param: string) =>
    (effect.keyframes ?? []).find((k) => k.param === param && Math.abs(k.timeOffsetMs - offsetMs) < 40);

  const toggleParamKeyframe = (param: EffectParam) => {
    const existing = keyAtPlayhead(param.key);
    if (existing) removeEffectKeyframe(clip.id, effect.id, existing.id);
    else addEffectKeyframe(clip.id, effect.id, param.key, offsetMs, Number(effect.params[param.key] ?? param.default));
  };

  return (
    <div className={effect.enabled ? '' : 'opacity-50'}>
      {/* Row header */}
      <div className="h-8 px-2 flex items-center gap-1.5 hover:bg-spectrum-hover transition-colors">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
        >
          <MotionThumb
            load={() => effectPreview(def.type)}
            label={`${def.label} preview`}
            className="w-[34px] aspect-video rounded-squircle-2xs flex-shrink-0"
          />
          <span className="text-ui-sm font-medium text-spectrum-text truncate">{def.label}</span>
          {keyframedParams.size > 0 && (
            <Diamond className="w-2.5 h-2.5 text-spectrum-amber fill-spectrum-amber flex-shrink-0" />
          )}
        </button>

        <span className="text-micro font-mono text-spectrum-textFaint tabular flex-shrink-0">
          {Math.round(effect.intensity * 100)}%
        </span>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={() => reorderEffect(clip.id, effect.id, -1)}
            disabled={index === 0}
            className="pro-btn w-5 h-5"
            title="Move earlier in the stack"
          
            aria-label="Move earlier in the stack">
            <ChevronUp className="w-3 h-3" />
          </button>
          <button
            onClick={() => reorderEffect(clip.id, effect.id, 1)}
            disabled={index === total - 1}
            className="pro-btn w-5 h-5"
            title="Move later in the stack"
          
            aria-label="Move later in the stack">
            <ChevronDown className="w-3 h-3" />
          </button>
          <button
            onClick={() => toggleEffect(clip.id, effect.id)}
            className={`pro-btn w-5 h-5 ${effect.enabled ? '' : '!text-spectrum-textFaint'}`}
            title={effect.enabled ? 'Bypass effect' : 'Enable effect'}
          
            aria-label={effect.enabled ? 'Bypass effect' : 'Enable effect'}>
            {effect.enabled ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          </button>
          <button onClick={() => removeEffect(clip.id, effect.id)} className="btn-ghost-danger w-5 h-5" title="Remove effect"
            aria-label="Remove effect">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Parameters */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2 bg-black/15">
          <p className="text-micro text-spectrum-textFaint leading-relaxed">{def.description}</p>

          <SliderRow
            label="Intensity"
            min={0}
            max={1}
            step={0.01}
            displayScale={100}
            unit="%"
            defaultValue={1}
            value={effect.intensity}
            onChange={(v) => setEffectIntensity(clip.id, effect.id, v)}
            onCommit={() => commit('Set effect intensity')}
          />

          <div className="hairline" />

          {def.params.map((param) => {
            const value = effect.params[param.key];

            if (param.type === 'boolean') {
              return (
                <ToggleRow
                  key={param.key}
                  label={param.label}
                  hint={param.hint}
                  checked={Boolean(value)}
                  onChange={(v) => { setEffectParam(clip.id, effect.id, param.key, v); commit('Set effect parameter'); }}
                />
              );
            }

            if (param.type === 'color') {
              return (
                <ColorField
                  key={param.key}
                  label={param.label}
                  value={String(value ?? param.default)}
                  onChange={(v) => { setEffectParam(clip.id, effect.id, param.key, v); commit('Set effect colour'); }}
                />
              );
            }

            if (param.type === 'select') {
              return (
                <div key={param.key} className="space-y-1">
                  <span className="text-ui-sm text-spectrum-textMuted">{param.label}</span>
                  <select
                    value={String(value ?? param.default)}
                    onChange={(e) => { setEffectParam(clip.id, effect.id, param.key, e.target.value); commit('Set effect option'); }}
                    className="pro-input w-full h-7 px-2 text-ui-sm cursor-pointer"
                  >
                    {param.options?.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              );
            }

            const numeric = Number(value ?? param.default);
            const precision = (param.step ?? 1) < 1 ? 2 : 0;

            return (
              <SliderRow
                key={param.key}
                label={param.label}
                min={param.min ?? 0}
                max={param.max ?? 100}
                step={param.step ?? 1}
                unit={param.unit}
                precision={precision}
                defaultValue={Number(param.default)}
                bipolar={(param.min ?? 0) < 0}
                value={numeric}
                onChange={(v) => {
                  if (keyframedParams.has(param.key)) {
                    addEffectKeyframe(clip.id, effect.id, param.key, offsetMs, v);
                  } else {
                    setEffectParam(clip.id, effect.id, param.key, v);
                  }
                }}
                onCommit={() => commit(`Set ${param.label}`)}
                keyframe={
                  param.animatable
                    ? {
                        animated: keyframedParams.has(param.key),
                        atPlayhead: Boolean(keyAtPlayhead(param.key)),
                        onToggle: () => toggleParamKeyframe(param),
                        title: keyframedParams.has(param.key)
                          ? 'Toggle keyframe at the playhead'
                          : `Animate ${param.label}`,
                      }
                    : undefined
                }
              />
            );
          })}

          {keyframedParams.size > 0 && (
            <div className="pt-1 flex flex-wrap gap-1">
              {[...keyframedParams].map((param) => {
                const count = (effect.keyframes ?? []).filter((k) => k.param === param).length;
                return (
                  <span key={param} className="chip !text-spectrum-amber !border-spectrum-amber/30">
                    <Timer className="w-2.5 h-2.5" />
                    {param} · {count}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ── Effect browser ─────────────────────────────────────────────── */

const EffectBrowser: React.FC<{
  onPick: (type: string) => void;
  onClose: () => void;
  clipType: Clip['type'];
}> = ({ onPick, onClose, clipType }) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return EFFECT_REGISTRY.filter((e) => {
      if (e.appliesTo && !e.appliesTo.includes(clipType as any)) return false;
      if (category !== 'all' && e.category !== category) return false;
      if (!needle) return true;
      return (
        e.label.toLowerCase().includes(needle) ||
        e.type.includes(needle) ||
        e.description.toLowerCase().includes(needle) ||
        e.category.includes(needle)
      );
    });
  }, [query, category, clipType]);

  return (
    <div className="scrim" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-shell w-[620px] max-w-[92vw] max-h-[78vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="VFX Library"
      >
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <Sparkle className="w-3.5 h-3.5 text-spectrum-accent" />
            <span className="text-ui font-semibold text-spectrum-text">VFX Library</span>
            <span className="chip">{results.length}</span>
          </div>
          <button onClick={onClose} className="pro-btn w-6 h-6" aria-label="Close the effect browser">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-3 border-b border-line space-y-2 flex-shrink-0">
          <div className="pro-input flex items-center gap-2 px-2 h-8">
            <Search className="w-3.5 h-3.5 text-spectrum-textDim flex-shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search effects…"
              className="flex-1 bg-transparent outline-none text-ui text-spectrum-text placeholder:text-spectrum-textFaint"
            />
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setCategory('all')}
              className={`seg-item ${category === 'all' ? 'seg-item-active' : ''}`}
            >
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

        <div className="flex-1 overflow-y-auto p-3">
          {results.length === 0 ? (
            <p className="text-ui-sm text-spectrum-textDim text-center py-8">
              No effects match “{query}”.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {results.map((effect) => (
                <button
                  key={effect.type}
                  onClick={() => onPick(effect.type)}
                  className="card-interactive p-2 text-left flex gap-2 items-start group"
                >
                  <MotionThumb
                    load={() => effectPreview(effect.type)}
                    label={`${effect.label} preview`}
                    className="w-[56px] aspect-video rounded-squircle-xs flex-shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-ui font-medium text-spectrum-text truncate">{effect.label}</span>
                      <Plus className="w-3 h-3 text-spectrum-textFaint group-hover:text-spectrum-accent flex-shrink-0 transition-colors" />
                    </span>
                    <span className="block text-micro text-spectrum-textDim leading-snug mt-0.5">
                      {effect.description}
                    </span>
                    <span className="chip mt-1.5 !text-micro">{effect.category}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
