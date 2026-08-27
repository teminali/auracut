import React from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { Clip, VoiceEffect } from '../../types/edl';
import { Section, SliderRow, ToggleRow, SegmentedControl, NumberField } from '../ui/Controls';
import { unpreviewableAudio } from '../../engine/audioEffects';
import { Volume2, Waves, Mic, Sparkle, EarOff } from '../ui/icons';

const VOICE_EFFECTS: { value: VoiceEffect; label: string }[] = [
  { value: 'none', label: 'Natural' },
  { value: 'deep', label: 'Deep' },
  { value: 'high', label: 'High' },
  { value: 'robot', label: 'Robot' },
  { value: 'echo', label: 'Echo' },
  { value: 'telephone', label: 'Phone' },
  { value: 'stadium', label: 'Stadium' },
];

/** dB is what editors think in; the model stores linear gain. */
const toDb = (gain: number): number => (gain <= 0.0001 ? -60 : 20 * Math.log10(gain));

export const AudioInspector: React.FC<{ clip: Clip }> = ({ clip }) => {
  const updateClipAudio = useTimelineStore((s) => s.updateClipAudio);
  const commit = useTimelineStore((s) => s.commit);

  const a = clip.audio;
  const set = (patch: Partial<typeof a>) => updateClipAudio(clip.id, patch);
  const maxFade = Math.floor(clip.durationMs / 2);

  /*
    What the EXPORT will do that PLAYBACK will not.

    These controls all reach the rendered file — the filtergraph in
    `electron/render.ts` applies every one of them. Playback runs a
    WebAudio graph, which can do the filters and the delays but cannot
    move pitch without moving speed, and has no afftdn.

    So the preview is quietly different from the render for exactly these
    settings, and it says so here rather than letting someone cut against
    a voice they are not hearing. Silence would be the older, worse bug:
    a control that reports success and changes nothing you can check.
  */
  const notPreviewed = unpreviewableAudio(a);

  return (
    <div>
      <Section title="Level" icon={Volume2}>
        <SliderRow
          label="Volume"
          min={0}
          max={2}
          step={0.01}
          displayScale={100}
          unit="%"
          defaultValue={1}
          value={a.volume}
          onChange={(v) => set({ volume: v })}
          onCommit={() => commit('Set volume')}
        />
        <div className="flex items-center justify-between text-micro font-mono text-spectrum-textFaint">
          <span>{toDb(a.volume) <= -60 ? '−∞' : `${toDb(a.volume) >= 0 ? '+' : ''}${toDb(a.volume).toFixed(1)}`} dB</span>
          {a.volume > 1 && <span className="text-spectrum-amber">Gain above unity, watch for clipping</span>}
        </div>

        <div className="grid grid-cols-4 gap-1 pt-0.5">
          {[0, 0.5, 1, 1.5].map((v) => (
            <button
              key={v}
              onClick={() => { set({ volume: v }); commit('Set volume'); }}
              className="h-6 rounded-squircle-xs bg-spectrum-card text-micro font-mono text-spectrum-textDim hover:text-spectrum-text transition-colors"
            >
              {v === 0 ? 'Mute' : `${Math.round(v * 100)}%`}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Fades" icon={Waves}>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="In" unit="ms" min={0} max={maxFade} step={50} sensitivity={8}
            value={a.fadeInMs} onChange={(v) => set({ fadeInMs: v })} onCommit={() => commit('Set fade in')} />
          <NumberField label="Out" unit="ms" min={0} max={maxFade} step={50} sensitivity={8}
            value={a.fadeOutMs} onChange={(v) => set({ fadeOutMs: v })} onCommit={() => commit('Set fade out')} />
        </div>
        <p className="text-micro text-spectrum-textFaint">
          You can also drag the white handles on the clip itself.
        </p>
      </Section>

      <Section title="Voice & pitch" icon={Mic}>
        <SliderRow label="Pitch" min={-24} max={24} unit=" st" bipolar defaultValue={0}
          value={a.pitch} onChange={(v) => set({ pitch: v })} onCommit={() => commit('Set pitch')} />
        <div className="space-y-1">
          <span className="text-ui-sm text-spectrum-textMuted">Voice effect</span>
          <SegmentedControl
            value={a.voiceEffect}
            columns={4}
            onChange={(v) => { set({ voiceEffect: v }); commit('Set voice effect'); }}
            options={VOICE_EFFECTS.map((v) => ({ value: v.value, label: v.label }))}
          />
        </div>
      </Section>

      <Section title="Processing" icon={Sparkle}>
        <ToggleRow
          label="Noise reduction"
          hint="Suppress hiss and room tone"
          checked={a.noiseReduction}
          onChange={(v) => { set({ noiseReduction: v }); commit('Toggle noise reduction'); }}
        />
        <ToggleRow
          label="Auto ducking"
          hint="Dip the music when dialogue plays"
          checked={a.ducking}
          onChange={(v) => { set({ ducking: v }); commit('Toggle ducking'); }}
        />
      </Section>

      {notPreviewed.length > 0 && (
        <div className="mx-3 mb-3 rounded-md border border-spectrum-amber/30 bg-spectrum-amber/10 p-2">
          <div className="flex items-center gap-1.5 mb-1">
            <EarOff className="w-3 h-3 text-spectrum-amber flex-shrink-0" />
            <span className="text-micro font-semibold text-spectrum-amber">
              Not in the preview
            </span>
          </div>
          <ul className="space-y-1">
            {notPreviewed.map((u) => (
              <li key={u.setting} className="text-micro leading-snug text-spectrum-textMuted">
                {u.short}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-micro leading-snug text-spectrum-textFaint">
            The export applies {notPreviewed.length === 1 ? 'it' : 'them'}. Render a test
            clip before judging this by ear.
          </p>
        </div>
      )}
    </div>
  );
};
