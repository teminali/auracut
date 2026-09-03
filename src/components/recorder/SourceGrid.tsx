/* ═══════════════════════════════════════════════════════════════════
   Choosing what to record.

   Thumbnails come from `desktopCapturer` in the main process and are
   real frames of the real thing, which is the only way this list is
   usable: "Screen 1 / Screen 2" tells you nothing on a two-monitor
   desk, and a list of window titles tells you nothing at all when four
   of them are called "Untitled".

   Displays and windows are separated rather than mixed, because the two
   differ in a way that matters downstream: a display capture can locate
   the pointer inside the frame and a window capture cannot, so auto
   zoom is only available for one of them. The tab is where that is
   said, once, rather than as a surprise after the take.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { RecorderSource } from '../../types/electron';
import { Monitor, AppWindow, Loader2, RefreshCw, Check } from '../ui/icons';

interface Props {
  sources: RecorderSource[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}

type Tab = 'screen' | 'window';

export const SourceGrid: React.FC<Props> = ({ sources, loading, selectedId, onSelect, onRefresh }) => {
  const [tab, setTab] = React.useState<Tab>('screen');

  const screens = sources.filter((s) => s.kind === 'screen');
  const windows = sources.filter((s) => s.kind === 'window');
  const shown = tab === 'screen' ? screens : windows;

  /* Follow the selection into its own tab rather than showing an empty
     grid with a highlighted item nobody can see. */
  React.useEffect(() => {
    const selected = sources.find((s) => s.id === selectedId);
    if (selected) setTab(selected.kind);
  }, [selectedId, sources]);

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line flex-shrink-0">
        <div className="seg-group">
          {(['screen', 'window'] as Tab[]).map((value) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`seg-item ${tab === value ? 'seg-item-active' : ''}`}
            >
              {value === 'screen' ? `Displays (${screens.length})` : `Windows (${windows.length})`}
            </button>
          ))}
        </div>

        <span className="ml-auto text-micro text-spectrum-textFaint">
          {tab === 'screen'
            ? 'A whole display. Auto zoom works here.'
            : 'One window only. No auto zoom.'}
        </span>

        <button onClick={onRefresh} className="pro-btn w-6 h-6" aria-label="Refresh the list" title="Refresh the list">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 min-h-0">
        {loading && sources.length === 0 ? (
          <div className="h-full flex items-center justify-center gap-2 text-ui-sm text-spectrum-textDim">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Looking at what is on screen…
          </div>
        ) : shown.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center px-6">
            <p className="text-ui-sm text-spectrum-textDim leading-relaxed">
              {tab === 'window'
                ? 'No other windows are open.'
                /* Not "you have not allowed it yet". The commonest reason
                   for zero displays on a machine that HAS allowed it is
                   that the grant went stale when TeminaliCut updated, and the
                   footer offers the one button that fixes that. */
                : 'No displays were offered. Either screen recording has not been allowed for '
                  + 'TeminaliCut, or it was allowed for an earlier version and stopped matching when '
                  + 'TeminaliCut updated. Click "Reset permissions" or "Open settings" below.'}
            </p>
          </div>
        ) : (
          /* Two columns when there is little to show. One 200px thumbnail
             floating in a three-column grid reads as a list that failed
             to load rather than as a machine with one display. */
          <div className={`grid gap-2 ${shown.length <= 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {shown.map((source) => (
              <button
                key={source.id}
                data-recorder="source"
                onClick={() => onSelect(source.id)}
                title={source.name}
                className={`rounded-squircle-sm overflow-hidden border text-left transition-colors group ${
                  source.id === selectedId
                    ? 'border-spectrum-accent bg-spectrum-accent/10'
                    : 'border-line bg-spectrum-sunken/50 hover:border-line-strong'
                }`}
              >
                <span className="block relative aspect-video bg-black/60 overflow-hidden">
                  {source.thumbnail ? (
                    <img src={source.thumbnail} alt="" className="w-full h-full object-contain" />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center">
                      {source.kind === 'screen'
                        ? <Monitor className="w-6 h-6 text-spectrum-textDisabled" />
                        : <AppWindow className="w-6 h-6 text-spectrum-textDisabled" />}
                    </span>
                  )}

                  {source.id === selectedId && (
                    <span className="absolute top-1.5 right-1.5 w-[18px] h-[18px] rounded-full bg-spectrum-accent
                                     flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-white" weight="bold" />
                    </span>
                  )}
                </span>

                <span className="flex items-center gap-1.5 px-2 py-1.5 min-w-0">
                  {source.icon ? (
                    <img src={source.icon} alt="" className="w-3.5 h-3.5 flex-shrink-0 rounded-squircle-2xs" />
                  ) : source.kind === 'screen' ? (
                    <Monitor className="w-3.5 h-3.5 flex-shrink-0 text-spectrum-textFaint" />
                  ) : (
                    <AppWindow className="w-3.5 h-3.5 flex-shrink-0 text-spectrum-textFaint" />
                  )}
                  <span className="block min-w-0">
                    <span className="block text-ui-sm text-spectrum-textMuted truncate group-hover:text-spectrum-text
                                     transition-colors">
                      {source.name}
                    </span>
                    {source.width !== null && source.height !== null && (
                      <span className="block text-micro font-mono text-spectrum-textFaint tabular">
                        {source.width}x{source.height}
                        {source.primary ? ' · main' : ''}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
