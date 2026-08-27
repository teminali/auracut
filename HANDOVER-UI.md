# Kerf — the UI session

Repo: `~/Documents/my_projects/auracut`. The product is **Kerf**, a
desktop video editor (Electron + React + zustand) with an agent Copilot
and 104 MCP tools.

## Read first, in this order

- **`NEXT.md`** — the work queue. The eight traps at the top are not
  optional reading; three of them will cost you an hour each. §6d is the
  worktree/lane runbook if you parallelise.
- **`HANDOVER.md` §3** — why this codebase distrusts green ticks. Then
  **§7** (the home screen, and why it is deliberately not CapCut's),
  **§1** (the Copilot architecture — "do not redesign casually"), and
  the **Iconography** note: one AI mark, lucide `Sparkle`, do not let
  the set drift back to three.

Do not read HANDOVER end to end before starting. It is 1300 lines.

## Where things stand

Everything is green as of the last commit (`dbb6973`, 25 commits in the
previous session):

```
npm test        167 unit tests, no app needed
npm run verify  15 suites, 516 checks, ~110s, boots its own Kerf
npm run typecheck
```

If any of that is red before you have touched anything, **that is the
finding** — stop and explain it, do not work around it.

The previous session closed the agent-tooling gap (105 store actions, 0
unreachable) and did a pass on the Copilot: a real multi-message queue,
`React.memo` on the thread (2000 → 80 renders per 40 streaming deltas),
and a `<kerf-timeline>` context block on every turn that took "how many
clips are on the timeline" from 16.7s to 4.5s. **Don't redo those.**

## The job

UI. Scope it with the user — the queue does not currently name a UI
task, so the first thing to do is agree what "work on UI" means before
writing code.

Things that are true and might matter:

- `src/components/` is ~12k lines across `canvas`, `copilot`, `header`,
  `home`, `inspector`, `preview`, `sidebar`, `timeline`, `ui`.
  The four biggest files are `CopilotDrawer.tsx` (908),
  `KeyframeEditor.tsx` (622), `TransformGizmo.tsx` (550),
  `PreviewPlayer.tsx` (528).
- Only the Copilot thread is memoised. Nothing else is, and nothing is
  virtualised. If you touch a hot path, **measure it** (see below).
- HANDOVER §8 lists product hardening; most of the UI-facing items there
  are still open.

## The working loop — and the traps that are specific to UI work

```bash
npm run dev                      # READ the port it prints
npm run build:electron
env -u ELECTRON_RUN_AS_NODE VITE_DEV_SERVER_URL=http://localhost:5173 npx electron .
```

`env -u ELECTRON_RUN_AS_NODE` is **not optional** — VS Code's terminal
sets it, and Electron then starts as plain node and dies silently on its
first `ipcMain.handle`.

`electron/*.ts` → `dist-electron`. **HMR does not touch it.** A
main-process change needs `npm run build:electron` *and a restart*.

### Five things that cost the previous session real time

1. **`window.__kerf` only exists in the DEV build** (`import.meta.env.DEV`).
   Under `--built` it is `undefined`. For any UI work you want the dev
   server, not `--built`.

2. **`open_starter_project` does NOT navigate off the home screen.** It
   loads a project into the stores and leaves you on home, so anything
   looking for the editor finds nothing and measures zero. Do this:
   ```js
   window.__kerf.layout.setState({ showHome: false });
   window.__kerf.project.setState({ isCopilotOpen: true });
   ```
   `layout` was added to `__kerf` for exactly this reason.

3. **A stale HMR module will silently run the OLD code.** React Fast
   Refresh sometimes cannot apply an edit and does not say so — you will
   measure the previous build and believe it. After editing a component,
   force `location.reload()` before trusting any measurement.

4. **Kill instances by PORT, never by the electron path.** Worktrees
   symlink `node_modules`, so a generic `pkill -f auracut/node_modules/electron`
   kills every lane at once. Also: `git worktree remove --force` does
   **not** kill what the worktree launched.

5. **`lsof -p PID -iTCP` is OR, not AND.** Without `-a` it prints every
   network file on the machine. Use `lsof -a -p <pid> -nP -iTCP -sTCP:LISTEN`.

### Driving and inspecting the UI from outside

```bash
# debug/eval needs KERF_DEBUG=1; debug/capture does not
env -u ELECTRON_RUN_AS_NODE KERF_DEBUG=1 KERF_RPC_PORT=3939 \
  VITE_DEV_SERVER_URL=http://localhost:5173 npx electron .
```

`debug/eval` runs arbitrary JS in the renderer. `debug/capture` returns
`{pngBase64, visibility, stale, note}` — **check `stale`**, it has
handed back the previous frame before.

`window.__kerf` exposes `timeline`, `project`, `chat`, `ui`, `agent`,
`layout`, `executeTool`, `tools`.

## How to measure UI work, since you will be asked to

Do not claim a component is slow or fast — count it. The technique that
worked: a temporary module-level counter incremented in each component
body, exposed on `window`, then drive the store and read it.

**One trap in that**: if you reset the counter by *reassigning*
`window.__rc = {...}`, the module's `const` still points at the old
object and every count reads zero forever. Zero the **fields**.

## The bar

This repo's whole culture is in HANDOVER §3, and it is short:

- **Trace to the artifact, not the function.** For UI that means the
  rendered DOM, a screenshot, or a counted render — not "the state is
  correct". Every trust-audit finding here was code that reported
  success and did nothing.
- **A threshold nobody has tried to fail is not a threshold.** Every
  suite has a `--selftest` that holds the thing still and demands the
  metric move LESS than its bar. If you add a check, add its control.
- **Test against ground truth you construct.** Beat detection passed for
  months on a click track — the one input that could not expose either
  of its two bugs.
- **Name your own mistakes plainly.** Four of the previous session's
  "findings" were bugs in its own test, and saying so is what made the
  real ones credible.
- Commit messages explain WHY and record the failure mode. Read
  `git log` for the house style; they read like sentences.

## One known intermittent, so you have the second data point

`verify_keyframes` failed once with
`filters.highlights: No track matching "track_..."` — a track id gone
stale mid-suite. It did not reproduce in two subsequent full runs, the
suite alone is 95/95, and no stray agent was editing the project. The
failing run took 149s against a usual 110s, so contention is the guess
and not a finding. If you see it again, that is two.

## Platforms, so you do not overclaim

macOS is proven. **Linux is wired and has never been run.** **Nobody has
ever run Kerf on Windows.** `gate.yml` (typecheck + unit tests) is a hard
gate on all three; `verify.yml` (the live suites) is `workflow_dispatch`
and labels each platform with the honesty it has earned. Dispatching
those two jobs needs the maintainer's GitHub account.
