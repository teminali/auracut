"""
The home screen's slots must actually do what they look like they do.

    Kerf must be running.  python3 tools/verify_home.py
                           python3 tools/verify_home.py --selftest

Every other suite in this repo measures an artifact — rendered pixels, an
exported waveform, a file on disk — because asserting against the store
would have passed on nearly everything they were written to catch. The UI
equivalent of that rule is: drive the real DOM and read what the STORES
say happened. Not "the handler is wired", not "the state is correct" —
click the thing a user clicks, then ask the app what changed.

This exists because the home screen was rebuilt around CapCut's layout,
and a launcher is exactly the kind of surface where a tile can look
perfect and be attached to nothing. Six of the eight tool tiles differ
only by which panel they open; nothing about the rendered pixels would
tell you that two of them opened the same one.

--selftest is the control, and it is the reason to believe the rest.
It runs the identical assertions with every CLICK SUPPRESSED. Each check
marked `control` must then go RED — if a check still passes when nobody
pressed anything, it was reading ambient state and proving nothing. Three
checks are deliberately not controls and say so: they are themselves the
controls for their neighbours (clearing a search restores the wall; the
agent chip's three states must differ from each other).

Needs KERF_DEBUG=1 for `debug/eval`. `run_all_suites.py` sets it on the
instance it launches.

One side effect worth knowing about: the recorder check opens the
studio, which enumerates displays through `desktopCapturer`. On a macOS
machine that has never granted Kerf screen recording, that is where the
system permission prompt appears. It is asked once, it does not block
the suite, and the check reports the permission state it found rather
than failing on it.
"""
import sys, os, json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kerf_rpc import raw

SELFTEST = '--selftest' in sys.argv

JS = r'''
(async () => {
  const SUPPRESS = %s;
  const R = [];
  const add = (name, pass, detail, control) =>
    R.push({ name, pass: !!pass, detail: String(detail), control: control !== false });
  const tick = (ms) => new Promise((r) => setTimeout(r, ms || 150));
  const click = (el) => { if (el && !SUPPRESS) el.click(); return !!el; };
  const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
  /* `data-home` rather than visible text. Matching on a label broke the
     day the hero gained a supporting line and its textContent stopped
     being exactly "New project" — a restyle must not be able to fail a
     BEHAVIOUR check. */
  const home$ = (name) => document.querySelector('[data-home="' + name + '"]');
  const tile = (label) => document.querySelector('button[title="Open the ' + label + ' panel"]');
  const sectionByHeading = (t) =>
    [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === t)?.closest('section');
  const home = async () => { window.__kerf.layout.setState({ showHome: true }); await tick(280); };
  const clips = () => window.__kerf.timeline.getState().tracks.reduce((n, t) => n + t.clips.length, 0);
  const setInput = (el, v) => {
    if (SUPPRESS) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  /* Control for the whole file: load a real project first, so "New
     project" has something to clear. Without this, an emptied timeline
     proves nothing — it was already empty. */
  await window.__kerf.executeTool('open_starter_project', {}, 'verify_home');
  await tick(450);
  const seeded = clips();
  add('control: a real project is loaded first', seeded > 0, seeded + ' clips', false);

  /* ── New project is a CHOOSER now, not an action ─────────────────
     The hero used to go straight to an empty timeline. It offers two
     starts since the screen recorder landed, so the tile must open the
     sheet and do nothing else — a hero that still cleared the timeline
     on the way to a chooser would throw away the project you were
     about to decide not to leave. */
  await home();
  const hadHero = click(home$('new-project'));
  await tick(300);
  add('the hero tile exists at all', hadHero, 'found=' + hadHero, false);

  const sheetUp = !!home$('new-blank') && !!home$('new-record');
  add('the hero tile opens the chooser and changes nothing yet',
      sheetUp && clips() === seeded &&
      window.__kerf.layout.getState().showHome === true,
      'blank=' + !!home$('new-blank') + ' record=' + !!home$('new-record') +
      ' clips=' + clips() + '/' + seeded);

  click(home$('new-blank'));
  await tick(320);
  add('Blank timeline empties the timeline', seeded > 0 && clips() === 0,
      seeded + ' clips -> ' + clips());
  add('Blank timeline enters the editor',
      window.__kerf.layout.getState().showHome === false,
      'showHome=' + window.__kerf.layout.getState().showHome);
  add('Blank timeline resets the project name',
      window.__kerf.project.getState().project.name === 'Untitled project',
      window.__kerf.project.getState().project.name);

  /* ── Record the screen ────────────────────────────────────────────
     Opens the studio and NOTHING else. The canvas size comes from the
     display that gets captured and the clips from the files that get
     written, so there is nothing to decide about the project until a
     take exists — and a launcher that wiped the open project on the way
     into a recorder you then cancelled would be unforgivable. */
  await window.__kerf.executeTool('open_starter_project', {}, 'verify_home');
  await tick(450);
  const beforeRecorder = clips();
  await home();
  window.__kerf.recorder.setState({ isOpen: false });
  await tick(120);
  click(home$('new-project'));
  await tick(240);
  click(home$('new-record'));
  await tick(360);
  /* `desktopCapturer` has to walk every window on the machine, which on a
     busy desktop takes longer than a tick. Waited for rather than
     sampled: reporting "0 sources" because the answer had not arrived
     yet reads as a broken enumerator. */
  for (let i = 0; i < 24 && window.__kerf.recorder.getState().sourcesLoading; i++) await tick(250);
  const rec = window.__kerf.recorder.getState();
  add('Record the screen opens the recorder and leaves the project alone',
      rec.isOpen === true && rec.phase === 'setup' &&
      beforeRecorder > 0 && clips() === beforeRecorder &&
      window.__kerf.layout.getState().showHome === true,
      'open=' + rec.isOpen + ' phase=' + rec.phase +
      ' clips=' + clips() + '/' + beforeRecorder);
  add('the recorder offers a real source list',
      Array.isArray(rec.sources),
      (rec.sources || []).length + ' sources, screen permission=' +
      ((rec.permissions && rec.permissions.screen) || 'unknown'), false);
  window.__kerf.recorder.getState().close();
  await tick(200);

  /* ── Tool tiles open the panel they name, and not a different one ── */
  for (const [label, tab] of [['Captions', 'captions'], ['Colour', 'filters'],
                              ['Transitions', 'transitions'], ['Media', 'media']]) {
    await home();
    window.__kerf.layout.setState({ activeTab: tab === 'media' ? 'audio' : 'media' });
    await tick(140);
    click(tile(label));
    await tick(300);
    const l = window.__kerf.layout.getState();
    add('the ' + label + ' tile opens the ' + tab + ' panel',
        l.activeTab === tab && l.showHome === false,
        'tab=' + l.activeTab + ' showHome=' + l.showHome);
  }

  /* ── Copilot card ────────────────────────────────────────────── */
  await home();
  window.__kerf.project.setState({ isCopilotOpen: false });
  await tick(140);
  click(home$('copilot'));
  await tick(300);
  add('the Copilot card opens the drawer',
      window.__kerf.project.getState().isCopilotOpen === true &&
      window.__kerf.layout.getState().showHome === false,
      'copilotOpen=' + window.__kerf.project.getState().isCopilotOpen);

  /* ── Nav toggles the view both ways ──────────────────────────── */
  await home();
  const heroBefore = !!home$('new-project');
  click(btn('Skills'));
  await tick(240);
  /* Pinned to the view's HEADING, not to its prose. The first version of
     this check looked for "Not built yet." — the Skills panel's text at
     the time — and went red the day that panel became a real store. The
     heading is what identifies the view; the copy inside it is not. */
  const onSkills = document.querySelector('main h2')?.textContent?.trim() === 'Skills'
                   && !home$('new-project');
  click(btn('Home'));
  await tick(240);
  const backHome = !!home$('new-project');
  add('the Skills / Home nav toggles the view', heroBefore && onSkills && backHome,
      'hero=' + heroBefore + ' skills=' + onSkills + ' back=' + backHome);

  /* ── Projects: search, empty state, view mode ────────────────── */
  const sec = () => sectionByHeading('Projects');
  const tiles = () => sec().querySelectorAll('[data-home="project-tile"]').length;
  const before = tiles();
  click(sec().querySelector('button[title="Search projects"]'));
  await tick(220);
  const input = sec().querySelector('input');
  if (input) setInput(input, 'zzzz-no-such-project');
  await tick(240);
  add('search filters the wall', before > 0 && tiles() === 0, before + ' tiles -> ' + tiles());
  add('an empty filter says so, rather than showing nothing',
      sec().textContent.includes('Nothing here matches'),
      sec().textContent.includes('Nothing here matches') ? 'shown' : 'NO empty state');
  if (input) setInput(input, '');
  await tick(240);
  add('control: clearing the search brings the wall back', tiles() === before,
      tiles() + ' vs ' + before, false);

  const gridBefore = !!sec().querySelector('div.grid');
  const select = sec().querySelector('select');
  if (select && !SUPPRESS) {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'list');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await tick(240);
  add('the view mode really changes the layout',
      gridBefore === true && !sec().querySelector('div.grid'),
      'grid before=' + gridBefore + ' after=' + !!sec().querySelector('div.grid'));

  /* ── A project tile opens THAT project ───────────────────────── */
  await home();
  window.__kerf.timeline.getState().loadProject([], []);
  await tick(180);
  click(sectionByHeading('Projects').querySelector('[data-home="project-tile"] button'));
  await tick(800);
  add('a project tile opens that project',
      clips() > 0 && window.__kerf.layout.getState().showHome === false,
      window.__kerf.project.getState().project.name + ' / ' + clips() + ' clips');

  /* ── Unknown is not absent (HANDOVER §3) ─────────────────────── */
  await home();
  const chip = () => document.querySelector('header button')?.textContent.trim();
  window.__kerf.agent.setState({ status: null });
  await tick(200);
  const unknown = chip();
  window.__kerf.agent.setState({ status: { installed: false, path: null, version: null, running: false } });
  await tick(200);
  const absent = chip();
  window.__kerf.agent.setState({ status: { installed: true, path: '/x', version: '1', running: false, label: 'Claude Code' } });
  await tick(200);
  const ready = chip();
  add('the agent chip has three states, not two',
      unknown === 'checking…' && absent === 'no agent' && ready === 'Claude Code',
      [unknown, absent, ready].join(' | '), false);

  /* ── A broken file is reported, not swallowed ────────────────── */
  await home();
  window.__kerf.ui.setState({ toasts: [] });
  const fileInput = document.querySelector('input[type="file"]');
  if (fileInput && !SUPPRESS) {
    const dt = new DataTransfer();
    dt.items.add(new File(['{not json'], 'broken.kerf.json', { type: 'application/json' }));
    Object.defineProperty(fileInput, 'files', { value: dt.files, configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await tick(450);
  const toasts = window.__kerf.ui.getState().toasts;
  add('a broken project file errors and stays on home',
      toasts.some((t) => t.kind === 'error') &&
      window.__kerf.layout.getState().showHome === true,
      JSON.stringify(toasts.map((t) => t.kind + ':' + t.title)) || 'no toast');

  /* ── Every control has a name a screen reader can read ────────── */
  /*
    Not a home-screen check, an app check, and it lives here because
    this is the suite that can already drive the UI.

    `grep -rn 'aria-' src/components` returned ONE hit across ~12k lines
    at the start of this work, and it was a decorative `aria-hidden` on
    the logo. 195 buttons, 202 `title` tooltips, zero accessible names.
    A `title` is not a name: it is not announced reliably by any screen
    reader, so an icon-only button was announced as "button" and nothing
    else. Sixty-seven of them in the editor alone.
  */
  await window.__kerf.executeTool('open_starter_project', {}, 'verify_home');
  await tick(700);
  window.__kerf.layout.setState({ showHome: false, activeTab: 'media' });
  await tick(1200);
  const tl = window.__kerf.timeline.getState();
  const firstClip = tl.tracks.flatMap((t) => t.clips)[0];
  if (firstClip) tl.selectClip(firstClip.id);
  await tick(900);

  const controls = [...document.querySelectorAll('button, [role="button"]')];
  const nameless = controls.filter((b) =>
    !b.textContent.trim() && !b.getAttribute('aria-label') && !b.getAttribute('aria-labelledby'));
  add('control: the editor is actually mounted', controls.length > 40,
      controls.length + ' controls found', false);
  add('every control has an accessible name', nameless.length === 0,
      nameless.length === 0
        ? controls.length + ' controls, none nameless'
        : nameless.length + ' NAMELESS: ' + nameless.slice(0, 3).map(
          (b) => b.title || b.className.slice(0, 40) || '?').join(' / '), false);

  window.__kerf.layout.setState({ showHome: true });
  await tick(300);

  /* Leave the app the way it launches: on home, with the starter loaded,
     so a suite after this one does not inherit an empty timeline. */
  await window.__kerf.executeTool('open_starter_project', {}, 'verify_home');
  window.__kerf.ui.setState({ toasts: [] });
  window.__kerf.layout.setState({ showHome: true });
  await tick(200);
  return R;
})()
'''


def run(suppress: bool):
    res = raw('debug/eval', {'expression': JS % ('true' if suppress else 'false')},
              timeout=300)['result']
    if not isinstance(res, list):
        print(f'  ERROR  debug/eval did not return checks: {str(res)[:300]}')
        if isinstance(res, str) and 'KERF_DEBUG' in res:
            print('         Launch Kerf with KERF_DEBUG=1.')
        sys.exit(1)
    return res


if not SELFTEST:
    results = run(False)
    for r in results:
        print(f"  {'PASS' if r['pass'] else 'FAIL'}  {r['name']:<48} {r['detail'][:64]}")
    n = sum(1 for r in results if r['pass'])
    print(f"\n{n}/{len(results)} home-screen checks passed")
    if n != len(results):
        print('failing: ' + ', '.join(r['name'] for r in results if not r['pass']))
        sys.exit(1)
else:
    """
    Hold every click back. A check that still passes was never driven by
    the interaction it claims to test.
    """
    results = run(True)
    controls = [r for r in results if r['control']]
    went_red = [r for r in controls if not r['pass']]
    for r in controls:
        good = not r['pass']
        print(f"  {'PASS' if good else 'FAIL'}  {r['name']:<48} "
              f"{'went red with no click' if good else 'STILL PASSED — proves nothing'}")
    print(f"\n{len(went_red)}/{len(controls)} home-screen controls passed")
    if len(went_red) != len(controls):
        print('failing: ' + ', '.join(r['name'] for r in controls if r['pass']))
        sys.exit(1)
