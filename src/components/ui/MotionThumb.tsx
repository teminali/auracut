/* ═══════════════════════════════════════════════════════════════════
   A preview that moves.

   Renders a real frame at rest and plays the sequence on hover. The
   frames come from the actual compositor (`engine/previewRender`), so
   this component never decides what anything looks like.

   Three things it is careful about, all of which showed up in practice:

     · **Nothing renders until it is on screen.** A panel of 23 effects
       is 276 full composites. Mounting them all at once locks the main
       thread while somebody is trying to scroll the list they are
       waiting for. An IntersectionObserver starts each one as it
       arrives.
     · **It plays on hover, not always.** Twenty-three looping
       animations in a sidebar is a slot machine, and it competes with
       the video the person is actually editing.
     · **`prefers-reduced-motion` stops the loop**, and it stops it by
       holding a MID frame rather than the first. Frame zero of a
       transition is the outgoing shot with nothing applied, so a
       reduced-motion user would see a still of nothing happening.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';

interface Props {
  /** Renders the frames. Called once, when this first becomes visible. */
  load: () => Promise<string[]>;
  /**
   * Which frame to hold when not playing, 0..1 through the sequence.
   *
   * Defaults to just past the middle, and that default matters: frame
   * zero of a transition is the outgoing shot with nothing applied yet,
   * so resting on it made all fourteen transition cards render the
   * identical picture. The middle is where a transition IS itself.
   */
  restAt?: number;
  /** Described for a screen reader, which cannot see any of this. */
  label: string;
  className?: string;
  /** Frames per second while playing. */
  fps?: number;
}

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const MotionThumb: React.FC<Props> = ({
  load, label, className = '', fps = 12, restAt = 0.55,
}) => {
  const [frames, setFrames] = React.useState<string[] | null>(null);
  const [index, setIndex] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const hostRef = React.useRef<HTMLDivElement>(null);

  /* ── Render when it comes into view ── */
  React.useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let cancelled = false;

    const start = () => {
      void load().then((f) => { if (!cancelled) setFrames(f); });
    };

    if (typeof IntersectionObserver !== 'function') { start(); return () => { cancelled = true; }; }

    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        start();
      }
    }, { rootMargin: '120px' });

    io.observe(el);
    return () => { cancelled = true; io.disconnect(); };
  }, [load]);

  /* ── Play ── */
  React.useEffect(() => {
    // Reduced motion holds the rest frame rather than cycling.
    if (!playing || !frames || frames.length < 2 || reducedMotion()) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % frames.length), 1000 / fps);
    return () => window.clearInterval(id);
  }, [playing, frames, fps]);

  const restIndex = frames ? Math.min(frames.length - 1, Math.floor(frames.length * restAt)) : 0;
  const shown = frames?.[playing ? index : restIndex];

  return (
    <div
      ref={hostRef}
      onMouseEnter={() => setPlaying(true)}
      onMouseLeave={() => { setPlaying(false); setIndex(0); }}
      className={`relative overflow-hidden bg-spectrum-sunken ${className}`}
      role="img"
      aria-label={label}
    >
      {shown ? (
        <img src={shown} alt="" className="w-full h-full object-cover" draggable={false} />
      ) : (
        /* Not a spinner. A preview that has not rendered yet is a
           surface that is about to have a picture on it, and a spinner
           in a 90px tile reads as an error. */
        <div className="absolute inset-0 animate-pulse bg-spectrum-hover" />
      )}
    </div>
  );
};
