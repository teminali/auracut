/* ═══════════════════════════════════════════════════════════════════
   REMOVED — this module used to fake transcription.

   `transcribeAudioOnDevice` slept 1200ms and returned the same
   hardcoded Kiswahili sentence for every input, ignoring its audioUrl
   argument entirely, while `generate_auto_captions` advertised
   "on-device speech-to-text". Any user captioning their own footage
   would have received somebody else's marketing copy, with the agent
   reporting success.

   Real transcription now lives in electron/transcribe.ts: ffmpeg
   extracts the audio and a local Whisper does the work. It runs in the
   main process because a renderer cannot reach either binary, and it
   fails loudly when they are missing rather than inventing words.
   ═══════════════════════════════════════════════════════════════════ */

export {};
