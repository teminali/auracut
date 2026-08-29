/** @type {import('tailwindcss').Config} */

/* ═══════════════════════════════════════════════════════════════════
   Kerf design tokens.

   Three rules govern this file:

   1. SURFACE RAMP — chrome recedes, content sits forward, the stage is
      the darkest thing on screen. Adjacent steps differ by 5-8 RGB
      points: enough to read as separate planes, never enough to stripe.
   2. ONE TYPE SCALE — 10 / 11 / 12 / 13 / 15. Nothing in between.
      Half-pixel sizes are what make an interface look improvised.
   3. COLOUR IS INFORMATION — accent means "active or selected", never
      decoration. Lane hues identify a track; clip bodies stay dark and
      let the thumbnail carry the image.
   ═══════════════════════════════════════════════════════════════════ */

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* ── Hairline strokes ─────────────────────────────────────── */
        line: {
          DEFAULT: 'rgba(255,255,255,0.072)',
          soft: 'rgba(255,255,255,0.042)',
          strong: 'rgba(255,255,255,0.125)',
          bright: 'rgba(255,255,255,0.20)',
        },

        /* ── Core studio surface ramp ─────────────────────────────── */
        spectrum: {
          /* Measured off the approved design's own pages — see the
             surface-ladder note in `index.css`. Neutral dark grey; the
             blue-black tint the previous ladder had is gone because the
             design does not have it. */
          bg: '#0c0d0f',            // stage / app backdrop
          sunken: '#0a0b0d',        // recessed wells, timeline bed
          panelHeader: '#17181b',   // chrome: titlebar, toolbars, rails
          panel: '#1d1e22',         // panel bodies — the forward plane
          card: '#202126',          // cards, inputs, wells on a panel
          cardHover: '#26272c',
          hover: '#2a2b30',         // hover highlight
          active: '#32343a',        // pressed

          border: 'rgba(255,255,255,0.072)',
          borderSubtle: 'rgba(255,255,255,0.042)',
          borderStrong: 'rgba(255,255,255,0.115)',

          /* Kept in step with --text* in index.css, and `palette.test.ts`
             now FAILS if the two drift apart — these literals cannot be
             read from the CSS variables without breaking the `/50` alpha
             modifiers this codebase uses, so a test holds them together
             instead.

             Measured off the reference by counting the characters each
             element PAINTS ITSELF. An earlier pass counted `textContent`
             per element, which charges every wrapper for its whole
             subtree: <body> is white, so white scored 8838 characters
             and became `text`. Counted properly, pure white paints ZERO
             characters in the design — it is not in the palette at all.
             What the design actually paints:
               #e8e8e8 208 · #8a8a8a 97 · #b6b6bd 95 · #989898 89 */
          textBright: '#f5f5f7',
          text: '#e8e8e8',
          textMuted: '#b6b6bd',
          textDim: '#989898',
          /* Cool sibling of textDim — see --text-dim-cool in index.css. */
          textDimCool: '#8f9098',
          textFaintCool: '#7b7b84',
          textFaint: '#8a8a8a',

          /* ── The primary ──────────────────────────────────────────
             Claude's terracotta. Fourth accent this project has had
             (blue, amber, green, this), and the rule that came out of
             the earlier swaps holds: the token change is the easy part,
             every accent collides with something, and the collision
             MOVES when the accent does.

             This one is the hardest so far, because a terracotta is an
             orange-red and the warm range already housed CAUTION and
             ERROR. Measured as hue separation, not by eye:

               amber  38 deg, only 23 from the accent  -> moved to 47
               red   356 deg, only 18 from the accent  -> see below
               pink  330 deg, 45 away                  -> left alone
               blue / green / purple, 119 deg or more  -> left alone

             Amber moved to a yellower gold, which buys 32 degrees and
             is clear. RED COULD NOT BE SOLVED BY HUE: it is boxed in
             between the accent at 15 and the text lane's pink at 330,
             and every hue in that window is within 30 of one or the
             other. So it is separated by SATURATION and lightness
             instead, as a vivid red against a muted clay. That is
             mitigation rather than elimination, and it is written down
             because the next person to look will otherwise assume it
             was not checked. */
          accent: '#f28b46',
          accentHover: '#ffad72',
          accentSoft: 'rgba(242,139,70,0.15)',
          accentLine: 'rgba(242,139,70,0.42)',
          /* Type that sits ON the accent — same value as --on-accent in
             index.css, exposed as a token so call sites stop reaching
             for `text-white`, which fails AA on this orange at 2.45:1. */
          onAccent: '#2b1609',
          accentInk: '#f0a173',

          /* Every one of these is the design's own, and every one moved
             when the accent did. `palette.test.ts` is the arbiter: a
             role must clear 30 degrees of HUE from the accent or 0.15
             of SATURATION, and it prints which mechanism each uses.

             The gold is the interesting one. At 50 degrees it is only
             26 from this orange, so it does NOT clear on hue — it
             clears on saturation, a soft gold against a vivid orange.
             Error red goes the other way: the terracotta could only
             separate it by saturation, and this accent gives it 33
             degrees of hue back. */
          blue: '#5f8fd0',
          green: '#3fc46f',
          teal: '#2dd4bf',
          amber: '#e0c84d',   // keyframes and caution
          red: '#f0334f',     // 33 deg clear of the accent
          purple: '#8175d8',
          pink: '#e06aa0',
        },

        /* ── Track lane identity ──────────────────────────────────────
           Bright enough to read as a 2px spine on dark chrome; the clip
           BODY never uses these at full strength — see `clip-tint`.     */
        lane: {
          video: '#5f8fd0',
          overlay: '#8175d8',
          text: '#e06aa0',
          audio: '#3fc46f',
          effect: '#f0a173',
        },
      },

      /* ── Radii: four steps, nothing else ──────────────────────────
         6 / 8 / 11 / 15, from the approved design. Small square editor
         controls at xs, buttons and fields at sm, cards and panel
         groups at md, genuinely floating layers at lg.

         This replaced 5/7/9/13. The old ramp had steps too small to
         read: at the sizes these controls actually are, a 5px and a
         7px corner are the same corner, so the scale was decorative
         rather than informative. `squircle-xl` has no consumers and is
         kept only so a stray class name cannot fail silently. */
      borderRadius: {
        /* The sub-control step. Not part of the four — it is for things
           that are not controls: a badge on a thumbnail, a 14px `kbd`,
           inline `<code>`, a 16px keyframe stopwatch. Those were spread
           across 3px, 4px and 5px by hand, which is three values doing
           one job; forcing them up to 6px would round a 14px badge into
           a lozenge. One named step instead. */
        'squircle-2xs': '4px',
        'squircle-xs': '6px',
        'squircle-sm': '8px',
        'squircle-md': '11px',
        'squircle-lg': '15px',
        'squircle-xl': '18px',
      },

      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', 'Geist', '"Segoe UI"', 'sans-serif'],
        mono: ['"Geist Mono"', '"SF Mono"', 'Monaco', 'Menlo', 'Consolas', 'monospace'],
      },

      /* ── The whole type scale. Five sizes. ──────────────────────── */
      fontSize: {
        /* 10.5 and 12.5, not 10 and 11: measured against the reference
           at the card meta, the programme title and the card title. The
           app's scale had collapsed several of the design's steps onto
           one size, which is why dense areas read flatter than it. */
        'micro': ['10.5px', { lineHeight: '13px' }],
        'ui-xs': ['11.5px', { lineHeight: '14px' }],
        'ui-sm': ['12.5px', { lineHeight: '15px' }],
        'ui': ['12px', { lineHeight: '16px' }],
        'ui-lg': ['13px', { lineHeight: '18px', letterSpacing: '-0.005em' }],
        'ui-xl': ['15px', { lineHeight: '21px', letterSpacing: '-0.012em' }],
        /* The home screen is a launcher, not a tool surface, and the five
           sizes above are tuned for panels dense with controls. Two display
           sizes exist ONLY for it — a section heading and a hero label — so
           the exception is named here rather than scattered as raw px. */
        'display': ['17px', { lineHeight: '23px', letterSpacing: '-0.014em' }],
        'display-lg': ['20px', { lineHeight: '27px', letterSpacing: '-0.018em' }],
        /* legacy aliases — kept so older call sites keep compiling */
        '2xs': ['10px', { lineHeight: '13px', letterSpacing: '0.02em' }],
        'xs2': ['10px', { lineHeight: '14px' }],
        'xs3': ['11px', { lineHeight: '15px' }],
      },

      /* ── Elevation: an inner top highlight plus a real cast shadow ─ */
      boxShadow: {
        'panel': '0 1px 2px rgba(0,0,0,0.45)',
        'raised': 'inset 0 1px 0 rgba(255,255,255,0.055), 0 1px 2px rgba(0,0,0,0.45)',
        'pop': '0 12px 32px -8px rgba(0,0,0,0.75), 0 2px 8px -2px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.075)',
        'modal': '0 32px 80px -16px rgba(0,0,0,0.88), 0 8px 24px -8px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.085)',
        'clip': 'inset 0 1px 0 rgba(255,255,255,0.07), 0 1px 2px rgba(0,0,0,0.5)',
        'clipSelected': '0 0 0 1.5px #4a90ff, 0 4px 14px -3px rgba(74,144,255,0.5)',
        'focus': '0 0 0 2px rgba(74,144,255,0.4)',
        /* Measured off the approved editor's programme picture. */
        'stage': '0 28px 62px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08)',
      },

      /* Kept in step with --ease / --t-* in index.css. Two sources of
         truth for one curve is how half an interface ends up easing
         differently from the other half. */
      transitionTimingFunction: {
        'snap': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },

      transitionDuration: {
        'fast': '160ms',
        'base': '200ms',
        'slow': '260ms',
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
          from: { opacity: '0', transform: 'scale(0.975)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(51,201,141,0.55)' },
          '70%': { boxShadow: '0 0 0 5px rgba(51,201,141,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(51,201,141,0)' },
        },
        'shimmer': { '100%': { transform: 'translateX(100%)' } },
      },

      animation: {
        'fade-in': 'fade-in 0.13s ease-out',
        'slide-up': 'slide-up 0.19s cubic-bezier(0.32,0.72,0,1)',
        'slide-in-right': 'slide-in-right 0.19s cubic-bezier(0.32,0.72,0,1)',
        'scale-in': 'scale-in 0.15s cubic-bezier(0.32,0.72,0,1)',
        'pulse-ring': 'pulse-ring 2.2s ease-out infinite',
        'shimmer': 'shimmer 1.4s infinite',
        'run-sweep': 'run-sweep 1.5s cubic-bezier(0.4,0,0.6,1) infinite',
      },
    },
  },
  plugins: [],
};
