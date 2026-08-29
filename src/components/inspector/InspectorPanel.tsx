import React, { useState, useEffect } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { TransformInspector } from './TransformInspector';
import { ColorInspector } from './ColorInspector';
import { EffectStackInspector } from './EffectStackInspector';
import { SpeedInspector } from './SpeedInspector';
import { KeyframeEditor } from './KeyframeEditor';
import { AudioInspector } from './AudioInspector';
import { TextInspector } from './TextInspector';
import { ShapeInspector } from './ShapeInspector';
import { EmptyState } from '../ui/Controls';
import {
  MousePointerSquareDashed, Move3d, Palette, Sparkle, Gauge, Diamond, Volume2, Type, Shapes, Lock,
} from '../ui/icons';

type TabId = 'transform' | 'color' | 'effects' | 'speed' | 'keys' | 'audio' | 'text' | 'shape';

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ElementType;
}

export const InspectorPanel: React.FC = () => {
  const tracks = useTimelineStore((s) => s.tracks);
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const toggleClipLock = useTimelineStore((s) => s.toggleClipLock);

  const [activeTab, setActiveTab] = useState<TabId>('transform');

  const clip = React.useMemo(() => {
    const id = selectedClipIds[0];
    if (!id) return null;
    for (const track of tracks) {
      const found = track.clips.find((c) => c.id === id);
      if (found) return found;
    }
    return null;
  }, [tracks, selectedClipIds]);

  const tabs: TabDef[] = React.useMemo(() => {
    if (!clip) return [];
    const list: TabDef[] = [];

    if (clip.type === 'text') list.push({ id: 'text', label: 'Text', icon: Type });
    if (clip.type === 'shape') list.push({ id: 'shape', label: 'Shape', icon: Shapes });
    if (clip.type !== 'audio') {
      list.push({ id: 'transform', label: 'Transform', icon: Move3d });
      list.push({ id: 'effects', label: 'VFX', icon: Sparkle });
    }
    if (clip.type === 'video' || clip.type === 'image' || clip.type === 'adjustment') {
      list.push({ id: 'color', label: 'Colour', icon: Palette });
    }
    list.push({ id: 'keys', label: 'Keys', icon: Diamond });
    if (clip.type !== 'text' && clip.type !== 'shape') {
      list.push({ id: 'speed', label: 'Speed', icon: Gauge });
    }
    if (clip.type === 'audio' || clip.type === 'video') {
      list.push({ id: 'audio', label: 'Audio', icon: Volume2 });
    }
    return list;
  }, [clip]);

  // Keep the active tab valid as the selection changes type.
  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.id === activeTab)) {
      setActiveTab(tabs[0].id);
    }
  }, [tabs, activeTab]);

  if (!clip) {
    return (
      <aside className="w-full h-full bg-spectrum-panel border-l border-line flex flex-col">
        <div className="panel-header">
          <span className="panel-title">Inspector</span>
        </div>
        <EmptyState
          icon={MousePointerSquareDashed}
          title="Nothing selected"
          detail="Click a clip on the timeline or a layer in the program monitor to edit it."
        />
      </aside>
    );
  }

  const effectCount = clip.effects.filter((e) => e.enabled).length;

  return (
    <aside className="w-full h-full bg-spectrum-panel border-l border-line flex flex-col overflow-hidden">
      {/* Header */}
      <div className="panel-header">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-[3px] h-3.5 rounded-full flex-shrink-0"
            style={{ background: clip.color }}
          />
          <span className="text-ui font-semibold text-spectrum-text truncate" title={clip.name}>
            {clip.name}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {selectedClipIds.length > 1 && (
            <span className="chip !text-spectrum-accent !border-spectrum-accentLine">
              +{selectedClipIds.length - 1}
            </span>
          )}
          <button
            onClick={() => toggleClipLock(clip.id)}
            className={`pro-btn w-[22px] h-[22px] ${clip.locked ? 'pro-btn-active !text-spectrum-amber' : ''}`}
            title={clip.locked ? 'Unlock layer' : 'Lock layer'}
          
            aria-label={clip.locked ? 'Unlock layer' : 'Lock layer'}>
            <Lock className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/*
        Tabs.

        Every tab keeps its label — a label that appears only when active
        makes the whole row reflow on each click. The strip scrolls instead,
        with a fade on the right edge so it is obvious there is more.
      */}
      <div className="tab-strip">
        <div className="flex items-center gap-0.5 px-2 overflow-x-auto scrollbar-none">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              title={tab.label}
              className={`tab-item ${active ? 'tab-item-active' : ''}`}
              aria-selected={active}
              role="tab"
              aria-label={tab.label}>
              <Icon className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{tab.label}</span>
              {tab.id === 'effects' && effectCount > 0 && (
                <span className="px-1 rounded-full bg-spectrum-accentSoft text-spectrum-accent text-micro font-bold leading-[13px]">
                  {effectCount}
                </span>
              )}
              {tab.id === 'keys' && clip.keyframes.length > 0 && (
                <span className="px-1 rounded-full bg-spectrum-amber/20 text-spectrum-amber text-micro font-bold leading-[13px]">
                  {clip.keyframes.length}
                </span>
              )}
            </button>
          );
        })}
        </div>
        <div className="absolute right-0 top-0 bottom-px w-6 pointer-events-none bg-gradient-to-l from-spectrum-panelHeader to-transparent" />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'transform' && <TransformInspector clip={clip} />}
        {activeTab === 'color' && <ColorInspector clip={clip} />}
        {activeTab === 'effects' && <EffectStackInspector clip={clip} />}
        {activeTab === 'speed' && <SpeedInspector clip={clip} />}
        {activeTab === 'keys' && <KeyframeEditor clip={clip} />}
        {activeTab === 'audio' && <AudioInspector clip={clip} />}
        {activeTab === 'text' && <TextInspector clip={clip} />}
        {activeTab === 'shape' && <ShapeInspector clip={clip} />}
      </div>
    </aside>
  );
};
