# NEXT — the work queue

`HANDOVER.md` is the architecture and the trust record. **This file is the
queue.** Read §3a and §3b of HANDOVER before starting anything here; they
are what the last two sessions found, and several items below only make
sense against them.

Everything in this file is open. Everything not in this file that used to
be open is done and verified — check the roadmap in HANDOVER §0, which has
been reconciled rather than left listing finished work.

---

## Getting a working loop (do this first, it has four traps)

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

**Trap 4 — only one Kerf holds port 3888.** The packaged app and a dev
build fight over it; the loser rewrites `mcp-kerf.json` with a token the
listener rejects, and every call returns "Bad or missing token".
`tools/kerf_rpc.py` re-reads the token per call, so it survives this.

### Verifying

```bash
for f in verify_keyframes verify_gpu verify_audio \
         verify_project_format verify_tools verify_ffmpeg_bridge; do
  echo -n "$f: "; python3 tools/$f.py | tail -1
done
```

73 checks. All six were green in dev **and in the packaged app** as of the
last session. Run them before you start and after you finish; if one is
red before you have touched anything, that is the finding.

Every check measures an artifact — rendered pixels, exported audio, a file
on disk. Asserting against the store would have passed on nearly
everything these suites were written to catch.

---

## 1. Per-clip audio in PLAYBACK  *(the preview lies)*

**The state.** `pitch`, `voiceEffect`, `noiseReduction` and `ducking` are
applied on EXPORT and verified on the waveform (`tools/verify_audio.py`,
11/11). **Playback ignores all four.** So the preview does not match the
render, which is a worse failure than the original gap: before, nothing
applied them and the export said so; now the export applies them and the
preview quietly disagrees.

**Entry point.** `src/engine/audioEngine.ts` (262 lines). It routes an
`<audio>` element per clip through a `GainNode` into a master gain.

**What is achievable in WebAudio, and what is not:**

| setting | how | difficulty |
|---|---|---|
| `telephone` | two `BiquadFilterNode`s, 400Hz HP + 3200Hz LP | easy |
| `echo`, `stadium` | `DelayNode` + feedback gain | easy |
| `robot` | ring modulation — oscillator × `GainNode`, or a `WaveShaperNode` | moderate |
| `ducking` | WebAudio has NO sidechain. An `AnalyserNode` on the key bus driving the ducked bus's gain per animation frame is the standard workaround | moderate |
| `pitch`, `deep`, `high` | **not possible with `<audio>` elements.** `playbackRate` moves pitch AND speed together. Needs `AudioBufferSourceNode.detune`, which means decoding to buffers — a change to the playback architecture, not an addition | hard |
| `noiseReduction` | no `afftdn` equivalent. A noise gate plus a high-shelf approximates it and will not match the render | hard |

**The honest option, and probably the right first move:** make the
preview *say* what it is not previewing rather than silently differing.
This codebase's rule is that a control which lies is worse than a missing
feature. A "preview does not include: pitch, noise reduction" line costs
an hour; matching the render costs a rewrite of the playback graph.

**Verify with:** extend `tools/verify_audio.py`. It currently renders and
measures; a playback check needs the WebAudio graph tapped, which is why
this has no test yet.

---

## 2. Packaged encodes ~1.6x slower than dev  *(uninvestigated)*

345 frames at 1080p:

    dev       15.7 ms/frame   (encode 4,913ms)
    packaged  24.6 ms/frame   (encode 7,855ms)

Same machine, same project, minutes apart. The **55 fps figure quoted for
the export improvement is a dev number**; packaged is ~36 fps.

`render_export` returns a `timing` breakdown now, so this is measurable
without adding anything. Suspects, in order: the packaged renderer runs
from `file://` and may get different canvas acceleration; GPU rasterisation
flags differ between a dev-server page and a packaged one; the ad-hoc
signature or sandbox may affect it.

**Do not assume it is ffmpeg** — the breakdown already says the cost is
`encodeMs`, which is `canvas.toBlob` in the renderer.

---

## 3. `get_frame_context` returns undecoded frames silently

The compositor draws a placeholder while media is still decoding.
`get_frame_context` hands that back with no indication, and it reads as a
legitimately dark frame. Measuring straight after an insert measures
nothing — this produced ten false failures while writing
`tools/verify_keyframes.py`, and the harness now polls until the frame
stops changing.

**Fix:** the frame payload should carry something like
`mediaPending: number` (how many visible layers have not decoded), so an
agent can wait rather than measure a placeholder.

**Entry point:** `get_frame_context` in `src/mcp/toolRegistry.ts`;
`resolveClipSource` / `videoFailed` in `src/engine/compositor.ts` and
`videoEngine.ts` already know the decode state.

---

## 4. The GPU stage — what is still out of reach

`src/engine/gpuStage.ts` runs a fragment shader over a clip rendered into
an isolated layer, and composites the result back. Chroma key and
displacement go through it. Still not possible:

- **mesh warps and page curl** — need geometry, not just a fragment
  program. The current stage draws one full-screen quad; this needs a
  subdivided mesh with per-vertex displacement.
- **transitions on the GPU** — all 14 are 2D canvas today. They work, so
  this is quality and speed, not capability.
- **real depth of field** — needs a depth source. Not reachable without
  either a depth map input or segmentation.

**Add a shader by:** putting the source in `src/engine/shaders.ts`, adding
its key to `ShaderKey` in `gpuStage.ts`, and — for an effect — setting
`gpu: '<key>'` on its `EffectDefinition`. The registry stays the single
catalogue; `list_effects` needs no special case.

**Verify with:** `tools/verify_gpu.py`. Follow its shape — assert the
picture changed the way the feature claims, and for anything animated
assert it MOVES, since a static distortion pretending to be a field
passes a single-frame check.

---

## 5. The test suite needs a runner that does not need the app up

Six suites, 73 checks, all driving a live Kerf over RPC. That is the right
way to test this system — the bugs it catches live in the render path, not
in pure functions — but it means there is no `npm test`, nothing runs in
CI, and a contributor without the app running gets nothing.

**Options, roughly in order of value:**
1. A script that boots Electron headless, runs all six, and exits non-zero
   on failure. Closest to what exists and would work in CI.
2. Vitest for the genuinely pure parts — `keyframeMath`, `geometry`,
   `beatDetect`'s tempo estimator, `projectIO`'s migration ladder. Cheap,
   fast, and would have caught the tempo bug. **Not installed** — adding
   it touches `package.json` and `yarn.lock` (see §8).
3. Regressions for the six findings in HANDOVER §8, which is what Stage 1
   item 2 originally asked for and is still not done.

---

## 6. Still not started, from the original plan

These predate the last two sessions and nothing has changed about them.

- **Crash and error reporting** (Stage 1.3). You still learn about
  failures by looking for them.
- **Windows and Linux.** CI builds them; nobody has run either.
- **Performance at scale.** Long timelines, hundreds of clips, memory over
  a long session — all still unmeasured. The export is now instrumented;
  nothing else is.
- **The altitude tools** (Stage 3.9): `analyze_reference_video`,
  `create_picture_in_picture`, `apply_look_preset`, `auto_montage_to_beats`,
  `batch_apply`, `assemble_from_folder`. `analyze_reference_video` is the
  flagship and the natural first skill — the last session did that job by
  hand in ~20 improvised calls, which is exactly the argument for it.

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
- **Embedding Remotion as the compositor.** It renders DOM; getting DOM
  pixels into the export needs `webContents.capturePage()` on a hidden
  window — a separate frame-production path, slower per frame, and it
  breaks the transform gizmo, which needs `getClipBox` to know where
  things are. Take Remotion's *output* as material via `ffmpeg_process`
  if it is ever wanted; do not adopt its authoring model.

---

## 8. Housekeeping

**`yarn.lock` has an uncommitted 2,059-line change that nobody in these
sessions made.** Registry URLs rewritten from `yarnpkg.com` to
`npmjs.org`, and packages added. It has been deliberately kept out of
every commit. Decide what it is before it rides along with something —
and note that adding vitest (§5.2) will touch it.

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
