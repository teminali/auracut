/* ═══════════════════════════════════════════════════════════════════
   The Tutorial skill.

   A take, turned into something you would publish: zooms on real
   clicks, an inset frame on a backdrop, the camera taking the whole
   screen while you are talking rather than doing, click ticks, and
   captions in Inter Bold.

   ── Why the words come first ───────────────────────────────────────

   Transcription runs BEFORE the project is built, and that ordering is
   the interesting decision in this file. The obvious arrangement is to
   assemble the edit and then add captions to it, because captions are
   the visible thing the transcript is for. But the transcript is not
   only text: it is the only signal in the whole take that knows where a
   SENTENCE ends.

   Two edits depend on that and cannot be made without it:

     · The camera takeover. The pointer says when nothing is happening
       on screen; it has nothing to say about whether somebody is
       mid-word. `alignToSpeech` trims each stretch inward to the gaps
       between cues, so the cut lands between sentences.

     · Whether a takeover happens at all. A stretch with no speech in it
       is dead air, and a static face over dead air is worse than a
       static screen. The camera takes over when somebody is TALKING and
       not doing.

   Build first and caption afterwards and both of those become
   impossible, because by then the cuts already exist.

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
import { runSkill, trialStatus } from '../services/skillTrials';
import { TrialStatus } from '../types/electron';
import {
  assembleRecording, AssembleOptions, AssembleReport, SpeechCue,
  TUTORIAL_ASSEMBLE, RAW_ASSEMBLE,
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
      ...(options.language ? { language: options.language } : {}),
      ...(options.model ? { model: options.model } : {}),
    });

    if (!result.ok) {
      return { cues: [], notes: [`Transcription did not run: ${result.message}`] };
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

  return outcome.ok
    ? { ok: true, report: outcome.result, status: outcome.status }
    : { ok: false, status: outcome.status };
}

async function build(
  take: Take,
  options: Partial<TutorialOptions>,
  onProgress: (progress: TutorialProgress) => void
): Promise<AssembleReport> {
  const o = { ...DEFAULT_TUTORIAL, ...options };

  let speech: SpeechCue[] = [];
  const notes: string[] = [];

  if (o.transcribe) {
    onProgress({ phase: 'listening', percent: 2, note: 'Looking for narration' });
    const result = await transcribe(take, o, (percent, note) => {
      onProgress({
        phase: 'transcribing',
        // Transcription owns 5..85; the build owns the rest.
        percent: 5 + Math.round((Math.max(0, Math.min(100, percent)) / 100) * 80),
        note,
      });
    });
    speech = result.cues;
    notes.push(...result.notes);
  }

  onProgress({ phase: 'building', percent: 88, note: 'Building the edit' });

  const report = await assembleRecording(take, {
    ...TUTORIAL_ASSEMBLE,
    ...options,
    speech,
  });

  onProgress({ phase: 'done', percent: 100, note: 'Done' });
  return { ...report, notes: [...notes, ...report.notes] };
}

/** The take, laid down and nothing else. */
export async function openTakeRaw(take: Take): Promise<AssembleReport> {
  return assembleRecording(take, RAW_ASSEMBLE);
}
