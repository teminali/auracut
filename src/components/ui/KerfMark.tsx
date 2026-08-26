/* ═══════════════════════════════════════════════════════════════════
   The Kerf mark.

   A kerf is the slit a blade leaves. The mark is that slit: two bars
   parted by the cut between them — the same shape the logo sting
   animates, so the still mark and the motion version are one idea.

   Drawn as geometry rather than shipped as a raster so it stays crisp
   at 16px in a title bar and at 1024px in an app icon.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';

export const KerfMark: React.FC<{ className?: string; color?: string }> = ({
  className,
  color = '#fff',
}) => (
  <svg viewBox="0 0 24 24" className={className} fill={color} aria-hidden="true">
    {/* Bar, kerf, bar. The gap is the subject, so it carries the most space. */}
    <rect x="3" y="6.4" width="18" height="3.4" rx="1.7" />
    <rect x="3" y="14.2" width="18" height="3.4" rx="1.7" />
  </svg>
);
