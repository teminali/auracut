/* ═══════════════════════════════════════════════════════════════════
   The program loop: one clock for the picture, the sound and the video
   elements.

   This was the body of `PreviewPlayer`'s `useRafLoop` and it is a hook
   now because the fullscreen Player draws the same programme from the
   same stores. Two copies would not have been a styling problem: the
   loop CALLS `audioEngine.sync` and `syncVideo`, so a second one
   running beside the first would drive the audio graph and every
   <video> element twice per frame from two different callers.

   Hence `active`, and hence the rule that goes with it: exactly one
   caller may be active at a time. `PreviewPlayer` yields while the
   Player is open, and takes it back when the Player closes.

   Performance is the reason this reads imperatively. It pulls state
   with `getState()` and never subscribes, so playback repaints the
   canvas without re-rendering React — see HANDOVER §3b before changing
   anything here.
   ═══════════════════════════════════════════════════════════════════ */

import { useEffect, useRef } from 'react';
import { useTimelineStore } from '../store/timelineStore';
import { useProjectStore } from '../store/projectStore';
import { renderTimelineFrame, getMediaGeneration } from '../engine/compositor';
import { audioEngine } from '../engine/audioEngine';
import { syncVideo } from '../engine/videoEngine';
import { useRafLoop } from './useRafLoop';
import type { ProjectSettings } from '../types/edl';

export interface Meters {
  l: number;
  r: number;
  peak: number;
}

interface Options {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  project: ProjectSettings;
  /** Exactly one caller may be active. */
  active: boolean;
  /** Called only when a level actually moved, so it cannot thrash React. */
  onMeters?: (next: Meters | ((prev: Meters) => Meters)) => void;
}

export function useProgramLoop({ canvasRef, project, active, onMeters }: Options): void {
  const lastRenderKey = useRef('');

  /*
    Bumped on EVERY store mutation.

    The repaint key used to be built from `historyIndex`, which only
    moves when something calls `commit()`. Four mutations never do —
    `setEffectParam`, `setEffectIntensity`, `updateShapeStyle` and
    `setMotionPath` — so dragging an effect slider, or an agent setting
    an effect parameter, changed the project and left the picture
    exactly as it was until some unrelated edit forced a repaint.

    Subscribing catches every write, including any added later, which a
    hand-maintained list of fields in the key would not.
  */
  const storeRevision = useRef(0);
  useEffect(() => {
    const bump = () => { storeRevision.current++; };
    const unsubTimeline = useTimelineStore.subscribe(bump);
    const unsubProject = useProjectStore.subscribe(bump);
    return () => { unsubTimeline(); unsubProject(); };
  }, []);

  // Any structural change invalidates the cached frame, even while paused.
  const tracksSignature = useTimelineStore((s) => s.tracks);
  const structuralSignature = useRef(0);
  useEffect(() => {
    structuralSignature.current += 1;
    lastRenderKey.current = '';
  }, [tracksSignature, project]);

  /* Handing the loop over has to invalidate the key too: the incoming
     canvas is blank and its key would otherwise match the outgoing
     one's, so the first frame after a handover would never be drawn. */
  useEffect(() => { lastRenderKey.current = ''; }, [active]);

  useRafLoop((deltaMs) => {
    const state = useTimelineStore.getState();
    const { isPlaying, playbackRate, loopEnabled, inPointMs, outPointMs } = state;

    if (isPlaying) {
      const endMs = outPointMs ?? project.durationMs;
      const startMs = inPointMs ?? 0;
      const next = state.playheadMs + deltaMs * playbackRate;

      if (next >= endMs) {
        state.setPlayheadMs(loopEnabled || outPointMs !== null ? startMs : endMs);
        if (!loopEnabled && outPointMs === null) state.setIsPlaying(false);
      } else {
        state.setPlayheadMs(next);
      }
    }

    /*
      Drive audio from the same frame loop as the picture, so sound
      follows the playhead through scrubbing, looping and rate changes
      with no separate clock to drift against.
    */
    audioEngine.sync(state.tracks, state.playheadMs, isPlaying, playbackRate);

    /*
      And the picture. Video clips draw from <video> elements, which hold
      whatever frame they were last seeked to — so they need the playhead
      pushed at them every frame exactly as the sound does.
    */
    syncVideo(state.tracks, state.playheadMs, isPlaying, playbackRate);

    // Meters read the actual output graph. They used to be Math.random(),
    // which bounced convincingly while nothing was playing at all.
    if (onMeters) {
      const levels = audioEngine.getLevels();
      onMeters((prev: Meters) =>
        Math.abs(levels.l - prev.l) < 0.004 && Math.abs(levels.r - prev.r) < 0.004
          ? prev
          : levels
      );
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Skip the repaint when nothing that affects the image has moved.
    const key = [
      Math.round(state.playheadMs),
      `${project.width}x${project.height}`,
      state.historyIndex,
      state.txDepth,
      storeRevision.current,
      getMediaGeneration(),
      structuralSignature.current,
    ].join('|');
    const forceRedraw = state.isPlaying || state.txDepth > 0;
    if (!forceRedraw && key === lastRenderKey.current) return;
    lastRenderKey.current = key;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    renderTimelineFrame(ctx, state.tracks, project, state.playheadMs, project.width, project.height);
  }, active);
}
