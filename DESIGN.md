# 🎨 Teminali Design System (TDS) — TeminaliCut

> **Canonical contract: [`teminaliCode/studio/DESIGN.md`](../teminaliCode/studio/DESIGN.md).**
> This file records how that contract lands in a **video editor**, and the
> four places an NLE is allowed to differ. Read the canonical one first —
> nothing here overrides it, and where the two disagree, it wins.

Ecosystem: **Teminali Code**, **TeminaliCut**, **Teminali Guardian**.
Mandate: one system, so a panel can move between the products without
being re-styled on arrival.

---

## 0. The token sheet is the only source of truth

The `:root` block at the top of [`src/index.css`](src/index.css) holds every
colour, size, radius, height, duration and curve. Every value there came from
`teminaliCode/studio/src/styles/tokens.css`, which was sampled pixel-for-pixel
out of Cursor's own agent window.

**No component may contain a raw hex, a raw px radius, or a raw duration.**
[`tailwind.config.js`](tailwind.config.js) is the sheet's Tailwind face, and
[`src/components/ui/palette.test.ts`](src/components/ui/palette.test.ts) holds
the two together — the Tailwind side has to be literal hexes, because this
codebase uses `/50` alpha modifiers on them, so only a test can stop the two
copies drifting.

| Role | Utility | Token |
| --- | --- | --- |
| Stage, canvas, editor ground | `bg-spectrum-bg` · `bg-frame-mid` | `#151515` |
| The program-monitor bed | `bg-spectrum-void` | `#0f0f0f` |
| Wells, timeline bed, code | `bg-spectrum-sunken` | `#131313` |
| Chrome — titlebar, toolbars, rails, panels | `bg-spectrum-panel` · `bg-rail-mid` | `#181818` |
| Inputs, cards, the raised plane | `bg-spectrum-card` · `bg-surface` | `#212121` |
| Buttons, chips, inline code | `bg-spectrum-cardHover` · `bg-surface-raised` | `#262626` |
| Discs, slider thumbs | `bg-spectrum-control` | `#313131` |
| Row hover / selected | `bg-spectrum-hover` / `-active` | `#242424` / `#252525` |
| Card and control edge | `border-line` · `border-edge` | `#262626` |
| Chrome ↔ canvas seam | `border-line-chrome` | `#282828` |
| The brightest hairline | `border-line-bright` | `#3a3a3a` |
| Headings, active labels | `text-spectrum-textBright` | `#f0f0f0` |
| Body | `text-spectrum-text` | `#ededed` |
| Rows, icons, secondary | `text-spectrum-textMuted` | `#b6b6bd` |
| Timestamps, quiet meta | `text-spectrum-textDim` | `#9f9f9f` |
| Section labels | `text-spectrum-textFaint` | `#989898` |
| Placeholders | `text-spectrum-textPlaceholder` | `#6b6b6b` |
| **Emphasis — achromatic** | `text-spectrum-accent` · `bg-spectrum-accent` | `#e8e8e8` |
| **The one colour** | `bg-spectrum-action text-spectrum-actionInk` | `#86aee4` on `#151515` |

Motion is one curve — `--ease: cubic-bezier(.2,.7,.2,1)` — at three speeds
(`duration-fast` 100ms, `duration-base` 150ms, `duration-slow` 200ms).

**Type: 10 / 11 / 12 / 13 / 14 / 16**, plus one 20px launcher hero. Nothing
between. The app previously ran eight sizes, three of them half-pixel — and a
half-pixel does not survive a non-retina display or a screenshot. It only
survives a design file.

**Spacing: 4 / 6 / 8 / 12 / 16 / 20 / 24.** Named as `hair` · `tight` ·
`control` · `panel` · `section` · `group` · `page`, and identical to Tailwind's
`1 / 1.5 / 2 / 3 / 4 / 5 / 6`. The 10px and 14px steps are gone: they were
somebody splitting the difference between 8 and 12 rather than choosing.

**Heights: 22 / 26 / 30 / 36 / 40 / 48**, as `--h-xs` · `-sm` · `-md` · `-lg` ·
`-bar` · `-title`. Every control snaps to one, and `Primitives.tsx` reads the
tokens rather than restating them in pixels.

---

## 1. Zero-slop principles

Inherited whole. The reference is **achromatic and flat**: five greys carry the
interface and depth is a 1px border, one step lighter than the fill it
encloses, identical on all four sides.

1. **No gradients.** Not on a window, a rail, a button, a tile or a hero.
2. **No edge lighting.** No inset top highlight, no inner catch, no contact
   shadow. `--lift-1` and `--lift-2` are `none`; only things that genuinely
   float above the window cast, and they cast plain black.
3. **No decorative colour.** An emphasised glyph is *brighter* than its
   neighbours, never a different hue.
4. **A card is recessed, not raised.** A well is darker than its panel; a
   control is lighter than the canvas. Both read because the border does it.
5. **A section label is not chrome.** Sentence case, body size, one step down
   the ramp, separated by space. Never uppercase, never wide-tracked.
6. **Native controls are reset once**, in `index.css`. Never at a call site.
7. **Solid light fills take dark text** (`--on-accent`).
8. **State is legible.** If the machine is doing something, say which thing.

### There is no accent, and that is the feature

`#f28b46` was the **fifth** chromatic accent this product had — blue, amber,
green, terracotta, orange. Every one of them collided with a role colour, moved
the collision somewhere else, and had to be re-separated by hand; `HANDOVER §7`
predicted it would happen again, and it did.

An achromatic accent has no hue to collide with. That is why the reference does
not have one, and it is why this one does not any more.

**Do not reintroduce the ember.** It is the single fastest way to stop looking
like the system.

---

## 2. Component primitives (`src/components/ui/`)

Import from here rather than writing ad-hoc markup:

* **`Button`** — `ghost` · `filled` · `primary` · `danger`, sizes `xs/sm/md/lg`
* **`IconButton`**, **`Select`**, **`StatusDot`** (three states, never two)
* **`SectionLabel`**, **`Row`**, **`Kbd`**, **`InlineCode`**, **`EmptyState`**
* **`StandardModal`**, **`CommandPalette`**, **`ContextMenu`**, **`Toasts`**

The CSS classes are the implementation — `.pro-btn`, `.pro-btn-filled`,
`.btn-primary`, `.pro-input`, `.card`, `.well`, `.panel-header`, `.row-item`,
`.seg-*`, `.chip`, `.kbd` — and the primitives are the one place that decides
which class a given control wears.

### Governance law

> 1. Check whether a primitive already exists in `src/components/ui/`.
> 2. If it needs improving, **improve the shared primitive**.
> 3. Never create a one-off styled button, modal or tab switcher in a page.
> 4. Never introduce a colour that is not in the token sheet. If a genuinely
>    new role is needed, add the token first — and prefer an existing grey.
> 5. Run `npx vitest run src/components/ui/palette.test.ts` after any palette
>    move. It prints which mechanism separates each role from the accent.

---

## 3. The four places an NLE differs

Everything else is the reference verbatim. These four are declared, tokenised,
and each is the same permission: **colour that carries information**.

### 3.1 Lane identity is data

A track's kind — video, overlay, text, audio, effect — cannot be carried by
brightness. Five hues, each clearing every other role on hue and clearing the
achromatic accent on saturation:

| Lane | Token | Value |
| --- | --- | --- |
| Video | `lane-video` | `#86aee4` |
| Overlay | `lane-overlay` | `#a48fd8` |
| Text | `lane-text` | `#e08ab0` |
| Audio | `lane-audio` | `#65c466` |
| Effect | `lane-effect` | `#4ec9b0` |

A clip **body** never wears these at full strength — the thumbnail carries the
image, the 2px spine carries the identity.

### 3.2 The program monitor needs a true floor

`--stage-void` (`#0f0f0f`) is darker than any chrome in the system. A video
frame's own blacks have to have somewhere to land, or they dissolve into the
panel behind them and the picture stops reading as a picture.

### 3.3 Type over a video frame is fixed white

Every `--text-*` token is tuned against a *known* panel colour. Nothing laid
over arbitrary footage has one, so the player overlay, the recorder bar, the
transform gizmo, the capture grid and the annotator use fixed white over a
scrim whose opacity is guaranteed. That is the only way the contrast is
knowable at all. **This is the one exemption from the ink ladder**, and it is
enumerated in the sweep script rather than left to judgement.

### 3.4 Legibility scrims are not decoration

A caption over a poster frame, a label over a clip thumbnail, the fade at the
end of a scrolling tab strip, the indeterminate progress sweep — these are
gradients that carry information (*"there is more"*, *"this is running"*,
*"this text has a floor"*). They stay. Everything decorative went.

---

## 4. What the migration actually did

One pass, no functional change, 471 tests green throughout:

| Layer | Change |
| --- | --- |
| Token sheet | Rewritten onto TDS. Blue-black ladder → neutral; white-alpha hairlines → solid; five accents → achromatic; elevation → flat |
| Tailwind | Both naming families bound to one set of constants; `palette.test.ts` taught to follow the indirection |
| Stylesheet | 51 legacy hexes, 40 ember washes, 27 gradients and 17 edge highlights swept onto roles; 7 decorative blurs removed and their surfaces made opaque |
| Components | 369 arbitrary colour classes, 107 white-alpha washes, 14 stock-Tailwind classes and 60 pure white/black classes mapped by role |
| Rhythm | ~95 off-scale spacings snapped; 75 pixel heights bound to `--h-*`; 12 escaped type sizes and one dead radius class closed |
| Primitives | `Button`/`Select` read the height tokens; `SectionLabel`, `Row`, `Kbd`, `InlineCode`, `EmptyState` added to match the reference's vocabulary |

### Two naming families, both correct

`spectrum.*` / `line.*` / `squircle-*` / `ui-*` are this app's own names, at
~2,000 call sites. They were **repointed, never renamed** — renaming them would
have been a two-thousand-line diff to change nothing.

`frame` / `rail` / `surface` / `edge` / `ink` / `action` / `r-*` are the
canonical TDS names. **Reach for these in new code.** Both resolve identically.

---

## Related documents

- [`teminaliCode/studio/DESIGN.md`](../teminaliCode/studio/DESIGN.md) — the contract
- [`HANDOVER.md`](HANDOVER.md) · [`UI-UPGRADE.md`](UI-UPGRADE.md) — what came before
