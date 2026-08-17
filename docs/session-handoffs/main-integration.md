# Main integration handoff

Session ID: `20260817_171647_dd4f6d`

## Scope and repository invariants

- Integration worktree: `/Users/js/Documents/3d-scene-helper-worktrees/main-integration`
- Integration branch: `integration/all-features`
- Starting `HEAD` and local `main`: `1bc2897c1bf30b8eebd41e98e43bb35761a2d01c`
- No remote was pushed. Local `main` was not moved. No branch or worktree was deleted.
- `npm ci` preserved the merged lockfile byte-for-byte: SHA-256 `409cb934e9980789e6b975180fe5363b972b5bb8467a9641f8db9fa37a836a89` before and after install.
- The final integration/handoff commit SHA is reported outside this tracked file because a commit cannot contain its own cryptographic identity.

## Explicit source heads and intent ledger

### Cinematic chain

Integrated head: `fc7941d79c665644282fdd605a7ae5776959f06f` (`feat/static-wormeye-approach-solver`).

Ordered committed intent:

1. `4531f56` — plan the Companion cinematic-shot solver boundary.
2. `bbbd5ed` — add measurement-only cinematic subject projection foundation.
3. `c164d5f` — strengthen projection runtime/visual evidence.
4. `f901a10` — add deterministic dialogue OTS solver.
5. `1b49b1f` — correct signed OTS counter-positioning.
6. `43a5c05` — add canonical rear-head/neck/shoulder-over topology.
7. `54fbba0c7a183d26adb12a6ef79b2019173cd81c` — add role-swapped canonical OTS coverage pair on one conversation-axis side.
8. `fc7941d79c665644282fdd605a7ae5776959f06f` — add committed static worm-eye approach solver.

The uncommitted natural-front-contact sprint corrections in the source worktree were not copied, staged, or merged.

### Grid, lens DOF, slider, IME, and focus-contour chain

Integrated head: `6d8b2701ebb47c0f903b9c55318e1a56502f395a` (`feat/mannequin-focus-contours`).

Ordered committed intent:

1. `f6339362dd1326832e3449f412c8a6ac58280cdb` — cube-top and plane surface grids with scale-stable physical spacing.
2. `747615c1da23e3a303ad9dec8fd3a8df5a23d806` — target-linked lens-aware DOF in live and exact PNG paths.
3. `3c7709d` — photographic f-stop slider.
4. `534e41862a2627ba832cd4b5592ecd3baad21887` — Korean-IME-safe physical `T` target shortcut.
5. `6d8b2701ebb47c0f903b9c55318e1a56502f395a` — mannequin focus contours in live, Clean, and Reference paths.

### Conversational scene assistant

Integrated head: `e7628df5b1f3b6b9b7618f05cbc6f6d247beff55` (`codex/conversational-scene-assistant`), from merge base `eaddaa5a3d7c8e053dc952fd6c43ad06b35c2b6b`.

Ordered nine-commit intent:

1. `2a3f222` — conversational scene assistant workflow.
2. `a783150` — restore editor interactions with assistant dock.
3. `c1ad270` — keyframe generation workspace.
4. `92b43a2` — generation scene-snapshot preview.
5. `4ec7f52` — safe atomic generation scene-snapshot apply.
6. `497bb06` — semantic scene specification.
7. `aaf28d5` — productized conversational assistant.
8. `91b7e95` — unified AI development launcher.
9. `e7628df5b1f3b6b9b7618f05cbc6f6d247beff55` — GPT-web image-prompt export.

`f7d9850523fef2fe1345b79bcab9e694d0dd5405` (`feat/mannequin-phase1`) was already an ancestor of the starting main and received no separate merge.

## Merge order and provenance

1. `d39dd08d0164ec7bae00bf4caad7aa8a7376bdc5` — `merge: integrate cinematic solver chain`
   - parents: `1bc2897c1bf30b8eebd41e98e43bb35761a2d01c`, `fc7941d79c665644282fdd605a7ae5776959f06f`
2. `952128fd6ad7ee2f456aaf3eec716e2e535be8aa` — `merge: integrate grids depth of field and focus contours`
   - parents: `d39dd08d0164ec7bae00bf4caad7aa8a7376bdc5`, `6d8b2701ebb47c0f903b9c55318e1a56502f395a`
3. `3bc06f7284b325bac2937e460509656385109d46` — `merge: integrate conversational scene assistant`
   - parents: `952128fd6ad7ee2f456aaf3eec716e2e535be8aa`, `e7628df5b1f3b6b9b7618f05cbc6f6d247beff55`

The first two merges were clean. The third had nine textual conflict hunks in five files.

## Conflict ledger

Every hunk was inspected against merge base `eaddaa5a3d7c8e053dc952fd6c43ad06b35c2b6b`, the integrated side, and the assistant side. All nine were **disjoint-intent**; there were no same-question-different-answer or superseded choices.

1. `src/editor/components/Inspector.tsx:1-20` — disjoint-intent — kept body-build presets and DOF imports from the integrated side plus assistant semantic-field limits from the assistant side. Both UI contracts are independently required.
2. `src/editor/persistence/sceneSchema.ts:13-23` — disjoint-intent — kept lens/DOF imports plus semantic-scene-spec imports.
3. `src/editor/persistence/sceneSchema.ts:93-126` — disjoint-intent — retained the mannequin body-type preprocessing/validated schema while adding semantic object metadata and bounded object names.
4. `src/editor/persistence/sceneSchema.ts:269-282` — disjoint-intent — retained global mannequin focus-contour appearance and assistant generation-source schemas.
5. `src/editor/persistence/sceneSchema.ts:291-304` — disjoint-intent — retained `mannequinAppearance` plus assistant scene/spec revisions, semantic scene spec, and generation source in the same strict JSON-safe document.
6. `src/editor/persistence/sceneSchema.ts:506-510` — disjoint-intent — starter documents initialize both focus-contour appearance and semantic scene specification.
7. `src/editor/scene/SceneViewport.tsx:317-322` — disjoint-intent — retained assistant preview diagnostics/read-only helper suppression and kept the actual `CinematicDepthOfField` render path. Read-only previews still render document optics while hiding editor helpers.
8. `src/editor/state/editorStore.ts:64-79` — disjoint-intent — mutation allowlist keeps both `update-mannequin-appearance` and `apply-generation-snapshot` alongside semantic mutations.
9. `src/editor/state/editorStore.test.ts:816-832` — disjoint-intent — expected mutation ledger proves both entries remain present.

No conflict was resolved wholesale with `ours` or `theirs`. No conflict markers remain.

## Integration fixes and RED→GREEN evidence

- The first integrated `npm run typecheck` failed because cinematic solvers and assistant fixtures predated serialized `outputCamera.depthOfField`.
- Projection metrics were intentionally narrowed to the position/target/lens/roll fields they measure, preserving the projection foundation as measurement-only.
- OTS and static-worm-eye solver proposals now produce JSON-safe DOF settings. Exact supported lenses retain automatic mapped f-stops; an arbitrary solver lens such as 65 mm receives a valid enabled manual f/2.8 fallback instead of crashing the strict automatic-preset path.
- New focused DOF/solver assertions were added. RED: 4 failures (missing fallback API and unsupported 65 mm). GREEN: 6 files, 70 tests.
- Assistant scene-snapshot/layout fixtures now preserve current camera fields while overriding physical position/target/lens/roll.
- Node 25 exposes a nonfunctional global `localStorage` object in the Vitest environment. The full-suite RED was 23/23 assistant-panel failures; test setup now installs a standards-shaped in-memory Storage only when the host object lacks `clear()`. Focused GREEN: 23/23.
- Assistant connection status introduced a second ARIA `status`, making older WebGL E2E locators ambiguous. Initial focused E2E: 22 passed, 7 failed, 3 did not run. The four affected specs now target the product-specific `[data-webgl-state]` contract. Focused closure: 10/10, then fresh relevant suite: 32/32.
- `.prettierignore` preserves two legacy baseline prose files and the exact immutable Gemini review records, avoiding unrelated formatting churn and retaining review-record hashes `79240fa…` and `f187497…`.

## Ancestry proof

`git merge-base --is-ancestor <tip> HEAD` returned exit `0` for every required tip:

- cinematic subject projection `c164d5f54521cade33779f2d6075d02775eca2a0`
- dialogue OTS solver/coverage `54fbba0c7a183d26adb12a6ef79b2019173cd81c`
- static worm-eye committed tip `fc7941d79c665644282fdd605a7ae5776959f06f`
- cube/plane grids `f6339362dd1326832e3449f412c8a6ac58280cdb`
- lens DOF `747615c1da23e3a303ad9dec8fd3a8df5a23d806`
- DOF slider and Korean IME `534e41862a2627ba832cd4b5592ecd3baad21887`
- mannequin focus contours `6d8b2701ebb47c0f903b9c55318e1a56502f395a`
- conversational assistant `e7628df5b1f3b6b9b7618f05cbc6f6d247beff55`
- mannequin phase 1 `f7d9850523fef2fe1345b79bcab9e694d0dd5405`
- protected companion branch committed tip `1bc2897c1bf30b8eebd41e98e43bb35761a2d01c`

## Verification gates and counts

All counts below are from the integrated worktree.

- `npm ci`: passed; 358 packages installed; lock hash unchanged; audit reported the existing two high-severity findings.
- Focused conflict/unit gate before merge completion: 11 files, 186/186 tests.
- Focused integration RED→GREEN closure: 6 files, 70/70 tests.
- Full unit: 59 files, 505/505 tests.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run format:check`: passed after preserving immutable records through `.prettierignore`.
- Ordinary production build: passed; 731 modules; production E2E diagnostics absent.
- Relevant serial Chromium/WebGL E2E: 32/32 passed (camera, DOF, contours, dialogue OTS, worm-eye, export, keyframe snapshots, Companion reconnection).
- Final serial `npm run test:e2e:preview`: 95/95 passed in 6.8 minutes with a temporary local `workers: 1` override; the override was restored immediately afterward.
- A fresh ordinary production build is required after the final review/handoff commit and is recorded in final closeout, not self-referentially inside that commit.

## Actual Chromium/WebGL and visual evidence

The 32-test relevant run and the 95-test final preview run used actual Playwright Chromium with WebGL/SwiftShader, real Canvas rendering, decoded PNG downloads, and serial workers.

Verified coexistence includes:

- conversational assistant dock and Companion reconnection/workspace flows are reachable;
- Floor/Room/Cube/Plane finite surface grids mount and export while the redundant global grid stays absent;
- output-camera crop, lens, roll, DOF slider, target action, and Korean-IME-safe shortcut remain functional;
- contours appear before DOF in live, Clean, and Reference pixels and selection helpers remain absent from Clean/Reference;
- projection, signed/canonical OTS, role-swapped pair, and static worm-eye solver fixtures remain functional;
- scene snapshots preview read-only and apply atomically without storing Three/runtime objects.

Measured evidence from the integrated run includes:

- cube grid changed-pixel ratio `0.0007204861111111111`;
- plane grid changed-pixel ratio `0.003423394097222222`;
- focus-contour Clean delta `0.035807291666666664` and Reference delta `0.035807291666666664`;
- selected/deselected Clean contour mismatch `0` in the feature fixture;
- 85 mm contour target/foreground sharpness `0.9256881847542303 / 0.10250076332794654` with DOF;
- role-swapped OTS legs retained the same canonical axis sign `-1` with lower shoulder widths `0.3736868944416114` and `0.41448240693523714`;
- static worm-eye used 24 mm, absolute camera `y=0.08`, auto f/5.6, occupancy `0.7239377227631534`, support error `0`, and `cameraMotion: none`.

Visually inspected artifacts:

- `/tmp/3d-scene-helper-mannequin-focus-contours/clean-85mm-ots-contours-dof.png` — crisp target contours, visibly defocused red OTS foreground contours, no selection/gizmo helpers.
- `/tmp/3d-scene-helper-mannequin-focus-contours/viewport-85mm-ots-contours.png` — live contours plus expected editor framing/selection helpers, demonstrating that helper policy differs from Clean export.
- `docs/session-evidence/S15-canonical-ots-coverage-shot-a-subject-A-foreground-B-clean-1280x720.png` — connected foreground rear head/neck/shoulder ridge, clear opposite subject, no editor helpers.
- `docs/session-evidence/S16-static-wormeye-approach-solver/S16-static-wormeye-approach-accepted-clean-1280x720.png` — ground-level camera, asymmetric approaching run, readable limbs/contact, bounded floor depth cues, no editor helpers.

A separate Browser Use smoke attempt was not used as evidence because Chrome requested user-granted remote-debugging permission. No permission dialog was clicked. Actual Playwright Chromium/WebGL evidence above is complete.

## Independent Gemini reviews

Both successful reviews used `agy` 1.1.13 with `gemini-3.6-flash-high`, read-only prompts, sandbox mode, and before/after snapshot hashes. The reviewed integration snapshot had diff SHA-256 `902854520ffd36a076cc12863aba312357f13c7fa6f1175fcba02ef89fd09170` and status SHA-256 `632e80c2348daba4e93a2627badb8c75f5d98775b169bf540ddcd2de8d884e76`; both were unchanged after review.

1. Specification compliance ran first and returned: `APPROVED: no Important/Critical spec-compliance findings.`
2. The first broad quality/security attempt timed out without a verdict and was not counted as approval. A bounded independent closure review of the high-risk schema/store/history/DOF/export/solver/assistant/Companion seams then returned: `APPROVED: no Important/Critical quality/security findings.`
3. No Important-or-higher finding required remediation. The parent still reran final format, diff/status, production-build, ancestry, protected-hash, and port checks after inserting these verdicts.

## Protected dirty lanes and server

These lanes remain intentionally unfinished and must not be reset, stashed, copied, committed, or merged beyond their named committed tips:

1. `/Users/js/Documents/3d-scene-helper` — `feat/companion-cinematic-shot-solvers` at `1bc2897c1bf30b8eebd41e98e43bb35761a2d01c`
   - expected tracked binary diff SHA-256: `bc058197b23a2a4c56eecda680a7ab8cf2b6551aa0fd455af260c8572097ebd5`
   - expected porcelain-z SHA-256: `dc736269b1d161a4644ec710908eb94656aa4bf39edd642160ba381e804d2380`
2. `/Users/js/Documents/3d-scene-helper-worktrees/static-wormeye-approach-solver` — `feat/static-wormeye-approach-solver` at `fc7941d79c665644282fdd605a7ae5776959f06f`
   - expected tracked binary diff SHA-256: `17fd6e70ec7a1f37293b0fb94115457863c7438f1b5eb3f336cb11baeefca283`
   - expected porcelain-z SHA-256: `fa13a84026d0f1d648e52d0ad4baa7d3864a221531ec6fd843495c88bf5a88ba`

The user-owned server remains `127.0.0.1:5173`, PID `58030`, rooted at `/Users/js/Documents/3d-scene-helper-worktrees/mannequin-focus-contours`. Final HTTP/process/hash rechecks are recorded in closeout after the last commit. Task-owned `4173` must be clear.

## No-push and main fast-forward handoff

Nothing was pushed. The parent owns direct verification and the atomic local-main update. After verifying the final integration SHA reported in closeout, use an expected-old update so concurrent main movement fails closed:

```bash
git -C /Users/js/Documents/3d-scene-helper-worktrees/main-integration update-ref refs/heads/main <FINAL_INTEGRATION_HEAD> 1bc2897c1bf30b8eebd41e98e43bb35761a2d01c
```
