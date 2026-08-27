# UI / UX upgrade — the checklist

The rule everything below is held to, from HANDOVER §7:

> **Material for content, nothing for chrome.** Posters, media, the hero
> and result cards are content and get a surface. Navigation, tool
> launchers, toolbars and notices are chrome and get nothing until
> hovered. Flat fills, no borders, no resting shadows. Bigger type, more
> air.

Tick a box only when it has been LOOKED AT in the running app, not when
the edit compiles. Anything found broken on the way gets fixed and
recorded under **F**, not deferred.

---

## A · Home — final polish
- [x] Flat fills, borders and resting shadows removed
- [x] Active nav reduced to one signal; edge bar removed
- [x] Icon-level containers on the tool row
- [x] Section rhythm and display type
- [x] Focus-visible ring is global in `index.css` base and applies everywhere; keyboard-only, never on pointer
- [x] Home's own states audited: `unknown` is not `signed_out`, an unreachable store says so and keeps owned skills working, an unrendered preview shows a surface rather than a spinner

## B · Icons and copy  ✅ DONE
- [x] **Phosphor**, not lucide. The upgrade is not nicer drawings: it is
      SIX WEIGHTS. A single-weight stroke set can only signal "selected"
      by changing colour, which is why every toolbar read flat. Idle is
      `regular`, active is `fill`.
- [x] `ui/icons.ts` re-exports the set under the names the codebase
      already used, so the NEXT swap is one file rather than 52
- [x] All **147** icon names mapped and machine-verified against the
      package. My first run reported 147/147 missing, which was my own
      name-extraction bug, not the mapping. `Ratio` was the only genuine
      miss and became `FrameCorners`.
- [x] Migrated 52 files, zero direct package imports left
- [x] `stroke-[N]` utilities stripped: inert on a filled glyph
- [x] **Every emoji gone** (46 across 4 files)
- [x] Both rules are now TESTS (`ui/iconography.test.ts`), not notes
- [x] **Em dashes swept.** 220 outside comments, across 39 files. Not a
      blanket substitution: a long left clause becomes a full stop and a
      capital, a short one becomes a comma, and a bare `—` standing in
      for "no value" becomes a hyphen. Six results still read badly and
      were fixed by hand. Enforced by a third test, proved able to fail.

## C · Real previews for effects and transitions
The emoji in those two panels are not decoration — they are standing in
for a PREVIEW. A picture of a magnifying glass does not tell anyone what
`zoom_in` looks like.

- [x] `engine/previewRender.ts` builds a real timeline and renders it
      through the real compositor. No illustration anywhere: if a
      preview looks wrong, the feature IS wrong.
- [x] The scene has structure (ground, band, disc, glyph) so warps,
      splits and shakes are visible. A flat swatch shows none of them.
- [x] `MotionThumb`: renders only once on screen (IntersectionObserver),
      plays on hover, holds a rest frame, honours reduced motion
- [x] Per-key frame cache and in-flight de-duplication
- [x] TransitionsPanel, 14 transitions
- [x] EffectsPanel and EffectStackInspector, 23 effects
- [x] FiltersPanel, 10 colour looks. The "swatch" was a hand-authored
      CSS gradient: three colours somebody guessed would suggest the
      result, free to drift from the real filter values for ever. It is
      the grade itself now, over a full-range scene (sky, mid, warm
      subject, near-black, specular) because a two-tone scene shows a
      temperature shift and a black lift almost not at all.
- [x] TextPanel and TextInspector, 9 kinetic text animations. They were
      nine words in a segmented control: "Kinetic Stack", "Glitch Pop"
      and "Wave" are not self-describing, and the only way to find out
      what one did was to apply it to a real title, scrub and undo.

## D · The rest of the platform
Every region gets the same pass as home.

**Started at the system level, which is where the leverage is.** `.card`,
`.card-interactive`, `.chip` and `.seg-item-active` lost their borders
and shadows in `index.css`, so every panel that uses them improved at
once rather than in sixty edits. `.well` KEEPS its border on purpose: it
is darker than the panel rather than lighter, and a dark rectangle on
dark chrome with no hairline reads as a hole rather than as an inset.

Done as three system-level sweeps rather than sixty edits, which is
where the leverage was. Every region below is covered by all three.

- [x] **Surfaces.** `.card`, `.card-interactive`, `.chip`,
      `.seg-item-active`, `.pro-btn-filled` and the kbd badge lost their
      borders and resting shadows. Wells, text inputs, the segmented
      track and colour swatches KEEP theirs, per the rule.
- [x] **Type.** 277 raw pixel sizes snapped onto the documented scale,
      **82 of them at 9px**, which is below the scale entirely and was
      most of what made the panels feel cramped beside home. Enforced by
      a test now.
- [x] **Accessible names.** 0 of 122 controls had one. Now 0 nameless of
      314, checked in the running editor by `verify_home`.

## E · Verification
- [x] `npm test` — 180 (6 new)
- [x] `npm run verify` — 16 suites, 534 checks
- [x] `verify_home.py --selftest` — 14/14 controls
- [x] Previews asserted DISTINCT in the running app, not eyeballed
- [ ] Screenshot every region once D is done

## F · Bugs and unfinished things found on the way

1. **`flash` and `dip_to_white` were the same transition.** They shared
   a `case` in the compositor's switch and fell through to identical
   code, while the panel sold them as "Fade through white" and "Hard
   white hit". Picking either produced the same slow fade.

   Found because their two previews rendered BYTE-IDENTICAL frames.
   Fourteen emoji could never have surfaced it, and NEXT.md §7 records
   all fourteen transitions as "measured and left alone" — they all
   render, so nothing was lying; two of them were just the same thing.
   `flash` now decays on a far sharper curve: at the quarter point a dip
   is still 62% white and a hit is down to 20%. All 12 rendered
   previews are now distinct, asserted in the app.

2. **The timeline lanes stopped short of the viewport.** Content width
   was `duration * pxPerMs + 240` and nothing else, so an 11.5s project
   drew 815px of lanes inside a 1226px viewport and left 411px of bare
   panel background. It read as a rendering fault rather than as "the
   sequence ends here". Now `max(viewport, content)`, measured with a
   ResizeObserver.

3. **My own preview layering was inverted.** Numbering the preview
   tracks 0..3 in reading order put the full-bleed ground on TOP —
   `compositor.ts` says "Highest index paints first so track 0 ends up
   on top". Every preview rendered as a flat amber rectangle with the
   band, disc and glyph drawn and then painted over. Caught by sampling
   pixels; a flat swatch is exactly what a broken preview and a working
   `dip_to_black` both look like at 90px.

4. **My own transition cards clipped their own labels.** Grid rows
   resolved to 42px against 109px of content. `auto-rows-max` fixes it.

5. **Two previews still collided after the first fix**, and the second
   guess was wrong too: at BOTH 55% and 34% `dip_to_white` and `flash`
   were identical, which is what proved it was the transitions and not
   the sampling point.

---

## G · Not started, and not pretended otherwise
- **D in full.** The platform-wide upscale has not begun. Home is done;
  header, sidebar panels, preview, timeline, inspector, copilot, canvas
  and the ui primitives are untouched by the material pass.
- **Text-animation previews** (C, last box).
- **Per-region layout composition.** The system-level work (surfaces,
  type scale, names) covers every panel. What is NOT done is bespoke
  re-composition of individual panels: spacing rhythm, section order and
  information density are unchanged from before this session, and the
  editor has not had the kind of layout rethink the home screen got.
