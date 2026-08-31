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
  TUTORIAL_ASSEMBLE, RAW_ASSEMBLE, CAPTION_STYLE, CAPTION_MAX_CHARS,
} from './recordingProject';
import {
  auditCaptions, repairCaptions, buildCleanupRequest, parseCleanupReply, CaptionAudit,
  buildReviewRequest, parseReviewReply,
} from './captionQuality';
import { EmphasisWord, WordTier, MAX_STACK } from './kineticCaptions';
import { balanceLines } from './captions';

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
  /** Generated and cleaned captions available in real-time */
  cues?: SpeechCue[];
  currentCue?: string;
}

export interface TutorialOptions extends Partial<AssembleOptions> {
  /** Transcribe the narration. Off makes this the raw assembly plus the look. */
  transcribe: boolean;
  /** Whisper model name, when transcription runs. */
  model?: string;
  language?: string;
  /**
   * Send the transcript to the configured agent CLI to be spell-checked.
   *
   * Only the MODEL pass. The deterministic audit and the repairs that
   * follow from it are not optional and have no switch: they cost
   * nothing, they need nothing installed, and their absence is the bug
   * that made this whole thing necessary — a caption track that was one
   * hallucinated line repeated 109 times shipped as a success because
   * nothing read the words.
   */
  cleanCaptions?: boolean;
}

export const DEFAULT_TUTORIAL: TutorialOptions = { transcribe: true, cleanCaptions: true };

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

    /*
      Whisper heard sound here and produced no words for it. Say so.

      These are filtered out of the captions on purpose — nobody wants a
      line reading "[Music]" — and used to be filtered out of existence.
      On a take that opened with 25 seconds of Swahili, an English-only
      model returned one `(speaking in foreign language)` marker for the
      whole opening, and every layer above saw a take whose first words
      were 25 seconds in. The introduction detector refused, correctly,
      on a transcript that was wrong, and nothing anywhere said why.
    */
    const notes: string[] = [];
    const lost = (result.nonSpeech ?? []).filter((m) => m.endMs > m.startMs);
    const lostMs = lost.reduce((sum, m) => sum + (m.endMs - m.startMs), 0);
    if (lostMs >= 3000) {
      const foreign = lost.some((m) => /foreign|language|spanish|french/i.test(m.text));
      notes.push(
        `${Math.round(lostMs / 1000)}s of this take made sound that Whisper produced no words `
        + `for, the longest at ${Math.round(lost[0].startMs / 1000)}s: "${lost[0].text}". `
        + (foreign
          ? `It ran \`${result.model}\` and read the language as \`${result.language}\`. That `
            + 'marker is what Whisper returns when it is decoding the wrong language, so try '
            + 'setting the spoken language explicitly. Captions and the camera cuts are both '
            + 'placed from the words, so they are missing from that stretch.'
          : 'Captions and the camera cuts are both placed from the words, so they are missing '
            + 'from that stretch.')
      );
    }

    return {
      cues: result.segments
        .filter((segment) => segment.text.trim().length > 0)
        .map((segment) => ({
          startMs: segment.startMs + source.offsetMs,
          endMs: segment.endMs + source.offsetMs,
          text: segment.text.trim(),
        })),
      notes,
    };
  } finally {
    off();
  }
}

/**
 * Generate, audit, and clean the captions for a take before project assembly.
 * Allows the recording studio to preview the exact transcript in real time.
 */
export async function generateTakeCaptions(
  take: Take,
  options: Partial<TutorialOptions> = {},
  onProgress?: (progress: TutorialProgress) => void
): Promise<{ cues: SpeechCue[]; notes: string[] }> {
  const o = { ...DEFAULT_TUTORIAL, ...options };
  const notes: string[] = [];

  let speech: SpeechCue[] = options.speech ?? [];
  if (speech.length === 0) {
    onProgress?.({ phase: 'transcribing', percent: 10, note: 'Listening to narration...' });
    const result = await transcribe(take, o, (percent, note) => {
      onProgress?.({
        phase: 'transcribing',
        percent: 10 + Math.round(percent * 0.4),
        note: percent >= 100 ? 'Narration transcribed, reviewing text...' : (note || 'Transcribing speech...'),
      });
    });
    speech = result.cues;
    notes.push(...result.notes);
  }

  if (speech.length > 0) {
    const reviewed = auditAndRepairCaptions(speech);
    speech = reviewed.cues;
    notes.push(...reviewed.notes);

    if (o.cleanCaptions !== false) {
      onProgress?.({
        phase: 'transcribing',
        percent: 60,
        note: 'Polishing captions with AI review...',
        cues: speech,
        currentCue: speech[speech.length - 1]?.text,
      });
      const review = await reviewCaptions(speech, o.language);
      speech = review.cues;
      notes.push(...review.notes);
    }
  }

  onProgress?.({
    phase: 'done',
    percent: 100,
    note: `${speech.length} captions generated`,
    cues: speech,
    currentCue: speech[speech.length - 1]?.text,
  });

  return { cues: speech, notes };
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
    Only when the build could not wait. Started here rather than inside
    `build` because a transcription is worth running only for a take
    that actually became a project.
  */
  if (outcome.result.transcribedInBackground) {
    captionInBackground(take, options, outcome.result.screenClipId);
  } else if (options.cleanCaptions !== false && outcome.result.captionLines > 0) {
    /*
      The captions are on the timeline and the editor is usable. The
      spell-check happens against them, from here, so that the thing the
      user is waiting on is only ever the edit.
    */
    cleanCaptionsInBackground(outcome.result.screenClipId, options);
  }

  return { ok: true, report: outcome.result, status: outcome.status };
}

async function build(
  take: Take,
  options: Partial<TutorialOptions>,
  onProgress: (progress: TutorialProgress) => void
): Promise<AssembleReport> {
  const o = { ...DEFAULT_TUTORIAL, ...options };
  const notes: string[] = [];
  /*
    A transcript the caller already has wins over one this could make.

    It arrives from a `transcript.json` beside the take, which is a
    feature rather than a test hook: a scripted tutorial has its words
    written down before it is recorded, and somebody who has them should
    not wait for Whisper to guess at them again. It also makes the parts
    of this skill that READ the words — where the camera cuts, and
    whether the take opens with an introduction — checkable end to end
    without a machine-dependent speech model in the loop.

    Note the ordering below: `assembleRecording` is called with `speech`
    AFTER `...options`, so an options-supplied transcript used to be
    overwritten by the empty local. This is the same value, kept.
  */
  let speech: SpeechCue[] = options.speech ?? [];
  let background = false;

  if (speech.length > 0) {
    notes.push(
      `Using the ${speech.length}-line transcript supplied with the take rather than `
      + 'transcribing it again.'
    );
    onProgress({
      phase: 'transcribing',
      percent: 25,
      note: `${speech.length} captions ready`,
      cues: speech,
      currentCue: speech[speech.length - 1]?.text,
    });
  } else if (o.transcribe) {
    onProgress({ phase: 'transcribing', percent: 10, note: 'Listening to narration...' });
    const result = await transcribe(take, o, (percent, note) => {
      onProgress({
        phase: 'transcribing',
        percent: 10 + Math.round(percent * 0.35),
        note: percent >= 100 ? 'Narration transcribed, processing words...' : (note || 'Transcribing speech...'),
      });
    });
    speech = result.cues;
    notes.push(...result.notes);
    if (speech.length > 0) {
      onProgress({
        phase: 'transcribing',
        percent: 38,
        note: `Transcribed ${speech.length} caption lines`,
        cues: speech,
        currentCue: speech[speech.length - 1]?.text,
      });
    }
  }

  let emphasis: Map<number, EmphasisWord[]> | undefined;

  if (speech.length > 0) {
    const reviewed = auditAndRepairCaptions(speech);
    speech = reviewed.cues;
    notes.push(...reviewed.notes);
  }

  if (speech.length > 0 && o.cleanCaptions !== false) {
    onProgress({
      phase: 'transcribing',
      percent: 40,
      note: 'Checking the words before they go on screen',
      cues: speech,
      currentCue: speech[speech.length - 1]?.text,
    });
    const review = await reviewCaptions(speech, o.language);
    speech = review.cues;
    emphasis = review.emphasis;
    notes.push(...review.notes);
  }

  onProgress({
    phase: 'building',
    percent: 45,
    note: `Building the edit with ${speech.length} captions`,
    cues: speech,
    currentCue: speech[speech.length - 1]?.text,
  });

  const report = await assembleRecording(take, {
    ...TUTORIAL_ASSEMBLE,
    ...options,
    speech,
    ...(emphasis ? { emphasis } : {}),
  });

  onProgress({
    phase: 'done',
    percent: 100,
    note: 'Done',
    cues: speech,
    currentCue: speech[speech.length - 1]?.text,
  });

  if (background) {
    notes.push(
      'Only the CPU version of Whisper is installed, which takes several times longer than the '
      + 'take itself, so the narration is being transcribed in the background and the captions '
      + 'will land on their own track. Camera cuts were placed from activity rather than from '
      + 'sentence boundaries. `brew install whisper-cpp` makes this near-instant.'
    );
  }
  return { ...report, notes: [...notes, ...report.notes], transcribedInBackground: background };
}

/* ── Reading the words before they go on screen ─────────────────── */

export interface CaptionReview {
  cues: SpeechCue[];
  notes: string[];
  audit: CaptionAudit;
}

/**
 * Audit the transcript, repair what can be repaired, and only then let
 * a model near it.
 *
 * The order is the whole design and it is not interchangeable. The
 * deterministic pass DELETES: a run of identical lines is not a set of
 * typos, it is what a latched decoder emits while decoding nothing, and
 * the words that were spoken under it are not in the text at all. Ask a
 * model to tidy that and it will write four minutes of fluent narration
 * nobody said — in the right language, in the right register, and
 * completely invented — which turns a failure anyone can see into one
 * nobody can. So the loops go first, and the model only ever sees lines
 * that have real content in them.
 *
 * Every path through here is non-fatal. No transcriber, no agent CLI,
 * a refused reply, a timeout: the captions come out at least as good as
 * they went in, and the report says what happened.
 */
/**
 * The half that costs nothing: audit, then delete what was never said.
 *
 * Synchronous on purpose. Everything here is arithmetic over strings,
 * it needs no model and no network, and it runs on every build whatever
 * else is switched off, because its absence is the bug the whole module
 * exists for.
 */
export function auditAndRepairCaptions(cues: SpeechCue[]): CaptionReview {
  const notes: string[] = [];
  const audit = auditCaptions(cues);

  /*
    Said whatever else happens, including when nothing is wrong: a
    report that only speaks up on failure cannot be told apart from one
    that is not running.
  */
  if (audit.defects.length > 0) notes.push(`Captions: ${audit.summary}`);

  const repair = repairCaptions(cues, audit);
  notes.push(...repair.notes);

  if (!audit.usable) {
    /*
      Past this much loss the surviving lines are not a transcript, they
      are the fragments around the edges of one, and captioning a film
      with them implies the rest was silence.
    */
    notes.push(
      `The transcriber lost ${Math.round(audit.loopedShare * 100)}% of this take to a repetition `
      + 'loop, so most of the narration was never transcribed and has no captions. This is '
      + 'usually the take being long rather than the audio being bad: try again with the '
      + 'spoken language set explicitly, or transcribe from the Captions panel afterwards.'
    );
  }

  return { cues: repair.cues, notes, audit };
}

/* ── The model pass, after the edit is on screen ────────────────── */

const CLEAN_TOAST = 'tutorial-caption-clean';

/**
 * Spell-check the captions that are already on the timeline.
 *
 * NOT awaited by the build, and that is the whole point of it being
 * here rather than inline. It spawns an agent CLI, which takes as long
 * as it takes, and a minute of an unmoving progress bar is a worse
 * experience than captions that improve a moment after the editor
 * opens. The same reasoning, and the same shape, as
 * `captionInBackground`.
 *
 * It reads the text off the CLIPS rather than being handed the cues, so
 * it is correcting exactly what is on screen, including the line breaks
 * `balanceLines` put there. Those breaks are removed before the model
 * sees them and recomputed afterwards, because a corrected line is a
 * different length and would otherwise keep a break in the wrong place.
 */
export function cleanCaptionsInBackground(
  anchorClipId: string,
  options: Partial<TutorialOptions> = {}
): void {
  const api = window.electronAPI;
  if (!api?.captions) return;

  const captionClips = () => useTimelineStore.getState().tracks
    .filter((track) => track.type === 'text')
    .flatMap((track) => track.clips)
    .filter((clip) => clip.textStyle?.text)
    .sort((a, b) => a.startTimeMs - b.startTimeMs);

  const stillThere = () => useTimelineStore
    .getState()
    .tracks.some((track) => track.clips.some((clip) => clip.id === anchorClipId));

  const clips = captionClips();
  if (clips.length === 0 || !stillThere()) return;

  const ui = useUiStore.getState();
  ui.pushToast({
    id: CLEAN_TOAST,
    kind: 'progress',
    title: 'Checking the captions',
    detail: 'Spelling and word breaks, in the language you spoke. The edit is ready to work on.',
    progress: 0,
    ttl: 0,
  });

  void (async () => {
    try {
      /* Unwrapped: the model is correcting words, not line breaks. */
      const cues: SpeechCue[] = clips.map((clip) => ({
        startMs: clip.startTimeMs,
        endMs: clip.startTimeMs + clip.durationMs,
        text: (clip.textStyle!.text as string).replace(/\s*\n\s*/g, ' ').trim(),
      }));

      const request = buildCleanupRequest(cues, options.language);
      const reply = await api.captions.clean(request.prompt);
      const ui2 = useUiStore.getState();
      ui2.dismissToast(CLEAN_TOAST);

      if (!reply.ok || !reply.text) {
        /*
          Quiet, and deliberately so. Nobody recorded a tutorial in order
          to run a language model over it, and the captions on screen are
          what this shipped before any of it existed. An error toast here
          would report a failure of something the user never asked for.
        */
        return;
      }

      const outcome = parseCleanupReply(reply.text, cues);
      if (outcome.refused || outcome.applied === 0) return;

      /* The project has to still be the one this was started for. */
      if (!stillThere()) return;
      const current = captionClips();
      if (current.length !== clips.length) return;

      const store = useTimelineStore.getState();
      store.beginTransaction();

      /*
        `textStyle.text`, as a PROPERTY PATH.

        `patchClip` addresses properties by dotted path; handed a nested
        object it answers `Unknown property path "textStyle"`. It says so
        in a returned `errors` array rather than by throwing, which is
        how the first version of this wrote nothing at all while
        reporting success: the toast appeared, the model was called, six
        good corrections came back, every one was silently dropped, and
        the only symptom was captions that never changed.

        So the errors are READ. A write API that reports failure in its
        return value and is called without looking at it is a write that
        may as well not have happened.
      */
      let written = 0;
      const failures: string[] = [];
      outcome.cues.forEach((cue, i) => {
        if (cue.text === cues[i].text) return;
        const clip = current[i];
        if (!clip) return;
        const result = store.patchClip(clip.id, {
          'textStyle.text': balanceLines(cue.text, CAPTION_MAX_CHARS),
        });
        if (result.errors.length > 0) failures.push(...result.errors);
        else written += 1;
      });
      store.commitTransaction(`Spell-check ${written} captions`);

      if (written === 0) {
        /* Nothing reached the timeline. Silence here would be the same
           bug again, one layer up. */
        ui2.pushToast({
          kind: 'error',
          title: 'The caption corrections could not be applied',
          detail: failures[0] ?? 'The caption clips were not where they were expected.',
          ttl: 10000,
        });
        return;
      }

      ui2.pushToast({
        kind: 'success',
        title: `${written} caption${written === 1 ? '' : 's'} corrected`,
        detail: `Spelling and word breaks, checked with ${reply.backend}. `
          + 'Undo puts them back in one step.',
        ttl: 7000,
      });
    } catch {
      useUiStore.getState().dismissToast(CLEAN_TOAST);
    }
  })();
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

      /*
        The same review the foreground path runs, for the same reason.

        This is the SLOW-Whisper path, so it is the one most likely to
        be handed a long take, and length is what triggers the
        repetition loop in the first place. Auditing one path and not
        the other would mean the captions most at risk are the ones
        nobody checks.
      */
      const reviewed = auditAndRepairCaptions(result.cues);
      if (reviewed.cues.length === 0) {
        ui2.pushToast({
          kind: 'info',
          title: 'No captions were added',
          detail: reviewed.notes[0] ?? 'Nothing usable was transcribed.',
          ttl: 12000,
        });
        return;
      }

      const added = addCaptionTrack(reviewed.cues, options.captionStyle ?? CAPTION_STYLE);
      ui2.pushToast({
        kind: reviewed.audit.usable ? 'success' : 'info',
        title: `${added} caption${added === 1 ? '' : 's'} added`,
        detail: reviewed.audit.usable
          ? 'On their own track, in Inter Bold. Undo removes them in one step.'
          : reviewed.notes.find((n: string) => n.includes('repetition loop'))
            ?? 'Some of the narration was not transcribed.',
        ttl: reviewed.audit.usable ? 6000 : 14000,
      });

      /* And then the model pass, on the captions that just landed. */
      if (options.cleanCaptions !== false) {
        cleanCaptionsInBackground(anchorClipId, options);
      }
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

/* ── The review, before the words reach the timeline ────────────── */

/**
 * How long the agent CLI gets before the edit goes ahead without it.
 *
 * Measured against the thing it is trading off. The edit itself takes
 * one to two seconds to assemble, and transcription on the fast backend
 * takes 2.2 seconds for 92 seconds of narration — so the whole build is
 * a few seconds, and a review that takes a minute would be 95% of the
 * wait for a step nobody asked for by name.
 *
 * 45 seconds is what a reply to a hundred-odd short lines actually
 * takes on the CLIs Kerf drives, plus headroom. Past it the words are
 * used as they are: uncorrected captions on the timeline in three
 * seconds beat corrected ones in four minutes, and the background
 * spell-check can still fix them afterwards.
 */
export const REVIEW_TIMEOUT_MS = 45_000;

export interface CaptionReviewOutcome {
  cues: SpeechCue[];
  emphasis?: Map<number, EmphasisWord[]>;
  notes: string[];
}

/**
 * Turn the review reply's word INDICES into drawable emphasis words.
 *
 * The model returns positions into the corrected line, which is the
 * only thing it can return that survives the line being corrected. This
 * is where they become text, and where the tiers are decided:
 *
 *   · the hero the model named is `emphasis` — green, and the biggest
 *     thing in the frame;
 *   · everything else is `major` or `normal` by length, on the same
 *     five-character split `pickEmphasis` uses, so a stack built from a
 *     model reply and one built without a model have the same rhythm.
 *
 * A word that comes back empty after punctuation is stripped is
 * dropped rather than drawn, because the model counted a token that has
 * no letters in it.
 */
function emphasisFrom(
  line: string,
  words: number[],
  hero: number | null
): EmphasisWord[] {
  const tokens = line.split(/\s+/).filter((t) => t.length > 0);
  const out: EmphasisWord[] = [];

  words.slice(0, MAX_STACK).forEach((wordIndex, i) => {
    const raw = tokens[wordIndex];
    if (!raw) return;
    const text = raw.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}!?']+$/u, '').trim();
    if (text.length === 0) return;
    const tier: WordTier = i === hero
      ? 'emphasis'
      : text.length >= 5 ? 'major' : 'normal';
    out.push({ text, index: wordIndex, tier });
  });

  return out;
}

/**
 * Correct the transcript and choose its emphasis words, in one turn.
 *
 * Every failure here is a NOTE and never an error, and the cues come
 * back at least as good as they went in on all of them. The list is
 * long on purpose — this is a language model reached through a CLI that
 * may not be installed, over a network that may not be there, and the
 * one outcome that must never happen is a build that fails because a
 * spell-check did.
 */
export async function reviewCaptions(
  cues: SpeechCue[],
  language?: string
): Promise<CaptionReviewOutcome> {
  const api = window.electronAPI;
  if (!api?.captions) return { cues, notes: [] };

  const request = buildReviewRequest(cues, language);

  let reply: { ok: boolean; text?: string; backend?: string; error?: string };
  try {
    /*
      Raced rather than cancelled, because `captions.clean` has no
      cancel: the CLI keeps running in main and its answer is dropped.
      That is the right trade here — the process exits on its own and
      the alternative is a build that hangs on it.
    */
    reply = await Promise.race([
      api.captions.clean(request.prompt),
      new Promise<{ ok: boolean; error: string }>((resolve) =>
        setTimeout(
          () => resolve({ ok: false, error: 'timeout' }),
          REVIEW_TIMEOUT_MS
        )
      ),
    ]);
  } catch (error) {
    return {
      cues,
      notes: [`The caption review did not run (${(error as Error).message}), so the words are `
        + 'the transcriber’s own. They can be corrected from the Captions panel.'],
    };
  }

  if (!reply.ok || !reply.text) {
    const timedOut = reply.error === 'timeout';
    return {
      cues,
      notes: [timedOut
        ? `The caption review took longer than ${Math.round(REVIEW_TIMEOUT_MS / 1000)}s, so the `
          + 'edit was built with the transcriber’s own words rather than making you wait. '
          + 'The spell-check runs again in the background.'
        : 'No agent CLI answered, so the captions are the transcriber’s own words and the '
          + 'emphasis was chosen by word length rather than by meaning.'],
    };
  }

  const outcome = parseReviewReply(reply.text, cues);
  if (outcome.refused) {
    return {
      cues,
      notes: [`The caption review was refused and none of it was used: ${outcome.refused}`],
    };
  }

  const emphasis = new Map<number, EmphasisWord[]>();
  outcome.reviewed.forEach((entry, index) => {
    const words = emphasisFrom(entry.text, entry.emphasis, entry.hero);
    if (words.length > 0) emphasis.set(index, words);
  });

  const notes: string[] = [];
  if (outcome.corrected > 0 || emphasis.size > 0) {
    notes.push(
      `Captions reviewed with ${reply.backend ?? 'the agent CLI'} before they were placed: `
      + `${outcome.corrected} line${outcome.corrected === 1 ? '' : 's'} corrected, `
      + `${emphasis.size} phrase${emphasis.size === 1 ? '' : 's'} given their emphasis words.`
      + (outcome.rejected.length > 0
        ? ` ${outcome.rejected.length} suggested change${outcome.rejected.length === 1 ? ' was' : 's were'} `
          + 'refused as invention rather than correction.'
        : '')
    );
  }

  return { cues: outcome.cues, emphasis: emphasis.size > 0 ? emphasis : undefined, notes };
}
