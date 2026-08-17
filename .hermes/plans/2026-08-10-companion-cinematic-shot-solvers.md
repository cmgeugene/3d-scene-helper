# Companion Cinematic Shot Solvers Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. Each numbered phase is a separate Hermes Desktop Project session. Do not continue into a later phase in the same session.

**Goal:** Replace the companion prototype’s generic numeric camera composition with deterministic, visually verifiable cinematic shot foundations and dedicated OTS / static worm’s-eye solvers.

**Architecture:** The LLM will eventually emit a semantic discriminated `CinematicShotIntent`; it will not author raw camera coordinates. Pure browser-side cinematography modules will derive pose-aware mannequin landmarks, transform them into world-space subject profiles, project them through the real output-camera geometry, generate shot-specific candidates, score them against cinematic constraints, and expose transient previews before one atomic document commit.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Three.js 0.185, React Three Fiber, Zustand, Vitest, Playwright, Zod.

---

## Repository lanes and inherited state

- Preserved prototype lane: `/Users/js/Documents/3d-scene-helper`
  - Branch: `feat/companion-cinematic-shot-solvers`
  - Base: `1bc2897c1bf30b8eebd41e98e43bb35761a2d01c`
  - Contains the inherited uncommitted companion prototype, generic OTS/worm-eye math, run pose, Codex Vite bridge, UI, tests, and screenshot artifacts.
  - Do not stash, discard, rewrite, commit, or copy this dirty tree from Phase 1.
- Clean Phase 1 lane: `/Users/js/Documents/3d-scene-helper-worktrees/cinematic-subject-projection`
  - Branch: `feat/cinematic-subject-projection`
  - Starts at the same committed base.
  - Phase 1 work must remain in this worktree only.
- Existing listener `127.0.0.1:5173` belongs to the preserved prototype lane. Do not kill or reuse it. Phase 1 does not require a persistent dev server.

## Product acceptance principles

1. The editor PNG is an intermediate structural reference for ChatGPT Image 2, not the final I2V frame. Composition, silhouette, scale, and depth cues matter more than photorealism.
2. A passing numeric camera test is insufficient. The final OTS must visibly read as “over the foreground character’s shoulder toward the speaking character.”
3. The final static worm’s-eye must visibly read as “a subject running toward a camera fixed near the ground,” not a neutral full-body shot and not a camera trapped directly below the pelvis.
4. Serialized `SceneDocument` remains authoritative. Cinematic profiles, candidate cameras, scores, and previews are derived/transient and JSON-safe; no `Object3D` enters Zustand or persistence.
5. Lens millimeters retain physical FOV semantics. Candidate framing moves the camera instead of using CSS/digital zoom.
6. The output camera and output aspect are the projection contract. Viewport letterboxing must not change shot metrics.
7. Implement every behavioral slice with strict RED → GREEN → REFACTOR. A test that passes on its first run is not valid RED evidence.

## Target architecture

```text
User chat
  → validated CinematicShotIntent
  → CinematicSubjectProfile(s)
  → shot-specific candidate generator
  → real PerspectiveCamera projection metrics
  → deterministic constraints/scoring
  → top transient candidate previews
  → one accepted SceneDocument transaction
```

Proposed module layout:

```text
src/editor/cinematography/
  cinematicSubjectProfile.ts
  cinematicSubjectProfile.test.ts
  projectionMetrics.ts
  projectionMetrics.test.ts
  shotIntent.ts
  shotCandidate.ts
  shotScoring.ts
  ots/
    otsSolver.ts
    otsSolver.test.ts
  wormEye/
    wormEyeApproachSolver.ts
    wormEyeApproachSolver.test.ts
```

---

# Phase 1 — Pose-aware subject profiles and projection metrics

**Session boundary:** Implement only the mathematical and runtime-verification foundation. Do not implement OTS candidate generation, worm’s-eye candidate generation, companion schema changes, candidate thumbnails, or document mutation.

**Proposed commit:** `feat: add cinematic subject projection foundation`

**Handoff:** `docs/session-handoffs/S13-cinematic-subject-projection.md`

## Phase 1 acceptance criteria

- A mannequin’s pose-aware head, face, shoulder, chest, pelvis, arm, and leg landmarks can be derived without creating Three runtime objects.
- Local landmarks are converted to world coordinates using the same dimension scaling, object scaling, XYZ root rotation, and translation order as the rendered mannequin and `getSceneObjectBounds()`.
- Body forward/right/up and face-forward directions are normalized world directions and are not distorted by non-uniform scale.
- A real Three `PerspectiveCamera` reconstructed from serialized output-camera data projects landmarks into output-frame NDC.
- Projection distinguishes in-front, behind-camera, frame-safe, and clipped landmarks.
- A projected subject envelope, occupancy, headroom, and per-landmark visibility are available without declaring an OTS or worm’s-eye pass/fail.
- Unit tests cover standard, athletic, heavy, posed, 180° yaw, and non-uniform scale cases.
- At least one actual Chromium/WebGL check proves the pure profile agrees with runtime mannequin landmarks or named-pivot diagnostics within numeric tolerance.
- No Phase 2+ feature appears in production UI or companion contracts.

## Task 1.1: Record clean preflight and baseline gates

**Objective:** Prove the Phase 1 lane is clean and independent before adding code.

**Files:**
- Read: `.hermes/plans/2026-08-10-companion-cinematic-shot-solvers.md`
- Read: `src/editor/mannequin/mannequinRig.ts`
- Read: `src/editor/scene/ArticulatedMannequin.tsx`
- Read: `src/editor/scene/sceneObjectModel.ts`
- Read: `src/editor/scene/cameraMath.ts`

**Step 1: Verify lane identity**

Run:

```bash
pwd
git branch --show-current
git log -1 --format='%H %s'
git status --short --untracked-files=all
```

Expected:

- cwd is `/Users/js/Documents/3d-scene-helper-worktrees/cinematic-subject-projection`
- branch is `feat/cinematic-subject-projection`
- starting commit is the committed Phase 1 plan on top of `1bc2897`
- no implementation diff exists

**Step 2: Install exact dependencies if needed**

Run only when `node_modules` is absent:

```bash
npm ci
```

Do not symlink the dirty prototype lane’s dependencies.

**Step 3: Run focused baseline**

```bash
npm test -- --run src/editor/mannequin/mannequinRig.test.ts src/editor/scene/cameraMath.test.ts
npm run typecheck
```

Expected: both commands pass before Phase 1 production code is written. Record exact test counts in the handoff.

## Task 1.2: Add pose-aware local cinematic landmarks

**Objective:** Expose one pure rig function that derives local-space landmarks from the exact procedural hierarchy used by rendering.

**Files:**
- Modify: `src/editor/mannequin/mannequinRig.ts`
- Modify: `src/editor/mannequin/mannequinRig.test.ts`

**Step 1: Write the failing contract test**

Add a test that imports a not-yet-existing `computeMannequinCinematicLandmarks()` and expects a JSON-safe result shaped like:

```ts
export interface MannequinCinematicLandmarks {
  eyeCenter: MannequinVector3;
  faceCenter: MannequinVector3;
  faceForward: MannequinVector3;
  headTop: MannequinVector3;
  headLeft: MannequinVector3;
  headRight: MannequinVector3;
  neck: MannequinVector3;
  chest: MannequinVector3;
  pelvis: MannequinVector3;
  leftShoulder: MannequinVector3;
  rightShoulder: MannequinVector3;
  leftElbow: MannequinVector3;
  rightElbow: MannequinVector3;
  leftHand: MannequinVector3;
  rightHand: MannequinVector3;
  leftHip: MannequinVector3;
  rightHip: MannequinVector3;
  leftKnee: MannequinVector3;
  rightKnee: MannequinVector3;
  leftFoot: MannequinVector3;
  rightFoot: MannequinVector3;
}
```

Required assertions:

- default pose has left shoulder x < right shoulder x;
- headTop.y > eyeCenter.y > neck.y > chest.y > pelvis.y;
- feet are below pelvis;
- all values are finite and JSON round-trip safely;
- turning the head changes `faceForward` and face anchors but does not move shoulder anchors;
- walk-ready pose moves relevant elbow/knee/foot landmarks relative to default;
- `faceForward` has unit length and follows the project’s documented local `-Z` convention.

**Step 2: Verify RED**

```bash
npm test -- --run src/editor/mannequin/mannequinRig.test.ts
```

Expected: FAIL because `computeMannequinCinematicLandmarks` does not exist.

**Step 3: Implement minimal local landmark derivation**

Requirements:

- Reuse the existing kinematic helpers and constants; do not duplicate arm/leg FK.
- Keep values in mannequin local coordinates.
- Derive head/face anchors with the same torso/head quaternion order as `ArticulatedMannequin.tsx`.
- Use `MANNEQUIN_BODY_PROPORTIONS` for head width/depth so body-type differences are represented.
- Do not mutate the pose.
- Return plain JSON-safe numbers, not `Vector3`, `Euler`, `Quaternion`, or `Object3D`.

**Step 4: Verify GREEN and refactor**

```bash
npm test -- --run src/editor/mannequin/mannequinRig.test.ts
```

Expected: PASS with the new focused tests.

Refactor only after GREEN. If production geometry constants and landmark constants diverge, extract one shared named constant rather than copying unexplained coordinates.

## Task 1.3: Build a world-space CinematicSubjectProfile

**Objective:** Convert mannequin-local landmarks into a reusable, JSON-safe world-space subject profile.

**Files:**
- Create: `src/editor/cinematography/cinematicSubjectProfile.ts`
- Create: `src/editor/cinematography/cinematicSubjectProfile.test.ts`
- Read/Reuse: `src/editor/scene/sceneObjectModel.ts`
- Read/Reuse: `src/editor/persistence/sceneSchema.ts`

**Step 1: Write failing profile tests**

Write tests against the desired API:

```ts
export interface CinematicSubjectProfile {
  objectId: string;
  bounds: SceneObjectBounds;
  landmarks: MannequinCinematicLandmarks;
  outline: readonly Vec3[];
  basis: {
    forward: Vec3;
    right: Vec3;
    up: Vec3;
    faceForward: Vec3;
  };
}

export function createCinematicSubjectProfile(
  object: SceneObject,
): CinematicSubjectProfile | null;
```

Required cases:

1. Non-mannequin returns `null` without mutation.
2. Standard mannequin world landmarks include document translation.
3. `dimensions / reference dimensions`, then `transform.scale`, XYZ root rotation, then translation match `ArticulatedMannequin` and `getSceneObjectBounds` semantics.
4. 180° Y rotation flips world `forward` from local `-Z` to world `+Z`.
5. Non-uniform scale changes point positions but every basis direction remains normalized and mutually orthogonal within tolerance.
6. `outline` includes at least head sides/top, shoulders, hands, hips, knees, and feet so later solvers can compute silhouette occupancy.
7. `bounds` equals `getSceneObjectBounds(object)` rather than being reimplemented.
8. Source object and nested pose remain byte-for-byte unchanged.

**Step 2: Verify RED**

```bash
npm test -- --run src/editor/cinematography/cinematicSubjectProfile.test.ts
```

Expected: FAIL because the module does not exist.

**Step 3: Implement the minimal profile**

Implementation rules:

- Use Three math types only as local temporaries.
- Return plain objects at the module boundary.
- Centralize local-point → world-point conversion in one helper.
- Centralize local-direction → world-direction conversion separately; root scale must not skew the direction basis.
- Reject or return `null` for missing/invalid mannequin pose through the already validated SceneObject contract; do not add persistence fields.

**Step 4: Verify GREEN**

```bash
npm test -- --run src/editor/cinematography/cinematicSubjectProfile.test.ts src/editor/mannequin/mannequinRig.test.ts
```

Expected: PASS.

## Task 1.4: Reconstruct the output camera and project landmarks

**Objective:** Measure the profile in the exact output-frame projection used by export.

**Files:**
- Create: `src/editor/cinematography/projectionMetrics.ts`
- Create: `src/editor/cinematography/projectionMetrics.test.ts`
- Reuse: `src/editor/scene/cameraMath.ts`
- Reuse: `src/editor/constants.ts`

**Step 1: Write the failing projection tests**

Desired API:

```ts
export interface ProjectedPoint {
  ndc: { x: number; y: number; z: number };
  inFront: boolean;
  insideFrame: boolean;
  insideActionSafe: boolean;
}

export interface CinematicProjectionMetrics {
  landmarks: Record<keyof MannequinCinematicLandmarks, ProjectedPoint>;
  outline: readonly ProjectedPoint[];
  visibleRect: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    width: number;
    height: number;
  } | null;
  occupancy: { width: number; height: number };
  headroom: number | null;
  clippedLandmarks: readonly (keyof MannequinCinematicLandmarks)[];
  allInFront: boolean;
}

export function computeCinematicProjectionMetrics(
  profile: CinematicSubjectProfile,
  camera: SceneDocument['outputCamera'],
  outputAspect: number,
): CinematicProjectionMetrics;
```

Required tests:

- a point on the camera target projects to NDC center within tolerance;
- output focal length and aspect change projected occupancy predictably;
- points behind the camera have `inFront: false` even if finite NDC numbers are produced;
- frame bounds use `[-1, 1]` NDC and action-safe uses the existing 5% output-frame convention;
- `visibleRect` ignores behind-camera points but does not hide clipped in-front points;
- `clippedLandmarks` identifies named anchors outside the frame;
- headroom is derived from projected `headTop`, not world Y;
- invalid aspect/focal/camera distance throws a clear range error without NaN output.

**Step 2: Verify RED**

```bash
npm test -- --run src/editor/cinematography/projectionMetrics.test.ts
```

Expected: FAIL because the module does not exist.

**Step 3: Implement with a real Three PerspectiveCamera**

Requirements:

- Reconstruct a real `PerspectiveCamera` from serialized `position`, `target`, `rollDeg`, `focalLengthMm`, and output aspect.
- Reuse `applyOutputCameraProjection()` rather than duplicating film-gauge math.
- Apply camera position → `lookAt(target)` → roll → output projection → matrix updates in the same order as runtime.
- Keep near/far values aligned with the existing output-camera runtime; inspect the runtime before choosing defaults.
- Do not use viewport dimensions or letterbox geometry. Metrics are output-frame metrics.
- Return plain JSON-safe measurements.

**Step 4: Verify GREEN**

```bash
npm test -- --run src/editor/cinematography/projectionMetrics.test.ts src/editor/cinematography/cinematicSubjectProfile.test.ts src/editor/scene/cameraMath.test.ts
```

Expected: PASS.

## Task 1.5: Add one real-runtime landmark parity tracer bullet

**Objective:** Prove pure landmarks agree with the rendered articulated mannequin instead of trusting duplicate math.

**Files:**
- Modify: `src/editor/scene/ArticulatedMannequin.tsx`
- Modify/Create: the narrowest existing Playwright spec under `e2e/` that already exercises the mannequin and test bridge
- Modify only if required: an existing test-only diagnostics type declaration

**Step 1: Write one failing E2E assertion**

In E2E mode only, publish actual world positions from named runtime pivots/meshes for a selected mannequin. At minimum include:

- head/face pivot or a stable face mesh reference point;
- left and right shoulder pivots;
- left and right ankle/foot pivots.

The test must:

1. run the actual WebGL Canvas;
2. select a mannequin;
3. apply a non-default pose or rotation through real UI/state flow already covered by the app;
4. read runtime named-object world positions;
5. compare them with the pure `createCinematicSubjectProfile()` result or an independently published pure snapshot within numeric tolerance;
6. prove the diagnostic is absent from an ordinary production build.

Do not expose an `Object3D`, store, camera, or function on `window`.

**Step 2: Verify RED**

Run the exact focused Playwright project/spec command already used by this repository. If the normal preview port is needed, use a Phase-1-owned available port; do not reuse or stop `5173`.

Expected: FAIL because runtime landmark diagnostics are absent.

**Step 3: Implement the minimum DEV/E2E-only diagnostics**

- Extend the existing guarded diagnostics in `ArticulatedMannequin.tsx`.
- Read world positions from actual named hierarchy nodes after `updateWorldMatrix(true, true)`.
- Serialize copied numbers only.
- Clear the dataset field on dependency change/unmount.
- Preserve ordinary production-marker absence.

**Step 4: Verify GREEN**

Run the focused E2E again and require the real Canvas assertion to pass. Capture one screenshot as evidence in Playwright output, but do not commit generated test reports.

## Task 1.6: Review, full gates, handoff, and commit

**Objective:** Close Phase 1 against an unchanged candidate and stop before OTS implementation.

**Files:**
- Create: `docs/session-handoffs/S13-cinematic-subject-projection.md`
- Modify only files required by Tasks 1.2–1.5

**Step 1: Scope audit**

Confirm no changes to:

- `src/editor/companion/**`
- `src/editor/components/CompanionPanel.tsx`
- `src/editor/state/editorStore.ts`
- OTS or worm’s-eye solver modules
- persistent scene schema/version
- candidate preview UI

**Step 2: Independent reviews**

1. Run an independent spec-compliance review against Phase 1 only.
2. Fix every Important-or-higher finding with focused RED → GREEN evidence.
3. Re-review the changed snapshot.
4. Run an independent code-quality/security review.
5. Resolve Important-or-higher findings and re-review again.

A launched background reviewer is not completed review evidence.

**Step 3: Run fresh final gates with fail-fast semantics**

```bash
set -e
npm run typecheck
npm run lint
npm test -- --run
npm run build
npm run test:e2e:preview
npm run build
npm run format:check
git diff --check
```

Requirements:

- Record exact exit codes and test counts.
- The last ordinary `npm run build` restores production output after instrumented E2E build.
- Confirm production diagnostics remain absent.
- Confirm Phase-1-owned preview listeners are gone.
- Do not kill the preserved prototype lane’s existing `5173` listener.

**Step 4: Write the handoff before commit**

The handoff must include:

- branch and starting SHA;
- exact changed files;
- RED and GREEN commands/outcomes;
- runtime/WebGL evidence and screenshot path;
- review model/provider and findings disposition;
- final gate commands with exact outcomes;
- explicit statement that OTS/worm’s-eye solvers and companion UI are not implemented;
- integration note for later merging into `feat/companion-cinematic-shot-solvers`;
- proposed commit message.

**Step 5: Commit exactly the Phase 1 snapshot**

```bash
git add \
  src/editor/mannequin/mannequinRig.ts \
  src/editor/mannequin/mannequinRig.test.ts \
  src/editor/cinematography/cinematicSubjectProfile.ts \
  src/editor/cinematography/cinematicSubjectProfile.test.ts \
  src/editor/cinematography/projectionMetrics.ts \
  src/editor/cinematography/projectionMetrics.test.ts \
  src/editor/scene/ArticulatedMannequin.tsx \
  e2e \
  docs/session-handoffs/S13-cinematic-subject-projection.md
git commit -m "feat: add cinematic subject projection foundation"
```

Adjust the explicit `e2e` path to the exact touched spec; do not stage generated artifacts.

**Step 6: Verify closure**

```bash
git show --check --stat --oneline HEAD
git status --short
```

Expected:

- intended commit exists;
- worktree is clean;
- no Phase-1-owned process/listener remains;
- no pending or in-progress todos;
- session stops here.

---

# Phase 2 — Deterministic dialogue OTS solver

**Separate fresh session required.**

Scope:

- Add `DialogueOtsIntent` with subject, foreground, shoulder side, axis-side policy, shot size, intensity, lens, and aspect.
- Generate left/right shoulder candidates from eye/shoulder landmarks and conversation axis.
- Project each candidate and score subject eye placement, headroom, look room, face clearance, foreground edge contact, shoulder occupancy, clipping, and 180° axis continuity.
- Reject ordinary two-shots with no foreground shoulder and reject foreground silhouettes that cover the subject face.
- Produce deterministic ranked camera candidates only; do not modify the companion UI yet.
- Verify standard/athletic/heavy pairs and both left/right OTS directions in unit tests plus real WebGL screenshots.

Initial visual acceptance targets are calibration ranges, not immutable constants:

- foreground silhouette visibly touches one frame edge and occupies roughly 15–30% of frame width;
- subject eyes sit near the upper-third region;
- subject face remains materially unobstructed;
- headroom and look room are positive;
- shot reads immediately as OTS rather than wide two-shot.

# Phase 3 — Static worm’s-eye approach solver

**Separate fresh session required.**

Scope:

- Add `WormEyeApproachIntent` with static camera, approach direction, restrained/strong intensity, action phase, 18/24mm lens, aspect, and desired occupancy.
- Put the fixed camera along the subject’s approach corridor near ground level, not directly under the subject.
- Solve distance from output-frame occupancy and safe landmark containment after fixing camera height and chest/face target.
- Rank optional small 3/4 yaw candidates by limb silhouette separation while preserving approach direction.
- Ensure subject motion points toward the camera and camera motion remains absent.
- Reject neutral full-body shots, pelvis-dominant underbody shots, clipped head/leading foot, and unreadable overlapping limb silhouettes.
- Verify with real WebGL and exported PNG screenshots.

# Phase 4 — Semantic companion contract and transient candidate previews

**Separate fresh session required.**

Scope:

- Replace LLM-authored raw numeric camera placement for these shots with a discriminated semantic `CinematicShotIntent` contract.
- Preserve generic manual camera presets for non-cinematic fallback use.
- Compile validated intent into ranked candidates in the browser.
- Add transient candidate state outside `SceneDocument`.
- Show top 2–3 thumbnails and concise labels such as left/right shoulder OTS or restrained/strong worm’s-eye.
- `Apply` commits camera, required object transforms/pose, aspect, lighting, and guides once; `Cancel` leaves document/history/dirty state unchanged.
- Support follow-ups such as “opposite shoulder,” “less extreme,” “larger subject,” and “show more face” by editing semantic intent, not raw coordinates.

# Phase 5 — Replace prototype paths and end-to-end visual closure

**Separate fresh session required.**

Scope:

- Integrate verified Phase 1–4 commits into `feat/companion-cinematic-shot-solvers` while preserving reviewed prototype behavior that remains useful.
- Remove or quarantine the current generic OTS/worm-eye paths and their misleading numeric-only tests.
- Turn the preserved failure screenshots into documented regression scenarios; do not use brittle exact-pixel goldens as the only test.
- Verify companion chat → semantic intent → candidate preview → apply → undo → clean/reference PNG for both exemplar requests.
- Obtain independent spec and quality reviews, run complete gates, and capture final approved 1280×720 evidence.

## Final exemplar prompts

1. `두 인물이 마주 보게 배치하고, 왼쪽 인물의 오른쪽 어깨 너머로 상대를 보는 자연스러운 medium-close OTS를 잡아줘.`
2. `달려오는 인물을 지면 가까이에 고정된 static camera의 강한 worm's-eye view로 잡아줘. 카메라는 움직이지 않고 인물이 카메라 쪽으로 달려오게 해.`

The feature is not complete until both results are visibly legible in actual screenshots and exported reference PNGs, not merely accepted by schemas or numeric tests.
