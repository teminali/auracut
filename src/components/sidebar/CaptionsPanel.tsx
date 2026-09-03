/* ═══════════════════════════════════════════════════════════════════
   Captions — import SRT/VTT/ASS/SBV/JSON, auto-generate, restyle,
   fix sync, and export back out.
   ═══════════════════════════════════════════════════════════════════ */

import React, { useRef, useState } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { executeTool } from '../../mcp/toolRegistry';
import {
  parseCaptions, serializeCaptions, reflowCues, shiftCues,
  CaptionCue, CaptionFormat,
} from '../../engine/captions';
import { Section, SliderRow, ToggleRow, SegmentedControl, ColorField } from '../ui/Controls';
import {
  Subtitles, Upload, Download, Globe, Sparkle, FileText, Check, AlertTriangle, Clock, Type,
} from '../ui/icons';

const LANGUAGES = [
  { value: 'sw', label: 'Kiswahili' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
  { value: 'ar', label: 'العربية' },
  { value: 'auto', label: 'Auto-detect' },
];

const CAPTION_STYLES = [
  { id: 'viral', label: 'Viral Bold', style: { fontSize: 68, color: '#ffffff', strokeColor: '#000000', strokeWidth: 10, fontWeight: 900, uppercase: true, kineticAnimation: 'kinetic_stack' } },
  { id: 'clean', label: 'Clean', style: { fontSize: 52, color: '#ffffff', strokeWidth: 0, shadowBlur: 16, fontWeight: 600, kineticAnimation: 'fade_slide' } },
  { id: 'boxed', label: 'Boxed', style: { fontSize: 48, color: '#0a0b0e', background: '#ffffff', backgroundPadding: 18, backgroundRadius: 6, strokeWidth: 0, fontWeight: 700, kineticAnimation: 'none' } },
  { id: 'karaoke', label: 'Karaoke', style: { fontSize: 60, color: '#ffffff', highlightColor: '#f5d524', strokeColor: '#000000', strokeWidth: 8, fontWeight: 800, kineticAnimation: 'karaoke_highlight' } },
];

export const CaptionsPanel: React.FC = () => {
  const importCaptions = useTimelineStore((s) => s.importCaptions);
  const tracks = useTimelineStore((s) => s.tracks);
  const patchClip = useTimelineStore((s) => s.patchClip);
  const pushToast = useUiStore((s) => s.pushToast);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [language, setLanguage] = useState('sw');
  const [engine, setEngine] = useState<'vibevoice' | 'whisper'>('vibevoice');
  const [styleId, setStyleId] = useState('viral');
  const [isBusy, setBusy] = useState(false);
  const [isDropping, setDropping] = useState(false);

  /* Import options */
  const [offsetMs, setOffsetMs] = useState(0);
  const [maxChars, setMaxChars] = useState(42);
  const [reflow, setReflow] = useState(true);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [pending, setPending] = useState<{ cues: CaptionCue[]; format: CaptionFormat; warnings: string[]; filename: string } | null>(null);

  const captionTrack = tracks.find((t) => t.type === 'text');
  const captionCount = captionTrack?.clips.length ?? 0;

  /* ── Import ── */

  const readFiles = async (files: FileList | File[]) => {
    const file = Array.from(files)[0];
    if (!file) return;

    try {
      const content = await file.text();
      const report = parseCaptions(content, file.name);

      if (report.cues.length === 0) {
        pushToast({
          kind: 'error',
          title: 'No cues found',
          detail: report.warnings[0] ?? 'The file did not parse as a subtitle format.',
        });
        return;
      }

      setPending({ cues: report.cues, format: report.format, warnings: report.warnings, filename: file.name });
    } catch (err) {
      pushToast({ kind: 'error', title: 'Could not read the file', detail: (err as Error).message });
    }
  };

  const confirmImport = () => {
    if (!pending) return;

    let cues = pending.cues;
    if (reflow) cues = reflowCues(cues, maxChars);
    if (offsetMs !== 0) cues = shiftCues(cues, offsetMs);

    const preset = CAPTION_STYLES.find((s) => s.id === styleId)?.style ?? {};
    const count = importCaptions(cues, { style: preset as any, replaceExisting });

    pushToast({
      kind: 'success',
      title: `${count} captions imported`,
      detail: `${pending.format.toUpperCase()} · ${pending.filename}`,
    });
    setPending(null);
  };

  /* ── Generate ── */

  const generate = async () => {
    setBusy(true);
    const toastId = pushToast({
      kind: 'progress',
      title: engine === 'vibevoice' ? 'Transcribing with VibeVoice Diarization…' : 'Transcribing audio…',
      progress: 30,
    });

    const preset = CAPTION_STYLES.find((s) => s.id === styleId)?.style ?? {};
    const toolName = engine === 'vibevoice' ? 'transcribe_with_diarization' : 'generate_auto_captions';
    const result = await executeTool(toolName, { language, style: preset }, 'Captions Panel');

    useUiStore.getState().dismissToast(toastId);
    setBusy(false);

    if (result.success) {
      pushToast({
        kind: 'success',
        title: engine === 'vibevoice' ? 'Diarized Captions Generated' : 'Captions generated',
        detail: 'Restyle or retime them from the timeline.',
      });
    } else {
      pushToast({ kind: 'error', title: 'Transcription failed', detail: result.error });
    }
  };

  /* ── Export ── */

  const exportAs = async (format: CaptionFormat) => {
    const result = await executeTool('export_captions', { format }, 'Captions Panel');
    if (!result.success) {
      pushToast({ kind: 'error', title: 'Export failed', detail: result.error });
      return;
    }

    const { content, cueCount } = result.data as { content: string; cueCount: number };
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `captions.${format}`;
    link.click();
    URL.revokeObjectURL(url);

    pushToast({ kind: 'success', title: `Exported ${cueCount} cues`, detail: `captions.${format}` });
  };

  /* ── Restyle everything already on the track ── */

  const restyleAll = () => {
    if (!captionTrack) return;
    const preset = CAPTION_STYLES.find((s) => s.id === styleId)?.style ?? {};
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(preset)) patch[`textStyle.${k}`] = v;

    for (const clip of captionTrack.clips) patchClip(clip.id, patch);
    pushToast({ kind: 'success', title: `Restyled ${captionTrack.clips.length} captions` });
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        if (e.dataTransfer.files.length) void readFiles(e.dataTransfer.files);
      }}
      className={`w-full h-full bg-spectrum-panel border-r border-line flex flex-col overflow-hidden relative ${
        isDropping ? 'ring-2 ring-inset ring-spectrum-accent' : ''
      }`}
    >
      <div className="panel-header">
        <span className="panel-title">Captions{captionCount > 0 ? ` · ${captionCount}` : ''}</span>
        {captionCount > 0 && (
          <button onClick={restyleAll} className="pro-btn-filled h-6 px-2 gap-1 text-micro" title="Apply the selected style to every caption"
            aria-label="Apply the selected style to every caption">
            <Sparkle className="w-3 h-3" /> Restyle all
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── Import ── */}
        <Section title="Import subtitles" icon={Upload}>
          {pending ? (
            <div className="space-y-2">
              <div className="card p-2 space-y-1">
                <div className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-spectrum-green flex-shrink-0" />
                  <span className="text-ui-sm font-medium text-spectrum-text truncate">{pending.filename}</span>
                </div>
                <p className="text-micro text-spectrum-textDim">
                  {pending.cues.length} cues · {pending.format.toUpperCase()} ·{' '}
                  {(pending.cues[pending.cues.length - 1].endMs / 1000).toFixed(1)}s long
                </p>
                {pending.warnings.length > 0 && (
                  <p className="text-micro text-spectrum-amber flex items-start gap-1 pt-0.5">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-px" />
                    <span>{pending.warnings.slice(0, 2).join(' · ')}</span>
                  </p>
                )}
              </div>

              {/* Preview */}
              <div className="well max-h-28 overflow-y-auto p-1.5 space-y-1">
                {pending.cues.slice(0, 6).map((cue) => (
                  <div key={cue.index} className="flex gap-2 text-micro">
                    <span className="font-mono text-spectrum-textFaint tabular flex-shrink-0">
                      {(cue.startMs / 1000).toFixed(1)}s
                    </span>
                    <span className="text-spectrum-textMuted truncate">{cue.text.replace(/\n/g, ' ')}</span>
                  </div>
                ))}
                {pending.cues.length > 6 && (
                  <p className="text-micro text-spectrum-textFaint pt-0.5">
                    +{pending.cues.length - 6} more…
                  </p>
                )}
              </div>

              <SliderRow
                label="Timing offset"
                min={-5000} max={5000} step={50} unit="ms" bipolar defaultValue={0}
                value={offsetMs} onChange={setOffsetMs}
              />

              <ToggleRow
                label="Reflow long lines"
                hint={`Split cues longer than ${maxChars} characters`}
                checked={reflow}
                onChange={setReflow}
              />
              {reflow && (
                <SliderRow label="Max characters per line" min={20} max={80} step={1} defaultValue={42}
                  value={maxChars} onChange={setMaxChars} />
              )}
              <ToggleRow
                label="Replace existing captions"
                hint="Otherwise the new cues are added alongside"
                checked={replaceExisting}
                onChange={setReplaceExisting}
              />

              <div className="grid grid-cols-2 gap-1.5">
                <button onClick={() => setPending(null)} className="pro-btn-filled h-7 text-ui-sm">
                  Cancel
                </button>
                <button onClick={confirmImport} className="btn-primary h-7 text-ui-sm gap-1.5">
                  <Check className="w-3 h-3" /> Import
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-20 rounded-squircle-sm border border-dashed border-line-strong hover:border-spectrum-accent hover:bg-spectrum-accentSoft/40 transition-colors flex flex-col items-center justify-center gap-1.5 group"
              >
                <Upload className="w-4 h-4 text-spectrum-textDim group-hover:text-spectrum-accent transition-colors" />
                <span className="text-ui-sm text-spectrum-textMuted group-hover:text-spectrum-text">
                  Drop a subtitle file, or click to browse
                </span>
                <span className="text-micro text-spectrum-textFaint font-mono">
                  SRT · VTT · ASS · SSA · SBV · JSON
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".srt,.vtt,.ass,.ssa,.sbv,.json,.txt"
                className="hidden"
                onChange={(e) => e.target.files && readFiles(e.target.files)}
              />
            </>
          )}
        </Section>

        {/* ── Style ── */}
        <Section title="Caption style" icon={Type}>
          <div className="grid grid-cols-2 gap-1.5">
            {CAPTION_STYLES.map((preset) => (
              <button
                key={preset.id}
                onClick={() => setStyleId(preset.id)}
                className={`p-2 rounded-squircle-sm border text-left transition-colors ${
                  styleId === preset.id
                    ? 'bg-spectrum-accentSoft border-spectrum-accentLine'
                    : 'bg-spectrum-card border-line hover:bg-spectrum-cardHover'
                }`}
              >
                <span
                  className={`block text-ui-sm font-semibold ${
                    styleId === preset.id ? 'text-spectrum-accent' : 'text-spectrum-text'
                  }`}
                >
                  {preset.label}
                </span>
                <span className="block text-micro text-spectrum-textDim truncate">
                  {preset.style.kineticAnimation?.replace(/_/g, ' ')}
                </span>
              </button>
            ))}
          </div>
        </Section>

        {/* ── Generate ── */}
        <Section title="Speech to text" icon={Sparkle}>
          <div className="space-y-2">
            <div className="space-y-1">
              <span className="text-ui-sm text-spectrum-textMuted flex items-center justify-between">
                <span>Transcription Engine</span>
                {engine === 'vibevoice' && (
                  <span className="chip !text-spectrum-pink !border-spectrum-pink/30 text-micro">Diarized</span>
                )}
              </span>
              <select
                value={engine}
                onChange={(e) => setEngine(e.target.value as any)}
                className="pro-input w-full h-7 px-2 text-ui-sm cursor-pointer"
              >
                <option value="vibevoice">Microsoft VibeVoice (Multi-Speaker Diarization)</option>
                <option value="whisper">Whisper (Single Speaker Fast)</option>
              </select>
            </div>

            <div className="space-y-1">
              <span className="text-ui-sm text-spectrum-textMuted flex items-center gap-1.5">
                <Globe className="w-3 h-3 text-spectrum-accent" /> Language
              </span>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="pro-input w-full h-7 px-2 text-ui-sm cursor-pointer"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
          </div>

          <button onClick={generate} disabled={isBusy} className="btn-primary w-full h-8 gap-1.5 text-ui mt-2">
            <Subtitles className="w-3.5 h-3.5" />
            {isBusy ? 'Transcribing…' : engine === 'vibevoice' ? 'Generate Diarized Captions' : 'Generate captions'}
          </button>
        </Section>

        {/* ── Export ── */}
        <Section title="Export" icon={Download} defaultOpen={captionCount > 0}>
          {captionCount === 0 ? (
            <p className="text-micro text-spectrum-textFaint">
              Import or generate captions first, then export them in any format.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {(['srt', 'vtt', 'ass', 'sbv', 'json'] as CaptionFormat[]).map((format) => (
                <button
                  key={format}
                  onClick={() => exportAs(format)}
                  className="pro-btn-filled h-7 gap-1 text-micro uppercase font-mono"
                  title={`Download as .${format}`}
                
            aria-label={`Download as .${format}`}>
                  <FileText className="w-3 h-3" />
                  {format}
                </button>
              ))}
            </div>
          )}
        </Section>
      </div>

      {isDropping && (
        <div className="absolute inset-0 bg-spectrum-accent/10 flex items-center justify-center pointer-events-none">
          <div className="card px-4 py-3 text-center">
            <Subtitles className="w-5 h-5 text-spectrum-accent mx-auto mb-1" />
            <p className="text-ui-sm font-medium text-spectrum-text">Drop the subtitle file</p>
          </div>
        </div>
      )}
    </div>
  );
};
