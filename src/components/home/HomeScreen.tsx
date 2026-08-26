/* ═══════════════════════════════════════════════════════════════════
   Home.

   Deliberately NOT CapCut's home, which is a feature launcher: a grid
   of tiles because each of its AI capabilities is a discrete button.
   Kerf's capability is not a grid — it is a conversation and a set
   of skills, so the home screen is organised around INTENT.

   One primary action, and it is a sentence: say what you want to make.
   Nothing else on this screen competes with it. Underneath, in order of
   how often it is actually needed: work in progress, then what you can
   make (skills), then everything else.

   Three rules it is held to, which are what "better" means here rather
   than a number:

     1. Real content over chrome. Every project tile is a frame rendered
        from that project. A wall of grey rectangles is a file dialog
        with extra steps.
     2. One unmistakable primary action. CapCut's home has roughly
        twenty-five clickable things above the fold and three of them
        are advertisements.
     3. No upsell in the workspace. Ever.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useRecentsStore, RecentProject } from '../../store/recentsStore';
import { buildStarterProject } from '../../engine/starterProject';
import { useClaudeAgentStore } from '../../store/claudeAgentStore';
import { useUiStore } from '../../store/uiStore';
import { hasAutosave, restoreAutosave, clearAutosave, deserializeProject } from '../../engine/projectIO';
import { formatDuration } from '../../utils/time';
import {
  Sparkle, Plus, FolderOpen, ArrowUp, Clock, RotateCcw, X, Blocks, Film,
} from 'lucide-react';

/* ── What you can ask for, when you have no idea what to ask for ──── */

const STARTERS = [
  'Cut this down to a 30-second version for Reels',
  'Give the whole thing a warm cinematic grade',
  'Add captions and cut the silence out of the dialogue',
  'Match the style of a reference video I have',
];

interface Props {
  onEnterEditor: () => void;
}

export const HomeScreen: React.FC<Props> = ({ onEnterEditor }) => {
  const [prompt, setPrompt] = React.useState('');
  const [recoverable, setRecoverable] = React.useState(false);

  const recents = useRecentsStore((s) => s.recents);
  const forget = useRecentsStore((s) => s.forget);
  const project = useProjectStore((s) => s.project);
  const setCopilotOpen = useProjectStore((s) => s.setCopilotOpen);
  const agent = useClaudeAgentStore();
  const pushToast = useUiStore((s) => s.pushToast);

  React.useEffect(() => {
    void agent.refreshStatus();
    /*
      Autosave has been writing to localStorage every 20 seconds since
      the app was built, and NOTHING ever read it back — `hasAutosave`
      and `restoreAutosave` were called from nowhere. A user whose app
      crashed had their work sitting right there and was never offered
      it. This is the offer.
    */
    setRecoverable(hasAutosave());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startWithPrompt = async () => {
    const text = prompt.trim();
    if (!text) return;
    onEnterEditor();
    setCopilotOpen(true);
    // Let the editor mount before the turn starts writing to it.
    await new Promise((r) => setTimeout(r, 60));
    void agent.send(text);
  };

  const recover = () => {
    const result = restoreAutosave();
    if (!result.ok) {
      pushToast({ kind: 'error', title: 'Could not recover', detail: result.error });
      return;
    }
    onEnterEditor();
    pushToast({ kind: 'success', title: 'Recovered your last session' });
  };

  const openRecent = (entry: RecentProject) => {
    // The starter is rebuilt from code, not reloaded from a snapshot.
    if (entry.starter) {
      buildStarterProject();
      onEnterEditor();
      pushToast({
        kind: 'info',
        title: 'Opened the starter project',
        detail: 'Kerf\u2019s own logo sting — shapes, text and keyframes. Edit it freely.',
      });
      return;
    }

    if (!entry.snapshot) {
      pushToast({
        kind: 'info',
        title: 'This one is not stored locally',
        detail: entry.filePath ? `Open ${entry.filePath} from the editor.` : 'Reopen it from a file.',
      });
      return;
    }
    // deserializeProject applies straight to the stores; it returns only
    // whether it worked and what could not be relinked.
    const result = deserializeProject(entry.snapshot);
    if (!result.ok) {
      pushToast({ kind: 'error', title: 'Could not open', detail: result.error });
      return;
    }
    if (result.relinkNeeded?.length) {
      pushToast({
        kind: 'info',
        title: `${result.relinkNeeded.length} file${result.relinkNeeded.length > 1 ? 's' : ''} need relinking`,
        detail: 'Their original paths are gone — re-import them from the Media panel.',
      });
    }
    onEnterEditor();
  };

  const agentLabel = agent.status?.label ?? 'Claude Code';
  const agentReady = Boolean(agent.status?.installed);

  return (
    <div className="w-full h-full bg-spectrum-bg overflow-y-auto">
      <div className="mx-auto w-full max-w-[1080px] px-8 py-10 space-y-10">

        {/* ── Identity, kept small. The product is below it. ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-squircle-sm bg-spectrum-accent/15 border border-spectrum-accentLine flex items-center justify-center">
              <Film className="w-4 h-4 text-spectrum-accent" />
            </span>
            <span className="text-ui-lg font-semibold text-spectrum-text tracking-tight">Kerf</span>
          </div>

          <span
            className="flex items-center gap-1.5 text-[10px] font-mono text-spectrum-textFaint"
            title={agentReady ? `${agentLabel} is connected` : 'No agent CLI found — the editor still works'}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${agentReady ? 'bg-spectrum-green' : 'bg-spectrum-textFaint'}`} />
            {agentReady ? agentLabel : 'no agent'}
          </span>
        </div>

        {/* ── The one primary action ── */}
        <div className="space-y-4">
          <h1 className="text-[28px] leading-[1.15] font-semibold text-spectrum-text tracking-[-0.02em]">
            What do you want to make?
          </h1>

          <div className="pro-input flex items-end gap-2 p-2.5">
            <Sparkle className="w-4 h-4 text-spectrum-accent flex-shrink-0 mb-1" />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void startWithPrompt(); }
              }}
              rows={1}
              placeholder="Describe the edit, or drop footage in and say what to do with it…"
              className="flex-1 bg-transparent outline-none text-ui-lg text-spectrum-text placeholder:text-spectrum-textFaint resize-none max-h-32 min-w-0 leading-snug py-1"
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${Math.min(128, el.scrollHeight)}px`;
              }}
            />
            <button
              onClick={startWithPrompt}
              disabled={!prompt.trim()}
              className="btn-primary w-8 h-8 rounded-full flex-shrink-0"
              title="Start (Enter)"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => setPrompt(s)}
                className="h-[26px] px-2.5 rounded-full border border-line text-ui-sm text-spectrum-textMuted
                           hover:border-spectrum-accentLine hover:text-spectrum-text transition-colors"
              >
                {s}
              </button>
            ))}
          </div>

          {/* Editing by hand is a first-class path, not a fallback. */}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={onEnterEditor} className="pro-btn-filled h-[30px] px-3 gap-1.5 text-ui-sm">
              <Plus className="w-3.5 h-3.5" /> New project
            </button>
            <button
              onClick={() => { onEnterEditor(); pushToast({ kind: 'info', title: 'Open a project from the header' }); }}
              className="pro-btn h-[30px] px-3 gap-1.5 text-ui-sm"
            >
              <FolderOpen className="w-3.5 h-3.5" /> Open…
            </button>
          </div>
        </div>

        {/* ── Unsaved work, when there is any ── */}
        {recoverable && (
          <div className="rounded-squircle-sm border border-spectrum-amber/35 bg-spectrum-amber/[0.06] p-3
                          flex items-center gap-3">
            <RotateCcw className="w-4 h-4 text-spectrum-amber flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-ui-sm font-medium text-spectrum-text">You have unsaved work from last time</p>
              <p className="text-[10px] text-spectrum-textDim">Kerf saves a copy every 20 seconds.</p>
            </div>
            <button onClick={recover} className="pro-btn-filled h-[26px] px-2.5 text-ui-sm flex-shrink-0">
              Recover
            </button>
            <button
              onClick={() => { clearAutosave(); setRecoverable(false); }}
              className="pro-btn w-[26px] h-[26px] flex-shrink-0"
              title="Discard it"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* ── Work in progress ── */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-ui-lg font-semibold text-spectrum-text flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-spectrum-textDim" /> Recent
            </h2>
            {recents.length > 0 && (
              <span className="text-[10px] font-mono text-spectrum-textFaint">{recents.length}</span>
            )}
          </div>

          {recents.length === 0 ? (
            <div className="rounded-squircle-sm border border-dashed border-line p-6 text-center">
              <p className="text-ui-sm text-spectrum-textDim">
                Nothing yet. Projects you open will appear here with a frame from the edit.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              {recents.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => openRecent(entry)}
                  className="group text-left rounded-squircle-sm border border-line bg-spectrum-panel
                             overflow-hidden hover:border-spectrum-accentLine transition-colors"
                >
                  <span className="block aspect-video bg-spectrum-sunken overflow-hidden">
                    {entry.posterUrl ? (
                      <img src={entry.posterUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="w-full h-full flex items-center justify-center">
                        <Film className="w-5 h-5 text-spectrum-textFaint" />
                      </span>
                    )}
                  </span>
                  <span className="block p-2">
                    <span className="block text-ui-sm font-medium text-spectrum-text truncate
                                     group-hover:text-spectrum-accent transition-colors">
                      {entry.name}
                    </span>
                    <span className="block text-[9px] font-mono text-spectrum-textFaint tabular mt-0.5">
                      {formatDuration(entry.durationMs)} · {entry.aspectRatio} · {entry.clipCount} clips
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── Skills ──
             The marketplace surface. Honest about not existing yet:
             an empty store dressed as a full one would be exactly the
             theatre the rest of this codebase has had removed. */}
        <section className="space-y-3">
          <h2 className="text-ui-lg font-semibold text-spectrum-text flex items-center gap-1.5">
            <Blocks className="w-3.5 h-3.5 text-spectrum-textDim" /> Skills
          </h2>

          <div className="rounded-squircle-sm border border-line bg-spectrum-panel/60 p-4 space-y-2">
            <p className="text-ui-sm text-spectrum-text font-medium">Not built yet.</p>
            <p className="text-ui-sm text-spectrum-textDim leading-relaxed max-w-[620px]">
              A skill will be a template project, the assets it needs, and the tools to
              generate variations of it — installed like an extension, with new projects
              cloned from it. One prompt to a finished edit, and the template is still
              yours to change by hand afterwards.
            </p>
            <p className="text-[10px] text-spectrum-textFaint">
              See §6 of HANDOVER.md for the format and what has to be in it before there
              are a thousand of them.
            </p>
          </div>
        </section>

      </div>
    </div>
  );
};
