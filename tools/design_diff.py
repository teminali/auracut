#!/usr/bin/env python3
"""
Measure the approved prototype and the live app, and print the gaps.

Why this exists: the prototype's values are generated inline and matched
by attribute selectors, so its stylesheets do NOT hold the numbers a
component renders with. Reading its HTML produces an APPROXIMATION and
nothing in the loop ever says the approximation is wrong -- which is how
a migration can pass 602 self-checks and still not look like the design.
Both ends are measured from the rendered DOM, and the design is the
authority: every row printed is a place the app must move.

    KERF_RPC_PORT=3939 python3 tools/design_diff.py editor

Add roles to ROLES; a role is (prototype selector, app selector).
"""

import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kerf_rpc import raw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROTO = os.environ.get('KERF_PROTO_ORIGIN', 'http://127.0.0.1:4173')

PAGES = {
    'editor': (f'{PROTO}/Kerf%20Editor.dc.html', {
        # Verified against the rendered tree of BOTH sides before use --
        # a wrong pairing invents a gap, and "fixing" an invented gap is
        # how the app drifted away from the design in the first place.
        'panelHeader':  ('.kerf-library > div:first-child',
                         '.editor-library .panel-header'),
        # Outer-to-outer: the reference wraps its title in a pill and
        # the inner span is only the text node. Comparing the inner one
        # against the app's pill invented six gaps that were not real.
        'panelTitle':   ('.kerf-library > div:first-child > span:nth-child(1)',
                         '.editor-library .panel-title', {'skip': {'_w'}}),
        'programTitle': ('.kerf-program > div:first-child > span:nth-child(1)',
                         '.editor-program-header > div:first-child > span:first-child',
                         {'skip': {'_w'}}),
        'importButton': ('.kerf-library > div:first-child span.scp7',
                         '.editor-library .editor-library-action', {'skip': {'_w'}}),
        # Vertical padding is skipped: both render 30px and centre their
        # content, the reference by padding and the app by flex. Same
        # picture, different mechanism.
        'searchField':  ('.kerf-library > div:nth-child(2) > span',
                         '.editor-library .pro-input',
                         {'skip': {'paddingTop', 'paddingBottom', '_w'}}),
        'mediaCard':    ('.kfmedia',
                         '.editor-library .card-interactive'),
        # Sub-roles that pin which INK role each ladder step belongs to.
        'cardTitle':    ('.kfmedia > span:nth-child(2) > span:nth-child(1)',
                         '.editor-library .card-interactive p:first-of-type'),
        'cardMeta':     ('.kfmedia > span:nth-child(2) > span:nth-child(2)',
                         '.editor-library .card-interactive p:last-of-type'),
        'mediaThumb':   ('.kfmedia > :first-child',
                         '.editor-library .card-interactive > div:first-child'),
        # `height` is skipped: the reference DECLARES 24px but renders
        # 22.1 on screen, so the rectangle is the honest target and the
        # declared value would pull the app away from what is drawn.
        'addButton':    ('.kfadd',
                         '.editor-library .card-interactive > div:last-child > span:last-child',
                         {'skip': {'height'}}),
        'railTab':      ('.kerf-rail-tab',
                         '.editor-rail .rail-tile'),
        'inspectorTab': ('.kerf-inspector-tab',
                         '.editor-inspector [role=tab]', {'skip': {'_w'}}),
        'sliderTrack':  ('.kfslider',
                         ".editor-inspector div[class*='h-[5px]']"),
        # The app names its regions after the prototype's, one for one,
        # so these pairs are structural rather than guessed.
        'transportTime':   ('.kerf-transport-time', '.editor-transport-time', {'skip': {'_w'}}),
        # The app's transport bar also carries the L/R audio meter, which
        # the prototype does not draw. The handover is explicit that a
        # real control absent from the reference stays -- so the row is
        # 131px narrower here, on purpose.
        'transportRow':    ('.kerf-transport-row', '.editor-transport-row', {'skip': {'_w'}}),
        # The reference's header IS the label; the app puts the label in
        # a child span. Comparing the two containers measured a caps
        # micro-label against a plain box.
        # Split in two: the reference's header IS its own label, so its
        # box compares to the app's box and its type compares to the
        # app's inner span. One pairing cannot answer both.
        'trackListHeader': ('.kerf-track-list-header', '.editor-track-list-header',
                            {'skip': {'color', 'fontSize', 'fontWeight', 'letterSpacing', '_w'}}),
        'trackListLabel':  ('.kerf-track-list-header', '.editor-track-list-header .panel-title',
                            {'only': {'color', 'fontSize', 'fontWeight', 'letterSpacing'}}),
        # An UNSELECTED row on both sides: the app draws an accent spine
        # on the active one, and comparing it against the reference's
        # idle row reports that spine as a design gap.
        # Track height is PER-PROJECT DATA, not styling: the loaded
        # project carries whatever heights it was saved with, so the
        # measurement says nothing about whether the app matches the
        # design. The default is locked by a unit test instead.
        'trackRow':        ('.kerf-track-row', '.editor-track-row:not(.is-active)',
                            {'skip': {'_h', 'height'}}),
        # An unselected clip: the app rings the selected one in accent.
        # `backgroundColor` is skipped because the reference's clip is
        # transparent over its lane while the app paints its own base --
        # `paintedBg` is the honest comparison and IS checked.
        'clip':            ('.kfclip', '.editor-clip:not(.is-selected)',
                            # `paintedBg` too: both sides tint the clip in
                            # its lane colour, but the reference paints
                            # that onto the clip while the app uses a
                            # child overlay, which an ancestor walk
                            # cannot see.
                            {'skip': {'_h', 'height', '_w', 'backgroundColor', 'paintedBg'}}),
        'timeRuler':       ('.kerf-time-ruler', '.editor-time-ruler', {'skip': {'_w'}}),
        'markerStrip':     ('.kerf-marker-strip', '.editor-marker-strip', {'skip': {'_w'}}),
    }),
    'home': (f'{PROTO}/KerfHome.dc.html', {
        'homeHeader':    ('.kerf-home-header',         '.hp-topbar'),
        'homeRail':      ('.kerf-home-rail', '.hp-rail', {'skip': {'_h', 'height'}}),
        'homeRailTab':   ('.kerf-home-rail-tab',       '.hp-rail .rail-tile'),
        'homeMain':      ('.kerf-home-main', '.hp-main', {'skip': {'_h', 'height'}}),
        # `.hp-hero` is the whole section (kicker + title + grid); the
        # reference's featured card is the MEDIA card inside it.
        'homeFeatured':  ('.kerf-home-featured', '.hp-media', {'skip': {'_w', '_h', 'height'}}),
        # The app's content column scrolls, so a 10px scrollbar gutter
        # narrows everything inside it; the static prototype has no such
        # gutter. Widths in this column, and the heights that follow from
        # them by aspect-ratio, cannot be compared.
        'homeToolbar':   ('.kerf-home-project-toolbar','.hp-projects-head', {'skip': {'_w'}}),
        'homeCard':      ('.kerf-home-project-card', '.hp-project-card', {'skip': {'_w', '_h', 'height'}}),
        'homeSkillCard': ('.kerf-home-skill-card',     '.hp-skill-card'),
        'homeStatusbar': ('.kerf-home-statusbar',      '.hp-statusbar'),
        # The update banner only exists when an update is pending, so its
        # absence is a STATE, not a missing component. Marked optional so
        # it never sits in the output as a permanent finding — a report
        # with a row nobody can act on is a report people stop reading.
        'homeNotice':    ('.kerf-home-notice', '.hp-banner', {'optional': True}),
    }),
    'player': (f'{PROTO}/KerfPlayer.dc.html', {
        # The player prototype leaves type UNSET on its icon-only chrome,
        # so those elements report the 16px UA default. That is not a
        # design decision and following it would inflate the app; type is
        # compared only where the reference actually sets it.
        # `paddingLeft` is skipped on the bar: the app insets it for the
        # macOS traffic lights, which a web prototype has none of.
        'playerBar':      ('.kfbar', '.kp-top',
                           {'skip': {'fontSize', 'letterSpacing', 'paddingLeft'}}),
        'playerPlay':     ('.kf-ui-play-button', '.kp-transport button[title^="Play"]',
                           {'skip': {'fontSize', 'letterSpacing'}}),
        # Size is skipped: the prototype draws this same control 28x26 on
        # the player page and 30x28 on the editor page, so it has no one
        # answer to give. The app sits between them at 28x28.
        'playerIconBtn':  ('.kf-ui-icon-button', '.kp-transport button[title^="Go to start"]',
                           {'skip': {'fontSize', 'letterSpacing', '_h', 'height', 'borderTopWidth'}}),
        # An INACTIVE tool on both sides -- the reference's first tool is
        # the selected one and carries the accent tint.
        'playerToolBtn':  ('.kf-ui-toolbar-button ~ .kf-ui-toolbar-button', '.kp-quick button',
                           {'skip': {'_w', 'paddingTop', 'paddingBottom'}}),
    }),
}

SETUP = {
    'editor': lambda: (ensure_editor(), ensure_panel('Media'), ensure_selection()),
    'home': lambda: ensure_route('home', '.home-stage', 'Back to home'),
    'player': lambda: (ensure_player(), reveal_player_chrome()),
}


def ensure_player(timeout: float = 12.0) -> None:
    """Open the shared Player from Home, the way the product does."""
    import time
    ensure_route('home', '.home-stage', 'Back to home')
    for _ in range(int(timeout * 2)):
        if raw('debug/eval', {'expression':
                "Boolean(document.querySelector('.kp-root'))"}).get('result'):
            return
        raw('debug/eval', {'expression': """
            (() => {
              const b = [...document.querySelectorAll('button')]
                .find(e => (e.getAttribute('title') || '').startsWith('Play '));
              b?.click();
              return Boolean(b);
            })()
        """})
        time.sleep(0.5)
    raise SystemExit('Player never opened; refusing to measure an empty screen.')


def reveal_player_chrome(timeout: float = 6.0) -> None:
    """
    Wake the player's overlays before measuring them.

    They recede on idle by design, and a receding bar measures 32px
    mid-transition instead of its real 52 -- a difference invented
    entirely by the act of looking.
    """
    import time
    for _ in range(int(timeout * 2)):
        raw('debug/eval', {'expression': """
            (() => {
              const r = document.querySelector('.kp-root') || document.body;
              for (const type of ['pointermove', 'mousemove']) {
                r.dispatchEvent(new MouseEvent(type, {bubbles: true, clientX: 700, clientY: 400}));
              }
              return true;
            })()
        """})
        time.sleep(0.35)
        hidden = raw('debug/eval', {'expression':
            "Boolean(document.querySelector('.kp-top.kp-hidden'))"}).get('result')
        if not hidden:
            time.sleep(0.35)
            return
    raise SystemExit('Player chrome stayed hidden; it would measure mid-transition.')

# Properties worth comparing: the ones that decide whether a control is
# the same SHAPE. Colour is included because a surface that is one step
# off reads as a different material.
PROPS = ['height', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
         'borderRadius', 'borderTopWidth', 'backgroundColor', 'color',
         'fontSize', 'fontWeight', 'letterSpacing', 'boxShadow', 'columnGap']

# Compared in addition to the declared values above; see effectiveBg.
DERIVED = ['paintedBg']



def _channels(value):
    """
    A bare rgb()/rgba() -> [r, g, b, a]; None for anything else.

    It must be the WHOLE value: a box-shadow also starts with `rgba(`,
    and treating one as a colour compared its first three numbers and
    called two identical shadows different.
    """
    import re
    if not isinstance(value, str):
        return None
    m = re.fullmatch(r'rgba?\(([^)]*)\)', value.strip())
    if not m:
        return None
    parts = [float(n) for n in re.findall(r'[\d.]+', m.group(1))]
    if len(parts) < 3:
        return None
    return parts[:3] + [parts[3] if len(parts) > 3 else 1.0]


def same(want, have) -> bool:
    """
    Equal, or too close for an eye to call.

    Greys within 4/255 are indistinguishable on screen, and reporting
    them buys nothing but noise -- which is dangerous, because a list
    where most rows do not matter trains you to skim the ones that do.
    Anything larger is still reported exactly.
    """
    import re
    if str(want) == str(have):
        return True
    a, b = _channels(want), _channels(have)
    if a and b:
        return all(abs(x - y) <= 4 for x, y in zip(a[:3], b[:3])) and abs(a[3] - b[3]) <= 0.03

    # Sub-pixel: the reference lays out in fractional CSS pixels, so a
    # 30px control measures 30.5 against the app's 30. Half a pixel is
    # not a difference anybody can see or act on.
    # A circle is a circle: `50%` and a 9999px pill draw the same disc.
    if {str(want), str(have)} & {'50%'} and (
            str(want) == '50%' or str(have) == '50%'):
        other = str(have) if str(want) == '50%' else str(want)
        if other == '50%':
            return True
        m = re.fullmatch(r'([\d.]+)px', other)
        if m and float(m.group(1)) >= 999:
            return True

    # Tailwind emits empty ring/offset shadows before the real one; they
    # paint nothing and are not a difference.
    if 'px' in str(want) and 'px' in str(have) and ('rgba(0, 0, 0, 0) 0px 0px 0px 0px' in str(have)
                                                    or 'rgba(0, 0, 0, 0) 0px 0px 0px 0px' in str(want)):
        strip = lambda v: ', '.join(
            part for part in str(v).split(', rgba') if 'rgba(0, 0, 0, 0) 0px 0px 0px 0px' not in ('rgba' + part))
        clean = lambda v: str(v).replace('rgba(0, 0, 0, 0) 0px 0px 0px 0px, ', '')
        if clean(want) == clean(have):
            return True

    if ' (ramp)' in str(want) or ' (ramp)' in str(have):
        return same(str(want).replace(' (ramp)', ''), str(have).replace(' (ramp)', ''))

    nums = re.fullmatch(r'([\d.]+)px', str(want)), re.fullmatch(r'([\d.]+)px', str(have))
    if all(nums):
        w, h = float(nums[0].group(1)), float(nums[1].group(1))
        # Fully-rounded is fully-rounded: 999px and 9999px draw the same
        # pill on a control tens of pixels tall.
        if w >= 999 and h >= 999:
            return True
        return abs(w - h) <= 0.6
    try:
        return abs(float(want) - float(have)) <= 0.6
    except (TypeError, ValueError):
        return False


def expression(selectors: dict) -> str:
    """One measuring routine, so neither side is measured differently."""
    return r"""
    (() => {
      const P = %s;
      const M = %s;
      /*
        What a surface actually LOOKS like, not what it declares.
        `getComputedStyle` hands back the specified colour, so a
        translucent tint and the opaque colour it composites to read as
        a mismatch while being pixel-identical -- and the reverse hides
        a real difference when the two sit on different parents. Both
        sides go through this, so the comparison is like for like.
      */
      const parse = (c) => {
        const m = c.match(/[\d.]+/g);
        if (!m) return null;
        return [ +m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3] ];
      };
      /*
        A gradient paints, but `backgroundColor` stays transparent behind
        it -- so walking colours alone reports the PARENT's surface and
        invents a difference on every gradient-filled panel. Two-stop
        vertical gradients are averaged, which is what the eye does with
        a 5-unit ramp anyway; the value is marked so it is never mistaken
        for a flat colour.
      */
      const over = (top, bottom) => {
        if (!top || top[3] === 0) return bottom;
        if (!bottom) return top;
        const a = top[3];
        return [
          top[0] * a + bottom[0] * (1 - a),
          top[1] * a + bottom[1] * (1 - a),
          top[2] * a + bottom[2] * (1 - a),
          a + bottom[3] * (1 - a),
        ];
      };
      const layerOf = (n) => {
        const cs = getComputedStyle(n);
        const base = parse(cs.backgroundColor);
        const img = cs.backgroundImage;
        if (img && img !== 'none') {
          const stops = (img.match(/rgba?\([^)]*\)/g) || []).map(parse).filter(Boolean);
          if (stops.length) {
            const avg = [0, 1, 2, 3].map((i) => stops.reduce((t, c) => t + c[i], 0) / stops.length);
            // The ramp sits ON the element's own colour, not instead of
            // it: a faint white overlay is decoration, not the surface.
            const composed = over(avg, base);
            if (composed) return [composed[0], composed[1], composed[2], composed[3], true];
          }
        }
        return base;
      };
      const effectiveBg = (el) => {
        let acc = null, ramp = false;
        for (let n = el; n; n = n.parentElement) {
          const c = layerOf(n);
          if (!c || c[3] === 0) continue;
          if (c[4]) ramp = true;
          acc = acc === null ? c : [
            acc[0] + (c[0] - acc[0]) * (1 - acc[3]),
            acc[1] + (c[1] - acc[1]) * (1 - acc[3]),
            acc[2] + (c[2] - acc[2]) * (1 - acc[3]),
            acc[3] + c[3] * (1 - acc[3]),
          ];
          if (acc[3] >= 0.999) break;
        }
        if (!acc) return 'none';
        const rgb = `rgb(${acc.slice(0,3).map(Math.round).join(', ')})`;
        return ramp ? `${rgb} (ramp)` : rgb;
      };
      const read = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const s = getComputedStyle(el), r = el.getBoundingClientRect();
        const o = { _w: Math.round(r.width * 10) / 10, _h: Math.round(r.height * 10) / 10 };
        for (const p of P) o[p] = s[p];
        o.paintedBg = effectiveBg(el);
        return o;
      };
      const out = {};
      for (const k in M) out[k] = read(M[k]);
      return out;
    })()
    """ % (json.dumps(PROPS), json.dumps(selectors))


def ensure_route(what: str, marker: str, button: str, timeout: float = 12.0) -> None:
    """
    Drive the app to a route the way a person would, and refuse to
    measure if it does not get there -- an empty room reports every
    role as MISSING, which reads exactly like a set of findings.
    """
    import time
    if raw('debug/eval', {'expression':
            "Boolean(document.querySelector('vite-error-overlay'))"}).get('result'):
        raise SystemExit('Vite is showing a build error; the app on screen is stale. Fix it, then measure.')
    for _ in range(int(timeout * 2)):
        if raw('debug/eval', {'expression': f"Boolean(document.querySelector({marker!r}))"}).get('result'):
            return
        raw('debug/eval', {'expression': """
            (() => {
              const want = %r;
              const b = [...document.querySelectorAll('button')].find(e =>
                (e.getAttribute('title') || '') === want || (e.textContent || '').trim() === want);
              b?.click();
              return Boolean(b);
            })()
        """ % button})
        time.sleep(0.5)
    raise SystemExit(f'Could not reach {what}; measurement aborted rather than reported empty.')


def ensure_editor(timeout: float = 12.0) -> None:
    """
    Put the live app in the editor before measuring.

    Editing `index.css` triggers an HMR reload that returns the app to
    Home, and a measurement taken there reports every editor role as
    MISSING -- which reads like a finding and is actually an empty room.
    A run that cannot reach the editor stops rather than reporting
    zero gaps.
    """
    import time
    # A compile error leaves the LAST GOOD build on screen and Vite
    # marks it with an overlay element. Measuring then reports the
    # previous code's numbers as if they were current -- which is how a
    # broken tree can look like progress.
    if raw('debug/eval', {'expression':
            "Boolean(document.querySelector('vite-error-overlay'))"}).get('result'):
        raise SystemExit('Vite is showing a build error; the app on screen is stale. Fix it, then measure.')
    for _ in range(int(timeout * 2)):
        state = raw('debug/eval', {'expression':
            "document.querySelector('.editor-shell') ? 'editor' : 'away'"}).get('result')
        if state == 'editor':
            return
        raw('debug/eval', {'expression': """
            (() => {
              const b = [...document.querySelectorAll('button')]
                .find(e => (e.textContent || '').trim() === 'Resume editing');
              b?.click();
              return Boolean(b);
            })()
        """})
        time.sleep(0.5)
    raise SystemExit('Could not reach the editor; measurement aborted rather than reported empty.')


def ensure_panel(label: str = 'Media', timeout: float = 6.0) -> None:
    """
    Pin the library to the panel the roles were written against.

    The rail remembers whichever tab was last used, so a run could
    compare the reference's MEDIA list against whatever the app happened
    to be showing -- colour presets, say -- and report the difference as
    a design gap. Every row it printed would be real and every one of
    them meaningless. The panel is asserted, not assumed.
    """
    import time
    for _ in range(int(timeout * 2)):
        seen = raw('debug/eval', {'expression':
            "document.querySelector('.editor-library .panel-title')?.textContent?.trim() || ''"}).get('result')
        if (seen or '').lower() == label.lower():
            return
        raw('debug/eval', {'expression': """
            (() => {
              const b = [...document.querySelectorAll('.editor-rail button')]
                .find(e => (e.getAttribute('aria-label') || '').startsWith(%r));
              b?.click();
              return Boolean(b);
            })()
        """ % label})
        time.sleep(0.4)
    raise SystemExit(f'Library never showed {label!r}; refusing to measure the wrong panel.')


def ensure_selection(timeout: float = 6.0) -> None:
    """
    Select a clip, so the inspector has something to render.

    With nothing selected the inspector shows its empty state and every
    inspector role reports MISSING -- indistinguishable, in the output,
    from a control the app does not have.
    """
    import time
    for _ in range(int(timeout * 2)):
        if raw('debug/eval', {'expression':
                "Boolean(document.querySelector('.editor-inspector [role=tab]'))"}).get('result'):
            return
        raw('debug/eval', {'expression':
            "(document.querySelector('.clip-body')?.click(), true)"})
        time.sleep(0.4)
    raise SystemExit('No clip could be selected; inspector roles would report as missing.')


def measure_prototype(url: str, selectors: dict) -> dict:
    env = {k: v for k, v in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
    result = subprocess.run(
        ['npx', 'electron', 'tools/proto_probe.cjs', url, expression(selectors)],
        cwd=ROOT, env=env, capture_output=True, text=True, timeout=180)
    body = result.stdout[result.stdout.find('{'):]
    if not body.strip():
        raise SystemExit(f'prototype probe returned nothing:\n{result.stderr[-800:]}')
    return json.loads(body)


def measure_app(selectors: dict) -> dict:
    return raw('debug/eval', {'expression': expression(selectors)}).get('result') or {}


def main() -> None:
    page = sys.argv[1] if len(sys.argv) > 1 else 'editor'
    url, roles = PAGES[page]
    SETUP[page]()
    design = measure_prototype(url, {k: v[0] for k, v in roles.items()})
    actual = measure_app({k: v[1] for k, v in roles.items()})
    opts = {k: (v[2] if len(v) > 2 else {}) for k, v in roles.items()}

    gaps = 0
    for role in roles:
        want, have = design.get(role), actual.get(role)
        if have is None and opts[role].get('optional'):
            print(f'\n{role}: not on screen (state-dependent, not compared)')
            continue
        if want is None or have is None:
            print(f'\n{role}: MISSING on '
                  f'{"design" if want is None else ""}{" and " if want is None and have is None else ""}'
                  f'{"app" if have is None else ""} '
                  f'(design={roles[role][0]!r} app={roles[role][1]!r})')
            gaps += 1
            continue
        only = opts[role].get('only')
        skip = opts[role].get('skip', set())
        fields = list(only) if only else [f for f in ['_w', '_h'] + PROPS + DERIVED if f not in skip]
        rows = [(p, want[p], have[p]) for p in fields if not same(want[p], have[p])]
        if not rows:
            print(f'\n{role}: matches')
            continue
        gaps += len(rows)
        print(f'\n{role}')
        for prop, w, h in rows:
            print(f'  {prop:<16} design {str(w):<34} app {h}')

    print(f'\n{gaps} gap(s). The design column is the target.')


if __name__ == '__main__':
    main()
