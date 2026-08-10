# Session S14 Handoff — Deterministic dialogue OTS solver

- Hermes session ID: `20260810_113230_c39c00`
- Phase: S14 / plan Phase 2 only
- Worktree: `/Users/js/Documents/3d-scene-helper-worktrees/dialogue-ots-solver`
- Branch: `feat/dialogue-ots-solver`
- Starting HEAD: `c164d5f54521cade33779f2d6075d02775eca2a0` (`test: strengthen cinematic projection visual evidence`)
- Original Phase 2 commit: `f901a10fdc167aced887d61ee0c49d1938bf3cf8` (`feat: add deterministic dialogue ots solver`)
- Counter-position correction baseline: clean `f901a10fdc167aced887d61ee0c49d1938bf3cf8`
- Follow-up commit message: `fix: balance dialogue ots counter-positioning`
- Initial evidence time: `2026-08-10 11:58:00 KST`
- Correction evidence time: `2026-08-10 13:31:09 KST`
- Counter-position follow-up commit: `1b49b1f60fa917ffd2fc310ffa718d94f3ac712d` (`fix: balance dialogue ots counter-positioning`)
- Canonical shoulder-over baseline: clean `1b49b1f60fa917ffd2fc310ffa718d94f3ac712d`
- Canonical shoulder-over follow-up message: `feat: add canonical shoulder-over dialogue composition`
- Canonical evidence time: `2026-08-10 14:36:57 KST`
- Canonical follow-up SHA: this tracked handoff is part of that commit, so it cannot contain its own cryptographic identity. The immutable SHA is recorded in the post-commit completion report.

## User-rejected composition and Phase 2 correction

The user rejected both original accepted screenshots with: “인물들이 너무 한쪽으로 몰려있지 않아? 카메라 높이야 ots가 카메라 높이를 다양하게 가져갈 수 있지만 이건 너무 한쪽으로 몰려있는 것 같아.” Camera height was not treated as the defect.

Root cause:

- a left anatomical shoulder correctly placed the foreground on the right output edge, but `desiredEyeX` was also positive;
- a right anatomical shoulder placed the foreground on the left edge, but `desiredEyeX` was also negative;
- the eye-placement score used `abs(eye.x)`, so same-side clustering scored identically to proper counter-positioning;
- the rendered result therefore clustered subject and foreground visual weight on the same side while leaving excessive empty space opposite them.

Before any production edit, both previously accepted files were copied byte-for-byte to explicit rejected evidence paths. The correction stays inside `dialogueOtsSolver`; it does not impose a universal camera height or modify Phase 1 projection policy.

### Correction RED → GREEN chronology

1. **Counter-position sign RED**
   - Added a focused two-case unit contract: foreground right edge requires negative subject eye NDC X, and foreground left edge requires positive subject eye NDC X; both must be 0.15–0.45 away from center for this explicit OTS family.
   - Focused result: **2/2 failed as expected**. Left received sign `+1` instead of `-1`; right received `-1` instead of `+1`.
2. **Minimal sign GREEN**
   - Inverted the shoulder-to-subject aim sign without changing camera-height policy.
   - Focused result: **2/2 passed**.
3. **Explicit diagnostic/score RED**
   - Extended the same focused contract to require JSON-safe `subjectFaceNdc`, `subjectCounterPositioned`, `subjectHorizontalCenterOffset`, and `componentScores.horizontalBalance`, plus absence of `same-side-imbalance` for accepted candidates.
   - Focused result: **2/2 failed as expected** because the new diagnostic values were `undefined`.
4. **Shot-local balance GREEN**
   - Added signed eye/face counter-position diagnostics, a 0.15–0.45 local acceptance band, a signed horizontal-balance score around the calibrated opposite-side target, and the explicit `same-side-imbalance` rejection.
   - Kept these thresholds entirely local to the dialogue OTS solver.
   - Focused result: **2/2 passed**; full solver suite **18/18 passed**.
5. **Real WebGL RED after sign correction**
   - The first focused Chromium run failed at `accepted OTS candidate required`: after moving the subject opposite the foreground, the original camera sample grid could not simultaneously preserve foreground edge contact.
6. **Real WebGL GREEN calibration**
   - Added closer behind-shoulder samples and bounded wider lateral samples needed for near/far parallax.
   - Beyond the original anatomical shoulder offset, extra offset is horizontal rather than continuing the neck-to-shoulder downward slope. This prevents balance correction from being implemented as a forced camera-height change; candidate height remains derived from the profile, shoulder geometry, shot size, and sampled placement.
   - Calibrated the signed eye target to `0.18 + intensity × 0.08` and kept sufficient face clearance, edge contact, 15–30% rendered foreground width, near-plane safety, axis continuity, and torso-wall rejection.
   - Focused Chromium/WebGL result: **2/2 passed**.
7. **Tight-shot regression RED → GREEN**
   - Full solver regression found the tight candidate’s face occupancy smaller than the medium-close candidate after the wider lateral grid.
   - Scaled lateral samples with the existing tight-shot intimacy scale.
   - Focused regression returned GREEN; solver suite returned **18/18 passed** and solver + Phase 1 projection regression returned **27/27 passed**.

Actual rendered-pixel metrics from the final focused run:

- left shoulder: foreground pixel width **25.3947%**, subject-face center **16.4474% left** of output-frame center, eye NDC X `-0.220717`, face NDC X `-0.231893`, headroom `0.253848`, look room `0.610359`;
- right shoulder: foreground pixel width **26.0526%**, subject-face center **12.6316% right** of output-frame center, eye NDC X `0.220048`, face NDC X `0.224944`, headroom `0.262243`, look room `0.610024`.

Both regenerated 1280×720 frames were inspected from actual pixels, not accepted from labels or numeric diagnostics alone. They are balanced shoulder-side alternatives for one visible subject: **balanced dirty singles**, not a shot/reverse-shot pair and not proof of literal shoulder-over topology.

## Canonical/literal shoulder-over continuation

The user correctly rejected the prior semantics: the balanced left/right images fixed same-side clustering, but both retain the same visible subject and foreground identities and therefore are neither shot/reverse-shot coverage nor a literal OTS pair. They remain preserved as `balanced-dirty-single` shoulder-side alternatives. This continuation adds one distinct `canonical-shoulder-over` single without removing them.

Manual visual target only:

- `/Users/js/Documents/3d-scene-helper/artifacts/classic-literal-ots-1280x720.png`
- SHA-256: `79c39c2c3d0fd8d56a35d3479aea3df2cb4ae5a5abd55218ffdffa7594ab5df3`
- Dimensions: **1280×720**
- Use: topology reference only. It is not automation evidence and is not copied into this worktree.

The production API adds the optional JSON-safe `kind` discriminator:

- omitted/default: `balanced-dirty-single`, preserving every existing caller;
- explicit: `canonical-shoulder-over`.

Every returned candidate carries the resolved kind, and candidate IDs include it. This makes the previous alternatives honest while keeping them available. No shot/reverse-shot pair generator was added.

Canonical candidates use a separate shot-local evaluator and deterministic sample family:

- camera placement uses the foreground rear direction and a modest outside-shoulder ratio rather than the far-lateral dirty-single samples;
- the camera-behind dot must be at least `0.65` and lateral-to-behind ratio must remain `0.12–0.85`;
- projected back-of-head/neck must align on the requested edge, while the named shoulder ridge extends inward;
- projected foreground head and shoulder occupancy floors reject an edge/profile sliver;
- subject eyes and the complete projected face envelope must clear the shoulder ridge;
- `side-profile-two-shot`, `dirty-edge-only`, and `shoulder-window-blocked` join the existing false-wide, face-blocked, same-side, torso-wall, clipping, near-plane, and axis rejections;
- three camera-height offsets (`0.16`, `0.25`, `0.34` above the body-specific shoulder anchor) keep height variable rather than imposing one global elevation;
- required physical 50/65/85mm calls all return deterministic ranked canonical candidates;
- all thresholds remain local to this intent kind. `projectionMetrics.ts` remains unchanged and measurement-only.

New JSON-safe diagnostics are:

- `cameraBehindDot`;
- `lateralToBehindRatio`;
- `foregroundRearThreeQuarter`;
- `foregroundHeadNeckEdgeAligned`;
- `foregroundShoulderRidgeNdcY`;
- `subjectEyeClearanceAboveShoulderRidge`;
- `subjectFaceClearanceAboveShoulderRidge`;
- `canonicalShoulderWindow`;
- `componentScores.canonicalTopology`.

### Canonical strict RED → GREEN chronology

1. **Variant/default semantics RED → GREEN**
   - RED: the existing-caller test expected `kind: balanced-dirty-single`; candidate kind was absent.
   - GREEN: added the optional intent discriminator, explicit candidate kind, and kind-bearing deterministic IDs. Focused **1/1 passed**, then solver **19/19 passed**.
2. **Behind/modest-outside geometry RED → GREEN**
   - RED: canonical diagnostics `cameraBehindDot`, `lateralToBehindRatio`, and `foregroundRearThreeQuarter` were `undefined`.
   - GREEN: added rear-direction placement, the bounded ratio diagnostic, and `side-profile-two-shot` rejection. Focused **1/1 passed**.
3. **Projected topology RED → GREEN**
   - RED: head/neck edge alignment, shoulder-ridge Y, eye clearance, and canonical-window diagnostics were `undefined`.
   - GREEN: added projected edge/ridge/window diagnostics with `dirty-edge-only` and `shoulder-window-blocked` hard rejection. Focused **1/1 passed**; solver **21/21 passed**.
4. **50/65/85mm topology ranking RED → GREEN**
   - RED: all three lens cases failed because `componentScores.canonicalTopology` was absent.
   - GREEN: added canonical topology scoring and kind-specific weighting without changing balanced-dirty-single scoring. Focused **3/3 passed**; repeat calls were byte-equivalent and score/ID ordering remained deterministic.
5. **Variable camera height RED → GREEN**
   - RED: canonical evaluation exposed only **2** unique heights instead of the required **3**, and had no full-face-above-ridge diagnostic.
   - GREEN: added three profile-relative height samples and `subjectFaceClearanceAboveShoulderRidge`; focused **1/1 passed**, canonical subset **6/6 passed**.
6. **Actual Chromium/WebGL topology RED**
   - The first 1280×720 candidate passed coarse head/shoulder metrics but failed the rendered face-above-ridge assertion: face bottom pixel Y was `273`, while the required bound was `< 237.0258`.
   - Direct pixel inspection rejected it as a vertical dirty edge/torso strip: foreground head was mostly cropped away, the shoulder did not form a useful window, and the subject face was not clearly above/beyond the ridge.
   - Preserved negative evidence: `docs/session-evidence/S14-canonical-shoulder-over-rejected-torso-strip.png`.
7. **Actual Chromium/WebGL topology GREEN**
   - Profile-relative height variation plus full-face ridge clearance selected a different candidate.
   - Focused Chromium result: **1/1 passed**. Full Phase-owned dialogue E2E: **3/3 passed** (two balanced dirty-single alternatives plus one canonical single).
   - Actual foreground isolation measured **53,972 pixels**; connected upper head/neck width **15.7895%**; lower shoulder-ridge width **26.4474%**; bottom width **32.3684%**; subject face bottom **228.019 px above** the projected ridge; camera-behind dot `0.753136`; lateral-to-behind ratio `0.823636`.

The accepted browser screenshot and clean export were both inspected at actual pixels. The foreground now reads from the rear/rear-three-quarter as one connected back-of-head, neck, and shoulder shape. The lower shoulder enters from the right/lower edge and points inward to form the “over” window; the target face and eyes are unobstructed and clearly above/beyond it. It is not a profile strip, side two-shot, wide two-shot, or torso wall. The clean export contains no editor UI or guides.

## Phase 2 scope completed

Phase 2 adds a pure, deterministic dialogue OTS solver on top of the committed Phase 1 `CinematicSubjectProfile` and `computeCinematicProjectionMetrics` APIs.

`DialogueOtsIntent` is JSON-safe and accepts either inline subject/foreground profiles or explicit object-ID references resolved from a caller-supplied profile registry. It consumes:

- subject and foreground roles;
- requested left/right shoulder;
- positive, negative, or preserved 180-degree axis-side policy;
- `medium-close` or `tight` shot size;
- bounded intensity;
- physical focal length in millimeters using the shared film gauge;
- output aspect ratio;
- optional explicit composition kind, defaulting to `balanced-dirty-single` for backward compatibility.

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
8. `docs/session-evidence/S14-dialogue-ots-left-rejected-same-side-imbalance.png`
9. `docs/session-evidence/S14-dialogue-ots-right-rejected-same-side-imbalance.png`
10. `docs/session-evidence/S14-canonical-shoulder-over-rejected-torso-strip.png`
11. `docs/session-evidence/S14-canonical-shoulder-over-accepted-output-camera-1280x720.png`
12. `docs/session-evidence/S14-canonical-shoulder-over-accepted-clean-1280x720.png`

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

The continued solver suite contains **25/25 passing tests** covering:

- inline profiles and object-ID references;
- JSON serialization and source non-mutation;
- standard, athletic, and heavy pairs;
- both left and right shoulder directions;
- signed eye/face counter-positioning opposite the foreground edge;
- JSON-safe horizontal-balance diagnostics, score, and rejection reason;
- head/shoulder/outline diagnostics;
- axis preservation and explicit crossing rejection;
- false-wide/no-shoulder rejection;
- face-blocked rejection;
- deterministic byte-equivalent ranking and tie identity;
- physical lens, output aspect, shot-size, and intensity sensitivity;
- explicit/default composition-kind semantics;
- canonical camera-behind and modest-outside ratio;
- canonical rear head/neck edge, inward shoulder ridge, and full-face clearance;
- deterministic canonical 50/65/85mm ranking;
- three profile-relative camera-height samples;
- invalid numeric intent and unresolved ID failure.

The focused solver + Phase 1 measurement regression is **34/34 passed**: 25 solver tests plus all 9 measurement-only projection tests.

## Chromium/WebGL evidence

### Rejected visual candidate

- Path: `/Users/js/Documents/3d-scene-helper-worktrees/dialogue-ots-solver/docs/session-evidence/S14-dialogue-ots-left-rejected-torso-heavy.png`
- Dimensions: **1280×720**
- SHA-256: `feb27a82175abc605d716a6c098efc5c1f112f54a2eddb4d0864571c2b38430e`
- Failure: actual foreground pixels occupied 33.29% of output width; the dark foreground head/torso/arm became a visual wall, while the speaker read too small and too close to a wide/full-body two-shot. This file is negative evidence only.

### Rejected same-side imbalance — left shoulder

- Path: `/Users/js/Documents/3d-scene-helper-worktrees/dialogue-ots-solver/docs/session-evidence/S14-dialogue-ots-left-rejected-same-side-imbalance.png`
- Dimensions: **1280×720**
- SHA-256: `2f4eacc508b41903bb36f1cc7f5110b5d8ef00f38f6b38412ad65ac977413f53`
- Failure: the foreground occupied the right edge while the speaker was also right of center, clustering both figures on the same side and leaving excessive empty space on the left. This is the byte-for-byte preserved former accepted-left file.

### Rejected same-side imbalance — right shoulder

- Path: `/Users/js/Documents/3d-scene-helper-worktrees/dialogue-ots-solver/docs/session-evidence/S14-dialogue-ots-right-rejected-same-side-imbalance.png`
- Dimensions: **1280×720**
- SHA-256: `129db8ee8c73973fa14e75f677f64dc6d99185dda119bafaf3ca37ee58c95440`
- Failure: the foreground occupied the left edge while the speaker was also left of center, clustering visual weight leftward. This is the byte-for-byte preserved former accepted-right file.

### Balanced dirty-single alternative — left shoulder

- Path: `/Users/js/Documents/3d-scene-helper-worktrees/dialogue-ots-solver/docs/session-evidence/S14-dialogue-ots-left-accepted.png`
- Dimensions: **1280×720**
- SHA-256: `78f43c63b56ce3c25ced4597baaf4f34d70f5407332a20b5bcea9177995aa6fa`
- Rendered foreground pixel width: **25.3947%** of output-frame width.
- Rendered subject-face center: **16.4474% left** of output-frame center.
- Visual reading: the dark foreground fragment touches the right edge without becoming a torso wall. The speaker face is unobstructed and counter-positioned left of center with positive eye line, look room, and headroom. It is a balanced medium-close dirty single, not a canonical shoulder-over and not a wide two-shot.

### Balanced dirty-single alternative — right shoulder

- Path: `/Users/js/Documents/3d-scene-helper-worktrees/dialogue-ots-solver/docs/session-evidence/S14-dialogue-ots-right-accepted.png`
- Dimensions: **1280×720**
- SHA-256: `e53795cb6f77a45e32379759a71a6909828092340196d6eab18d6ff00ad9d322`
- Rendered foreground pixel width: **26.0526%** of output-frame width.
- Rendered subject-face center: **12.6316% right** of output-frame center.
- Visual reading: the foreground fragment touches the left edge without becoming a torso wall. The speaker face is unobstructed and counter-positioned right of center with positive eye line, look room, and headroom. It is a balanced medium-close dirty single, not a canonical shoulder-over and not a wide two-shot.

The E2E test does not approve pixels from numeric diagnostics alone. It screenshots the actual WebGL canvas, hides the foreground and measures changed pixels in the projected head-to-chest corridor, verifies edge contact and 15–30% output-frame width, then hides the speaker and measures changed pixels in the projected face region. The rendered face-pixel center must lie on the opposite side of output-frame center from the foreground edge with a 10–25% center offset.

These two images are same-subject alternatives, not a coverage pair and not canonical literal OTS evidence.

### Rejected canonical calibration — torso/profile strip

- Path: `/Users/js/Documents/3d-scene-helper-worktrees/dialogue-ots-solver/docs/session-evidence/S14-canonical-shoulder-over-rejected-torso-strip.png`
- Dimensions: **1280×720**
- SHA-256: `06421e1662b6607d025d1c1c9c8373dbc378eeea02e26b29bfdfdcb4d263a1bd`
- Failure: the foreground head was mostly outside the top edge, a vertical right-edge torso/neck strip dominated, the lower shoulder did not create a useful “over” window, and the rendered subject-face bottom crossed below the ridge acceptance bound (`273` versus `< 237.0258`).

### Accepted canonical shoulder-over — actual browser OutputCamera

- Path: `/Users/js/Documents/3d-scene-helper-worktrees/dialogue-ots-solver/docs/session-evidence/S14-canonical-shoulder-over-accepted-output-camera-1280x720.png`
- Dimensions: **1280×720**
- SHA-256: `f954b1370a0ff8632062f707993eeee2d36ec4325ed03bd521bef8ff72f79266`
- Evidence: actual Chromium/WebGL browser at 1280×720. Pixel isolation proved connected upper head/neck to lower shoulder-ridge regions and separately proved the target face above/beyond the ridge.

### Accepted canonical shoulder-over — clean OutputCamera export

- Path: `/Users/js/Documents/3d-scene-helper-worktrees/dialogue-ots-solver/docs/session-evidence/S14-canonical-shoulder-over-accepted-clean-1280x720.png`
- Dimensions: **1280×720**
- SHA-256: `a5803a9ed877337509e2c1b8a80cc003d0218d731ab7b52d9c96b6a2f91a4163`
- Evidence: real application PNG download from the same solver-owned camera; no UI, composition guides, selection helpers, or evidence label is present.

## Independent reviews

Required review backend: Antigravity CLI (`agy`) with provider/model **Gemini 3.6 Flash (High)** / `gemini-3.6-flash-high` only. No substitute model is permitted.

- Exact implementation/test/evidence binary diff SHA-256: `8778fdb6d88494393765d1521bd66f7ec32d784a6c692000472bcf18f3c42172`.
- Spec-compliance review: **APPROVED** — `APPROVED: no Critical/Important spec findings.` No Critical, Important, or Minor findings.
- Quality/correctness/security review: **APPROVED** — `APPROVED: no Critical/Important quality/correctness/security findings.` No Critical or Important findings.
- Minor disposition: reviewer noted that a degenerate synthetic profile with a shoulder exactly coincident with its neck would make the normalized shoulder direction fail closed with a descriptive `RangeError`. Accepted with no code change: valid Phase 1 anatomical profiles have distinct shoulder/neck landmarks, and fail-closed behavior is preferable to emitting an undefined camera.
- Important-or-higher disposition: **none; no fix or re-review was required**.
- Review executor: Antigravity CLI (`agy`), provider/model **Google Gemini / `gemini-3.6-flash-high`** for both reviews. No substitute model was used.

### Counter-position correction reviews

The follow-up correction must be reviewed independently against its own exact implementation/test/evidence binary diff from baseline `f901a10fdc167aced887d61ee0c49d1938bf3cf8`.

- Exact follow-up implementation/test/evidence binary diff SHA-256: `166fd937fc215f398ebc88a35350467f1d2ac42c4f3c2c1804460ffd99c01156`.
- Spec-compliance review: **APPROVED** — `APPROVED: no Critical/Important spec findings.` No Critical, Important, or Minor findings.
- Quality/correctness/security review: **APPROVED** — `APPROVED: no Critical/Important quality/correctness/security findings.` No Critical, Important, or Minor findings.
- Important-or-higher disposition: **none; no fix or re-review was required**.
- Review executor: Antigravity CLI (`agy`), Google Gemini / `gemini-3.6-flash-high` for both reviews. No substitute model was used.

### Canonical shoulder-over continuation reviews

- Exact implementation/test/evidence subset binary diff SHA-256 from baseline `1b49b1f60fa917ffd2fc310ffa718d94f3ac712d`: `65e834aef5a4ff477490634b9e789df6c7176a2fcbd72212d912314dc7ff557f`.
- Spec-compliance review: **APPROVED** — `APPROVED: no Critical/Important spec findings.` No Critical, Important, or Minor findings.
- Quality/correctness/security review: **APPROVED** — `APPROVED: no Critical/Important quality/correctness/security findings.` No Critical, Important, or Minor findings.
- Important-or-higher disposition: **none; no fix or re-review was required**.
- Review executor: Antigravity CLI (`agy`), Google Gemini / `gemini-3.6-flash-high` for both reviews. No substitute model was used.

## Verification gates

### Original implementation gates

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

### Counter-position correction gates

The fresh post-review fail-fast batch passed on the unchanged implementation/test/evidence snapshot:

1. `npm run typecheck` — exit `0`.
2. `npm run lint` — exit `0`.
3. `npm test -- --run` — exit `0`; **19 files, 263/263 passed**.
4. `npm run build` — exit `0`; 687 modules; production bridge exclusion passed.
5. `npm run test:e2e:preview` — exit `0`; **69/69 Chromium/WebGL tests passed** in approximately 1.0 minute, including both corrected OTS directions and their rendered face-pixel counter-position assertions.
6. Final ordinary `npm run build` — exit `0`; 687 modules; ordinary production artifact restored and diagnostics absent.
7. Phase-owned Prettier over solver, unit test, E2E, and handoff — exit `0`; all matched files formatted.
8. `git diff --cached --check` — exit `0`.
9. Added-line security scan — **0 findings**.
10. Forbidden-scope audit — exactly **8 expected follow-up files**, **0 unexpected**, **0 missing**.
11. Ordinary production artifact diagnostic string scan — **0 forbidden strings**.
12. Reviewed implementation/test/evidence hash remained `166fd937fc215f398ebc88a35350467f1d2ac42c4f3c2c1804460ffd99c01156`.
13. Original `127.0.0.1:5173` remained PID `42743`; task-owned `4173` was clear after preview shutdown.

### Canonical shoulder-over continuation gates

The fresh post-review fail-fast batch passed on the unchanged implementation/test/evidence subset:

1. `npm run typecheck` — exit `0`.
2. `npm run lint` — exit `0`.
3. `npm test -- --run` — exit `0`; **19 files, 270/270 passed**.
4. `npm run build` — exit `0`; 687 modules; production bridge exclusion passed.
5. `npm run test:e2e:preview` — exit `0`; **70/70 Chromium/WebGL tests passed** in approximately 1.0 minute, including both balanced dirty-single alternatives, canonical connected topology, separate foreground/target pixel controls, and the exact clean PNG download.
6. Final ordinary `npm run build` — exit `0`; 687 modules; ordinary production artifact restored and diagnostics absent.
7. Phase-owned Prettier over solver, unit test, E2E, and handoff — exit `0`; all matched files formatted.
8. `git diff --cached --check` — exit `0`.
9. Added-line security scan — **0 findings**.
10. Forbidden-scope audit — exactly **7 expected continuation files**, **0 unexpected**, **0 missing**.
11. Ordinary production artifact diagnostic string scan — **0 forbidden strings**.
12. Reviewed implementation/test/evidence subset hash remained `65e834aef5a4ff477490634b9e789df6c7176a2fcbd72212d912314dc7ff557f`.
13. Original `127.0.0.1:5173` remained PID `42743`; task-owned `4173` was clear after preview shutdown.

## Explicit Phase 3/4/5 exclusions

This phase does **not** add or modify:

- any worm-eye solver, intent, test, runtime, or prompt;
- Companion schema, planner, prompt, client, or `CompanionPanel`;
- candidate preview/apply UI or state;
- shot/reverse-shot pair generation or role-swapping coverage semantics;
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
