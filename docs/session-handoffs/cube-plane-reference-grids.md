# Cube·Plane 1m reference grids — session handoff

## Session boundary

- Session ID: `20260814_125641_1198ce`
- Worktree: `/Users/js/Documents/3d-scene-helper-worktrees/cube-plane-reference-grids`
- Branch: `feat/cube-plane-reference-grids`
- Clean starting SHA: `1bc2897c1bf30b8eebd41e98e43bb35761a2d01c`
- Intended single commit message: `feat: add reference grids to cube and plane`
- Scope remained limited to Cube top-face and Plane visible-surface reference grids plus their verification. No primary-lane files or processes were touched.

The final commit SHA cannot be embedded in a file inside that same commit without changing the commit identity. The immutable final SHA is recorded in the post-commit final response.

## Implemented behavior

- Extended the reusable `SurfaceGrid` owner kind union and deterministic diagnostics order to `floor`, `room`, `cube`, and `plane`.
- Mounted the existing finite grid once on the Cube top face at `dimensions.y / 2 + 0.002`; no side or bottom grids were added.
- Mounted the same grid on the Plane surface at `0.002` above its horizontal mesh.
- Reused `createSurfaceGridLines`; no grid geometry logic was duplicated.
- Retained 0.5m minor lines, 1m major classification, contrast hierarchy, raycast disablement, scene/export-layer semantics, runtime world-scale sampling, and explicit `BufferGeometry.dispose()` ownership.
- Added an E2E-only surface-grid visibility event so clean-PNG negative controls can keep scene geometry, camera, lighting, and materials identical while hiding only the grid. The production bridge assertion now forbids that event marker.
- Added/extended real-browser coverage for owner mounting, unsupported kinds, runtime-only scale preview, duplicate counts, visibility/rotation, persistence, clean PNG pixels, and production stripping.
- Applied the two pre-existing Prettier-only normalizations in `src/app/App.test.tsx` required for the repository-wide `format:check`; behavior is unchanged.

## Strict TDD evidence

### Cube owner RED → GREEN

RED command:

```text
npm run test:e2e -- e2e/viewport.spec.ts --grep "surface grids mount only" --workers=1
```

Expected failure observed: after adding Cube, `data-surface-grid-kinds` expected `floor,cube` but received `floor`.

GREEN command:

```text
npm run test:e2e -- e2e/viewport.spec.ts --grep "cube joins surface grid owners" --workers=1
```

Result: `1 passed`.

### Plane owner RED → GREEN

RED command:

```text
npm run test:e2e -- e2e/viewport.spec.ts --grep "plane joins the surface grid owners" --workers=1
```

Expected failure observed: after adding Plane, `data-surface-grid-kinds` expected `floor,plane` but received `floor`.

GREEN command:

```text
npm run test:e2e -- e2e/viewport.spec.ts --grep "(cube joins surface grid owners|plane joins the surface grid owners)" --workers=1
```

Result: `2 passed`.

### Clean-PNG isolation RED → GREEN

RED command:

```text
npm run test:e2e -- e2e/export.spec.ts --grep "Cube clean PNG" --workers=1
```

Expected failure observed: grid-visible versus grid-hidden ratio was `0` before the E2E-only visibility control existed.

GREEN command:

```text
npm run test:e2e -- e2e/export.spec.ts --grep "(Cube|Plane) clean PNG" --workers=1
```

Result: `2 passed` with measured changed-pixel ratios:

- Cube: `0.0014301215277777778`
- Plane: `0.004424913194444445`

## Runtime and pixel evidence

- `npm test -- --run src/editor/scene/surfaceGridGeometry.test.ts` → 1 file, 2 tests passed.
  - Bounded line counts and coordinates.
  - 0.5m world minor spacing under `{ x: 2, z: 0.5 }`.
  - 1m major positions `[-2, -1, 0, 1, 2]` along scaled X.
- `npm run test:e2e -- e2e/manipulation.spec.ts --grep "(Cube|Plane) scale preview" --workers=1` → 2 passed.
  - Line counts increased while pointer remained down.
  - Serialized transform remained unchanged during preview.
  - Runtime transform changed before pointer-up.
- Parallel-load reproduction after the first preview run exposed stale-camera/hover-scan flakiness in the new scale-preview tests. The tests were hardened by waiting for the frame-selected camera/gizmo to be in Canvas bounds, confirming scale mode, and using a render-settled handle scan.
- `npm run test:e2e -- e2e/manipulation.spec.ts --grep "(Cube|Plane) scale preview" --workers=2 --repeat-each=3` → 6 passed.
- `npm run test:e2e -- e2e/persistence.spec.ts e2e/manipulation.spec.ts --grep "(refresh restores|duplicate/delete)" --workers=1` → 2 passed.
- `npm run test:e2e -- e2e/viewport.spec.ts --grep "plane grid follows owner" --workers=1` → 1 passed.
- Relevant real-Canvas/WebGL batch:

```text
npm run test:e2e -- e2e/viewport.spec.ts e2e/manipulation.spec.ts e2e/export.spec.ts e2e/persistence.spec.ts --workers=1
```

Result: `34 passed`.

Actual decoded clean-PNG artifacts:

- `/Users/js/Documents/3d-scene-helper-worktrees/cube-plane-reference-grids/test-results/export-Cube-clean-PNG-isolates-its-top-face-reference-grid-chromium/cube-clean-grid.png`
- `/Users/js/Documents/3d-scene-helper-worktrees/cube-plane-reference-grids/test-results/export-Cube-clean-PNG-isolates-its-top-face-reference-grid-chromium/cube-clean-grid-hidden.png`
- `/Users/js/Documents/3d-scene-helper-worktrees/cube-plane-reference-grids/test-results/export-Plane-clean-PNG-iso-5731b-ible-surface-reference-grid-chromium/plane-clean-grid.png`
- `/Users/js/Documents/3d-scene-helper-worktrees/cube-plane-reference-grids/test-results/export-Plane-clean-PNG-iso-5731b-ible-surface-reference-grid-chromium/plane-clean-grid-hidden.png`

Visual inspection confirmed:

- Cube grid is bounded to the top face; side and bottom faces remain ungridded.
- Plane grid is bounded to the visible plane surface with dark major and lighter minor lines.
- Negative controls preserve the same geometry, camera, lighting, material, and framing while only the grid disappears.
- No z-fighting, leaked world grid, wall/side grid, or editor helper appeared in clean output.

## Full gates

- Dependency setup: `npm ci` → 350 packages installed; lockfile unchanged. npm reported two pre-existing high-severity audit advisories.
- `npm test -- --run` → 16 files, 221 tests passed.
- `npm run typecheck` → passed.
- `npm run lint` → passed.
- `npm run format:check` → passed.
- `npm run build` → passed; 687 modules transformed; production bridge assertion passed.
- `npm run test:e2e:preview` first run → 70 passed, 2 new scale-preview tests failed under five-worker load; this was treated as a real test reliability failure, reproduced, and fixed.
- Focused parallel stability after the fix → 6/6 passed across three repeats.
- `npm run test:e2e:preview` final run → 72 passed with five workers.
- Ordinary `npm run build` was rerun after preview E2E → passed; production `dist` excludes E2E diagnostics and retains the `surface-grid` runtime content.

Build emitted only the repository's existing chunk-size advisory; no build error occurred.

## Independent review disclosure

Reviewer: Antigravity CLI using `gemini-3.6-flash-high` / Gemini 3.6 Flash (High).

- Spec review: PASS, no Critical/Important/Minor findings.
- Initial quality invocation returned unusable output; retry accidentally resolved the dirty primary worktree and was explicitly discarded as invalid.
- Quality review was rerun from `/tmp` with the exact external worktree added and a fail-closed path requirement. It reported the exact reviewed worktree `/Users/js/Documents/3d-scene-helper-worktrees/cube-plane-reference-grids`, verdict PASS, and no Important-or-higher findings. One non-blocking observation described the intentional serialized-scale initialization followed by per-frame runtime world-scale sampling.
- Pre-review added-line security scan: clean.
- Pre-review binary diff SHA-256 before the later test-stability/handoff edits: `9a32008711e7abee6bf285b78258bad431b445408adf2b51a055f10f453ecd58`.

Because the parallel-load test hardening and this handoff were written after that snapshot, closeout requires an exact-worktree closure review of the final diff before commit.

## Closeout still required

1. Exact-worktree Gemini closure review of the final diff after this handoff.
2. Fresh format/diff checks for the documentation-inclusive snapshot.
3. Stage only the task-owned manifest and create exactly one commit with the intended message.
4. Verify final SHA/message, clean status, no listener on port 4173, no task-owned processes, and zero pending/in-progress todos.
