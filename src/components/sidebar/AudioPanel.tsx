import React from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { executeTool } from '../../mcp/toolRegistry';
import { formatDuration } from '../../utils/time';
import { Section } from '../ui/Controls';
import { Music, Music4, Scissors, Volume2, Plus, Waves, AudioLines } from 'lucide-react';

export const AudioPanel: React.FC = () => {
  const mediaPool = useTimelineStore((s) => s.mediaPool);
  const tracks = useTimelineStore((s) => s.tracks);
  const insertClip = useTimelineStore((s) => s.insertClip);
  const playheadMs = useTimelineStore((s) => s.playheadMs);
  const markers = useTimelineStore((s) => s.markers);
  const pushToast = useUiStore((s) => s.pushToast);

  const [busy, setBusy] = React.useState<string | null>(null);

  const audioAssets = mediaPool.filter((a) => a.type === 'audio');
  const audioTrack = tracks.find((t) => t.type === 'audio');
  const beatCount = markers.filter((m) => m.kind === 'beat').length;

  const run = async (id: string, tool: string, args: Record<string, unknown>, successTitle: string) => {
    setBusy(id);
    const result = await executeTool(tool, args, 'Audio Panel');
    setBusy(null);

    if (result.success) {
      pushToast({ kind: 'success', title: successTitle, detail: summarise(result.data) });
    } else {
      pushToast({ kind: 'error', title: 'That did not work', detail: result.error });
    }
  };

  return (
    <div className="w-full h-full bg-spectrum-panel border-r border-line flex flex-col overflow-hidden">
      <div className="panel-header">
        <span className="panel-title">Audio</span>
        {beatCount > 0 && <span className="chip !text-spectrum-pink !border-spectrum-pink/30">{beatCount} beats</span>}
      </div>

      <div className="flex-1 overflow-y-auto">
        <Section title="Music & SFX" icon={Music}>
          {audioAssets.length === 0 ? (
            <p className="text-[10px] text-spectrum-textFaint">
              Import audio from the Media panel to see it here.
            </p>
          ) : (
            <div className="space-y-1.5">
              {audioAssets.map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => insertClip(audioTrack?.id ?? tracks[0].id, asset, playheadMs)}
                  className="card-interactive w-full p-2 flex items-center gap-2 group text-left"
                >
                  <span className="w-8 h-8 rounded-squircle-xs bg-lane-audio/15 border border-lane-audio/25 flex items-center justify-center flex-shrink-0">
                    <AudioLines className="w-3.5 h-3.5 text-lane-audio" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[11px] font-medium text-spectrum-text truncate group-hover:text-spectrum-accent transition-colors">
                      {asset.name}
                    </span>
                    <span className="block text-[9px] font-mono text-spectrum-textFaint tabular">
                      {formatDuration(asset.durationMs)} · {asset.fileSizeFormatted}
                    </span>
                  </span>
                  <Plus className="w-3.5 h-3.5 text-spectrum-textDim group-hover:text-spectrum-accent flex-shrink-0 transition-colors" />
                </button>
              ))}
            </div>
          )}
        </Section>

        <Section title="Beat tools" icon={Music4}>
          <p className="text-[10px] text-spectrum-textFaint leading-relaxed">
            Analyses the music track, estimates the tempo and lays a beat grid on the timeline.
          </p>
          <button
            onClick={() => run('beats', 'detect_beats', {}, 'Beats detected')}
            disabled={busy !== null}
            className="btn-primary w-full h-7 gap-1.5 text-[11px]"
          >
            <Music4 className="w-3 h-3" />
            {busy === 'beats' ? 'Analysing…' : 'Detect beats'}
          </button>
          <button
            onClick={() => run('beats-snap', 'detect_beats', { snapCuts: true }, 'Cuts snapped to the beat')}
            disabled={busy !== null}
            className="pro-btn-filled w-full h-7 gap-1.5 text-[11px]"
          >
            <Waves className="w-3 h-3" />
            {busy === 'beats-snap' ? 'Snapping…' : 'Detect & snap cuts to beats'}
          </button>
        </Section>

        <Section title="Cleanup" icon={Scissors}>
          <p className="text-[10px] text-spectrum-textFaint leading-relaxed">
            Trims dialogue pauses and closes the gaps with a ripple edit.
          </p>
          <button
            onClick={() => run('silence', 'remove_silence', {}, 'Silence removed')}
            disabled={busy !== null}
            className="pro-btn-filled w-full h-7 gap-1.5 text-[11px]"
          >
            <Scissors className="w-3 h-3" />
            {busy === 'silence' ? 'Processing…' : 'Cut silence'}
          </button>
        </Section>

        <Section title="Track levels" icon={Volume2}>
          {tracks.filter((t) => t.type === 'audio').map((track) => (
            <div key={track.id} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-spectrum-textMuted truncate">{track.name}</span>
                <span className="text-[10px] font-mono text-spectrum-textFaint tabular">
                  {Math.round(track.volume * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={2}
                step={0.01}
                value={track.volume}
                onChange={(e) => useTimelineStore.getState().setTrackVolume(track.id, Number(e.target.value))}
                className="w-full range-accent"
              />
            </div>
          ))}
        </Section>
      </div>
    </div>
  );
};

function summarise(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const d = data as Record<string, unknown>;
  if ('bpm' in d) return `≈${d.bpm} BPM · ${d.beats} beats${d.cutsSnapped ? ` · ${d.cutsSnapped} cuts snapped` : ''}`;
  if ('removedSeconds' in d) return `${d.removedSeconds}s of silence removed`;
  return undefined;
}
