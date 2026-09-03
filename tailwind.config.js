/** @type {import('tailwindcss').Config} */

/* ═══════════════════════════════════════════════════════════════════
   TEMINALI DESIGN SYSTEM (TDS) — TAILWIND BINDING

   The token sheet in `src/index.css` is the source of truth. This file
   is its Tailwind face, and the two are held together by
   `palette.test.ts` — the values here are LITERALS rather than
   `var(--x)` because this codebase uses `/50` alpha modifiers on them
   (`border-line/60`, `bg-spectrum-accent/15`), and Tailwind cannot
   compute an alpha channel through a CSS variable that holds a hex.

   Three rules govern the values themselves, inherited whole from
   `teminaliCode/studio/DESIGN.md`:

   1. ACHROMATIC AND FLAT. Two planes carry the shell — chrome at
      #181818, canvas at #151515 — and depth is a flat 1px border one
      step lighter than the fill it encloses. No gradients, no edge
      lighting, no inner catch, no contact shadow.
   2. ONE TYPE SCALE — 10 / 11 / 12 / 13 / 14 / 16. Nothing between.
      Half-pixel sizes are what make an interface look improvised.
   3. COLOUR IS INFORMATION. Green means live, red means destructive,
      amber means caution, and a lane hue identifies a track. Nothing
      else is tinted: an emphasised glyph is BRIGHTER than its
      neighbours, never a different colour.

   TWO NAMING FAMILIES, both live and both correct:

     spectrum.* / line.* / squircle-* / ui-*   this app's own names,
       used at ~2,000 call sites. Repointed, never renamed — renaming
       them would have been a 2,000-line diff to change nothing.
     frame / rail / surface / edge / ink / action / r-*   the canonical
       TDS names, so anything written from here on can be lifted
       between Teminali Code and Teminali Cut unchanged.

   Reach for the canonical name in new code. Both resolve identically.
   ═══════════════════════════════════════════════════════════════════ */

/* The sheet, once, so the two families cannot drift from each other. */
const GROUND = '#151515';
const VOID_ = '#0f0f0f';
const SUNKEN = '#131313';
const CHROME = '#181818';
const SURFACE = '#212121';
const RAISED = '#262626';
const CONTROL = '#313131';
const HOVER = '#242424';
const ACTIVE = '#252525';

const LINE_SOFT = '#232323';
const LINE = '#262626';
const LINE_STRONG = '#313131';
const LINE_CHROME = '#282828';
const LINE_POPOVER = '#3a3a3a';

const INK_BRIGHT = '#f0f0f0';
const INK = '#ededed';
const INK_MUTED = '#b6b6bd';
const INK_DIM = '#9f9f9f';
const INK_FAINT = '#989898';
const INK_PLACEHOLDER = '#6b6b6b';
const INK_DISABLED = '#5a5a5a';

const ACCENT = '#e8e8e8';
const ACCENT_HOVER = '#ffffff';
const ON_ACCENT = '#151515';
const ACTION = '#86aee4';

/* Role colours. Each clears the achromatic accent on saturation, and
   each clears every OTHER role on hue — `palette.test.ts` prints which
   mechanism carries which, so the next palette move fails loudly. */
const BLUE = '#86aee4';
const GREEN = '#65c466';
const TEAL = '#4ec9b0';
const AMBER = '#f2ca44';
const RED = '#ec6765';
const PURPLE = '#a48fd8';
const PINK = '#e08ab0';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* ── Hairline strokes ─────────────────────────────────────
           Solid, not white-alpha. An alpha hairline tints whatever it
           crosses, so the same class drew a different line on the
           canvas than it did on a panel — which is exactly the kind of
           drift a token is supposed to prevent. */
        line: {
          DEFAULT: LINE,
          soft: LINE_SOFT,
          strong: LINE_STRONG,
          chrome: LINE_CHROME,
          bright: LINE_POPOVER,
        },

        /* ── Core studio surface ramp ─────────────────────────── */
        spectrum: {
          bg: GROUND,               // stage / app backdrop / canvas
          void: VOID_,              // the program-monitor bed
          sunken: SUNKEN,           // wells, timeline bed, code blocks
          panelHeader: CHROME,      // chrome: titlebar, toolbars, rails
          panel: CHROME,            // panel bodies
          card: SURFACE,            // cards, inputs, the raised plane
          cardHover: RAISED,
          hover: HOVER,             // hover highlight on a row
          active: ACTIVE,           // selected row
          control: CONTROL,         // discs, thumbs — the top step

          border: LINE,
          borderSubtle: LINE_SOFT,
          borderStrong: LINE_STRONG,

          textBright: INK_BRIGHT,
          text: INK,
          textMuted: INK_MUTED,
          textDim: INK_DIM,
          /* The two `-cool` rungs are aliases now. The blue tint they
             carried was the last chromatic thing left in the type, and
             the reference's ramp has no such tier. */
          textDimCool: INK_DIM,
          textFaintCool: '#8a8a8a',
          textFaint: INK_FAINT,
          textPlaceholder: INK_PLACEHOLDER,
          textDisabled: INK_DISABLED,

          /* ── The primary ──────────────────────────────────────
             Near-white, and that is the whole point. This product had
             five chromatic accents in a row — blue, amber, green,
             terracotta, orange — and every one of them collided with a
             role colour, moved the collision somewhere else, and had
             to be re-separated by hand. An achromatic accent has no
             hue to collide with, which is why the reference does not
             have one either. Do not reintroduce the ember. */
          accent: ACCENT,
          accentHover: ACCENT_HOVER,
          accentSoft: 'rgba(232,232,232,0.10)',
          accentLine: 'rgba(232,232,232,0.28)',
          onAccent: ON_ACCENT,
          accentInk: INK_BRIGHT,

          /* The one chromatic control in the window. Reserved for a
             single affordance at a time — the update pill, the primary
             confirm — and never for chrome. Its fill is light, so it
             carries dark ink; hence `actionInk`, which no other group
             needs. */
          action: ACTION,
          actionHover: '#9dc0ea',
          actionInk: '#151515',

          blue: BLUE,
          green: GREEN,
          teal: TEAL,
          amber: AMBER,   // keyframes and caution
          red: RED,
          purple: PURPLE,
          pink: PINK,
        },

        /* ── Track lane identity ──────────────────────────────────
           The one place TDS permits colour in the chrome, because a
           lane hue is DATA: it answers "what kind of track is this"
           at a glance, and no amount of brightness can carry that.
           Bright enough to read as a 2px spine on dark chrome; the
           clip BODY never wears these at full strength.              */
        lane: {
          video: BLUE,
          overlay: PURPLE,
          text: PINK,
          audio: GREEN,
          effect: TEAL,
        },

        /* ── Canonical TDS names ──────────────────────────────────
           Same values, the names Teminali Code uses. New code should
           reach for these; the `spectrum.*` family above stays only
           because it is already at two thousand call sites.          */
        ground: GROUND,
        frame: { top: GROUND, mid: GROUND, bot: GROUND },
        rail: { top: CHROME, mid: CHROME, bot: CHROME },
        panelbg: { top: CHROME, mid: CHROME, bot: CHROME },
        surface: {
          sunken: SUNKEN,
          DEFAULT: SURFACE,
          raised: RAISED,
          popover: SURFACE,
          chip: RAISED,
          control: CONTROL,
          hover: HOVER,
          active: ACTIVE,
          tab: RAISED,
        },
        edge: {
          chrome: LINE_CHROME,
          subtle: LINE_SOFT,
          DEFAULT: LINE,
          strong: LINE_STRONG,
          popover: LINE_POPOVER,
        },
        ink: {
          bright: INK_BRIGHT,
          strong: INK_BRIGHT,
          high: INK_BRIGHT,
          DEFAULT: INK,
          body: INK,
          prose: INK_BRIGHT,
          code: '#d4d4d4',
          dim: INK_DIM,
          muted: INK_MUTED,
          soft: INK_DIM,
          faint: INK_FAINT,
          placeholder: INK_PLACEHOLDER,
          ghost: INK_PLACEHOLDER,
          disabled: INK_DISABLED,
        },
        accent: {
          DEFAULT: ACCENT,
          hover: ACCENT_HOVER,
          dim: INK_DIM,
          ink: ON_ACCENT,
        },
        action: { DEFAULT: ACTION, hover: '#9dc0ea', ink: '#151515' },
        success: GREEN,
        info: BLUE,
        warning: AMBER,
        danger: RED,
        reason: INK_MUTED,
      },

      /* ── Radii ────────────────────────────────────────────────────
         4 / 6 / 8 / 10 / 12 / 16, measured off the reference. Both
         naming families point at one ramp.

         This replaced 4/6/8/11/15/18. The top of that ramp was rounder
         than anything in the reference, which is what made dense
         control panels read as a phone app rather than as a tool.     */
      borderRadius: {
        'squircle-2xs': 'var(--r-2xs)',
        'squircle-xs': 'var(--r-xs)',
        'squircle-sm': 'var(--r-sm)',
        'squircle-md': 'var(--r-md)',
        'squircle-lg': 'var(--r-lg)',
        'squircle-xl': 'var(--r-xl)',
        /* canonical */
        '2xs': 'var(--r-2xs)',
        xs: 'var(--r-xs)',
        sm: 'var(--r-sm)',
        DEFAULT: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
        '2xl': 'var(--r-xl)',
        full: 'var(--r-full)',
      },

      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },

      /* ── The whole type scale. Six sizes. ────────────────────────
         10 / 11 / 12 / 13 / 14 / 16, and the launcher's one display
         step. The app previously ran 10.5 / 11.5 / 12.5 / 12 / 13 /
         15 / 17 / 20 — eight sizes, three of them half-pixel, and two
         of them (12.5 and 12) close enough that no reader could tell
         them apart. Half-pixels do not survive a non-retina display
         and they do not survive a screenshot; they only survive a
         design file.                                                 */
      fontSize: {
        micro: ['var(--text-3xs)', { lineHeight: '14px' }],
        'ui-xs': ['var(--text-2xs)', { lineHeight: '16px' }],
        'ui-sm': ['var(--text-xs)', { lineHeight: '18px' }],
        ui: ['var(--text-xs)', { lineHeight: '18px' }],
        'ui-lg': ['var(--text-sm)', { lineHeight: '20px' }],
        'ui-xl': ['var(--text-md)', { lineHeight: '21px', letterSpacing: '-0.006em' }],
        /* The launcher is a reading surface, not a tool surface, and
           the six sizes above are tuned for panels dense with
           controls. One display step exists for it, plus a hero. */
        display: ['var(--text-lg)', { lineHeight: '23px', letterSpacing: '-0.011em' }],
        'display-lg': ['20px', { lineHeight: '27px', letterSpacing: '-0.016em' }],
        /* canonical TDS names */
        '3xs': ['var(--text-3xs)', { lineHeight: '1.4' }],
        '2xs': ['var(--text-2xs)', { lineHeight: '1.45' }],
        xs: ['var(--text-xs)', { lineHeight: '1.5' }],
        sm: ['var(--text-sm)', { lineHeight: '1.55' }],
        md: ['var(--text-md)', { lineHeight: '1.5' }],
        lg: ['var(--text-lg)', { lineHeight: '1.45' }],
        /* legacy aliases — kept so older call sites keep compiling */
        xs2: ['var(--text-3xs)', { lineHeight: '14px' }],
        xs3: ['var(--text-2xs)', { lineHeight: '16px' }],
      },

      /* ── The spacing rhythm ─────────────────────────────────────
         Named steps so `p-panel` and `gap-cluster` mean something a
         reviewer can check, rather than `p-3` meaning whatever the
         last person felt. The numeric Tailwind scale still works and
         still lines up: 1=4, 1.5=6, 2=8, 3=12, 4=16, 5=20, 6=24.     */
      spacing: {
        hair: 'var(--sp-1)',     // 4  — icon to label
        tight: 'var(--sp-2)',    // 6  — between controls in a cluster
        control: 'var(--sp-3)',  // 8  — a control's inset, a row's inset
        panel: 'var(--sp-4)',    // 12 — panel padding
        section: 'var(--sp-5)',  // 16 — section padding
        group: 'var(--sp-6)',    // 20 — between sections
        page: 'var(--sp-7)',     // 24 — a page's outer margin
        /* structural */
        bar: 'var(--h-bar)',
        titlebar: 'var(--h-title)',
        row: 'var(--h-row)',
        rowLg: 'var(--h-lg)',
        disc: 'var(--h-disc)',
      },

      /* ── Elevation ────────────────────────────────────────────────
         Flat. `panel`, `raised` and `clip` used to carry an inset top
         highlight plus an ambient shadow so every control read as a
         lit physical plane; the reference paints one flat fill and one
         flat border and nothing else. They resolve to `none` here
         rather than being deleted, because ~30 call sites name them
         and collapsing them centrally is what makes the whole app flat
         in one move instead of thirty.

         Only things that genuinely float above the window cast, and
         they cast plain black with no lit edge.                       */
      boxShadow: {
        panel: 'none',
        raised: 'none',
        clip: 'none',
        pop: 'var(--lift-float)',
        popover: 'var(--lift-float)',
        modal: 'var(--lift-modal)',
        stage: 'none',
        /* Selection and focus stay, because they are STATE — the two
           things on this list a user reads rather than feels. Both are
           a brightened hairline, not a glow. */
        clipSelected: '0 0 0 1.5px #e8e8e8',
        focus: 'var(--focus-ring)',
      },

      /* Kept in step with --ease / --t-* in index.css. Two sources of
         truth for one curve is how half an interface ends up easing
         differently from the other half. */
      transitionTimingFunction: {
        snap: 'var(--ease)',
        ds: 'var(--ease)',
      },

      transitionDuration: {
        fast: 'var(--t-fast)',
        base: 'var(--t-base)',
        ds: 'var(--t-base)',
        slow: 'var(--t-slow)',
      },

      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        /* Indeterminate progress. The agent cannot know how many steps
           remain, and a percentage would be a guess shown as a fact. */
        'run-sweep': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(14px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.985)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        /* Live capture. Achromatic, like every other ring in the
           system — the DOT beside it carries the colour that means
           "recording", and one signal does not need two hues. */
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(232,232,232,0.35)' },
          '70%': { boxShadow: '0 0 0 5px rgba(232,232,232,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(232,232,232,0)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },

      animation: {
        'fade-in': 'fade-in var(--t-fast) var(--ease)',
        'slide-up': 'slide-up var(--t-slow) var(--ease)',
        'slide-in-right': 'slide-in-right var(--t-slow) var(--ease)',
        'scale-in': 'scale-in var(--t-base) var(--ease)',
        'pulse-ring': 'pulse-ring 2.2s var(--ease) infinite',
        shimmer: 'shimmer 1.4s infinite',
        'run-sweep': 'run-sweep 1.5s cubic-bezier(0.4,0,0.6,1) infinite',
      },
    },
  },
  plugins: [],
};
