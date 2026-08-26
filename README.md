# Kerf

An open-source, non-linear video editor for the desktop, with the Model
Context Protocol wired through the whole application — every edit the UI can
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

### First launch on macOS

Current builds are **not notarised by Apple**, so Gatekeeper refuses the first
open. On macOS 15 and later the old right-click → **Open** escape hatch is
gone, so clear the quarantine flag instead:

```bash
find /Applications/Kerf.app -print0 | xargs -0 xattr -d com.apple.quarantine
```

(`xattr -r` does **not** work — macOS 26 removed the `-r` flag.)

---

## Updates

Kerf checks for updates 8 seconds after launch and every 6 hours after
that. Nothing is ever installed behind your back: an update downloads in the
background, and a **Restart to update** button appears in the title bar. You
choose when to take it.

**Windows and Linux update themselves.** **macOS currently does not** —
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

## The Copilot

The Copilot panel does not implement an agent — it **runs** one. Each turn
spawns the Claude Code CLI with Kerf registered as an MCP server, so the
model gets its whole native toolset (Bash, Read, Write, WebFetch, downloads)
*alongside* all 44 Kerf editing tools, and every edit lands in the window
you are looking at.

```bash
npm i -g @anthropic-ai/claude-code
```

That is the only requirement. It authenticates with your existing Claude
subscription — there is no API key to paste and no per-token billing beyond
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
directly — it has to ask the window. An earlier version of the stdio server
ran the tools in its own process against a fresh, empty store and edited a
project nobody could see.

---

## Shipping a release

```bash
# 1. Bump the version — this number is what clients compare against.
npm version 1.1.0          # commits and tags v1.1.0

# 2. Push the tag. That is the decision to ship.
git push origin main --follow-tags
```

The `Release` workflow then builds on macOS, Windows and Linux in parallel and
uploads the installers **plus the `latest*.yml` manifests** to a GitHub
release. Those manifests are what installed copies read — a release without
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
> start as plain Node — the app exits immediately with no output. Prefix with
> `env -u ELECTRON_RUN_AS_NODE`, or use a standalone terminal.

### Layout

```
electron/         main process, preload bridge, auto-updater
  build.mjs       bundles both halves to CommonJS (.cjs — see the file)
src/
  components/     UI, organised by region of the window
  engine/         compositor, effects, export, geometry, snapping
  store/          zustand stores — the single source of truth
  mcp/            tool registry exposed over MCP
build/            icon, entitlements, ad-hoc signing hook
```

---

## Licence

MIT — see [LICENSE](LICENSE).
