# NEXT — the work queue

`HANDOVER.md` is the architecture and the trust record. **This file is the
queue.** Read §3a and §3b of HANDOVER before starting anything here; they
are what the last two sessions found, and several items below only make
sense against them.

Everything in this file is open. Everything not in this file that used to
be open is done and verified — check the roadmap in HANDOVER §0, which has
been reconciled rather than left listing finished work.

---

## Getting a working loop (do this first, it has eight traps)

```bash
# 1. Vite dev server. It picks the next free port if 5173 is taken, so
#    READ the port it prints — a second one on 5174 while Electron points
#    at 5173 is a confusing ten minutes.
npm run dev

# 2. Electron, pointed at that port. `env -u` is NOT optional — trap 1.
npm run build:electron
env -u ELECTRON_RUN_AS_NODE VITE_DEV_SERVER_URL=http://localhost:5173 npx electron .

# 3. Confirm the RPC is up
python3 -c "import sys;sys.path.insert(0,'tools');from kerf_rpc import call;print(call('describe_timeline')['result']['success'])"

# 4. Load the starter to have something real on the timeline
python3 -c "import sys;sys.path.insert(0,'tools');from kerf_rpc import call;print(call('open_starter_project',{})['result']['data'])"
```

Packaged, instead of 1–2:

```bash
npm run build && npx electron-builder --mac --dir --publish never
env -i HOME="$HOME" PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
  open -a "$PWD/release/mac-arm64/Kerf.app"
ps -o pid,lstart -p $(pgrep -f "Kerf.app/Contents/MacOS/Kerf" | head -1)   # trap 3
```

**Trap 1 — `ELECTRON_RUN_AS_NODE=1`** is set in some shells (VS Code's
among them). It makes `electron .` run as plain node: `ipcMain` comes back
undefined and main dies on its first `.handle`. Always `env -u` it.

**Trap 1b, and it applies to `open` too, which is the half that costs
the hour.** `open` propagates the calling shell's environment, so
`open -a /Applications/Kerf.app` from a terminal carrying
`ELECTRON_RUN_AS_NODE=1` starts the app and kills it in about 80ms.
`open` exits **0**, no window appears, and **nothing reaches the app's
own log**, because the process dies before the logger is constructed.
The only trace is in the system log:

```
runningboardd: [app<application.com.kerf.editor...>:9614]
               termination reported by launchd (0, 0, 0)
```

Chased as a Gatekeeper problem, then as a LaunchServices duplicate-bundle
problem, then as code signing, before the controlled test: plain `open`
fails, `env -u ELECTRON_RUN_AS_NODE open` succeeds, same command
otherwise. `spctl --assess` does say "rejected" and always will for an
ad-hoc signature, which is a red herring worth knowing about.

Finder is unaffected. This only bites an agent or a developer launching
from a shell, which is exactly who reads these notes.

**Trap 2 — `electron/*.ts` compiles to `dist-electron` and HMR does not
touch it.** A main-process change needs `npm run build:electron` **and a
restart**. A test suite run against a stale main produces results that
mean nothing — the audio suite scored 2/11 that way, and one of those two
"passes" was a real filter apparently working at 2x, which was AAC
encoding variation.

**Trap 3 — `pkill` does not reliably kill Electron.** After a repackage,
check `ps -o lstart` against when the build finished before believing a
packaged result. Port 3888 answering is not evidence that the thing
answering is the thing you just built.

**Trap 7 — a lane's Electron cannot be found by its worktree path.**
Parallel work uses git worktrees whose `node_modules` is a SYMLINK to the
main repo's, so every lane's Electron main process reports its binary as
`…/auracut/node_modules/electron/…` — the MAIN path, not its own.
`pgrep -f auracut-lane1/node_modules/electron` matches nothing, a cleanup
that relies on it silently leaves instances running, and the next launch
finds the port taken. Find them through the launcher parent instead:

```bash
pgrep -f 'auracut-lane1/node_modules/.bin/electron'
lsof -nP -iTCP:<port> -sTCP:LISTEN        # or just ask who holds the port
```

**And it cuts both ways, which is the dangerous half.** A pattern that
looks lane-scoped matches nothing and silently leaves instances running.
A pattern that looks generic — `pkill -f auracut/node_modules/electron` —
matches **every lane at once** and kills all of them. I did exactly that
while cleaning up my own instances, took out another lane's Kerf and its
Vite server mid-session, and only found out because that lane noticed the
SIGKILL and worked out where it came from.

**And the same symlink had a second edge, now fixed.** `.gitignore` said
`node_modules/`, with a slash, which matches a DIRECTORY — git sees a
worktree's symlink as a file, so it showed as untracked in every lane and
one `git add -A` would have committed an absolute path from somebody's
laptop. The slash is gone.

Hit independently three times in one session. It is the same family as
traps 3 and 4, and since the EADDRINUSE fix the survivor of the first
direction is a *silent half-dead app*: it logs "port N is already in use,
so there is no RPC bridge in this instance" and then sits there looking
fine. Kill by PORT or by launcher parent. Never by the electron path.

**Trap 6b — `render_export` can stall by ~90x, and occlusion is NOT the
cause.** `npm run verify` took **1195s instead of 29**, with
`verify_audio` alone at **602.9s against its usual 7**, ffmpeg processes
idle on `pipe:0`. It happens under `--built`, so it is not trap 5 either.

The first diagnosis — including in the commit that recorded it — was
"the window is occluded". **That is wrong, and the test that shows it is
one call:** with a single instance, window behind the terminal and
`document.visibilityState === 'hidden'`, an export runs at 7.7ms/frame,
full speed. `--disable-features=MacWebContentsOcclusion` is confirmed
present in the process, so occlusion detection is off anyway.

What it actually tracks is **machine load**. The 1195s run happened at
load average 13.3 with another lane's agent driving its own Electron
instances; the fast run was at 5.5. That also explains why bringing the
window frontmost unstuck it — macOS raises a foreground app's scheduling
QoS, which matters enormously when the machine is saturated, and nothing
to do with what is painted.

**So: do not run several lanes' suites at once and believe the timings.**
`backgroundThrottling: false` is set on the window as hardening for the
ordinary case of a user switching away mid-export, but it is NOT a proven
fix for this and is not claimed as one. The root cause is contention, and
the fix is scheduling, not code.

**Trap 5 — editing `src/**` while suites run hangs them for 30 minutes.**
Vite HMR pushes a FULL PAGE RELOAD to every connected client. The
renderer's stores are rebuilt under the running suite, the in-flight
bridge request loses the window that was going to answer it, and
`toolBridge`'s `SLOW_TOOLS` gives `render_export` **30 minutes** — so it
does not fail, it sits there. `npm run verify` counts `[vite] connecting…`
lines per suite and reports any suite that ran across one as DISTURBED.
Use `npm run verify -- --built` to be immune, or do not edit while it runs.

**Trap 8 — a dev server started before a `tailwind.config.js` change
serves a BROKEN app, and the log says nothing.** Tailwind's config is
read once at server start. Add a token — a colour, a font size — and an
already-running `vite` still compiles against the old config, so the
first `@apply text-<new-token>` fails PostCSS and `/src/index.css`
returns an HTML error page instead of CSS. `main.tsx` imports that
stylesheet, so the import throws and **the app never mounts**.

What that looks like from outside is the confusing part. There is no
renderer error, no stack, and no crash:

    [Kerf] RPC bridge on http://127.0.0.1:3950/rpc
    [renderer:0] [vite] connecting...
    [renderer:0] [vite] connected.
    (nothing, ever)

`npm run verify` reports `RPC never became ready: timed out after 120s`
and 0/16 suites, which reads exactly like a broken build. It cost a full
diagnostic pass — the poster-capture work added in the same session was
suspected first, deferred off the mount path, and re-run before the
actual cause was found. The one-line check:

```bash
curl -s http://localhost:5173/src/index.css | head -c 200   # HTML == broken
```

A second dev server on another port, started after the config change,
serves the app perfectly — which is what made it look like the runner
rather than the server. **Restart every dev server after touching
`tailwind.config.js`**, and if a suite run cannot boot, curl the CSS
before suspecting the code.

**It also has a silent, non-fatal half that is far easier to miss.**
Change a token's VALUE rather than adding one — blue to amber — and
nothing errors at all: the old utility still exists, so
`text-spectrum-accent` keeps emitting the old colour. The app renders,
every suite passes, and one icon is quietly the wrong colour. Caught
only by looking at a screenshot and noticing an amber theme with a blue
icon in it.

**Trap 6 — `yarn install` can leave `node_modules/electron/dist` empty.**
Its postinstall reported success and extracted only
`LICENSES.chromium.html`; `npm run verify` then failed preflight with "no
Electron binary". The zip is already in `~/Library/Caches/electron/<hash>/`
— unzip it into `dist/`, then `chmod -R +x` the `MacOS` and `Frameworks`
directories (unzip drops the executable bits) and write
`Electron.app/Contents/MacOS/Electron` into `path.txt`.

**Trap 4 — only one Kerf holds port 3888.** The packaged app and a dev
build fight over it; the loser rewrites `mcp-kerf.json` with a token the
listener rejects, and every call returns "Bad or missing token".
`tools/kerf_rpc.py` re-reads the token per call, so it survives this.

### Looking at the UI

```bash
# needs KERF_DEBUG=1 for debug/eval; debug/capture needs no flag
env -u ELECTRON_RUN_AS_NODE KERF_DEBUG=1 \
  VITE_DEV_SERVER_URL=http://localhost:5173 npx electron .
```

`debug/capture` returns `{pngBase64, visibility, stale, note}`. **Check
`stale` before believing the picture.** `capturePage()` hands back the
last frame a window painted, and macOS stops a covered window painting —
so every screenshot taken while the terminal was in front showed the home
screen for an app that had been in the editor for ten minutes, with no
error. Occlusion pausing is now disabled in `main.ts`, and the result says
which of the three it is rather than implying it is live.

The window must be frontmost for a live frame, and it stops being
frontmost the moment a shell command runs — so activate it and capture
inside ONE script, not across two:

```python
subprocess.run(['osascript','-e', f'tell application "System Events" to '
  f'tell (first process whose unix id is {pid}) to set frontmost to true'])
time.sleep(2); res = rpc('debug/capture', {})
```

Note also that Vite HMR full-reloads the page on some edits, which resets
`showHome` and drops you back to the home screen mid-script.

### Verifying

```bash
npm run verify          # all twelve suites, 324 checks, own Kerf, exits non-zero
npm test                # 166 unit tests, no app needed
```

To drive one suite by hand against an instance you already have running:

```bash
KERF_RPC_PORT=<port> python3 tools/verify_keyframes.py
```

298 checks across twelve suites. All are green in dev **and in the packaged app**, in any
order, and green again if you run the whole set a second time against the
same running app. Run them before you start and after you finish; if one
is red before you have touched anything, that is the finding.

Every check measures an artifact — rendered pixels, exported audio, a file
on disk. Asserting against the store would have passed on nearly
everything these suites were written to catch.

**They were not always idempotent, and it cost a session's opening hour.**
`verify_keyframes` inserted `media_cyber_city`, one of the app's seeded
sample assets; `verify_project_format` opens constructed files whose
`mediaPool` is `[]`, and `projectIO` **replaces** the pool rather than
merging, so it stays empty for the life of the app. Run the documented
loop twice and the second pass reported thirteen filter ERRORs on a build
where all thirteen filters worked — a red that says nothing about the
code is worse than no check. `verify_keyframes` now builds its own probe
chart, imports it, and re-imports it if the pool is emptied under it. It
also no longer needs the network, which that Unsplash-hosted sample
quietly did.

```bash
python3 tools/verify_keyframes.py --selftest
```

Holds every property STILL and requires each row to move **less** than its
threshold. A threshold nobody has tried to fail is not a threshold; this
is what says the number a row keys on is driven by the property and not by
frame timing or encode noise. 28/28, every row at Δ0.000.

---

## 1. Done — pitch in playback, without decoding anything

This section used to say pitch needed `AudioBufferSourceNode.detune`,
i.e. decoding each clip to a buffer, ~100MB for a ten-minute track, "a
change to the playback architecture, not an addition to it".

**The premise was too narrow.** `detune` is one way to move pitch; it is
not the only one. `src/engine/pitchWorklet.js` is a granular shifter in
an AudioWorklet: it reads a delay line faster or slower than it is
written and crossfades two heads half a grain apart, so the seam always
falls where a head is silent. It processes whatever samples arrive, so a
`MediaElementAudioSourceNode` works exactly as well as a buffer. No
decode, no memory budget, no eviction, and the streaming architecture is
untouched.

`pitch`, `deep` and `high` are previewed now, and measured on both
engines by `verify_playback_audio.py`:

    pitch +7   render 440 -> 659.3Hz   (want 659.3)
    pitch -7   render 440 -> 293.6Hz   (want 293.7)
    deep       render 440 -> 329.3Hz   (want 329.6)
    high       render 440 -> 587.1Hz   (want 587.3)

The preview's shifter lands within ~0.5% of the same targets. It is
listed as an APPROXIMATION rather than a match, because ffmpeg resamples
and time-stretches (`asetrate` + `atempo`) where this runs grains — the
fundamental and the duration agree, the samples do not.

**`noiseReduction` is the only thing left that the preview cannot do.**
ffmpeg's `afftdn` is a spectral subtraction with a learned noise profile
and WebAudio has no equivalent. A gate and a shelf would produce
something that is not what the render produces, which is the failure this
work ended rather than a smaller version of it. It stays declared.

**If you touch the shifter:** the sign of the read-head drift is the
whole thing. Raising pitch means reading FASTER, which SHRINKS the lag
behind the write head — `offset -= ratio - 1`. Getting it backwards
inverts the effect and is not subtle: +12 semitones came out at 85Hz
against a wanted 880. Caught before integration by running the inner
loop standalone against a 440Hz sine, which is a cheaper place to find
it than a live audio graph.

## 2. Closed — the packaged/dev encode gap does not reproduce

The record said packaged encodes at 24.6 ms/frame against dev's 15.7, and
listed canvas acceleration under `file://`, GPU rasterisation flags and
the ad-hoc signature as suspects. Measured properly, on the starter
project at 1080p, 345 frames, interleaved so ordering and drift cannot
carry the result:

    packaged (block 1, n=3)   11.0  10.9  10.8
    dev      (n=8)            11.0  11.5  11.7  11.1  11.3  11.3  11.3  11.3
    packaged (block 2, n=3)   11.6  11.3  11.2

Packaged 11.1 mean, dev 11.3 mean — **1.5% apart, inside the run-to-run
spread of either**, with packaged marginally ahead, which is what a
production build should be. There is nothing here to investigate.

**What produced the original number is worth more than the number.** My
own first dev reading of the session was **16.1 ms/frame — 43% above the
dev mean** — taken minutes after the eight-suite regression finished. One
reading, on the same build and the same project, "minutes apart" from the
others, exactly the methodology the 24.6-vs-15.7 pair came from.

I could not pin what made that one reading slow, and would rather say so
than guess: eight spinning CPU cores only moved it 11.1 → 12.0, and
running five suites first changed nothing at all (11.3). The likeliest
remaining cause is residual I/O and memory-bandwidth pressure from the
suites' ffmpeg subprocesses, but that is unverified.

**The lesson for anything measured next:** two readings minutes apart do
not establish a difference on this machine. Interleave the conditions,
take at least three of each, and quote the spread. `render_export` returns
the breakdown, so this costs one loop.

Caveat: one machine (Apple silicon). A real packaged/dev difference on
Windows or Linux would not show up here, and §6 still has nobody having
run either.

## 3. Done — `get_frame_context` now reports undecoded frames

The compositor draws a dark gradient for media that has not decoded, the
frame went back with no indication, and a dark gradient reads as a
legitimately dark shot. The frame now carries `mediaPending` (a count),
plus `mediaPendingClipIds` and a note saying not to measure it.

Counted during the draw, in `compositor.ts`, rather than re-derived after
it — a second pass asking "would this decode now?" can answer differently
from what was actually painted, and the report would then describe a frame
nobody was given.

`tools/verify_frame_context.py` (8 checks) is built to fail if it ever
stops racing: it writes a fresh clip to a new mkdtemp each run so the URL
is one the media cache has never seen, and if it never observes a pending
frame it reports that as a FAILURE rather than passing. It measured the
placeholder at luma 28.0 against 97.8 decoded, so the flag is attached to
a real difference in the picture.

**It also paid for itself in `verify_keyframes`.** `settle()` used to poll
until the picture stopped changing — a guess, in the caller, about
something only the renderer knows, and wrong in both directions: it gave
up early on a frame that held still for one poll, and waited out its full
3-second timeout on every shape-and-text scene where nothing was ever
decoding. It waits on `mediaPending` now, and the suite runs in **2
seconds instead of about 90**.

## 4. The GPU stage — the mesh path, and what is still out of reach

`src/engine/gpuStage.ts` runs a shader over a clip rendered into an
isolated layer, and composites the result back. It draws a **subdivided
grid**, not one quad, so a vertex program can move the geometry — flat
keys draw that grid at one subdivision and are the old full-screen pass
exactly. Chroma key, displacement, `page_curl`, `flag_wave` and `ripple`
go through it, with a depth buffer so a fold can cover what it folded
over. `verify_gpu.py` is 26 checks now, plus `--selftest`.

**Two of the fourteen transitions are on the GPU: `whip_pan` and
`glitch`.** The other twelve were measured and left alone, and the
measurement is the useful part — see §7, "do not redo these".

Still not possible:

- **real depth of field** — needs a depth source. Not reachable without
  either a depth map input or segmentation.
- **a paired A→B transition of any kind.** A `ClipTransition` belongs to
  ONE clip; there is no "from" and "to" texture, which is why
  `SHADER_WHIP_PAN_FS` — which takes `u_from` and `u_to` — could never
  have run. A real cross-dissolve on the GPU needs the transition model
  changed first, not a shader written.

### Open here

- **The GPU pass costs about 5 ms per clip per frame at 1080p**, because
  it uploads the whole canvas as a texture and reads it back. That is
  fine for one keyed clip and wrong for a stack. A pass that could stay
  on the GPU across several clips, or render to an FBO instead of a
  canvas, would change which effects are worth putting there at all.
- **`SHADER_RGB_GLITCH_FS` and `SHADER_FILM_GRAIN_FS` are still
  unreferenced**, and `rgb_glitch` is a `ShaderKey` no effect names.

**Add a shader by:** putting the source in `src/engine/shaders.ts`, adding
its key to `ShaderKey` in `gpuStage.ts`, and — for an effect — setting
`gpu: '<key>'` on its `EffectDefinition`. A mesh warp also needs an entry
in `MESH_VERTEX_SOURCES` and `MESH_SUBDIVISIONS`; nothing else changes,
and `runShader` picks the path from the key so a call site cannot ask for
a curl and get a flat pass.

The registry stays the single catalogue; `list_effects` needs no special
case.

**Verify with:** `tools/verify_gpu.py`, and `--selftest`. Follow its
shape — assert the picture changed the way the feature claims, and for
anything animated assert it MOVES, since a static distortion pretending
to be a field passes a single-frame check. Its ground truth is a straight
white bar and the spread of the ink's centre of mass down each column: a
line that is still straight has not been warped, whatever else changed.

**`set_gpu_stage {enabled:false}`** forces every GPU path to take the
same return a machine with no WebGL takes, which is how the fallback is
now proved on pixels rather than asserted. Five effects, each measured as
pixel-identical to the clip with no effect on it at all.

---

## 5. Done — `npm test` and `npm run verify`

```bash
npm test              # 166 unit tests, ~0.5s, no Kerf required
npm run verify        # 8 suites, 107 checks, ~19s, boots and kills its own Kerf
npm run verify -- --built   # against dist/, immune to HMR (see the trap below)
```

`tools/run_all_suites.py` picks a free port from 3950, strips
`ELECTRON_RUN_AS_NODE`, polls `describe_timeline` rather than sleeping,
and kills the process group afterwards — including on failure and SIGINT.

**Six of the eight suites exit 0 whether they are green or red.** A `&&`
chain would have reported success on a red run. A suite passes only with
exit 0 AND a summary line AND `n == m > 0` AND no FAIL/ERROR line, and the
summary is the last line MATCHING `n/m`, not the last line — because
`verify_keyframes` prints `failing: …` after its count, so `tail -1` is
wrong exactly when it is red.

Unit tests cover `keyframeMath` (against an independent bisection bezier
solver), `geometry` (against geometric identity), `beatDetect`'s
arithmetic (against synthetic percussion, never a bare click track) and
`projectIO`'s migration ladder. Every tolerance has a sibling negative
control.

CI is at `.github/workflows/verify.yml` — macOS, all eight suites, nothing
excluded, `workflow_dispatch` only. **It has never been run.** It dumps
`getGPUFeatureStatus()` so the first run answers whether a GitHub VM gives
`verify_gpu` a WebGL2 context, instead of someone guessing. Make it a gate
once you have watched it finish.

### Done here too — HANDOVER §8's six named regressions

`tools/verify_hardening.py`, 21 checks. Four of the six were already
covered incidentally, by suites written for other reasons, which is not
the same as covered on purpose: narrow `verify_keyframes` and `shadows`
stops being checked with nobody the wiser. Each of the six is now
asserted in §8's own words, against the artifact.

**A lock meant different things depending on which tool you reached
for — fixed.** `split_clip`, `delete_clip`, `move_clip` and `trim_clip`
refused a locked clip; `add_effect` and `patch_clip` wrote straight
through it. Both refuse now, in the STORE rather than in the tools, so
the rule holds for the UI too.

The reason it was recorded rather than fixed on the spot is the reason it
took care: `batch_apply` and `apply_look_preset` legitimately reach
locked clips when asked. They decide first — skipping locked clips unless
`includeLocked` was passed — and now say so with an explicit
`allowLocked` on the store call. A patch touching ONLY `locked` is also
still allowed through, or a locked clip could never be unlocked again.

## 6. Still not started, from the original plan

- ~~**Crash and error reporting** (Stage 1.3)~~ — **done.** Failures now
  land in `~/Library/Application Support/kerf/logs/kerf.log`: main's
  `uncaughtException`/`unhandledRejection` (which had no handler at all),
  `render-process-gone`, `child-process-gone`, `did-fail-load`,
  `unresponsive`, renderer `console.error`, `window.onerror`, unhandled
  rejections, and a React error boundary that records the component stack
  — the one thing no console line carries.

  The old logging was wrapped in `if (!app.isPackaged)`, which is
  backwards: in development you have devtools and a terminal, and in the
  packaged build you have neither. **The one build where a user meets a
  crash was the one build that wrote nothing down.**

  Nothing is uploaded. That is a product decision with privacy
  consequences and belongs to whoever ships it, not to a logging module.

  Verified by causing each failure rather than by reading the code: a
  throw inside a `setTimeout`, a rejected promise, a `console.error`, and
  a React component made to throw during render — all four recorded with
  stacks, and the crash screen screenshotted.
- **Windows and Linux.** CI builds them; nobody has run either.
- ~~**Performance at scale**~~ — **measured, and it found an O(n^2).**
  `tools/measure_scale.py` reports the power-law exponent rather than
  milliseconds, because §2 is the story of absolute timings on this
  machine being untrustworthy. `k~1` is linear and fine; `k~2` means
  something looks at every clip for every clip.

  The renderer was never the problem — `get_frame_context` is **flat**
  (6.3ms at 25 clips and at 400) and compositing is flat at
  0.03–0.07ms/frame, which is what HANDOVER §3b already said. **Building
  the timeline was `k=1.57`**: every tool call commits, and every commit
  `structuredClone`d the entire timeline for the undo history.

        400 clips   build 2659ms -> 277ms      k 1.57 -> 0.91
        heap        +48.0MB      -> -0.2MB

  Fixed by storing a REFERENCE rather than a clone. The store is wrapped
  in immer, so the previous state is already immutable with structural
  sharing — the clone was making a second copy of something nothing could
  mutate. The `unchanged` test in `commitTransaction` is reference
  equality now too, exact instead of `JSON.stringify` and O(1) instead of
  O(clips).

  **The invariant it rests on:** every write to `tracks`/`markers` goes
  through `set`. That is what immer is for; a direct mutation outside
  `set` would corrupt undo and was already a bug.

  Found on the way: **undo needed two presses per action.** Five tools
  made two committing store writes (`addShapeLayer` then the `patchClip`
  that styles it), so one call left two entries on the stack — ten shapes
  took twenty undos, one disappearing every second press.
  `create_grid_layout` was paying it three times per cell. They run
  inside a transaction now, and `verify_hardening.py` §7 walks undo back
  through rendered luma so a store that undid without redrawing would
  fail.
- **The altitude tools** (Stage 3.9) — **five of six are done.**
  `apply_look_preset`, `batch_apply`, `create_picture_in_picture`,
  `auto_montage_to_beats` and `assemble_from_folder` shipped in `adb77e0`,
  with `verify_montage.py` (38) and `verify_altitude.py` (74, plus 25
  under `--selftest`). `analyze_reference_video` — the flagship and the
  natural first skill — is the one still open.

  Three limits those tools found and REPORT rather than hide, worth
  knowing before building on them:
  - `patch_clip`/`patch_clips` write straight through a lock, while
    `splitClip`, `trimClip`, `moveClip` and `updateClipTransform` all
    honour it. Not reconciled; the new tools skip locked clips by default
    and offer `includeLocked`.
  - Four filters render nothing on a `text` clip (`temperature`, `tint`,
    `vignette`, `grain` sit under `if (clip.type !== 'text')`), and the
    tone filters have nothing to act on over an `adjustment` layer, which
    fills `rgba(0,0,0,0)`. Reported per clip as `inertProperties`.
  - `cornerRadiusPx` and `shadow` cannot both render: the rounded mask is
    a hard `ctx.clip()` set before the draw, and `drop_shadow` sets
    `ctx.shadowBlur` on the same context.

---

## 6b. The skill format — first skill built, format falling out

HANDOVER §0 item 11 says build two skills by hand FIRST and let the
format fall out of what they needed. **One is built:
`skills/beat-montage/`**, 12 checks green against artifacts — cuts 0ms
off the detected beat, the six shots measured on screen in the reported
order, a portrait export with an audio stream at the length asked for.

`skill.json` was written LAST, and every field in it earned its place.
What it needed that did not exist:

- **`save_project`.** There was a `project:read` and no counterpart, so
  an agent could open a project and never save one. A skill IS a template
  project; there was no way to make the template.
- **`remove_media`.** The first template shipped **eight** assets: its
  own bed plus the seven seeded samples. A template that ships the app's
  sample library ships someone else's licensing problem — and §6's whole
  argument for skills is that assets are licensed PER SKILL.
- **Portable media paths.** The template stored its bed as an absolute
  `file://` URL, so it worked on exactly one machine. `serializeProject`
  now writes media inside the project's own directory as `./assets/…`
  and `deserializeProject` resolves it back. Proven by copying the whole
  skill folder elsewhere and opening it there, where the bed still
  DECODED at 119.6 BPM — resolving a string is not the same as reading a
  file.

**Still open, and deliberately not designed yet:** nothing installs a
skill. There is no registry, no lifecycle, no entitlement. Writing that
format before something reads it is how you get a schema nobody can
satisfy — and §0 says two skills, not one. The second is what should
decide whether recipes need branching, whether slots need validation, and
what an install actually does.

---

## 6c. Done — the agent-tooling gap is closed, and measured

**Every capability the store has is now reachable by a tool, or excused
in writing with its reason.** `tools/verify_tool_coverage.py` is the
proof and it runs in `npm run verify`: 105 store actions, 0 unreachable
and unexplained.

The audit is no longer a snippet in this file. It was reproduced first
(105 actions, **66** unreachable — this file said 65, it was off by one),
and then turned into a suite, because a python snippet in a markdown
document reports the same number next month whatever anybody does. It
fails on any store action that is neither reachable nor excused, and it
fails on an excuse that has since grown a tool, so the list cannot rot in
either direction. Both guards were checked by making them fail on
purpose.

| | session start | now |
|---|---|---|
| tools | 68 | **104** |
| unreachable store actions | 66 | **0** |
| suites · checks | 12 · 324 | **15 · 513** |

Three lanes, three anchors, and again **one conflict** — two adjacent
lines of `TimelineActions` where lane 2 changed `removeEffectKeyframe`
and lane 3 changed `clearEffects`. `toolRegistry.ts`, the file all three
append to, auto-merged clean. Keep doing this.

### The table in the old version of this section was slightly wrong

It listed 34 in 8 groups and called it "about 35". The honest count is
**35**: it missed `removeTransition` — `apply_transition` existed and
nothing removed one, the same one-way door the keyframes had. And it
never mentioned `groupSelected`/`ungroupSelected`, which turn out not to
be capabilities at all: `clip.groupId` is read in exactly ONE place, the
timeline drag handler, so grouping makes clips move together under a
human's mouse and does nothing otherwise. `moveClip` moves a clip
straight out of its group; `trimClip` ignores it, though edl.ts:430 says
"move and trim together". They are excused as UI-only, and the type's
comment is the thing to fix.

### What building the tools found — all measured, none read

1. **Soloing an audio track turned the whole picture black.** `anySolo`
   was `tracks.some((t) => t.solo)` with no type test in `compositor.ts`
   and `videoEngine.ts`, while the audio side always filtered by type —
   so an audio track's solo flag meant no VIDEO track was soloed and
   every one of them was skipped. Mean luma 7.06 -> 0.00. It survived
   because there was no `toggle_track_solo` to exercise it. Fixed, and
   the lane reverted its own fix to confirm the check went red first.

2. **"A lock now means one thing" (15b615b) was not yet true.** It closed
   the property surface and its comment called `add_effect` "the last
   edit path that wrote through a lock". The whole ANIMATION surface
   still did: a locked clip refused `patch_clip` and then accepted
   `add_keyframes`, `upsert_keyframe` and `add_motion_path_point`, and
   the keyframes really landed. That is the worse half of the family — a
   no-op leaves the project alone, this wrote through a lock the user
   set. Thirteen store actions now refuse.

3. **Then the refusal MESSAGES were wrong, which was its own bug.** With
   the store declining, the tools reported whatever they checked next:
   `clear_keyframes` said "has no keyframes to clear" on a clip holding
   two, `animate_effect_param` said "No effect gaussian_blur on that
   clip" when it had one, and `update_motion_path_point` said "index 0
   is out of range: the path has 2 point(s) (0-1)" — contradicting
   itself in one sentence. An agent told there is no blur adds a second
   one. **A wrong reason is not a smaller version of no reason.**

4. **`closeGapsOnTrack` repacked a locked track**, which is the one thing
   a locked track exists to prevent, and it moves every clip at once.

5. **`splitClip` destroyed the animation it cut through** — 332px jump at
   the join. Fixed: it samples the curve at the cut and gives the
   boundary key to both halves. 0.000px now.

6. **`add_keyframes` was a one-way door.** Nothing listed keyframe ids,
   so `remove_keyframe` would have been unusable even once written.
   `list_keyframes` added, and `add_keyframes` hands its ids back.

7. **`verify_keyframes` said "every property" and covered 28 of 35** —
   the six it skipped were positionX, positionY, opacity, scaleX, scaleY
   and rotation, the six an editor uses most. 34 covered now.

### Closed since, all measured

The six items this section listed as open are now five closed and one
deliberately deferred. Kept rather than deleted, because what was wrong
and how it was found is the part worth keeping.

- ~~**Reversed audio does not exist.**~~ `collectAudioClips` never read
  `reversed` and the filtergraph had no `areverse`, so reversed
  dialogue exported as forward dialogue. Fixed: a 300Hz-to-3000Hz sweep
  now falls 2732 → 560 Hz reversed where it rises 572 → 2738 Hz
  forward, and a second row demands the two MIRROR rather than merely
  differ. PLAYBACK still cannot reverse sound — a media element cannot
  run at a negative rate — so `describe_audio_preview` reports it as a
  preview/render divergence rather than letting the preview lie.
- ~~**In/out points are decorative for rendering.**~~ `ExportConfig` had
  no in/out field, and `ExportModal`'s "range only" toggle computed a
  duration that fed a LABEL and never reached the encoder. Fixed:
  `startMs` on the config, `useInOut` on `render_export`, and audio
  re-based onto the window (source time advances at playback speed, so
  a head cut of n ms skips n × speed of source). Proved on content, not
  frame count — a 1000–2000ms range exports 30 frames whose first frame
  is the GREEN second, and whose mix has 1500Hz at 60.5 dB with its
  neighbours 111 dB and 98 dB down.
- ~~**Solo does not silence a video clip's embedded audio.**~~ Decided
  and fixed. Solo means "only this" now: 68.75 → −45.27 dB on the video
  clip's own tone, soloed track unchanged, picture unmoved.
- ~~**`volume` is the one animatable property with no proof anywhere.**~~
  It was not unproven, it was BROKEN — the eighteenth property to say it
  was animatable and not be. Nothing read keyframes in either audio
  path. Fixed by sampling the eased curve in the renderer and building a
  piecewise-linear ffmpeg expression from it: 1.0 → 0.0 now falls 98% in
  the exported mix, 0.0 → 1.0 rises, and a row demands the two ramps
  mirror.
- ~~**`toggleEffect`, `updateMarker` and `moveClips` push no history.**~~
  A sweep found ten actions that mutate and never commit; six are
  correct (history machinery, plus slider-driven ones whose tools wrap),
  and the other four are fixed. Fixing it immediately created the
  opposite bug — `move_clip` committed in the tool AND the store, so one
  undo took the user half way back. The rows demand the state come BACK,
  which is what caught it.
- ~~**`EffectKeyframe` has no `bezierPoints`.**~~ Bigger than the note:
  `addEffectKeyframe` hardcoded `easeInOut` and `animate_effect_param`
  had no easing field, so every effect animation in the app ran on one
  curve. Both fixed, measured at the MIDPOINT — the only place a curve
  is visible.

**An intermittent nobody has explained yet, and it now has TWO data
points, in two different suites:**

- **`verify_clip_ops`**, in a full run:
  `reverse: No clip matching "clip_mtbnrrt41h81qr"` — a clip id created
  earlier in the same suite, gone by the time a later row used it. It
  did NOT reproduce: the suite alone is 69/69 against a live instance,
  and the very next full run was 16/16 · 534/534.

  Same SHAPE as the `verify_keyframes` failure below: an id minted
  during the suite is absent later, which means something reset the
  project underneath it. Different suite, different id type (clip, not
  track), and neither has ever repeated. That is now two, which is what
  the note below asked for.

  I cannot rule out that the session's UI work made it likelier, and say
  so rather than claiming otherwise. What argues against it: the first
  occurrence predates all of it, nothing added this session writes to
  the timeline stores (the preview renderer and the poster capture both
  take tracks as ARGUMENTS and render to their own canvas precisely so
  they cannot), and the re-run was clean with the same build.

  Next time this happens, log `describe_timeline` immediately before the
  failing call. Both reports so far say only that the id is gone; what
  is needed is whether the whole project is empty or only that one id.


- `verify_keyframes` failed ONCE in a full run with
  `filters.highlights: ins: No track matching "track_mtbgd4qb1c3ms"` —
  a track id that had gone stale mid-suite, which means something reset
  the project between the row creating the track and the row inserting
  into it. It did NOT reproduce: the suite alone is 95/95, and two full
  runs either side are 15/15 · 516/516. Checked for a stray agent
  editing the project concurrently — the only `claude` processes on the
  machine were VS Code extension sessions, not the `/opt/homebrew/bin`
  binary Kerf spawns. The failing run also took 149s against a usual
  107–115s, so contention is the best guess and not a finding. Recorded
  with its exact error rather than called a flake, because next time it
  happens this is the note that makes it two data points instead of one.

**Still open, deliberately:**

- **`detach_audio` cannot tell whether the source has an audio stream**,
  so on a silent video it succeeds and produces a silent audio clip.
  Named in the tool description, and NOT fixed. There is no ffprobe
  anywhere in the app (`grep` finds it only in a comment); detecting
  this needs a probe bridge in the main process and a `hasAudio` field
  on `MediaAsset`, filled at import. That is a feature, not the one-line
  guard it looks like, and a `hasAudio` that is sometimes wrong would be
  worse than an honest "cannot tell".
- **Preview cannot reverse audio**, per above. Needs the source decoded
  into an AudioBuffer — a different playback architecture from the
  media-element graph the mixer is built on.

### Platforms

`gate.yml` — typecheck + 167 unit tests on macOS, Linux **and Windows**.
No display needed, so it is a hard gate everywhere and it is the job
that gates PRs.

`verify.yml` — the live-app suites, `workflow_dispatch`. **macOS
proven** (has run, answered its own two unknowns). **Linux wired and
never run** — written from documented xvfb/Electron behaviour; there is
no container runtime on this machine, and a Lima VM is the local route
to closing it. **Windows blind** — nobody has ever run Kerf on it; the
suite step is `continue-on-error` and the job says in writing that a
green tick means only "the attempt ran and the logs were kept".

Windows could not be attempted honestly until three POSIX-only things in
`run_all_suites.py` were fixed, none of which would have failed loudly:
`os.killpg`/`SIGKILL` do not exist there, `'file://' + path` produced
`file://C:\...` which Chromium will not load, and `SO_REUSEADDR` means
the opposite thing on Windows so the free-port probe called every busy
port free.

---

## 6d. The lane runbook

```bash
# one per lane; N = 1,2,3
git worktree add -b lane/tools-N ../auracut-laneN HEAD
ln -s "$PWD/node_modules" ../auracut-laneN/node_modules   # electron is 100MB+
(cd ../auracut-laneN && npm run build:electron)
(cd ../auracut-laneN && nohup npx vite --port 520N --strictPort &)

# the lane's own Kerf, and its own verify
env -u ELECTRON_RUN_AS_NODE KERF_RPC_PORT=392N \
  VITE_DEV_SERVER_URL=http://localhost:520N npx electron .
npm run verify -- --vite http://localhost:520N --port 393N
```

**Killing a lane: by PORT or by launcher parent, never by the electron
path** — trap 7. The symlinked `node_modules` makes every lane report the
MAIN repo's binary, so `pkill -f auracut/node_modules/electron` kills all
of them at once. It happened twice in one session.

**And tearing the worktree down does NOT kill what it launched.**
`git worktree remove --force` deletes the directory and reports success
while a lane's Kerf keeps running from it — found afterwards holding
port 3931, its binary path still naming a directory that no longer
exists. Nothing warns you, and the process is now unfindable by any
path that still resolves. Kill the lane's instance BEFORE removing its
worktree, or you are left with an orphan you can only find by port:

```bash
lsof -a -p <pid> -nP -iTCP -sTCP:LISTEN     # -a, or -p and -i are OR'd
                                            # and you get every file on
                                            # the machine
ps -eo pid,ppid,command | grep 'MacOS/Electron \.'   # ppid 1 == orphan
```

Seven were cleared at the end of this session: five from two nights
before, one from the morning, and one of this session's own lanes. Six
held an RPC port each; the seventh held none at all, which is the
EADDRINUSE half-dead case trap 7 describes — an app that logs "port N is
already in use, so there is no RPC bridge in this instance" and then
sits there looking fine.

---

## 7. Do not redo these

Each was tried, measured, and rejected. The numbers are in the code
comments so the reasoning survives.

- **Parallel JPEG encoding with a ring of canvases.** Ring sizes 1, 4 and
  8 rendered in 6277ms, 6210ms, 6318ms. `toBlob` serialises inside
  Chromium however many are in flight. Real parallel encoding needs
  OffscreenCanvas in workers or WebCodecs, not more canvases on the main
  thread. (`src/engine/exportPipeline.ts`)
- **Lowering JPEG quality to speed up export.** 0.95 → 0.80 moved the
  encode from 13,435ms to 13,235ms. The cost is the readback, not the
  compression.
- **Transitions on the GPU, beyond the two that are there.** All 14
  already worked, and `NEXT.md` called the job "quality and speed". The
  speed half goes the other way. Six stacked full-frame 1080p clips, 45
  frames, interleaved, three exports of each condition — composite time
  per frame, GPU stage on vs off:

        none            0.30 / 0.36      crossfade       0.32 / 0.29
        blur_dissolve   0.24 / 0.33      whip_pan        3.14 / 0.31
        glitch          1.78 / 0.33      zoom_in         2.99 / 0.25

  A GPU pass uploads the whole canvas and reads it back: ~5 ms per clip
  per frame at 1080p, against 0.05 ms for the affine transform and alpha
  that ten of the fourteen actually are. `whip_pan` and `glitch` are on
  the GPU for quality the 2D canvas cannot reach — a directional streak
  instead of a gaussian (2.45x more detail survives perpendicular to the
  pan, against the gaussian's 0.84x), and a real channel split instead of
  `sepia(1) hue-rotate(...) saturate(6)`, which also fixed a glitch
  transition that rendered NO glitch on text and shape clips because the
  2D split sits inside the `clip.mediaUrl` branch.

  **`zoom_in`/`zoom_out` were built on the GPU and taken off again.** A
  radial streak looked good, but the 2D zoom had no blur at all, so there
  was nothing worse being replaced and no control to falsify the claim
  against — at +6.4 ms per clip per frame. The shader comment says how to
  put it back if someone can write the test.

- **A GPU gaussian for `blur_dissolve`.** Not attempted, and the reason
  is above: the 2D `blur(24px)` costs 0.055 ms per clip per frame,
  Skia already runs it on the GPU, and a separable two-pass shader would
  need an FBO ping-pong to cost more.

- **Embedding Remotion as the compositor.** It renders DOM; getting DOM
  pixels into the export needs `webContents.capturePage()` on a hidden
  window — a separate frame-production path, slower per frame, and it
  breaks the transform gizmo, which needs `getClipBox` to know where
  things are. Take Remotion's *output* as material via `ffmpeg_process`
  if it is ever wanted; do not adopt its authoring model.

---

## 8. Housekeeping

**The `yarn.lock` question is settled and the fear was misplaced.** Two
sessions kept a 2,059-line change out of every commit, and this file said
committing it would break the Windows and Linux builds. That was true of
what was in the tree — an abandoned `npm i -D vitest jsdom` — and NOT
true of the operation itself.

The dropped platform binaries were an **npm** artifact. Tested in a
throwaway copy first, then done for real: `yarn install` at 1.22.22
regenerates the lock with **0 package names lost, 0 existing versions
removed, and all 51 `@esbuild`/`@rollup` platform entries intact**, linux
and win32 included. It only ADDS — 57 packages gained a second version
alongside the one already there, which is vitest's own esbuild and rollup
resolving newer. Committed in `21a848a` after reinstalling from it and
re-running all 107 checks plus the 166 unit tests.

**If you regenerate it again, use yarn, not npm**, and check the diff by
package name rather than by line count before believing it.

### New findings with no home yet

- **Window visibility costs about 20%, and `backgroundThrottling: false`
  removes it.** The GPU lane reported this as **26x** — 1020 ms/frame
  hidden against 11.9 raised — and that does not reproduce. Tested
  directly, interleaved, on the full 345-frame 1080p starter export:

        backgroundThrottling: true    raised 16.4, 15.5   minimised 19.1, 18.8
        backgroundThrottling: false   raised 16.9, 15.4   minimised 18.5, 15.1

  With throttling on, both minimised runs are slower than both raised
  ones — a consistent ~20%. With it off there is no ordered gap; the
  differences sit inside the spread. `canvasToJpeg` waits on a `toBlob`
  callback, so it is the one number a throttled task queue can stretch,
  and `compositeMs` is a synchronous `performance.now()` pair and is
  unaffected either way.

  n=2 per cell, so treat 20% as an order of magnitude, not a figure. What
  is solid: **it is not 26x, and it is not the explanation for a stalled
  suite.** That was contention — see trap 6b. Three separate diagnoses
  this session blamed visibility after one intervention with no control,
  and all three were wrong in the same way.
- **A GPU pass is timed in the wrong place.** `drawElements` returns
  before the GPU has done anything; the stall lands where the result is
  first read back, which on the export path is inside the JPEG encode.
  So `compositeMs` alone UNDER-reports a shader by roughly ten to one —
  the whip pan measured +0.47 ms per clip per frame in `compositeMs` and
  +5.4 ms in composite-plus-encode. Quote both or quote the second.
- **`debug/eval` cannot reach the app's modules.** `import('/src/...')`
  from an evaluated expression gets a SECOND instance of the module —
  Vite hands the app its imports with an HMR `?t=` suffix once anything
  in the session has been edited, so the store you read is a freshly
  constructed one holding the starter project while the real timeline
  has your scene in it. It looks like the app ignoring your calls. Drive
  the app through its tools, not through its modules.
- **`computeNovelty`'s missing floor — fixed for the clear case, and the
  rest is measured and open.** It divided by its own maximum, so a steady
  tone had its 1.5% RMS ripple stretched to full scale: 36 onsets from 5
  seconds of a 440Hz sine, reported by `beatsAnchored` as beats on real
  onsets. `NOVELTY_FLOOR_RATIO` now requires the largest rise to be 8% of
  mean frame energy, and `detectBeats` returns `percussive` — with
  `detect_beats` warning that every beat is the tempo prior talking.

  **What it does NOT catch, with the numbers:** a beating two-tone drone
  measures 0.166 and still yields 36 onsets. Soft percussion under a loud
  sustained bed measures 0.072–0.271. **Those ranges overlap, so no value
  of this constant separates them** — raising the floor to reject the
  drone silences ordinary dense music, which is the worse failure.
  Separating them needs a different metric, and the obvious candidate is
  onset spacing saturating at the minimum gap: 36 onsets in 5s is one per
  139ms against a 90ms floor. Not attempted.
- ~~`computeViewport`'s false rounding claim~~ and ~~`EASING_BEZIERS`~~ —
  **both fixed.** The comment said "Rounded so the canvas lands on whole
  pixels" and there is no rounding; it now says so, and says that if
  snapping is ever added it must go THERE, because the gizmo and the
  compositor both come through that function and agreeing with each other
  is the property that matters. `EASING_BEZIERS` held three rows that
  were the CSS curves of the same NAME rather than the curves
  `applyEasing` computes (`easeIn` was 0.315 at t=0.5 against `t*t`'s
  0.25); those rows are gone, and the two that remain are checked against
  `applyEasing` at five points.
- ~~Two unreferenced shaders~~ — **deleted, not documented.**
  `SHADER_RGB_GLITCH_FS` had a ShaderKey, a uniform builder in the
  compositor and a member in the effect-type union: a fully wired path
  that no effect named, so it never appeared in `list_effects` and
  nothing could ask for it. `SHADER_FILM_GRAIN_FS` was reachable from
  nothing, and wiring it to the real `film_grain` effect would have made
  that effect slower — a GPU pass costs ~5ms per clip per frame at 1080p
  against 0.05ms for the 2D grain. `SHADER_WHIP_PAN_FS` is KEPT with its
  reason: it needs two textures and a `ClipTransition` has one clip, so
  it is a correct shader waiting for a path that does not exist yet.

## 9. The home screen is CapCut's now — done, with one thing open

`src/components/home/` was rebuilt to CapCut's layout: sidebar with an
identity card and a labelled nav group, a top band that is also the
titlebar, a hero tile with a secondary card under it and a tall rail
down the right, a row of eight tool tiles, and the projects wall.
HANDOVER §7 has the slot-by-slot map of what replaced CapCut's
account/Pro/Spaces/sync features, and why the reversal was deliberate.

**`tools/verify_home.py`, 18 checks, is in `npm run verify`.** It is the
first suite that navigates the app rather than only calling tools, so
two things about it are worth knowing before you touch it:

- It needs `KERF_DEBUG=1` for `debug/eval`. `run_all_suites.py` now sets
  that on the throwaway instance it launches.
- It is registered LAST and restores the launch state on the way out —
  starter loaded, back on home — so the pixel suites do not inherit an
  empty timeline from it.

**Its `--selftest` is the reason to believe it.** It re-runs every
assertion with all clicks SUPPRESSED and requires the 14 interaction
checks to go RED. Three checks are deliberately not controls and say so
in the file: they are the controls for their neighbours.

**A test bug caught by that discipline, named here because it is the
easy one to repeat.** The first draft found tiles with
`button.textContent.trim() === 'Captions'` and reported the Captions
tile as broken. It was not: the AI badge is a `<span>` INSIDE the
button, so the tile's text is `"AICaptions"` and the selector matched
nothing and clicked nothing. Match tool tiles by `title`.

### Open here

- **Nothing on this screen has an accessible name.** That is not a home
  screen problem — `grep -rn 'aria-' src/components` returns **one** hit
  across ~12k lines, and it is a decorative `aria-hidden` on the logo.
  195 `<button>` elements, 202 `title=` tooltips, zero `aria-label`,
  zero `role`. Icon-only buttons are the worst of it: a screen reader
  gets nothing at all. `title` is a tooltip, not a name, and it is not
  announced reliably by any of them. This was found while counting
  buttons for the home rebuild and is the single largest untouched
  quality gap in the UI.
- **Nothing in `src/components` is virtualised, and only the Copilot
  thread is memoised.** The projects wall is capped at 12 by the
  recents store so it is not the place this will bite; the timeline is.
- **The file-open dialog is untested.** `verify_home` drives the hidden
  `<input type="file">` with a constructed `File` and proves a BROKEN
  project is reported rather than swallowed; the native picker itself
  cannot be driven from `debug/eval`, and the happy path is covered
  only through `openRecent`'s shared `deserializeProject` call.

---

## 10. The store — built, verified, and what is left

`server/` (Cloudflare Worker + D1 + R2) plus the client in
`src/services/` and `src/store/accountStore.ts`. HANDOVER §13 is the
reasoning; `server/README.md` is the deploy runbook.

```bash
cd server && npm install
npm run db:local && npm run seed:local
npx wrangler dev --port 8788 --local
node verify_store.mjs                    # 33 checks

KERF_STORE_URL=http://127.0.0.1:8788 npx electron .    # point Kerf at it
```

**Done and measured:** device-flow sign-in proxied through the Worker,
sessions at 0600 in main, a public catalogue, free claims, Lipia
mobile-money orders with an STK push and polling, the signed webhook,
ECDSA licences verified in the renderer, and the storefront UI.

### Closed since it was written

1. ~~**`status='published'` is not gated on `verified_at`.**~~ It is a
   **CHECK constraint** now, not a comment and not a code path — no
   admin screen, migration or future route can route around it. §6's
   "if it does not run, it does not publish" is enforced by SQLite.
   `verify_store.mjs` proves it by trying, and has a control that a
   VERIFIED skill still publishes, so the check cannot pass for the
   wrong reason.
2. ~~**No reconcile cron.**~~ `*/2 * * * *`, `reconcileOpenOrders`,
   settling through the same `markPaidAndGrant` the webhook uses. It
   covers the buyer who approved a payment and closed the laptop; the
   on-demand path already covered the one still watching. Gives up
   after six hours, and a Lipia outage explicitly does NOT mark orders
   failed — "expired" is read by a buyer as "you were not charged".
3. ~~**No rate limiting.**~~ Ten device starts per IP and five orders
   per user per ten minutes, counted in D1. The device limit is checked
   BEFORE the provider is called, which is the entire point — a limit
   applied after the round trip protects nothing.
4. ~~**The dev licence key is compiled into the client.**~~ A production
   key was generated, its public half is in `licenceKey.ts`, and the
   private half is at `server/.secrets/licence-signing.jwk` (0600,
   gitignored) which `npm run setup` pipes into the Worker secret.

   **And the first fix for this was a hole.** Listing both keys as
   trusted would have shipped a build that accepts licences signed by
   the DEV key — whose private half is generated by a script in this
   repo and printed to a terminal. Anybody could have minted themselves
   any skill. `trustedKeys(isDev)` now returns production only in a
   production build, it takes a boolean rather than reading
   `import.meta.env.DEV` so the production answer is testable, and
   `licenceKey.test.ts` asserts it. Both guards were made to fail on
   purpose before being believed.

### Still open here

1. **Nothing publishes a package.** `skill_versions` rows and R2 objects
   are still written by hand. There is no author-facing publish flow.
2. **Nothing installs a downloaded skill.** The entitlement is real and
   the download route works; unpacking into `userData/skills/` is not
   written. Note there is no unzip in Node and no zip dependency in this
   repo — decide the container before writing the installer, and prefer
   something `zlib` can already inflate over adding a dependency to the
   path that runs purchased code.
3. **Refund initiation.** The webhook handles `payment.refunded` and
   revokes; nothing calls Lipia's `POST /api/v1/refund`.
4. **The seller side** — payouts, the 80/20 first-year split, analytics.

### Four things only a human with a browser can do

`npm run setup` does every Cloudflare step; these four it cannot.

- `npx wrangler login` — OAuth in a browser.
- The **Google** OAuth client (Cloud Console → Credentials → OAuth
  client ID → *TVs and Limited Input devices*).
- The **GitHub** OAuth app with **Device flow** enabled. There is no API
  for creating OAuth Apps — only GitHub Apps — so this one cannot be
  scripted at all.
- The **Lipia tenant** for Kerf, with its callback set to
  `<worker>/webhooks/lipia`. Lipia's tenant creation is Next.js server
  actions behind a dashboard login; the alternative is writing to a live
  payments database that serves DukaBot and M-Digital, which is not a
  thing to do unasked.

### One thing worth copying

`verify_store.mjs` refuses the unsigned callback BEFORE it accepts the
signed one, and asserts nothing was granted in between. Every "it works"
check in that file has a sibling that proves the mechanism was actually
doing the work — the entitlement is claimed only after asserting it was
absent, and the licence check is paired with a tampered licence that must
fail. That is the same shape as `--selftest` elsewhere in this repo, and
it is the reason the 33 mean anything.

---

## How the maintainer wants this worked

From HANDOVER, and it held up over two sessions of doing it:

- **Trace to the artifact, not the function.** Render the frame and look;
  read the file. Every trust-audit finding in this repo was code that
  reported success and did nothing.
- **Test against ground truth you constructed.** Beat detection passed for
  months on a click track — the one input that could not expose either of
  its two bugs.
- **Unknown is not the same as absent.** Any status with a loading state
  needs three values.
- **Name your own mistakes plainly.** Several "bugs" found in the last
  session were bugs in the test, and saying so is what made the real ones
  credible.
