/* ═══════════════════════════════════════════════════════════════════
   The FrontierCut mark.

   An F, cut. The vertical stem and the two horizontal bars form the F;
   the clean gap between them is the cut — the blade slit that defines
   the editor.

   Drawn as strokes rather than a raster so it holds at 16px in a title
   bar and at 1024px in an app icon, and stays crisp at every size.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';

export const FrontierCutMark: React.FC<{ className?: string; color?: string }> = ({
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
      {/* Stem of F */}
      <path d="M6.2 3.9 V20.1" />
      {/* Top bar of F, held clear of the stem by the cut */}
      <path d="M11.2 5.5 H19.2" />
      {/* Mid bar of F, held clear of the stem by the cut */}
      <path d="M11.2 12.2 H16.5" />
    </g>
  </svg>
);

/** Alias for backward compatibility */
export const KerfMark = FrontierCutMark;

