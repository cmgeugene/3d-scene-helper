# Session S14 Handoff — Deterministic dialogue OTS solver

- Hermes session ID: `20260810_113230_c39c00`
- Phase: S14 / plan Phase 2 only
- Worktree: `/Users/js/Documents/3d-scene-helper-worktrees/dialogue-ots-solver`
- Branch: `feat/dialogue-ots-solver`
- Starting HEAD: `c164d5f54521cade33779f2d6075d02775eca2a0` (`test: strengthen cinematic projection visual evidence`)
- Intended commit message: `feat: add deterministic dialogue ots solver`
- Evidence time: `2026-08-10 11:58:00 KST`
- Final commit SHA: this tracked handoff is part of that same commit, so it cannot contain its own cryptographic identity. The immutable SHA is recorded in the post-commit completion report.

## Phase 2 scope completed

Phase 2 adds a pure, deterministic dialogue OTS solver on top of the committed Phase 1 `CinematicSubjectProfile` and `computeCinematicProjectionMetrics` APIs.

`DialogueOtsIntent` is JSON-safe and accepts either inline subject/foreground profiles or explicit object-ID references resolved from a caller-supplied profile registry. It consumes:

- subject and foreground roles;
- requested left/right shoulder;
- positive, negative, or preserved 180-degree axis-side policy;
- `medium-close` or `tight` shot size;
- bounded intensity;
- physical focal length in millimeters using the shared film gauge;
- output aspect ratio.

The solver generates a fixed deterministic grid of camera candidates behind and outside the named foreground shoulder. It uses speaker/listener eye and face anchors, head and neck anchors, both shoulders, chest, the foreground basis, Phase 1 outline points, and the horizontal conversation axis. It aims in output-frame image space for upper-region eyes and requested lateral placement.

Each candidate is projected through the real Phase 1 output-camera path and receives JSON-safe diagnostics for:

- subject eye NDC placement;
- subject headroom and look room;
- subject face-height occupancy;
- subject critical clipping;
- foreground edge contact;
- foreground head, shoulder, named-silhouette, and outline width occupancy;
- foreground named/outline clipping;
- foreground-to-face clearance and rectangular overlap ratio;
- foreground torso-wall classification;
- camera-space near-plane margin;
- 180-degree axis sign and continuity;
- named component scores and explicit rejection reasons.

Only accepted candidates are returned in a score-descending, ID-tie-broken ranking. Rejected candidates remain transient diagnostics. The function does not receive or mutate `SceneDocument`, Zustand/store state, history, dirty state, persistence, or runtime Three objects.

## Changed Phase 2 files

1. `src/editor/cinematography/dialogueOtsSolver.ts`
2. `src/editor/cinematography/dialogueOtsSolver.test.ts`
3. `e2e/dialogueOts.spec.ts`
4. `docs/session-evidence/S14-dialogue-ots-left-rejected-torso-heavy.png`
5. `docs/session-evidence/S14-dialogue-ots-left-accepted.png`
6. `docs/session-evidence/S14-dialogue-ots-right-accepted.png`
7. `docs/session-handoffs/S14-dialogue-ots-solver.md`

No Phase 1 production file was modified. In particular, `projectionMetrics.ts` remains measurement-only and has no global required-landmark or pass/fail policy.

## Strict RED → GREEN chronology

### Tracer 2.1 — base transient solver contract

1. RED: `npm test -- --run src/editor/cinematography/dialogueOtsSolver.test.ts`
   - First prerequisite run failed because this fresh worktree had no `node_modules`; `npm ci` installed the lockfile-defined dependencies.
   - Expected feature RED after prerequisites: suite import failed because `./dialogueOtsSolver` did not exist.
2. GREEN: the smallest inline-profile left-shoulder implementation returned one plain camera candidate without input mutation.
   - Focused result: **1/1 passed**; typecheck passed.

### Tracer 2.2 — object-ID profile resolution

1. RED: focused ID-reference test threw `RangeError: Missing cinematic subject profile for speaker.`
2. GREEN: added the explicit profile registry argument and deterministic ID resolution.
   - Focused/full solver result: **2/2 passed**.

### Tracer 2.3 — image-space OTS generation and diagnostics

1. RED: the standard medium-close contract expected at least two ranked candidates and the minimal implementation returned only one.
2. First implementation RED: the candidate grid produced zero accepted candidates because the anatomical left shoulder correctly projected to the opposite frame edge, while the initial expected-edge mapping was reversed.
3. GREEN: corrected the anatomical shoulder-to-screen-edge mapping and added candidate generation/scoring for eyes, headroom, look room, face clearance, foreground occupancy, clipping, near-plane safety, and axis continuity.
   - Focused result: **1/1 passed**; then **3/3 passed**.

### Tracer 2.4 — preserved 180-degree continuity

1. RED: with the hard axis rejection deliberately absent, a preserved opposite-side intent returned **20 accepted** candidates whose diagnostics all reported `axisContinuity: false`.
2. GREEN: every crossing candidate is rejected with `axis-discontinuity`.
   - Focused result: **1/1 passed**; solver suite **5/5 passed**.

### Tracer 2.5 — reject false wide two-shots

1. RED: a synthetic foreground with collapsed head/shoulder silhouette returned accepted candidates with approximately 0–0.6% foreground width and no edge shoulder.
2. GREEN: candidates without requested edge contact or with foreground width below the explicit OTS floor are rejected as `false-wide-two-shot`.
   - Focused result: **1/1 passed**.

### Tracer 2.6 — reject materially face-blocked OTS

1. RED: a synthetic foreground silhouette placed over the speaker face was rejected for other framing reasons but had no `face-blocked` reason.
2. GREEN: face overlap above 18% or essentially zero face clearance adds the hard `face-blocked` rejection.
   - Focused result: **1/1 passed**.

### Tracer 2.7 — explicit Phase 1 outline consumption

1. RED: focused standard OTS test read `undefined` for outline width/clipping diagnostics.
2. GREEN: outline projection now contributes width/clipping diagnostics, clipping score, and near-plane depth sampling. The physical target solve uses shared `FILM_GAUGE_MM` rather than a duplicate literal.
   - Focused result: **1/1 passed**; full solver suite **16/16 passed**.

### Tracer 2.8 — real Chromium/WebGL output-camera pixels

1. Initial harness correction: the first Playwright run failed because the existing runtime camera diagnostic serializes position as an object rather than a tuple. The E2E parser was corrected before treating the composition assertion as the visual RED.
2. Actual visual RED at 1280×720:
   - left-shoulder foreground changed-pixel envelope occupied **0.3328947368** of output-frame width, above the explicit 30% calibration ceiling;
   - direct inspection showed a large foreground torso/arm wall and a small, nearly full-body speaker, so it was preserved as rejected evidence.
3. GREEN calibration:
   - expanded deterministic outside-shoulder samples;
   - calibrated landmark occupancy toward a smaller foreground silhouette;
   - made sufficient face clearance saturate rather than penalizing additional clearance;
   - used a plausible 1.0 m dialogue separation in the visual fixture rather than the rejected 2.0 m blocking.
4. Focused left result: **1/1 passed**.
5. Both shoulder directions: **2/2 passed** with actual Canvas/WebGL pixels, foreground-hidden and subject-hidden negative controls, output-frame edge contact, 15–30% changed-pixel foreground width, visible subject-face pixels, and 1280×720 full-page evidence.

## Unit coverage

The final solver suite contains **16/16 passing tests** covering:

- inline profiles and object-ID references;
- JSON serialization and source non-mutation;
- standard, athletic, and heavy pairs;
- both left and right shoulder directions;
- head/shoulder/outline diagnostics;
- axis preservation and explicit crossing rejection;
- false-wide/no-shoulder rejection;
- face-blocked rejection;
- deterministic byte-equivalent ranking and tie identity;
- physical lens, output aspect, shot-size, and intensity sensitivity;
- invalid numeric intent and unresolved ID failure.

The focused solver + Phase 1 measurement regression is **25/25 passed**: 16 solver tests plus all 9 measurement-only projection tests.

## Chromium/WebGL evidence

### Rejected visual candidate

- Path: `/Users/js/Documents/3d-scene-helper-worktrees/dialogue-ots-solver/docs/session-evidence/S14-dialogue-ots-left-rejected-torso-heavy.png`
- Dimensions: **1280×720**
- SHA-256: `feb27a82175abc605d716a6c098efc5c1f112f54a2eddb4d0864571c2b38430e`
- Failure: actual foreground pixels occupied 33.29% of output width; the dark foreground head/torso/arm became a visual wall, while the speaker read too small and too close to a wide/full-body two-shot. This file is negative evidence only.

### Accepted left shoulder

- Path: `/Users/js/Documents/3d-scene-helper-worktrees/dialogue-ots-solver/docs/session-evidence/S14-dialogue-ots-left-accepted.png`
- Dimensions: **1280×720**
- SHA-256: `2f4eacc508b41903bb36f1cc7f5110b5d8ef00f38f6b38412ad65ac977413f53`
- Visual reading: dark foreground head/neck/shoulder is cropped against the right edge at the explicit 19% numeric calibration label; the speaker is a medium-close chest-up figure, face is unobstructed, eyes sit in the upper region, and positive look room/headroom remain.

### Accepted right shoulder

- Path: `/Users/js/Documents/3d-scene-helper-worktrees/dialogue-ots-solver/docs/session-evidence/S14-dialogue-ots-right-accepted.png`
- Dimensions: **1280×720**
- SHA-256: `129db8ee8c73973fa14e75f677f64dc6d99185dda119bafaf3ca37ee58c95440`
- Visual reading: the mirrored dark foreground head/neck/shoulder is cropped against the left edge at the explicit 16% label; the speaker face remains visible with plausible medium-close scale, look room, and headroom. It is neither a wide two-shot nor face-blocked.

The E2E test does not approve pixels from numeric diagnostics alone. It screenshots the actual WebGL canvas, hides the foreground and measures changed pixels in the projected head-to-chest corridor, verifies edge contact and 15–30% output-frame width, then hides the speaker and verifies changed pixels in the projected face region.

## Independent reviews

Required review backend: Antigravity CLI (`agy`) with provider/model **Gemini 3.6 Flash (High)** / `gemini-3.6-flash-high` only. No substitute model is permitted.

- Exact implementation/test/evidence binary diff SHA-256: `8778fdb6d88494393765d1521bd66f7ec32d784a6c692000472bcf18f3c42172`.
- Spec-compliance review: **APPROVED** — `APPROVED: no Critical/Important spec findings.` No Critical, Important, or Minor findings.
- Quality/correctness/security review: **APPROVED** — `APPROVED: no Critical/Important quality/correctness/security findings.` No Critical or Important findings.
- Minor disposition: reviewer noted that a degenerate synthetic profile with a shoulder exactly coincident with its neck would make the normalized shoulder direction fail closed with a descriptive `RangeError`. Accepted with no code change: valid Phase 1 anatomical profiles have distinct shoulder/neck landmarks, and fail-closed behavior is preferable to emitting an undefined camera.
- Important-or-higher disposition: **none; no fix or re-review was required**.
- Review executor: Antigravity CLI (`agy`), provider/model **Google Gemini / `gemini-3.6-flash-high`** for both reviews. No substitute model was used.

## Verification gates

A fresh fail-fast batch passed after both independent reviews on the staged final snapshot:

1. `npm run typecheck` — exit `0`.
2. `npm run lint` — exit `0`.
3. `npm test -- --run` — exit `0`; **19 files, 261/261 passed**.
4. `npm run build` — exit `0`; 687 modules; production bridge exclusion passed.
5. `npm run test:e2e:preview` — exit `0`; task-owned port `4173`; **69/69 Chromium/WebGL tests passed** in approximately 1.0 minute, including both OTS shoulder directions.
6. Final ordinary `npm run build` — exit `0`; 687 modules; ordinary production artifact restored and diagnostics absent.
7. Phase-owned Prettier check over solver, unit test, E2E, and this handoff — exit `0`; all matched files formatted.
8. `git diff --cached --check` — exit `0`.
9. Added-line security scan over the three code/test files — **0 findings** for credential assignments, private-key blocks, dynamic `eval`, or child-process execution.
10. Forbidden-scope audit — exactly **7 expected Phase 2 files**, **0 unexpected**, **0 missing**.
11. Ordinary production artifact string scan — **0** occurrences of the E2E store bridge or OTS evidence overlay diagnostics.
12. Listener check — original `127.0.0.1:5173` remains PID `42743`; task-owned `4173` has no listener after the preview gate.

## Explicit Phase 3/4/5 exclusions

This phase does **not** add or modify:

- any worm-eye solver, intent, test, runtime, or prompt;
- Companion schema, planner, prompt, client, or `CompanionPanel`;
- candidate preview/apply UI or state;
- `editorStore` implementation or version;
- `SceneDocument`, scene schema, codec, persistence, or version constants;
- history, dirty-state, or transaction behavior;
- runtime Three object persistence;
- the preserved dirty prototype at `/Users/js/Documents/3d-scene-helper`.

`projectionMetrics.ts` remains unchanged and measurement-only. OTS calibration bands are local to `DialogueOtsIntent`; no global cinematic pass/fail rule was added.

## Worktree and listener protection

- The original `127.0.0.1:5173` listener was observed at starting PID `42743` and was never reused, stopped, or modified.
- Focused Playwright and full preview gates used task-owned port `4173` only.
- Final listener/clean-worktree evidence is recorded after the commit.
- Phase 3 is explicitly not started.
