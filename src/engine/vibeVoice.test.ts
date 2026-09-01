import { describe, it, expect, beforeEach } from 'vitest';
import { useTimelineStore } from '../store/timelineStore';
import {
  generateAndAssembleDialogue,
  transcribeWithDiarization,
  getSpeakerColor,
  SPEAKER_COLORS,
  DialogueTurn,
} from './vibeVoiceEngine';
import { serializeCaptions, CaptionCue } from './captions';

describe('VibeVoice Engine & Multi-Speaker Integration', () => {
  beforeEach(() => {
    useTimelineStore.getState().loadProject([], []);
  });

  it('assigns cycling distinct colors for speaker tags', () => {
    const color0 = getSpeakerColor(0);
    const color1 = getSpeakerColor(1);
    const color2 = getSpeakerColor(2);

    expect(color0).toBe(SPEAKER_COLORS[0]);
    expect(color1).toBe(SPEAKER_COLORS[1]);
    expect(color2).toBe(SPEAKER_COLORS[2]);
    expect(color0).not.toBe(color1);
  });

  it('synthesizes multi-speaker script and places clips onto separate audio tracks', async () => {
    const script: DialogueTurn[] = [
      { speaker: 'Host', voiceId: 'en_female_warm', emotion: 'friendly', text: 'Welcome to our show.' },
      { speaker: 'Guest', voiceId: 'en_male_deep', emotion: 'excited', text: 'Thanks for having me!' },
      { speaker: 'Host', voiceId: 'en_female_warm', emotion: 'friendly', text: 'Let us start editing.' },
    ];

    const result = await generateAndAssembleDialogue(script, {
      pauseBetweenSpeakersMs: 250,
      createCaptions: true,
    });

    expect(result.ok).toBe(true);
    expect(result.speakers).toEqual(['Host', 'Guest']);
    expect(result.trackCount).toBe(2);
    expect(result.clipCount).toBe(3);
    expect(result.cueCount).toBeGreaterThan(0);

    const store = useTimelineStore.getState();
    const hostTrack = store.tracks.find((t) => t.name === 'A · Host');
    const guestTrack = store.tracks.find((t) => t.name === 'A · Guest');
    const captionTrack = store.tracks.find((t) => t.type === 'text');

    expect(hostTrack).toBeDefined();
    expect(guestTrack).toBeDefined();
    expect(captionTrack).toBeDefined();

    expect(hostTrack?.clips.length).toBe(2);
    expect(guestTrack?.clips.length).toBe(1);
    expect(captionTrack?.clips.length).toBe(3);
  });

  it('formats diarized captions with speaker tags and proper timestamps', () => {
    const cues: CaptionCue[] = [
      { index: 1, startMs: 0, endMs: 2000, text: 'Hello everyone', speakerId: 'spk1', speakerName: 'Alice', speakerColor: '#38bdf8' },
      { index: 2, startMs: 2200, endMs: 4500, text: 'Hi Alice!', speakerId: 'spk2', speakerName: 'Bob', speakerColor: '#f472b6' },
    ];

    const srt = serializeCaptions(cues, 'srt');
    expect(srt).toContain('00:00:00,000 --> 00:00:02,000');
    expect(srt).toContain('Hello everyone');

    const vtt = serializeCaptions(cues, 'vtt');
    expect(vtt).toContain('WEBVTT');
    expect(vtt).toContain('00:00:00.000 --> 00:00:02.000');
    expect(vtt).toContain('Hello everyone');
  });

  it('handles empty scripts gracefully', async () => {
    await expect(generateAndAssembleDialogue([])).rejects.toThrow();
  });
});
