# Session S13 Handoff — Cinematic subject projection foundation

- Hermes session ID: `20260810_082805_f39379`
- Phase: S13 Phase 1 only
- Worktree: `/Users/js/Documents/3d-scene-helper-worktrees/cinematic-subject-projection`
- Branch: `feat/cinematic-subject-projection`
- Starting HEAD: `4531f56279a9cd7b680267df04cb538bc6067ed1` (`docs: plan companion cinematic shot solvers`)
- 기준 시각: `2026-08-10 08:56:09 KST`
- Proposed/final commit message: `feat: add cinematic subject projection foundation`
- Final commit SHA: 이 handoff 자체가 동일 commit tree에 포함되므로 self-reference가 불가능하다. immutable final SHA는 commit 직후 session 완료 보고에 기록한다.

## Phase 1 결과

절차형 마네킹의 pose-aware local cinematic landmarks를 기존 FK 및 실제 JSX hierarchy와 같은 순서로 계산한다. 이를 document dimensions, root scale, XYZ rotation, translation 순서로 world-space `CinematicSubjectProfile`로 변환하며, 방향 basis에는 non-uniform scale을 적용하지 않는다. 실제 Three `PerspectiveCamera`와 output aspect/focal semantics를 재구성해 output-frame NDC, front/frame/action-safe 상태, clipped landmarks, visible envelope, occupancy, headroom을 계산한다. E2E build에서 실제 named mannequin nodes를 post-render frame에 읽어 pure profile과 수치 비교하는 Chromium/WebGL tracer bullet을 추가했다.

`SceneDocument` 및 Zustand에는 profile, Three object, camera, candidate, preview 상태를 추가하지 않았다.

## 변경 파일

1. `src/editor/mannequin/mannequinRig.ts`
2. `src/editor/mannequin/mannequinRig.test.ts`
3. `src/editor/cinematography/cinematicSubjectProfile.ts`
4. `src/editor/cinematography/cinematicSubjectProfile.test.ts`
5. `src/editor/cinematography/projectionMetrics.ts`
6. `src/editor/cinematography/projectionMetrics.test.ts`
7. `src/editor/scene/ArticulatedMannequin.tsx`
8. `e2e/mannequin.spec.ts`
9. `scripts/assert-production-bridge-absent.mjs`
10. `docs/session-handoffs/S13-cinematic-subject-projection.md`

생성된 `dist/`, `playwright-report/`, `test-results/`는 commit 대상이 아니다.

## RED → GREEN 증거

### Task 1.1 baseline

- `npm test -- --run src/editor/mannequin/mannequinRig.test.ts src/editor/scene/cameraMath.test.ts`
  - exit `0`; 2 files, **67/67 passed** (rig 47, camera 20).
- `npm run typecheck`
  - exit `0`.

### Task 1.2 — local cinematic landmarks

- RED: `npm test -- --run src/editor/mannequin/mannequinRig.test.ts`
  - exit `1`; **7 failed, 47 passed, 54 total**.
  - expected cause: `TypeError: computeMannequinCinematicLandmarks is not a function`.
- GREEN: same command
  - exit `0`; **54/54 passed**.
- 계약: finite/plain JSON, no pose mutation, head yaw, walk-ready limbs, local `-Z` face direction, standard/athletic/heavy head proportions.

### Task 1.3 — world-space CinematicSubjectProfile

- RED: `npm test -- --run src/editor/cinematography/cinematicSubjectProfile.test.ts`
  - exit `1`; suite import failure because `./cinematicSubjectProfile` did not exist.
- GREEN: `npm test -- --run src/editor/cinematography/cinematicSubjectProfile.test.ts src/editor/mannequin/mannequinRig.test.ts`
  - exit `0`; 2 files, **62/62 passed**.
- 계약: non-mannequin `null`, dimensions/reference dimensions → root scale → XYZ rotation → translation, shared world bounds, normalized scale-independent basis, silhouette outline, source immutability.

### Task 1.4 — real output-camera projection metrics

- RED: `npm test -- --run src/editor/cinematography/projectionMetrics.test.ts`
  - exit `1`; suite import failure because `./projectionMetrics` did not exist.
- GREEN: `npm test -- --run src/editor/cinematography/projectionMetrics.test.ts src/editor/cinematography/cinematicSubjectProfile.test.ts src/editor/scene/cameraMath.test.ts`
  - exit `0`; 3 files, **36/36 passed**.
- 계약: real `PerspectiveCamera`, runtime near/far `0.1/100`, position → lookAt → roll → output projection → matrix update, in-front/depth/frame/action-safe, clipped names, behind-point envelope exclusion, occupancy/headroom, range errors.

### Task 1.5 — Chromium/WebGL runtime parity

- Initial RED: focused Chromium command returned **1 failed** because `data-mannequin-cinematic-landmarks` was absent.
- Runtime diagnostic implementation then exposed a real ordering RED: shoulders/head matched but `leftFoot.x` differed because layout-time snapshot still contained neutral ankle matrices.
- Fix: publish copied named-node world positions in the post-render `useFrame` E2E branch and poll the matching `data-mannequin-pose=walk-ready` snapshot.
- Production-build RED: moving diagnostics into a frame callback initially retained test markers in the production bundle; `npm run build` correctly failed the marker scan.
- Fix: keep both frame publisher and cleanup references behind the compile-time `IS_EDITOR_TEST_BRIDGE_ENABLED` true branch; production DCE removes all diagnostics.
- Final GREEN: `npx playwright test e2e/mannequin.spec.ts --project=chromium --workers=1 -g "cinematic subject profile matches" --reporter=list`
  - exit `0`; **1/1 passed**.
- Ordinary `npm run build`
  - exit `0`; `Production build excludes E2E-only editor diagnostics.`

## Runtime/WebGL evidence

- Screenshot: `/Users/js/Documents/3d-scene-helper-worktrees/cinematic-subject-projection/test-results/mannequin-cinematic-subjec-d758a-ated-WebGL-mannequin-pivots-chromium/cinematic-subject-runtime-parity.png`
- Playwright attachment copy: `/Users/js/Documents/3d-scene-helper-worktrees/cinematic-subject-projection/test-results/mannequin-cinematic-subjec-d758a-ated-WebGL-mannequin-pivots-chromium/attachments/cinematic-subject-runtime-parity-6a4bb3660e0cbe502feaabeebff9320daf061991.png`
- Actual assertion: selected mannequin, root rotation `{13, 37, -9}`, non-uniform root scale `{1.2, 0.9, 1.4}`, walk-ready pose; runtime `faceCenter`, both shoulders, both ankle/foot pivots agree with pure world profile to 6 decimal places.
- Visual inspection: real rendered WebGL mannequin and selection/gizmo are visible; frame is not blank or fallback; no mannequin clipping/render failure was observed.

## Independent reviews

Required reviewer/model: Antigravity CLI `agy` with **`gemini-3.6-flash-high` only**.

- Exact staged code snapshot SHA-256: `fc2cae88072e184e52ad3717b30ccf41161debf40be22e324346c9a7f1a4d0cd`.
- First headless spec-review attempt produced no verdict because command permission could not be prompted. No substitute model was used.
- The exact complete diff was then embedded into a neutral `/tmp` prompt; embedded textual payload SHA-256: `78d63c8757b78102dc82af49cde012a42ebd77f06073fdc5fae01a513c854c24`.
- Spec-compliance review: **APPROVED — Critical 0, Important 0, Minor 0**.
- Code-quality/correctness/security review on the unchanged hash: **APPROVED — Critical 0, Important 0, Minor 0**.
- No Important-or-higher finding required a fix/re-review loop.

## Fresh final gates

Main fail-fast batch against the reviewed code snapshot:

1. `npm run typecheck` — exit `0`.
2. `npm run lint` — exit `0`.
3. `npm test -- --run` — exit `0`; **18 files, 244/244 passed**.
4. `npm run build` — exit `0`; 687 modules; production diagnostics absent.
5. `npm run test:e2e:preview` — exit `0`; **67/67 Chromium/WebGL tests passed** in 58.5s; included the new runtime parity tracer.
6. final ordinary `npm run build` — exit `0`; 687 modules; production diagnostics absent and ordinary artifact restored.
7. `git diff --cached --check` and `git diff --check` — exit `0`.

Non-blocking output observed: Vite chunk-size advisory and Node test localStorage path warning; no test failure.

### Format baseline note

- All nine Phase-1-owned code/test/script files pass focused Prettier.
- Exact repository command `npm run format:check` was run fresh and exited `1` only for inherited committed `src/app/App.test.tsx`.
- The same warning was reproduced directly from starting `HEAD` with `git show HEAD:src/app/App.test.tsx | npx prettier --list-different --stdin-filepath src/app/App.test.tsx`, which reported `(stdin)` before this Phase 1 code existed.
- That unrelated baseline file was deliberately not modified or included in the Phase 1 commit. This handoff is formatted and checked separately before commit.

## Scope audit / explicit exclusions

No changes exist under:

- `src/editor/companion/**`
- `src/editor/components/CompanionPanel.tsx`
- `src/editor/state/editorStore.ts`
- `src/editor/persistence/sceneSchema.ts` or scene version/constants
- OTS solver modules
- worm-eye solver modules
- candidate preview UI/state

Phase 1 deliberately does **not** implement OTS generation/scoring, static worm-eye generation/scoring, companion schema/UI, candidate previews, or any `SceneDocument` mutation/version change. This session stops after Phase 1.

## Worktree/listener protection and integration note

- The preserved dirty prototype worktree `/Users/js/Documents/3d-scene-helper` was not read, modified, stashed, reset, copied, or committed.
- Existing `127.0.0.1:5173` listener (PID `42743`) remained alive and was neither reused nor stopped.
- Phase-owned preview port `4173` was clear after every focused/full Playwright run.
- Later integration should merge/cherry-pick the final Phase 1 commit into `feat/companion-cinematic-shot-solvers`, then begin Phase 2 in a fresh project session. Do not copy files from the preserved dirty prototype lane.
