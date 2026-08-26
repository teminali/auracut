/* ═══════════════════════════════════════════════════════════════════
   The Kerf mark.

   A K, cut. The stem and the two arms are the letter; the gap between
   them is the kerf — the slit a blade leaves. So the mark says the name
   and the idea at once, rather than being an abstract shape that has to
   be explained.

   Drawn as strokes rather than a raster so it holds at 16px in a title
   bar and at 1024px in an app icon, and so the kerf stays a crisp,
   even gap at every size.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';

export const KerfMark: React.FC<{ className?: string; color?: string }> = ({
  className,
  color = '#fff',
}) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <g
      stroke={color}
      strokeWidth={3.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    >
      {/* Stem */}
      <path d="M6.2 3.9 V20.1" />
      {/* Arm and leg, held clear of the stem — that clearance is the kerf. */}
      <path d="M10.9 12 L18.3 4.4" />
      <path d="M10.9 12 L18.6 19.9" />
    </g>
  </svg>
);
