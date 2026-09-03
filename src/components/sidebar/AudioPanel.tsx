import React from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { PanelSearch, matchesQuery } from './PanelSearch';
import { SFX_CATALOGUE, SfxSpec } from '../../engine/sfxEngine';
import { executeTool } from '../../mcp/toolRegistry';
import { formatDuration } from '../../utils/time';
import { Section } from '../ui/Controls';
import { Music, Music4, Scissors, Volume2, Plus, Waves, AudioLines } from '../ui/icons';

export const AudioPanel: React.FC = () => {
  const mediaPool = useTimelineStore((s) => s.mediaPool);
  const tracks = useTimelineStore((s) => s.tracks);
  const insertClip = useTimelineStore((s) => s.insertClip);
  const markers = useTimelineStore((s) => s.markers);
  const pushToast = useUiStore((s) => s.pushToast);

  const [busy, setBusy] = React.useState<string | null>(null);

  const [query, setQuery] = React.useState('');

  const audioAssets = React.useMemo(
    () => mediaPool.filter((a) => a.type === 'audio' && matchesQuery(query, a.name)),
    [mediaPool, query]
  );
  const shownSfx = React.useMemo(
    () => SFX_CATALOGUE.filter((s) => matchesQuery(query, s.label, s.hint, s.kind)),
    [query]
  );

  /** Render one effect to a real file and add it to the pool. */
  const makeSfx = async (spec: SfxSpec) => {
    setBusy(spec.kind);
    try {
      const result = await executeTool('generate_sound_effect', { kind: spec.kind }, 'TeminaliCut');
      pushToast(
        result.success
          ? { kind: 'success', title: `${spec.label} added`, detail: 'Find it under Music & SFX.' }
          : { kind: 'error', title: 'Could not generate', detail: result.error }
      );
    } finally {
      setBusy(null);
    }
  };
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

      <div className="p-2 pb-0 flex-shrink-0">
        <PanelSearch
          value={query}
          onChange={setQuery}
          noun="sounds"
          countLabel={`${audioAssets.length + shownSfx.length}`}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {/*
          Generated, not recorded. TeminaliCut ships no audio library, and a
          catalogue of hotlinked files is how the old B-roll "library"
          and the sample music both ended up broken — so these are
          synthesised on demand into real WAV files on disk.
        */}
        <Section title="Sound effects · generated" icon={Waves}>
          {shownSfx.length === 0 ? (
            <p className="text-micro text-spectrum-textFaint">Nothing matches “{query}”.</p>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {shownSfx.map((spec) => (
                <button
                  key={spec.kind}
                  disabled={busy === spec.kind}
                  onClick={() => makeSfx(spec)}
                  className="card-interactive p-2 flex flex-col items-start gap-0.5 text-left group disabled:opacity-50"
                  title={`${spec.hint} · ${spec.seconds}s`}
                
            aria-label={`${spec.hint} · ${spec.seconds}s`}>
                  <span className="text-ui-sm font-medium text-spectrum-text group-hover:text-spectrum-accent transition-colors truncate w-full">
                    {busy === spec.kind ? 'Rendering…' : spec.label}
                  </span>
                  <span className="text-micro text-spectrum-textFaint truncate w-full">{spec.hint}</span>
                </button>
              ))}
            </div>
          )}
        </Section>

        <Section title="Music & SFX" icon={Music}>
          {audioAssets.length === 0 ? (
            <p className="text-micro text-spectrum-textFaint">
              Import audio from the Media panel to see it here.
            </p>
          ) : (
            <div className="space-y-1.5">
              {audioAssets.map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => insertClip(audioTrack?.id ?? tracks[0].id, asset, useTimelineStore.getState().playheadMs)}
                  className="card-interactive w-full p-2 flex items-center gap-2 group text-left"
                >
                  <span className="w-8 h-8 rounded-squircle-xs bg-lane-audio/15 border border-lane-audio/25 flex items-center justify-center flex-shrink-0">
                    <AudioLines className="w-3.5 h-3.5 text-lane-audio" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-ui-sm font-medium text-spectrum-text truncate group-hover:text-spectrum-accent transition-colors">
                      {asset.name}
                    </span>
                    <span className="block text-micro font-mono text-spectrum-textFaint tabular">
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
          <p className="text-micro text-spectrum-textFaint leading-relaxed">
            Analyses the music track, estimates the tempo and lays a beat grid on the timeline.
          </p>
          <button
            onClick={() => run('beats', 'detect_beats', {}, 'Beats detected')}
            disabled={busy !== null}
            className="btn-primary w-full h-7 gap-1.5 text-ui-sm"
          >
            <Music4 className="w-3 h-3" />
            {busy === 'beats' ? 'Analysing…' : 'Detect beats'}
          </button>
          <button
            onClick={() => run('beats-snap', 'detect_beats', { snapCuts: true }, 'Cuts snapped to the beat')}
            disabled={busy !== null}
            className="pro-btn-filled w-full h-7 gap-1.5 text-ui-sm"
          >
            <Waves className="w-3 h-3" />
            {busy === 'beats-snap' ? 'Snapping…' : 'Detect & snap cuts to beats'}
          </button>
        </Section>

        <Section title="Cleanup" icon={Scissors}>
          <p className="text-micro text-spectrum-textFaint leading-relaxed">
            Trims dialogue pauses and closes the gaps with a ripple edit.
          </p>
          <button
            onClick={() => run('silence', 'remove_silence', {}, 'Silence removed')}
            disabled={busy !== null}
            className="pro-btn-filled w-full h-7 gap-1.5 text-ui-sm"
          >
            <Scissors className="w-3 h-3" />
            {busy === 'silence' ? 'Processing…' : 'Cut silence'}
          </button>
        </Section>

        <Section title="Track levels" icon={Volume2}>
          {tracks.filter((t) => t.type === 'audio').map((track) => (
            <div key={track.id} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-ui-sm text-spectrum-textMuted truncate">{track.name}</span>
                <span className="text-micro font-mono text-spectrum-textFaint tabular">
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
