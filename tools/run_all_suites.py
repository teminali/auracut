#!/usr/bin/env python3
"""
One command for the whole verification apparatus.

    python3 tools/run_all_suites.py            # boot Kerf, run all 8, tear it down
    npm run verify                             # the same thing

Until now "run the tests" meant: have a Kerf up, remember which port it
was on, run eight scripts by hand, and read eight last lines. There was
no `npm test`, nothing for CI, and nothing a contributor could run.

This boots its OWN Kerf on its OWN port — `KERF_RPC_PORT` picks the port
and each instance writes `mcp-kerf-<port>.json`, so this does not fight
whatever else is running — waits for the RPC to actually answer, runs the
suites against it, and kills it again, including on failure and on
Ctrl-C. Exit code is 0 only if every suite ran and every check passed.

WHY THE EXIT CODE IS NOT ENOUGH, AND THIS IS THE WHOLE POINT
------------------------------------------------------------
Six of the eight suites do not set an exit code at all. Only
`verify_playback_audio` and `verify_frame_context` call `sys.exit(1)`;
the other six print `n/m ... passed` and return 0 whether n == m or not.
A runner that trusted `returncode == 0` would report eight green suites
on a build where every check failed — which is precisely the failure
mode HANDOVER §3 is about: code that reports success and did nothing.

So a suite passes here only if ALL of these hold:

  * it exited 0,
  * it printed a summary line of the form `n/m ...`,
  * n == m, and m > 0,
  * no line in its output says FAIL, ERROR or `failing:`.

Anything else — no summary, a crash, a timeout, a missing file, an app
that died mid-run — is a FAILURE and says which. "Could not run" must
never read as "passed".

The summary is found by scanning for the LAST line matching `n/m`, not
by taking the last line: `verify_keyframes` prints its count and THEN a
`failing: ...` line, so `tail -1` shows the wrong thing exactly when a
suite is red.

TRAPS THIS HAS ALREADY WALKED INTO (NEXT.md "Getting a working loop")
--------------------------------------------------------------------
1. `ELECTRON_RUN_AS_NODE=1` is exported by VS Code's terminal. It makes
   Electron start as plain Node — `ipcMain` is undefined and main dies on
   its first `.handle`, silently. It is stripped from the child env here.
2. `electron/*.ts` compiles to `dist-electron/` and HMR does not touch
   it. This runner does NOT rebuild — a rebuild is shared state and can
   land under another process mid-run — but it does check the bundle
   exists and reports its age, so "I changed main and nothing happened"
   is visible rather than mysterious.
3. `pkill` does not reliably kill Electron. The child is started in its
   own process group and the GROUP is signalled, then the port is
   re-probed to confirm nothing still answers on it.
4. The renderer is loaded from the Vite dev server in an unpackaged
   build — `main.ts` always `loadURL`s it there. If Vite is not up there
   is no window, so this preflights the URL and refuses to launch
   rather than waiting out a readiness timeout.

AND A FIFTH, FOUND BY THIS RUNNER ON ITS FIRST FULL RUN
-------------------------------------------------------
**Vite HMR full-reloads the renderer, and a suite that is mid-call when
that happens hangs for thirty minutes.** Anyone editing `src/**` while
this runs — another agent, or you in the other window — makes Vite push a
reload to every connected client, this instance included. The renderer's
store is rebuilt, the app drops back to the home screen (or restores an
autosaved project, which is how a suite that reset the project to
`dry_none` was found sitting on "DukaBot Commercial · Seq 01"), and the
in-flight bridge request loses the window that was going to answer it.
`toolBridge`'s `SLOW_TOOLS` gives `render_export` **30 minutes**, so the
suite does not fail — it sits there. Observed: `verify_playback_audio`
stalled past nine minutes on its first render, twice, while the same
suite ran clean in under a minute on a quiet tree.

Two things follow, and both are implemented below:

  * the electron log is watched for `[vite] connecting…`, which is what a
    full reload prints, and any suite that ran across one is reported as
    DISTURBED — its numbers were measured against a renderer that
    restarted underneath it and mean less than they look like they do;
  * `--built` skips the dev server entirely and points the window at
    `dist/index.html` over `file://`, which `main.ts` will happily
    `loadURL`. No HMR client, no reloads, nothing shared with whoever is
    editing. It is the right mode for CI and for a busy tree — at the
    cost of testing the built renderer rather than the working one.
"""
import argparse
import atexit
import json
import os
import pathlib
import re
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)

SUITES = [
    'verify_keyframes',
    'verify_gpu',
    'verify_audio',
    'verify_project_format',
    'verify_tools',
    'verify_ffmpeg_bridge',
    'verify_playback_audio',
    'verify_frame_context',
    # The altitude tools. Added when three lanes merged — each lane was
    # kept out of this file so the branches could merge, so registering
    # them is deliberately one edit here rather than three there.
    'verify_montage',
    'verify_altitude',
    'verify_reference_analysis',
    # HANDOVER §8's six named regressions, asserted on purpose rather
    # than incidentally by suites written for other reasons.
    'verify_hardening',
    # The agent-tooling gap. Three lanes again, and again registered in
    # ONE edit here rather than three there, so the branches could merge.
    'verify_tracks',
    'verify_clip_ops',
    # The audit from NEXT.md §6c, as a check rather than a snippet in a
    # markdown file: every store action must be reachable by a tool or
    # excused in writing, and every "patch_clip covers it" is proven by
    # driving patch_clip.
    'verify_tool_coverage',
    # The home screen, driven through the real DOM. Last of the tool
    # suites, because it is the only one that navigates the app rather
    # than only calling tools, and it restores the launch state on the
    # way out.
    'verify_home',
    # A skill's own verification is a suite like any other, and is
    # registered here so it cannot quietly rot. It synthesises its own
    # take with ffmpeg and measures the result in pixels.
    'skills/tutorial/verify',
    # The skill BUILDER's own verification. It writes a probe skill into
    # userData, reads it back off disk and removes it, so it leaves
    # nothing behind and needs no ffmpeg.
    'skills/skill-builder/verify',
]

# Suites that shell out to ffmpeg/ffprobe themselves. Named so that a
# machine without ffmpeg gets told which four will fail and why, instead
# of four opaque tracebacks.
NEEDS_FFMPEG = {'verify_audio', 'verify_ffmpeg_bridge',
                'verify_playback_audio', 'verify_frame_context',
                'verify_montage', 'verify_reference_analysis',
                'verify_hardening', 'verify_tracks', 'verify_clip_ops',
                'skills/tutorial/verify'}

SUMMARY_RE = re.compile(r'^\s*(\d+)\s*/\s*(\d+)\s')
BAD_LINE_RE = re.compile(r'^\s*(FAIL\b|ERROR\b|failing:)')

# Electron's stock dev-mode boilerplate, stripped from log tails so the
# line that actually explains a death is visible.
NOISE_RE = re.compile(
    r'Electron Security Warning|electronjs\.org/docs/tutorial/security'
    r'|This warning will not show up|once the app is packaged'
    r'|For more information and help|exposes users of this app|security risks'
    r'|Policy set or a policy with|Download the React DevTools')

IS_WINDOWS = sys.platform == 'win32'


def _signal_group(proc, hard):
    """Kill the app and everything it spawned, on either platform.

    `os.killpg`, `os.getpgid` and `SIGKILL` do not merely behave
    differently on Windows — they do not EXIST there, so the POSIX
    teardown raised AttributeError and left an Electron running with the
    port still held. Trap 3 says believe `ps`, not the signal; on Windows
    the equivalent is `taskkill /T`, which walks the child tree the way
    killpg walks the group.
    """
    if IS_WINDOWS:
        subprocess.run(
            ['taskkill', '/PID', str(proc.pid), '/T'] + (['/F'] if hard else []),
            capture_output=True)
        return
    try:
        os.killpg(os.getpgid(proc.pid),
                  signal.SIGKILL if hard else signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        pass


GREEN, RED, YELLOW, DIM, OFF = '\033[32m', '\033[31m', '\033[33m', '\033[2m', '\033[0m'
if not sys.stdout.isatty() or os.environ.get('NO_COLOR'):
    GREEN = RED = YELLOW = DIM = OFF = ''


# ── the child app ───────────────────────────────────────────────────

class Kerf:
    """A Kerf instance this runner owns, and is responsible for killing."""

    def __init__(self, port, vite_url, log_path):
        self.port = port
        self.vite_url = vite_url
        self.log_path = log_path
        self.proc = None
        self._log = None

    def binary(self):
        rel = open(os.path.join(ROOT, 'node_modules', 'electron', 'path.txt')).read().strip()
        return os.path.join(ROOT, 'node_modules', 'electron', 'dist', rel)

    def launch(self):
        env = dict(os.environ)
        # Trap 1. Not optional, and silent when you get it wrong.
        env.pop('ELECTRON_RUN_AS_NODE', None)
        env['KERF_RPC_PORT'] = str(self.port)
        env['VITE_DEV_SERVER_URL'] = self.vite_url
        # `verify_home` drives the real DOM through `debug/eval`, which is
        # gated behind this. The instance is a throwaway on a random port
        # with its own token, launched only to be tested.
        env['KERF_DEBUG'] = '1'
        self._log = open(self.log_path, 'wb')
        # Launching the real binary rather than node_modules/.bin/electron:
        # that wrapper spawns the app as a CHILD, so killing the wrapper
        # leaves the app running. start_new_session puts the whole tree in
        # one process group we can signal as a unit (trap 3).
        # POSIX: setsid, so the whole tree is one process group we can
        # signal as a unit (trap 3). Windows has no setsid and no process
        # groups in that sense — CREATE_NEW_PROCESS_GROUP is the nearest
        # thing, and teardown there goes through taskkill /T instead.
        extra = ({'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP}
                 if IS_WINDOWS else {'start_new_session': True})
        # Chromium's sandbox needs unprivileged user namespaces, which
        # Ubuntu 24.04 restricts by default and container runners disable
        # outright — Electron then dies before it ever opens a window.
        # Passed in rather than hardcoded in main.ts, because a developer
        # machine should keep its sandbox.
        argv = [self.binary(), '.'] + shlex.split(
            os.environ.get('KERF_ELECTRON_ARGS', ''))
        self.proc = subprocess.Popen(
            argv, cwd=ROOT, env=env,
            stdout=self._log, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL, **extra)
        return self.proc.pid

    def alive(self):
        return self.proc is not None and self.proc.poll() is None

    def log_tail(self, n=25):
        try:
            lines = open(self.log_path, errors='replace').read().splitlines()
        except OSError:
            return '(no log)'
        # Electron prints four multi-line security warnings per window in
        # dev, every time. Left in, they are the whole tail and the actual
        # cause of death scrolls off. Cosmetic only — the full log is on
        # disk and its path is printed.
        lines = [x for x in lines if not NOISE_RE.search(x) and x.strip()]
        return '\n'.join('    | ' + x for x in lines[-n:]) or '    | (empty)'

    def reloads(self):
        """How many times the renderer has loaded. Every full page load —
        the first one and every Vite HMR reload after it — prints
        `[vite] connecting...` from @vite/client, so counting them counts
        reloads. Returns 0 under --built, which has no HMR client."""
        try:
            return open(self.log_path, errors='replace').read().count('[vite] connecting')
        except OSError:
            return 0

    def kill(self):
        if self.proc is None:
            return
        if self.proc.poll() is None:
            _signal_group(self.proc, hard=False)
            deadline = time.time() + 8
            while time.time() < deadline and self.proc.poll() is None:
                time.sleep(0.2)
            if self.proc.poll() is None:
                _signal_group(self.proc, hard=True)
                try:
                    self.proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
        if self._log:
            self._log.close()
            self._log = None
        # Trap 3: believe `ps`, not the signal. And a port that still
        # answers means something is still there whatever ps says.
        leaked = self.proc.poll() is None
        if port_listening(self.port):
            time.sleep(1.0)
            leaked = leaked or port_listening(self.port)
        if leaked:
            print(f'{YELLOW}  warning: pid {self.proc.pid} or port {self.port} '
                  f'survived teardown — check by hand{OFF}')


# ── ports ───────────────────────────────────────────────────────────

def port_in_use(port):
    """Can a server bind here? SO_REUSEADDR because Node sets it on
    `listen` too: a port whose only occupants are TIME_WAIT sockets from a
    just-killed instance IS free, and without this flag it reads as busy
    and the teardown check cried wolf on a process that had exited
    cleanly. TIME_WAIT does not block a bind with the flag; a live
    listener still does, which is the distinction wanted."""
    s = socket.socket()
    # SO_REUSEADDR means the OPPOSITE thing on Windows: there it lets a
    # second socket bind a port that already has a LIVE listener, so this
    # probe would call every busy port free and the runner would launch
    # onto an occupied one. SO_EXCLUSIVEADDRUSE is the flag that asks the
    # question this function means to ask.
    if IS_WINDOWS:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    else:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(('127.0.0.1', port))
        return False
    except OSError:
        return True
    finally:
        s.close()


def port_listening(port):
    """Is something ACCEPTING here? Asked by connecting, not by binding —
    the only question teardown cares about is whether the app is still
    answering, and a refused connection is an unambiguous no."""
    s = socket.socket()
    s.settimeout(1.0)
    try:
        s.connect(('127.0.0.1', port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def pick_port(preferred=None):
    if preferred:
        if port_in_use(preferred):
            die(f'port {preferred} is already in use — something is listening there')
        return preferred
    # 3888 is the default port and belongs to whatever the developer has
    # open; never take it. Start high enough to miss the ports other
    # agents' instances are already sitting on.
    for port in range(3950, 4050):
        if not port_in_use(port):
            return port
    die('no free port in 3950-4049')


def token_path(port):
    name = 'mcp-kerf.json' if port == 3888 else f'mcp-kerf-{port}.json'
    return os.path.expanduser(f'~/Library/Application Support/kerf/{name}')


# ── the RPC probe ───────────────────────────────────────────────────

def rpc(port, method, args=None, timeout=8):
    """Minimal one-shot RPC. Deliberately independent of tools/kerf_rpc.py's
    module-level port so this can probe before anything is up, with a short
    timeout — the bridge's own default is 60s, which is far too long to
    wait per readiness poll."""
    try:
        cfg = json.load(open(token_path(port)))['mcpServers']
    except (OSError, KeyError, ValueError) as e:
        raise RuntimeError(f'no usable token file at {token_path(port)}: {e}') from None
    token = cfg[next(iter(cfg))]['env']['KERF_RPC_TOKEN']
    body = json.dumps({'method': 'tools/call',
                       'params': {'name': method, 'arguments': args or {}}}).encode()
    req = urllib.request.Request(
        f'http://127.0.0.1:{port}/rpc', data=body,
        headers={'x-kerf-token': token, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def wait_ready(app, timeout):
    """Poll `describe_timeline` until it actually answers. Not a sleep: the
    window has to load from Vite, mount React and register the bridge, and
    how long that takes depends on the machine and on Vite's cache."""
    deadline = time.time() + timeout
    last = 'no attempt made'
    while time.time() < deadline:
        if app is not None and not app.alive():
            code = app.proc.returncode
            print(f'{RED}Kerf exited with code {code} before the RPC came up.{OFF}')
            print('  last lines of its log:')
            print(app.log_tail())
            if code == 0:
                print(f'{YELLOW}  exit 0 with no window is the ELECTRON_RUN_AS_NODE '
                      f'signature — but this runner strips it, so look further.{OFF}')
            return False, f'app exited (code {code})'
        try:
            r = rpc(app.port, 'describe_timeline', timeout=6)
            if r.get('result', {}).get('success'):
                return True, 'ok'
            last = json.dumps(r)[:160]
        except Exception as e:                      # noqa: BLE001 - report anything
            last = f'{type(e).__name__}: {e}'[:160]
        time.sleep(0.5)
    return False, f'timed out after {timeout}s (last: {last})'


# ── running one suite ───────────────────────────────────────────────

class Result:
    def __init__(self, name):
        self.name = name
        self.ok = False
        self.seconds = 0.0
        self.summary = ''
        self.reason = ''
        self.passed = self.total = 0
        self.log = ''
        self.ran = False
        self.reloaded = 0


def judge(name, code, out):
    """Decide pass/fail from BOTH the exit code and the printed summary.

    Six of eight suites always exit 0. Trusting the exit code alone would
    turn a red build green, which is the one outcome this whole file
    exists to prevent."""
    lines = out.splitlines()
    summary_line, n, m = '', None, None
    for line in lines:
        hit = SUMMARY_RE.match(line)
        if hit:
            summary_line, n, m = line.strip(), int(hit.group(1)), int(hit.group(2))
    bad = [l.strip() for l in lines if BAD_LINE_RE.match(l)]

    if code != 0 and n is None:
        return False, 0, 0, summary_line, f'exited {code} and printed no summary'
    if n is None:
        return False, 0, 0, '', ('exited 0 but printed no "n/m" summary — '
                                 'it did not get far enough to report')
    if m == 0:
        return False, 0, 0, summary_line, 'reported 0 checks — nothing ran'
    if code != 0:
        return False, n, m, summary_line, f'exited {code} ({n}/{m} checks passed)'
    if n != m:
        return False, n, m, summary_line, f'{m - n} of {m} checks failed'
    if bad:
        # Green count and a FAIL line in the body is a suite disagreeing
        # with itself. Say so rather than picking the flattering half.
        return False, n, m, summary_line, (f'{n}/{m} claimed, but {len(bad)} '
                                           f'FAIL/ERROR line(s) in the output')
    return True, n, m, summary_line, ''


def suite_path(name):
    """Where a suite lives.

    A plain name is one of this folder's `verify_*.py`. A name with a
    slash is a path from the repo root, which is how a SKILL's own
    verification is registered: `skills/tutorial/verify` is as much a
    check that must not rot as anything in tools/, and leaving it to be
    run by hand is how it rots.
    """
    if '/' in name:
        return os.path.join(ROOT, f'{name}.py')
    return os.path.join(TOOLS, f'{name}.py')


def run_suite(name, port, timeout, log_dir):
    r = Result(name)
    path = suite_path(name)
    if not os.path.isfile(path):
        r.reason = f'no such suite: {path}'
        return r

    env = dict(os.environ)
    env['KERF_RPC_PORT'] = str(port)
    env['PYTHONUNBUFFERED'] = '1'
    r.log = os.path.join(log_dir, f'{os.path.basename(name)}.log')
    t0 = time.time()
    # Popen rather than subprocess.run, so a Ctrl-C reaches the suite too.
    # `run` only kills its child on ITS timeout; interrupt the runner while
    # a suite is blocked on a 30-minute render_export and that suite is
    # orphaned, still holding a connection to an app that is about to die.
    proc = subprocess.Popen([sys.executable, path], cwd=ROOT, env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, start_new_session=True)
    try:
        out, code = proc.communicate(timeout=timeout)[0], proc.returncode
        r.ran = True
    except BaseException as exc:                    # noqa: BLE001 - includes SystemExit
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        out = ''
        try:
            out = proc.communicate(timeout=5)[0] or ''
        except Exception:                           # noqa: BLE001
            pass
        r.seconds = time.time() - t0
        open(r.log, 'w').write(out)
        if not isinstance(exc, subprocess.TimeoutExpired):
            raise
        r.reason = (f'timed out after {timeout}s. A suite does not normally take '
                    f'minutes; if the window reloaded under it, the tool bridge '
                    f'waits up to 30 min for render_export and it just sits there')
        return r
    r.seconds = time.time() - t0
    open(r.log, 'w').write(out)
    r.ok, r.passed, r.total, r.summary, r.reason = judge(name, code, out)
    return r


# ── preflight ───────────────────────────────────────────────────────

def die(msg):
    print(f'{RED}preflight: {msg}{OFF}')
    sys.exit(2)


def http_ok(url, timeout=3):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return 200 <= r.status < 400
    except urllib.error.HTTPError as e:
        return 200 <= e.code < 500          # it answered; that is all we need
    except Exception:                       # noqa: BLE001
        return False


def preflight(vite_url, launching, suites):
    print(f'{DIM}preflight{OFF}')
    if launching:
        binary = os.path.join(ROOT, 'node_modules', 'electron', 'dist',
                              'Electron.app', 'Contents', 'MacOS', 'Electron')
        try:
            binary = Kerf(0, '', '').binary()
        except OSError:
            pass
        if not os.path.exists(binary):
            # `npm install` was the advice here and it does not work, which
            # is worse than no advice: yarn's cached copy of `electron` is
            # the bare npm tarball with no `dist` and no `path.txt`, and a
            # reinstall restores that cache and reports "Building fresh
            # packages ... Done" without ever fetching the 95MB binary.
            # Measured after a `yarn install --frozen-lockfile` left
            # `node_modules/electron/dist` holding one licence file.
            die(
                f'no Electron binary at {binary}.\n'
                f'         `npm install` will NOT fix this: the package is installed, its '
                f'binary is not.\n'
                f'         Extract it from the download cache, which is where the postinstall '
                f'left it:\n'
                f'           rm -rf node_modules/electron/dist && mkdir -p node_modules/electron/dist\n'
                f'           unzip -q ~/Library/Caches/electron/*/electron-v*-darwin-arm64.zip '
                f'-d node_modules/electron/dist\n'
                f'           printf Electron.app/Contents/MacOS/Electron > node_modules/electron/path.txt\n'
                f'         Or clear the yarn cache for it: `yarn cache clean electron && yarn install`'
            )
        main = os.path.join(ROOT, 'dist-electron', 'main.cjs')
        if not os.path.isfile(main):
            die('dist-electron/main.cjs is missing — run `npm run build:electron`')
        age = (time.time() - os.path.getmtime(main)) / 60
        print(f'  main bundle   dist-electron/main.cjs, built {age:.0f} min ago '
              f'{DIM}(trap 2: this runner does not rebuild it){OFF}')
        print(f'  platform      {sys.platform}')
        flags = os.environ.get('KERF_ELECTRON_ARGS', '')
        if flags:
            print(f'  electron args {flags} {DIM}(KERF_ELECTRON_ARGS){OFF}')
        if vite_url.startswith('file://'):
            path = urllib.request.url2pathname(
                urllib.parse.urlparse(vite_url).path)
            if not os.path.isfile(path):
                die(f'--built needs a renderer build at {path} — run `npm run build:renderer`.\n'
                    f'            (It is shared state; if another process owns it, '
                    f'drop --built and use the dev server.)')
            age = (time.time() - os.path.getmtime(path)) / 60
            print(f'  renderer      {path}, built {age:.0f} min ago '
                  f'{DIM}(--built: no HMR, testing the BUILT renderer){OFF}')
        elif not http_ok(vite_url):
            die(f'nothing answering at {vite_url}. An unpackaged Kerf always loads the '
                f'renderer from the dev server, so there would be no window and no RPC.\n'
                f'            Start it with `npm run dev` and use the port it PRINTS, '
                f'or pass --built.')
        else:
            print(f'  renderer      {vite_url} answering '
                  f'{DIM}(dev server: an HMR reload mid-suite disturbs it){OFF}')

    for mod in ('numpy', 'PIL'):
        try:
            __import__(mod)
        except ImportError:
            die(f'python module {mod!r} is missing; every pixel suite imports it')
    print('  python        numpy, pillow present')

    ff = [b for b in ('ffmpeg', 'ffprobe') if not shutil.which(b)]
    if ff:
        affected = sorted(NEEDS_FFMPEG & set(suites))
        print(f'{YELLOW}  ffmpeg        {", ".join(ff)} NOT on PATH — '
              f'{len(affected)} suite(s) will fail: {", ".join(affected)}{OFF}')
        print(f'{YELLOW}                they are reported as failures, not skipped.{OFF}')
    else:
        print('  ffmpeg        ffmpeg, ffprobe on PATH')

    missing = [s for s in suites if not os.path.isfile(suite_path(s))]
    if missing:
        print(f'{YELLOW}  suites        {len(missing)} named suite(s) do not exist: '
              f'{", ".join(missing)} — each is a FAILURE below{OFF}')


# ── main ────────────────────────────────────────────────────────────

PORT_FALLBACK = 3888


def main():
    ap = argparse.ArgumentParser(
        description='Boot Kerf, run every verification suite, exit non-zero on failure.')
    ap.add_argument('suites', nargs='*', default=None,
                    help='suite names to run (default: all eight)')
    ap.add_argument('--port', type=int, default=None,
                    help='RPC port to use (default: first free port from 3950)')
    ap.add_argument('--vite', default=os.environ.get('VITE_DEV_SERVER_URL',
                                                     'http://localhost:5173'),
                    help='Vite dev server URL the renderer loads from')
    ap.add_argument('--built', action='store_true',
                    help='load dist/index.html over file:// instead of the dev server: '
                         'no HMR, so nobody editing src/ can reload the app mid-suite')
    ap.add_argument('--attach', action='store_true',
                    help='use a Kerf already running on --port instead of launching one')
    ap.add_argument('--keep', action='store_true',
                    help='leave the launched instance running afterwards')
    ap.add_argument('--timeout', type=int, default=900,
                    help='per-suite timeout in seconds (default 900)')
    ap.add_argument('--ready-timeout', type=int, default=120,
                    help='how long to wait for the RPC to answer (default 120)')
    ap.add_argument('--log-dir', default=None, help='where to write per-suite logs')
    args = ap.parse_args()

    suites = args.suites or list(SUITES)
    # as_uri() rather than 'file://' + path: on Windows the latter
    # produces file://C:\...\index.html — backslashes, and one slash
    # short — which Chromium will not load. This is the difference
    # between --built being attempted on Windows and failing on a path.
    vite_url = (pathlib.Path(ROOT, 'dist', 'index.html').resolve().as_uri()
                if args.built else args.vite)
    log_dir = args.log_dir or os.path.join(
        os.environ.get('TMPDIR', '/tmp'), f'kerf-verify-{int(time.time())}')
    os.makedirs(log_dir, exist_ok=True)

    t_start = time.time()
    print(f'{DIM}{"─" * 72}{OFF}')
    print(f'kerf verification · {len(suites)} suite(s) · logs in {log_dir}')
    print(f'{DIM}{"─" * 72}{OFF}')

    preflight(vite_url, launching=not args.attach, suites=suites)

    app = None
    if args.attach:
        port = args.port or PORT_FALLBACK
        print(f'\n{DIM}attaching to a Kerf already on port {port}{OFF}')
    else:
        port = pick_port(args.port)
        # A token file left by a dead instance on this port would be read
        # before the new one overwrites it, and every call would come back
        # "Bad or missing token" (NEXT.md trap 4). The port is provably
        # free, so nothing owns this file.
        stale = token_path(port)
        if os.path.exists(stale):
            os.remove(stale)
            print(f'{DIM}  removed a stale token file for port {port}{OFF}')
        app = Kerf(port, vite_url, os.path.join(log_dir, 'electron.log'))
        pid = app.launch()
        atexit.register(app.kill)
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(sig, lambda *_: sys.exit(130))
        print(f'\n{DIM}launched Kerf pid {pid} on port {port} '
              f'(log: {app.log_path}){OFF}')

    results = []
    exit_code = 1
    try:
        t0 = time.time()
        ready, why = wait_ready(app if app else _Attached(port), args.ready_timeout)
        if not ready:
            print(f'{RED}RPC never became ready: {why}{OFF}')
            if args.attach:
                print(f'  nothing usable is answering on port {port}. Is that '
                      f'instance running, and was it launched with '
                      f'KERF_RPC_PORT={port}?')
            print(f'\n{RED}FAIL{OFF}  0/{len(suites)} suites ran. '
                  f'Could not run is not the same as passed.')
            return 1
        print(f'{DIM}RPC ready in {time.time() - t0:.1f}s{OFF}\n')

        # A suite may be given as a path (that is how the failure path is
        # exercised); show the basename so one long argument does not
        # stretch every column.
        # `os.path.basename` alone turns `skills/tutorial/verify` into
        # `verify`, which is the one row nobody could identify. A suite
        # registered by path is labelled by the folder it belongs to.
        labels = {
            n: (f'{os.path.basename(os.path.dirname(n))} skill'[:34]
                if '/' in n else os.path.basename(n)[:34])
            for n in suites
        }
        width = max(len(v) for v in labels.values())
        for name in suites:
            print(f'  {labels[name]:<{width}}  {DIM}running…{OFF}', end='\r', flush=True)
            before = app.reloads() if app else 0
            r = run_suite(name, port, args.timeout, log_dir)
            r.reloaded = (app.reloads() - before) if app else 0
            results.append(r)
            mark = f'{GREEN}PASS{OFF}' if r.ok else f'{RED}FAIL{OFF}'
            count = f'{r.passed}/{r.total}' if r.total else '  - '
            tail = r.summary[len(count):].strip()[:44] if r.ok else ''
            if r.reloaded:
                tail = f'{YELLOW}DISTURBED: renderer reloaded {r.reloaded}×{OFF}'
            print(f'  {labels[name]:<{width}}  {mark}  {count:>8}  {r.seconds:6.1f}s  '
                  f'{DIM if not r.reloaded else ""}{tail}{OFF}')
            if r.reloaded:
                # A reload rebuilds the renderer's stores under the suite.
                # Whatever it measured after that, it measured on a
                # different app than the one it set up.
                print(f'         {YELLOW}Vite HMR reloaded the window mid-suite — '
                      f'something is editing src/. Re-run with --built, or on a '
                      f'quiet tree.{OFF}')
            if not r.ok:
                print(f'         {RED}{r.reason}{OFF}')
                if r.log and os.path.exists(r.log):
                    detail = [l.strip() for l in open(r.log, errors='replace')
                              if BAD_LINE_RE.match(l)][:6]
                    for d in detail:
                        print(f'         {DIM}{d[:100]}{OFF}')
                    print(f'         {DIM}full output: {r.log}{OFF}')
                # If the app itself went down, everything after this is
                # "could not run", and must not be reported as anything else.
                if app is not None and not app.alive():
                    print(f'{RED}         Kerf died during this suite.{OFF}')
                    print(app.log_tail(15))
                    for rest in suites[suites.index(name) + 1:]:
                        rr = Result(rest)
                        rr.reason = 'not run — Kerf was no longer running'
                        results.append(rr)
                        print(f'  {labels[rest]:<{width}}  {RED}FAIL{OFF}      -        0.0s')
                        print(f'         {RED}{rr.reason}{OFF}')
                    break
        exit_code = 0 if all(r.ok for r in results) else 1
    finally:
        if app is not None:
            if args.keep:
                print(f'\n{DIM}--keep: Kerf pid {app.proc.pid} left running on '
                      f'port {port}{OFF}')
                atexit.unregister(app.kill)
            else:
                atexit.unregister(app.kill)
                app.kill()

    wall = time.time() - t_start
    passed = sum(1 for r in results if r.ok)
    checks = sum(r.passed for r in results)
    total_checks = sum(r.total for r in results)
    print(f'{DIM}{"─" * 72}{OFF}')
    verdict = f'{GREEN}ALL GREEN{OFF}' if exit_code == 0 else f'{RED}FAILED{OFF}'
    scope = '' if exit_code == 0 else ' (only from suites that got far enough to report)'
    print(f'{verdict}  {passed}/{len(results)} suites, {checks}/{total_checks} checks'
          f'{scope}, {wall:.1f}s wall')
    disturbed = [r.name for r in results if r.reloaded]
    if disturbed:
        print(f'{YELLOW}  {len(disturbed)} suite(s) ran across a renderer reload: '
              f'{", ".join(disturbed)}{OFF}')
        print(f'{YELLOW}  Their results are not trustworthy whichever way they went. '
              f'Re-run with --built.{OFF}')
    if exit_code:
        for r in results:
            if not r.ok:
                print(f'  {RED}·{OFF} {os.path.basename(r.name)}: {r.reason}')
        print(f'  {DIM}logs: {log_dir}{OFF}')
    return exit_code


class _Attached:
    """Stands in for a Kerf this runner did not launch: it has a port and it
    is never 'dead', because we have no process to watch."""
    def __init__(self, port):
        self.port = port
        self.proc = None

    def alive(self):
        return True


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print(f'\n{YELLOW}interrupted — tearing down{OFF}')
        sys.exit(130)
