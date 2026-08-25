# AuraCut — handover

You are picking up an Electron video editor whose Copilot **runs Claude Code
as its agent**.

## What changed last session

**The editor could not display video.** Every clip was drawn through
`getCachedImage()` → `new Image()`. An `<img>` cannot decode an MP4, so real
footage rendered as the compositor's grey placeholder gradient. Forever. It
was invisible because the seed project's "footage" was Unsplash **JPEGs**
typed `video`, named `A001_C001_NeonCity_4K.mov` and labelled
`ProRes 422 HQ` at `18.4 MB`. Stills draw fine through an `<img>`.
`src/engine/videoEngine.ts` now decodes video; the seed data no longer lies
about itself.

**Export encoded nothing** (the previous Priority Zero). Fixed: the renderer
composites each frame and streams it to main, which drives ffmpeg to a real
file. Verified from the artifact — h264 + 48kHz stereo AAC, real signal.

Both are done. The current state is honest: picture and sound go in, a real
file comes out.

---

## ⚠ PRIORITY ZERO: keep finishing the trust audit

Three passes are done and each one found working-looking code that did
nothing. The remaining tools have NOT all been checked. See §3.

Read this whole file before touching anything. Several of the traps below
cost hours to find and are invisible from the code.

---

## 1. What this is

- **Repo:** https://github.com/teminali/auracut (public) · currently `v1.1.0`
- **Stack:** Electron 34 + React 19 + TypeScript + Vite + zustand + Tailwind
- **Renderer** owns the project (zustand stores). **Main** owns the OS.
- Installed at `/Applications/AuraCut.app` on the maintainer's Mac (arm64).

```
src/
  components/   UI by region (header, sidebar, preview, timeline, inspector, copilot)
  engine/       compositor, effects, geometry, captions, snapping, export
  store/        zustand — the single source of truth
  mcp/          toolRegistry.ts — the 48 tools the agent drives
electron/
  main.ts           app lifecycle, IPC
  toolBridge.ts     main → renderer tool execution
  rpcServer.ts      127.0.0.1:3888, token-guarded
  mcpStdio.ts       MCP shim Claude Code spawns
  claudeSession.ts  spawns + streams the CLI
  transcribe.ts     ffmpeg + Whisper speech-to-text
```

### The Copilot architecture (non-obvious, do not redesign casually)

```
Copilot drawer ──IPC──> main ──spawn──> claude CLI
                                            │ MCP (stdio)
                                            ▼
                                      mcpStdio.cjs
                                            │ HTTP 127.0.0.1:3888 (+token)
                                            ▼
                                      main ──IPC──> renderer
                                                      │
                                                      ▼
                                             toolRegistry (owns project)
```

The last hop is the whole point. Editing tools operate on zustand stores in
the renderer, so an external process **cannot** call them directly — it must
ask the window. An earlier version ran tools in its own process against a
fresh empty store and edited a project nobody could see.

Claude Code brings its **own** tools (Bash, Read, Write, WebFetch, downloads)
alongside AuraCut's 48. It authenticates with the user's existing Claude
subscription — no API key. `npm i -g @anthropic-ai/claude-code` is the only
requirement; without it the Copilot falls back to a regex planner and says so.

---

## 2. Answer to "can we reach 100%?"

**Not literally.** Nuke + Resolve + After Effects parity is hundreds of
person-years and is not the goal. Say so plainly to the maintainer if asked.

**But ~95% of real editing work is genuinely reachable**, because two
multipliers compound:

1. **The agent has a full computer.** ffmpeg is installed. Anything that can
   be *pre-rendered externally and imported* already works — stabilization,
   exotic transitions, frame interpolation, advanced encodes. The editor does
   not have to implement these to offer them.
2. **Tool altitude collapses cost.** Measured on one real request
   ("2×2 grid collage"): composed from primitives = ~22 tool calls plus a
   render and a visual inspection; as a purpose-built tool = **3 calls,
   13.1s, $0.25**. Every capability moved from "agent improvises" to "one
   deterministic tool" is a permanent win in tokens, latency and reliability.

**The hard ceiling is the compositor.** It is a 2D canvas renderer with a
per-frame effect descriptor (offset, rotation, scale, alpha, blur, rgbSplit).
There is **no GPU stage**: `src/engine/shaders.ts` contains 90 lines of WebGL2
GLSL that *nothing imports*. Until a real shader pipeline exists, an entire
class of work is impossible in-app no matter how good the agent is:

| Needs a renderer, not a tool | Reachable as a tool today |
|---|---|
| Page curl, corner pin, mesh warp | Grids, PiP, split-screen |
| True 3D, camera moves in Z | Batch grades, look presets |
| Particle simulation | Auto-montage to beats |
| Per-pixel chroma key (GLSL is dead code) | Anything ffmpeg can pre-render |
| Motion blur from real vectors | Multi-clip retiming |

So the honest roadmap is: **audit → altitude → ffmpeg bridge → GPU stage.**

---

## 3. Do this first: the trust audit

**This session found four separate pieces of capability theatre.** This is
the single highest-value work available, because the agent believes every
tool it calls, and a lying tool makes it confidently wrong.

Found and fixed:

| Bug | Shape |
|---|---|
| `apply_transition` | Took `z.string()`, blind-cast to `TransitionType`. `page_curl` returned **`success: true`** and wrote garbage into the clip. Five sites now validate via `oneOf()`. |
| `generate_auto_captions` | Entirely fake. Slept 1200ms, returned one hardcoded Kiswahili sentence, ignored its `audioUrl`. Every project got identical captions. Now real (ffmpeg + Whisper). |
| **No audio playback at all** | `audioEngine.ts` was a class whose only method played a 440Hz beep, imported by nothing. Play moved the picture in silence while `Math.random()` level meters bounced convincingly. Now a real Web Audio engine. |
| **Waveforms were fiction** | `audioPeakExtractor.ts` (real code) imported by nothing, so every waveform came from a hash of the clip id. Looked like audio, correlated with nothing. Now wired. |
| Copilot model dropdown | `configureModelEndpoint` was never called anywhere. Purely decorative. Replaced by the Claude Code session. |

Still outstanding:

| Item | Shape |
|---|---|
| `shaders.ts` | 90 lines of WebGL2 GLSL that **nothing imports**, headed "GPU Shaders Engine". The compositor is pure 2D canvas — zero WebGL calls. This is the ceiling on VFX (Phase 4). |
| The rest of the 48 | Passes 1–3 covered effects, timeline structure, silence, B-roll, captions and export. Captions import/export, beat detection, keyframes, masks, `create_grid_layout` and the context-protocol tools have **not** been re-verified against the running app. |

Found and fixed in the later passes — all verified against the live app:

| Bug | Shape |
|---|---|
| **No video decode** | See above. The single largest one. |
| **Export encoded nothing** | See above. |
| `getClipBox` ignored canvas size | It positions from `project.width/height`, so any export resolution other than the project's own put the whole composition in a corner. 4K was broken outright. |
| Export never seeked video | `renderTimelineFrame` is synchronous — it draws whatever frame each element holds. Without an awaited seek an export writes one stale frame repeatedly: a real file, right duration, wrong picture. |
| One bad audio source silenced the whole render | The mix threw, the failure was swallowed as "audio is not worth failing a render over", and the export returned `ok: true, hasAudio: false`. The seed project reproduced it every time — its music URL 403s to ffmpeg. |
| **10 tools reported success on no-ops** | `split_clip`, `freeze_frame`, `delete_clip`, `trim_clip`, `move_clip`, `remove_effect`, `set_effect_param`, `animate_effect_param`, `add_effect`, `apply_motion_preset`. The store bails silently on a locked clip / unknown effect / out-of-range time and returns void, so the tool has nothing to check. |
| `remove_silence` | Detected no silence. Trimmed 200ms off each end of every clip and reported the total as dead air found. Now measures with ffmpeg `silencedetect`, and has a `dryRun`. |
| `suggest_broll` | Four Unsplash JPEGs named `.mp4`, six hardcoded Kiswahili keywords, `confidence: 0.94 + (index % 5) * 0.01`. Now searches the project's own media pool. |
| `generateAutoCaptions` (store) | Still held the four hardcoded Kiswahili phrases, imported by nothing. Deleted. |
| Blind casts | `easing as any` ×2, `fps as 24 | 30 | 60`. `EASINGS`, `FPS_VALUES` and `CLIP_TYPES` now exist as runtime lists kept in step by `satisfies`. |
| Silent empty results | `list_effects` with a bad category and `patch_clips` with a misspelled `clipType` both reported success having done nothing. |
| Copilot model dropdown | Still decorative on the fallback path — `configureModelEndpoint` is defined and called from nowhere. Removed. |

**Lesson from how this was missed:** the audit swept tools and engines and
never asked the most basic question — *does a file come out?* Trace each
user-visible outcome end to end to the artifact it claims to produce, not just
to the function that claims to produce it.

Verified genuinely real, do not re-audit: `beatDetect.ts` (WebAudio decode,
spectral-flux onsets, autocorrelation tempo), `compositor.ts` rendering,
`exportPipeline.ts`, the effects registry.

**Audit method that worked:** grep for dead modules (exported, imported by
nobody), `setTimeout(resolve` simulating work, `as SomeUnion` blind casts,
`z.string()` where an enum exists, and handlers that never touch a store.
That sweep is what surfaced the audio findings — the tools were fine; the
engine underneath was not.

**Three more patterns, from the passes after that one:**

1. **Trace to the artifact, not to the function.** Export "worked" through
   every layer that claimed to work. The question that found it was *does a
   file come out?* The same question found the video bug: *are these pixels
   the footage?* Render the frame and LOOK.

2. **A store that returns `void` cannot be checked.** Ten tools reported
   success because the store bailed silently and gave them nothing to test.
   If a store method can decline, it must say so in its return type.

3. **Demo data that flatters the code hides the bug.** The seed project's
   JPEGs-named-`.mov` meant the only real video path was never exercised.
   A seed project that misdescribes itself is a test that always passes.
   If you add fixtures, make them honest.

**Verify from outside the app:** `debug/capture` on the RPC server returns a
PNG of the real window — `screencapture` needs a screen-recording grant a
terminal usually lacks, and the compositor's frame render shows the picture
with none of the UI. Renderer console output is forwarded to the terminal in
development; without it a crashed React tree just looks like a black window.

**Your first task: audit all 48 tools in `src/mcp/toolRegistry.ts` for the
same pattern.** For each, ask:

- Does it validate enum-ish inputs, or blind-cast? (`oneOf()` helper exists —
  use it. Fixed at 5 sites; check for more.)
- Does the handler actually *do* the thing, or return a plausible shape?
- Does the description promise more than the implementation delivers?
- Does it report success on a partial or no-op?

Grep starters: `as \w+Type`, `as \w+Kind`, `z.string()` where an enum exists,
handlers with no store mutation, `setTimeout` used to simulate work.

Write findings into the capability-gap log (below) or fix them outright.

---

## 4. The capability gap log — this is your build queue

`report_capability_gap` / `list_capability_gaps` (tools) →
`src/store/gapStore.ts` → `GapLog.tsx` (amber badge in the Copilot header).

The agent is instructed to log a gap **whenever it says no OR substitutes
something different** — including when a workaround succeeded. Repeat asks
bump a counter, so the list sorts by real demand. Exports as markdown.

Treat it as the prioritised backlog. It is a feature list ranked by users
actually hitting the limit, which beats guessing.

---

## 5. Roadmap (proposed — revisit against the gap log)

**Phase 0 — Export.** DONE. Also video decode, which had to come first:
encoding frames is pointless while the frames are placeholder gradients.

**Phase 1 — Trust.** Three passes done (see §3), the rest of the 48 not yet.
Nothing else matters if tools lie.

**Phase 2 — Altitude.** Replace agent improvisation with deterministic tools.
`create_grid_layout` is the worked example (22 calls → 3). Candidates:
`create_picture_in_picture`, `apply_look_preset`, `auto_montage_to_beats`,
`batch_apply`, `create_lower_third`, `assemble_from_folder`.
Rule of thumb: if the agent needed >6 calls and a verification step, it should
have been one tool.

**Phase 2.5 — audio depth.** Playback, real waveforms, `analyze_audio`,
on-demand Whisper setup and audio IN THE RENDER have landed. What remains:
`ClipAudioSettings.pitch`, `voiceEffect`, `noiseReduction` and `ducking` are
stored and applied by neither the playback engine nor the export
filtergraph. `render_export` now REPORTS them as not applied rather than
dropping them silently, so the gap is visible — but it is still a gap.

**Phase 3 — ffmpeg bridge.** A first-class `ffmpeg_process` tool
(stabilize / speed-interpolate / denoise / custom filtergraph) that renders to
a temp file and auto-imports. Unlocks a large slice of "impossible" cheaply.
ffmpeg lives at `/opt/homebrew/bin/ffmpeg`; find it robustly (see §6).

**Phase 4 — GPU stage.** A WebGL2 pass in `compositor.ts`, wiring the existing
dead `shaders.ts`. This is the real unlock for VFX/motion graphics: chroma key,
warps, page curl, displacement, real motion blur. Biggest job; do it last and
deliberately. Keep the 2D path as fallback.

**Cost/speed levers throughout:** higher-altitude tools (fewest turns wins),
keep `--strict-mcp-config` (avoids loading the user's other MCP servers),
consider a cheaper model for mechanical turns, and batch tools over loops.
Typical turn today: 3–20 calls, 13–30s, $0.15–0.25.

---

## 6. Traps that cost real time. Read these.

**`ELECTRON_RUN_AS_NODE=1` is inherited from VS Code.** Every Electron launch
from a VS Code terminal starts as plain Node and exits silently. Always
`env -u ELECTRON_RUN_AS_NODE npx electron .`. This burned an hour.

**Dev parity is not evidence.** Three separate bugs worked perfectly in dev
and failed only when packaged. Package a real `.app` and test against it
before believing anything ships:
- ESM main inside an asar fails to load silently (exit 0, no output) → main
  and preload are both **CommonJS `.cjs`**; `"type": "module"` makes `.js`
  ESM.
- `identity: null` skips signing, leaving Electron's stale signature; Apple
  Silicon then refuses to execute. `build/afterPack.cjs` ad-hoc signs.
- The MCP shim is spawned as its own process, so it **cannot live inside the
  asar** — `asarUnpack` + `app.asar` → `app.asar.unpacked` path rewrite.

**`electron-updater`'s `autoUpdater` is a lazy getter.** Touching it at module
scope constructs a platform updater and calls `app.getVersion()` before
Electron has an `app` — throws during import and kills main before any line
runs. Resolve it lazily.

**A GitHub secret that does not exist is an empty string, not unset.**
`CSC_LINK=""` was read by electron-builder as a certificate *path*, resolved
against the project dir, and killed the macOS job with
`⨯ <workspace> not a file`. The signed/unsigned CI steps are mutually
exclusive for this reason.

**A GUI app launched from Finder has a minimal PATH.** No Homebrew, no
Python framework bin. `claude`, `ffmpeg` and `whisper` are all found via
explicit candidate paths plus a login-shell fallback — copy that pattern for
any new binary.

**Clip `bounds` are PRE-mask.** They cannot confirm a crop. To verify framing,
render the composited frame (`get_frame_context` with `includeImage: true`,
read `frame.imageDataUrl`) and *look at it*. Both the agent and I shipped the
same aspect-ratio bug by trusting bounds.

**`cover` overflows.** It fills the frame without distorting, so a portrait 4K
source in a landscape project is far taller than the frame. Derive crops from
each clip's real box via `getClipBaseSize`, never from canvas × scale.

**Bridge timeouts are per-tool** (`SLOW_TOOLS` in `toolBridge.ts`). A flat 60s
reported "timed out" while Whisper loaded a 484MB model.

**`asar extract-file` writes into the CWD.** It silently overwrote
`package.json` with the stripped copy from the archive.

**Verify installs by version, not by exit code.** A `/Volumes/AuraCut*` glob
picked a stale mount and cheerfully "installed" 1.0.0 over 1.0.0, reporting
success. Read the mount point from `hdiutil` output.

---

## 7. How to run and verify

```bash
yarn install
yarn dev                                    # renderer at :5173 (probe-able)
env -u ELECTRON_RUN_AS_NODE npx electron .  # desktop app
yarn build                                  # tsc + vite + electron bundles
npx electron-builder --mac --dir --publish never   # real package
```

**Drive the live editor from a terminal** (the fastest way to test tools):

```bash
claude --mcp-config "~/Library/Application Support/auracut/mcp-auracut.json" \
       --strict-mcp-config --permission-mode bypassPermissions \
       -p "Using the auracut MCP tools, describe the timeline."
```

**Call a tool directly**, no agent, no tokens — best for tight loops:

```bash
TOKEN=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser(
  '~/Library/Application Support/auracut/mcp-auracut.json')))['mcpServers']['auracut']['env']['AURACUT_RPC_TOKEN'])")
curl -s -X POST http://127.0.0.1:3888/rpc -H "x-auracut-token: $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"method":"tools/call","params":{"name":"describe_timeline","arguments":{}}}'
```

**UI testing in a browser:** `yarn dev`, then a page under `public/` that
imports `/src/main.tsx` (needs the react-refresh preamble) and mocks
`window.electronAPI`. Access stores via `window.__auracut` — importing the
module directly gives a *different* instance and will waste your time.
**Delete `public/` afterwards; it ships otherwise.**

---

## 8. Release

Tag `v*` → GitHub Actions builds macOS/Windows/Linux and publishes installers
plus the `latest*.yml` manifests the updater reads.

```bash
npm version 1.2.0 -m "AuraCut %s"
git push origin main --follow-tags
```

**macOS cannot auto-update** — unsigned, so Squirrel.Mac refuses. The app
detects this and shows "Get \<version\>" instead of failing silently. Adding
`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
`APPLE_TEAM_ID` to repo secrets flips it on with **no code change** — CI
already detects `CSC_LINK` and stamps `AURACUT_SIGNED=1`, which esbuild inlines
at build time (it is a build-time fact; reading `process.env` at runtime does
not work).

---

## 9. Working agreement

The maintainer values being told the truth about what does not work over
being told things are fine. Several times this session the useful move was
"I checked, and it was broken" — including about work I had just done.

- **Verify by observation, not inference.** Render the frame. Read the
  version. Check the pixels.
- **Reproduce before fixing.** One CI guess cost a full build cycle; the local
  reproduction that actually found it took two minutes.
- **Name your own mistakes plainly** and move on.
- Commit messages here explain *why* and record the failure mode, so the next
  person does not re-derive it. Keep that.
