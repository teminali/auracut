# AuraCut — handover

An Electron video editor whose Copilot drives a coding CLI as its agent.
Read this whole file before touching anything. Several traps below cost
hours and are invisible from the code.

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
| **Beats** | Anchored to detected onsets, not a synthesised grid. 119.8 BPM on a 120 BPM source, zero drift. |
| **Silence** | Measured with ffmpeg `silencedetect`, with a `dryRun`. |
| **Copilot** | Multi-backend picker: Claude Code, Codex CLI, Gemini CLI, Cursor Agent. Claude + Codex verified end to end. |
| **Assets** | 183 system fonts, 12 synthesised SFX, search on every panel, 14 transitions, 23 effects, 10 looks. |

**53 tools**, 4 agent backends. Both the renderer and the main process
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
tools as `mcp__auracut__*`, called `describe_timeline` through the shim
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
2. **A test suite**, starting with regressions for the six findings
   (§8). This is also the skill-verification harness — build it once.
3. **Crash and error reporting**, so you stop learning about failures by
   looking for them.
4. **Project migration** — `version` is written and never read.

### Stage 2 — Make it trustworthy  *(1–2 weeks)*

5. Finish the audit: the seven tools listed in §3.
6. Run Windows and Linux. CI builds them; nobody has.
7. A performance pass — long timelines, many clips, 4K, memory over a
   long session. All currently unmeasured.

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
10. **The ffmpeg bridge** (`ffmpeg_process`) — stabilise, interpolate,
    denoise, custom filtergraph, rendered to temp and auto-imported.
    Buys a large slice of "impossible" cheaply.

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

14. **The GPU stage** — WebGL2/WebGPU in `compositor.ts`, wiring the
    dead `shaders.ts`. Chroma key, warps, displacement, real motion
    blur. Keep the 2D path as fallback.
15. **Per-clip audio** — `pitch`, `voiceEffect`, `noiseReduction`,
    `ducking` on both the playback graph and the export filtergraph.

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

- **Repo:** https://github.com/teminali/auracut (public) · `v1.1.0`
- **Stack:** Electron 34 + React 19 + TypeScript + Vite + zustand + Tailwind
- **Renderer** owns the project (zustand stores). **Main** owns the OS.
- Desktop only, and deliberately — see §6.

```
src/
  components/   UI by region (header, sidebar, preview, timeline, inspector, copilot)
  engine/       compositor, video, audio, effects, export, fonts, SFX, tone curves
  store/        zustand — the single source of truth
  mcp/          toolRegistry.ts — the 53 tools the agent drives
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
because all four CLIs speak it, the 53 tools are written once and every
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
| `shaders.ts` | 90 lines of WebGL2 GLSL that **nothing imports**. The ceiling on VFX. |
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
  hosting, verification runs on every AuraCut release, payouts,
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
5. **The verification fixture stored with the skill**, so every skill in the store can be re-run against a new AuraCut build before shipping. That turns "did I break anyone's skill?" into a test suite.

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
AuraCut's capability is not a grid; it is a conversation and a set of
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
app too.** `open -n AuraCut.app` from a VS Code terminal launches it as plain
Node: exit 0, no window, no port, no log — indistinguishable from the
signing failure below, and it will send you hunting the wrong bug. Use
`env -u ELECTRON_RUN_AS_NODE open -n path/to/AuraCut.app`.

**That same forwarding makes `open` a bad Finder simulation.** The app
inherits your developer PATH, so anything that depends on a minimal
environment — every agent backend — passes when it would fail for a real
user. To test the actual condition:

```bash
env -i HOME="$HOME" USER="$USER" SHELL=/bin/zsh TMPDIR="$TMPDIR" \
    PATH=/usr/bin:/bin:/usr/sbin:/sbin \
    open -n release/mac-arm64/AuraCut.app --args --remote-debugging-port=9333
```

**Drive the packaged renderer over CDP.** `--remote-debugging-port` plus
`Runtime.evaluate` is the only way to ask the packaged app a direct question
(`window.electronAPI`, a font query, `document.visibilityState`). Pick a port
nothing else holds — Chrome sits on 9222, and reading *its* target list by
mistake will show you a `localhost:5173` tab titled "AuraCut" and convince
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

**Verify installs by version, not by exit code.** A `/Volumes/AuraCut*` glob
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

## 11. Release

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
