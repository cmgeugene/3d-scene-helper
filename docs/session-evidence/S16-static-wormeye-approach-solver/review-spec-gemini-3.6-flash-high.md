# S16 Static Worm’s-Eye Approach Solver — Specification-Compliance Review

## Reviewer & Bundle Verification

- **Model Identity:** `gemini-3.6-flash-high` (Gemini 3.6 Flash High)
- **Review Bundle Manifest:** `docs/session-evidence/S16-static-wormeye-approach-solver/review-bundle.json`
- **Verified Bundle SHA-256:** `b2a3f1253697607082441075775475f7e063cc3782866c79ac37983e60acb1d0`
- **Individual File Hashes & Sizes:** 14/14 files verified matches.
- **Aggregate Bundle Hash Status:** **MATCH** (recalculated SHA-256 of canonical UTF-8 JSON matches exact manifest hash).

---

## Pixel-by-Pixel Visual Observations

### 1. Accepted Clean Export (`S16-static-wormeye-approach-accepted-clean-1280x720.png`)
- **Dimensions & Format:** 1280×720 pixels, clean PNG export (no editor UI, selection bounding box, transform gizmo, or guide overlays).
- **Camera Perspective:** Ground-level camera at absolute world height $y = 0.08\text{ m}$ (8 cm), pitched upward at $+19.39^\circ$. High-foreshortening perspective looking up at the approaching runner.
- **Subject Pose & Staging:** Orange sprint runner (`#f05a28`). Left support foot is planted at the bottom of the frame on the floor plane ($y = 0.056\text{ m}$, $0.006\text{ m}$ clearance above floor top $0.05\text{ m}$). Right leg is airborne with high knee flexion and advancing foot sole turned toward the camera ($0.260\text{ m}$ free foot clearance). Opposing arm action (left arm bent forward, right arm swung back). Torso tilted forward with face center/visor clearly visible looking down toward the camera.
- **Floor & Environment:** Gray floor plane (`#7f93a6`) visible in the bottom region stretching into depth; dark blue/gray studio background (`#203040`). Floor perspective lines establish genuine ground room ($0.071$ NDC).
- **Visual Verdict:** Unmistakably reads as a static ground-level camera facing an approaching runner.

### 2. Accepted OutputCamera Screenshot (`S16-static-wormeye-approach-accepted-output-camera-1280x720.png`)
- **Dimensions & Format:** 1280×720 Playwright Chromium screenshot of the full WebGL editor UI.
- **Viewport Content:** Rendered OutputCamera frame displays the exact 3D scene from the clean export. Orange runner is selected, showing yellow 3D bounding box wireframe and transform gizmo at the pelvis/hip center. Green `WebGL을 사용할 수 있습니다.` badge visible in the bottom-right viewport corner.
- **Inspector Panel:** Object list shows `S16 long approach floor` and `S16 orange sprint runner`. Inspector panel confirms position $(0, 0.6813, 2.4)$, rotation $(0, 0, 0)$, scale $(1, 1, 1)$, and color `#f05a28`.

### 3. Rejected Standing Negative Control (`S16-static-wormeye-approach-rejected-standing-output-camera-1280x720.png`)
- **Dimensions & Format:** 1280×720 Playwright Chromium screenshot of the editor UI.
- **Subject Pose & Staging:** Dark red mannequin (`#a33b2b`) in a neutral standing posture with parallel straight legs, arms hanging at sides, and upright torso.
- **Failure Characterization:** Legs clipped at viewport bottom, zero foot/knee separation from pelvis, no airborne clearance, and symmetrical neutral silhouette. Honestly fails solver action-silhouette policy (`invalid-action-silhouette`).

---

## Numbered Item Judgments

### 1. Deterministic pure solver, JSON-safe fail-closed diagnostics, stable IDs/tie-breaks: **PASS**
- Implementation: [`src/editor/cinematography/staticWormEyeApproachSolver.ts`](file:///Users/js/Documents/3d-scene-helper-worktrees/static-wormeye-approach-solver/src/editor/cinematography/staticWormEyeApproachSolver.ts#L637-L723).
- Pure function `solveStaticWormEyeApproach` generates candidates with stable IDs (`static-wormeye-approach-000`–`143`) and applies deterministic sorting `right.score - left.score || left.id.localeCompare(right.id)`.
- `validateIntent` (lines 569–631) fails closed on non-finite profiles, invalid motion vectors, bad clearance, or invalid camera height. Failure reasons follow canonical `REJECTION_REASON_ORDER`.
- Tests [`src/editor/cinematography/staticWormEyeApproachSolver.test.ts`](file:///Users/js/Documents/3d-scene-helper-worktrees/static-wormeye-approach-solver/src/editor/cinematography/staticWormEyeApproachSolver.test.ts#L123-L142) verify byte-level JSON determinism (`JSON.stringify(repeated) === JSON.stringify(first)`).

### 2. Copied-profile corridor alignment, transient staging only, no store/history/runtime side effects: **PASS**
- Implementation: `transformedProfile` (lines 259–288) and `stagedSubject` (lines 290–332).
- Solver operates entirely on cloned `CinematicSubjectProfile` instances. Input intent profile remains untouched (`expect(intent).toEqual(before)` in tests).
- Returns transient `yawDeltaDeg`, `translationDelta`, and `groundingDeltaY`. No mutations to `editorStore`, history, `SceneDocument`, or runtime Three objects.

### 3. Support-contact vs flight semantics, foot grounding, non-support clearance, absolute camera $y=5\text{--}15\text{ cm}$: **PASS**
- Implementation: Lines 313–322, 419–424, 431–444, 481–495.
- `support-contact` phase grounds the chosen support foot to $y = \text{floorTopY} + \text{groundClearanceM}$ with support contact error $\le 10^{-7}\text{ m}$. Non-support foot clearance is checked ($\ge 0.12\text{ m}$).
- `flight` phase applies zero grounding delta ($0\text{ m}$) and checks airborne clearance ($> \text{groundClearanceM}$).
- Camera height is set strictly to `intent.cameraHeightM` (bounded to $0.05\text{--}0.15\text{ m}$) and remains absolute in world space, independent of floor height or subject grounding.

### 4. Exact static OutputCamera, 24 mm tracer, no camera motion, chest/head aim, target occupancy/aspect/intensity consumed: **PASS**
- Implementation: Lines 334–364, 518–537.
- Camera focal length is set directly to requested `lensMm` (24 mm in production tracer); `cameraMotion` is strictly `'none'`.
- Camera aim target is calculated from weighted chest and face landmarks (`scale(chest, 1-weight) + scale(faceCenter, weight)`), avoiding raw bounds center.
- `targetOccupancy` (0.65–0.85 range), `outputAspect`, and `intensity` directly drive scoring and candidate selection.

### 5. Action landmarks, head/face, critical leading limb, floor room, approach alignment, upward perspective, occupancy, pelvis dominance, and validator agreement: **PASS**
- Implementation: `diagnosticsForCandidate` (lines 366–538) and `validateStaticWormEyeApproach` (lines 726–803).
- Requires `approachAlignment >= 0.985`, `upwardPitchDeg >= 12°`, `occupancy.height` in $[0.65, 0.85]$, `groundRoom >= 0.025`, `pelvisDominanceRatio <= 1.5`, head/face inside frame, leading knee/foot inside frame, opposing limb phase, and hands below head.
- `validateStaticWormEyeApproach` independently revalidates all proposal diagnostics and matches solver outcomes.

### 6. `projectionMetrics.ts` remains measurement-only and unchanged; no forbidden scope: **PASS**
- File: [`src/editor/cinematography/projectionMetrics.ts`](file:///Users/js/Documents/3d-scene-helper-worktrees/static-wormeye-approach-solver/src/editor/cinematography/projectionMetrics.ts).
- Hash matches baseline (`291327f1809e...`). Remains strictly measurement-only without solver rules or grounding logic.
- Zero edits to Companion, UI store, timeline, physics, persistence schema, or OTS files.

### 7. Strict TDD evidence, actual WebGL E2E, fixture-copy application, 1280x720 exports, subject/floor isolation, clean/reference/helper separation: **PASS**
- Implementation: [`e2e/staticWormEyeApproach.spec.ts`](file:///Users/js/Documents/3d-scene-helper-worktrees/static-wormeye-approach-solver/e2e/staticWormEyeApproach.spec.ts).
- E2E runs in Playwright Chromium WebGL at 1280×720, applying proposal staging to a `structuredClone` copy of the runner object.
- Exports exact 1280×720 OutputCamera screenshot and clean PNG download.
- Subject isolation verifies 21,827 subject pixels across upper, middle, and lower silhouette bands; floor isolation verifies 25,519 floor pixels in the lower frame region.
- Selected vs deselected clean mismatch ratio is $0$; clean vs reference mismatch ratio is $> 0.001$.

### 8. Actual accepted pixels read as static ground-level camera facing approaching runner; rejected pixels show failure: **PASS**
- Visual inspection confirms accepted pixels feature a high-flexion advancing leg, planted left support foot, low camera height ($8\text{ cm}$), $+19.39^\circ$ upward pitch, and ground depth.
- Rejected pixels honestly demonstrate neutral standing control failure (`invalid-action-silhouette`).

### 9. Thresholds are principled and not weakened to fit weak pixels: **PASS**
- Camera height ($0.05\text{--}0.15\text{ m}$), height occupancy ($0.65\text{--}0.85$), upward pitch ($\ge 12^\circ$), approach alignment ($\ge 0.985$), pelvis dominance ($\le 1.5$), free foot clearance ($\ge 0.12\text{ m}$), and support contact error ($\le 10^{-7}\text{ m}$) are mathematically strict and un-weakened.

---

## Findings

No findings.

---

## Final Verdict

**APPROVE**
