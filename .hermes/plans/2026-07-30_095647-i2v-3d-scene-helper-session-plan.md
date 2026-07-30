# I2V 3D Scene Helper MVP Implementation Plan

> **For Hermes:** Use `subagent-driven-development` skill to implement this plan task-by-task. Execute exactly one numbered Hermes session at a time, in order, and finish each session with tests, a commit, and a handoff note.

**Goal:** Build a browser-only 3D scene composition app that lets a non-3D user arrange simple objects/mannequins, choose a cinematic camera and lighting setup, and export an I2V-ready start-frame PNG within three minutes.

**Architecture:** A local-first React single-page app renders the scene with React Three Fiber/Three.js. Zustand owns a versioned, JSON-safe scene document; transient editor navigation and Three.js runtime objects remain outside that document. A document-owned OutputCamera is the single source of truth for framed preview and export, while exact-size PNGs render through an offscreen target rather than by screenshotting the editor canvas. The MVP has no application server and persists primitive-only scenes through validated JSON and browser storage.

**Tech Stack:** React, TypeScript, Vite, Three.js, React Three Fiber, `@react-three/drei`, Zustand, Zod, Vitest, React Testing Library, Playwright, ESLint, Prettier.

---

## 1. Current context

- Workspace: `/Users/js/Documents/3d-scene-helper`
- Current files: only `IDEA.md`
- The directory is not yet a Git repository.
- Node.js `v25.8.1` and npm `11.11.0` are available.
- Product direction already decided:
  - Browser application, not Electron or a standalone executable.
  - Local-first MVP; no backend required.
  - Optimized for I2V start-frame/keyframe composition rather than full 3D modeling.

## 2. MVP product contract

A first-time user must be able to:

1. Open the app in a desktop browser and begin from a usable starter scene rather than an empty void.
2. Choose `16:9`, `9:16`, `1:1`, or `2.39:1`.
3. Add a cube, sphere, cylinder, plane, or simple mannequin.
4. Select, move, rotate, scale, recolor, hide/show, duplicate, and delete an object.
5. Choose a lens preset: `18`, `24`, `35`, `50`, or `85mm`.
6. Apply a camera shot preset and adjust the camera interactively.
7. Toggle thirds, center, and safe-area composition guides.
8. Apply a simple lighting/background preset.
9. Add optional subject-motion and camera-motion direction guides.
10. Save/reopen the scene locally and import/export scene JSON.
11. Export a clean PNG without editor overlays.

### Fixed rendering and scene invariants

- World units are meters: `1 Three.js unit = 1 meter`.
- The primitive mannequin has a reference height of `1.7m`; camera shot presets derive framing from subject bounds/reference height instead of unexplained hard-coded positions.
- The default scene contains an exportable floor, a `1.7m` mannequin, a neutral background, neutral-studio lighting, and an eye-level `50mm` OutputCamera.
- The floor is scene content. Grid and axes are editor-only helpers and never substitute for the floor in an export.
- The document-owned OutputCamera stores `position`, `target`, `focalLengthMm`, and `rollDeg`; `filmGaugeMm` is fixed at `36` for MVP lens semantics.
- Editor orbit/pan state is transient. Interactive camera changes become document state only at an explicit commit boundary; export always reconstructs its camera from the document.
- The visible area inside the viewport letterbox is exactly the area rendered to the PNG. Browser viewport size and device-pixel ratio must not change export framing.
- Three render layers are reserved: layer `0` scene content, layer `1` editor-only helpers, and layer `2` optional reference annotations. Clean export renders layer `0` only.
- Renderer output uses sRGB color space consistently for preview and export.

### MVP acceptance criteria

- A clean install succeeds with `npm install` and `npm run dev`.
- `npm run test`, `npm run typecheck`, `npm run lint`, and `npm run build` pass.
- Playwright covers one complete user flow from the starter scene to a downloaded PNG.
- Exported dimensions match the selected output preset exactly.
- Exporting the same saved scene before and after resizing the browser viewport preserves output framing and dimensions.
- Reloading the browser restores the most recently saved scene.
- Malformed/unsupported scene JSON is rejected without losing the current scene or overwriting its valid autosave slot.
- Editor-only helpers, grids, selection outlines, transform gizmos, and guides never appear in clean exports.
- The default export contains the real floor/background but not the editor grid or axes.
- Clean and reference exports follow separate, testable layer/compositing paths.
- The core composition flow is usable at a 1280×720 viewport without clipped primary controls.
- A first-time user can complete the documented starter-scene-to-`1080×1920` golden path within three minutes in a manual usability check.

## 3. Explicitly out of scope for MVP

- Backend accounts, cloud scene storage, collaboration, or authentication.
- Electron/Tauri packaging.
- Mesh modeling, sculpting, UV editing, rigging, or animation timelines.
- Physics, particles, advanced shaders, post-processing, or ray tracing.
- AI image/video generation API integration.
- Arbitrary GLB/GLTF import, texture libraries, or an asset marketplace.
- Mobile touch editing; mobile may show a read-only/unsupported notice.
- Final-frame prediction or physically simulated motion paths.

## 4. Proposed source layout

```text
.
├── IDEA.md
├── README.md
├── package.json
├── vite.config.ts
├── playwright.config.ts
├── index.html
├── src/
│   ├── main.tsx
│   ├── app/
│   │   ├── App.tsx
│   │   └── App.css
│   └── editor/
│       ├── types.ts
│       ├── constants.ts
│       ├── components/
│       │   ├── EditorShell.tsx
│       │   ├── TopToolbar.tsx
│       │   ├── AssetPanel.tsx
│       │   ├── Outliner.tsx
│       │   ├── Inspector.tsx
│       │   └── StatusBar.tsx
│       ├── scene/
│       │   ├── SceneViewport.tsx
│       │   ├── OutputCamera.tsx
│       │   ├── EditorNavigation.tsx
│       │   ├── cameraMath.ts
│       │   ├── SceneObject.tsx
│       │   ├── Mannequin.tsx
│       │   ├── SelectionTransformControls.tsx
│       │   ├── LightingRig.tsx
│       │   ├── CompositionGuides.tsx
│       │   └── MotionGuides.tsx
│       ├── state/
│       │   ├── editorStore.ts
│       │   ├── editorStore.test.ts
│       │   └── history.ts
│       ├── presets/
│       │   ├── aspectRatios.ts
│       │   ├── cameras.ts
│       │   └── lighting.ts
│       ├── persistence/
│       │   ├── sceneSchema.ts
│       │   ├── sceneSchema.test.ts
│       │   ├── sceneCodec.ts
│       │   └── sceneCodec.test.ts
│       └── export/
│           ├── exportFrame.ts
│           └── exportFrame.test.ts
├── e2e/
│   └── editor.spec.ts
└── docs/
    ├── product-brief.md
    ├── architecture.md
    └── session-handoffs/
        ├── S00.md
        └── ...
```

Paths may be refined only when a session documents why; do not create parallel abstractions for the same responsibility.

## 5. Hermes session operating protocol

### One session, one outcome

Each numbered section below is a separate Hermes chat session. Do not combine two sessions merely because the first finishes quickly. A fresh session keeps the context focused and makes rollback/review easier.

### Start-of-session prompt template

```text
프로젝트 경로는 /Users/js/Documents/3d-scene-helper 이다.
.hermes/plans/2026-07-30_095647-i2v-3d-scene-helper-session-plan.md를 읽고
Session SXX만 수행하라. 이전 handoff인 docs/session-handoffs/SYY.md와 현재 git diff를 먼저 확인하라.
범위를 넓히지 말고, 테스트/빌드/검증 후 커밋하고 docs/session-handoffs/SXX.md를 작성하라.
```

For S00, omit the previous-handoff reference. If a prior session has no clean handoff or the working tree is unexpectedly dirty, stop implementation and reconcile that first. S12 runs only after the user explicitly selects a deployment target; otherwise stop after the S11 functional MVP gate.

### Required end-of-session checklist

Every implementation session must:

1. Run the session-specific focused tests.
2. Run `npm run typecheck` and `npm run lint` once those scripts exist.
3. Run `npm run test -- --run` for all unit/component tests.
4. Run `npm run build` for sessions that change production code.
5. Review `git diff --check` and `git status --short`.
6. Commit only the intended change with the proposed commit message.
7. Create `docs/session-handoffs/SXX.md` containing:
   - Goal completed.
   - Files added/changed.
   - Commands run and actual outcomes.
   - Decisions and deviations.
   - Known limitations.
   - Exact starting point for the next session.

The handoff note belongs in the same session commit. Do not write claims such as “all tests passed” unless the commands were actually run.

### Required checkpoints inside every implementation session

Each session is one outcome, but it is not one unreviewable code dump. Execute these checkpoints in order and stop rather than carrying a failed checkpoint into the next session:

1. **Checkpoint A — RED:** add the smallest failing unit/E2E test or other objective reproduction for the session behavior.
2. **Checkpoint B — GREEN:** implement the minimum change that satisfies the focused test without expanding scope.
3. **Checkpoint C — INTEGRATE:** run the session validation commands, inspect the actual UI when WebGL behavior changed, and fix regressions.
4. **Checkpoint D — REVIEW/HANDOFF:** inspect the diff, obtain spec/code-quality review, commit, and write the handoff note.

Vitest covers pure functions, document/store transitions, schemas, codecs, and DOM-only controls. It must not pretend to validate a real R3F Canvas through jsdom mocks. Playwright in a real browser owns WebGL rendering, mesh interaction, camera framing, gizmos, and export behavior.

### Commit discipline

- One cohesive commit per session is the default.
- Use a second commit only for a clearly separate review fix.
- Do not leave generated build output or Playwright artifacts tracked.
- Never let a subagent commit changes outside the current session scope.

---

# Session-by-session execution plan

## Session S00 — Freeze the product brief and interaction contract

**Session title:** `S00 Product contract`

**Objective:** Convert the concept into a testable MVP brief before generating application code.

**Files:**
- Modify: `IDEA.md`
- Create: `docs/product-brief.md`
- Create: `docs/architecture.md`
- Create: `docs/session-handoffs/S00.md`

**Tasks:**

1. Rewrite `IDEA.md` as a concise Korean product statement and link to the detailed brief.
2. Document the primary persona: an I2V creator who needs composition but does not want Blender-level complexity.
3. Document the “three-minute frame” golden path.
4. Define the exact MVP controls, aspect-ratio presets, lens presets, lighting presets, and export sizes.
5. Add text wireframes for desktop layout and the export dialog.
6. Record architecture boundaries: serializable document state versus transient UI state versus Three.js runtime objects.
7. Record the fixed world-unit, OutputCamera/editor-navigation, render-layer, color-space, offscreen-export, and preview-equals-export contracts from Section 2.
8. Set MVP UI copy to Korean-first without adding an internationalization framework; localization is post-MVP.
9. Record the MVP exclusions from this plan.
10. Initialize Git with `git init`, add a focused `.gitignore`, and create the first commit.

**Validation:**

```bash
git status --short
```

Expected: clean after commit, with the product and architecture decisions represented in tracked Markdown files.

**Proposed commit:** `docs: define I2V scene helper MVP`

**Exit gate:** No coding session starts until every acceptance criterion can be judged pass/fail.

---

## Session S01 — Bootstrap the browser application and quality gates

**Session title:** `S01 Web scaffold`

**Objective:** Establish a minimal React/TypeScript app with reproducible test, lint, typecheck, build, and E2E commands.

**Files:**
- Create: `package.json`, `package-lock.json`, `index.html`
- Create: `tsconfig.json`, `tsconfig.app.json`, `vite.config.ts`
- Create: `eslint.config.js`, `.prettierrc.json`, `.gitignore`
- Create: `playwright.config.ts`
- Create: `src/main.tsx`, `src/app/App.tsx`, `src/app/App.css`
- Create: `src/test/setup.ts`
- Create: `src/app/App.test.tsx`
- Create: `e2e/smoke.spec.ts`
- Create: `README.md`
- Create: `docs/session-handoffs/S01.md`

**Tasks:**

1. Scaffold Vite React TypeScript without accepting unrelated template files.
2. Install runtime dependencies: `react`, `react-dom`, `three`, `@react-three/fiber`, `@react-three/drei`, `zustand`, and `zod`.
3. Install development dependencies for Vitest, Testing Library, Playwright, ESLint, Prettier, TypeScript, `start-server-and-test`, `pngjs`, and `pixelmatch`; the last two provide deterministic PNG dimension/pixel assertions without browser screenshot guesswork.
4. Pin mutually compatible React, Three.js, R3F, Drei, Vite, TypeScript, and Playwright versions in the lockfile; document the supported Node range instead of assuming every future Node release works.
5. Add scripts: `dev`, `build`, `preview`, `test`, `test:watch`, `test:e2e`, `test:e2e:preview`, `typecheck`, `lint`, and `format:check`. `test:e2e:preview` must build, serve the production preview on a fixed local port, wait for readiness, run Playwright against that URL, and clean up the server.
6. Write a failing component test that expects the product name and then implement the minimal app shell to pass it.
7. Configure Playwright's Chromium project for reproducible local WebGL and document whether CI uses hardware WebGL or SwiftShader; fail with a diagnostic rather than silently skipping WebGL coverage.
8. Add a Playwright smoke test that loads `/`, sees the app heading, and confirms WebGL availability or the explicit fallback message.
9. Document setup commands in `README.md`.
10. Exclude `node_modules`, `dist`, Playwright output, coverage, and local environment files.

**Validation:**

```bash
npm run typecheck
npm run lint
npm run test -- --run
npm run build
npm run test:e2e
```

Expected: all commands exit `0`; E2E reports one passing smoke test.

**Proposed commit:** `chore: bootstrap browser scene editor`

**Exit gate:** A clone can be installed and validated using only README commands.

---

## Session S02 — Define the serializable scene document and editor store

**Session title:** `S02 Scene state model`

**Objective:** Build the state foundation independently of Three.js rendering.

**Files:**
- Create: `src/editor/types.ts`
- Create: `src/editor/constants.ts`
- Create: `src/editor/state/editorStore.ts`
- Create: `src/editor/state/editorStore.test.ts`
- Create: `src/editor/persistence/sceneSchema.ts`
- Create: `src/editor/persistence/sceneSchema.test.ts`
- Create: `src/editor/presets/aspectRatios.ts`
- Create: `src/editor/presets/cameras.ts`
- Create: `src/editor/presets/lighting.ts`
- Create: `docs/session-handoffs/S02.md`

**Tasks:**

1. Define stable IDs and plain-data vector/transform types in meters; do not store `THREE.Object3D`, cameras, renderers, DOM nodes, or functions in the document.
2. Define a versioned Zod schema and inferred `SceneDocument` type together in `sceneSchema.ts`; `types.ts` contains only supporting/transient types and must not duplicate the document contract. Include object `color` and `visible`, an exportable floor object, OutputCamera `{position, target, focalLengthMm, rollDeg}`, lighting/background, output settings, optional subject/camera motion-guide records, and the capped scene-notes field that S10 will expose.
3. Fix `filmGaugeMm = 36`, mannequin reference height `1.7`, render-layer IDs, safe-area insets, and storage namespace as documented constants rather than repeated literals.
4. Keep selected object, active transform mode, guide visibility, dirty state, editor navigation, in-progress transform, and export state as transient editor state.
5. Define the document mutation allowlist that will enter history: add/delete/duplicate, committed transform, object property changes, camera commit, lighting/background, ratio/output, and motion metadata. Selection/hover/panel/export progress never enter history.
6. Shape transform actions around `beginTransform()` and `commitTransform(finalTransform)` so a later gizmo drag can produce exactly one history entry; do not design an API that requires 60fps store writes.
7. Implement actions for add, select, committed transform, color, visibility, rename, duplicate, delete, and reset.
8. Add deterministic default-scene and object factories with injectable IDs. The starter scene contains floor, mannequin, neutral light/background, and the eye-level `50mm` OutputCamera.
9. Write unit tests first for schema acceptance/rejection and every store transition, including selection cleanup after delete, unique IDs after duplicate, valid positive scale, and starter-scene invariants.
10. Add typed preset tables for ratios, lenses, camera shots, and lighting. Preset tables describe serializable values; R3F mapping is deferred.

**Validation:**

```bash
npm run test -- src/editor/state/editorStore.test.ts src/editor/persistence/sceneSchema.test.ts --run
npm run typecheck
npm run lint
npm run build
```

Expected: store tests pass without creating a WebGL context.

**Proposed commit:** `feat: define serializable scene editor state`

**Exit gate:** The complete MVP document is schema-validated JSON-safe data, and its camera/history/export boundaries are fixed before any R3F implementation.

---

## Session S03 — Build the editor shell and responsive desktop layout

**Session title:** `S03 Editor shell`

**Objective:** Create the application layout and connect panels to store data without implementing 3D objects yet.

**Files:**
- Create: `src/editor/components/EditorShell.tsx`
- Create: `src/editor/components/TopToolbar.tsx`
- Create: `src/editor/components/AssetPanel.tsx`
- Create: `src/editor/components/Outliner.tsx`
- Create: `src/editor/components/Inspector.tsx`
- Create: `src/editor/components/StatusBar.tsx`
- Create: `src/editor/components/EditorShell.test.tsx`
- Modify: `src/app/App.tsx`, `src/app/App.css`
- Create: `docs/session-handoffs/S03.md`

**Tasks:**

1. Implement the three-column desktop layout: assets/outliner, viewport, inspector.
2. Add toolbar controls for new scene, aspect ratio, guides, save/load, and export. Hide undo/redo until S08 rather than shipping inert placeholders.
3. Render the store’s object list and selection in the outliner.
4. Render transform numeric inputs in the inspector, disabled when nothing is selected.
5. Add Korean-first starter-scene guidance and a clear “기본 장면으로 초기화” action; do not present a blank-canvas dead end.
6. Add semantic labels and keyboard-focus styles to all interactive controls.
7. At widths below the supported desktop minimum, display a clear “desktop viewport required” notice rather than a broken editor.
8. Test selection and panel-state behavior with React Testing Library.

**Validation:**

```bash
npm run test -- src/editor/components/EditorShell.test.tsx --run
npm run typecheck
npm run lint
npm run build
```

Manual check: at 1280×720, toolbar and primary panels remain visible without horizontal page scrolling.

**Proposed commit:** `feat: add scene editor workspace shell`

**Exit gate:** The entire non-3D interaction structure is visible and store-connected.

---

## Session S04 — Render primitives and the mannequin in the 3D viewport

**Session title:** `S04 Scene viewport`

**Objective:** Replace the placeholder with an interactive Three.js viewport driven solely by the scene document.

**Files:**
- Create: `src/editor/scene/SceneViewport.tsx`
- Create: `src/editor/scene/OutputCamera.tsx`
- Create: `src/editor/scene/EditorNavigation.tsx`
- Create: `src/editor/scene/SceneObject.tsx`
- Create: `src/editor/scene/Mannequin.tsx`
- Create: `src/editor/scene/sceneObjectModel.test.ts`
- Create: `e2e/viewport.spec.ts`
- Modify: `src/editor/components/EditorShell.tsx`
- Modify: `src/editor/components/AssetPanel.tsx`
- Create: `docs/session-handoffs/S04.md`

**Tasks:**

1. Add an R3F `Canvas` with sRGB output, neutral background, bounded shadows, document floor, and editor-only grid/axes on layer `1`.
2. Render the framed preview through a runtime mirror of the document OutputCamera. Orbit/pan manipulates transient editor navigation and commits camera data only on control end; export will never read uncommitted orbit state.
3. Map serializable object types to cube, sphere, cylinder, plane, and grouped mannequin geometry with color/visibility support.
4. Build the `1.7m` mannequin only from primitives; no rig, animation, or external model. Resolve child-mesh raycasts back to the mannequin root object ID.
5. Add objects from the asset panel at a deterministic visible position measured in meters.
6. Select an object by clicking its mesh or its outliner row; click empty space to clear selection.
7. Give selected objects an editor-only layer-`1` outline/helper using Drei `Outlines` or a dedicated overlay object; never mutate the scene material to indicate selection.
8. Ensure each rendered object has a stable test/display name.
9. Unit-test only pure mapping/bounds helpers. Use Playwright for actual Canvas startup, WebGL rendering, raycast selection, root-group selection, and visibility.

**Validation:**

```bash
npm run test -- src/editor/scene/sceneObjectModel.test.ts --run
npm run test:e2e -- --grep "viewport"
npm run test -- --run
npm run typecheck
npm run lint
npm run build
```

Manual check: all five asset types and the real floor appear, can be selected, cast/receive expected shadows, and remain synchronized with the outliner; grid/axes remain visibly editor-only.

**Proposed commit:** `feat: render editable primitive scene objects`

**Exit gate:** Scene data and rendered geometry remain one-way synchronized from the store.

---

## Session S05 — Add object transforms, inspector editing, and keyboard actions

**Session title:** `S05 Object manipulation`

**Objective:** Make scene composition practical with gizmos, numeric edits, and essential keyboard operations.

**Files:**
- Create: `src/editor/scene/SelectionTransformControls.tsx`
- Modify: `src/editor/scene/SceneViewport.tsx`
- Modify: `src/editor/components/Inspector.tsx`
- Modify: `src/editor/components/TopToolbar.tsx`
- Modify: `src/editor/state/editorStore.ts`
- Modify: `src/editor/state/editorStore.test.ts`
- Create: `src/editor/components/Inspector.test.tsx`
- Create: `e2e/manipulation.spec.ts`
- Create: `docs/session-handoffs/S05.md`

**Tasks:**

1. Integrate Drei `TransformControls` for translate, rotate, and scale modes.
2. Attach/detach controls only to a valid selected root `Object3D`; guard selection changes and grouped mannequin children.
3. Disable orbit controls while dragging a transform gizmo.
4. On drag start call `beginTransform()`. During drag mutate only the attached runtime `Object3D`; do not dispatch Zustand document updates per frame. On drag end call `commitTransform(finalTransform)` exactly once.
5. Add numeric position, rotation-in-degrees, and strictly positive scale fields with finite-number validation. Keep draft input locally and commit on blur/Enter rather than on every keystroke.
6. Add minimal object color and visibility controls; no material editor.
7. Add keyboard shortcuts: `W/E/R`, Delete/Backspace, `Cmd/Ctrl+D`, and Escape.
8. Ignore scene shortcuts while `input`, `textarea`, `select`, or contenteditable elements have focus.
9. Add duplicate and delete toolbar/inspector actions.
10. Test one-history-ready transform commit per drag, scale/NaN rejection, duplicate, delete, visibility/color, and focus guards. Use Playwright for actual gizmo/orbit interaction.

**Validation:**

```bash
npm run test -- src/editor/state/editorStore.test.ts src/editor/components/Inspector.test.tsx --run
npm run test:e2e -- --grep "manipulation"
npm run test -- --run
npm run typecheck
npm run lint
npm run build
```

Manual check: gizmo and inspector edits stay synchronized, and camera orbit never fights gizmo drag.

**Proposed commit:** `feat: add object transform workflow`

**Exit gate:** A user can construct and revise a basic composition without editing JSON.

---

## Session S06 — Implement cinematic camera controls and composition guides

**Session title:** `S06 Camera composition`

**Objective:** Provide the camera/framing controls that make the app useful for I2V start frames.

**Files:**
- Modify: `src/editor/scene/OutputCamera.tsx`
- Modify: `src/editor/scene/EditorNavigation.tsx`
- Create: `src/editor/scene/cameraMath.ts`
- Create: `src/editor/scene/cameraMath.test.ts`
- Create: `src/editor/scene/CompositionGuides.tsx`
- Create: `src/editor/scene/CompositionGuides.test.tsx`
- Create: `e2e/camera.spec.ts`
- Modify: `src/editor/scene/SceneViewport.tsx`
- Modify: `src/editor/components/TopToolbar.tsx`
- Modify: `src/editor/components/Inspector.tsx`
- Modify: `src/editor/state/editorStore.ts`
- Create: `docs/session-handoffs/S06.md`

**Tasks:**

1. Complete the fixed camera contract from S02: OutputCamera is document-owned, editor navigation is transient, and control-end/explicit camera actions are the only camera commit boundaries.
2. Implement pure `computeLetterbox(viewportWidth, viewportHeight, outputAspect)` contain math. The camera aspect always equals output aspect; the CSS/viewport frame masks everything outside the returned rectangle without stretching.
3. Implement aspect presets `16:9`, `9:16`, `1:1`, and `2.39:1` using that tested letterbox rectangle.
4. Set `filmGauge = 36` and implement `18`, `24`, `35`, `50`, and `85mm` with `camera.setFocalLength(focalLengthMm)`; do not use aspect-dependent guessed FOV constants.
5. Add shot presets: eye-level medium, full-body, low angle, high angle, close-up, and Dutch angle. Compute distance/target from subject bounds or the `1.7m` reference height rather than magic coordinates.
6. Add “frame selected” and “look at selected” actions; when no object is selected, leave the camera unchanged and announce a status message.
7. Add an editor-only forward/facing axis helper for the selected subject on layer `1`.
8. Draw thirds, center/crosshair, action-safe `5%`, and title-safe `10%` guides as DOM/editor overlays, not scene meshes.
9. Add toggles for individual guides and one “hide all guides” action.
10. Unit-test letterbox math, focal-length application, bounds-based shot calculations, and guide geometry. Use Playwright to verify portrait/landscape framing and that browser resize does not change the output-camera crop.

**Validation:**

```bash
npm run test -- src/editor/scene/cameraMath.test.ts src/editor/scene/CompositionGuides.test.tsx --run
npm run test:e2e -- --grep "camera"
npm run test -- --run
npm run typecheck
npm run lint
npm run build
```

Manual check: changing ratio changes framing rather than stretching the rendered image; lens changes visibly affect perspective.

**Proposed commit:** `feat: add cinematic camera and framing guides`

**Exit gate:** A user can intentionally create a portrait or landscape cinematic framing with known lens metadata.

---

## Session S07 — Add lighting and background presets

**Session title:** `S07 Lighting presets`

**Objective:** Let users establish readable shape and mood without editing individual Three.js light objects.

**Files:**
- Create: `src/editor/scene/LightingRig.tsx`
- Modify: `src/editor/presets/lighting.ts`
- Create: `src/editor/presets/lighting.test.ts`
- Create: `e2e/lighting.spec.ts`
- Modify: `src/editor/scene/SceneViewport.tsx`
- Modify: `src/editor/components/Inspector.tsx`
- Modify: `src/editor/state/editorStore.ts`
- Create: `docs/session-handoffs/S07.md`

**Tasks:**

1. Define a compact serializable lighting model: environment intensity, key/fill/rim intensity/color/direction, background color, and shadow softness settings supported by the renderer.
2. Add restrained presets: neutral studio, daylight, sunset, night, and cinematic backlight. Defer horror styling unless user testing proves it necessary.
3. Render a stable key/fill/rim rig with at most one shadow-casting key light and a capped `1024×1024` shadow map for MVP browser performance.
4. Expose preset, exposure, background color, key direction, and shadow toggle controls.
5. Add a reset-to-preset action that does not alter camera or objects.
6. Unit-test pure preset application and state isolation; do not mount a WebGL Canvas in jsdom.
7. Use Playwright/manual visual checks to verify every preset is distinct and none creates an entirely black default composition.

**Validation:**

```bash
npm run test -- src/editor/presets/lighting.test.ts --run
npm run test:e2e -- --grep "lighting"
npm run test -- --run
npm run typecheck
npm run lint
npm run build
```

Manual check: every preset is visually distinct and keeps the mannequin readable.

**Proposed commit:** `feat: add cinematic lighting presets`

**Exit gate:** Lighting can be changed in one or two interactions without exposing low-level Three.js concepts.

---

## Session S08 — Add undo/redo and safe scene persistence

**Session title:** `S08 History and persistence`

**Objective:** Make experimentation recoverable and scenes portable without introducing a backend.

**Files:**
- Create: `src/editor/state/history.ts`
- Modify: `src/editor/state/editorStore.ts`
- Modify: `src/editor/state/editorStore.test.ts`
- Create: `src/editor/persistence/sceneCodec.ts`
- Create: `src/editor/persistence/sceneCodec.test.ts`
- Modify: `src/editor/components/TopToolbar.tsx`
- Create: `docs/session-handoffs/S08.md`

**Tasks:**

1. Implement a bounded `50`-entry undo/redo stack using the mutation allowlist fixed in S02; exclude selection, hover, panel state, transient navigation, and rendering/export state.
2. Consume the S05 `beginTransform`/`commitTransform` boundary so a continuous gizmo drag creates one history entry.
3. Add `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` shortcuts with input-focus guards.
4. Reuse the S02 versioned Zod schema to implement encode, parse, validation, and one placeholder migration boundary; do not duplicate the document type or overbuild migrations.
5. Use localStorage deliberately for the primitive-only MVP with a documented namespaced key and approximate size limit. Add debounced autosave and actionable `QuotaExceededError` handling; revisit IndexedDB only when binary assets enter scope.
6. Warn with `beforeunload` only while a document change is dirty and not yet persisted.
7. Add JSON download and file import.
8. Parse and validate imported JSON completely before replacing current state or touching autosave. On failure, preserve both and show an actionable error.
9. Test history bounds/allowlist, one-entry transform undo, round-trip serialization, malformed JSON, unknown version, quota failure, and import/autosave preservation.

**Validation:**

```bash
npm run test -- src/editor/state/editorStore.test.ts src/editor/persistence/sceneCodec.test.ts --run
npm run test -- --run
npm run typecheck
npm run lint
npm run build
```

Manual check: refresh restores the scene; malformed import shows an error and leaves both the live scene and valid autosave untouched.

**Proposed commit:** `feat: add scene history and local persistence`

**Exit gate:** Users can safely explore, undo mistakes, close the tab, and share a scene JSON file.

---

## Session S09 — Export exact-resolution clean PNG frames

**Session title:** `S09 Frame export`

**Objective:** Produce the actual MVP deliverable: a clean I2V start-frame image at an exact requested resolution.

**Files:**
- Create: `src/editor/export/exportFrame.ts`
- Create: `src/editor/export/exportFrame.test.ts`
- Create: `src/editor/components/ExportDialog.tsx`
- Create: `src/editor/components/ExportDialog.test.tsx`
- Modify: `src/editor/scene/SceneViewport.tsx`
- Modify: `src/editor/components/TopToolbar.tsx`
- Modify: `src/editor/state/editorStore.ts`
- Create: `docs/session-handoffs/S09.md`

**Tasks:**

1. Define output presets including `1280×720`, `1920×1080`, `1080×1920`, square, cinematic, and validated custom dimensions.
2. Restrict custom output dimensions to `64..4096` pixels and lock them to the active output aspect: editing width recalculates height and vice versa. Reject rather than silently stretch an aspect mismatch.
3. Implement a deterministic offscreen `WebGLRenderTarget` path at exact pixel dimensions and `pixelRatio = 1`; do not use the composited editor canvas or `toDataURL()` as the primary export source.
4. Reconstruct the export camera from the saved OutputCamera, render synchronously, read render-target pixels, vertically orient them, and encode with a temporary 2D canvas `toBlob()` path. Wrap target/layer/color-state changes in `try/finally` and dispose temporary GPU resources.
5. Clean export renders layer `0` only. Reference export may render layers `0+2` and composites the same percentage-based composition guides into the 2D output canvas; layer `1` grid/axes/gizmo/selection is never exported.
6. Add an export dialog with filename, dimensions, clean/reference mode, and busy/error state; default remains clean.
7. Trigger a real browser download with a sanitized filename.
8. Unit-test dimensions/aspect lock, filename generation, clean/reference layer masks, GPU/resource restoration when capture throws midway, and helper visibility flags.
9. Add Playwright tests that decode downloads with `pngjs`, verify signature/dimensions, prove clean/reference pixels differ, and export the same static scene before/after browser resize. Compare the two static exports with `pixelmatch` and require a mismatch ratio no greater than `0.1%`; if the renderer cannot meet that threshold, document and justify a stable platform-specific threshold rather than weakening the test silently.

**Validation:**

```bash
npm run test -- src/editor/export/exportFrame.test.ts src/editor/components/ExportDialog.test.tsx --run
npm run test:e2e -- --grep "export"
npm run test -- --run
npm run typecheck
npm run lint
npm run build
```

Expected: downloaded image dimensions exactly match the selected preset, framing is independent of viewport/DPR, clean output contains only layer `0`, and every temporary render resource/state is restored after success or failure.

**Proposed commit:** `feat: export I2V start frames as PNG`

**Exit gate:** The browser can produce a usable start-frame file without a server or manual screenshot cropping.

---

## Session S10 — Add I2V motion-direction guides and composition polish

**Session title:** `S10 I2V guides`

**Objective:** Add the smallest I2V-specific differentiator without turning the editor into an animation application.

**Files:**
- Create: `src/editor/scene/MotionGuides.tsx`
- Create: `src/editor/state/motionGuides.test.ts`
- Modify: `src/editor/state/editorStore.ts`
- Modify: `src/editor/persistence/sceneSchema.test.ts`
- Modify: `src/editor/components/Inspector.tsx`
- Modify: `src/editor/scene/SceneViewport.tsx`
- Modify: `src/editor/export/exportFrame.ts`
- Create: `e2e/motion-guides.spec.ts`
- Create: `docs/session-handoffs/S10.md`

**Tasks:**

1. Allow one subject-motion vector for a selected object and one camera-motion vector for the scene.
2. Render readable layer-`2` reference arrows with labels and adjustable direction/strength; strength is descriptive, not a physical unit.
3. Add presets for left/right/up/down/forward/back and camera pan/tilt/dolly/orbit labels.
4. Keep scope to one subject arrow and one camera arrow; remove the ambiguous “movement space” overlay from MVP.
5. Populate the optional S02 motion-guide and scene-notes schema fields; do not introduce a second document type or silently bump the schema for fields already reserved from the start.
6. Keep all motion guides hidden in clean PNG exports and visible only in explicit reference exports.
7. Add a compact scene-notes field capped at `2000` characters for an I2V prompt/motion note; store it in JSON but do not call an AI API.
8. Unit-test guide state, selected-object ownership, deletion cleanup, note limit, and layer/export policy. Use Playwright for actual arrow rendering/reference export.

**Validation:**

```bash
npm run test -- src/editor/state/motionGuides.test.ts src/editor/persistence/sceneSchema.test.ts --run
npm run test:e2e -- --grep "motion guides"
npm run test -- --run
npm run typecheck
npm run lint
npm run build
```

Manual check: a user can communicate “subject moves right while camera dollies in” in the reference view, while the clean exported start frame remains unaffected.

**Proposed commit:** `feat: add I2V motion direction guides`

**Exit gate:** The app communicates intended motion without implementing a timeline or simulation.

---

## Session S11 — Complete E2E coverage, accessibility, and resilience

**Session title:** `S11 MVP hardening`

**Objective:** Verify the complete product flow and fix only issues that block the MVP contract.

**Files:**
- Expand: `e2e/editor.spec.ts`
- Modify: editor files only as failures require
- Modify: `README.md`
- Create: `docs/session-handoffs/S11.md`

**Tasks:**

1. Add a golden-path E2E test:
   - Open the starter scene and verify its mannequin/floor/neutral camera and light.
   - Add a cube.
   - Select and transform the cube.
   - Choose `9:16`, `35mm`, a camera preset, and a lighting preset.
   - Toggle guides.
   - Save/reload.
   - Export `1080×1920` clean PNG.
2. Add failure-path E2E coverage proving malformed JSON import preserves both the current scene and the prior valid autosave.
3. Export the same static saved scene before/after browser resize and require equal dimensions plus the S09 `pixelmatch` mismatch threshold; separately prove clean/reference pixels differ.
4. Add keyboard-only checks for asset creation, outliner selection, inspector editing, and export-dialog cancellation, including shortcut no-ops while form controls/contenteditable have focus.
5. Audit labels, focus order, contrast, modal focus trapping, visible focus indicators, and an `aria-live` status for selection/mode/camera no-op feedback.
6. Verify no uncaught console errors during the golden path.
7. Exercise a `50`-primitive scene and record orbit responsiveness and `1080p` export time; treat export slower than `3s` on the documented baseline machine as a performance issue, and optimize only demonstrated bottlenecks.
8. Add an error boundary plus WebGL-unavailable/context-loss message that preserves serialized scene data.
9. Build an acceptance-evidence matrix in the handoff mapping every Section 2 criterion to a unit test, E2E test, or named manual check.
10. Run a timed manual test confirming a first-time user can complete the starter-to-portrait-export flow within three minutes.
11. Update README with product screenshots only if generated from the real app, plus usage, browser support, test commands, and limitations.

**Validation:**

```bash
npm run format:check
npm run typecheck
npm run lint
npm run test -- --run
npm run test:e2e
npm run build
npm run test:e2e:preview
git diff --check
git status --short
```

Expected: all automated checks pass against both development and production-preview servers; working tree is clean after commit.

**Proposed commit:** `test: harden I2V scene helper MVP`

**Exit gate:** Every MVP acceptance criterion in Section 2 has objective evidence, and the production build passes the golden path through `npm run preview`. Functional MVP completion occurs here.

---

## Session S12 — Optional deployment and release candidate verification

**Session title:** `S12 Browser release`

**Objective:** After the user selects a static host, publish the already-validated browser build and verify the deployed release candidate. This session is optional and is not part of functional MVP completion.

**Files:**
- Create one deployment configuration only if needed by the selected static host
- Modify: `README.md`
- Create: `docs/release-checklist.md`
- Create: `docs/session-handoffs/S12.md`

**Tasks:**

1. Confirm the user-selected static deployment target and repository visibility; do not silently default to a public host.
2. Configure Vite base paths only if required by that host.
3. Run a production build and serve `dist` locally with `npm run preview`.
4. Run Playwright against the production preview, not only the Vite development server.
5. Verify browser storage, JSON import/export, and PNG download on the production build.
6. Document deployment and rollback commands.
7. Tag only after the user approves the release candidate.

**Validation:**

```bash
npm run typecheck
npm run lint
npm run test -- --run
npm run build
npm run test:e2e:preview
```

Expected: production preview passes the same golden flow as development.

**Proposed commit:** `chore: prepare browser MVP release`

**Exit gate:** A user can open the deployed URL in a supported desktop browser and complete the golden path; deployment approval remains separate from S11 functional MVP acceptance.

---

## 6. Review and subagent strategy

Within each Hermes implementation session:

1. The primary agent owns scope, integration, and all final verification.
2. Delegate at most one implementation workstream and one independent review workstream at a time; this small codebase does not justify broad parallel edits.
3. A leaf subagent receives the exact session objective, relevant file paths, acceptance tests, and current handoff. It must return concrete file paths and actual test output.
4. After implementation, use a fresh reviewer for:
   - Spec compliance: did the session satisfy only its stated contract?
   - Code quality: state boundaries, React/R3F lifecycle safety, accessibility, and tests.
5. The primary agent independently reads the diff and reruns the required commands before reporting completion.
6. Do not use different models merely for novelty. If model-specialized independent agents are desired, run separate Hermes processes; `delegate_task` cannot select a different model per child.

## 7. Main technical risks and mitigations

| Risk | Mitigation |
|---|---|
| React state and Three.js runtime drift apart | Keep the document JSON-safe and renderer one-way derived from store state; isolate refs/runtime objects in scene components. |
| Transform gizmo floods history and React updates | Mutate only runtime Object3D during drag; commit once on drag end and coalesce into one history action. |
| OutputCamera and editor orbit drift apart | Keep OutputCamera in the document, navigation transient, commit only at named boundaries, and export from a reconstructed document camera. |
| Camera ratio implementation stretches output | Use tested contain-letterbox math with camera aspect fixed to output aspect; require preview frame = PNG frame. |
| Focal length semantics drift by aspect | Fix `filmGauge=36`, store focal length in millimeters, and test `setFocalLength` behavior. |
| Floor disappears from PNG | Store a real default floor on content layer `0`; keep grid/axes on editor layer `1`. |
| High-resolution capture changes the interactive viewport | Render to an exact-size offscreen target with DPR `1`; restore/dispose state and resources in `try/finally`. |
| Editor helpers leak into exports | Reserve layers `0/1/2`, centralize export policy, and E2E-check clean versus reference downloads. |
| Invalid JSON destroys current work | Validate fully before store replacement and retain current document on error. |
| Invalid import poisons autosave | Do not replace live/autosave state until complete schema validation succeeds. |
| LocalStorage schema/quota failure | Include schema version/migration boundary, primitive-only size rationale, and explicit quota-error UX. |
| Scope expands toward Blender | Enforce the exclusions list and require a post-MVP decision for any mesh/animation feature. |
| WebGL is unavailable or context is lost | Show a recoverable error state and retain serialized scene data. |
| R3F tests become brittle in jsdom | Unit-test pure state/math/schema/DOM controls only; use Playwright for real browser/WebGL behavior. |
| Headless Playwright lacks WebGL | Pin/document Chromium WebGL strategy and fail with a diagnostic instead of silently skipping coverage. |

## 8. Open decisions that do not block S00–S11

- Final product name and visual identity.
- Static hosting provider and repository visibility.
- Whether post-MVP GLB import is worth its asset-management complexity.
- Whether later AI styling should be a direct API integration or an export workflow into another image-generation app.
- Whether PWA/offline installation is valuable after the web MVP is validated.

## 9. Post-MVP candidates — do not implement in these sessions

1. GLB/GLTF import with asset validation and bounds normalization.
2. Image planes/reference boards.
3. Start/end pose ghosting and camera path preview.
4. Depth-of-field and restrained post-processing.
5. Scene/template gallery.
6. Prompt metadata packages for specific I2V models.
7. PWA offline support.
8. Optional AI image-stylization integration.

## 10. Completion definition

The functional MVP is complete at S11 when a clean production build served through `npm run preview` proves the following end to end. A public deployment in optional S12 is a separate release decision:

> A new user opens the browser app, adjusts the starter mannequin and adds props, establishes a 9:16 cinematic camera/lighting composition, indicates intended subject and camera motion, saves the scene, and downloads an exact 1080×1920 clean PNG suitable as an I2V start frame—without installing a desktop application or using a backend.
