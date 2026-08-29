/*
 * Which text track becomes the `.srt` beside the render.
 *
 * The Tutorial skill leaves TWO text tracks on the timeline, and they
 * are not interchangeable: `T1 · Subtitles` is whole sentences and is
 * muted, `T2 · Captions` is one clip per word and is what the viewer
 * sees. Picking the wrong one produces a subtitle file with one word
 * per cue, which is worse than writing none because it looks like it
 * worked and only fails on somebody else's video player.
 *
 * The rule is measured rather than named, so it survives a renamed
 * track, a hand-built project and an imported `.srt`.
 */
import { describe, it, expect } from 'vitest';
import { subtitleCues } from './exportPipeline';
import { Track, createClip } from '../types/edl';

let n = 0;
const textTrack = (
  name: string,
  lines: { text: string; startMs: number; durationMs?: number }[],
  extra: Partial<Track> = {}
): Track => ({
  id: `tr_${name}`,
  type: 'text',
  name,
  index: 0,
  muted: false,
  locked: false,
  solo: false,
  volume: 1,
  heightPx: 40,
  collapsed: false,
  ...extra,
  clips: lines.map((line) =>
    createClip({
      id: `c${n++}`,
      trackId: `tr_${name}`,
      type: 'text',
      name: line.text.slice(0, 20),
      startTimeMs: line.startMs,
      durationMs: line.durationMs ?? 1500,
      textStyle: { text: line.text },
    })
  ),
});

const SENTENCES = [
  { text: 'The encoder crashed on export', startMs: 0 },
  { text: 'So we rewrote the pipeline', startMs: 2000 },
];
const WORDS = [
  { text: 'encoder', startMs: 0 },
  { text: 'crashed', startMs: 400 },
  { text: 'pipeline', startMs: 2000 },
];

describe('subtitleCues', () => {
  it('picks the sentence track over the one-word kinetic track', () => {
    const { cues } = subtitleCues([
      textTrack('T2 · Captions', WORDS),
      textTrack('T1 · Subtitles', SENTENCES),
    ]);
    expect(cues.map((c) => c.text)).toEqual([
      'The encoder crashed on export',
      'So we rewrote the pipeline',
    ]);
  });

  it('picks it even when it is MUTED, because muting is why it qualifies', () => {
    /*
      The Tutorial skill mutes the sentence track precisely because the
      kinetic one is drawing the words on screen. So the track that must
      not be burned into the picture is exactly the track that must be
      written to the sidecar, and a "visible clips only" rule gets this
      backwards.
    */
    const { cues } = subtitleCues([
      textTrack('T2 · Captions', WORDS),
      textTrack('T1 · Subtitles', SENTENCES, { muted: true }),
    ]);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe('The encoder crashed on export');
  });

  it('does not depend on the track being called anything in particular', () => {
    const { cues } = subtitleCues([
      textTrack('Kinetic', WORDS),
      textTrack('Track 4', SENTENCES),
    ]);
    expect(cues).toHaveLength(2);
  });

  it('writes nothing, with a reason, when the only text is one word a clip', () => {
    const { cues, note } = subtitleCues([textTrack('T2 · Captions', WORDS)]);
    expect(cues).toEqual([]);
    expect(note).toContain('1.0 words a clip');
  });

  it('writes nothing and says nothing when there is no text at all', () => {
    const { cues, note } = subtitleCues([]);
    expect(cues).toEqual([]);
    expect(note).toBeUndefined();
  });

  it('unwraps the layout’s line breaks, which are not the transcript’s', () => {
    const { cues } = subtitleCues([
      textTrack('T1', [{ text: 'The encoder crashed\non export today', startMs: 0 }]),
    ]);
    expect(cues[0].text).toBe('The encoder crashed on export today');
  });

  it('numbers cues from one and keeps them in timeline order', () => {
    const { cues } = subtitleCues([
      textTrack('T1', [
        { text: 'So we rewrote the pipeline', startMs: 2000 },
        { text: 'The encoder crashed on export', startMs: 0 },
      ]),
    ]);
    expect(cues.map((c) => c.index)).toEqual([1, 2]);
    expect(cues[0].startMs).toBe(0);
  });

  it('ignores empty and whitespace-only clips rather than emitting blank cues', () => {
    const { cues } = subtitleCues([
      textTrack('T1', [
        { text: 'The encoder crashed on export', startMs: 0 },
        { text: '   ', startMs: 2000 },
      ]),
    ]);
    expect(cues).toHaveLength(1);
  });
});
