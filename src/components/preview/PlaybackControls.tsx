import React from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useProjectStore } from '../../store/projectStore';
import { formatTimecode } from '../../utils/time';
import {
  Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight, Repeat, Flag, ScissorsLineDashed,
} from '../ui/icons';

const RATES = [0.25, 0.5, 1, 1.5, 2];

export const PlaybackControls: React.FC = () => {
  const playheadMs = useTimelineStore((s) => s.playheadMs);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const playbackRate = useTimelineStore((s) => s.playbackRate);
  const loopEnabled = useTimelineStore((s) => s.loopEnabled);
  const inPointMs = useTimelineStore((s) => s.inPointMs);
  const outPointMs = useTimelineStore((s) => s.outPointMs);

  const togglePlay = useTimelineStore((s) => s.togglePlay);
  const setPlayheadMs = useTimelineStore((s) => s.setPlayheadMs);
  const setPlaybackRate = useTimelineStore((s) => s.setPlaybackRate);
  const toggleLoop = useTimelineStore((s) => s.toggleLoop);
  const setInPoint = useTimelineStore((s) => s.setInPoint);
  const setOutPoint = useTimelineStore((s) => s.setOutPoint);
  const addMarker = useTimelineStore((s) => s.addMarker);

  const project = useProjectStore((s) => s.project);

  const stepFrame = (frames: number) => {
    const frameMs = 1000 / project.fps;
    setPlayheadMs(Math.max(0, Math.min(project.durationMs, playheadMs + frames * frameMs)));
  };

  const progress = project.durationMs > 0 ? (playheadMs / project.durationMs) * 100 : 0;

  const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setPlayheadMs(pct * project.durationMs);
  };

  return (
    <div className="editor-playback-controls flex flex-col gap-2">
      {/* Scrub bar — thin at rest, thicker under the pointer so it is easy
          to grab without stealing vertical space from the transport. */}
      <div
        onMouseDown={(e) => {
          handleScrub(e);
          const track = e.currentTarget as HTMLDivElement;
          const move = (ev: MouseEvent) => {
            const rect = track.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
            setPlayheadMs(pct * project.durationMs);
          };
          const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
          };
          window.addEventListener('mousemove', move);
          window.addEventListener('mouseup', up);
        }}
        className="group relative h-3 flex items-center cursor-pointer"
      >
        <div className="relative w-full h-[4px] group-hover:h-[6px] rounded-full bg-spectrum-sunken border border-line overflow-hidden transition-[height] duration-fast">
          {/* In / out range */}
          {(inPointMs !== null || outPointMs !== null) && (
            <div
              className="absolute inset-y-0 bg-spectrum-accent/20"
              style={{
                left: `${((inPointMs ?? 0) / project.durationMs) * 100}%`,
                right: `${100 - ((outPointMs ?? project.durationMs) / project.durationMs) * 100}%`,
              }}
            />
          )}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-spectrum-accent"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.7)] opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `${progress}%` }}
        />
      </div>

      <div className="editor-transport-row flex items-center justify-between gap-3 min-h-10">
        {/* Timecode — position leads, duration follows at half the weight. */}
        <div className="editor-transport-time flex items-baseline gap-1.5 font-mono min-w-[136px]">
          <span className="text-ui-lg font-semibold text-spectrum-text tabular tracking-tight">
            {formatTimecode(playheadMs, project.fps)}
          </span>
          <span className="text-ui-xs text-spectrum-textFaint tabular">
            / {formatTimecode(project.durationMs, project.fps)}
          </span>
        </div>

        {/* Transport */}
        <div className="flex items-center gap-1">
          <button onClick={() => setPlayheadMs(inPointMs ?? 0)} className="pro-btn w-7 h-7" title="Go to start (Home)"
            aria-label="Go to start (Home)">
            <SkipBack className="w-[15px] h-[15px]" />
          </button>
          <button onClick={() => stepFrame(-1)} className="pro-btn w-7 h-7" title="Previous frame (←)"
            aria-label="Previous frame (←)">
            <ChevronLeft className="w-[17px] h-[17px]" />
          </button>

          {/* The one bright control on the screen. Measured off the
              reference, which draws the SAME 40px near-white disc in the
              editor and in the fullscreen player: 40px, 50%, #f2f2f2 on
              a soft drop, with the icon carrying the state. It used to
              be a 36px dark disc that turned accent while playing —
              a second signal for something the icon already says, in a
              hard-coded #2b1108 left over from the accent before last. */}
          <button
            onClick={togglePlay}
            className="w-10 h-10 mx-1 rounded-full flex items-center justify-center transition-all duration-fast
                       bg-[#f2f2f2] text-[#151617] hover:bg-white shadow-[0_5px_16px_rgba(0,0,0,0.25)]"
            title="Play / pause (Space)"
            aria-label="Play / pause (Space)"
          >
            {isPlaying
              ? <Pause className="w-[15px] h-[15px]" weight="fill" />
              : <Play className="w-[15px] h-[15px] ml-0.5" weight="fill" />}
          </button>

          <button onClick={() => stepFrame(1)} className="pro-btn w-7 h-7" title="Next frame (→)"
            aria-label="Next frame (→)">
            <ChevronRight className="w-[17px] h-[17px]" />
          </button>
          <button onClick={() => setPlayheadMs(outPointMs ?? project.durationMs)} className="pro-btn w-7 h-7" title="Go to end (End)"
            aria-label="Go to end (End)">
            <SkipForward className="w-[15px] h-[15px]" />
          </button>
        </div>

        {/* Marking & playback modes */}
        <div className="editor-transport-actions flex items-center gap-1 min-w-[136px] justify-end">
          <button onClick={() => addMarker(playheadMs)} className="pro-btn w-7 h-7" title="Add marker (M)"
            aria-label="Add marker (M)">
            <Flag className="w-[15px] h-[15px]" />
          </button>
          <button
            onClick={() => (inPointMs === null ? setInPoint(playheadMs) : setInPoint(null))}
            className={`pro-btn w-7 h-7 ${inPointMs !== null ? 'pro-btn-active' : ''}`}
            title="Set / clear in point (I)"
          
            aria-label="Set / clear in point (I)">
            <ScissorsLineDashed className="w-[15px] h-[15px]" />
          </button>
          <button
            onClick={toggleLoop}
            className={`pro-btn w-7 h-7 ${loopEnabled ? 'pro-btn-active' : ''}`}
            title="Loop playback (L)"
            aria-label="Loop playback (L)"
          >
            <Repeat className="w-[15px] h-[15px]" />
          </button>
          <select
            value={playbackRate}
            onChange={(e) => setPlaybackRate(Number(e.target.value))}
            className="pro-input select-native h-7 pl-2 text-ui-xs font-mono cursor-pointer"
            title="Playback speed"
          >
            {RATES.map((r) => (
              <option key={r} value={r}>{r}×</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};
