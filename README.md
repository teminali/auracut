# AuraCut

An open-source, non-linear video editor for the desktop, with the Model
Context Protocol wired through the whole application — every edit the UI can
make, an agent can make too, through the same store.

macOS · Windows · Linux · Electron + React + TypeScript

---

## Install

Download the build for your platform from
[Releases](https://github.com/teminali/auracut/releases/latest).

| Platform | File |
| --- | --- |
| macOS (Apple Silicon) | `AuraCut-<version>-arm64.dmg` |
| macOS (Intel) | `AuraCut-<version>-x64.dmg` |
| Windows | `AuraCut-Setup-<version>.exe` |
| Linux | `AuraCut-<version>-x64.AppImage` |

### First launch on macOS

Current builds are **not notarised by Apple**, so Gatekeeper will refuse the
first open. Right-click the app → **Open** → **Open**, once. After that it
launches normally.

---

## Updates

AuraCut checks for updates 8 seconds after launch and every 6 hours after
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

The release workflow detects `CSC_LINK` and stamps `AURACUT_SIGNED=1` into the
build, which is what flips the app from "tell the user" to "just update".

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
