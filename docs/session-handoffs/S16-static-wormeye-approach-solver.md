# S16 Static Worm’s-Eye Approach Solver handoff

Session ID: `20260810_163830_db21ab`

## Repository and baseline invariants

- Worktree: `/Users/js/Documents/3d-scene-helper-worktrees/static-wormeye-approach-solver`
- Branch: `feat/static-wormeye-approach-solver`
- Required production baseline and merge base: `54fbba0c7a183d26adb12a6ef79b2019173cd81c`
- The only starting untracked file was `.hermes/plans/S16-static-wormeye-approach-solver.md`; it is task-owned and included in S16.
- `npm ci` had already completed without lockfile drift and baseline typecheck had passed before implementation.
- The protected dirty prototype at `/Users/js/Documents/3d-scene-helper` was never reset, stashed, copied into, or modified by S16.
- Original listener `127.0.0.1:5173` remains PID `42743`, command `node /Users/js/Documents/3d-scene-helper/node_modules/.bin/vite --host 127.0.0.1 --port 5173 --strictPort`.
- Task-owned listeners `4173` and `4174` are clear after verification.

## Delivered contract

`solveStaticWormEyeApproach` is a deterministic, pure shot-family solver for a static ground-level camera facing an approaching posed subject.

- The solver consumes a copied `CinematicSubjectProfile`; it does not mutate the input profile.
- A nonzero motion vector is normalized on the XZ ground plane. A vertical-only or zero vector fails closed.
- The posed profile is yaw-aligned to the approach corridor and staged opposite the camera along that corridor.
- The result returns only transient proposal data:
  - `yawDeltaDeg`;
  - `translationDelta`;
  - intent-local `groundingDeltaY`;
  - transformed profile copy;
  - exact static `SceneDocument['outputCamera']`;
  - deterministic candidate ID, score, metrics, and JSON-safe diagnostics.
- The camera position remains exactly at absolute world `y = intent.cameraHeightM`; it is never raised by subject grounding or floor elevation.
- Camera height is fail-closed outside 5–15 cm. The production tracer uses exactly 24 mm and 8 cm.
- `cameraMotion` is literally and exclusively `'none'`.
- Camera aim starts from a weighted chest/face point and samples deterministic framing offsets while remaining above the pelvis. It does not aim at a generic bounds center.
- `outputAspect`, `targetOccupancy`, and `intensity` materially participate in projection and candidate ranking.
- Candidate ranking is score-descending with lexical candidate-ID tie-breaks.
- Stable IDs cover the fixed ordered 144-candidate search grid.

The solver does not import or mutate the editor store, history, dirty state, persistence APIs, runtime Three objects, or a `SceneDocument`. `projectionMetrics.ts` remains unchanged and measurement-only.

## Grounding and action semantics

### Support contact

- Exactly the requested posed support-foot landmark is grounded to `floorTopY + groundClearanceM`.
- Support-contact error must be at most `1e-7 m`.
- The opposite foot must remain at least `0.12 m` above floor; otherwise the candidate is rejected as `free-foot-too-low` rather than mislabeled as an unmistakable run.
- Ground-room policy anchors to the selected support foot, not an airborne leading foot. This prevents a candidate from claiming floor perspective while the actual support contact is cropped.

### Flight

- Flight has no support foot and applies zero grounding delta.
- Both original posed foot heights are preserved relative to the profile.
- Minimum foot clearance must remain greater than the requested ground clearance, or the candidate is rejected as `flight-not-airborne`.

Grounding is intent-local. No schema, global projection policy, timeline, animation, or physics behavior was added.

## Acceptance and diagnostics

Accepted candidates enforce all of the following without changing `projectionMetrics.ts`:

- approach alignment `>= 0.985`;
- absolute camera height in `[0.05, 0.15] m`;
- projected height occupancy in `[0.65, 0.85]`;
- upward pitch `>= 12°`;
- `headTop` and `faceCenter` inside frame;
- action-critical leading knee and foot inside frame;
- support-foot ground room `>= 0.025` for support contact, or leading-foot ground room for flight;
- opposing arm/leg phase;
- both hands below the head;
- leading-knee/pelvis screen separation `>= 0.08`;
- leading-foot/pelvis screen separation `>= 0.12`;
- pelvis-dominance ratio `<= 1.5`;
- exact selected support contact or honest airborne flight;
- non-support foot clearance `>= 0.12 m` during support contact.

Ordered failure reasons include invalid subject/motion/floor/clearance/support/camera inputs, camera-height failure, approach/framing/head/critical-limb/pelvis/action/floor/support/free-foot/flight failures, and `no-candidate`.

`validateStaticWormEyeApproach` independently rechecks returned camera height, camera motion, approach alignment, occupancy, upward pitch, head/face, leading limb, pelvis dominance, ground room, action silhouette, free-foot clearance, and support contact instead of merely trusting `diagnostics.accepted`.

## TDD chronology

Strict TDD was used before the production module existed and continued with vertical behavior corrections.

1. Created `staticWormEyeApproachSolver.test.ts` importing the not-yet-existing module.
2. Ran `npm test -- --run src/editor/cinematography/staticWormEyeApproachSolver.test.ts`.
3. Recorded the expected missing-module RED, exit `1`.
4. Added the first deterministic 24 mm / 8 cm support-contact tracer implementation.
5. Recorded a behavioral RED, corrected the posed fixture and deterministic camera/staging candidate logic, then reached the first GREEN.
6. Added and drove separate RED→GREEN bullets for:
   - reversed approach direction reversing yaw and subject placement;
   - nonfinite profile fail-closed JSON-safe diagnostics;
   - flight preserving the airborne profile without grounding;
   - selected-foot grounding diagnostics and absolute camera-height independence;
   - independent validator rejection of a fabricated high camera;
   - explicit 5–15 cm request validation;
   - canonical ordered standing-silhouette failures and stable candidate IDs;
   - pelvis-dominance diagnostics and rejection;
   - positive square-aspect sampling and chest/head-derived aim;
   - actual support-foot ground-room anchoring;
   - non-support-foot clearance for a readable support-contact running phase.
7. The final focused unit file passes 14/14 tests.

No production module was written before the missing-module RED.

## Actual WebGL evidence and visual correction chronology

`e2e/staticWormEyeApproach.spec.ts` calls the production solver on a custom unmistakable sprint pose, applies the returned yaw/translation/grounding only to a `structuredClone` fixture object, and verifies reconstructed cinematic landmarks against the solver's transformed profile.

The test then loads the fixture through the real editor store test bridge, actual Playwright Chromium WebGL, and real OutputCamera.

Verified runtime facts:

- exact runtime camera parity at six-decimal diagnostic precision;
- 24 mm lens, 8 cm absolute world height, no camera motion;
- actual 1280×720 OutputCamera/editor screenshot;
- actual exact 1280×720 clean PNG download;
- subject-hidden pixel isolation:
  - `21,827` subject pixels;
  - `0.7485380116959064` actual subject pixel-height ratio;
  - upper/middle/lower action bands all populated;
- floor-hidden isolation: `25,519` changed lower-frame floor pixels;
- projected height occupancy `0.7239377227631534`;
- exact selected support contact at world `y = 0.056 m` with zero error;
- airborne free-foot landmark clearance `0.260296788 m`;
- selected and deselected clean exports are pixel-identical;
- reference-with-thirds differs from clean, proving separate reference and clean paths and helper exclusion;
- no page errors or console errors.

Early runtime images were rejected during development because the floor strip was too weak or the advancing foot visually approached the floor. Thresholds were not weakened. The correction instead:

- anchored support-contact ground-room to the selected support foot;
- lowered deterministic chest/head-derived framing while keeping the target above pelvis;
- improved the custom sprint fixture;
- added the new `0.12 m` non-support-foot clearance contract and RED→GREEN unit coverage.

Final strict visual inspection passed:

- one planted support foot and one clearly airborne advancing foot;
- asymmetric opposing sprint arms and raised/bent advancing leg;
- head and face visible;
- strong ground-level foreshortening without pelvis dominance;
- visible floor depth and honest contact;
- no critical landmark clipping;
- unmistakable approach toward a static ground-level camera.

The committed standing negative control remains upright, symmetric, and actionless and honestly demonstrates rejection.

## Evidence

Directory: `docs/session-evidence/S16-static-wormeye-approach-solver/`

- `S16-static-wormeye-approach-accepted-clean-1280x720.png`
  - SHA-256 `a1e121365b480ec3a32d4bc75354c1002afa69c0bf1da02b90cdc41ad21cc5a2`
- `S16-static-wormeye-approach-accepted-output-camera-1280x720.png`
  - SHA-256 `84453f93c2940c159847968a4cc5d69289355eb23ecf8b3414eba19e7502fdb7`
- `S16-static-wormeye-approach-rejected-standing-output-camera-1280x720.png`
  - SHA-256 `a7c35f52542eb630b93147daf452afcf6e7ce44248a360a98e289938f1894a62`
- `manifest.json`
  - exact camera, staging, metrics, isolation counts, PNG hashes, and visual-target provenance;
- `visual-inspection.md`
  - explicit accepted/rejected pixel observations;
- `review-bundle.json`
  - 14-file immutable implementation/test/evidence review bundle;
  - aggregate SHA-256 `b2a3f1253697607082441075775475f7e063cc3782866c79ac37983e60acb1d0`;
- `review-spec-gemini-3.6-flash-high.md`
  - SHA-256 `79240fa069754d4ed23aa1550ff1be9164b824cf11d918734e2e896ec297713a`;
- `review-quality-gemini-3.6-flash-high.md`
  - SHA-256 `f187497c36fa609b55f992dc01960827bdd6fdff4f8b21921059537bd96cc678`.

The external image `/Users/js/Documents/3d-scene-helper/artifacts/wormeye-front-running-24mm-1280x720.png` was visual-target-only, SHA-256 `f3a85cafdf779188ebc6b02c47b91b3cb534e98cc2abade12747324fc8c5c944`. It was never copied or used as solver/runtime evidence.

## Independent reviews

Both reviews used only `gemini-3.6-flash-high` and independently recomputed the same exact review-bundle hash before judging.

### Specification review

- Model: Gemini 3.6 Flash High (`gemini-3.6-flash-high`)
- Bundle: `b2a3f1253697607082441075775475f7e063cc3782866c79ac37983e60acb1d0`
- Explicitly inspected all three actual PNGs and threshold integrity.
- Findings: none.
- Verdict: `APPROVE`.

### Quality/correctness/security review

- Model: Gemini 3.6 Flash High (`gemini-3.6-flash-high`)
- Bundle: `b2a3f1253697607082441075775475f7e063cc3782866c79ac37983e60acb1d0`
- Explicitly inspected all three actual PNGs, numerical behavior, fail-closed paths, validator independence, threshold integrity, and phase-added security.
- Findings: none.
- Threshold-integrity verdict: `PASS`.
- Phase-added security verdict: `PASS`.
- Verdict: `APPROVE`.

No remediation was required after either exact-bundle review.

## Verification gates

Final recorded gates:

1. Focused unit: 14/14 passed.
2. `npm run typecheck`: exit `0`.
3. `npm run lint`: exit `0`.
4. `npm test -- --run`: exit `0`; 21 files, 305/305 tests passed.
5. `npm run build`: exit `0`; 687 modules; production bridge/diagnostic exclusion passed.
6. Focused actual-WebGL E2E: 1/1 passed with exact evidence metrics.
7. Full `npm run test:e2e:preview`: exit `0`; 72/72 Chromium/WebGL tests passed.
8. An attempted `npm run test:e2e:preview -- --reporter=line` was rejected by `start-server-and-test` argument parsing before tests ran; the exact canonical script was then run and passed 72/72.
9. Phase-owned Prettier: exit `0` for source, unit, E2E, plan, manifest, visual notes, and this handoff; independent review outputs remain verbatim.
10. `git diff --check`: exit `0`.
11. Production dependency audit matches baseline exactly:
    - 0 info, 0 low, 0 moderate, 2 high, 0 critical;
    - findings remain `brace-expansion` and `nanoid`;
    - phase-added dependency findings: none;
    - package and lockfile unchanged;
    - no `npm audit fix` was run.
12. Added-file security scan: no credential assignments, private-key blocks, dynamic evaluation, or child-process execution.
13. Forbidden-scope diff: zero changes to Companion, preview/apply UI, editorStore/history/dirty state, SceneDocument schema/version, OTS code/tests/evidence, animation/timeline/physics, or `projectionMetrics.ts`.
14. Final ordinary production build is restored after E2E-mode build.
15. Task-owned ports `4173`/`4174` are clear; protected `5173`/PID `42743` remains.

## Security distinction

The 2 high-severity dependency audit findings are baseline repository findings, not introduced by S16. S16 changes no dependency declaration or lockfile and adds no process execution, dynamic evaluation, network client, credential handling, or untrusted filesystem path behavior.

## Explicit exclusions

S16 does not add or modify:

- Companion parser, planner, schema, client, or panel;
- preview/apply UI;
- editorStore, undo/redo, history, dirty-state, transactions, or persistence;
- SceneDocument schema or version;
- OTS implementation, tests, or evidence;
- `projectionMetrics.ts` policy;
- timeline, animation, or physics;
- the protected dirty prototype lane.

No Companion integration follows this phase.

## Files

- `.hermes/plans/S16-static-wormeye-approach-solver.md`
- `src/editor/cinematography/staticWormEyeApproachSolver.ts`
- `src/editor/cinematography/staticWormEyeApproachSolver.test.ts`
- `e2e/staticWormEyeApproach.spec.ts`
- `docs/session-evidence/S16-static-wormeye-approach-solver/S16-static-wormeye-approach-accepted-clean-1280x720.png`
- `docs/session-evidence/S16-static-wormeye-approach-solver/S16-static-wormeye-approach-accepted-output-camera-1280x720.png`
- `docs/session-evidence/S16-static-wormeye-approach-solver/S16-static-wormeye-approach-rejected-standing-output-camera-1280x720.png`
- `docs/session-evidence/S16-static-wormeye-approach-solver/manifest.json`
- `docs/session-evidence/S16-static-wormeye-approach-solver/visual-inspection.md`
- `docs/session-evidence/S16-static-wormeye-approach-solver/review-bundle.json`
- `docs/session-evidence/S16-static-wormeye-approach-solver/review-spec-gemini-3.6-flash-high.md`
- `docs/session-evidence/S16-static-wormeye-approach-solver/review-quality-gemini-3.6-flash-high.md`
- `docs/session-handoffs/S16-static-wormeye-approach-solver.md`

## Commit and listener contract

- Exact commit message: `feat: add static worm-eye approach solver`.
- The exact commit SHA is verified and reported in final closeout rather than embedded here, avoiding a self-referential commit hash.
- Exactly one final commit is created from the required baseline.
- Task-owned ports `4173` and `4174` are clear after closeout.
- Original `127.0.0.1:5173` remains PID `42743` and is not stopped, reused, or modified.
