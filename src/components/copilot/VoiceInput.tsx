/* ═══════════════════════════════════════════════════════════════════
   Speaking to the Copilot instead of typing.

   It records from the microphone, hands the audio to the SAME Whisper
   bridge the captions panel uses, and drops the text into the prompt
   box. It does NOT send. That is deliberate and matches the quick
   action chips: transcription is imperfect, an editing instruction is
   destructive, and reading it before it runs costs one glance.

   Three states, not two (HANDOVER §3). Whether speech is available is
   `unknown` until `stt.status()` answers, because Whisper is an
   optional local install: a mic button that looks ready and then fails
   is worse than one that says it is not set up. Nothing here degrades
   to a fake, and nothing pretends to hear.

   Recording happens in the renderer because that is where
   `getUserMedia` lives, and the bytes go to a temp file because the
   transcriber is an ffmpeg and whisper pipeline in main that reads
   paths, not blobs.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useUiStore } from '../../store/uiStore';
import { Mic, Square, Loader2 } from '../ui/icons';

type Availability = 'unknown' | 'ready' | 'unavailable';
type Phase = 'idle' | 'recording' | 'transcribing';

interface Props {
  /** Called with the transcript. The caller decides what to do with it. */
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

/** Whisper is happiest with 16k mono, and it is a tenth of the bytes. */
const RECORDER_OPTIONS: MediaRecorderOptions[] = [
  { mimeType: 'audio/webm;codecs=opus' },
  { mimeType: 'audio/webm' },
  {},
];

export const VoiceInput: React.FC<Props> = ({ onTranscript, disabled }) => {
  const [available, setAvailable] = React.useState<Availability>('unknown');
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [seconds, setSeconds] = React.useState(0);

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const streamRef = React.useRef<MediaStream | null>(null);
  const pushToast = useUiStore((s) => s.pushToast);

  /* ── Is speech even possible on this machine? ── */
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const api = window.electronAPI?.stt;
      if (!api || typeof navigator.mediaDevices?.getUserMedia !== 'function') {
        if (!cancelled) setAvailable('unavailable');
        return;
      }
      try {
        const s = await api.status();
        if (!cancelled) setAvailable(s.ready ? 'ready' : 'unavailable');
      } catch {
        if (!cancelled) setAvailable('unavailable');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ── A running duration, so a forgotten recording is visible ── */
  React.useEffect(() => {
    if (phase !== 'recording') { setSeconds(0); return; }
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  const releaseMic = React.useCallback(() => {
    // Every track, explicitly. A live track keeps the OS microphone
    // indicator lit, which reads as an app quietly listening.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  React.useEffect(() => releaseMic, [releaseMic]);

  const transcribe = React.useCallback(async (blob: Blob) => {
    setPhase('transcribing');
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const path = await window.electronAPI!.media.writeTemp(`kerf-voice-${Date.now()}.webm`, bytes);
      const result = await window.electronAPI!.stt.transcribe({ mediaUrl: `file://${path}` });

      if (!result.ok) {
        pushToast({ kind: 'error', title: 'Could not transcribe that', detail: result.message });
        return;
      }
      const text = result.text.trim();
      if (!text) {
        // Silence is not an error, and reporting it as one sends people
        // hunting for a broken microphone.
        pushToast({ kind: 'info', title: 'Nothing was said', detail: 'No speech in that recording.' });
        return;
      }
      onTranscript(text);
    } catch (err) {
      pushToast({ kind: 'error', title: 'Could not transcribe that', detail: (err as Error).message });
    } finally {
      setPhase('idle');
    }
  }, [onTranscript, pushToast]);

  const start = React.useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      streamRef.current = stream;

      const opts = RECORDER_OPTIONS.find((o) => !o.mimeType || MediaRecorder.isTypeSupported(o.mimeType)) ?? {};
      const rec = new MediaRecorder(stream, opts);
      chunksRef.current = [];

      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        releaseMic();
        if (blob.size < 1200) {
          // A tap rather than a recording. Nothing to send.
          setPhase('idle');
          return;
        }
        void transcribe(blob);
      };

      rec.start();
      recorderRef.current = rec;
      setPhase('recording');
    } catch (err) {
      releaseMic();
      setPhase('idle');
      const denied = (err as Error).name === 'NotAllowedError';
      pushToast({
        kind: 'error',
        title: denied ? 'Microphone access was refused' : 'Could not start recording',
        detail: denied
          ? 'Allow TeminaliCut the microphone in System Settings, Privacy & Security.'
          : (err as Error).message,
      });
    }
  }, [releaseMic, transcribe, pushToast]);

  const stop = React.useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  if (available === 'unavailable') return null;

  const busy = phase === 'transcribing';
  const recording = phase === 'recording';

  return (
    <button
      onClick={() => (recording ? stop() : void start())}
      disabled={disabled || busy || available === 'unknown'}
      title={
        available === 'unknown' ? 'Checking whether speech is set up'
          : recording ? `Stop and transcribe (${seconds}s)`
            : busy ? 'Transcribing'
              : 'Speak your instruction instead of typing'
      }
      aria-label={recording ? 'Stop recording and transcribe' : 'Record a spoken instruction'}
      className={`relative w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center
                  transition-colors duration-fast ${
        recording
          ? 'bg-spectrum-red/18 text-spectrum-red'
          : 'text-spectrum-textDim hover:text-spectrum-text hover:bg-spectrum-cardHover'
      }`}
    >
      {busy ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : recording ? (
        <>
          <Square className="w-3 h-3" weight="fill" />
          {/* The ring is the only thing on screen that says the mic is
              live, so it is not decorative. */}
          <span className="absolute w-7 h-7 rounded-full animate-pulse-ring pointer-events-none" />
        </>
      ) : (
        <Mic className="w-4 h-4" />
      )}
    </button>
  );
};
