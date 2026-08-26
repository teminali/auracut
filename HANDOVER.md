# Kerf — handover

An Electron video editor whose Copilot drives a coding CLI as its agent.
Read this whole file before touching anything. Several traps below cost
hours and are invisible from the code.

**Looking for what to work on? [`NEXT.md`](NEXT.md) is the queue** — the
open items with entry points, how to verify each, and the four traps in
getting a dev loop running at all. This file is the architecture and the
trust record; that one is the work.

## Where it stands

Yesterday this was, in its own former words, "a very good previewer". It
could not display video, exported nothing, and several features measured
nothing while reporting success. Those are fixed and verified by
observation:

| | |
|---|---|
| **Video** | Real decode via `videoEngine.ts`. Frame-accurate seeking, verified against burned-in timecode. |
| **Export** | Real file. Renderer composites → main drives ffmpeg. h264/hevc/prores + AAC, aspect-correct, 720p/1080p/**2K**/4K. |
| **Grading** | `highlights`, `shadows`, `sharpen` now render (SVG tone curves). Measured on real frames. |
| **Beats** | Anchored to detected onsets, not a synthesised grid. Tempo and grid both rebuilt — see §3a. 13/13 on a tempo bench, mean marker error 9.0ms. |
| **Silence** | Measured with ffmpeg `silencedetect`, with a `dryRun`. |
| **Copilot** | Multi-backend picker: Claude Code, Codex CLI, Gemini CLI, Cursor Agent. Claude + Codex verified end to end. |
| **Assets** | 183 system fonts, 12 synthesised SFX, search on every panel, 14 transitions, 24 effects, 10 looks. |
| **Keyframes** | 35 animatable properties — filters, masks, text and shape style, not just transforms. 28/28 verified on pixels (§3b). |
| **GPU** | `shaders.ts` is wired. Chroma key and displacement are real; 2D stays the fallback. |
| **Tests** | Six suites in `tools/`, 73 checks, all measuring rendered pixels / written files. Green in dev AND packaged. |

**58 tools**, 4 agent backends. Both the renderer and the main process
typecheck (`npm run typecheck`).

---

## Packaged and verified — and it found two real bugs

Priority Zero is discharged. A real `.app` was built, launched under
Finder conditions (minimal PATH, LaunchServices) and driven end to end.
**Dev parity was not evidence, again:** two of the five at-risk changes
were broken only when packaged, and both looked fine in dev.

```bash
npm run build && npx electron-builder --mac --dir --publish never
```

| At-risk change | Packaged result |
|---|---|
| SVG tone filters | **works.** `shadows` +90 moved mean luma 145.2 → 167.5; `sharpen` 90 moved edge energy 4.89 → 5.33 and left luma alone; revert returned both exactly. |
| `queryLocalFonts` | **was broken.** Fixed — see below. |
| Generated SFX | **works.** Real WAV in temp: 96KB, pcm_s16le 48kHz, exactly 1.000s. |
| **Agent backends** | **were broken.** Fixed — see below. |
| MCP shim | **works.** Config resolves to `app.asar.unpacked`; a full agent turn round-tripped through it. |

Also verified packaged: 53 tools over RPC; export writes h264+aac,
1280×720, exactly 16.000s, audio with real signal (max −6.0 dB) and
composited footage in the frames; the compositor draws real pixels;
`check_command_readiness` is real (one of §3's eight unverified).

**The end-to-end proof:** the Copilot spawned `claude`, which saw all 53
tools as `mcp__kerf__*`, called `describe_timeline` through the shim
→ RPC → renderer, and answered *"DukaBot Commercial · Seq 01 — 5
tracks"* correctly, `is_error: false`. The whole architecture works in a
packaged build.

### The two packaged-only bugs

**Fonts fell back to 33 and cached it forever.** `queryLocalFonts()`
throws `SecurityError: Page needs to be visible.` while the window is
hidden — and the window is hidden for all of startup, because it is
created with `show: false` and revealed on `ready-to-show`. Packaged, a
`file://` renderer loads fast enough to ask before the reveal and lose;
dev's slower dev-server round-trip means the window is already up. The
failure was then cached for the session, so 183 families became 33 with
no indication. Fixed: wait for visibility, and never cache a fallback
that was only taken for a recoverable reason. `list_fonts` now reports
`source: enumerated | probed`, because a probed list is a common-family
subset and absence from it is not evidence.

**Codex and Gemini could not start at all.** Both are npm scripts with a
`#!/usr/bin/env node` shebang, so on execution they look for `node` on
their *own* PATH — and a Finder-launched app hands them
`/usr/bin:/bin:/usr/sbin:/sbin`. Both died with `env: node: No such file
or directory` while the picker still showed them installed. Claude
survived only because it ships a native binary. Fixed with
`agentPath()`, used at all three spawn sites. Codex now probes ready;
Gemini now reaches its real blocker (no personal sign-in) instead of a
missing interpreter.

Finding the binary was solved; giving the binary a usable environment
was not. They are different problems with the same cause.

---

## 0. The plan to a complete product

Five stages, sequenced so each one is only worth doing once the last is
true. Everything in stages 1–2 is *finishing what exists*; the product
only becomes differentiated in stage 3.

### Stage 1 — Prove it ships  *(days)*

Nothing else matters until this is true.

1. ~~**Package and verify**~~ — **done.** It found two packaged-only
   bugs, both now fixed. Re-do this on every release; it pays each time.
2. **A test suite** — **started** (§3b): six suites in `tools/`, 73
   checks, green in dev and packaged. They run against a live Kerf over
   RPC and measure artifacts. What is still missing is a runner that
   does not need the app up, and regressions for the §8 findings.
3. **Crash and error reporting**, so you stop learning about failures by
   looking for them.
4. ~~**Project migration** — `version` is written and never read.~~ —
   **done** (§3b). Refuses a newer format, migrates an older one.

### Stage 2 — Make it trustworthy  *(1–2 weeks)*

5. ~~Finish the audit: the seven tools listed in §3.~~ — **done** (§3b).
   All real; `snapCutsToBeats` needed a fix.
6. Run Windows and Linux. CI builds them; nobody has.
7. A performance pass — **started** (§3b): `render_export` reports a
   timing breakdown and the export is 2.4x faster. Still unmeasured:
   long timelines, memory over a long session, and why packaged encodes
   ~1.6x slower than dev.

### Stage 3 — Make it differentiated  *(2–4 weeks)*

This is where it stops being a worse CapCut and starts being something
else. Order matters: the first item is the one nothing else can do.

8. **`analyze_reference_video`** — the flagship. The agent has ffmpeg
   and eyes: extract frames and look at them, detect cuts, measure
   cadence against the beat, sample the grade, read text placement.
   Improvised it is 20+ calls and different every run; as a tool it is
   two calls and deterministic. Also the natural first skill.
9. **The altitude tools** — `create_picture_in_picture`,
   `apply_look_preset`, `auto_montage_to_beats`, `batch_apply`,
   `assemble_from_folder`. Each is a permanent win in tokens, latency
   and reliability, and each is a cheaper skill later.
10. ~~**The ffmpeg bridge** (`ffmpeg_process`)~~ — **done** (§3b).
    Stabilise, interpolate, denoise, sharpen, deflicker, reverse, speed,
    lut3d, extract audio, custom filtergraph.

### Stage 4 — Make it a platform  *(1–2 months)*

11. **The skill format** — tools + assets + template + verification,
    with slots, provenance and a declared tool-API version (§6). Build
    two skills by hand first and let the format fall out of what they
    needed.
12. **Authoring inside the editor** — `mcpStore` already logs every tool
    call and the timeline keeps commit labels; that trail is the recipe
    and it is being thrown away.
13. **The store** — accounts, payments, hosting, distribution, updates,
    licence enforcement. A second product; scope it as one.

### Stage 5 — Raise the ceiling  *(open-ended)*

14. **The GPU stage** — **started** (§3b). `shaders.ts` is wired, chroma
    key and displacement are real, 2D is the fallback. Still open: mesh
    warps, page curl, and moving transitions onto the GPU.
15. **Per-clip audio** — **half done** (§3b). All four are in the EXPORT
    filtergraph and verified on the waveform. The PLAYBACK graph still
    ignores them, so the preview does not match the render.

### What NOT to do

- **Do not chase CapCut's feature list.** That is a race against
  ByteDance's headcount and it is lost by definition. The question that
  decides this product is: *for the edit someone actually wants, is
  describing it faster than doing it?*
- **Do not ship mobile** (§6). It is where CapCut is strongest and where
  this product is weakest.
- **Do not add a control that does not work.** This codebase has had two
  model pickers and five colour sliders that did nothing. A control that
  lies is worse than a missing feature, because the agent believes it
  and so does the user.

---

## 1. What this is

- **Repo:** https://github.com/teminali/kerf (public) · `v1.1.0`
- **Stack:** Electron 34 + React 19 + TypeScript + Vite + zustand + Tailwind
- **Renderer** owns the project (zustand stores). **Main** owns the OS.
- Desktop only, and deliberately — see §6.

```
src/
  components/   UI by region (header, sidebar, preview, timeline, inspector, copilot)
  engine/       compositor, video, audio, effects, export, fonts, SFX, tone curves
  store/        zustand — the single source of truth
  mcp/          toolRegistry.ts — the 58 tools the agent drives
electron/
  main.ts            app lifecycle, IPC
  agentBackends.ts   one adapter per CLI: detection, MCP config, flags, stream
  claudeSession.ts   spawns the selected backend, streams its output
  render.ts          ffmpeg encode + audio mix + mux
  toolBridge.ts      main → renderer tool execution
  rpcServer.ts       127.0.0.1:3888, token-guarded
  mcpStdio.ts        MCP shim the CLI spawns
  transcribe.ts      ffmpeg + Whisper speech-to-text
```

### The Copilot architecture (non-obvious, do not redesign casually)

```
Copilot drawer ──IPC──> main ──spawn──> claude | codex | gemini | cursor
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

The last hop is the whole point. Editing tools operate on zustand stores
in the renderer, so an external process **cannot** call them directly —
it must ask the window. An earlier version ran tools in its own process
against a fresh empty store and edited a project nobody could see.

**Why MCP when the CLI is right there:** the CLI is a separate OS
process and cannot touch the renderer's stores. MCP is the channel, and
because all four CLIs speak it, the 58 tools are written once and every
backend inherits them. Swapping backends is config, not a rewrite. The
CLI's *own* tools (Bash, Read, WebFetch) are the other half — MCP for
the editor, its own tools for the computer.

### Agent backends

`electron/agentBackends.ts` is one adapter per CLI. Each supplies: where
the binary lives, how MCP servers are configured, the flags for one
non-interactive turn with tools approved, and how to read its stream.

| | State | Stream verified |
|---|---|---|
| Claude Code | default; preferred whenever connected | yes |
| Codex CLI | works | yes |
| Gemini CLI | needs an API key — Google retired personal OAuth for it | no |
| Cursor Agent | needs `cursor-agent login` or a key | no |

Unverified adapters still work: the session falls back to presenting the
CLI's raw output as the answer, and the picker says so before you choose.

**Antigravity is not a backend.** It is an IDE; the `antigravity-ide`
binary it ships is Visual Studio Code's file-opening launcher, still
carrying Microsoft's copyright header. There is no agent to drive. It
was checked rather than assumed, because listing it would have rebuilt
the dropdown-that-selects-nothing this project already deleted twice.

---

## 2. Can it reach 100%?

**Not literally.** Nuke + Resolve + After Effects parity is hundreds of
person-years and is not the goal. Say so plainly if asked.

**~95% of real editing work is reachable**, because two multipliers
compound: the agent has a full computer (anything pre-renderable with
ffmpeg already works), and tool altitude collapses cost — a 2×2 grid was
~22 improvised calls plus a render and a visual check; as a purpose-built
tool it is 3 calls, 13.1s, $0.25.

**The remaining hard ceiling is the compositor.** It is 2D canvas with
zero WebGL calls; `src/engine/shaders.ts` is still 90 lines of dead
GLSL. Until a real shader pipeline exists, chroma key, mesh warps, page
curl, displacement and true motion blur are impossible in-app no matter
how good the agent is.

---

## 3. The trust audit

Six passes done. Every one found working-looking code that did nothing,
including two files a previous handover had marked "verified genuinely
real, do not re-audit".

**Audited against the RUNNING APP and confirmed real:** all 14
transitions, 23 effects, 10 colour looks, 9 kinetic text animations,
caption import/export (SRT round-trips exactly), keyframe interpolation
(measured on rendered frames), masks, `create_grid_layout`, beat
detection, silence removal, `analyze_audio`, video decode, export, fonts,
SFX generation, the Claude and Codex backends, `check_command_readiness`.

**Not yet re-verified:** `resolve_target`,
`describe_layer_at_point`, `copy_effects`, `set_motion_path`,
`set_motion_blur`, `undo` depth, `snapCutsToBeats`.

### Still outstanding

| Item | Shape |
|---|---|
| `shaders.ts` | Wired (§3b). Chroma key and displacement run on the GPU; mesh warps and page curl are still out of reach. |
| Per-clip audio | `pitch`, `voiceEffect`, `noiseReduction`, `ducking` are stored and applied by neither playback nor export. `render_export` now REPORTS them as not applied, so it is visible rather than silent — still a gap. |
| No music library | The SFX are synthesised (`sfxEngine.ts` — read its header for why a hotlinked catalogue was rejected). There is no music, and that is a licensing decision. |
| Gemini / Cursor streams | Adapters written from documented flags, never seen on a real run. |

### What the six passes found

Every one was the same shape — something that looked like it worked:

- **No video decode at all.** Every clip drew through `new Image()`. Hidden because the seed "footage" was Unsplash JPEGs named `.mov` with fake ProRes labels.
- **Export encoded nothing.** Rendered every frame, discarded them, slept, returned a path that was never created, reported success.
- **Beat markers were a metronome.** Real DSP ran; the detected onsets were then thrown away and a grid synthesised from the tempo estimate. 2.5% error scaled to 4+ seconds across a song.
- **`remove_silence` detected no silence.** Trimmed 200ms off both ends of every clip and reported the total as dead air found.
- **`suggest_broll` was a lookup table** for one demo: four JPEGs named `.mp4`, six hardcoded Kiswahili keywords, `confidence: 0.94 + (index % 5) * 0.01`.
- **Five colour controls rendered nothing** while appearing as live sliders and being set by three built-in presets.
- **Ten tools reported success on no-ops** — the store bailed silently on a locked clip or unknown effect and returned void.
- **The main process had no typecheck**, which hid a permission handler that denied every permission and an ffmpeg path that could be null.
- **Crash recovery wrote and nothing read.** `startAutosave` had been serialising the project to localStorage every 20 seconds since the app was built; `hasAutosave`, `restoreAutosave` and `clearAutosave` were called from nowhere. A user whose app crashed had their work sitting right there and was never offered it. The home screen now offers it.

### The method

Grep for dead modules (exported, imported by nobody), `setTimeout`
simulating work, `as SomeUnion` blind casts, `z.string()` where an enum
exists, handlers that never touch a store.

Then the five patterns that actually found things:

1. **Trace to the artifact, not the function.** Export "worked" through every layer that claimed to. The question that found it was *does a file come out?* The same question found the video bug: *are these pixels the footage?* Render the frame and LOOK.

2. **A store method that returns `void` cannot be checked.** Ten tools reported success because the store bailed silently and gave them nothing to test. If a store method can decline, it must say so in its return type.

3. **Demo data that flatters the code hides the bug.** Seed JPEGs named `.mov` meant the only real video path was never exercised. Fixing that lie immediately exposed a second one in `create_grid_layout`. A seed project that misdescribes itself is a test that always passes.

4. **Test against ground truth you constructed.** Beat detection looked fine until it ran on a click track built at exactly 120 BPM. `remove_silence` looked fine until it ran on a file with two known 1.5s gaps. Build the input whose answer you already know.

5. **The obvious API is sometimes the wrong one, and the blunt signal is usually right.** `document.fonts.check()` reads exactly like a font-availability test and returns true for every name. Meanwhile a readiness probe ignored the *exit code* in favour of pattern-matching the message, and called a CLI ready while it was printing "Authentication required". Prefer the signal that cannot be phrased around.

**Unknown is not the same as absent.** This one bit three times in a row
— the Copilot claimed "built-in" while still checking for the CLI, then
the picker claimed backends were ready before probing them, then it did
it again in the code written to fix it. Any status with a loading state
needs three values, not two, and nothing may act on the unknown.

---

## 3a. The seventh pass — building the brand film

The starter project was rebuilt as a real 11.5s brand film, reverse
engineered from a reference piece. Doing it as a user would — driving the
55 tools over RPC rather than writing the EDL by hand — found five things,
and the pattern held: **everything found was something that looked like it
worked.**

### Beat detection was wrong in two independent places

The previous handover said "119.8 BPM on a 120 BPM source, zero drift".
That was true of the input it was tested on and of nothing else. Verified
against a click track — onsets **only** on the beat — which is precisely
the one signal that cannot expose either bug.

**Tempo locked onto the subdivision.** `estimateBpm` autocorrelated the
onset *train* and scored a period by `score / Math.sqrt(period)`. The
comment said this stopped slow tempos being unfairly favoured; it does the
exact opposite. A period half as long gets roughly twice as many chances
to match while its divisor grows by only 1.41, so the shorter period wins
on arithmetic alone. Any track with a hat or a ghost note between the
beats resolved to the subdivision — the brand-film bed, which is exactly
120 BPM, measured **186.1**. A plain 120 BPM click measured 125.4, so the
"zero drift" claim did not survive re-testing either.

Replaced with autocorrelation of the **novelty curve** — continuous, so a
beat landing a frame late still contributes — weighted by a log-normal
tempo prior centred at 125 BPM, plus parabolic interpolation of the peak
for sub-frame resolution. Benched on click tracks at 90/100/120/128/140/
174 BPM, each plain and with a hat-and-ghost pattern, plus the film bed:

    tempo within 3%      4/13  ->  13/13
    mean marker error   87.5ms ->   9.0ms      (2.5 frames -> a quarter of one)

**And the grid was hung off the wrong things.** Three separate faults, each
worth more than a frame:

- *Phase came from the first onset.* One stray transient in an intro
  offset the entire film. The bed opens with 209ms of riser noise and every
  beat inherited that 209ms. Phase is now whichever offset collects the
  most onset energy across the whole track — a measurement, not a guess
  from one sample.
- *It snapped to the NEAREST onset.* Nearest is not right: a ghost note
  90ms off the beat is nearer than nothing, so beats were dragged onto
  hats. It now takes the **strongest** onset in the window.
- *Any onset within a quarter-beat could win* — 125ms at 120 BPM, wide
  enough to reach the surrounding 16ths. Halved, and gated: an onset must
  be at least 0.6x the typical on-grid onset to override the grid. Where
  the detector missed a beat outright, the grid position is kept.

### `transform.scaleX` / `scaleY` did nothing to text

Settable, keyframeable, listed by `list_properties`, reported back on read
— and never read by the renderer. `renderTextClip` draws from font metrics
and was never handed the layout box, so the transform gizmo grew a box
around glyphs that did not move. **The previous starter animated its
wordmark 0.92 -> 1 on both axes and rendered identical frames**, which is
what commit `d281790` describes as "the wordmark blooms in oversized and
settles". Measured before the fix: a 160px "KERF" keyframed 1 -> 2
rendered 264x79px of ink at both ends. After: 273x81 -> 527x156.

### Bundled audio never reached the encoder

`import bedUrl from '../assets/bed.wav'` gives a **root-relative** path in
dev. Fine for an `<audio>` tag in the renderer, meaningless to ffmpeg,
which runs in main and resolves it against the filesystem root. Fixed at
both ends: the starter uses `new URL(..., import.meta.url)`, and
`collectAudioClips` now absolutises any scheme-less URL against
`document.baseURI` before it crosses the bridge — the renderer is the only
side that knows what the URL is relative to.

**The export pipeline came out of this well.** It reported
`0 of 1 audio sources made it into the render` and named the file and the
ffmpeg error, rather than shipping a silent video. That is §3's discipline
paying for itself.

### Two tools an agent could not do without

`reset_project` (clear to an empty timeline, optionally set the canvas)
and `open_starter_project`. There was no way for an agent to start from a
known state — every build landed on top of whatever was already open — and
the bundled example could only be opened by clicking the home screen,
which meant it was never exercised by anything that could check it.

### Logged, not fixed

- **`transform.anchorX` / `anchorY` are read by nothing.** Exposed in
  `propertyPath.ts` with a 0..1 UI range and listed by `list_properties`;
  the render path always pivots on the clip centre. In the gap log.
- **`add_text_layer` defaults to caption styling** — a 6px black outline
  and an 18px drop shadow. Correct over footage, wrong on a clean ground,
  and at 30px the outline thickens Inter until it reads as a slab face.
  Left as the default because captions depend on it; the tool description
  now says so.
- **`src/assets/kerf_sting.wav` was dead.** 695KB, committed by
  `d281790`, imported by nothing — the audio in that commit was only ever
  used to render the demo, never wired into the app. Replaced by
  `kerf_film_bed.wav`, which is wired in and verified in the render.

### How to check a frame

`get_frame_context({ atMs, includeImage: true })` returns a composited
960x540 JPEG at **`frame.imageDataUrl`** in ~25ms. That is the instrument
for iterating on composition — roughly a hundred times cheaper than
rendering a segment and reading it back with ffmpeg.

It is not a substitute for the render. It proves what the compositor
draws; only the file proves the file, which is the whole lesson of §3.
Both were used here: the frame tool for every composition decision, a real
export plus an independent ffmpeg pass for the result.

### Packaged, and it found a fourth bug — as usual

The dev build exported audio. **The packaged build exported silence**, and
this file's own rule earned its keep again.

`asar` is a virtual filesystem that only Electron's patched `fs`
understands. The renderer read the bundled music bed happily and played
it; ffmpeg, which is a separate OS process in main, got
`…/app.asar/dist/assets/kerf_film_bed-J12PoKff.wav` and reported **"Not a
directory"** — because to anything outside Electron, `app.asar` is a file,
not a folder. The failure mode is a film that has music in the app and
none in the export.

`electron-builder.yml` already carried this exact lesson for the MCP
shim — *"Paths inside app.asar are not spawnable"* — and it applies just
as much to anything a separate process has to **read**. Fixed in two
parts, because either alone does nothing:

- `asarUnpack` now covers `dist/assets/*.{wav,mp3,…,mp4,mov,…}`, which
  puts a real copy under `app.asar.unpacked`;
- `electron/mediaPath.ts` — `ffmpegSource()` — redirects any path through
  `app.asar` to that copy, and does the `file://` decode that four call
  sites in `render.ts` and `transcribe.ts` were each doing by hand.

Verified on the packaged `.app`, launched under Finder conditions
(`env -i`, minimal PATH, LaunchServices): `open_starter_project` →
`render_export` → `hasAudio: true`, `audio: {requested: 1, included: 1}`,
no warnings. Independently on the file: 1920x1080, 345 frames, 11.500s,
h264 + aac stereo, 13 cuts from 4.000s to 10.000s, audio -25.9 -> -8.3 dB
with the impact the loudest beat, peak -0.5 dBFS.

**And a process note worth more than the bug.** The first packaged retest
"failed" identically after the fix. The fix was fine; `pkill` had not
killed the old instance and `open -a` re-activated it, so the same
pre-fix binary answered on 3888 both times. Check `ps -o lstart` against
when the build finished before believing a packaged result — the port
being answered is not evidence that the thing answering is the thing you
just built.

### What the film is, and why it is shaped that way

`src/engine/starterProject.ts`. Read its header before editing it — the
two rules that carry the piece are measurements, not taste:

- **Four seconds of runway with no cut at all.** The old sting fired at
  0.9s, which is exactly why it read cheap. Nothing lands if nothing
  preceded it.
- **A luminance zig-zag across the montage** — no two adjacent shots near
  each other in brightness, extremes at the first cut and at two-thirds
  through. Every cut is a luminance jolt, which is what reads as
  percussive before a note is heard. Edit a shot and its neighbours have
  to stay far apart or the cut between them disappears.

The cuts sit on the grid `detect_beats` returned for the bundled bed, not
on a 0.5s interval anybody typed, and the grid is dropped on the timeline
as markers so that claim is visible rather than trusted. Re-running
`detect_beats` on the bed reproduces `BEATS_MS` exactly — 118.9 BPM, 22
beats.

Verified on the rendered file, with the same ffmpeg analysis used on the
reference: 1920x1080, 30fps, 345 frames, 11.500s, h264 + aac stereo;
13 cuts from 4.000s to 10.000s; audio climbing -25.9 -> -12.3 dB across
the runway with the impact at 4.0s measuring -8.3 dB, the loudest beat in
the film.

---

## 3b. Closing the gap to Remotion

The question was what makes Kerf weaker than Remotion, and whether to
build it or embed it. The answer, after measuring: **most of the gap was
not the renderer.**

Read this section before deciding to adopt anything. Three of the four
things that made the compositor feel limited were missing keyframes and
one wrong flag.

### Seventeen properties said they were animatable and were not

`propertyPath.ts` advertised twenty-four properties as `animatable: true`.
`add_keyframes` accepted seven. An agent was told it could keyframe a
filter, and the next call refused the name.

`AnimatableProperty` is 35 entries now, and `ANIMATABLE_PROPERTIES` is the
single list the type, the tool validation and the property schema all
derive from — the flag used to be hand-written per row, which is exactly
how it drifted. `transform.x` and `positionX` are reconciled by an alias
table rather than by picking a winner, since both are already in use.

Three of them rendered nothing at all: **`transform.anchorX/anchorY`**
(every clip pivoted on its own centre, invisible at the 0.5,0.5 default),
**`mask.rotation`** (every mask sat axis-aligned), and **`mask.featherPx`**
(impossible as written — `ctx.clip()` is binary, so a soft edge needs the
clip drawn into an isolated layer and the mask outline filled through a
blur as a `destination-in` source).

### The GPU stage exists

`shaders.ts` is no longer imported by nothing. `gpuStage.ts` renders a
clip into an isolated layer, hands that layer to a fragment shader, and
composites the result back — so no layout, transform or ordering logic
moves onto the GPU, and the export path never learns a shader ran.

`chromaKey` was five EDL properties, five `propertyPath` rows and **zero**
references in the compositor. It works now. Its despill could not have
worked as written: it desaturated by how CLOSE a pixel was to the key
colour, which only touches pixels already made transparent. Spill is the
opposite problem — the screen bouncing onto the subject, in the pixels
that SURVIVE the key.

Displacement is new, and `EffectDefinition.gpu` names a shader rather
than implementing one, so the registry stays the single catalogue.

Every entry point returns null without WebGL and falls back to 2D. A
machine with no GPU gets a film without a key, not a crash.

### The export was 2.4x slower for a flag that reads as an optimisation

`render_export` now returns a timing breakdown. The first profile:

    seek 3ms · composite 63ms · JPEG encode 13,435ms · write 384ms

Compositing an 87-clip 1080p project is **0.18ms a frame**. The renderer
was never the slow part. The cause was
`getContext('2d', { willReadFrequently: true })`, commented "every frame
is read back for JPEG encoding, so keep the surface on the CPU" —
reasonable, and backwards. Removing it: 22.5 → 55 fps at 1080p in dev.

**Packaged is slower than dev** — 24.6 ms/frame against 15.7. The 55 fps
number is a dev number; packaged is ~36 fps. Nobody has looked into why.

A ring of canvases with the encodes issued together was built and
deleted: 6277 / 6210 / 6318 ms at ring sizes 1, 4 and 8. `toBlob`
serialises inside Chromium however many are in flight. The numbers are in
the comment because the next person to read that profile will have the
same idea. Real parallel encoding needs OffscreenCanvas in workers or
WebCodecs.

### Per-clip audio, the project format, and the ffmpeg bridge

**Audio** — pitch, voiceEffect, noiseReduction and ducking were stored,
listed, settable, and applied by neither playback nor export. All four
are in the filtergraph now. Ducking cannot be a per-clip filter (it needs
something to duck AGAINST), so the mix splits into a ducked bus and a key
bus and sidechains one against the other.

**Project format** — `version` was written into every file and read by
nothing. An old file loaded as though current; a file from a NEWER Kerf
also loaded, silently, and would be saved back with whatever it did not
understand dropped. Refuses the future, migrates the past, says which.

**`ffmpeg_process`** — stabilise, interpolate, denoise, sharpen,
deflicker, reverse, speed, **lut3d against a real .cube**, extract audio,
or a raw filtergraph. The renderer supplies a filter string and named
options, never argv; the command is built in main so a caller cannot
reach an output path. This is also the sane answer to "should we embed
Remotion" — take its output as material, not its authoring model.

### The seven unaudited tools

All real. `snapCutsToBeats` was weak: it always absorbed the shift into
the previous clip, which is right for a butted-together montage and wrong
on a track with gaps — and each absorption shrank that clip, so one snap
made the next likelier to be refused. Four cuts laid off the beat snapped
one. Now four of four, worst distance 251ms → 0ms.

### The test suite

`tools/` — eight suites, 107 checks, run against a live Kerf:

    verify_keyframes.py       28   every animatable property, on pixels
    verify_gpu.py              6   chroma key, despill, displacement
    verify_audio.py           11   pitch/voice/denoise/ducking, on the waveform
    verify_project_format.py   6   migration and version refusal
    verify_tools.py           10   the previously unaudited seven
    verify_ffmpeg_bridge.py   12   every operation, against written files
    verify_playback_audio.py  26   preview vs render, both measured (§3c)
    verify_frame_context.py    8   mediaPending, on a race it must win

All green in dev **and in the packaged app**. Every check measures the
artifact — rendered pixels, exported audio, a file on disk — because
asserting against the store would have passed on nearly everything above.

**The set was order-dependent, and green only on a fresh app.** The six
were run as a loop and reported 73/73; run the same loop again without
restarting Kerf and `verify_keyframes` reported thirteen ERRORs. Nothing
was wrong with the filters. `verify_keyframes` inserted
`media_cyber_city` — a seeded sample asset, ambient state it did not own —
and `verify_project_format` opens constructed files carrying
`'mediaPool': []`, which `projectIO` **replaces** the live pool with
rather than merging. One suite silently emptied the pool another depended
on, permanently, for the life of the process. Proven by running the one
check either side of it: PASS, then `verify_project_format`, then FAIL,
same app, same code.

It also meant the suite needed the network, since those samples are
Unsplash URLs — a fact nothing recorded. `verify_keyframes` now builds a
probe chart itself (`build_probe_chart`, fixed seed, with a comment on
what each part of the image is for and which filter would measure as a
no-op without it), imports it, and re-imports if the pool is emptied
under it. 73/73 twice in a row on one running app.

That fix also earned the suite a control it never had. Thresholds were
tuned by hand and nobody had checked one could still fail:
`verify_keyframes.py --selftest` reruns every row holding the property
still and demands the metric move by LESS than its threshold. 28/28, every
row at exactly Δ0.000, while the forward run moves them by roughly ten
times their thresholds — so the rows are measuring the property and not
the weather.

**Two of the failures these suites reported were the suites' own**, and
both are worth knowing:

- Keyframing a filter on a block covering 2% of the frame and reading a
  whole-frame mean reports ten false failures.
- **`get_frame_context` returns a frame whose media has not finished
  decoding and says nothing about it.** The compositor draws a
  placeholder, which reads as a legitimately dark frame. Measure after an
  insert and you are measuring nothing. The harness now waits for the
  frame to stop changing; the tool should probably say so itself.

### Things to know before changing any of this

- **`electron/*.ts` compiles to `dist-electron` and HMR does not touch
  it.** A main-process change needs `npm run build:electron` and a
  restart. The per-clip audio suite scored 2/11 against a stale main, and
  one of those two "passes" was noise reduction apparently working at 2x
  — which was AAC encoding variation. A weak pass on a stale build looks
  exactly like a real one.
- **`pkill` does not reliably kill Electron.** After a repackage, check
  `ps -o lstart` against the build time before believing a packaged
  result. Port 3888 answering is not evidence that the thing answering is
  the thing you just built.
- **`ELECTRON_RUN_AS_NODE=1`** is set in some shells (VS Code's, among
  others), and makes `electron .` run as plain node — `ipcMain` comes
  back undefined and main dies on the first `.handle`. Launch with
  `env -u ELECTRON_RUN_AS_NODE`.
- **deshake's `rx`/`ry` must be multiples of 16.** ffmpeg's help says
  "from 0 to 64" and nothing about the step; a value of 50 is accepted
  and then fails with "Not yet implemented in FFmpeg, patches welcome",
  naming neither the filter nor the parameter.
- **`set_motion_path` takes ABSOLUTE canvas coordinates** while
  `transform.x/y` are offsets from the centre. Both are documented. It is
  still the kind of difference that costs an afternoon.

---

## 3c. The preview that disagreed with the render

§3b closed the audio gap in the EXPORT: pitch, voice effects, noise
reduction and ducking all reach the file, proved on the exported waveform.
Playback applied none of them. That is a worse state than the one it
replaced — before, neither side applied them and the export said so out
loud; after, the render applied them and the preview quietly differed. You
would cut against a telephone voice you could not hear.

### The instrument came first, and it decided the design

The export can be checked by reading the file it writes. Playback writes
nothing, which is why this had no test and why §3b left it open.

So the chain is a module (`src/engine/audioEffects.ts`) that builds on any
`BaseAudioContext`, not on the playback context. A
`MediaElementAudioSourceNode` cannot be rendered offline; a graph that
only knows about nodes can. `describe_audio_preview` renders that same
graph through an `OfflineAudioContext` over probe signals and returns
band gains and impulse taps — so "the preview applies telephone" is a
measurement, not a sentence in a tool description.

`tools/verify_playback_audio.py` then measures BOTH engines and compares
them, which is the only form of this claim worth making:

    echo      taps at 0 / 180 / 340 ms        in the rendered file AND the preview
    stadium   taps at 0 / 420 / 780 / 1200 ms in both
    telephone transfer functions agree to 0.41 dB from 100 Hz to 12 kHz

Four settings match the render. `robot` and `ducking` are approximations
and are listed as approximations — ffmpeg sweeps its own delay line, and
`sidechaincompress` works per sample where the preview measures the key
bus once a frame. `pitch`, `deep`, `high` and `noiseReduction` are
DECLARED: the preview measures transparent, the render measurably differs,
and both the tool and an amber panel in the Audio inspector say so. A
control that lies is worse than a missing feature, and a preview is a
control.

### Comparing against the render found a bug that looked correct

WebAudio defines `BiquadFilterNode.Q` for `lowpass` and `highpass` as a
resonance in **decibels**. ffmpeg's `width` at `width_type=q` is a linear
quality factor. So:

```ts
hp.Q.value = Math.SQRT1_2;   // reads as 0.7071 dB -> linear Q 1.0854
```

asks for a filter with a resonant lift around the corner, and it looks
exactly like the line that asks for Butterworth. It measured **3.6 dB**
off the render at 3 kHz. Confirmed by computing the analytic RBJ response
at a linear Q of 1.0854, which reproduced the broken preview to **0.00 dB**
— and ffmpeg's own output matched the Q=0.7071 response to 0.03 dB, so
there was no doubt which side was wrong. The constant is
`BUTTERWORTH_Q_DB` now, and it is `-3.0103`.

A check asserting "telephone attenuates 100 Hz" would have passed on the
wrong filter. Comparing two engines against each other is what caught it.

**And one of the two bugs was in the test.** The first version of the band
metric summed energy over bands defined as a ratio around a centre. Those
bands get wider as the centre rises, white noise fills them in proportion
to width, and the metric therefore reported 3 kHz as LOUDER than 1 kHz
through a 3200 Hz lowpass — which no lowpass can do — and blamed the
preview for a 10 dB disagreement. Replaced with a ratio of mean power
spectral densities, where bandwidth and source spectrum both cancel. Worth
saying plainly: the first failure this suite reported was its own, and
noticing that is what made the real one credible.

### `debug/capture` was showing the wrong frame, silently

§10 offers `debug/capture` for "does the panel look right". It returned
the LAST FRAME THE WINDOW PAINTED. macOS occlusion detection stops a
covered window compositing, `webContents.capturePage()` reports no error
in that state, and every screenshot taken while the terminal was in front
showed the home screen for an app that had been in the editor for ten
minutes.

Caught with a control rather than by suspicion: set
`document.body.style.background = '#ff0000'`, capture, and compare. The
PNG was byte-identical. Fixed in two parts, because either alone leaves it
able to lie:

- `main.ts` disables `MacWebContentsOcclusion`, so the window keeps
  painting when it is covered;
- `captureWindow()` returns `{pngBase64, visibility, stale, note}` — the
  page's own `visibilityState`, and a refusal to imply a stale frame is
  live. Unknown is not the same as absent; three values, not two.

The window still has to be frontmost for a live frame, and it stops being
frontmost the moment a shell command runs — so activate and capture inside
one script. That, and the fact that Vite HMR full-reloads the page and
drops you back to the home screen mid-run, are in `NEXT.md`.

---

### The frame that was not the frame you asked for

`get_frame_context` handed back frames whose media had not decoded and
said nothing. The compositor's placeholder is a dark gradient, so the
result reads as a legitimately dark shot — and §3b already records that
this produced ten false failures while `verify_keyframes.py` was written.

The frame carries `mediaPending` now, counted **during the draw** in
`compositor.ts` rather than re-derived after it: a separate pass asking
"would this decode now?" can answer differently from what was painted, and
the warning would then describe a frame nobody was given.

The suite that proves it has to win a race, so it is built to fail when it
does not: fresh clip, fresh mkdtemp so the URL is new to the media cache,
and no pending frame observed is a FAILURE rather than a pass. Placeholder
luma 28.0 against 97.8 decoded — the flag marks a real difference in the
picture, not a bookkeeping distinction.

**And it removed a workaround.** `settle()` in `verify_keyframes.py` used
to poll until the picture stopped changing. That is a guess in the caller
about something only the renderer knows, and it was wrong in both
directions — it gave up early on a frame that held still for one poll, and
waited out its whole 3-second timeout on every shape-and-text scene where
nothing was decoding. The suite now runs in 2 seconds rather than ~90.

---

## 4. The capability gap log — your build queue

`report_capability_gap` / `list_capability_gaps` → `src/store/gapStore.ts`
→ `GapLog.tsx` (amber badge in the Copilot header).

The agent logs a gap whenever it says no OR substitutes something
different — including when a workaround succeeded. Repeat asks bump a
counter, so it sorts by real demand. Exports as markdown.

Treat it as the prioritised backlog, and as the list of which **skills**
to build first (§6).

---

## 5. Roadmap

**Phase 0 — Package and verify.** See Priority Zero. Nothing ships until
the packaged app is exercised.

**Phase 1 — Finish the audit.** Eight tools listed in §3 remain.

**Phase 2 — Altitude.** Replace agent improvisation with deterministic
tools. Rule of thumb: if the agent needed >6 calls and a verification
step, it should have been one tool. Highest value first:

- **`analyze_reference_video`** — the differentiated one. The agent has
  ffmpeg and eyes; it can extract frames and look at them, detect cuts,
  measure cadence against the beat, sample the grade, read text
  placement. Improvised this is 20+ calls and different every run; as a
  tool it is 2 calls and deterministic. Nothing else on the market does
  this, and it is the natural first skill.
- `create_picture_in_picture`, `apply_look_preset`,
  `auto_montage_to_beats`, `batch_apply`, `assemble_from_folder`.

**Phase 3 — ffmpeg bridge.** A first-class `ffmpeg_process` tool
(stabilise / interpolate / denoise / custom filtergraph) rendering to a
temp file and auto-importing. Buys a large slice of "impossible"
cheaply, because those can be pre-rendered rather than implemented.

**Phase 4 — GPU stage.** WebGL2 (or WebGPU) pass in `compositor.ts`,
wiring the dead `shaders.ts`. The real unlock for chroma key, warps,
displacement and motion blur. Biggest job; keep the 2D path as fallback.

**Phase 2.5 — audio depth.** Playback, waveforms, `analyze_audio`,
Whisper and audio-in-the-render all landed. What remains is the per-clip
processing listed in §3.

---

## 6. Product direction

Decisions taken deliberately. Revisit them on purpose, not by drift.

**Desktop only, and staying on Electron.** Mobile is where CapCut is
strongest and where this product is weakest — no ffmpeg, no shell, no
filesystem means arriving on their turf having left the moat at home.
And Electron is the *right* choice here rather than a legacy one: the
compositor depends on Chromium-specific behaviour (SVG filters
referenced from canvas, WebCodecs, `queryLocalFonts`,
`OfflineAudioContext`), and Tauri's per-OS webviews would mean verifying
the render pipeline three times and finding it differs.

If mobile ever matters, the path is Tauri/Capacitor wrapping the
existing renderer plus an in-app agent loop against provider APIs — not
React Native or Flutter, which would mean rewriting the compositor.
Keeping that door open costs one rule, worth honouring regardless
because it also keeps the layer testable:

> **`src/engine` and `src/store` must not reference `window.electronAPI`.**
> OS access goes through the bridge. They are a portable core.

**Credentials are the user's own.** No inference cost to us, ever. The
picker accepts both shapes — subscription CLIs (`claude`, `codex login`)
and raw API keys — stored at `0600` in the app's data directory, not the
user's shell profile, because a Finder-launched app cannot read that
profile anyway.

**The intended model is a free editor plus a skill store.** A skill is
not a prompt pack: it is **tools + assets + a template project +
a verification test**, installed like an extension, with new projects
cloned from it. That shape matters —

- the buyer can never get nothing: if the agent fumbles they still have
  a real project on the timeline
- every skill is demoable before purchase by showing the template
- assets are licensed per skill, which is tractable, rather than
  licensing a whole library, which is not

### Charging for skills

**Sell skills one-time. Do not put buyers on a subscription.**

Reasoned from the demand shape rather than from another platform's
model: a creator picks one to three skills matching the content they
make, uses them for a year, and occasionally tries something new. That
is recurring *occasionally*, not recurring *monthly*. A subscription
asks someone who needs one skill to rent the rest of the catalogue, and
with a small catalogue it is worse — everything arrives in month one and
month two buys nothing.

The economics also rule out the usual alternatives:

- **Usage-based is unjustifiable.** Inference is on the user's own
  subscription, so a per-run charge meters something that costs us
  nothing, and users can tell.
- **All-you-can-eat is a leak** unless skills stay revocable managed
  extensions. They do — projects clone *from* an installed skill rather
  than exporting it — so revocation works, but the demand shape still
  argues against it.

What is genuinely recurring, and therefore honest to subscribe:

- **Sellers, not buyers.** Authors get ongoing service — storefront,
  hosting, verification runs on every Kerf release, payouts,
  analytics. A creator tier is a small paying group receiving continuous
  commercial value. Most marketplaces make their early money this way.
- **Commercial rights**, where a bundled asset's own licence recurs.
  Price the rights, not the download: personal / commercial / team is a
  tier boundary that is not arbitrary, and it is how stock libraries
  price for exactly this audience.
- Optionally a **studio pass** for people who want everything and early
  access — offered alongside one-time purchase, never instead of it.

Two consequences to plan for:

1. **One-time means per major version.** Updates within 1.x, a
   discounted upgrade at 2.0. "Updates forever for one payment" is a
   lifetime-deal trap: revenue front-loaded, maintenance perpetual, and
   worse for third-party authors who will abandon skills and leave you
   holding them.
2. **A free editor has no revenue floor.** Skill sales are lumpy and
   tied to catalogue growth. Accept the lumpiness deliberately, or hold
   one non-skill pro capability back for a cheap platform tier — but
   decide which, rather than discovering it.

Creator split: 70/30 is standard; **80/20 for the first year** is worth
it, because early supply is the bottleneck, not demand.

Things to build into the format **before** there are a thousand skills,
because they are ruinous to retrofit:

1. **Slots.** A template has specific media; a skill needs placeholders. Without them a skill is a template with extra steps — the value is that one skill makes many different videos.
2. **Asset provenance, enforced at packaging.** The author declares a licence per bundled asset or it cannot be published.
3. **A verification run.** The skill executes against a fresh project and the artifact is checked. If it does not run, it does not publish. Quality control and the marketing claim in one.
4. **A declared tool-API version.** Otherwise the next tool change silently breaks skills in the field and you learn about it from refunds.
5. **The verification fixture stored with the skill**, so every skill in the store can be re-run against a new Kerf build before shipping. That turns "did I break anyone's skill?" into a test suite.

Authoring happens **in the editor** — make an edit, then package it. Most
of the raw material exists: `mcpStore` already logs every tool execution
and the timeline keeps commit labels, which together are the recipe. It
is recorded already and simply not kept.

Sequence: build two skills by hand from the top of the gap log and let
the packaging format fall out of what they needed. Then the authoring
flow. Then the store.

---

## 7. The home screen

`src/components/home/HomeScreen.tsx`, shown before a project is open and
returned to via the mark in the header.

**Deliberately not CapCut's home.** Theirs is a feature launcher — a grid
of tiles because each of their AI capabilities is a discrete button.
Kerf's capability is not a grid; it is a conversation and a set of
skills. So the screen is organised around INTENT: one primary action,
and it is a sentence.

Order, by how often it is actually needed: say what you want → unsaved
work, if any → recent projects → skills.

Three rules it is held to. These are what "better than CapCut" means
concretely, and they are worth defending against future additions:

1. **Real content over chrome.** Every recent tile is a frame rendered
   from that project, captured on the way out of the editor. A wall of
   grey rectangles is a file dialog with extra steps — and CapCut's own
   home is full of them.
2. **One unmistakable primary action.** CapCut's home has roughly
   twenty-five clickable things above the fold, three of which are
   advertisements. This has one, and it is the thing nothing else on the
   market can do: describe the edit and have it start.
3. **No upsell in the workspace. Ever.**

Recents live in `src/store/recentsStore.ts` — localStorage, capped at 12
because each entry carries a project snapshot and an unbounded list
would exhaust the quota and take the autosave down with it. Quota
failure drops snapshots and keeps the list, which is what the screen
actually needs.

The Skills section says it does not exist yet, on purpose. An empty
store dressed as a full one is exactly the theatre the rest of this
codebase has had removed.

### Navigation

Closing the **editor** returns to home; closing **home** quits. The
window's close button cannot be reached from React, so the intercept
lives in main (`mainWindow.on('close')`), and the renderer reports which
screen it is showing via `ui:setScreen` on every change. `app.quit()`
now runs on every platform including macOS, because a close can only
originate from home — the editor intercepts it — so it is an explicit
"I am done" rather than the usual accidental window close.

**Not yet verified by a real click.** Renderer-initiated
`window.close()` does not emit the BrowserWindow `close` event in this
configuration, so the test path never exercised the handler. Click the
traffic light in a packaged build before trusting it.

### Iconography

**One AI mark across the whole platform: lucide `Sparkle`** — the single
four-point shine. It replaced `Sparkles` (the multi-star, which is on
every AI product shipped in the last two years) and `Wand2`, so there is
one symbol for "the agent did this" rather than three. If a place ever
genuinely needs its own mark, give it one deliberately; do not let the
set drift back.

---

## 8. Product hardening — mostly not started

The roadmap in §5 is about capability. This is about being software
people can rely on, and it is largely unbuilt. Ordered by consequence:

**There are no automated tests. None.** No runner, no test script, no
test files. Six audit passes found code that lied, every fix was
verified by hand exactly once, and nothing prevents any of it
regressing tomorrow. Start with regressions for the findings that are
already characterised — they are mostly mechanical to write because the
manual verification is recorded in the commit messages:

- export produces a file with a video AND an audio stream
- a video clip renders footage, not the placeholder gradient
- a 120 BPM source measures ~120 with no drift
- `shadows` moves measured luminance; `sharpen` moves edge energy
- the ten no-op tools throw instead of reporting success
- a 9:16 project exports portrait and undistorted

This also **is** the skill-verification harness (§6). Build it once.

**No crash or error reporting.** You have no way to learn what breaks
for users. Everything found this session was found by looking.

**Project format has no migration.** `projectIO.ts` writes
`version: FORMAT_VERSION` and never reads it back. The schema already
changed once (the `lut` fields were removed). Old projects will drift
silently.

**Windows and Linux are unexercised.** CI builds them. Nobody has run
them.

**No performance work.** Long timelines, many clips, 4K playback,
memory over a long session — all unmeasured.

**No onboarding.** First-run for someone who has never edited.

**The editor-close intercept is unverified** — see §7. It is standard
Electron, but the test path did not exercise it.

**None of the commercial layer exists** — accounts, payments, skill
hosting, distribution, updates, licence enforcement, storefront. That is
a second product and it is not scoped.

---

## 9. Traps that cost real time. Read these.

**`ELECTRON_RUN_AS_NODE=1` is inherited from VS Code.** Every Electron launch
from a VS Code terminal starts as plain Node and exits silently. Always
`env -u ELECTRON_RUN_AS_NODE npx electron .`. This burned an hour.

**`open` forwards your shell environment, so that trap reaches the packaged
app too.** `open -n Kerf.app` from a VS Code terminal launches it as plain
Node: exit 0, no window, no port, no log — indistinguishable from the
signing failure below, and it will send you hunting the wrong bug. Use
`env -u ELECTRON_RUN_AS_NODE open -n path/to/Kerf.app`.

**That same forwarding makes `open` a bad Finder simulation.** The app
inherits your developer PATH, so anything that depends on a minimal
environment — every agent backend — passes when it would fail for a real
user. To test the actual condition:

```bash
env -i HOME="$HOME" USER="$USER" SHELL=/bin/zsh TMPDIR="$TMPDIR" \
    PATH=/usr/bin:/bin:/usr/sbin:/sbin \
    open -n release/mac-arm64/Kerf.app --args --remote-debugging-port=9333
```

**Drive the packaged renderer over CDP.** `--remote-debugging-port` plus
`Runtime.evaluate` is the only way to ask the packaged app a direct question
(`window.electronAPI`, a font query, `document.visibilityState`). Pick a port
nothing else holds — Chrome sits on 9222, and reading *its* target list by
mistake will show you a `localhost:5173` tab titled "Kerf" and convince
you the packaged app is loading the dev server. Check the port's owner with
`lsof` before believing what it tells you.

**A hidden window is not a working one.** Chromium reports
`visibilityState: 'hidden'` for a window that is merely occluded by another
app, and some APIs refuse outright — `queryLocalFonts()` throws
`SecurityError: Page needs to be visible.` Anything asked during startup, or
while the window is in the background, may get an answer it would not get
otherwise. Never cache such an answer.

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

**Verify installs by version, not by exit code.** A `/Volumes/Kerf*` glob
picked a stale mount and cheerfully "installed" 1.0.0 over 1.0.0, reporting
success. Read the mount point from `hdiutil` output.

---

## 10. How to run and verify

```bash
yarn install
yarn dev                                    # renderer at :5173 (probe-able)
env -u ELECTRON_RUN_AS_NODE npx electron .  # desktop app
yarn build                                  # tsc + vite + electron bundles
npx electron-builder --mac --dir --publish never   # real package
```

**Drive the live editor from a terminal** (the fastest way to test tools):

```bash
claude --mcp-config "~/Library/Application Support/kerf/mcp-kerf.json" \
       --strict-mcp-config --permission-mode bypassPermissions \
       -p "Using the kerf MCP tools, describe the timeline."
```

**Call a tool directly**, no agent, no tokens — best for tight loops:

```bash
TOKEN=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser(
  '~/Library/Application Support/kerf/mcp-kerf.json')))['mcpServers']['kerf']['env']['KERF_RPC_TOKEN'])")
curl -s -X POST http://127.0.0.1:3888/rpc -H "x-kerf-token: $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"method":"tools/call","params":{"name":"describe_timeline","arguments":{}}}'
```

**UI testing in a browser:** `yarn dev`, then a page under `public/` that
imports `/src/main.tsx` (needs the react-refresh preamble) and mocks
`window.electronAPI`. Access stores via `window.__kerf` — importing the
module directly gives a *different* instance and will waste your time.
**Delete `public/` afterwards; it ships otherwise.**

---

## 11. Release

### The rename, and what it left behind

The project was **AuraCut** until v1.2.0. A kerf is the narrow slit a blade
leaves in material; in an editor the edit is the gap between two clips.

Three consequences outlive the rename, none of them worth a migration at
this size but all worth knowing:

- **User data was orphaned, deliberately.** `appId` moved to
  `com.kerf.editor` and `productName` to `Kerf`, so Electron derives a new
  userData directory. Settings, the capability gap log and the generated
  MCP config are all still sitting at the old path. Nothing reads them.
- **Old project files will not open.** `projectIO.ts` checks
  `file.format === 'kerf.project'` and the extension is now `.kerf.json`.
  Anything saved as `.auracut.json` is rejected. One line would accept the
  legacy string if a real file ever turns up.
- **`/Applications/AuraCut.app` must be deleted by hand**, or the machine
  carries two editors that both bind RPC port 3888 — and whichever starts
  first wins, which is a confusing way to test the wrong build.

**Auto-update survived, and this was verified rather than assumed.** Shipped
v1.1.0 installs read a feed pointing at `teminali/auracut`. GitHub redirects
renamed repositories: the old release-asset URLs return 200, `releases.atom`
301s to `teminali/kerf`, and the API redirects. The shipped 1.1.0 build was
then launched after the rename and asked its own feed — it answered
`up-to-date`, not `error`, which is the answer that proves the redirect
resolved. Nobody was stranded.

If you ever rename again, the identifiers that cross a process boundary are
the dangerous half, because they fail silently: the RPC env vars and token
header, the `KERF_SIGNED` build-time define, and above all the MCP server
name — renaming it renames all 53 tools at once, and the system prompt in
`claudeSession.ts` names them literally. Rename both in the same commit or
the agent will confidently call tools that no longer exist, which reads as
a model failure rather than a rename bug.

### Cutting one

Tag `v*` → GitHub Actions builds macOS/Windows/Linux and publishes installers
plus the `latest*.yml` manifests the updater reads.

```bash
npm version 1.2.0 -m "Kerf %s"
git push origin main --follow-tags
```

**macOS cannot auto-update** — unsigned, so Squirrel.Mac refuses. The app
detects this and shows "Get \<version\>" instead of failing silently. Adding
`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
`APPLE_TEAM_ID` to repo secrets flips it on with **no code change** — CI
already detects `CSC_LINK` and stamps `KERF_SIGNED=1`, which esbuild inlines
at build time (it is a build-time fact; reading `process.env` at runtime does
not work).

---

## 12. Working agreement

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

---

## Tool quirks found by using the app, not reading it

These cost real time and are invisible from the source. Found while
building the logo sting through the MCP tools.

**`add_keyframes` APPENDS, it does not replace.** Calling it twice on the
same property stacks both sets and the tool reports success both times.
Two bars ended up carrying 15 keyframes each and the original values kept
winning, so a "fix" changed nothing. To re-animate a property, delete and
rebuild the clip — or add a `replace` option, which is the better fix.

**A shape layer's base box is 480x480, not the canvas.** `scaleX: 0.6`
gives a 288px-wide bar in a 1920px project, not 1152px. Guessing this
wrong twice is what stopped the logo's bars from sitting flush. Derive
sizes from the base, or measure.

**`get_frame_context` bounds are PRE-mask and PRE-crop.** They cannot
confirm framing. Render the frame (`includeImage: true`, read
`frame.imageDataUrl`) and look at the pixels — or assert numerically on
the bounds you *can* trust, like the gap between two shapes.

**Only one instance can hold the RPC port.** Port 3888 is taken by
whichever Kerf started first, but `mcp-kerf.json` is rewritten by
whichever started *last* — so the config on disk can carry a token the
listener will reject, and every tool call returns "Bad or missing token".
Kill the other instance. A clean fix would be to fail loudly on
EADDRINUSE rather than write a config that cannot work.

**The bundled starter is built in code** (`src/engine/starterProject.ts`),
not stored as a snapshot, so it cannot drift from the EDL format. It
seeds Recents only when the list is empty and is displaced by real work.
