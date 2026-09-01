import { describe, it, expect } from 'vitest';
import { repairCaptions, parseReviewReply, buildReviewRequest } from './captionQuality';
import { buildKineticCaptions } from './kineticCaptions';
import { serializeCaptions } from './captions';
import { SpeechCue } from './recordingProject';

describe('Subtitle Extraction & Polishing Cleanness Pipeline (End-to-End)', () => {
  it('cleans raw transcript through deterministic audit, LLM review, and builds clean kinetic subtitle track', () => {
    // 1. Raw noisy transcript with repetition loops, stutters, and typos
    const rawSpeech: SpeechCue[] = [
      { startMs: 0, endMs: 2500, text: 'Hello and welcom to TeminaliCut video editr.' },
      { startMs: 2500, endMs: 5000, text: 'First we click on the setings button.' },
      // Stutter defect:
      { startMs: 5000, endMs: 8000, text: 'akaunti akaunti akaunti akaunti tuneita payables' },
      // Non-speech noise marker:
      { startMs: 8000, endMs: 9500, text: '[Music playing]' },
      // Normal speech with minor casing/spelling issues:
      { startMs: 9500, endMs: 13000, text: 'now we run the mcp server on port eight thousand.' },
    ];

    // 2. Deterministic Audit & Repair
    const repaired = repairCaptions(rawSpeech);
    expect(repaired.cues).toHaveLength(4); // [Music playing] removed
    expect(repaired.cues[2].text).toBe('akaunti tuneita payables'); // Stutter collapsed

    // 3. LLM Review & Polish (Spelling, proper nouns, hero word emphasis)
    const reviewPayload = JSON.stringify([
      { i: 0, text: 'Hello and welcome to TeminaliCut video editor.', words: [0, 3, 4], hero: 3 },
      { i: 1, text: 'First we click on the Settings button.', words: [1, 5], hero: 5 },
      { i: 2, text: 'Akaunti tuneita payables.', words: [0, 2], hero: 2 },
      { i: 3, text: 'Now we run the MCP server on port 8000.', words: [2, 3, 7], hero: 3 },
    ]);

    const reviewed = parseReviewReply(reviewPayload, repaired.cues);
    expect(reviewed.refused).toBeNull();
    expect(reviewed.corrected).toBe(4);
    expect(reviewed.cues[0].text).toBe('Hello and welcome to TeminaliCut video editor.');
    expect(reviewed.cues[1].text).toBe('First we click on the Settings button.');
    expect(reviewed.cues[3].text).toBe('Now we run the MCP server on port 8000.');

    // 4. Kinetic Subtitle Clips Generation
    const { clips } = buildKineticCaptions(reviewed.cues, 'tr_captions', {
      frameWidth: 1920,
      frameHeight: 1080,
    });
    expect(clips.length).toBeGreaterThan(0);
    expect(clips.some((c) => c.textStyle?.text.includes('TeminaliCut'))).toBe(true);

    // 5. Clean Subtitle Export (SRT & VTT)
    const captionCues = reviewed.cues.map((c, idx) => ({
      index: idx + 1,
      startMs: c.startMs,
      endMs: c.endMs,
      text: c.text,
    }));

    const srt = serializeCaptions(captionCues, 'srt');
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,500\nHello and welcome to TeminaliCut video editor.');
    expect(srt).not.toContain('[Music playing]');

    const vtt = serializeCaptions(captionCues, 'vtt');
    expect(vtt).toContain('WEBVTT');
    expect(vtt).toContain('00:00:09.500 --> 00:00:13.000\nNow we run the MCP server on port 8000.');
  });
});
