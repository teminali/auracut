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
npm run verify          # all twelve suites, 322 checks, own Kerf, exits non-zero
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

**A lock means different things depending on which tool you reach for.**
`split_clip`, `delete_clip`, `move_clip` and `trim_clip` refuse a locked
clip. `add_effect` and `patch_clip` write straight through it. This is
NOT the §8 no-op bug — those tools bailed silently and returned void,
and these two really do apply the edit — it is a consistency defect,
found while writing that suite and pinned there as RECORDED rather than
asserted, so `npm run verify` stays honest about it.

Fixing it is not free: `batch_apply`'s `includeLocked` option calls
`patch_clip` expecting it to write through, so making the lock uniform
means giving that option another way in. Worth doing, not worth doing
blind.

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
- **`computeViewport`'s comment says "Rounded so the canvas lands on
  whole pixels". There is no rounding.** Nothing is broken — the gizmo
  and the compositor both come through it, so they agree — but the
  comment is false.
- **`EASING_BEZIERS` does not describe the curves `applyEasing` uses.**
  `EASING_BEZIERS.easeIn` is the CSS bezier; `applyEasing('easeIn')` is
  `t*t`. Nothing outside the module reads the table, so nothing renders
  wrong, but its "exposed so the UI can preview the exact curve" comment
  is stale and the first person to use it will draw the wrong curve.

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
