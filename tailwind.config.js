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
          bg: '#060709',            // stage / app backdrop — darkest plane
          sunken: '#0a0b0e',        // recessed wells, timeline bed
          panelHeader: '#111318',   // chrome: titlebar, toolbars, rails
          panel: '#16191f',         // panel bodies — the forward plane
          card: '#1e222a',          // cards, inputs, wells on a panel
          cardHover: '#252a33',
          hover: '#2b313b',         // hover highlight
          active: '#343b47',        // pressed

          border: 'rgba(255,255,255,0.072)',
          borderSubtle: 'rgba(255,255,255,0.042)',
          borderStrong: 'rgba(255,255,255,0.125)',

          text: '#e6e9ef',
          textMuted: '#a2aab8',
          textDim: '#6f7887',
          textFaint: '#4e5663',

          /* ── The primary ──────────────────────────────────────────
             Amber. Note what it collides with and how that is resolved:
             `amber` below still means KEYFRAME and CAUTION, and those
             are close enough to the accent to be read as the same
             signal. Keyframes are fine — a keyframe at the playhead IS
             an active thing, which is what accent means. The timeline's
             SNAP GUIDE was not fine (an amber line beside an amber
             playhead is two different meanings in one colour) and has
             moved to teal. */
          accent: '#f2a026',
          accentHover: '#ffb445',
          accentSoft: 'rgba(242,160,38,0.15)',
          accentLine: 'rgba(242,160,38,0.42)',

          blue: '#4a90ff',
          green: '#33c98d',
          teal: '#2dd4bf',
          amber: '#f0a92e',
          red: '#ee5a63',
          purple: '#a081f5',
          pink: '#ee6fae',
        },

        /* ── Track lane identity ──────────────────────────────────────
           Bright enough to read as a 2px spine on dark chrome; the clip
           BODY never uses these at full strength — see `clip-tint`.     */
        lane: {
          video: '#4a90ff',
          overlay: '#a081f5',
          text: '#ee6fae',
          audio: '#33c98d',
          effect: '#f0a92e',
        },
      },

      /* ── Radii: four steps, nothing else ────────────────────────── */
      borderRadius: {
        'squircle-xs': '5px',
        'squircle-sm': '7px',
        'squircle-md': '9px',
        'squircle-lg': '13px',
        'squircle-xl': '18px',
      },

      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"SF Mono"', 'Monaco', 'Menlo', 'Consolas', 'monospace'],
      },

      /* ── The whole type scale. Five sizes. ──────────────────────── */
      fontSize: {
        'micro': ['10px', { lineHeight: '13px', letterSpacing: '0.02em' }],
        'ui-xs': ['10px', { lineHeight: '14px', letterSpacing: '0.005em' }],
        'ui-sm': ['11px', { lineHeight: '15px' }],
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
        'stage': '0 24px 64px -16px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.09)',
      },

      transitionTimingFunction: {
        'snap': 'cubic-bezier(0.32, 0.72, 0, 1)',
      },

      transitionDuration: {
        'fast': '110ms',
        'base': '170ms',
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
