/* ═══════════════════════════════════════════════════════════════════
   Voiceover & Dialogue Studio — Powered by Microsoft VibeVoice.

   Enables multi-speaker conversational dialogue synthesis,
   automated multi-track EDL generation, and synchronized captions.
   ═══════════════════════════════════════════════════════════════════ */

import React, { useState } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import {
  VIBEVOICE_PRESETS,
  VoicePreset,
  DialogueTurn,
  generateAndAssembleDialogue,
  getSpeakerColor,
} from '../../engine/vibeVoiceEngine';
import { Section, SliderRow, ToggleRow } from '../ui/Controls';
import {
  Mic, Plus, Trash2, Sparkle, Play, MessageSquare,
  Volume2, Check, Layers, AlertCircle,
} from '../ui/icons';

const TEMPLATES: Array<{ label: string; turns: DialogueTurn[] }> = [
  {
    label: 'Podcast Intro',
    turns: [
      { speaker: 'Alice', voiceId: 'en_female_warm', emotion: 'friendly', text: 'Welcome back to the Frontier Show! Today we are diving into generative video workflows.' },
      { speaker: 'Bob', voiceId: 'en_male_deep', emotion: 'excited', text: 'That is right Alice! The new real-time voice synthesis and multi-speaker editing in TeminaliCut is unreal.' },
      { speaker: 'Alice', voiceId: 'en_female_warm', emotion: 'friendly', text: 'Let’s walk through how to build a full episode in under two minutes.' },
    ],
  },
  {
    label: 'Product Walkthrough',
    turns: [
      { speaker: 'Narrator', voiceId: 'en_male_calm', emotion: 'neutral', text: 'TeminaliCut empowers creators with an autonomous AI video editing engine.' },
      { speaker: 'Host', voiceId: 'en_female_energetic', emotion: 'excited', text: 'Notice how every cut and caption locks directly to the rhythm of the speech.' },
    ],
  },
];

export const VoiceoverPanel: React.FC = () => {
  const pushToast = useUiStore((s) => s.pushToast);
  const [turns, setTurns] = useState<DialogueTurn[]>(TEMPLATES[0].turns);
  const [pauseMs, setPauseMs] = useState(300);
  const [autoCaptions, setAutoCaptions] = useState(true);
  const [duckMusic, setDuckMusic] = useState(true);
  const [isGenerating, setGenerating] = useState(false);

  const addTurn = () => {
    const lastSpeaker = turns[turns.length - 1]?.speaker;
    const nextSpeaker = lastSpeaker === 'Alice' ? 'Bob' : 'Alice';
    const nextVoice = nextSpeaker === 'Alice' ? 'en_female_warm' : 'en_male_deep';

    setTurns((prev) => [
      ...prev,
      {
        speaker: nextSpeaker,
        voiceId: nextVoice,
        emotion: 'friendly',
        text: '',
      },
    ]);
  };

  const updateTurn = (index: number, patch: Partial<DialogueTurn>) => {
    setTurns((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], ...patch };
      return copy;
    });
  };

  const removeTurn = (index: number) => {
    if (turns.length <= 1) return;
    setTurns((prev) => prev.filter((_, i) => i !== index));
  };

  const loadTemplate = (t: typeof TEMPLATES[0]) => {
    setTurns(t.turns);
    pushToast({ kind: 'info', title: `Loaded "${t.label}" template` });
  };

  const handleGenerate = async () => {
    const validTurns = turns.filter((t) => t.text.trim().length > 0);
    if (validTurns.length === 0) {
      pushToast({ kind: 'error', title: 'Script is empty', detail: 'Please enter dialogue text before generating.' });
      return;
    }

    setGenerating(true);
    const toastId = pushToast({ kind: 'progress', title: 'Synthesizing VibeVoice Dialogue…', progress: 40 });

    try {
      const res = await generateAndAssembleDialogue(validTurns, {
        pauseBetweenSpeakersMs: pauseMs,
        createCaptions: autoCaptions,
        duckMusicUnderSpeech: duckMusic,
      });

      pushToast({
        kind: 'success',
        title: 'Voiceover Created & Placed on Timeline',
        detail: `${res.speakers.length} speakers · ${res.clipCount} audio clips · ${res.cueCount} synchronized captions.`,
      });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Dialogue generation failed',
        detail: (err as Error).message,
      });
    } finally {
      useUiStore.getState().dismissToast(toastId);
      setGenerating(false);
    }
  };

  return (
    <div className="w-full h-full bg-spectrum-panel border-r border-line flex flex-col overflow-hidden">
      <div className="panel-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 text-spectrum-pink" />
          <span className="panel-title">AI Voiceover & Dialogue</span>
        </div>
        <span className="chip !text-spectrum-pink !border-spectrum-pink/30 font-medium">VibeVoice 1.5B</span>
      </div>

      <div className="p-3 border-b border-line/60 bg-spectrum-surface/40 flex flex-col gap-2">
        <div className="flex items-center justify-between text-micro text-spectrum-textFaint">
          <span>Quick Starter Templates:</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {TEMPLATES.map((tmpl) => (
            <button
              key={tmpl.label}
              onClick={() => loadTemplate(tmpl)}
              className="btn btn-secondary !text-xs !py-1 !px-2 flex items-center gap-1"
            >
              <Sparkle className="w-3 h-3 text-spectrum-pink" />
              {tmpl.label}
            </button>
          ))}
        </div>
      </div>

      {/* Script Builder */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-ui-xs font-semibold text-spectrum-text uppercase tracking-wider">
            Dialogue Script ({turns.length} Turns)
          </span>
          <button
            onClick={addTurn}
            className="btn btn-secondary !py-1 !px-2 !text-xs flex items-center gap-1 text-spectrum-accent"
          >
            <Plus className="w-3 h-3" />
            Add Speaker Turn
          </button>
        </div>

        <div className="flex flex-col gap-2.5">
          {turns.map((turn, index) => {
            const speakerColor = getSpeakerColor(index);
            return (
              <div
                key={index}
                className="bg-spectrum-surface/70 border border-line/80 rounded-lg p-3 flex flex-col gap-2 shadow-sm transition-all focus-within:border-spectrum-accent"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: speakerColor }}
                    />
                    <input
                      type="text"
                      value={turn.speaker}
                      onChange={(e) => updateTurn(index, { speaker: e.target.value })}
                      placeholder="Speaker Name"
                      className="input !py-0.5 !px-1.5 !text-xs font-semibold w-24 bg-transparent border-line/40"
                    />

                    <select
                      value={turn.voiceId || 'en_female_warm'}
                      onChange={(e) => updateTurn(index, { voiceId: e.target.value })}
                      className="input !py-0.5 !px-1.5 !text-xs bg-spectrum-panel border-line/50 flex-1 truncate"
                    >
                      {VIBEVOICE_PRESETS.map((vp) => (
                        <option key={vp.id} value={vp.id}>
                          {vp.name} ({vp.gender})
                        </option>
                      ))}
                    </select>

                    <select
                      value={turn.emotion || 'friendly'}
                      onChange={(e) => updateTurn(index, { emotion: e.target.value })}
                      className="input !py-0.5 !px-1.5 !text-xs bg-spectrum-panel border-line/50 w-24 text-micro"
                    >
                      <option value="friendly">Friendly</option>
                      <option value="excited">Excited</option>
                      <option value="neutral">Neutral</option>
                      <option value="calm">Calm</option>
                      <option value="serious">Serious</option>
                    </select>
                  </div>

                  {turns.length > 1 && (
                    <button
                      onClick={() => removeTurn(index)}
                      className="btn-ghost !p-1 text-spectrum-textFaint hover:text-spectrum-red"
                      title="Delete Turn"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <textarea
                  value={turn.text}
                  onChange={(e) => updateTurn(index, { text: e.target.value })}
                  placeholder={`What does ${turn.speaker || 'this character'} say?`}
                  rows={2}
                  className="input !p-2 !text-xs bg-spectrum-panel/60 resize-none font-normal leading-relaxed"
                />
              </div>
            );
          })}
        </div>

        {/* Global Controls */}
        <Section title="Timeline & Audio Settings" icon={Layers}>
          <div className="flex flex-col gap-2">
            <SliderRow
              label="Pause between speakers"
              value={pauseMs}
              min={100}
              max={1000}
              step={50}
              unit="ms"
              onChange={setPauseMs}
            />
            <ToggleRow
              label="Sync Captions to Timeline"
              checked={autoCaptions}
              onChange={setAutoCaptions}
            />
            <ToggleRow
              label="Duck Music Under Speech"
              checked={duckMusic}
              onChange={setDuckMusic}
            />
          </div>
        </Section>
      </div>

      {/* Footer Generation Action */}
      <div className="p-3 border-t border-line bg-spectrum-surface/90 flex flex-col gap-2">
        <button
          disabled={isGenerating || turns.every((t) => !t.text.trim())}
          onClick={handleGenerate}
          className="btn btn-primary !py-2.5 !w-full flex items-center justify-center gap-2 shadow-lg shadow-spectrum-accent/20 disabled:opacity-50"
        >
          <Sparkle className="w-4 h-4 text-white animate-pulse" />
          <span className="font-semibold text-ui-sm">
            {isGenerating ? 'Generating VibeVoice Audio…' : 'Generate & Place on Timeline'}
          </span>
        </button>
        <p className="text-micro text-spectrum-textFaint text-center">
          Generates multi-speaker tracks + synced karaoke captions with zero cloud latency.
        </p>
      </div>
    </div>
  );
};
