import React from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import {
  Trash2, Flag,
} from '../ui/icons';

interface MarkerLaneProps {
  pxPerMs: number;
  height: number;
}

export const MarkerLane: React.FC<MarkerLaneProps> = ({ pxPerMs, height }) => {
  const markers = useTimelineStore((s) => s.markers);
  const setPlayheadMs = useTimelineStore((s) => s.setPlayheadMs);
  const removeMarker = useTimelineStore((s) => s.removeMarker);
  const clearMarkers = useTimelineStore((s) => s.clearMarkers);
  const addMarker = useTimelineStore((s) => s.addMarker);
  const openContextMenu = useUiStore((s) => s.openContextMenu);

  return (
    <div
      style={{ height }}
      className="relative bg-spectrum-panelHeader/70 border-t border-line-soft"
      onDoubleClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        addMarker(Math.max(0, (e.clientX - rect.left) / pxPerMs));
      }}
      title="Double-click to drop a marker"
    >
      {markers.map((marker) => (
        <button
          key={marker.id}
          onClick={(e) => {
            e.stopPropagation();
            setPlayheadMs(marker.timeMs);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openContextMenu(e.clientX, e.clientY, [
              { id: 'goto', label: 'Go to marker', icon: Flag, onSelect: () => setPlayheadMs(marker.timeMs) },
              { id: 'del', label: 'Delete marker', icon: Trash2, danger: true, onSelect: () => removeMarker(marker.id) },
              { id: 'clear', label: `Clear all ${marker.kind} markers`, icon: Trash2, danger: true, separatorBefore: true, onSelect: () => clearMarkers(marker.kind) },
            ]);
          }}
          className="absolute top-0 bottom-0 group"
          style={{ left: marker.timeMs * pxPerMs - 4, width: 8 }}
          title={marker.label || `${marker.kind} · ${(marker.timeMs / 1000).toFixed(2)}s`}
        
            aria-label={marker.label || `${marker.kind} · ${(marker.timeMs / 1000).toFixed(2)}s`}>
          <div
            className="absolute left-1/2 -translate-x-1/2 top-[2px] w-0 h-0 group-hover:scale-125 transition-transform"
            style={{
              borderLeft: '4px solid transparent',
              borderRight: '4px solid transparent',
              borderTop: `7px solid ${marker.color}`,
            }}
          />
          <div
            className="absolute left-1/2 -translate-x-1/2 bottom-0 w-px h-1.5 opacity-60"
            style={{ background: marker.color }}
          />
        </button>
      ))}
    </div>
  );
};
