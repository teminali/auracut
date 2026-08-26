import React, { useState, useRef, useMemo } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { MediaAsset } from '../../types/edl';
import { formatDuration, formatFileSize } from '../../utils/time';
import {
  Plus, Video, Music, Image as ImageIcon, Upload, LayoutGrid, List, Search, Trash2, Film,
} from 'lucide-react';

type ViewMode = 'grid' | 'list';

export const MediaPanel: React.FC = () => {
  const mediaPool = useTimelineStore((s) => s.mediaPool);
  const addMediaAsset = useTimelineStore((s) => s.addMediaAsset);
  const removeMediaAsset = useTimelineStore((s) => s.removeMediaAsset);
  const insertClip = useTimelineStore((s) => s.insertClip);
  const selectedTrackId = useTimelineStore((s) => s.selectedTrackId);
  const playheadMs = useTimelineStore((s) => s.playheadMs);
  const tracks = useTimelineStore((s) => s.tracks);
  const pushToast = useUiStore((s) => s.pushToast);

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [query, setQuery] = useState('');
  const [isDropping, setDropping] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return mediaPool;
    return mediaPool.filter((a) => a.name.toLowerCase().includes(needle) || a.type.includes(needle));
  }, [mediaPool, query]);

  /** Read intrinsic dimensions and duration so clips lay out correctly. */
  const probeAsset = (file: File, url: string): Promise<Partial<MediaAsset>> =>
    new Promise((resolve) => {
      if (file.type.startsWith('image')) {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, durationMs: 4000 });
        img.onerror = () => resolve({});
        img.src = url;
        return;
      }

      if (file.type.startsWith('video')) {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () =>
          resolve({
            width: video.videoWidth,
            height: video.videoHeight,
            durationMs: Math.round(video.duration * 1000) || 8000,
          });
        video.onerror = () => resolve({});
        video.src = url;
        return;
      }

      if (file.type.startsWith('audio')) {
        const audio = document.createElement('audio');
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => resolve({ durationMs: Math.round(audio.duration * 1000) || 15000 });
        audio.onerror = () => resolve({});
        audio.src = url;
        return;
      }

      resolve({});
    });

  const ingest = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;

    for (const file of list) {
      const url = URL.createObjectURL(file);
      const type = file.type.startsWith('video')
        ? 'video'
        : file.type.startsWith('audio')
          ? 'audio'
          : file.type.startsWith('image')
            ? 'image'
            : 'video';

      const probed = await probeAsset(file, url);

      addMediaAsset({
        id: `media_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        type,
        url,
        thumbnailUrl: type === 'image' || type === 'video' ? url : '',
        durationMs: probed.durationMs ?? (type === 'audio' ? 15000 : 8000),
        width: probed.width,
        height: probed.height,
        fileSizeFormatted: formatFileSize(file.size),
        codec: file.type || 'Unknown',
      });
    }

    pushToast({
      kind: 'success',
      title: `${list.length} file${list.length === 1 ? '' : 's'} imported`,
      detail: 'Drag them onto a track, or click to place at the playhead.',
    });
  };

  const place = (asset: MediaAsset) => {
    const fallbackTrack =
      asset.type === 'audio'
        ? tracks.find((t) => t.type === 'audio')?.id
        : tracks.find((t) => t.type === 'video')?.id;
    insertClip(selectedTrackId ?? fallbackTrack ?? tracks[0].id, asset, playheadMs);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        if (e.dataTransfer.files.length > 0) void ingest(e.dataTransfer.files);
      }}
      className={`w-full h-full bg-spectrum-panel border-r border-line flex flex-col overflow-hidden relative ${
        isDropping ? 'ring-2 ring-inset ring-spectrum-accent' : ''
      }`}
    >
      <div className="panel-header">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="panel-title">Media</span>
          <span className="text-micro font-mono text-spectrum-textFaint tabular">{mediaPool.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
            className="pro-btn w-[22px] h-[22px]"
            title={viewMode === 'list' ? 'Grid view' : 'List view'}
          >
            {viewMode === 'list' ? <LayoutGrid className="w-3.5 h-3.5" /> : <List className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="btn-primary h-[22px] px-2 gap-1 text-ui-xs">
            <Upload className="w-3 h-3" /> Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="video/*,audio/*,image/*"
            className="hidden"
            onChange={(e) => e.target.files && ingest(e.target.files)}
          />
        </div>
      </div>

      <div className="px-2 py-2 flex-shrink-0">
        <div className="pro-input flex items-center gap-1.5 px-2 h-7">
          <Search className="w-3.5 h-3.5 text-spectrum-textDim flex-shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search media…"
            className="flex-1 bg-transparent outline-none text-ui-sm text-spectrum-text placeholder:text-spectrum-textFaint min-w-0"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2 px-4">
            <Film className="w-7 h-7 text-spectrum-textFaint" />
            <p className="text-[11px] text-spectrum-textDim">
              {query ? `Nothing matches “${query}”` : 'Drop video, audio or images here'}
            </p>
            {!query && (
              <button onClick={() => fileInputRef.current?.click()} className="pro-btn-filled h-7 px-3 text-[11px] gap-1.5">
                <Upload className="w-3 h-3" /> Choose files
              </button>
            )}
          </div>
        ) : viewMode === 'list' ? (
          <div className="space-y-1.5">
            {filtered.map((asset) => (
              <AssetRow key={asset.id} asset={asset} onPlace={place} onRemove={removeMediaAsset} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filtered.map((asset) => (
              <AssetCard key={asset.id} asset={asset} onPlace={place} />
            ))}
          </div>
        )}
      </div>

      {isDropping && (
        <div className="absolute inset-0 bg-spectrum-accent/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="card px-4 py-3 text-center">
            <Upload className="w-5 h-5 text-spectrum-accent mx-auto mb-1" />
            <p className="text-[11px] font-medium text-spectrum-text">Drop to import</p>
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Rows ───────────────────────────────────────────────────────── */

const typeIcon = (type: MediaAsset['type']) =>
  type === 'audio' ? Music : type === 'image' ? ImageIcon : Video;

const dragPayload = (asset: MediaAsset) => (e: React.DragEvent) => {
  e.dataTransfer.setData('application/x-auracut-asset', JSON.stringify(asset));
  e.dataTransfer.effectAllowed = 'copy';
};

const AssetRow: React.FC<{
  asset: MediaAsset;
  onPlace: (a: MediaAsset) => void;
  onRemove: (id: string) => void;
}> = ({ asset, onPlace, onRemove }) => {
  const Icon = typeIcon(asset.type);

  return (
    <div
      draggable
      onDragStart={dragPayload(asset)}
      onClick={() => onPlace(asset)}
      className="card-interactive p-1.5 flex items-center gap-2.5 group"
      title="Click to place at the playhead · drag onto a track"
    >
      {/* 16:9, because that is the shape of the thing it represents. A square
          crop of a widescreen frame tells you less about the shot. */}
      <div className="w-[52px] h-[30px] rounded-[5px] bg-black/60 border border-line overflow-hidden flex-shrink-0 flex items-center justify-center relative">
        {asset.thumbnailUrl ? (
          <img src={asset.thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <Icon className="w-4 h-4 text-spectrum-textDim" />
        )}
        {asset.type === 'audio' && (
          <span className="absolute inset-0 bg-lane-audio/20 flex items-center justify-center">
            <Music className="w-4 h-4 text-white/90" />
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-ui-sm font-medium text-spectrum-text truncate">
          {asset.name}
        </p>
        <p className="text-[10px] text-spectrum-textFaint font-mono tabular truncate">
          {formatDuration(asset.durationMs)} · {asset.fileSizeFormatted}
        </p>
      </div>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(asset.id); }}
          className="btn-ghost-danger w-[22px] h-[22px] opacity-0 group-hover:opacity-100 transition-opacity"
          title="Remove from pool"
        >
          <Trash2 className="w-3 h-3" />
        </button>
        <span className="w-[22px] h-[22px] rounded-full bg-spectrum-sunken border border-line group-hover:bg-spectrum-accent group-hover:border-spectrum-accent text-spectrum-textDim group-hover:text-white flex items-center justify-center transition-colors">
          <Plus className="w-3 h-3" />
        </span>
      </div>
    </div>
  );
};

const AssetCard: React.FC<{ asset: MediaAsset; onPlace: (a: MediaAsset) => void }> = ({ asset, onPlace }) => {
  const Icon = typeIcon(asset.type);

  return (
    <div
      draggable
      onDragStart={dragPayload(asset)}
      onClick={() => onPlace(asset)}
      className="card-interactive overflow-hidden group"
    >
      <div className="aspect-video bg-black/60 relative overflow-hidden flex items-center justify-center">
        {asset.thumbnailUrl ? (
          <img src={asset.thumbnailUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" loading="lazy" />
        ) : (
          <Icon className="w-5 h-5 text-spectrum-textDim" />
        )}
        <span className="absolute bottom-1 right-1 px-1 rounded-[3px] bg-black/80 text-[9px] font-mono text-white/85 tabular leading-[14px]">
          {formatDuration(asset.durationMs)}
        </span>
      </div>
      <p className="px-1.5 py-1.5 text-ui-xs text-spectrum-textMuted truncate group-hover:text-spectrum-text transition-colors">
        {asset.name}
      </p>
    </div>
  );
};
