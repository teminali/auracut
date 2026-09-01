/* ═══════════════════════════════════════════════════════════════════
   The TeminaliCut mark (TC Monogram).

   Crisp vector geometry rendering the TC monogram with a modern cut aesthetic.
   Drawn as strokes rather than a raster so it holds at 16px in a title
   bar and at 1024px in an app icon, and stays crisp at every size.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';

export const TeminaliCutMark: React.FC<{ className?: string; color?: string }> = ({
  className,
  color = '#fff',
}) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <g
      stroke={color}
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    >
      {/* T - top crossbar & vertical stem */}
      <path d="M3.5 6 H12" />
      <path d="M7.7 6 V19" />
      {/* C - modern geometric arc */}
      <path d="M20.5 8 C19 5.8 15.5 5.8 14.2 7.8 C13.2 9.5 13.2 15.5 14.2 17.2 C15.5 19.2 19 19.2 20.5 17" />
    </g>
  </svg>
);
