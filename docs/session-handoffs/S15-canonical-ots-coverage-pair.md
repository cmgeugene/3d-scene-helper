# S15 — Canonical OTS role-swapped coverage pair

Date: 2026-08-10

## Scope and baseline

- Worktree: `/Users/js/Documents/3d-scene-helper-worktrees/dialogue-ots-solver`
- Branch: `feat/dialogue-ots-solver`
- Clean starting baseline: `43a5c050c20f52907c244313e3f089e3a35557b2` (`feat: add canonical shoulder-over dialogue composition`)
- This was a fresh S15 continuation after S14. S14 was inspected but not resumed or modified.
- The dirty prototype at `/Users/js/Documents/3d-scene-helper` was not reset, stashed, copied into, or otherwise modified.

## Delivered contract

`solveDialogueOtsCoveragePair` is a pure, transient cinematography API built around the existing `solveDialogueOts` canonical single-shot solver.

- Identity A and Identity B are explicit and must be distinct.
- Shot A is visible subject A over foreground B.
- Reverse B is visible subject B over foreground A.
- Both legs are `canonical-shoulder-over`; balanced dirty-single alternatives are unchanged and are never called a coverage pair.
- One stable canonical conversation axis is defined from A to B independently of role order.
- Both selected cameras are evaluated against that one A-to-B axis and must occupy the same selected, nonzero physical half-plane.
- Anatomical near shoulder and foreground edge reverse between legs.
- Target screen direction, look room, and target face side correspond across the pair.
- Lens, shot size, headroom, target-face occupancy, eyeline, foreground scale, and look-room continuity use explicit pair-local tolerances.
- Pair ranking is deterministic with candidate-ID lexical tie-breaks.
- Results and failures are JSON-safe and byte-deterministic.
- Inputs, profiles, SceneDocument, editor history, dirty state, UI state, and runtime Three objects are not mutated.

The exported `validateDialogueOtsCoveragePair` revalidates role swap, stable-axis half-plane, canonical topology, continuity, face block, and torso-wall diagnostics without mutating the result.

## Failure diagnostics

The JSON-safe ordered failure set covers:

- `same-identity`
- `identity-profile-mismatch`
- `missing-shot-a-canonical-leg`
- `missing-reverse-b-canonical-leg`
- `same-role-pseudo-pair`
- `axis-crossing`
- `mismatched-lens`
- `mismatched-shot-size`
- `mismatched-headroom`
- `mismatched-face-occupancy`
- `mismatched-eyeline`
- `mismatched-foreground-scale`
- `mismatched-look-room`
- `same-screen-direction`
- `face-blocked`
- `foreground-torso-wall`

Supported input lenses are exactly 50, 65, and 85 mm. The literal canonical topology contract intentionally fails closed: the standard 50 mm fixture is accepted, while current weak 65/85 mm and athletic/heavy fixture combinations return explicit missing-canonical-leg diagnostics instead of being mislabeled canonical.

## TDD chronology

### Focused role-swap / stable-axis RED

The first focused test file was written before the pair module existed.

Command:

```text
npm test -- --run src/editor/cinematography/dialogueOtsCoveragePair.test.ts
```

Observed RED, exit `1`:

```text
FAIL src/editor/cinematography/dialogueOtsCoveragePair.test.ts
Error: Failed to resolve import "./dialogueOtsCoveragePair"
Does the file exist?
Test Files 1 failed (1)
Tests no tests
```

This RED covered the two authoritative behaviors first:

1. real identity-role swap rather than a same-role pseudo-pair;
2. both camera positions on the same nonzero half-plane of one stable A-to-B canonical axis.

### Minimal GREEN

After the first minimal pair module was added:

```text
npm test -- --run src/editor/cinematography/dialogueOtsCoveragePair.test.ts
```

passed with **2/2 tests**.

### Contract regressions

The focused suite then grew to cover deterministic JSON, non-mutation, accepted standard topology, explicit weak-profile/lens rejection, same identity, fabricated same-role pair, fabricated axis crossing, and every pair-local mismatch/occlusion/torso-wall diagnostic.

Final focused result:

- **1 file, 21/21 passed**.

## Visual correction chronology

### Rejected intermediate pair

The first role-swapped pixels had correct identities and same-half-plane semantics but were rejected by the user and parent inspection. Both read as dirty edge singles: a large cropped edge head with only a weak neck/shoulder sliver, rather than a literal shoulder-over window.

Those frames were removed from accepted names and retained only as honestly named `rejected-dirty-edge` evidence. They are not acceptance evidence.

### Final user visual acceptance

After the corrected solver-generated pair was shown, the user explicitly approved it as canonical OTS: `맞아. 이건 확실히 ots다.` (Discord message `1536270120651857962`). This approval applies to the corrected Shot A / Reverse B evidence below. It does not imply that Companion natural-language integration, preview, or atomic apply is complete.

The temporary accommodations were explicitly reversed:

- connectivity neighborhood restored from 4 pixels to **2 pixels**;
- the weak 0.10 lower-width floor was removed;
- the final pixel floor was strengthened beyond the prior 0.18 baseline to **0.28**;
- a new lower-minus-upper width delta of **0.08** proves that the lower shoulder sweeps farther inward than the head/neck edge mass;
- upper head/neck width is capped at **0.30**;
- lower and bottom foreground widths remain capped at **0.48** to reject torso walls.

### Root cause

The existing canonical single-shot solver contained stronger candidates, but pair ranking emphasized continuity and inherited single-shot scores. It could therefore choose two similarly weak legs because their weak foreground metrics matched.

Candidate-space probes showed that projected total shoulder width alone was insufficient. A candidate could report width while its neck was offscreen and its anatomical shoulder ridge sat too low to produce a literal connected window.

### Production correction

S15 adds pair-local `foregroundTopology` diagnostics and ranking features without changing Phase 1 metrics or the S14 single-shot solver:

- expected edge;
- neck edge coordinate, required within `[0.82, 0.98]`;
- shoulder inward reach, required `>= 0.28`;
- shoulder ridge NDC Y, required `>= -1.2`;
- shoulder/head ratio, required `>= 1.35`;
- foreground head width `[0.10, 0.24]`;
- foreground shoulder width `>= 0.245`;
- foreground total width `<= 0.36`;
- deterministic topology quality used in pair ranking.

The selected standard 50 mm pair is:

```text
canonical-shoulder-over-left-shoulder-medium-close-19__canonical-shoulder-over-right-shoulder-medium-close-73
```

## Accepted pair semantics and metrics

### Shot A

- visible subject: `coverage-character-a` (coral)
- foreground: `coverage-character-b` (teal)
- foreground edge: right
- canonical half-plane sign: `-1`
- canonical signed value: `-0.362118431`
- neck edge coordinate: `0.903265493`
- shoulder inward reach: `0.350050750`
- shoulder ridge NDC Y: `-1.098950668`
- shoulder/head ratio: `1.532593117`
- topology quality: `0.667571723`
- face center offset: `-0.128947368`
- face above ridge: `249.400705 px`
- foreground pixels: `89,403`
- upper head/neck width: `0.271052632`
- lower shoulder width: `0.373684211`
- lower-minus-upper sweep: `0.102631579`
- bottom width: `0.469736842`

Strict pixel verdict: **accepted literal/canonical OTS**. The teal rear/rear-three-quarter head connects through a visible neck into a substantial shoulder ridge entering from the right/lower frame and sweeping inward. Coral A is counter-positioned left with the full face clearly above/beyond the ridge. The foreground is neither a disconnected dirty edge nor a torso wall.

### Reverse B

- visible subject: `coverage-character-b` (teal)
- foreground: `coverage-character-a` (coral)
- foreground edge: left
- canonical half-plane sign: `-1`
- canonical signed value: `-0.528660705`
- neck edge coordinate: `0.912562818`
- shoulder inward reach: `0.330404220`
- shoulder ridge NDC Y: `-0.776954489`
- shoulder/head ratio: `1.450456197`
- topology quality: `0.718323471`
- face center offset: `+0.109868421`
- face above ridge: `182.574022 px`
- foreground pixels: `83,422`
- upper head/neck width: `0.226315789`
- lower shoulder width: `0.413157895`
- lower-minus-upper sweep: `0.186842105`
- bottom width: `0.431578947`

Strict pixel verdict: **accepted literal/canonical OTS**. Coral A enters from the left as a connected rear head-neck-shoulder mass with a broad inward ridge. Teal B is counter-positioned right with the face above/beyond the ridge. This is the true role-swapped reverse while remaining on the same physical conversation-axis side.

## Chromium/WebGL evidence

All evidence below is actual solver-selected application output. The manual references were visual targets only and were never copied into evidence or called solver output.

### Accepted Shot A

- `docs/session-evidence/S15-canonical-ots-coverage-shot-a-subject-A-foreground-B-output-camera-1280x720.png`
  - 1280×720
  - SHA-256 `a8917d26cf14d959cef8c38dc42e9c5fbaf8cb493f3e9c33c2816c187551a0a8`
- `docs/session-evidence/S15-canonical-ots-coverage-shot-a-subject-A-foreground-B-clean-1280x720.png`
  - 1280×720
  - SHA-256 `45256ab62217ff770fd789a5662c7314dc4fd6447d715c99445b6fbcab82acbd`

### Accepted Reverse B

- `docs/session-evidence/S15-canonical-ots-coverage-reverse-b-subject-B-foreground-A-output-camera-1280x720.png`
  - 1280×720
  - SHA-256 `c864d3b56d0b9bc1c8a551fd7eb4868e3634fb376aa4cdf61010100a3099c943`
- `docs/session-evidence/S15-canonical-ots-coverage-reverse-b-subject-B-foreground-A-clean-1280x720.png`
  - 1280×720
  - SHA-256 `7c1af76207c03fec227d11f0d327a191211fbf454d318ffba8d434a87d3e4e43`

### Rejected dirty-edge Shot A

- `docs/session-evidence/S15-canonical-ots-coverage-shot-a-subject-A-foreground-B-rejected-dirty-edge-output-camera-1280x720.png`
  - 1280×720
  - SHA-256 `f7f2b9798c8ce61ee14e9b9a4d39479711c66a353e4b75ec44abb93ceba57241`
- `docs/session-evidence/S15-canonical-ots-coverage-shot-a-subject-A-foreground-B-rejected-dirty-edge-clean-1280x720.png`
  - 1280×720
  - SHA-256 `a0302fe5098b3d5afd5a3a3da24b7a837adc5445b58da88cdb159b6d543a4b2e`

### Rejected dirty-edge Reverse B

- `docs/session-evidence/S15-canonical-ots-coverage-reverse-b-subject-B-foreground-A-rejected-dirty-edge-output-camera-1280x720.png`
  - 1280×720
  - SHA-256 `1491ebe40cf4c0b8b2036643d2ab018a5f9d8985901bc1df651804631fdda103`
- `docs/session-evidence/S15-canonical-ots-coverage-reverse-b-subject-B-foreground-A-rejected-dirty-edge-clean-1280x720.png`
  - 1280×720
  - SHA-256 `1b3371e679476eb6298a5e746aca6218f31f56d18c75cae05763150747669275`

## Permanent E2E controls

The permanent test renders both production-solver legs through the actual Chromium/WebGL output camera at 1280×720 and uses visibly distinct coral/teal object identities.

It proves per leg:

- foreground and target object IDs match the required role assignment;
- correct edge contact;
- color identity changes when the foreground or subject object is hidden;
- upper head/neck mass is present but bounded;
- lower shoulder width is at least 28% of frame width;
- lower shoulder extends at least 8% farther inward than the upper head/neck;
- lower/bottom width caps prevent a torso wall;
- a 2-pixel-neighborhood connected path joins the upper head/neck to the lower shoulder band;
- target face pixels remain above and beyond the projected ridge;
- target faces occupy opposite screen sides;
- output-camera screenshots and clean 1280×720 PNG downloads both exist.

Focused final E2E: **1/1 passed**.

## Independent reviews

Required backend/model for both reviews: Antigravity CLI (`agy`), Google Gemini / `gemini-3.6-flash-high`. No substitute model was used.

Final exact implementation/test/evidence bundle SHA-256:

```text
ce244041bb2076170edb3e84089e7f8af8b8698f7adc2b053e5c9c0545aebfb4
```

The bundle hashes exact bytes for the two S15 TypeScript files, the modified E2E file, and all eight S15 evidence PNGs.

### Spec-compliance re-review

- Model: `gemini-3.6-flash-high`
- Bundle hash: `ce244041bb2076170edb3e84089e7f8af8b8698f7adc2b053e5c9c0545aebfb4`
- Blocker: none
- Important: none
- Minor: none
- Pixel tests not weakened: PASS
- Shot A pixel verdict: PASS / canonical OTS
- Reverse B pixel verdict: PASS / canonical OTS
- Final verdict: **PASS**

### Quality/correctness/security re-review

- Model: `gemini-3.6-flash-high`
- Bundle hash: `ce244041bb2076170edb3e84089e7f8af8b8698f7adc2b053e5c9c0545aebfb4`
- Blocker: none
- Important: none
- Minor: none
- Pixel tests not weakened: PASS
- Security/scope: PASS
- Shot A pixel verdict: PASS / canonical OTS
- Reverse B pixel verdict: PASS / canonical OTS
- Final verdict: **PASS**

An earlier quality review had one Minor asking for public API documentation. TSDoc was added to `solveDialogueOtsCoveragePair` and `validateDialogueOtsCoveragePair`; both final reviews were rerun against the new exact hash above and returned zero findings.

## Verification gates

Post-review final gates on the unchanged implementation/test/evidence bundle:

1. `npm run typecheck` — exit `0`.
2. `npm run lint` — exit `0`.
3. `npm test -- --run` — exit `0`; **20 files, 291/291 tests passed**.
4. `npm run build` — exit `0`; **687 modules**; production diagnostics exclusion passed.
5. First `npm run test:e2e:preview` — S15 passed, but one unrelated camera-resize poll flaked; **70/71 passed**.
6. Focused rerun of the unrelated camera-resize test — **1/1 passed**.
7. Final `npm run test:e2e:preview` — exit `0`; **71/71 Chromium/WebGL tests passed**, including all four dialogue OTS tests and the two-leg S15 pixel evidence.
8. Final ordinary `npm run build` — exit `0`; **687 modules**; ordinary production artifact restored and E2E-only diagnostics absent.
9. Phase-owned Prettier over the two S15 TypeScript files, E2E, and this handoff — exit `0`; all matched files use Prettier style.
10. `git diff --check` — exit `0`.
11. Added-line security scan — **1,644 added lines scanned; 0 findings** for credential assignments, private-key blocks, dynamic evaluation, or child-process execution.
12. Forbidden-scope audit — exactly **12 expected S15 files**, **0 unexpected**, **0 missing**.
13. Ordinary production artifact scan — exit `0`; E2E-only editor diagnostics absent.
14. Final reviewed implementation/test/evidence bundle hash remained `ce244041bb2076170edb3e84089e7f8af8b8698f7adc2b053e5c9c0545aebfb4`.
15. Listener check — task-owned `4173` clear; original `127.0.0.1:5173` still PID `42743`.

## Explicit exclusions and forbidden-scope audit

S15 does not add or modify:

- Companion schema, planner, prompt, client, or panel integration;
- preview/apply UI;
- editorStore, undo/redo history, dirty-state, transaction, or persistence behavior;
- SceneDocument or schema/version constants;
- Phase 1 measurement-only semantics;
- any universal projection pass/fail policy;
- runtime Three object persistence;
- Phase 3 worm-eye work;
- the dirty prototype at `/Users/js/Documents/3d-scene-helper`.

`projectionMetrics.ts` is imported read-only by the pair solver. It remains unchanged and measurement-only. All literal OTS topology acceptance rules live in the pair layer.

## Files

- `src/editor/cinematography/dialogueOtsCoveragePair.ts`
- `src/editor/cinematography/dialogueOtsCoveragePair.test.ts`
- `e2e/dialogueOts.spec.ts`
- `docs/session-evidence/S15-canonical-ots-coverage-shot-a-subject-A-foreground-B-output-camera-1280x720.png`
- `docs/session-evidence/S15-canonical-ots-coverage-shot-a-subject-A-foreground-B-clean-1280x720.png`
- `docs/session-evidence/S15-canonical-ots-coverage-reverse-b-subject-B-foreground-A-output-camera-1280x720.png`
- `docs/session-evidence/S15-canonical-ots-coverage-reverse-b-subject-B-foreground-A-clean-1280x720.png`
- `docs/session-evidence/S15-canonical-ots-coverage-shot-a-subject-A-foreground-B-rejected-dirty-edge-output-camera-1280x720.png`
- `docs/session-evidence/S15-canonical-ots-coverage-shot-a-subject-A-foreground-B-rejected-dirty-edge-clean-1280x720.png`
- `docs/session-evidence/S15-canonical-ots-coverage-reverse-b-subject-B-foreground-A-rejected-dirty-edge-output-camera-1280x720.png`
- `docs/session-evidence/S15-canonical-ots-coverage-reverse-b-subject-B-foreground-A-rejected-dirty-edge-clean-1280x720.png`
- `docs/session-handoffs/S15-canonical-ots-coverage-pair.md`

## Commit and listener contract

- Exact commit message: `feat: add role-swapped canonical ots coverage pair`
- The exact SHA is verified and reported in the final closeout rather than embedded here, avoiding a self-referential commit hash.
- Task-owned port `4173` is clear after preview shutdown.
- Original `127.0.0.1:5173` listener remains PID `42743` and was not stopped, reused, or modified.
