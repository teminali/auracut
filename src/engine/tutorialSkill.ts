/* ═══════════════════════════════════════════════════════════════════
   The Tutorial skill.

   A take, turned into something you would publish: zooms on real
   clicks, an inset frame on a backdrop, the camera taking the whole
   screen while you are talking rather than doing, click ticks, and
   captions in Inter Bold.

   ── The edit lands first; the words catch up ───────────────────────

   This used to transcribe BEFORE building, because the transcript is
   the only signal in a take that knows where a sentence ends, and two
   edits are better for having it: the camera cuts land between
   sentences rather than mid-word, and a stretch with no speech in it is
   left alone, because a static face over dead air is worse than a
   static screen.

   That ordering was right about the edit and wrong about the person.
   Measured on a real take: **1:32 of narration took 12 minutes 49 to
   transcribe** — `small`, roughly eight times real time — and for all
   of it the editor sat on a modal, unable to do anything at all. A
   twenty-minute recording would be two hours. Nobody is going to wait,
   and worse, they cannot tell a slow transcription from a hung one.

   The eight-times figure is not a tuning problem to be fixed later.
   Whisper prints `FP16 is not supported on CPU; using FP32 instead` on
   every run: the Python implementation decodes on the CPU at 13 to 16
   frames a second and does not touch the GPU. Turning off word
   timestamps buys eight percent. Only a different backend changes the
   order of magnitude, so the fix is to stop waiting for it.

   So the whole edit is built IMMEDIATELY, without the transcript, and
   the transcription runs in the background against the project that is
   now open. The captions arrive on their own track when they are ready.

   What that costs, said plainly rather than hidden: the camera cuts are
   placed from activity alone, which is exactly what already happened on
   any machine without Whisper installed. What it buys is an editor you
   can use in the second after you stop recording.

   ── When there is no transcript ────────────────────────────────────

   Whisper and ffmpeg are not always installed, and a take does not
   always have narration. Every one of those paths is a NOTE and not an
   error: the skill still applies, the zooms are unaffected, the camera
   stays an inset rather than cutting blind, and the report says which
   parts did not run. A skill that refuses to apply because a model is
   missing would be worse than one that applies most of itself and says
   so.
   ═══════════════════════════════════════════════════════════════════ */

import { Take } from './screenCapture';
import { useUiStore } from '../store/uiStore';
import { useTimelineStore } from '../store/timelineStore';
import { ClipTextStyle } from '../types/edl';
import { runSkill, trialStatus } from '../services/skillTrials';
import { TrialStatus } from '../types/electron';
import {
  assembleRecording, AssembleOptions, AssembleReport, SpeechCue,
  TUTORIAL_ASSEMBLE, RAW_ASSEMBLE, CAPTION_STYLE,
} from './recordingProject';

/* ── Who this skill is, for the trial gate ──────────────────────── */

export const TUTORIAL_SKILL_ID = 'tutorial';

/**
 * How many trial runs the bundled build allows.
 *
 * Zero, which means NOT GATED. This skill ships inside Kerf, so counting
 * runs of it would be gating somebody out of something they already
 * have. It is stated rather than omitted because "no trial" and "nobody
 * thought about it" should not look the same, and because a published
 * variant of the same skill passes its own number through `gate`.
 */
export const TUTORIAL_TRIAL_USES = 0;

export interface SkillGate {
  /** What the publisher allows. 0 means not gated. */
  trialUses: number;
  /** A verified entitlement for this skill. */
  owned: boolean;
}

export const BUNDLED_GATE: SkillGate = { trialUses: TUTORIAL_TRIAL_USES, owned: true };

/**
 * What a trial run BUYS, when this skill is gated.
 *
 * A take, not an invocation. Spend a run turning a recording into a
 * tutorial and that recording stays yours: undo it, reopen it, change
 * your mind about the backdrop and apply it again, at no further cost.
 * What costs a second run is pointing the skill at DIFFERENT footage,
 * which is the thing a publisher is actually selling. Anything else
 * punishes the one behaviour a trial exists to encourage.
 *
 * Derived from the take's CONTENT rather than its path, so moving or
 * renaming the folder does not turn it into a new subject and quietly
 * charge for it again. A cheap hash: this is an identity, not a secret,
 * and a renderer that wanted to forge one could edit this file instead.
 */
export function takeIdentity(take: Take): string {
  const parts = [
    take.durationMs,
    take.cursor.length,
    take.events.length,
    take.marks.length,
    Math.round(take.cursor[0]?.tMs ?? -1),
    Math.round(take.cursor[take.cursor.length - 1]?.tMs ?? -1),
    take.screen ? `${take.screen.width}x${take.screen.height}:${take.screen.bytes}` : 'none',
    take.camera ? `${take.camera.width}x${take.camera.height}:${take.camera.bytes}` : 'none',
  ].join('|');

  // FNV-1a, 32-bit, as hex. Stable across runs and across machines.
  let hash = 0x811c9dc5;
  for (let i = 0; i < parts.length; i++) {
    hash ^= parts.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `take_${hash.toString(16).padStart(8, '0')}_${take.durationMs}`;
}

/** What the studio shows on the button, before anything is spent. */
export function tutorialTrialStatus(take: Take, gate: SkillGate = BUNDLED_GATE): Promise<TrialStatus> {
  return trialStatus(TUTORIAL_SKILL_ID, gate.trialUses, gate.owned, takeIdentity(take));
}

export type TutorialPhase = 'listening' | 'transcribing' | 'building' | 'done';

export interface TutorialProgress {
  phase: TutorialPhase;
  /** 0..100 across the whole run, not within a phase. */
  percent: number;
  note: string;
}

export interface TutorialOptions extends Partial<AssembleOptions> {
  /** Transcribe the narration. Off makes this the raw assembly plus the look. */
  transcribe: boolean;
  /** Whisper model name, when transcription runs. */
  model?: string;
  language?: string;
}

export const DEFAULT_TUTORIAL: TutorialOptions = { transcribe: true };

/* ── Speech ─────────────────────────────────────────────────────── */

interface TranscriptResult {
  cues: SpeechCue[];
  notes: string[];
}

/**
 * The narration, as cues on the TAKE's clock.
 *
 * The offset is the part that is easy to get wrong and impossible to
 * see: the camera file starts `cameraOffsetMs` into the take, so every
 * timestamp Whisper returns is that much early against the timeline. On
 * a take where the camera started 90ms late, captions land 90ms early
 * for the whole film — which reads as sloppy timing rather than as a
 * bug, and nobody goes looking for it.
 */
async function transcribe(
  take: Take,
  options: TutorialOptions,
  onProgress: (percent: number, note: string) => void
): Promise<TranscriptResult> {
  const api = window.electronAPI;
  if (!api?.stt) {
    return { cues: [], notes: ['Transcription needs the desktop app, so there are no captions.'] };
  }

  /* The microphone rides with the camera when there is one, and with the
     screen when there is not. See `screenCapture.ts` on why. */
  const source = take.camera?.hasAudio
    ? { url: take.camera.url, offsetMs: take.cameraOffsetMs }
    : take.screen?.hasAudio
      ? { url: take.screen.url, offsetMs: 0 }
      : null;

  if (!source) {
    return { cues: [], notes: ['This take has no narration to transcribe, so there are no captions.'] };
  }

  const status = await api.stt.status();
  if (!status.ready) {
    const missing = [
      !status.ffmpeg ? 'ffmpeg' : null,
      !status.whisper ? 'whisper' : null,
      status.whisper && status.models.length === 0 ? 'a Whisper model' : null,
    ].filter(Boolean).join(' and ');
    return {
      cues: [],
      notes: [
        `Captions need ${missing}, which is not installed, so this take has none. `
        + 'The zooms and the look are unaffected; the camera stays an inset rather than '
        + 'cutting to a face without knowing where the sentences are.',
      ],
    };
  }

  const off = api.stt.onProgress((p) => onProgress(p.percent, p.note));
  try {
    const result = await api.stt.transcribe({
      mediaUrl: source.url,
      /*
        Segments only. Captions are built from them and nothing here
        reads per-word times. Worth about eight percent, measured, which
        is worth having and is not why this runs in the background.
      */
      wordTimestamps: false,
      ...(options.language ? { language: options.language } : {}),
      ...(options.model ? { model: options.model } : {}),
    });

    if (!result.ok) {
      /*
        Including the case where somebody pressed Skip. Cancelling is a
        choice, not a fault, so it reads as one: the edit is built
        without captions and says so, rather than reporting an error for
        something the user asked for.
      */
      const skipped = /cancel/i.test(result.message ?? '');
      return {
        cues: [],
        notes: [skipped
          ? 'Captions were skipped, so the camera cuts fall on pauses in activity rather than '
            + 'between sentences. Transcribe later from the Captions panel.'
          : `Transcription did not run: ${result.message}`],
      };
    }

    return {
      cues: result.segments
        .filter((segment) => segment.text.trim().length > 0)
        .map((segment) => ({
          startMs: segment.startMs + source.offsetMs,
          endMs: segment.endMs + source.offsetMs,
          text: segment.text.trim(),
        })),
      notes: [],
    };
  } finally {
    off();
  }
}

/* ── Applying it ────────────────────────────────────────────────── */

/**
 * Run the skill over a take and leave the result on the timeline.
 *
 * Progress is reported across the WHOLE run rather than per phase.
 * Transcription is most of the wall clock and the build is a second or
 * two, so a bar that reaches 100% and then sits there while the project
 * is assembled would be lying about the part it is easiest to lie about.
 */
export interface TutorialOutcome {
  ok: boolean;
  report?: AssembleReport;
  /** Why it was refused, when it was. */
  status: TrialStatus;
}

export async function applyTutorialSkill(
  take: Take,
  options: Partial<TutorialOptions> = {},
  onProgress: (progress: TutorialProgress) => void = () => undefined,
  gate: SkillGate = BUNDLED_GATE
): Promise<TutorialOutcome> {
  /*
    The run is spent BEFORE the work starts, and the whole build happens
    inside `runSkill` rather than after a separate check. Spending
    afterwards means a skill that throws halfway is free, and one that is
    quit mid-transcription is free forever.
  */
  const outcome = await runSkill(
    TUTORIAL_SKILL_ID,
    gate.trialUses,
    gate.owned,
    takeIdentity(take),
    () => build(take, options, onProgress)
  );

  if (!outcome.ok) return { ok: false, status: outcome.status };

  /*
    Started here rather than inside `build`, and after the run has been
    paid for: a transcription is only worth starting for a take that
    actually became a project.
  */
  const o = { ...DEFAULT_TUTORIAL, ...options };
  if (o.transcribe) {
    captionInBackground(take, options, outcome.result.screenClipId);
  }

  return { ok: true, report: outcome.result, status: outcome.status };
}

async function build(
  take: Take,
  options: Partial<TutorialOptions>,
  onProgress: (progress: TutorialProgress) => void
): Promise<AssembleReport> {
  const o = { ...DEFAULT_TUTORIAL, ...options };

  onProgress({ phase: 'building', percent: 40, note: 'Building the edit' });

  /*
    No `speech`. The transcript is started after this returns and lands
    on the project that is by then open — see `captionInBackground` and
    the note at the top of this file on why waiting for it was wrong.
  */
  const report = await assembleRecording(take, {
    ...TUTORIAL_ASSEMBLE,
    ...options,
    speech: [],
  });

  onProgress({ phase: 'done', percent: 100, note: 'Done' });

  const notes = [...report.notes];
  if (o.transcribe) {
    notes.push(
      'The narration is being transcribed in the background; the captions will land on their '
      + 'own track when it finishes. Camera cuts were placed from activity rather than from '
      + 'sentence boundaries, which is what happens without a transcript.'
    );
  }
  return { ...report, notes };
}

/* ── The words, afterwards ──────────────────────────────────────── */

const CAPTION_TOAST = 'tutorial-captions';

/**
 * Transcribe in the background and add the captions to the project that
 * is already open.
 *
 * Deliberately NOT awaited by anything. It reports through a progress
 * toast, it can be stopped from there, and it checks that the project it
 * was started for is still the one on screen before it writes anything —
 * somebody who records, opens the take, and then opens a different
 * project entirely must not have a caption track appear over their work
 * twelve minutes later.
 */
export function captionInBackground(
  take: Take,
  options: Partial<TutorialOptions>,
  anchorClipId: string
): void {
  const ui = useUiStore.getState();
  const api = window.electronAPI;
  if (!api?.stt) return;

  ui.pushToast({
    id: CAPTION_TOAST,
    kind: 'progress',
    title: 'Transcribing the narration',
    detail: 'The edit is ready. Captions will land on their own track when this finishes.',
    progress: 0,
    ttl: 0,
  });

  const off = api.stt.onProgress((p) => {
    useUiStore.getState().updateToast(CAPTION_TOAST, {
      progress: Math.max(0, Math.min(100, p.percent)),
      detail: p.note,
    });
  });

  void (async () => {
    try {
      const result = await transcribe(take, { ...DEFAULT_TUTORIAL, ...options }, () => undefined);
      const ui2 = useUiStore.getState();
      ui2.dismissToast(CAPTION_TOAST);

      if (result.cues.length === 0) {
        ui2.pushToast({
          kind: 'info',
          title: 'No captions were added',
          detail: result.notes[0] ?? 'Nothing was transcribed.',
          ttl: 9000,
        });
        return;
      }

      /*
        The edit has to still be the one this was started for.

        Anchored on the SCREEN CLIP, not on the project id. The id was
        the first attempt and it does not work: `buildStarterProject`
        rebuilds every track in place and leaves the id alone, so opening
        the starter while a transcription ran put a caption track on it.
        Measured, not reasoned about. A clip id is minted per build and
        cannot survive the timeline being replaced.
      */
      const stillThere = useTimelineStore
        .getState()
        .tracks.some((track) => track.clips.some((clip) => clip.id === anchorClipId));

      if (!stillThere) {
        ui2.pushToast({
          kind: 'info',
          title: 'Captions were not added',
          detail: `They were transcribed for "${take.dir.split('/').pop()}", and that take is `
            + 'no longer open. Import them from the Captions panel if you want them.',
          ttl: 12000,
        });
        return;
      }

      const added = addCaptionTrack(result.cues, options.captionStyle ?? CAPTION_STYLE);
      ui2.pushToast({
        kind: 'success',
        title: `${added} caption${added === 1 ? '' : 's'} added`,
        detail: 'On their own track, in Inter Bold. Undo removes them in one step.',
        ttl: 6000,
      });
    } catch (err) {
      const ui2 = useUiStore.getState();
      ui2.dismissToast(CAPTION_TOAST);
      ui2.pushToast({
        kind: 'error',
        title: 'Captions could not be transcribed',
        detail: (err as Error).message,
        ttl: 9000,
      });
    } finally {
      off();
    }
  })();
}

/**
 * Put the cues on a track of their own, as one undoable step.
 *
 * A transaction because `importCaptions` writes a clip per cue, and a
 * hundred of them arriving as a hundred history entries would bury
 * whatever the user did while waiting.
 */
function addCaptionTrack(cues: SpeechCue[], style: Partial<ClipTextStyle>): number {
  const store = useTimelineStore.getState();
  store.beginTransaction();
  const trackId = store.addTrack('text', 'T1 · Captions');
  const added = store.importCaptions(
    cues.map((cue, index) => ({
      index: index + 1, startMs: cue.startMs, endMs: cue.endMs, text: cue.text,
    })),
    { trackId, style, replaceExisting: true }
  );
  store.commitTransaction('Add captions');
  return added;
}

/** The take, laid down and nothing else. */
export async function openTakeRaw(take: Take): Promise<AssembleReport> {
  return assembleRecording(take, RAW_ASSEMBLE);
}
