# S16 Static Worm’s-Eye Approach Solver Implementation Plan

> **For Hermes:** Load `test-driven-development`, `interactive-3d-runtime-verification`, `i2v-keyframe-previsualization`, `safe-git-integration`, and `antigravity-cli`. Execute this plan in one new project-bound session with strict RED→GREEN tracer bullets, actual WebGL evidence, Gemini 3.6 Flash High reviews, one final commit, and a clean handoff.

**Goal:** Build a deterministic, JSON-safe static-camera worm’s-eye action solver that aligns a posed mannequin with an approach corridor, applies intent-local support-foot grounding, solves a 5–15 cm camera and requested lens from projected landmarks, and produces an unmistakable running-toward-camera frame in actual OutputCamera/WebGL pixels.

**Architecture:** Reuse the measurement-only `CinematicSubjectProfile` and `computeCinematicProjectionMetrics` foundation. Add one shot-family-local solver that transforms a copied profile transiently, samples camera/placement candidates, validates worm’s-eye/action semantics, and returns plain-data camera plus subject-staging deltas and diagnostics without mutating `SceneDocument`, history, store, runtime Three objects, or inputs. Keep all acceptance policy in the new shot-family layer.

**Tech stack:** TypeScript, Vitest, Three.js math through existing projection foundation, Playwright Chromium/WebGL, pngjs, Gemini 3.6 Flash High through `agy`.

---

## Baseline and boundaries

- Worktree: `/Users/js/Documents/3d-scene-helper-worktrees/static-wormeye-approach-solver`
- Branch: `feat/static-wormeye-approach-solver`
- Starting commit: `54fbba0c7a183d26adb12a6ef79b2019173cd81c`
- Previous handoff: `docs/session-handoffs/S15-canonical-ots-coverage-pair.md`
- Manual visual target only: `/Users/js/Documents/3d-scene-helper/artifacts/wormeye-front-running-24mm-1280x720.png`
- Proposed commit: `feat: add static worm-eye approach solver`
- Handoff: `docs/session-handoffs/S16-static-wormeye-approach-solver.md`

### Explicitly in scope

- A new pure solver module and focused tests.
- Static camera motion policy only (`none`).
- Existing posed mannequin input; a WebGL fixture must use an unmistakable custom running pose.
- Plain-data subject staging proposal: yaw/approach alignment, translation/placement delta, and support-foot grounding delta. The solver must evaluate the transformed copy, not mutate the profile or document.
- Intent-local `support-contact` and `flight` semantics. Contact grounds only the selected support foot to the supplied floor top plus clearance; flight must not silently ground both feet.
- Deterministic candidate generation, stable IDs/tie-breaks, diagnostics, failure reasons, validation API, non-mutation and byte-determinism.
- Actual 1280×720 OutputCamera and clean PNG evidence generated from the production solver.

### Explicitly out of scope

- Companion parser/planner/prompt/schema/client/panel wiring.
- Preview/apply UI, editorStore/history/undo/dirty-state transactions.
- SceneDocument schema/version changes or persistence migrations.
- OTS solver changes, OTS threshold recalibration, or OTS evidence changes.
- Universal projection pass/fail, required-landmark, head/feet-safe, or grounding rules.
- New animation system, timeline, physics, imported rig, or camera motion.
- Modifying, stashing, resetting, or copying from the dirty prototype at `/Users/js/Documents/3d-scene-helper`.
- Reusing or stopping the preserved `127.0.0.1:5173` listener/PID `42743`.

## Intended production API

The exact names may be refined during the first RED, but behavior must remain equivalent:

- Create `src/editor/cinematography/staticWormEyeApproachSolver.ts`.
- Export `solveStaticWormEyeApproach(intent)` and `validateStaticWormEyeApproach(result)`.
- Input must include:
  - `subject: CinematicSubjectProfile`;
  - nonzero ground-plane `motionDirection`;
  - `actionPhase: 'support-contact' | 'flight'`;
  - contact-only `supportFoot: 'left' | 'right'`;
  - `floorTopY`, bounded `groundClearanceM`;
  - requested `lensMm` with 24 mm production tracer;
  - absolute `cameraHeightM` with 5–15 cm acceptance;
  - output aspect, target occupancy/intensity, and `cameraMotion: 'none'`.
- Accepted candidates return plain JSON-safe data:
  - output camera;
  - `cameraMotion: 'none'`;
  - subject yaw delta and translation/grounding delta;
  - transformed approach/motion direction;
  - action phase/support-foot contract;
  - objective projection measurements plus shot-local diagnostics and score.
- Failures return deterministic ordered reasons. No runtime objects or document/store references may escape.

## Shot-local semantic contract

A candidate is not accepted merely because it uses 24 mm and a low Y value. It must prove:

1. camera absolute world height is within the requested 5–15 cm policy and stays independent of grounding;
2. subject motion/forward direction approaches the static camera or defined near-camera corridor;
3. subject height occupancy is approximately 65–85% for the production hero tracer unless a named bounded option says otherwise;
4. head/face and action-critical leading limb are in front and protected by this intent’s crop policy;
5. running silhouette is readable: opposing arm/leg phase, lifted knee/leading limb separation, hands not above the head, no pelvis-dominant blob;
6. sufficient floor/ground perspective remains visible in the actual frame;
7. support-contact phase grounds only the named support sole to `floorTopY + clearance` within tolerance; flight phase preserves an airborne pose and does not apply contact grounding;
8. low-angle perspective remains unmistakable after grounding and staging;
9. camera motion is exactly `none`;
10. clean output contains no editor UI/helpers/diagnostic leakage.

## Task 1: Focused API tracer bullet

**Files**

- Create: `src/editor/cinematography/staticWormEyeApproachSolver.test.ts`
- Create after RED: `src/editor/cinematography/staticWormEyeApproachSolver.ts`

1. Write one failing test importing the absent module and requesting a standard 24 mm, 8 cm, 16:9 support-contact result from a custom running-pose profile.
2. Run only that test and record the expected missing-module RED.
3. Add the minimum pure types and one deterministic accepted candidate.
4. Re-run and record GREEN.
5. Assert no input/profile mutation and `JSON.stringify` byte determinism.

## Task 2: Approach corridor and static camera policy

Add vertical RED→GREEN tests one at a time for:

- yaw/staging aligns profile forward and motion direction with the camera approach corridor;
- reversing motion direction materially reverses proposed yaw/placement while retaining valid framing;
- zero/vertical-only motion fails closed;
- camera height is absolute relative to floor and remains 0.05–0.15 m;
- requested 24 mm reaches the output camera exactly;
- any camera-motion value other than `none` is rejected or unrepresentable;
- camera aims at a shot-local chest/head weighted target rather than generic bounds center.

## Task 3: Contact and flight grounding

Add RED→GREEN tests for:

- left/right support-contact uses the selected posed foot landmark and computes `deltaY = floorTopY + clearance - supportFootY`;
- transformed accepted metrics are computed after the delta;
- camera world Y does not move with subject grounding;
- flight applies no support-foot grounding and may keep both feet airborne;
- invalid contact without support foot, nonfinite floor, and unreasonable clearance fail closed;
- standard, muscular, and fat body profiles remain deterministic and fail honestly when no candidate satisfies action policy.

Do not add grounding rules to `projectionMetrics.ts`.

## Task 4: Worm’s-eye/action acceptance and rejection diagnostics

Add focused tests for:

- occupancy, headroom, low-angle/upward-pitch, approach alignment, horizon/ground-room proxy;
- action-critical head, hands, knees, and feet crop policy;
- leading-knee/foot separation from pelvis and opposing limb phase proxies;
- rejection of ordinary low angle, camera too high, subject moving away, standing/neutral silhouette, pelvis-dominant crop, unreadable limb overlap, no ground room, clipped head/critical leading limb, and unsatisfiable candidates;
- stable candidate IDs, ordered failure reasons, deterministic tie-breaks, and validator agreement;
- all candidate diagnostics remain transient and JSON-safe.

Policy thresholds may be calibrated only after inspecting actual pixels. Never lower them merely to make a current weak candidate pass.

## Task 5: Permanent actual-WebGL tracer

**Files**

- Create: `e2e/staticWormEyeApproach.spec.ts` (preferred) or add a tightly isolated block to the existing cinematography E2E only if that is demonstrably lower risk.
- Add accepted/rejected PNGs under `docs/session-evidence/`.

1. Build a 16:9 fixture with floor and a visibly distinct custom running pose.
2. Call the production solver; apply its returned camera and subject staging only to a fixture copy.
3. Render the actual Canvas/OutputCamera at 1280×720.
4. Verify serialized camera and runtime PerspectiveCamera parity, requested 24 mm, absolute 8 cm camera height, camera motion `none`, and no console/page errors.
5. Export both OutputCamera and clean PNG through the real export path.
6. Use pixel isolation controls:
   - hide subject to measure the actual running silhouette envelope and critical bands;
   - hide floor to prove bottom-region ground/depth pixels exist;
   - verify clean/reference/UI/helper separation.
7. Inspect the final PNG itself. Reject frames that read as standing, pelvis-first distortion, floating subject, weak ground cue, clipped critical anatomy, or generic low-angle portrait.
8. Keep at least one honest negative frame, such as false-low-angle/standing or floating-contact, when useful for regression chronology.

Required accepted filenames:

- `docs/session-evidence/S16-static-wormeye-approach-accepted-output-camera-1280x720.png`
- `docs/session-evidence/S16-static-wormeye-approach-accepted-clean-1280x720.png`

## Task 6: Reviews and freshness-preserving closeout

1. Run focused unit and focused WebGL tests.
2. Run typecheck, lint, phase-owned Prettier, full unit/component suite, full Chromium/WebGL suite, ordinary production build, production diagnostic exclusion, `git diff --check`, scope audit, and security scan.
3. If the E2E build uses the normal output directory, run ordinary production build last and verify E2E diagnostics are absent.
4. Hash an exact implementation/test/evidence bundle that excludes the self-referential handoff.
5. Run Gemini **3.6 Flash High only** spec review, then quality/correctness/security review. Do not substitute another model if unavailable.
6. Reviews must explicitly judge the actual accepted pixels as unmistakable static worm’s-eye running-toward-camera, verify that thresholds were not weakened to fit output, and verify OTS/Companion/SceneDocument boundaries remain untouched.
7. Resolve all Important-or-higher findings with focused RED→GREEN and re-review the final hash.
8. Write `docs/session-handoffs/S16-static-wormeye-approach-solver.md` with RED/GREEN chronology, candidate metrics, accepted/rejected visual chronology, exact commands/counts, evidence hashes, review model/hash/verdicts, scope exclusions, listener state, and final intended commit message.
9. Create exactly one final commit: `feat: add static worm-eye approach solver`.
10. Verify exact commit SHA/message, clean worktree, no task-owned 4173/4174 listener, preserved 5173/PID 42743, and no pending/in-progress todos.
11. Stop. Do not continue into Companion integration.

## Final acceptance checklist

- [ ] Focused RED observed before production module exists.
- [ ] Pure solver returns deterministic JSON-safe camera + subject-staging proposal.
- [ ] Input profile, SceneDocument, store, history, dirty state, and runtime objects are not mutated.
- [ ] 24 mm and 5–15 cm camera policy are exact and shot-local.
- [ ] Contact and flight grounding policies are distinct and tested.
- [ ] Actual 1280×720 pixels unmistakably read as a static ground-level camera facing a running approach.
- [ ] Accepted clean PNG shows grounded/support or explicit flight semantics, readable silhouette, low horizon/ground depth, and no UI/helper leakage.
- [ ] Full gates and both Gemini 3.6 Flash High reviews pass on the final unchanged bundle.
- [ ] One focused commit exists and worktree is clean.
- [ ] Companion integration remains explicitly incomplete.
