/* One-click AI operations that map onto the MCP tool surface. */

import React, { useState } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { executeTool } from '../../mcp/toolRegistry';
import { analyzeTranscriptForBroll, BrollSuggestion } from '../../engine/brollEngine';
import { Section } from '../ui/Controls';
import {
  Wand2, Scissors, Music4, Sparkles, Film, Plus, Subtitles,
  Smartphone, Palette, Layers, MessageSquare,
} from 'lucide-react';

interface Recipe {
  id: string;
  label: string;
  hint: string;
  icon: React.ElementType;
  tone: string;
  run: () => Promise<void>;
}

export const AiToolsPanel: React.FC = () => {
  const tracks = useTimelineStore((s) => s.tracks);
  const pushToast = useUiStore((s) => s.pushToast);
  const setCopilotOpen = useProjectStore((s) => s.setCopilotOpen);

  const [busy, setBusy] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<BrollSuggestion[]>([]);

  const call = async (tool: string, args: Record<string, unknown>, title: string) => {
    const result = await executeTool(tool, args, 'AI Tools');
    if (result.success) pushToast({ kind: 'success', title });
    else pushToast({ kind: 'error', title: 'That did not work', detail: result.error });
  };

  const RECIPES: Recipe[] = [
    {
      id: 'cinematic',
      label: 'Cinematic look',
      hint: 'Teal & orange grade, scope bars and film grain across every clip',
      icon: Palette,
      tone: 'text-spectrum-amber',
      run: async () => {
        await call('patch_clips', {
          clipType: 'video',
          properties: {
            'filters.contrast': 22,
            'filters.saturation': 18,
            'filters.temperature': -12,
            'filters.tint': 8,
            'filters.vignette': 30,
          },
        }, 'Cinematic grade applied');

        const state = useTimelineStore.getState();
        const firstVideo = state.tracks.flatMap((t) => t.clips).find((c) => c.type === 'video');
        if (firstVideo) {
          await executeTool('add_effect', { clipId: firstVideo.id, effectType: 'letterbox', params: { ratio: 2.39 } }, 'AI Tools');
          await executeTool('add_effect', { clipId: firstVideo.id, effectType: 'film_grain', params: { amount: 20 } }, 'AI Tools');
        }
      },
    },
    {
      id: 'silence',
      label: 'Cut silence',
      hint: 'Trim dialogue pauses over ~400ms and close the gaps',
      icon: Scissors,
      tone: 'text-spectrum-pink',
      run: () => call('remove_silence', {}, 'Silence removed'),
    },
    {
      id: 'beats',
      label: 'Beat-lock the cuts',
      hint: 'Detect the tempo and nudge every cut onto the nearest beat',
      icon: Music4,
      tone: 'text-spectrum-green',
      run: () => call('detect_beats', { snapCuts: true }, 'Cuts locked to the beat'),
    },
    {
      id: 'captions',
      label: 'Auto captions',
      hint: 'Transcribe the dialogue into a styled caption track',
      icon: Subtitles,
      tone: 'text-spectrum-accent',
      run: () => call('generate_auto_captions', { language: 'sw' }, 'Captions generated'),
    },
    {
      id: 'vertical',
      label: 'Reframe for vertical',
      hint: 'Switch to 9:16 and re-fit every layer to the new frame',
      icon: Smartphone,
      tone: 'text-spectrum-purple',
      run: async () => {
        await call('set_canvas', { aspectRatio: '9:16' }, 'Canvas set to 9:16');
        await call('patch_clips', { clipType: 'video', properties: { fitMode: 'cover', 'transform.x': 0, 'transform.y': 0 } }, 'Layers reframed');
      },
    },
    {
      id: 'punch',
      label: 'Add energy',
      hint: 'Beat zoom pulse, subtle shake and a punchier grade',
      icon: Sparkles,
      tone: 'text-spectrum-red',
      run: async () => {
        const state = useTimelineStore.getState();
        const targets = state.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'video');
        for (const clip of targets) {
          await executeTool('add_effect', { clipId: clip.id, effectType: 'zoom_pulse', params: { bpm: 120, depth: 0.05 } }, 'AI Tools');
        }
        await call('patch_clips', { clipType: 'video', properties: { 'filters.contrast': 18, 'filters.saturation': 26 } }, 'Energy added');
      },
    },
  ];

  const runRecipe = async (recipe: Recipe) => {
    setBusy(recipe.id);
    try {
      await recipe.run();
    } finally {
      setBusy(null);
    }
  };

  const findBroll = () => {
    const found = analyzeTranscriptForBroll(tracks);
    setSuggestions(found);
    pushToast({
      kind: found.length > 0 ? 'success' : 'info',
      title: found.length > 0 ? `${found.length} B-roll cutaways found` : 'No B-roll matches',
      detail: found.length > 0 ? 'Review them below, then insert.' : 'Add dialogue or a transcript first.',
    });
  };

  return (
    <div className="w-full h-full bg-spectrum-panel border-r border-line flex flex-col overflow-hidden">
      <div className="panel-header">
        <span className="panel-title">AI Tools</span>
        <button
          onClick={() => setCopilotOpen(true)}
          className="pro-btn-filled h-6 px-2 gap-1 text-[10px]"
          title="Open the copilot for free-form instructions"
        >
          <MessageSquare className="w-3 h-3" /> Ask
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Section title="One-click recipes" icon={Wand2}>
          <div className="space-y-1.5">
            {RECIPES.map((recipe) => {
              const Icon = recipe.icon;
              return (
                <button
                  key={recipe.id}
                  onClick={() => runRecipe(recipe)}
                  disabled={busy !== null}
                  className="card-interactive w-full p-2.5 flex items-start gap-2.5 text-left group disabled:opacity-50"
                >
                  <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${recipe.tone}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-medium text-spectrum-text group-hover:text-spectrum-accent transition-colors">
                      {busy === recipe.id ? 'Working…' : recipe.label}
                    </span>
                    <span className="block text-[10px] text-spectrum-textDim leading-snug mt-0.5">
                      {recipe.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Smart B-roll" icon={Film}>
          <p className="text-[10px] text-spectrum-textFaint leading-relaxed">
            Scans the dialogue for keywords and proposes cutaways from the media pool.
          </p>
          <button onClick={findBroll} className="pro-btn-filled w-full h-7 gap-1.5 text-[11px]">
            <Film className="w-3 h-3" /> Find B-roll
          </button>

          {suggestions.length > 0 && (
            <div className="space-y-1 pt-1">
              <div className="well max-h-32 overflow-y-auto p-1 space-y-1">
                {suggestions.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 px-1 py-0.5">
                    <span className="text-[10px] text-spectrum-text truncate">{s.mediaAsset.name}</span>
                    <span className="text-[9px] font-mono text-spectrum-textFaint tabular flex-shrink-0">
                      {(s.startTimeMs / 1000).toFixed(1)}s
                    </span>
                  </div>
                ))}
              </div>
              <button
                onClick={async () => {
                  await call('suggest_broll', { insert: true }, `${suggestions.length} cutaways inserted`);
                  setSuggestions([]);
                }}
                className="btn-primary w-full h-7 gap-1.5 text-[11px]"
              >
                <Plus className="w-3 h-3" /> Insert all onto the overlay track
              </button>
            </div>
          )}
        </Section>

        <Section title="Subject isolation" icon={Layers}>
          <p className="text-[10px] text-spectrum-textFaint leading-relaxed">
            Keys the background out of the selected layer so the subject sits on top.
          </p>
          <button
            onClick={() => call('patch_clip', {
              properties: { 'chromaKey.enabled': true, 'chromaKey.targetColorHex': '#00ff00', 'chromaKey.similarity': 42 },
            }, 'Background keyed out')}
            className="pro-btn-filled w-full h-7 gap-1.5 text-[11px]"
          >
            <Sparkles className="w-3 h-3" /> Isolate subject
          </button>
        </Section>
      </div>
    </div>
  );
};
