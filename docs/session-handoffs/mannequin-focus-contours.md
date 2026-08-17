# Mannequin focus-check contours

## Phase boundary

- Session: `20260817_154917_2584cc`
- Worktree: `/Users/js/Documents/3d-scene-helper-worktrees/mannequin-focus-contours`
- Branch: `feat/mannequin-focus-contours`
- Starting HEAD: `534e41862a2627ba832cd4b5592ecd3baad21887`
- Intended single commit: `feat: add mannequin focus contours`
- Final commit SHA is intentionally recorded in the post-commit completion response; a commit cannot contain its own cryptographic identity.

## Delivered contract

- Added global JSON-safe `mannequinAppearance.focusContoursEnabled` state. New and legacy/current-version documents default/migrate to `false`.
- Added one no-op-safe, undoable/redoable `update-mannequin-appearance` mutation. Reapplying the current value does not add history or replace the document.
- Added the accessible Camera > Cinematic DOF checkbox `마네킹 초점 확인 등고선`. It remains operable and stored independently of DOF enabled state and f-stop.
- Every mannequin owns three stable matte `MeshStandardMaterial` instances: axial, limb, and joint. Enabled state changes uniforms only; it does not allocate materials or request shader recompilation.
- Surface shader policy:
  - head/torso-family axial spacing: `0.10 m`;
  - limb/joint spacing: `0.0725 m`;
  - line widths: `0.006 m` axial, `0.005 m` limb, `0.0045 m` centerline;
  - line color: `#30343a`, blended `42%` against each instance tint;
  - roughness `0.58`, metalness `0`, same-color emissive intensity `0.06` preserved from the previous mannequin material.
- Contours are mixed into `diffuseColor` inside the mannequin surface shader before the existing EffectComposer/BokehPass. They are not DOM, Canvas 2D, helper-layer, or post-DOF overlays.
- User-corrected export policy is implemented: enabled contours appear in live viewport, Clean PNG, and Reference PNG. Toggle off removes them from all three. Clean/Reference still retain their unrelated existing guide policies.
- Test-only runtime diagnostics enumerate every mannequin's eligible surfaces and material UUIDs. The ordinary production build excludes those diagnostics.

## TDD ledger

Focused RED commands observed before production implementation:

- `npm test -- --run src/editor/persistence/sceneSchema.test.ts src/editor/persistence/sceneCodec.test.ts` → exit 1 before the schema/default path existed.
- `npm test -- --run src/editor/state/editorStore.test.ts` → exit 1 before the global setter/history mutation existed.
- `npm test -- --run src/editor/components/Inspector.test.tsx` → exit 1 before the accessible Camera toggle existed.
- `npm test -- --run src/editor/mannequin/mannequinFocusContours.test.ts` → exit 1 before the material/pattern module existed.
- `npm run test:e2e -- e2e/mannequin-focus-contours.spec.ts --workers=1` → exit 1 before runtime propagation diagnostics/material integration existed.
- The first 85mm export fixture run also failed on an incorrect test locator for the existing `깨끗한 프레임` accessible label; the locator was corrected without changing production behavior, then the real export/pixel assertions ran GREEN.

Focused GREEN:

- `npm test -- --run src/editor/persistence/sceneSchema.test.ts src/editor/persistence/sceneCodec.test.ts src/editor/state/editorStore.test.ts src/editor/components/Inspector.test.tsx src/editor/mannequin/mannequinFocusContours.test.ts src/editor/export/exportFrame.test.ts`
  - 6 files passed, 107 tests passed.
- `npm run test:e2e -- e2e/mannequin-focus-contours.spec.ts --workers=1`
  - 2 Chromium tests passed.
  - Includes autosave/reload, all-mannequin scope, stable material UUIDs, DOF independence, exact Clean/Reference downloads, selection exclusion, and the 85mm OTS pixel controls.

## Actual Chromium and decoded-PNG evidence

Fixture:

- 1280×720 exact exports;
- OutputCamera 85 mm;
- manual f/1.6;
- gray target on the focus plane;
- close red foreground mannequin forming the OTS foreground;
- fixed geometry, camera, lighting, material, and framing for on/off controls.

Measured values:

- Clean enabled versus disabled contour delta: `0.0358072917` (`3.580729%` of pixels).
- Reference enabled versus disabled contour delta: `0.0358072917` (`3.580729%`).
- Clean versus Reference mismatch with unrelated guides off:
  - contours enabled: `0`;
  - contours disabled: `0`.
- Clean selected versus deselected mismatch: `0`.
- DOF-enabled contour sharpness:
  - gray target: `0.9256881848`;
  - red foreground: `0.1025007633`;
  - target/foreground ratio: `9.0310×`.
- DOF-disabled negative control:
  - gray: `0.9205922784`;
  - red: `0.3820815655`;
  - target/foreground ratio collapses to `2.4094×`;
  - red contour sharpness recovers by `3.7276×`.

Visual inspection:

- Gray target bands and front centerline remain crisp while red foreground bands visibly soften through actual Bokeh DOF.
- DOF-off control makes both subjects' bands sharp at identical geometry/framing.
- The marks read as sparse neutral contour/ring guides, not clothing, dots, checkerboard, or a giant grid.
- No visible moiré, z-fighting, coincident-mesh seams, or broken silhouette was observed.
- Per-instance gray/red tint, matte highlights, front centerline, articulated joints, body silhouette, and foot grounding remain legible.

Evidence directory:

- `/tmp/3d-scene-helper-mannequin-focus-contours/viewport-85mm-ots-contours.png`
- `/tmp/3d-scene-helper-mannequin-focus-contours/clean-85mm-ots-contours-dof.png`
- `/tmp/3d-scene-helper-mannequin-focus-contours/reference-85mm-ots-contours-dof.png`
- `/tmp/3d-scene-helper-mannequin-focus-contours/clean-85mm-ots-no-contours-dof.png`
- `/tmp/3d-scene-helper-mannequin-focus-contours/reference-85mm-ots-no-contours-dof.png`
- `/tmp/3d-scene-helper-mannequin-focus-contours/clean-85mm-ots-contours-no-dof.png`
- `/tmp/3d-scene-helper-mannequin-focus-contours/clean-85mm-ots-no-contours-no-dof.png`

## Export and lifecycle evidence

- `exportFrame.test.ts` proves both Clean and Reference export preserve enabled contour material values, UUIDs, and material versions.
- The same test injects render-target allocation failure and confirms contour material state remains enabled/unchanged.
- Existing renderer-target, viewport/scissor, output color/exposure restoration, target/canvas disposal, DOF pipeline disposal, context-loss, and readback-failure tests remain GREEN.
- Material unit tests prove stable region-specific program cache keys, finite/bounded uniforms, per-instance material identity/tint, toggle updates without `needsUpdate`/version churn, shader injection order, and explicit one-time disposal calls.
- Actual Canvas diagnostics prove every eligible surface of two mannequins changes enabled state while all material UUIDs remain stable; autosave/reload recreates both mannequins in the enabled state.

## Independent review disclosure

Exact-worktree reviews used `agy` 1.1.13 with `gemini-3.6-flash-high` (Gemini 3.6 Flash High), read-only prompts, and before/after diff/untracked SHA-256 checks.

1. Spec-compliance review: `APPROVED: no Important/Critical findings`.
2. Quality/security review initially raised one Important theory that Three.js shared-program caching would retain the first material's uniform objects.
3. The finding was reproduced against installed Three.js 0.185.1 source and rejected: `WebGLRenderer.js` obtains per-material properties/program maps, invokes each new material's `onBeforeCompile`, may reuse the GPU program, then stores that material's own `materialProperties.uniforms`. The gray/red Chromium pixels also demonstrate independent tint-blended uniforms.
4. Narrow quality/security re-review: `APPROVED: no Important/Critical findings` and explicitly withdrew the theory with `WebGLRenderer.js` line evidence.
5. No security findings, secrets, production bridges, or Important/Critical residual findings remain.

## Gates and counts

- Full unit suite: `npm test -- --run` → 20 files, 246 tests passed.
- `npm run typecheck` → passed.
- `npm run lint` → passed.
- `npm run format:check` → passed before this handoff; rerun after writing it is required in closeout.
- First default-parallel `npm run test:e2e:preview` attempt: 74 passed, 3 failed under five-worker resource pressure (one 1080p performance threshold and two gizmo scan timeouts).
- Exact failed tests rerun serially: 3/3 passed; isolated export time was 2551 ms (≤3000 ms).
- Final serial `npm run test:e2e:preview` (temporary local `workers: 1` runner override, restored immediately afterward) → 77/77 Chromium tests passed in 5.7 minutes.
- Ordinary `npm run build` ran after preview E2E → passed; 701 modules transformed; production diagnostic-absence assertion passed.

## Changed files

Production:

- `src/editor/persistence/sceneSchema.ts`
- `src/editor/state/editorStore.ts`
- `src/editor/components/Inspector.tsx`
- `src/editor/mannequin/mannequinFocusContours.ts`
- `src/editor/scene/ArticulatedMannequin.tsx`
- `src/editor/scene/SceneObject.tsx`
- `src/editor/scene/SceneViewport.tsx`

Tests/evidence:

- `src/editor/persistence/sceneSchema.test.ts`
- `src/editor/persistence/sceneCodec.test.ts`
- `src/editor/state/editorStore.test.ts`
- `src/editor/components/Inspector.test.tsx`
- `src/editor/mannequin/mannequinFocusContours.test.ts`
- `src/editor/export/exportFrame.test.ts`
- `e2e/mannequin-focus-contours.spec.ts`
- `docs/session-handoffs/mannequin-focus-contours.md`

## Approximation and known limits

- Physical spacing is scale-corrected in shader space from each part's local coordinates and model-matrix axis lengths. Under unusual combinations of rotated ancestry and strongly non-uniform root scale, it remains an approximate physical guide rather than a UV-unwrapped metrology surface.
- Bands intentionally restart per rigid articulated part. Natural joint boundaries remain visible; no attempt was made to force phase continuity across independently rotating parts.
- The front centerline is limited to axial head/torso-family materials and uses local front depth; limb materials use only circumferential bands to avoid clutter.
- Existing selection outlines may remain sharp by editor policy, but they are excluded from both PNG modes and are not used in contour sharpness measurements.
- The guide offers one global on/off policy only; spacing, line width, color, and opacity are calibrated constants, not new UI scope.

## Scope exclusions preserved

- No change to DOF formula, Bokeh pipeline, f-stop range/semantics, 85 mm optics, target shortcut/IME behavior, mannequin geometry/dimensions, body builds, pose/IK, feet grounding, camera composition, or unrelated guides.
- No Three objects, materials, shaders, uniforms, or render targets enter document state/history.
- No render/export override hides contours from Clean PNG.
- No new server, listener, or long-running process is intended to remain after closeout.
