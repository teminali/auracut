# Kerf

An open-source, non-linear video editor for the desktop, with the Model
Context Protocol wired through the whole application. Every edit the UI can
make, an agent can make too, through the same store.

macOS · Windows · Linux · Electron + React + TypeScript

---

## Install

Download the build for your platform from
[Releases](https://github.com/teminali/kerf/releases/latest).

| Platform | File |
| --- | --- |
| macOS (Apple Silicon) | `Kerf-<version>-arm64.dmg` |
| macOS (Intel) | `Kerf-<version>-x64.dmg` |
| Windows | `Kerf-Setup-<version>.exe` |
| Linux | `Kerf-<version>-x64.AppImage` |

### Installing a locally built copy

`yarn package:mac` writes `release/mac-arm64/Kerf.app`. Copy it with
`ditto`, not `cp -R`, so bundle symlinks and permissions survive:

```bash
ditto release/mac-arm64/Kerf.app /Applications/Kerf.app
```

**Do not leave an old copy beside it.** Renaming the previous install to
`Kerf.app.bak` rather than deleting it puts TWO bundles with the
identifier `com.kerf.editor` in `/Applications`, and LaunchServices then
refuses to open either from Finder. `open` exits 0, nothing starts, and
nothing is logged. The app itself is fine, and running the binary
directly proves it:

```bash
env -u ELECTRON_RUN_AS_NODE /Applications/Kerf.app/Contents/MacOS/Kerf
```

If you hit it, remove the duplicate and re-register:

```bash
rm -rf /Applications/Kerf.app.bak-*
/System/Library/Frameworks/CoreServices.framework/Frameworks/\
LaunchServices.framework/Support/lsregister -f /Applications/Kerf.app
```

Note that `spctl --assess` reports **rejected** for these builds and
always will: the signature is ad-hoc, with no team identifier. That is
not what stops it launching, and it is not a fault to chase.

### First launch on macOS

Current builds are **not notarised by Apple**, so Gatekeeper refuses the first
open. On macOS 15 and later the old right-click → **Open** escape hatch is
gone, so clear the quarantine flag instead:

```bash
find /Applications/Kerf.app -print0 | xargs -0 xattr -d com.apple.quarantine
```

(`xattr -r` does **not** work. MacOS 26 removed the `-r` flag.)

---

## Updates

Kerf checks for updates 8 seconds after launch and every 6 hours after
that. Nothing is ever installed behind your back: an update downloads in the
background, and a **Restart to update** button appears in the title bar. You
choose when to take it.

**Windows and Linux update themselves.** **macOS currently does not** ,
Squirrel.Mac will not apply an update whose code signature it cannot verify,
and these builds are unsigned. Rather than fail silently forever, the macOS
build detects this and shows a **Get \<version\>** button that opens the
download page instead.

That is a distribution problem, not a code one. Add an Apple Developer ID to
the repository secrets and the same code path starts working with no changes:

| Secret | Purpose |
| --- | --- |
| `CSC_LINK` | base64 of your `.p12` Developer ID certificate |
| `CSC_KEY_PASSWORD` | password for that certificate |
| `APPLE_ID` | Apple ID used for notarisation |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | your 10-character Apple team ID |

The release workflow detects `CSC_LINK` and stamps `KERF_SIGNED=1` into the
build, which is what flips the app from "tell the user" to "just update".

---

## Recording the screen

**New project** on the home screen offers two starts: a blank timeline, or
a take. The recorder captures a display (or one window) and your camera at
the same time, and lands them on the timeline as an **edit rather than a
render**.

That distinction is the whole design. Most screen recorders composite the
camera into the picture while recording and hand back one flat file, which
is a dead end: you cannot move the bubble, mute the beeps under your voice,
or cut the camera away for a moment. Kerf writes two files at full
resolution and arranges them:

| | |
| --- | --- |
| **V1 · Screen** | the display, full frame, resting at scale 1 |
| **V2 · Camera** | a rounded inset, sized from the camera's own aspect ratio so nothing is stretched |
| **A1 · Narration** | your microphone, split onto its own track, so cutting the camera does not cut your voice |

The canvas is cut to the display's real aspect ratio, so a 16:10 laptop is
neither cropped nor letterboxed.

**Sound is paired with the picture it must not drift from.** A
MediaRecorder guarantees sync inside its own file and nothing across files,
so the microphone rides with the camera and system audio rides with the
screen. Put the voice on the screen file instead and lip sync becomes a
thing that can go wrong. (System audio is a Windows loopback device; macOS
has none without a third-party extension, and the recorder says so rather
than recording silence.)

### While it runs

The editor window hides and a small floating bar takes over: timer, pause,
mark, stop. It is a separate always-on-top window marked
`setContentProtection(true)`, which is what keeps it out of the recording it
is controlling (macOS and Windows; on Linux it will appear in the take, and
the recorder warns you). **Alt+Shift+R** stops and **Alt+Shift+P** pauses,
from anywhere.

### Where takes live, and what is encrypted

Takes are written straight to `~/Movies/Kerf Recordings/<timestamp>/` as
they record, chunk by chunk, so memory stays flat however long you run. The
folder is `0700` and the files inside it `0600`, so no other account on the
machine can list or read them.

`cursor.json` is **sealed** with AES-256-GCM under a random per-install key
held at `0600`. It is not the video that is sensitive: it is the sidecar,
which logs every cursor position at 30Hz and the timing of every keystroke
of the session. That is a recording of how somebody works, in a file that
otherwise gets copied and backed up as plain JSON.

The video is deliberately **not** encrypted, and that is a decision rather
than an omission. A `<video>` element has to open it to preview and ffmpeg —
a separate process — has to open it to export, so encrypting it would mean
decrypting the whole file back onto the same disk before every render. It
would cost real time and buy nothing.
They are remuxed to MP4 before reaching the timeline: a raw MediaRecorder
file carries no duration and no seek index, so a `<video>` element reports
its length as `Infinity` and seeking backwards re-decodes from zero. That
is not editable footage.

macOS asks for screen recording, camera and microphone access separately.
The recorder reports each one and opens the right settings pane rather than
failing into a black stream.

> **Updating Kerf breaks screen recording, and macOS will tell you it
> hasn't.** These builds are ad-hoc signed with no Team ID, so macOS ties
> the screen-recording grant to the exact binary. Every update is a
> different binary, the grant stops matching, and because a row for
> `com.kerf.editor` already exists macOS never asks again: the switch in
> **Screen & System Audio Recording** stays on, `getMediaAccessStatus`
> still answers `granted`, and `desktopCapturer` returns **zero displays**.
>
> The recorder detects it — a Mac cannot have zero displays, so that count
> is the only trustworthy signal — and offers **Fix and restart**, which
> clears Kerf's own row so macOS asks again:
>
> ```bash
> tccutil reset ScreenCapture com.kerf.editor
> ```
>
> This will keep happening on every update until the macOS builds carry a
> Developer ID. With one, the grant is tied to the team identifier instead
> of a hash and survives updates. It is the same missing signature that
> stops the app self-updating.

When the take stops you are offered two ways in: **Open raw**, which lays
the clips down and stops, or **Open with the Tutorial skill**, which is
everything below. Both leave a project made of ordinary clips, so choosing
the skill is not a commitment.

## The Tutorial skill

`skills/tutorial/`. One tool, `build_tutorial_from_recording`, so an agent
can apply it to any take folder too.

### Zooms on real clicks

The frame pushes in on what you clicked, as **ordinary keyframes on the
screen clip** you can drag, retime or delete one at a time.

Clicks are real clicks. `uiohook-napi` is a prebuilt native binding that
sees mouse and keyboard events from other applications; on macOS that needs
Accessibility, and the studio says so and opens the right settings pane. It
is optional, and its absence is not an error: without it the zoom is placed
from where the pointer travelled to and stopped, which catches most clicks
because a click is preceded by a settle. The studio always says which of
the two is running.

The raw event stream is not what drives the edit. **Runs are.** A burst of
clicks in one place is one moment held for as long as the burst; typing
that starts soon after a click extends that click rather than starting a
second zoom, which is what makes filling in a form read as one idea; a
scroll is its own kind of moment and gets a gentler push, because reading
wants a wider frame than pointing.

The curve is an expo-out bezier with a 3% overshoot that settles back over
140ms. That is most of the feel: `easeInOut` spends as long arriving as it
does leaving and reads as a slow machine. Zooms chain rather than bounce —
a second moment arriving before the first has pulled out travels there at
zoom instead of snapping back to full frame. Motion blur is on while the
frame moves.

Press **Alt+Shift+Z** during a take to mark a moment yourself. Marks always
win. Auto zoom needs a whole display; a single-window capture has no frame
to place the pointer in, and the recorder turns it off and says why.

### The cinematic frame

The picture is inset to 92% on a dark gradient backdrop, with rounded
corners, a 10% vignette, and a dip from black at the head and to black at
the tail. When the zoom pushes in, the padding collapses and the content
fills the frame, which is a move rather than a crop.

The inset also buys the zoom its aim. The pan is normally clamped so the
edge of the footage never enters frame, and that clamp has a consequence
worth knowing: **centring a point 10% from the edge needs a scale of five**,
so a click on a toolbar can only ever get bigger where it is. With a
backdrop behind the picture there is no background to protect, so the frame
is allowed to travel 16% further and the corner click is genuinely framed.
Measured on a synthetic take: 0.13 to 0.30 across the frame.

### The camera takes over on pauses

While you are talking and not doing, the webcam grows from its inset to
fill the frame, then goes back. Two rules decide when:

- **It must be talking, not merely idle.** A stretch with no speech in it
  is dead air, and a static face over dead air is worse than a static
  screen. This is why the transcript is made *before* the edit is built:
  the words are the only signal that knows where a sentence ends, so the
  cut lands between sentences rather than mid-word.
- **The camera must be good enough.** Filling the frame is refused past
  1.35x enlargement, because a 720p webcam blown up is visibly soft. The
  studio says so and points at the 1080p setting.

It also never starts while a zoom is still held — found by watching it take
the frame 700ms after a push, so the zoom was correct and never seen.

### Sound and captions

A tick under every click and air under every zoom, synthesised from
oscillators and noise by `sfxEngine` and written into the take's own folder
so they travel with the recording. Quiet enough that you notice their
absence rather than their presence; the whoosh starts before the picture
moves, because the ear leads the eye.

The narration is transcribed on device with Whisper and captioned in
**Inter Bold** on a chip, which is what stays readable over screen content
where an outline would compete with the type underneath.

**Install whisper.cpp.** There are two Whispers and they are not a
preference, they are two orders of magnitude. Measured on the same 92
seconds of narration with the same `small` model class:

| | |
| --- | --- |
| `whisper-cli` (whisper.cpp, Metal) | **2.2 s** |
| `whisper` (Python, CPU, FP32) | **769 s** |

The Python one prints `FP16 is not supported on CPU; using FP32 instead`
on every run and decodes at 13–16 frames/sec. `setup_transcription`
installs the fast one and a model; `check_transcription_ready` reports
which you have and says so when you are on the slow path.

That gap decides where transcription sits in the pipeline. **With the fast
backend the words come first**, so the camera cuts land between sentences
and a stretch with no speech in it is left alone. With the slow one they
would take longer than the recording, so the edit is built immediately and
the captions arrive on their own track afterwards — the camera cuts then
fall on activity instead, and the report says so. Nobody is asked to
choose; the machine decides and the result tells you what happened.

The background pass is anchored on the **screen clip id**, not the project
id: `buildStarterProject` replaces every track in place and leaves the id
alone, so opening the starter mid-transcription used to drop a caption
track onto it.

---

## The Copilot

The Copilot panel does not implement an agent. It **runs** one. Each turn
spawns the Claude Code CLI with Kerf registered as an MCP server, so the
model gets its whole native toolset (Bash, Read, Write, WebFetch, downloads)
*alongside* all 104 Kerf editing tools, and every edit lands in the window
you are looking at.

```bash
npm i -g @anthropic-ai/claude-code
```

That is the only requirement. It authenticates with your existing Claude
subscription. There is no API key to paste and no per-token billing beyond
what your plan already covers. Without the CLI the Copilot falls back to a
built-in regex planner that handles common editing phrasings but cannot hold
a conversation or touch your files; the panel says so rather than pretending.

Things that work because the agent has real tools:

```
import the newest video from my Downloads
download <url> and put it on the timeline
cut the silence out of the dialogue
give the whole thing a warm cinematic grade
what is on my timeline right now?
```

### Driving it from your own terminal

The same bridge works from outside the app. With Kerf running:

```bash
claude --mcp-config "~/Library/Application Support/kerf/mcp-kerf.json" --strict-mcp-config
```

Edits appear live in the open window. The config is rewritten each launch
because it carries a per-session token; the RPC bridge binds to 127.0.0.1
only and rejects requests without it.

### How it fits together

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
                                                 tool registry
                                                 (owns the project)
```

The last hop is the important one. The editing tools operate on the zustand
stores, which live in the renderer, so an external process cannot call them
directly. It has to ask the window. An earlier version of the stdio server
ran the tools in its own process against a fresh, empty store and edited a
project nobody could see.

---

## The skills store

A skill is not a prompt pack. It is **tools, assets, a template project
and a verification test**, installed like an extension, with new
projects cloned from it. Three things follow from that shape: the buyer
can never get nothing (if the agent fumbles they still have a real
project on the timeline), every skill is demoable before purchase by
showing the template, and assets are licensed per skill rather than per
library.

`server/` is the backend: a Cloudflare Worker with D1 and R2, holding
accounts, the catalogue, orders and entitlements. Sign-in is an OAuth
device flow proxied through the Worker, so the client secret never ships
inside the app. Payments go through Lipia for mobile money.

Licences are signed (ECDSA P-256, thirty days) and verified on the
client against a public key compiled into the app, so a skill you bought
opens on a laptop with no connection.

`server/README.md` is the deploy runbook. `node server/verify_store.mjs`
is 36 checks, and the ones that matter are negative: an unsigned
callback grants nothing, a replayed one grants nothing twice, and paying
100 against a 5000 order grants nothing.

### Trials

A publisher sets how many times a skill may be run before it is bought:
`"trial": { "uses": 3 }` in `skill.json`, `trialUses` in the catalogue.
Zero means not gated, and bundled skills declare zero rather than omitting
the field, so "no trial" and "nobody thought about it" do not look the same.

**A trial run buys a subject, not an invocation.** Spend a run turning a
recording into a tutorial and that recording stays yours: undo it, reopen
the project, change your mind about the backdrop and apply it again, at no
further cost, *including after every run is spent*. What costs a second run
is pointing the skill at different footage, which is the thing a publisher
is actually selling. A trial that took back what it gave would punish the
one behaviour it exists to encourage.

The count is held in `userData`, sealed with AES-256-GCM under a random
per-install key at `0600`. **The useful property is not secrecy, it is
tamper-evidence**: an edited ledger does not decrypt to a smaller number,
it fails to decrypt at all, and a failed decrypt is treated as *spent*
rather than as *fresh*. That single decision is the difference between a
trial system and a decoration — the natural implementation falls back to
zero there, which makes corrupting the file a reset button. Ownership is
checked before the ledger is read at all, so a corrupt counter can never
lock out somebody who paid.

What it cannot do, said plainly rather than implied: **deleting the ledger
resets the trials on that machine**, and nothing that also lives on that
machine could prevent it. The UI says "counted on this computer" for
exactly that reason. The durable version is server-side against an account,
which the store already has the tables for. `licenceKey.ts` has said the
same thing about signatures since it was written: Kerf is MIT, this ships
as source, and the store's value is updates, verification and convenience
rather than a lock.

`src/services/trialPolicy.test.ts` is 17 checks on the properties the whole
thing rests on: a spent trial stays spent including when the file will not
open, a granted subject does *not* survive a tampered ledger (or asserting
you had a run before would be enough to get one), and an edited envelope
fails rather than decrypting to something plausible.

**Not built yet, and named rather than implied:** nothing publishes a
package, nothing installs a downloaded one, and trials are not yet
recorded against an account.

---

## Shipping a release

```bash
# 1. Bump the version, this number is what clients compare against.
npm version 1.1.0          # commits and tags v1.1.0

# 2. Push the tag. That is the decision to ship.
git push origin main --follow-tags
```

The `Release` workflow then builds on macOS, Windows and Linux in parallel and
uploads the installers **plus the `latest*.yml` manifests** to a GitHub
release. Those manifests are what installed copies read. A release without
them is invisible to the updater.

Versions must increase monotonically. An installed 1.1.0 will ignore a 1.0.9.

---

## Development

```bash
yarn install
yarn dev          # renderer only, in a browser at :5173
yarn dev:electron # full desktop app against the dev server
```

Building installers locally:

```bash
yarn package:mac      # or :win / :linux
```

Local packages are always built with `--publish never`, so a local build can
never overwrite a live release.

> **Note:** if you run these from inside a VS Code integrated terminal,
> `ELECTRON_RUN_AS_NODE=1` is inherited from the editor and Electron will
> start as plain Node. The app exits immediately with no output. Prefix with
> `env -u ELECTRON_RUN_AS_NODE`, or use a standalone terminal.

> **`yarn install` can leave you with no Electron binary, and reinstalling
> does not fix it.** Yarn's cached copy of `electron` is the bare npm
> tarball: no `dist`, no `path.txt`. Restoring it prints
> `Building fresh packages… Done` without ever fetching the 95MB binary,
> and `npm run verify` then dies with what looks like a missing install.
> Observed after a `yarn install --frozen-lockfile` left
> `node_modules/electron/dist` holding one licence file. The binary is
> already on disk, in the download cache:
>
> ```bash
> rm -rf node_modules/electron/dist && mkdir -p node_modules/electron/dist
> unzip -q ~/Library/Caches/electron/*/electron-v*-darwin-arm64.zip \
>   -d node_modules/electron/dist
> printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt
> ```
>
> Or `yarn cache clean electron && yarn install`, which is slower but does
> not need you to know the layout.
>
> **This applies to `open` as well, which is the surprising half.** `open`
> propagates the calling shell's environment, so
> `open -a /Applications/Kerf.app` from that same terminal starts the app and
> kills it within about 80ms. `open` exits 0, no window appears, and NOTHING
> is written to the app log, because the process dies before the logger is
> constructed. The only trace is in the system log, as
> `termination reported by launchd (0, 0, 0)`.
>
> Double-clicking in Finder is unaffected: Finder has no such variable. If a
> packaged build refuses to start from a terminal, check this first:
>
> ```bash
> echo $ELECTRON_RUN_AS_NODE          # set? that is the whole problem
> env -u ELECTRON_RUN_AS_NODE open -a /Applications/Kerf.app
> ```

### Layout

```
electron/         main process, preload bridge, auto-updater
  build.mjs       bundles both halves to CommonJS (.cjs, see the file)
  screenRecorder.ts  capture sources, take files, cursor track, floating bar
  inputEvents.ts  real clicks from other apps, optional and degradable
  vault.ts        sealed files at rest; the format is in src/services
  skillTrials.ts  the sealed trial ledger a publisher's count is kept in
src/
  components/     UI, organised by region of the window
    ui/icons.ts   the platform icon set, in ONE file so it stays swappable
  engine/         compositor, effects, export, geometry, snapping
                  previewRender.ts renders effect and transition previews
                  through the real compositor, not an illustration
                  screenCapture.ts / cursorZoom.ts / recordingProject.ts
                  cinematicLook.ts / recordingSound.ts / tutorialSkill.ts
                  are the recorder and the skill it feeds
  services/       the store client, session, and licence verification
  store/          zustand stores, the single source of truth
  mcp/            tool registry exposed over MCP
server/           the skills store: a Cloudflare Worker with D1 and R2
build/            icon, entitlements, ad-hoc signing hook
tools/            the verification suites, run by `npm run verify`
```

### House rules, enforced rather than written down

Four things about the interface are checks in `npm test`, because each
had already drifted once:

| Rule | Why |
| --- | --- |
| No emoji anywhere in `src` | An emoji is drawn by the OS font: a different picture on every platform, at a different weight from every real icon beside it, and unstylable. They were the effect and transition "previews" for a long time. |
| Icons only from `ui/icons.ts` | The last set swap touched 52 files. The next should touch one. |
| One type scale: 10 / 11 / 12 / 13 / 15 | It had drifted to 285 raw pixel sizes, 82 of them at 9px, which is below the scale entirely. |
| No em dashes in anything a user or an agent reads | Comments are exempt. Strings are not. |

Two more that are conventions rather than checks: **material for
content, nothing for chrome** (posters and media get a surface;
navigation and toolbars get nothing until hovered), and **recessed
things keep a hairline, raised things do not**.

---

## Licence

MIT, see [LICENSE](LICENSE).
