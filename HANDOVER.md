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

**Not yet re-verified:** nothing on the old list. `resolve_target`,
`describe_layer_at_point`, `copy_effects`, `set_motion_path`,
`set_motion_blur`, `undo` depth and `snapCutsToBeats` are all covered by
`verify_tools.py`, and §3d added `redo` depth alongside `undo`.

### Still outstanding

| Item | Shape |
|---|---|
| `shaders.ts` | Wired (§3b). Chroma key and displacement run on the GPU; mesh warps and page curl are still out of reach. |
| ~~Per-clip audio~~ | **Stale — corrected.** This said `pitch`, `voiceEffect`, `noiseReduction` and `ducking` were "stored and applied by neither playback nor export". None of that is true now and had not been for a while. The export applies all four (`afftdn`, `pitchShift`, the voice-effect switch, and a ducking sidechain in `render.ts`), and playback applies everything except `noiseReduction` — `pitch`, `deep` and `high` run through `pitchWorklet.js`, a granular shifter in an AudioWorklet, so they need no decode. Verified rather than read: `verify_playback_audio` is 29/29 and compares the preview against the render per setting, including the telephone bandpass and the ducking key-clip fallback. `unpreviewableAudio` still reports `noiseReduction` honestly as render-only. |
| ~~Solo does not silence a video clip's audio~~ | **Fixed.** Both audio implementations gated the solo skip on `track.type === 'audio'`, so a soloed AUDIO track silenced other audio tracks and left the sound embedded in clips on VIDEO tracks running at full level — 68.75 dB before and after, Δ0.00. They agreed with each other, which is what made it look like intent rather than a slip. Solo now means "only this": the maintainer's call, matching every other NLE. Measured after: the video clip's 440Hz tone goes 68.75 → −45.27 dB while the soloed track is unchanged and the picture does not move. The PICTURE gate is separate and stays that way — `compositor.ts` and `videoEngine.ts` count only non-audio tracks, so an audio solo no longer blanks the frame. |
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

**Packaged was recorded as slower than dev** — 24.6 ms/frame against
15.7 — and it does not reproduce. Measured interleaved, three-plus runs
per condition on the starter project at 1080p: packaged 11.1 mean, dev
11.3 mean, 1.5% apart and inside the spread of either.

The original pair was taken "minutes apart", and that is the whole
explanation available: the first dev reading of the session that checked
this was 16.1 ms/frame, 43% above the dev mean of the same build, for
reasons that survived neither eight spinning CPU cores (+8%) nor running
five suites first (no change). Two readings minutes apart do not
establish a difference on this machine. `NEXT.md` §2 has the numbers.

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

**`npm run verify` runs all of it** — boots its own Kerf on a free port,
runs the eight suites, kills it, exits non-zero. ~19s. `npm test` runs 166
unit tests with no app at all. Note that six of the eight suites exit 0
whether they are green or red, so the runner parses their summary lines
rather than trusting exit codes; a `&&` chain would report success on a
red run.

`tools/` — twelve suites, 295 checks, run against a live Kerf:

    verify_keyframes.py       28   every animatable property, on pixels
    verify_gpu.py              6   chroma key, despill, displacement
    verify_audio.py           11   pitch/voice/denoise/ducking, on the waveform
    verify_project_format.py   6   migration and version refusal
    verify_tools.py           10   the previously unaudited seven
    verify_ffmpeg_bridge.py   12   every operation, against written files
    verify_playback_audio.py  26   preview vs render, both measured (§3c)
    verify_frame_context.py    8   mediaPending, on a race it must win
    verify_montage.py         38   cuts on beats, measured in the exported file
    verify_altitude.py        74   look presets and PiP geometry, on pixels
    verify_reference_analysis.py 55  cuts, cadence, grade, motion, on constructed truth
    verify_hardening.py       21   §8's six named regressions

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

## 3d. The eighth pass — closing the agent-tooling gap

68 tools reached 39 of the store's 105 actions. Writing the missing 65
was supposed to be schema-and-description work over actions that already
worked. It was not, and the reason is HANDOVER §3's own finding #2:
**almost every one of those actions returned `void`.** A wrapper that
calls a void action and reports success is the exact bug this file has
recorded six times, so each action had to learn to say no first.

Everything below was measured on a rendered frame, an exported file or a
project on disk. None of it was read off the source.

### Soloing an audio track turned the picture black

`anySolo` was `tracks.some((t) => t.solo)` — no type test — in
`compositor.ts` and `videoEngine.ts`, while `audioEngine.ts` and
`exportPipeline.ts` had always filtered by type. So one audio track's
solo flag meant no VIDEO track was soloed, every video track failed the
`!track.solo` test, and nothing was painted. Mean luma **7.06 -> 0.00**,
in the preview and in the exported file, since `renderTimelineFrame` is
what the export draws with.

It survived because **there was no tool that could set solo.** The flag
was reachable only from the UI, and nothing in twelve suites touched it.
Building the tool surface is what exercised it.

### "A lock now means one thing" was not yet true

`15b615b` closed the property surface and its comment called `add_effect`
"the last edit path that wrote through a lock". The whole ANIMATION
surface still did. On a locked clip, `patch_clip` refused with
"Rectangle is locked" and `add_keyframes`, `upsert_keyframe` and
`add_motion_path_point` all reported success — **and the keyframes
really landed.**

This is the worse half of the family, not the milder one. A no-op leaves
the project as the user left it. This wrote through a lock the user had
deliberately set, while the tool beside it said the clip was protected.
Thirteen store actions now refuse, plus seven more the clip lane found
(`renameClip`, `reverseClip`, `clearEffects`, `toggleEffect`,
`reorderEffect`, and `closeGapsOnTrack` on a locked TRACK).

`closeGapsOnTrack` is worth naming separately: a locked track is exactly
what someone locks to stop its timing moving, and it repacked every clip
on the track at once. Starts `[0, 2000, 4000]` stayed `[0, 2000, 4000]`
after the fix.

### And then the refusal messages were wrong, which was its own bug

Declining turned out to be half the job. With the store refusing, the
tools reported the refusal in terms of whatever they happened to check
next. On a locked clip carrying two keyframes and an animated blur:

    clear_keyframes           "Rectangle" has no keyframes to clear.   (it had two)
    animate_effect_param      No effect "gaussian_blur" on that clip.  (it had one)
    update_motion_path_point  index 0 is out of range: the path has 2 point(s) (0-1).

The third contradicts itself inside one sentence. An agent told there is
no `gaussian_blur` on the clip adds a SECOND one; an agent told the path
is empty rebuilds it. **A wrong reason is not a smaller version of no
reason — it is an instruction to do the wrong thing.** `requireUnlocked`
in the tool layer throws the real reason first, and it caught
`set_motion_path` reporting success on a refusal outright.

### The rest, briefly

- **`splitClip` destroyed the animation it cut through.** Head held its
  first value, tail its last; a shape keyframed -700 -> 700 and cut at
  the midpoint jumped **332px** at the join. It samples the curve at the
  cut now and gives the boundary key to both halves. 0.000px.
- **`add_keyframes` was a one-way door.** No tool listed keyframe ids, so
  `remove_keyframe` would have been unusable the day it shipped.
- **`verify_keyframes` claimed "every property" and covered 28 of 35** —
  the six it skipped were positionX, positionY, opacity, scaleX, scaleY
  and rotation.
- **Reversed audio does not exist**, and **in/out points are decorative
  for rendering** — including an `ExportModal` "range only" checkbox
  whose value never reaches the encoder. Both measured, both still open,
  both now stated in the tool descriptions instead of implied away.

### The audit is a suite now, not a snippet

The gap was measured by a python snippet living in `NEXT.md`. Snippets in
markdown report the same number next month whatever anybody does, so it
is `tools/verify_tool_coverage.py` and it runs in `npm run verify`. It
fails on any store action that is neither reachable nor excused in
writing, and on any excuse that has since grown a tool. Each "patch_clip
covers it" is proven by driving `patch_clip` and reading the before and
after it reports — because that is precisely what `mask.rotation` was
failing while being settable, keyframeable, listed and rendered.

Both guards were checked by being made to fail on purpose. A threshold
nobody has tried to fail is not a threshold, and that applies to a
static check as much as to a measured one.

**105 store actions, 104 tools, 0 unreachable.** 15 suites, 487 checks.

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

`src/components/home/`, shown before a project is open and returned to
via the mark in the header. `HomeScreen` is the shell; `HomeTopBar`,
`HomeSidebar`, `HeroRow`, `MoreTools`, `ProjectsSection` and
`SkillsView` sit under it, and every action the screen can take lives in
`homeActions.ts` rather than in the tile that triggers it.

**It is CapCut's layout now, and that is a reversal.** This section used
to argue the opposite at length: that CapCut's home is a feature
launcher — a grid of tiles because each of its AI capabilities is a
discrete button — and that Kerf's capability is a conversation, so the
screen was organised around INTENT, with one primary action that was a
sentence ("What do you want to make?") wired straight to a Copilot turn.

The maintainer's call was to adopt CapCut's layout, sidebar included.
The prompt box is gone; describing an edit now happens in the editor's
Copilot drawer, which the second card on this screen opens directly.

**What was NOT adopted, and why.** CapCut's home carries Sign in, Join
Pro, Spaces, Project sync and eight AI tool tiles. Kerf has no accounts,
no cloud, no Pro tier and no "AI fashion model", so those slots hold
Kerf's own things:

| CapCut's slot | What is in it here |
|---|---|
| account card | the agent connection — the one thing Kerf connects to |
| Join Pro | Open project… |
| Templates / Spaces nav | Skills, which says in writing that it is not built |
| New project hero | New project — a chooser now, blank timeline or a screen recording (§7a) |
| Video Studio card | the Copilot |
| ad carousel (right rail) | the most recent project, poster and all |
| ad card (sidebar foot) | unsaved work to recover, or nothing |
| eight AI tool tiles | the eight editor panels, AI-badged on the two that run a model |
| Project sync | nothing. Search and view mode are real; sync has no backend |

Two of the three rules the old screen was held to survive the change,
for the same reasons they were written down:

1. **Real content over chrome.** Every project tile — and the whole
   right rail — is a frame rendered from that project, captured on the
   way out of the editor. A wall of grey rectangles is a file dialog
   with extra steps.
3. **No upsell in the workspace. Ever.** CapCut runs advertisements in
   both card slots. Neither does here, which is why the sidebar's foot
   is empty when there is nothing to recover.

Rule 2 — one unmistakable primary action — is weakened deliberately:
this layout has a hero, a secondary card, a rail and eight tiles above
the projects wall. That is what the layout change cost, and it was the
trade being asked for.

**"New project" did not exist before this.** The old button entered the
editor with whatever happened to be loaded, so leaving a project and
pressing New handed you the same project straight back. It clears the
timeline and resets the settings now.

Recents live in `src/store/recentsStore.ts` — localStorage, capped at 12
because each entry carries a project snapshot and an unbounded list
would exhaust the quota and take the autosave down with it. Quota
failure drops snapshots and keeps the list, which is what the screen
actually needs.

**Verified by `tools/verify_home.py`** (18 checks, in `npm run verify`).
It drives the real DOM — clicks what a user clicks — and then asks the
STORES what changed, because six of the eight tool tiles differ only by
which panel they open and no screenshot would tell you that two of them
opened the same one. `--selftest` is the control: it runs the identical
assertions with every click SUPPRESSED and requires all 14 interaction
checks to go RED. A check that still passes when nobody pressed anything
was reading ambient state and proving nothing.

### The material pass, and the accent

The layout is CapCut's; the *execution* is not, and the difference is
what separates a screen that reads as considered from one that reads as
generated. Three things carry it, and none of them is colour — see the
`HOME SURFACE` layer in `index.css`:

1. **A light source.** Every raised plane has an inner highlight on its
   top edge and a cast shadow below it, consistent with light from
   above. Flat fills with a 1px border are the tell.
2. **Grain.** An inlined `feTurbulence` at 2–5%. Perfectly smooth
   gradients band on an OLED panel and read as vector art.
3. **Response.** A lift and a warming fill, on the one easing curve
   the app already had.

**Point 1 was then walked back, and the walk-back is the lesson.** The
first pass gave every card a border, a cast shadow AND an inner
highlight. Held against CapCut's own screen, that was three edges where
the reference has one: their cards are a solid rectangle about sixteen
RGB points lighter than the page, with no border, no shadow and no
highlight, and it reads dramatically calmer.

The theory is not wrong in general; it was wrong HERE. Elevation earns
its cost when surfaces overlap and you have to read which is in front. A
launcher is a flat grid of tiles that never overlap, so every shadow was
noise answering a question nobody asked. Depth is now only on the things
that genuinely float — the hero, and anything hovered.

The same correction applied twice more:

- **The active nav item carried three signals** — an edge bar, a raised
  gradient pill and an inset ring — for one binary state. It is a quiet
  fill plus an accent-coloured icon now. The edge bar is gone entirely:
  flush-to-frame is right in the editor, where the rail IS the window
  edge, and wrong in a sidebar that is inset from it.
- **The tool row wrapped each tile in a bordered box**, putting eight
  containers in a row to compete with the hero above them. The container
  belongs to the ICON — a rounded square behind the glyph, as the
  reference does it — and the tile itself has none.

The rule that came out of it, and the one to hold new work to:
**material for content, nothing for chrome.** Project posters, the hero
and the Copilot card are content and get a surface. Navigation, tool
launchers, the account block and the recovery notice are chrome and get
nothing until hovered.

The primary tile went through three versions before it was right, and
the two rejected ones are the useful part: a flat pale-cyan slab with
two centred words reads as a placeholder (the space does nothing and
nothing says what pressing it does), and softening the mesh was not
enough — **a pale slab in a dark interface always looks pasted on**. It
is left-aligned with a supporting line and an arrow now, and its colour
is saturated enough to belong to the interface rather than sit on it.

**The accent is Claude's terracotta (`#d97757`).** Blue, then amber,
then green, then this. Two consequences, and they are now CHECKS rather
than things to remember:

- **White has failed on three accents running**: 3.1:1 on amber, 2.2:1
  on green, 3.1:1 on this terracotta. `--on-accent` (`#2b1108`, 5.7:1)
  is what sits on accent fills. `palette.test.ts` now asserts it, so a
  fifth accent cannot ship with unreadable type on it.
- **Every accent collides with something, and the collision moves when
  the accent does.** Amber hit KEYFRAME and CAUTION, so the snap guide
  went teal. Green hit the STATUS green and that same teal, so "AI" and
  the snap guide went blue. This terracotta is the hardest yet, because
  an orange-red lands in the middle of the warm range where caution and
  error already lived. Measured as hue separation rather than judged:
  amber was 23 degrees away and moved to a yellower gold at 32.

  **Red could not be fixed by hue at all.** It is boxed between the
  accent at 15 degrees and the pink text lane at 330, and every hue in
  that window is within 30 of one or the other. It is separated by
  SATURATION instead, a vivid red against a muted clay. That is
  mitigation rather than elimination, and it is written down because
  the next person will otherwise assume it was never checked.

  The palette reads: **terracotta = the thing you are acting on, blue =
  the agent, gold = keyframes and caution, vivid red = error.**
  `palette.test.ts` enforces the 30-degree rule and the saturation
  exception, so the next swap fails loudly instead of quietly.

### Real frames on the wall

§7 rule 1 says every project tile is a frame from that project, and
until this pass that was only true of projects you had *left* — the
capture ran in `goHome`, synchronously, taking whatever the media cache
happened to hold. Leave a project a second after opening it and every
clip is still decoding, so the "frame" is the compositor's dark
placeholder gradient. That does not look like an error. It looks like a
legitimately dark shot, and it sticks to the wall for ever.

`src/engine/posterCapture.ts` renders a poster from a stored snapshot
**without touching the live stores** — `captureFrame` takes tracks and a
project as arguments and makes its own canvas, which matters because the
home screen still holds whatever project was last open and a tool tile
enters the editor with it. It waits on `mediaPending` rather than
guessing, and samples a third of the way in rather than at zero, where
edits usually start on black or a title card.

Two callers: a backfill on home for any entry missing a poster, and a
fire-and-forget re-render after `goHome` that replaces the synchronous
capture with a decoded one. The backfill runs on `requestIdleCallback` —
each capture is a full-resolution composite of every clip in the project
and must never compete with the renderer registering the IPC handlers
the MCP bridge talks to.

The bundled starter has no snapshot (it is rebuilt from code, not
reloaded), so it keeps a placeholder until it has been opened once.

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

**One AI mark across the whole platform: `Sparkle`** — the single
four-point shine. It replaced `Sparkles` (the multi-star, which is on
every AI product shipped in the last two years) and `Wand2`, so there is
one symbol for "the agent did this" rather than three. If a place ever
genuinely needs its own mark, give it one deliberately; do not let the
set drift back.

It had already drifted by one and nobody had noticed: the editor's
activity rail wore `Sparkle` on the **VFX** tile as well as the AI tile,
two rows apart in the same 58px column. VFX is not AI. It is `Zap` now,
and `Sparkle` again means one thing.

**The set is Phosphor, and every icon comes from `ui/icons.ts`.** The
reason for the swap is not nicer drawings, it is SIX WEIGHTS: a
single-weight stroke set can only signal "selected" by changing colour,
which is why every toolbar in this app read flat. Idle is `regular`,
active is `fill`, and that is legible at 16px with no colour at all.

`ui/icons.ts` re-exports the set under the names the codebase already
used, so the next swap is one file rather than 52. Two rules are
enforced by `ui/iconography.test.ts` rather than written down and
forgotten: **no emoji anywhere in `src`**, and **no direct imports from
an icon package**. Both had already been broken once.

Note that `stroke-[N]` and `strokeWidth` do NOTHING to a Phosphor glyph
— it is a filled path, not a stroked one. Use `weight`.

---

## 7a. The screen recorder

`New project` on the home screen is a chooser rather than an action:
**Blank timeline**, or **Record the screen**. `NewProjectSheet.tsx` is
the chooser; everything under it is new.

| Where | What it owns |
|---|---|
| `electron/screenRecorder.ts` | the source list, the take files, the cursor track, the floating bar |
| `src/engine/screenCapture.ts` | the MediaRecorders, because only a renderer can hold a MediaStream |
| `src/engine/cursorZoom.ts` | turning a cursor track into zoom moments and keyframes |
| `src/engine/recordingProject.ts` | a finished take, turned into a project |
| `src/store/recorderStore.ts` | the one place a take can be started or stopped |
| `src/components/recorder/` | the studio, its options rail, and the floating bar |

**The claim the whole thing rests on: a recording arrives as an EDIT,
not as a render.** Every part of the assembled project is built from the
same store actions the UI and the MCP tools use — tracks, clips, a
transform, a mask, keyframes, markers — so there is nothing in a take an
agent cannot then take apart. That rules out the shortcut every other
screen recorder takes, which is to composite the camera into the picture
while recording and hand over one flat file. Much less code, and a dead
end: you cannot move the bubble, resize it, duck the music under the
voice, or cut the camera away for a moment.

Four decisions worth not re-litigating:

**Two files, and which sound goes in which.** A MediaRecorder guarantees
sync inside its own file and nothing across files, so each recorder is
given the picture and the sound that must not drift from each other: the
microphone rides with the camera, system audio rides with the screen.
Put the voice on the screen file and lip sync becomes a thing that can
go wrong. The camera clip is then pushed along the timeline by
`cameraOffsetMs`, measured from both `onstart` timestamps rather than
assumed to be zero.

**Every take goes through ffmpeg before it reaches the timeline.** Not
cosmetic. A raw MediaRecorder file carries no duration in its header and
no cue index, so an `<video>` element reports `duration: Infinity` and
seeking backwards re-decodes from zero. H.264 is preferred for recording
precisely so the remux can be a stream copy; VP9 falls back to a
transcode, which on a long 4K take is minutes rather than a second.

**The auto zoom is not a click stream, and never says it is.** Nothing
in Electron reports a mouse button pressed in another application;
detecting one needs a system-wide event tap, which is a native module
and, on macOS, an invisible Accessibility permission. A feature that
silently produces nothing until you find a switch nobody told you about
is worse than one that says what it measures. So it measures ATTENTION,
from the only signal available: `screen.getCursorScreenPoint()` at 30Hz.
Travel, then stillness. That catches clicks, because a click is preceded
by a settle; it misses a click made without moving first, and the UI
says so. `Alt+Shift+Z` marks a moment by hand, and marks always win.

**The floating bar is a second BrowserWindow, and that is the point.**
The editor window hides during a take, so the bar is the only control
there is — and it is marked `setContentProtection(true)`, which is what
keeps it out of the recording it is controlling. That is also why it
cannot be screenshotted from outside the app, so `debug/capture` takes
`{"window": "recorder-bar"}` and renders it from Electron's own
compositor.

Two things that were found by running it rather than reading it, and
are pinned in `cursorZoom.test.ts` and in the capture code:

  * `track.getSettings()` said 1920x1246 and the encoder wrote
    **1918**x1246. Two pixels, and enough to matter: the canvas is cut
    to the take's aspect ratio so the screen clip can rest at scale 1
    with nothing cropped, and a canvas two pixels wider puts it at
    0.9989 and a one-pixel line of background down two edges. The
    finished file is probed for its real dimensions.
  * `loadProject([], [])` does not clear `mediaPool`, so a new recording
    opened onto the seed project's six demo stills with the take
    somewhere among them. The assembler empties the pool. **The blank
    New project still has this**, and it is a gap rather than a fix.

macOS: screen capture, camera and microphone are three separate TCC
grants. Only the last two have an ask-for API; screen capture is granted
in System Settings and takes effect on the next launch, so the studio
opens that pane rather than pretending it can ask.

---

## 7b. The Tutorial skill, and what it forced

`skills/tutorial/`, one tool (`build_tutorial_from_recording`), and the
second real test of the skill format. Three things it forced are worth
carrying forward.

**A skill can legitimately have no template.** beat-montage ships one so
a fumbled run still leaves a project on the timeline. This one cannot:
the canvas is cut to the recorded display's aspect ratio, so it is not
knowable in advance, and the tool's first act is `loadProject([], [])`,
so any template would be wiped one call later. The floor is somewhere
else and it is better: a `raw` mode, offered in the recorder beside the
skill, that lays the take down with no interpretation. The buyer's worst
case is their own footage rather than somebody else's title card.

**The manifest needed `kind: enum` with an options list**, because a
backdrop with four values and no vocabulary is a free text field that
fails on the fifth character. And `targetClipName` turned out to exist
only to find a slot's clip inside a template, so with no template the
slots are all arguments rather than substitutions.

**The recipe is one step on purpose.** The transcript has to exist before
the camera cuts are placed, and the cuts before the zooms chain around
them. Exposing those as three steps would let a caller run them in an
order that cannot work and call the result a skill.

### What the skill actually does, and the three findings behind it

Zooms are placed on REAL clicks. `uiohook-napi` is a prebuilt N-API
binding, so no compile step and no Electron ABI to match; it is required
lazily inside a try/catch and every failure returns a reason. macOS
throws `UIOHOOK_ERROR_AXAPI_DISABLED` synchronously when Accessibility
is not granted, which is a clean catchable failure and the reason this
was worth building on. Without it the cursor-settle detector runs and
the studio says which one it is.

**It does not use uiohook's coordinates.** libuiohook's space varies by
platform and display scale, which would silently put every zoom in the
wrong place on a Retina screen. `screen.getCursorScreenPoint()` at the
instant of the event is authoritative and is already the space the
cursor track is in.

Three things found by running it rather than reading it:

  * **The pan clamp made the zoom pointless on edge clicks.** Centring a
    point 10% from the frame edge needs a scale of FIVE, so at any sane
    zoom a toolbar click merely got bigger where it was: measured at
    0.13 across the frame before and 0.14 after. The clamp exists to
    stop the project background showing, and with the cinematic backdrop
    behind the picture there is no background to stop — so the travel is
    extended by 16% of the canvas and the same click now lands at 0.30.
  * **The camera took the frame 700ms after a push.** A quiet stretch
    begins when INPUT stops, and the picture keeps moving for a second
    or two after that. `keepClearOfZooms` moves each stretch past the
    zoom that is still in flight; without it the zoom was correct and
    never seen.
  * **The sound assets were never in the pool.** `prepareSoundKit` runs
    before the transaction (it renders audio and writes files), and
    `assembleRecording` empties the media pool right after
    `loadProject` — which happens in between. Five sound clips were
    playing off two pool entries. Registration moved to placement.

### Trials and encryption

`electron/skillTrials.ts` counts runs against the publisher's
`trial.uses`; `electron/vault.ts` seals the ledger with AES-256-GCM
under a random per-install key at 0600.

**A run buys a SUBJECT, not an invocation.** For this skill the subject is
a take, identified by a content hash so moving the folder does not
quietly charge again. Re-applying the skill to footage a run already
covered is free forever, including after every run is spent — so a trial
never takes back what it gave, and the thing that costs is new footage,
which is what a publisher is selling. The one sharp edge: `alreadyGranted`
is a claim READ FROM the ledger, so it is refused when the ledger did not
open. Honouring it there would mean corrupting the file and asserting you
had a run before was enough to get one.

**The other decision this turns on: an unreadable ledger is SPENT, not
fresh.** The natural implementation reads the counter, fails, and falls
back to zero, which makes corrupting the file a reset button and the
whole feature decorative. Ownership is checked BEFORE the ledger is
read, so a corrupt counter can never lock out somebody who paid.

The format and the decision are both pure modules in `src/services/`
precisely so they can be tested without an app: `trialPolicy.test.ts` is
17 checks, and the ones that matter assert that a tampered envelope
fails rather than decrypting to something plausible, that a broken
ledger refuses rather than resets, and that a granted subject does not
survive that refusal.

What this cannot do is written into the code and into the UI rather than
left to be discovered: deleting the ledger resets the count on that
machine, nothing that also lives on that machine could prevent it, and
the durable version is server-side against an account. `licenceKey.ts`
has said the same about signatures since it was written.

A take's `cursor.json` is sealed under the same machinery, and the video
deliberately is not. It is not the video that is sensitive — it is the
sidecar, which logs every cursor position at 30Hz and the timing of
every keystroke. Encrypting the video would mean decrypting it back onto
the same disk before every export, which costs real time and buys
nothing. Take folders are 0700 and their files 0600.

---

## 7c. The reference video, and what a copy of it turned out to be

The ask was "copy the exact flow and feel" of
`~/Downloads/252d89a9da0a6a67df21c59e80013eb7.mp4` — 9.400s, 1280x960,
60fps, 564 frames, a UI mockup drifting in 3D on a bright gradient. The
instruction that made it work was **measure it, do not describe it**,
and the measurement changed what the answer was.

### The headline, and it is a negative

**There is no transition effect in this film.** All three of its cuts
are HARD — one frame each, no blend, no dip, no smear, no flash. The
mean absolute frame difference goes 0.22 -> 47.05 -> 0.85 across the
first, 0.01 -> 34.54 -> 0.34 across the second, 0.01 -> 24.73 -> 0.26
across the third. `analyze_reference_video` finds zero flashes, and the
one "dissolve" it reports at 7317ms is the motion-blurred closing move,
whose frames SIFT confirms are the same content in flight.

`TRANSITION_TYPES` has fifteen entries and the right answer used none of
them. What was actually being asked for was a **grammar**: this film
cuts where the skill pushed.

### Everything that was measured

| | Measured | How |
|---|---|---|
| cuts | 1267 / 3600 / 5333 ms | frame-difference peaks, confirmed against `analyze_reference_video` |
| transition duration | **0 frames, all three** | MAD either side; no intermediate blend |
| shots | 1267 / 2333 / 1733 / 4067 ms, median **2033** | from the cuts |
| beat grid | **not cut to music** | `detect_beats`: 0 real onsets, 1 of 3 cuts on the interpolated grid, which is chance |
| scale at cut 1 | **x2.797** | SIFT + RANSAC similarity, 29 inliers |
| scale at cuts 2, 3 | x0.747, x0.864 — lateral, not deeper | same |
| tilt at each cut | -6.5, +8.7, +8.0 degrees | rotation term of the same fit |
| drift within shots | **-2.9 / +2.7 / +5.0 / +3.4 %/s. Nothing is locked off.** | per-shot trajectory against each shot's first frame |
| the closing move | starts 7267ms, **x2.85 wider**, 50% at 583ms, 90% at 917ms, 98% at 1717ms | every frame matched against the frame it settles on |
| its curve | **cubic-bezier(0.53, 0.47, 0, 1)**, RMS 0.053 | fitted; SETTLE 0.114, PULL 0.135, PUSH 0.164 |
| its blur | 20 consecutive frames a feature matcher cannot place at all | the fit simply drops out for 333ms |
| bookend | **the last frame IS the first**: scale 1.000, rotation 0.001deg, 0.008px, 394/411 inliers | f563 against f0 |
| fades | **none.** head 213.5, tail 213.4, against a mean of 225.7 | mean luma |
| grade | high-key 227.6, flat 37.9, desaturated 11.6, neutral 7000K, blacks lifted to 109, highlights clipped | `analyze_reference_video` |
| backdrop | three-corner mesh: #95a0e8 TL, #f1b3aa TR, #e9ebfa across the bottom | least squares over the 35% of the frame the mockup does not cover |
| inset | the mockup fills **84.1%** of the frame width | largest bright low-saturation region |
| corner radius | **not measurable from this file** | the surface is in perspective in every frame where its outline shows, so the arc is a projection of the tilt |

**Every estimator was self-tested before it was believed.** The scale
measurement recovers a synthetic x1.25 / x1.55 / x2.00 / x3.00 zoom
exactly. Two that did NOT survive their self-test were thrown away: a
Fourier-Mellin radial-profile shift (returned 1.000 for every truth,
because detrending a near-power-law spectrum leaves only scale-invariant
window artefacts) and a brute-force scale-plus-phase-correlation search
(residual 29.5/255 at cut 1 — correctly reporting that the two frames
are not related by any 2D similarity, which is itself the finding about
the perspective).

### What it became, and it is numbers

`CUT_SHAPE` in `cursorZoom.ts`, `planCuts` beside `planZoom`, and
`TUTORIAL_ASSEMBLE.zoomShape` pointing at it. Three fields were added to
`ZoomShape` — `cutIn`, `driftPctPerSec`, `closeMs` — and one curve,
`CLOSE_CURVE`. `DEFAULT_SHAPE` is untouched, so the pushing grammar and
its 33 tests are exactly as they were.

**A cut needed nothing new in the format.** It is two keyframes with
`hold` easing on the first: `applyEasing('hold')` returns 0 for the
whole span, so the outgoing value stands until the incoming keyframe and
then jumps. The EDL had always been able to say this and nothing had
ever emitted it.

Three decisions inside `planCuts` that are judgement rather than
transcription:

* **Cutting back to rest has to buy a whole rest shot.** The reference
  cuts close-to-close three times and only opens out at the end, so a
  rest stop is only inserted when there is `holdMs` of room for it.
  A looser rule gives a one-second flash of wide between two close
  shots, which is the cutting grammar's version of the bounce
  `planZoom` exists to avoid.
* **The drift is capped at 12%.** Measured at 3%/s it is right for a
  two-second shot and compounds absurdly over a sixty-second one.
* **`restByMs`.** The closing move is 2100ms and the cinematic dip to
  black is the last 620ms. Without a separate "be at rest by" the film
  fades out in the middle of a camera move.

### Two things it found by being run

**Motion blur was smearing the cuts, and it is fixed in the compositor.**
`shutterMs` is sampled symmetrically around the playhead, so a cut
inside that window rendered as a one-frame 50/50 dissolve of the two
framings — measured at 1.87% green where the shot either side reads
2.22% and 16.28%. `shutterWindow` in `compositor.ts` now pulls the
interval in to the nearest `hold` boundary. The test is exact rather
than a threshold on how fast a value is moving, because a steep linear
ramp is not a cut and must still blur.

**`verify.py --selftest` had been broken since it was written**, and at
HEAD as well as here. Its section 8 rebuilds the project WITHOUT `raw`
to check the transcription branch, so from that line on the raw control
was measuring a full tutorial assembly. `the film opens from black` had
been reporting "STILL PASSED, proves nothing" on a build where the raw
assembly genuinely has no fade. The rebuild is skipped under
`--selftest` now, and the controls are 14/14.

### What was measured and deliberately NOT copied

* **The bright backdrop is offered, not defaulted.** `daylight` is the
  two-stop linear fit, 8.2% RMS off the real mesh, labelled as such in
  the code. A screen recording is mostly bright UI and a bright backdrop
  competes with it; the reference gets away with it because its subject
  is a render, not somebody's desktop. One reference video is not
  evidence about arbitrary footage.
* **`insetPct` stays 92, not the measured 84.** That figure is a 4:3
  mockup in a 4:3 frame. A 16:9 capture inset to 84% wastes a lot of
  canvas.
* **The fades stay.** The reference has none. A tutorial that starts
  mid-frame is not obviously better, and this is a taste call the
  reference does not settle.
* **The 3D tilt is not reproducible** and is in the gap log, with the
  mesh gradient and with the "not cut to music" finding.

`leadMs` is the one number in `CUT_SHAPE` carried over unexamined, and
deliberately: the reference has no input events in it, so it says
nothing about how far ahead of a click to cut.

---

## 7d. The backdrop, the shadow, and two bugs the backdrop found

The ask was "a background just like Recordly and the other screen
tutorial platforms, nice clean bg". What that turned out to need was one
renderer feature, two number changes, a shadow that had been recorded as
impossible, and two rendering bugs that only became visible once the
backdrop stopped being nearly black.

### Mesh gradients, because a ramp always looks like a ramp

`shapeStyle.gradient` was two stops and an angle. It now also takes
`stops` (extra colours along the axis) and `blobs` (soft radial washes
over the base), both optional, so every project written before them
means exactly what it did.

`blobs` is the one that matters. What Screen Studio, Recordly and Tella
actually ship is not a two-stop ramp — a ramp has a visible direction and
a flat middle — it is two or three washes of colour pooling in the
corners of a near-white field. And the reference video from §7c is
itself a three-corner mesh: indigo `#95a0e8` top left, coral `#f1b3aa`
top right, near-white `#e9ebfa` across the bottom.

Fitted to the 35% of its opening frame the mockup does not cover:

| model | RMS against those pixels |
|---|---|
| the two-stop linear that shipped in §7c | 20.9 / 255 (8.2%) |
| base gradient + 1 blob | 5.8 (2.3%) |
| **base gradient + 2 blobs** | **3.8 (1.5%)** |
| base gradient + 3 blobs | 3.5 (1.4%) |

Two blobs, because the third buys 0.1% and a preset nobody can read.

**The first fit was thrown away and it is worth saying why.** It
normalised the gradient axis its own way and produced an angle that would
not have transferred: canvas projects a linear gradient perpendicularly
onto the segment `(-cos·w/2, -sin·h/2) → (cos·w/2, sin·h/2)`, which for a
non-square box is weighted by w² and h² rather than by cos and sin.
Fitting a model the renderer does not implement is how you get a number
that measures well and looks wrong.

Eight presets now: five light — `daylight` (the measured one), `linen`,
`blossom`, `lagoon`, `dusk` — and the three dark ones, unchanged.

### The default is light now, and that was a judgement, not a measurement

The old comment said a screen recording is mostly bright UI so a backdrop
with colour in it competes. Still true, and still the reason the dark set
exists. It was wrong as a DEFAULT: a light backdrop reads as paper behind
a screen, a dark one reads as a video player with a small video in it.

Three other numbers moved with it, and the first is measured:

* **`insetPct` 92 → 84.** The mockup in the reference fills 84.1% of its
  frame's width. 92 is a hairline, and a backdrop nobody can see is not
  a backdrop.
* **`cornerPct` 1.8 → 2.6.** Not measured — the reference is in
  perspective wherever its outline shows. Set against the light
  backdrops, where 1.8 read as a square-cornered screenshot.
* **`vignette` 10 → 0.** On a dark backdrop it holds the eye in. On a
  light one it puts grey smudges in the corners of a white app window
  while the frame around it stays bright, which reads as a fault.

### The shadow, which §7a said could not be had

§7a recorded that a drop shadow was the obvious fifth item and could not
coexist with the rounded corners, because `applyMask` calls `ctx.clip()`
before the layer is drawn. **That is true of a shadow cast by the
CONTENT, and it is the wrong thing to cast one from.** The mask's own
outline can cast it, before the clip.

Filling that outline in place does not work either, and the reason took a
frame to see: the fill has to be OPAQUE for the shadow to be at full
strength, and the picture is then drawn over it at whatever `globalAlpha`
is in force — which under motion blur is not 1. A white app window came
back at rgb(150,150,150). So the outline is traced a long way off the
canvas and `shadowOffsetX` brings the shadow, and only the shadow, back.
Canvas shadow offsets and blur are in DEVICE space and are not touched by
the current transform, hence the scale factors read off it.

`ClipMask.shadow` is optional, so nothing written before it changes, and
`LookOptions.shadow` (0..100, default 34) drives it from the look.

### Motion blur was making every blurred clip 32% transparent

The single worst thing here, invisible for as long as the backdrop was
near-black, and obvious the moment it was not: the backdrop was showing
THROUGH the picture, everywhere, whenever motion blur was on — which the
tutorial skill turns on whenever there are zooms.

The samples were drawn onto the frame at `globalAlpha = 1 / samples`
each. That is not an average. Source-over is `src + (1 − srcAlpha)·dst`,
so four draws at 0.25 leave the layer **68.4%** opaque and twelve at
1/12 leave it 64.8%. It reads as a washed-out grade rather than as
transparency, which is why it survived.

**A running mean, `1/(i+1)` into a transparent layer, was the second
attempt and was also wrong** — right in the middle of the smear and wrong
at both ends, because `globalAlpha` scales the SOURCE, so where a sample
is transparent the destination is not attenuated at all. The trailing
edge, covered only by the first sample at alpha 1, stayed fully opaque
forever. Measured on a bar moving 36.7px per shutter: the leading edge
ramped 251 down to 0 across 19 pixels and the trailing edge went 0, 33,
255 in two.

What works is additive accumulation of ISOLATED samples: each sample
rendered alone at full opacity into one scratch layer, then added into
another at `1/samples` with `lighter`. Premultiplied colour and alpha
both add. The isolation is not optional — `lighter` applied to a clip
that draws more than once, a shape with a stroke over its fill, would add
the overlap to itself.

Proved by compositing the same take on a light and a dark backdrop and
comparing the picture's interior: **0.00 / 255** apart.

### And `verify_tools` was passing on that bug

`set_motion_blur softens motion` required `edges(blurred) < edges(sharp)
* 0.85`, where `edges` is a mean of horizontal differences. **That metric
is blind to blur**: smearing a step over 37 pixels replaces one
difference of 255 with 37 averaging 7, and the sum over a fixed frame is
unchanged. On a synthetic bar, mean |diff| after a 37px blur is 100.0% of
sharp.

The only thing that ever moved it was the 64.8%. The check was reporting
soft motion on a translucent clip.

It measures the steepest step now, as the mean of the 256 largest
horizontal differences, and it has a control beside it that the paint
stays as bright as it was. 233.8 → 22.0 with the brightest paint holding
at 253. A percentile was the first attempt and was wrong for its own
reason: the probe square's two vertical edges are 480 pixels of a
2-megapixel frame, 0.02%, well inside a 99.9th percentile's tail, so it
read 4.0 on a hard white-on-black edge.

### The suite's own colour test had the same shape of problem

`mask_for` in `skills/tutorial/verify.py` identifies the recording by
which channel dominates by 40. A coral corner is red-dominant by that
test, so the share of the frame edges reading as "the recording" went
from 0% to 16% against a threshold of 20% without one pixel of recording
moving. Still passing, no longer measuring what it says.

Every colour in that fixture is dark and saturated — darkest channel 48.
The miscounted backdrop pixels have a darkest channel of 180 to 197. The
bound is 130, and it is ONE-SIDED so it cannot undo the lesson that put
the hue test there: every grade in this skill darkens, and darkening only
lowers the darkest channel. There was also a second, inline copy of the
test, which is why the edge check did not move when `mask_for` was first
corrected.

---

## 7e. Opening on the face

If a take opens with somebody introducing themselves, the camera takes
the whole frame for the whole introduction and hands it back when the
work starts. `detectIntroduction` in `recordingProject.ts`,
`cameraOnIntro` in `AssembleOptions`, on by default for the skill.

**The whole difficulty is being SURE**, because the two failure
directions are not symmetric. Missing an introduction costs nothing — the
camera stays an inset, which is what the skill did before. Inventing one
covers the screen with somebody's face while they are showing you the
thing you came for. So it takes three independent kinds of evidence:

1. **Behaviour, which can veto on its own.** A click, a keystroke or a
   scroll means the person is working, whatever they are saying. This
   does not depend on the transcript being any good, and it is what ends
   the introduction as well as what refuses it.
2. **Shape.** Starts within 2s, runs continuously (gaps under 1.2s), at
   least 2.5s long, at least 60% spoken over, capped at 45s.
3. **Words.** Greeting, self-identification, framing of what is coming —
   **two of the three kinds**, because any one alone is ordinary speech.
   "Today" is not an introduction and "hi" is not an introduction, and
   both together nearly always are. Saying your own name counts as two.

And one veto on the words: pointing at the screen. "Here you can see",
"as you can see", "over on the left" — somebody doing that is looking at
the picture even if they have not touched the mouse yet.

Every marker is a phrase somebody says out loud, so this fails on a
language it has no markers for rather than guessing, and failing means
the camera stays an inset.

Three consequences worth knowing:

* **The camera opens ALREADY full frame.** `addCameraMotion` settles the
  inset into place over 420ms, so a take that opens on a face would have
  shown the inset growing and then immediately expanding — a move in the
  wrong direction followed by a move to undo it. The pose at time zero is
  the full frame instead.
* **The introduction bypasses the pause filters, deliberately.**
  `findQuietStretches` reads the POINTER and would not find somebody
  sitting still and talking; `alignToSpeech` trims a stretch inward to a
  gap between sentences, which is exactly wrong for an opening that
  should start on the first frame.
* **Zooms inside it are dropped.** They would be invisible, and they
  would still put a marker on the timeline and a whoosh on the sound
  track for a move nobody can see.

### `transcript.json`, and why it is not a test hook

A take folder may now carry `transcript.json` — `[{startMs, endMs,
text}]`, or the `{segments: [...]}` shape Whisper returns — and it is
used instead of transcribing. A scripted tutorial has its words written
down before it is recorded.

It is also what makes any of this checkable. The parts of the skill that
read the WORDS cannot be verified end to end if the only way to get words
in is a machine-dependent speech model. `verify.py` builds two takes that
are identical in footage, timing and cursor track and differ only in what
is said over them: one is introduced, one points at the screen. The first
opens on the camera at 95% of the frame and hands it back by 11.8s; the
second reports `introductionMs=0` and opens on the screen. Neither can
pass by liking the start of takes.

Note the ordering bug fixed alongside: `build()` called
`assembleRecording` with `speech` AFTER `...options`, so a caller-supplied
transcript was overwritten by the empty local.

---

## 7f. What a real take found that synthesised pixels could not

§7e was verified against fixtures with known colours, which is the right
gate and caught nothing here. One 69-second take of somebody actually
introducing themselves found six things, and each was invisible to a
fixture because each depended on a property real takes have and
constructed ones do not.

### The camera could never fill the frame on the machine this was built on

`cameraCanFillFrame` had a single ceiling of 1.35, justified against a
720p camera in a 1080p sequence needing 1.5. The ordinary case fails it:
a 1080p webcam with a Retina display captured at 2560x1662 needs **1.54**
and is refused. So the camera takeover — and, once it existed, the
introduction — were both silently off for most users.

The ratio was the wrong test. What makes an enlarged picture soft is how
much REAL detail is behind it, and a ratio only says that when the source
size is fixed: 720p stretched 1.5x delivers 720 lines, 1080p stretched
1.54x delivers 1080. It is two limits now, and a 720p camera still cannot
fill a 2560 frame, which is the case the original rule was written for.

### The pointer was ignored whenever the input hook worked

`findQuietStretches` took activity as real input **or** pointer travel,
never both. On a machine with the hook — the good case — moving the mouse
around a dashboard pointing at things without clicking counted as a quiet
screen, and the camera would take the frame over exactly the moment
somebody was showing you something.

Reported as: "detect when I'm explaining stuff rather than instructing
things on the dashboard, where my mouse has not moved." It is the union
now, and `minQuietMs` is 5000 rather than 2600: two and a half seconds of
stillness happens constantly while working, and five seconds of a parked
pointer with a voice over it is somebody talking rather than pointing.

### An introduction died on one stray click

The rule was "the first thing done on screen ends the opening". The real
take's events: an isolated click at **204ms**, another at 21804ms, and
the actual work starting at 30725ms with a click and a scroll burst 1.5s
later. The 204ms click is a window being focused. Work is SUSTAINED input
now — an event with another within 2.5s — and a lone click is not work.

### Pointing at the screen threw away the introduction instead of ending it

The take opens in Swahili and switches at 25.3s to "As you can see, we
have a couple of integration options". `POINTING_AT_SCREEN` vetoed the
entire opening on the strength of what was said afterwards. It truncates
now, and only vetoes when it is the FIRST thing said, which is a take
that never introduced anything.

### Every word marker is English, and the take was not

Requiring markers makes this an English-only feature. Behaviour and shape
do not have that problem, so an opening of 8s or more, spoken
continuously with nothing done on screen, is now taken as an introduction
without any marker at all. Nobody talks for eight uninterrupted seconds
at the very start of a screen recording, over a screen they are not
touching, for another reason — and if they are narrating the screen, the
pointing test still catches it.

### And the transcript was missing 25 seconds, silently

The deepest of the six. `ggmlNameFor` appended `.en` unconditionally,
because "narration for a screen tutorial is overwhelmingly English".

An `.en` model handed Swahili does not transcribe it badly. It returns a
single `(speaking in foreign language)` marker for the whole stretch.
That marker is then correctly filtered out of the captions by
`transcribe.ts` — nobody wants a line reading "[Music]" — and with it
went any evidence that 25 seconds of narration had ever existed. Every
layer above saw a take whose first words were at 25.3s, and the
introduction detector refused, correctly, on a transcript that was wrong.

Proved rather than guessed. The audio is not the problem: the first 25s
measures RMS -23.2 dB with a -70 dB noise floor, an SNR of 46.7 dB,
against 44.0 dB for the part that transcribes fine. Forced to `-l sw`,
the same whisper.cpp binary returns continuous speech across the whole
opening.

Three changes: `.en` weights now have to be ASKED for and `auto` gets the
multilingual ones; `language` is exposed on the skill and the tool; and
the dropped markers come back on `TranscribeResult.nonSpeech` so the
skill can say "25s of this take made sound that Whisper produced no words
for" instead of nothing.

### The result on that take

Before: `introductionMs 0`, camera an inset throughout. After: **24.0s**
of introduction, the camera taking the frame for it, and the two zooms
that would have played underneath it dropped.

### And a wrong conclusion, retracted, with the trap that caused it

I reported in the first version of this section that the camera clip
"composites black" and wrote it into NEXT.md as the next job. **It does
not, and it never did.** The user said so, and they were right.

Every measurement behind that claim was taken through
`get_frame_context` while the app was sitting on the HOME SCREEN, with
the editor and its preview unmounted. What comes back then is not a
composite of the timeline, and — this is the part that made it
convincing — **it comes back with `mediaPending: 0`**, which is the flag
this whole repo's suites wait on precisely so they never measure a
frame that has not decoded.

Two readings were wrong in the same direction:

* The camera measured `mean rgb [0.2, 0.2, 0.2]`, which I called the
  placeholder gradient. The placeholder is `#14161c` to `#1d222b`, so a
  frame of it means about **25**, not 0.2. 0.2 is nothing being drawn at
  all.
* The screen clip measured `[25, 24.9, 31.5]` in the same captures and I
  called it "renders fine, so the camera is the odd one out". 25 IS the
  placeholder. Both clips were undrawn; only one of them was undrawn in
  a colour I recognised.

With the editor mounted, the same project at the same timecodes:
`[131.4, 105.2, 109.9]` at 2s, 12s and 22s — skin tones, full frame —
and `[206.4, 204.5, 211.9]` at 40s, the screen on the light backdrop.

**So: `get_frame_context` is only meaningful with the editor mounted, and
it does not say so.** That is the same family as §3c's "`debug/capture`
was showing the wrong frame, silently", and it is worse, because
`mediaPending` is the specific guard that exists to stop this and it
reads clean. Every suite in `tools/` happens to run against an instance
that is in the editor, so nothing has ever caught it. It is in the gap
log; the fix is for the frame envelope to report that the editor is not
mounted rather than returning a frame that means nothing.

The lesson for the next person is cheaper than the bug: **a number that
disagrees with what the user can see on their own screen is a broken
instrument until proven otherwise.** I spent a long time re-encoding a
video file that was fine.

---

## 8. Product hardening — mostly not started

The roadmap in §5 is about capability. This is about being software
people can rely on, and it is largely unbuilt. Ordered by consequence:

**~~There are no automated tests. None.~~ — done.** `npm test` runs 167
unit tests with no app; `npm run verify` boots its own Kerf and runs 295
checks across twelve suites, exiting non-zero. All six regressions named
below are in `tools/verify_hardening.py`. What follows is kept because
the reasoning is still the right reasoning. Six audit passes found code that lied, every fix was
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

**~~No crash or error reporting.~~ — done.** Main's uncaughtException
and unhandledRejection, render-process-gone, child-process-gone,
did-fail-load, unresponsive, renderer console.error, window.onerror,
unhandled rejections and a React error boundary all land in
`userData/logs/kerf.log`. Nothing is uploaded — that is a product
decision with privacy consequences and belongs to whoever ships it.

**~~Project format has no migration.~~ — done** (§3b). Refuses a file
from a newer Kerf, migrates an older one, and says which.

**Windows and Linux are unexercised.** CI builds them. Nobody has run
them.

**~~No performance work.~~ — measured**, and it found an O(n^2): every
commit deep-cloned the whole timeline for the undo history, so building
400 clips took 2.4s and leaked 48MB. Now linear, 277ms, flat heap.
`tools/measure_scale.py` reports the exponent rather than milliseconds.
**4K playback is still unmeasured** — the tool covers clip count, not
resolution.

**No onboarding.** First-run for someone who has never edited.

**The editor-close intercept is unverified** — see §7. It is standard
Electron, but the test path did not exercise it.

**The commercial layer has a spine now** — see §13. Accounts, the
catalogue, entitlements, signed licences and Lipia mobile-money payment
are built and verified (`server/`, 33 checks). Still absent: package
publish, payouts and the seller side, refund initiation, and a reconcile
cron. Distribution and updates remain unscoped.

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

### CI, and what each platform's green tick is actually worth

Two workflows. They are not equally trustworthy and the difference is
the point.

`.github/workflows/gate.yml` — `yarn typecheck` and the 167 unit tests,
on macOS, Linux **and Windows**. None of it needs a display, an audio
device, ffmpeg or a running app, so it is a hard gate on all three from
day one, and it is the job that gates PRs.

`.github/workflows/verify.yml` — the twelve live-app suites, 324 checks,
`workflow_dispatch` only. Per platform:

| | status | what a green tick means |
|---|---|---|
| **macOS** | **proven** | It has run on a runner and was green. It answered its own two unknowns: a runner DOES give Electron a window (RPC in 7.9s), and `verify_gpu` DOES get a real WebGL2 context (26/26). |
| **Linux** | **wired, never run** | Written from documented xvfb/Electron behaviour, not from a run anybody watched. Expect SwiftShader; that is fine, because those checks assert what the picture looks like, not how fast it arrived. |
| **Windows** | **blind** | **Nobody has ever run Kerf on Windows.** The suite step is `continue-on-error`, so a green tick means "the attempt ran and the logs were kept". It does NOT mean the app works, and must never be written up as if it did. |

Windows could not be attempted *honestly* until three POSIX-only things
in `run_all_suites.py` were fixed, none of which would have failed
loudly:

- `os.killpg`, `os.getpgid` and `SIGKILL` do not exist on Windows, so
  teardown raised `AttributeError` and left an Electron holding the port.
  `taskkill /T` walks the child tree the way `killpg` walks the group.
- `'file://' + os.path.join(...)` yields `file://C:\...\index.html` —
  backslashes, one slash short — which Chromium will not load. `--built`
  would have died on a path bug and looked like a real result.
- `SO_REUSEADDR` means the OPPOSITE thing on Windows: it permits binding
  a port that has a live listener, so the free-port probe called every
  busy port free. `SO_EXCLUSIVEADDRUSE` asks the intended question.

`KERF_ELECTRON_ARGS` passes flags to the child, so Linux CI can run
`--no-sandbox` (Ubuntu 24.04 restricts the unprivileged user namespaces
Chromium's sandbox needs) without a developer machine losing its sandbox
to a hardcoded flag in `main.ts`.

There is no container runtime on the maintainer's machine (`lima` is
installed, no VM), which is why Linux is wired rather than run. A Lima
VM is the local route to closing that.

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

## 13. The store — accounts, entitlements and Lipia

`server/` is a Cloudflare Worker (D1 + R2). Its README is the runbook;
this is why it is shaped the way it is.

**A server was not a choice.** Three independent reasons, any one
sufficient: Lipia's `callback_url` is a webhook and a desktop app has no
public URL; the Lipia key pair is a bearer secret and Kerf ships as
source; and entitlement has to live somewhere the buyer cannot edit.

**Kerf is a Lipia tenant**, like DukaBot and M-Digital. Lipia
(`pay.mhasibudigital.com`) wraps Selcom and owns the merchant
credentials and the static-IP proxy Selcom's whitelisting needs, so
nothing in `server/` knows what Selcom is. The contract was read off
Lipia's own route handlers rather than its docs page:
`POST /api/v1/charge` takes `{amount, currency, method, provider,
customer_msisdn, metadata, idempotency_key}`, and the callback arrives
signed `X-Lipia-Signature` with `metadata` echoed back verbatim — which
is the join between a Lipia transaction and a Kerf order.

**Sign-in is a device flow, proxied.** Kerf polls the Worker; the Worker
polls Google or GitHub. That keeps the OAuth client secret server-side,
makes the account row a side effect of an exchange we performed rather
than a token the client handed us, and lets the poll interval be
enforced where one buggy desktop cannot burn everyone's quota.

**Licences are signed, short-lived and verified on the client.** ECDSA
P-256, 30 days, checked by `src/services/licenceKey.ts` against a public
key compiled into the app — so a bought skill opens on a laptop with no
connection, which in this market is the normal case. Ed25519 would be
smaller and was rejected: WebCrypto support for it is recent enough that
a signature the server can make and the renderer cannot verify would
lock out a paying customer.

The expiry IS the revocation. A signed token cannot be recalled, so a
refund stops the next licence being minted rather than killing the one
in hand. That trade is deliberate and it is stated in the code.

**What the verification suite is built to catch** (`node verify_store.mjs`,
33 checks): a licence that does not verify under the key the client
actually ships; a licence edited to name another skill; an unsigned or
wrongly-signed callback granting anything; a REPLAYED callback granting
twice, which matters because Lipia retries on a 1m/5m/30m/2h/12h ladder;
and an underpayment — 100 against a 5000 order — being fulfilled.

**The client side** is `src/services/storeClient.ts` (portable, `fetch`
only), `src/store/accountStore.ts` (three-valued: `unknown` is not
`signed_out`), and the store UI in `src/components/home/`. The session
token is held at 0600 by main in `electron/storeSession.ts`, not in
localStorage — the app already keeps agent API keys that way and a
second, weaker standard for the same kind of secret is how one of them
ends up wrong.

**Prices live in the catalogue, not in `skill.json`.** A price changes
without the skill changing, and a price baked into a package is a price
you cannot correct. Entitlement is per MAJOR version, per §6.

**The publish gate is a CHECK constraint.** §6 says "if it does not run,
it does not publish"; that was a comment in the schema, and a comment is
not an enforcement. `CHECK (status != 'published' OR verified_at IS NOT
NULL)` cannot be routed around by any code path or forgotten by any
future admin screen.

**The dev signing key is trusted in DEV BUILDS ONLY, and the first
version of that got it wrong.** Listing both keys as trusted would have
shipped a build accepting licences signed by a key whose private half is
generated by a script in this repo and printed to a terminal — anybody
could have minted themselves any skill. `trustedKeys(isDev)` takes a
boolean rather than reading `import.meta.env.DEV`, precisely so a test
can ask for the production answer; a check that can only observe the
environment it runs in cannot fail in the case that matters.

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
