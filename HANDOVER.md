# AuraCut — handover

You are picking up an Electron video editor whose Copilot **runs Claude Code
as its agent**. The goal for this next phase: take it from roughly 70% of
real-world editing capability to ~95%, while getting faster and cheaper per
edit, not slower.

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

Already fixed:

| Bug | Shape |
|---|---|
| `apply_transition` | Took `z.string()`, blind-cast to `TransitionType`. `page_curl` returned **`success: true`** and wrote garbage into the clip. |
| `generate_auto_captions` | Entirely fake. Slept 1200ms, returned one hardcoded Kiswahili sentence, ignored its `audioUrl`. Every project got identical captions. |
| Copilot model dropdown | `configureModelEndpoint` was never called anywhere. Purely decorative. |
| `shaders.ts` | 90 lines of GLSL nothing imports, headed "GPU Shaders Engine". **Still dead — not yet addressed.** |

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

**Phase 1 — Trust.** The 48-tool audit above. Nothing else matters if tools lie.

**Phase 2 — Altitude.** Replace agent improvisation with deterministic tools.
`create_grid_layout` is the worked example (22 calls → 3). Candidates:
`create_picture_in_picture`, `apply_look_preset`, `auto_montage_to_beats`,
`batch_apply`, `create_lower_third`, `assemble_from_folder`.
Rule of thumb: if the agent needed >6 calls and a verification step, it should
have been one tool.

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
