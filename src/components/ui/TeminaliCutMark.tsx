import React from 'react';

/*
  The TeminaliCut mark: `>_C`.

  Built on exactly the same construction as TeminaliCode's `>_<`
  (`teminaliCode/studio/build/mark.svg`) — a terminal prompt, drawn as three
  stroked glyphs on a 1024 grid with round caps and joins and a stroke of 76.
  The chevron and the underscore are the sibling's, unchanged; only the
  closing `<` becomes a `C`, which is what makes the two read as one family
  at Dock size and still tell apart.

  A `C` is a wider letterform than a `<`, so the composition is the sibling's
  scaled to 0.93 about the centre: that buys the arc its room while keeping
  the plate margins, the cap height ratio and the stroke weight matched to
  TeminaliCode. The underscore is shortened to clear the arc's lower-left —
  the sibling lets `_` and `<` kiss, but a curve that touches an underscore
  fuses into one shape rather than reading as two glyphs.

  The viewBox is cropped to the ink, so the mark fills whatever box it is
  given. Its aspect is ~2.28:1 — size it wide, never square.
*/
export const TeminaliCutMark: React.FC<{ className?: string; color?: string }> = ({
  className,
  color = 'currentColor',
}) => (
  <svg viewBox="163 359 697 306" className={className} aria-hidden="true">
    <g
      stroke={color}
      strokeWidth={76}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    >
      {/* > */}
      <polyline points="201,397 306,512 201,627" />
      {/* _ */}
      <line x1="371" y1="627" x2="547" y2="627" />
      {/* C */}
      <path d="M773 418 A115 115 0 1 0 773 606" />
    </g>
  </svg>
);
