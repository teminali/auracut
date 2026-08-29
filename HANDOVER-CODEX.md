# Claude Code handover: integrate the approved Kerf UI into the real platform

Date: 2026-08-29  
Repository: `/Users/teminali/Documents/my_projects/auracut`  
Product: Kerf, an Electron + React + TypeScript nonlinear video editor

## Mission

Wire the approved Apple-refined Kerf design into the actual platform.

This is a **presentation-layer migration over the existing product**, not a rewrite. The real platform remains the source of truth for behavior, data, architecture, editing semantics, and product flows. The approved prototype is the source of truth for visual design, component appearance, layout intent, motion feel, and the new fullscreen viewing/editing experience.

The result must look like the approved design while retaining every existing capability and flow in the real application. If the real platform contains a component or state that the prototype does not show, keep it and redesign it using the same system. Do not hide, remove, simplify, or replace it just because it is absent from the prototype.

## Read before changing code

Read these in this order:

1. This file in full.
2. `NEXT.md`, especially the working-tree and verification traps.
3. `HANDOVER.md` sections 1, 3, 7, 8, 10, and 12. The Copilot architecture is explicitly marked “do not redesign casually.”
4. `HANDOVER-UI.md` for the live UI-driving and measurement workflow.
5. The actual implementation in `src/App.tsx`, `src/index.css`, `src/store/`, and the component folders listed below.
6. The approved prototype files under `design-prototypes/kerf-apple/`.

Do not rely on screenshots or the prototype alone. Trace every visible control back to the real handler, store action, Electron bridge, or engine behavior it currently drives.

## The two sources of truth

### Real platform: functional source of truth

The application in `src/` owns:

- project loading, autosave, recovery, recents, and navigation;
- timeline state, editing operations, snapping, markers, grouping, undo/redo, and keyboard shortcuts;
- real canvas compositing, media playback, audio, meters, selection, gizmos, and safe-area overlays;
- all inspector mutations and keyframe behavior;
- recording and its separate Electron windows;
- export, update, account, purchase, settings, MCP, and platform-specific flows;
- Copilot context capture, preflight, annotations, queues, agent execution, run state, activity, voice input, and gap reporting;
- accessibility and the existing Radix interaction semantics.

Preserve these implementations. Do not port static `.dc.html` data, simulated playback, fake controls, prototype JavaScript, or prototype routing into the product.

### Approved prototype: visual and interaction source of truth

Use these files as the approved design reference:

- `design-prototypes/kerf-apple/KerfHome.dc.html`
- `design-prototypes/kerf-apple/Kerf Editor.dc.html`
- `design-prototypes/kerf-apple/KerfPlayer.dc.html`
- `design-prototypes/kerf-apple/kerf-unified.css`
- `design-prototypes/kerf-apple/kerf-components.css`
- `design-prototypes/kerf-apple/apple-refinement.css`
- `design-prototypes/kerf-apple/kerf-player.css`

Preview with:

```bash
node tools/preview-kerf-design.mjs design-prototypes/kerf-apple 4173
```

Then open `http://127.0.0.1:4173/KerfHome.dc.html`, `http://127.0.0.1:4173/Kerf%20Editor.dc.html`, and `http://127.0.0.1:4173/KerfPlayer.dc.html`.

The prototype uses attribute selectors against generated inline styles because it was built in Design Doc. **Do not copy that technique into the React application.** Implement semantic variants, shared primitives, and CSS variables in the real platform.

## Non-negotiable regression rule

Never break, bypass, or silently change an existing functionality or flow to make the new design easier to implement.

For every component migrated:

1. Record its existing states, handlers, store dependencies, keyboard behavior, focus behavior, loading/empty/error states, and Electron/API side effects.
2. Render and exercise the current version before changing it. Capture a baseline artifact when the state is visual.
3. Change the presentation around the existing behavior. Keep handlers and state ownership connected to their current sources.
4. Exercise every recorded state after the change, including disabled, busy, empty, error, hover, focus, selected, and collapsed states.
5. Run focused tests and typechecking immediately. Do not accumulate a large UI rewrite before checking behavior.
6. Compare the rendered result with both the baseline behavior and approved prototype.
7. Cross-check once from code to UI and once from UI back to the handler/store. A green render is not proof that the action still works.

If a visual requirement appears to conflict with an existing behavior, preserve the behavior and adapt the visual implementation. Stop and document the conflict if it cannot be reconciled safely.

Do not:

- replace functioning platform components with visually similar copies;
- duplicate controls and leave one disconnected;
- move state into local component state when it currently belongs to a store;
- change store schemas, engine behavior, project serialization, IPC, agent protocols, or command IDs for styling convenience;
- remove event handlers, `aria-*`, titles, shortcut wiring, pointer capture, drag behavior, or focus management;
- make UI-only timeline zoom that disagrees with the actual time scale;
- weaken tests, loosen assertions, or dismiss a failure without proving it from the untouched baseline;
- use `git add -A`; multiple sessions may share this tree.

## Product and design rules

The design is an Adobe Premiere-derived professional editing workspace with a restrained Apple software-design layer and Kerf’s own identity.

Preserve the dense NLE information architecture, persistent editing context, direct manipulation, scrub fields, keyframes, snapping, track controls, precise time readouts, Kerf orange accent, Phosphor icons through `src/components/ui/icons.ts`, and compact professional control density.

Add cleaner surface separation, disciplined alignment, refined typography, subtle depth, restrained transitions, and consistent radii/hairlines/shadows/focus/hover/pressed/disabled/selected states across Home, Editor, Player, Copilot, Recorder, dialogs, and platform-only views.

Avoid excessive glass, blur, glow, pills, floating cards, oversized padding, decorative movement, multiple signals for one state, arbitrary colors/radii/icons, and macOS imitation that weakens Kerf or professional editing conventions.

## Approved visual system

Translate these prototype tokens into the real application’s semantic roles in `src/index.css` and Tailwind mapping. Consolidate with existing variables rather than maintaining two systems.

### Dark-platform integration task

The approved prototype has intentionally been restored to its pre-theme-experiment palette. Do **not** treat its neutral brightness as the final platform theme. During wiring, combine two distinct references:

- the prototype supplies the improved Apple/Kerf component design, layout, geometry, hierarchy, motion, and interaction treatment;
- the currently implemented real platform supplies the cleaner cinematic dark tonal foundation.

The old platform’s strength is not “pure black.” It is a blue-black editing environment with very little visible grey mass: inactive chrome recedes, panels separate through small cool luminance steps, the program monitor remains the darkest focus area, and footage/timeline clips/text/coral-orange actions carry the light. Preserve that quality while replacing the old component styling with the approved refined design.

Start from the real platform’s current semantic ladder in `src/index.css`, not from invented hard-coded replacements:

| Existing platform role | Current reference |
| --- | --- |
| Stage | `#060709` |
| Sunken | `#0a0b0e` |
| Chrome | `#111318` |
| Surface | `#16191f` |
| Secondary surface | `#1e222a` |
| Raised surface | `#252a33` |

These are starting roles, not a command to paste hex values into components. Consolidate through semantic tokens, preserve the approved Kerf accent identity, and tune in the running Electron app. The target is the **darkness sweet spot**: cinematic and focused at rest, but immediately legible. Adjacent structural surfaces should be distinguishable without obvious grey boxes; controls lift softly on hover/focus; and orange feels luminous without becoming neon. If boundaries disappear or active/disabled states become ambiguous, it is too dark. If the workspace reads as charcoal-grey before the content, it is too light.

Treat this as a named integration task with its own before/after screenshots and state matrix. Do not attempt it as an unverified global search-and-replace, and do not redesign functionality while tuning the palette.

Geometry and depth:

- Radius steps are 6, 8, 11, and 15px.
- Small square editor controls generally use 6–8px; cards/panel groups use 8–11px; large floating layers may use 15px.
- Hairlines establish hierarchy; do not outline every nested object.
- Use subtle inset highlights and short ambient shadows for raised controls.
- Reserve stronger shadows and blur for menus, dialogs, Copilot overlays, and detached layers.
- Keep working panels mostly solid for clarity and performance.

Typography and motion:

- Use the system/SF stack with existing safe fallbacks.
- Retain tabular numerals and monospaced timecode/readouts.
- Keep existing product copy unless a change is intentional and verified.
- Main ease: `cubic-bezier(.22, 1, .36, 1)`; typical transitions: 160–220ms.
- Press feedback may be about 70ms with subtle scale, not bounce.
- Timeline, playback, canvas, scrubbing, and dragging stay immediate and pointer-accurate.
- Preserve and verify `prefers-reduced-motion`.

## Settled decisions from design review

1. The Apple layer applies to all items and components without exception, but stays clean and controlled.
2. Editor side-rail tabs are compact square tiles with perfect alignment.
3. The active side-rail tab has **no orange left-edge border**.
4. Every side-rail and inspector tab/state is checked, not just Media and Transform.
5. The timeline gets the refined Apple/Kerf treatment while remaining dense and professional.
6. Timeline zoom must be real: scale, ruler, hit testing, snapping, playhead, clips, markers, waveforms, scrolling, and shortcuts remain mathematically consistent.
7. The UI may expose millisecond scale, but actual frame boundaries depend on FPS. At 30fps one video frame is about 33.33ms; do not promise a distinct video frame between frames.
8. Playing a project from Home opens the new fullscreen Player, not the Editor.
9. The Player supports viewing plus editing access through a restrained toolbar and the existing Copilot.
10. Home and Editor open the **same real Player implementation**.
11. Player buttons and controls reuse real shared Home/Editor components. Lookalike copies are unacceptable.
12. Player Copilot reuses the actual Copilot behavior and components. Do not imitate or reinvent it.
13. Fullscreen has exactly one primary play/pause control.
14. Landscape media is edge-to-edge without an avoidable black frame.
15. Portrait media touches top and bottom. Use restrained side treatment derived from the same media while keeping the foreground uncropped unless chosen otherwise.
16. Player top/transport overlays appear on pointer movement, hover, or keyboard focus, then recede. They remain keyboard- and touch-accessible.
17. The Editor fullscreen button opens this same Player.
18. Shared component changes are checked on every consumer; Player work must not accidentally redesign unrelated Home or Editor areas.
19. The final UI keeps the old platform’s darker atmosphere while using the new Apple/Kerf component design. Darken the neutral surface ladder, not the brand accent or functional clarity.
20. Tune the final darkness in the running app by visual hierarchy and contrast, not by chasing the lowest hex values. The acceptance target is “deep and premium, with effortless separation.”

## Map the design onto the platform

| Surface | Real implementation |
| --- | --- |
| Shell and panel resizing | `src/App.tsx`, `src/store/layoutStore.ts` |
| Tokens and component classes | `src/index.css`, Tailwind config |
| Shared controls/icons | `src/components/ui/Controls.tsx`, `icons.ts`, Radix primitives |
| Home | `src/components/home/` |
| Editor header | `src/components/header/HeaderBar.tsx` |
| Rail and content panels | `src/components/sidebar/` |
| Program monitor and transport | `src/components/preview/PreviewPlayer.tsx`, `PlaybackControls.tsx` |
| Canvas manipulation | `src/components/canvas/` |
| Inspector | `src/components/inspector/` |
| Timeline | `src/components/timeline/`, `src/store/timelineStore.ts`, `src/hooks/useKeyboardShortcuts.ts` |
| Copilot | `src/components/copilot/` and agent/chat/gap stores |
| Recorder | `src/components/recorder/` and Electron recorder windows |
| Export and MCP | `ExportModal.tsx`, `McpStatusModal.tsx` |
| Global overlays | `CommandPalette.tsx`, `ContextMenu.tsx`, `ShortcutsOverlay.tsx`, `Toasts.tsx`, `ErrorBoundary.tsx` |

## Platform-only components still requiring the design treatment

The prototype is not a complete inventory. Keep, style, and verify:

- Home account, settings, sign-in, purchase, update, version, carousel, skills, empty/loading/unavailable/recovery/import states.
- `NewProjectSheet`, `SignInDialog`, `BuySheet`, `ChangelogSheet`, `UpdateBanner`, `AccountView`, `SettingsView`, and `VersionFooter`.
- Update indicator, MCP connection states, export progress/error/success.
- Command palette, context menus, shortcut help, toasts, tooltips, popovers, selects, switches, sliders, text fields, confirmations, and errors.
- All eight Editor rail destinations: Media, Audio, Text, Captions, Transitions, Effects, Filters/Colour, and AI.
- All inspector variants: Transform, Shape, Text, Audio, Color, Speed, Effects, and Keyframes, including empty/disabled states.
- All timeline clip/track/selection/lock/mute/hide/drag/marquee/drop/snap/in-out/marker/beat/waveform/empty/large states.
- Canvas guides, transform handles, alignment bar, rotation/readouts, overlays, zoom, and no-selection states.
- Full Copilot matrix: empty/conversation/streaming/queue/tool calls/thoughts/preflight/frame/annotations/agent picker/MCP activity/gap log/success/error/cancel/unavailable/voice/follow-agent/resize.
- Recorder permission/source/camera/mic/countdown/recording/paused/stopping/remux/error states and its transparent standalone bar window.

Use the nearest approved pattern and shared semantic primitives. Do not invent another design language for missing surfaces.

## Required technical approach

1. Inventory before replacement. Map rendered components and states to action/store dependencies; search usages before changing shared code.
2. Tokens first. Avoid a second parallel `.kerf-app` layer in production.
3. Primitives second. Strengthen actual buttons, fields, segments, tabs, sliders, sheets, menus, tooltips, and headers, then migrate consumers.
4. Migrate incrementally. Do not paste prototype markup into `App.tsx`.
5. Keep current stores and engine modules authoritative.
6. If several surfaces need the same control, export and consume one real React component.
7. Build one real fullscreen Player and use it from Home and Editor.
8. Continue with React, Zustand, Radix, Framer Motion, and the project icon abstraction. Do not add another UI framework.
9. Respect hot paths: playback must not rerender React each frame; measure touched timeline/Copilot hot paths.
10. Preserve macOS traffic-light spacing, frameless windows, transparent recorder window, IPC, and platform behavior.

### Fullscreen Player architecture

`PreviewPlayer.tsx` currently has a local fixed fullscreen state. Do not merely restyle that element and call the product-level task complete.

Create a shared Player entered from a Home project play action and the Editor monitor fullscreen action. It must use real project/media/playback state and real Copilot, not a `.dc.html` view.

Determine and document whether Home opens a recent snapshot in a non-destructive viewing session or loads existing stores. Preserve recents/autosave semantics: opening Player must not mark a project edited, overwrite autosave, or bypass existing Editor entry behavior.

If `CopilotDrawer` is too coupled to Editor layout, extract shared internals or add a layout shell without cloning its logic.

### Timeline zoom

The real platform already implements zoom in `timelineStore`, `Timeline`, `TimelineToolbar`, ruler rendering, and keyboard shortcuts. Extend it instead of drawing a visual overlay.

Current scale is `BASE_PX_PER_MS = 0.05` multiplied by `zoomLevel`, with the store currently clamped to `0.05..20`. Validate the safe/meaningful maximum before changing it.

At every scale verify ruler ticks, clip/trim/split geometry, playhead seeking, snap tolerance, markers, in/out, drag ghosts, waveforms, selection, zoom-to-fit, pointer/playhead centering, all zoom inputs, horizontal performance, and long-project precision.

Frame-based operations snap to frames. Audio, markers, and store times may use finer milliseconds only where the engine supports them.

## Migration sequence and gates

### Phase 0: untouched baseline

- Inspect `git status --short`; preserve all current work and stage explicit paths only.
- Run `npm run typecheck` and `npm test` before implementation.
- Launch the real app and record behavior for navigation, project/recovery, editing, playback, Copilot, recorder, export, and dialogs.
- If baseline is red, report it before UI edits; do not silently work around it.

### Phase 1: tokens and primitives

Reconcile palette, geometry, motion, focus, control heights, typography, and shared primitives. This phase owns the cinematic dark-theme transfer: retain the real platform’s blue-black tonal architecture while applying the prototype’s refined components. Apply it to a small representative sample before any broad migration.

Gate: typecheck, tests, before/after screenshots of the actual Electron app, light/dark surface and contrast measurements, visual state matrix, keyboard/focus, reduced motion, and usage-search cross-check. Do not proceed if the sample looks like medium-grey prototype panels or loses the old platform’s cinematic focus.

### Phase 2: Home

Apply the approved Home design through real components. Preserve new project, record, import, recents, recovery, skills, account/settings/update/sign-in/purchase. Add Home-to-Player without changing other entry flows.

Gate: all states, real click-throughs, recents/autosave, focused tests, screenshots at representative sizes.

### Phase 3: Editor shell and panels

Update header, square rail, every panel, monitor, inspectors, splitters/collapse states, and alignment. Remove the active rail edge marker.

Gate: all eight rail tabs, all inspectors, resized/collapsed layouts, canvas/gizmo, shortcuts, focused tests.

### Phase 4: timeline

Apply the design to the real timeline and extend real precision zoom without altering editing semantics.

Gate: fit/default/extreme zoom, millisecond/frame cases, long/short/empty projects, clip/track states, drag/trim/split/snap/undo/redo, playback auto-scroll, performance.

### Phase 5: shared Player

Implement one Player for Home and Editor, edge-to-edge media behavior, one transport, real shared controls, receding overlays, real Copilot, and toolbar.

Gate: both entry/exit paths, landscape/portrait/square, idle/hover/focus/touch, one play control, Copilot matrix, playback/scrub/rate/loop, resize/Escape, no project/autosave corruption.

### Phase 6: all remaining platform surfaces

Finish Recorder, Copilot details, dialogs, menus, command palette, toasts, export, MCP, account, updates, errors, and empty/loading states.

Gate: component/state inventory reaches 100%; no “style later” item remains.

### Phase 7: exhaustive regression and visual audit

- Cross-check the entire inventory twice.
- Run `npm run typecheck`, `npm test`, relevant focused verification, and `npm run verify` at the integration gate.
- Follow `NEXT.md`/`HANDOVER-UI.md` guidance for HMR, ports, Electron environment, and live suites.
- Test in Electron; browser-only rendering cannot prove recorder, IPC, window chrome, shortcuts, or export.
- Compare screenshots to the prototype at multiple window sizes.
- Inspect keyboard/focus, reduced motion, contrast, overflow, clipping, hit targets, console errors, React warnings, unhandled promises, store mutations, and render counts.

## Mandatory regression checklist

Prove these still work:

- Home create/record/import/recent/recovery/skills/settings/account/sign-in/update flows.
- Home ↔ Editor, Home → Player, Editor → Player, Player exit/back, and window-close semantics.
- Panel switching/collapse/resize, selection, transforms, alignment, inspectors, undo/redo.
- Timeline add/remove/select/drag/trim/split/duplicate/group/snap/ripple/marker/beat/add-track/mute/lock/hide/zoom/scroll/seek/shortcuts.
- Playback play/pause/frame-step/rate/loop/in-out/audio sync/meters/video seeking/fullscreen.
- Copilot agent selection/prompt/queue/stop/preflight/frame annotation/tools/thoughts/voice/errors/gaps/resize.
- Recorder permissions/sources/start/pause/mark/stop/remux/open and floating-window behavior.
- Export and MCP configuration/progress/cancel/error/success/status.
- Autosave/recovery/serialization/posters and no unintended Player writes.
- Focus-visible/tab order/Escape/labels/disabled/reduced-motion behavior.

Add focused tests for Player state/routing, shared components, and timeline zoom math. Do not rely on visual inspection alone.

## Visual completion checklist

- Every surface reads as one Apple-refined Kerf product.
- The overall workspace is as dark and focused as the old platform, with clear layered surfaces rather than flat black or washed-grey panels.
- No legacy-looking button, field, select, slider, menu, tab, card, sheet, tooltip, empty state, or status remains.
- No duplicated lookalike components exist.
- Rail tiles are square/aligned with no active left border.
- Every rail and inspector view has been rendered and checked.
- Timeline ruler/playhead/clips/markers/headers/waveforms stay aligned at every zoom.
- Fullscreen landscape is edge-to-edge; portrait reaches top and bottom with intentional side treatment.
- Fullscreen overlays recede but remain accessible, and there is one primary play/pause control.
- Player actions and Copilot are the actual shared behaviors, not copies.
- No unintended overflow; motion is smooth, restrained, and non-distracting.

## Working-tree warning

At handover time these paths were untracked:

```text
HANDOVER-CODEX.md
design-prototypes/
tools/capture-local-preview.cjs
tools/preview-kerf-design.mjs
```

They belong to current design/handover work. The actual `src/` platform was not modified during the prototype phase recorded here. Inspect status again, preserve other sessions’ work, stage explicit paths only, and review the staged diff.

The prototype remains the approved pre-integration visual reference. Its shared refinement layer is loaded last by Home, Editor, and Player. The cinematic dark-theme transfer must be implemented and verified in the actual platform by combining that component design with the real platform’s existing tonal foundation.

## First actions for Claude Code

1. Read the required documents and inspect the tree.
2. Run and record untouched baseline checks.
3. Launch the real platform and approved prototype.
4. Create a component/state/action migration inventory.
5. Trace shared primitive usages before global CSS edits.
6. Implement Phase 1 only, including the cinematic dark-theme transfer, on a small representative sample in the actual platform.
7. Render, exercise, test, and cross-check it before proceeding.
8. Continue phase by phase with current regression evidence.

## Definition of done

Done means the actual Kerf platform—not the static prototype—matches the approved design language across every component and state; the shared Player works from Home and Editor; timeline zoom is real and precise; every existing feature and flow remains operational; focused and full verification are green; and the final double-check finds no missed legacy component, disconnected control, regression, console error, or invented duplicate.
