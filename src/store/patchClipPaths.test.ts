/*
  `patchClip` addresses properties by DOTTED PATH, and says so by
  returning an error rather than by throwing.

  Both halves of that sentence caused a bug worth a test. The tutorial
  skill's caption spell-check called it with a nested object:

      patchClip(id, { textStyle: { ...clip.textStyle, text: corrected } })

  which is the shape the clip itself has, and is not the shape this
  takes. It answered `Unknown property path "textStyle"` in a returned
  `errors` array, wrote nothing, and the caller did not look. The
  observable result was a feature that ran end to end — a toast, a model
  call, six correct rewrites returned — and changed nothing on the
  timeline. Nothing failed anywhere.

  So this pins the contract from both sides: the dotted path works, the
  nested object does not, and the refusal is REPORTED rather than
  silent.
*/
import { describe, it, expect, beforeEach } from 'vitest';
import { useTimelineStore } from './timelineStore';

function aTextClip(): string {
  const store = useTimelineStore.getState();
  const trackId = store.addTrack('text', 'T1 · Captions');
  store.importCaptions(
    [{ index: 1, startMs: 0, endMs: 2000, text: 'befor' }],
    { trackId, replaceExisting: true, style: { fontSize: 42 } }
  );
  return useTimelineStore.getState().tracks
    .find((t) => t.id === trackId)!.clips[0].id;
}

const textOf = (id: string) => useTimelineStore.getState().tracks
  .flatMap((t) => t.clips).find((c) => c.id === id)?.textStyle?.text;

describe('patchClip and property paths', () => {
  let clipId: string;
  beforeEach(() => {
    useTimelineStore.getState().loadProject([], []);
    clipId = aTextClip();
  });

  it('writes through a dotted path', () => {
    const result = useTimelineStore.getState()
      .patchClip(clipId, { 'textStyle.text': 'after' });

    expect(result.errors).toEqual([]);
    expect(result.applied).toContain('textStyle.text');
    expect(textOf(clipId)).toBe('after');
  });

  it('REFUSES a nested object, and says which path it did not know', () => {
    const result = useTimelineStore.getState()
      .patchClip(clipId, { textStyle: { text: 'after' } } as never);

    expect(result.errors.join(' ')).toMatch(/Unknown property path "textStyle"/);
    expect(result.applied).toEqual([]);
  });

  it('leaves the clip untouched when it refuses', () => {
    useTimelineStore.getState()
      .patchClip(clipId, { textStyle: { text: 'after' } } as never);
    expect(textOf(clipId)).toBe('befor');
  });

  it('reports the refusal instead of throwing, which is why it must be read', () => {
    /*
      The property that made the caption bug invisible. A caller that
      wraps this in try/catch and checks nothing sees success.
    */
    expect(() => useTimelineStore.getState()
      .patchClip(clipId, { nonsense: 1 } as never)).not.toThrow();
    expect(useTimelineStore.getState()
      .patchClip(clipId, { nonsense: 1 } as never).errors.length).toBeGreaterThan(0);
  });
});
