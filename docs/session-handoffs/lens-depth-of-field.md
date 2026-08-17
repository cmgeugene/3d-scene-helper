# Lens-aware cinematic depth of field handoff

- Hermes project session: `20260817_112930_2215d3`
- 범위: lens-aware cinematic depth of field + selected-object target/focus shortcut
- worktree: `/Users/js/Documents/3d-scene-helper-worktrees/lens-depth-of-field`
- branch: `feat/lens-depth-of-field`
- 시작 HEAD: `f6339362dd1326832e3449f412c8a6ac58280cdb`
- 최종 커밋 메시지: `feat: add lens-aware depth of field`
- 최종 커밋 SHA: 이 handoff 자체가 동일 commit tree에 포함되므로 self-reference가 불가능하다. immutable SHA는 commit 직후 최종 session 완료 보고에 기록한다.
- 기준 시각: 2026-08-17 KST

## 완료 목표

직렬화된 `OutputCamera.target`을 유일한 초점 소스로 사용하는 시네마틱 심도 근사를 실제 Three.js/WebGL viewport와 exact-resolution clean/reference PNG 경로에 공유했다. 렌즈별 자동 조리개, 수동 f-stop override, legacy appearance-safe migration, `T` target/focus shortcut을 history/persistence/navigation 계약에 통합했다. 타겟 평면은 선명하게 유지되고 전·후경은 점진적으로 흐려지며, 85mm f/2가 18mm f/8보다 얕은 심도를 실제 Chromium 픽셀로 증명한다.

## 변경 파일

### 생성

- `src/editor/scene/lensDepthOfField.ts`
- `src/editor/scene/lensDepthOfField.test.ts`
- `src/editor/scene/depthOfFieldPipeline.ts`
- `src/editor/scene/depthOfFieldPipeline.test.ts`
- `src/editor/scene/CinematicDepthOfField.tsx`
- `src/editor/scene/CinematicDepthOfField.test.tsx`
- `e2e/depth-of-field.spec.ts`
- `docs/session-handoffs/lens-depth-of-field.md`

### 수정

- `src/editor/constants.ts`
- `src/editor/persistence/sceneSchema.ts`
- `src/editor/persistence/sceneSchema.test.ts`
- `src/editor/persistence/sceneCodec.ts`
- `src/editor/persistence/sceneCodec.test.ts`
- `src/editor/state/editorStore.ts`
- `src/editor/state/editorStore.test.ts`
- `src/editor/components/Inspector.tsx`
- `src/editor/components/Inspector.test.tsx`
- `src/editor/components/EditorShortcuts.tsx`
- `src/editor/components/EditorShell.test.tsx`
- `src/editor/scene/SceneViewport.tsx`
- `src/editor/scene/EditorNavigation.tsx`
- `src/editor/scene/cameraMath.ts`
- `src/editor/scene/cameraMath.test.ts`
- `src/editor/export/exportFrame.ts`
- `src/editor/export/exportFrame.test.ts`
- `scripts/assert-production-bridge-absent.mjs`
- `e2e/camera.spec.ts`
- `e2e/editor.spec.ts`
- `e2e/export.spec.ts`
- `e2e/persistence.spec.ts`
- `e2e/viewport.spec.ts`

## 제품 계약

### 직렬화된 타겟이 초점의 단일 소스

- `focusDistanceM = distance(outputCamera.position, outputCamera.target)`이다.
- transient selection 자체는 초점을 바꾸지 않는다.
- target/focus button, `T`, shot, frame-selected, orbit-end, resize 후 runtime diagnostic이 현재 직렬화 camera와 일치한다.
- Three.js camera, composer, pass, target, material은 scene document/history에 들어가지 않는다.

### 렌즈와 조리개

- 자동 preset은 `18mm f/8`, `24mm f/5.6`, `35mm f/4`, `50mm f/2.8`, `85mm f/2`다.
- Auto lens change는 focal length와 preset f-stop을 한 camera mutation/history entry로 저장한다.
- Manual lens change는 `f/1.4–f/22` 범위의 기존 f-stop을 보존한다.
- 새 장면과 starter/reset 문서는 DOF enabled다.
- scene document/storage version은 `3`이며, DOF 필드가 없는 v1/v2 import/autosave는 DOF disabled로 migration해 기존 렌더링을 보존한다.

### 선택을 target/focus로

- Camera control과 unmodified `T`는 동일한 `targetSelectedForCamera` store action을 호출한다.
- 선택 오브젝트의 world bounds center만 target으로 저장하고 position, focal length, roll, DOF/aperture를 보존한다.
- 성공 status는 `<name>을 카메라 타겟·초점으로 설정했습니다.`다.
- no-selection은 document/history no-op이며 한국어 guidance를 표시한다.
- modifier, input, textarea, select, contenteditable, modal propagation guard를 유지한다.
- Camera UI label은 `선택을 타겟·초점으로 (T)`다.

### 실제 viewport/export DOF

- live Canvas와 exact PNG가 `getDepthOfFieldRuntimeParameters` 및 `createLensDepthOfFieldPipeline`을 공유한다.
- `RenderPass → BokehPass → OutputPass`를 사용하며 CSS blur가 아니다.
- live composer는 camera/renderer/scene lifetime 동안 유지하고 camera commit은 uniform만 update한다.
- clean/reference export는 동일 optics를 사용하면서 기존 resolution, supersampling, roll, lens, exposure, layer mask, vertical flip, guide compositing을 유지한다.
- scene layer만 DOF 처리한 뒤 editor/reference overlay를 depth-clear post-DOF pass로 합성한다. live IK/transform controls와 reference motion labels는 선명하고, clean PNG에는 editor/reference helper가 없다.
- offscreen reference overlay의 authored sRGB colors는 temporary linear→sRGB material/texture encoding 후 원상복구한다.
- camera layer mask, scene background/override material, renderer clear/target/pixel ratio/viewport/scissor/colorspace/exposure를 복구한다.
- composer/pass/target/depth/material은 success, setup failure, render failure, resize, unmount에서 dispose/restore된다.

## Strict RED → GREEN ledger

1. 순수 optics module missing RED에서 focus distance, preset map, finite/degenerate validation을 구현해 최초 `3/3` GREEN을 만들었다.
2. v3 schema/default/v1-v2 migration/storage fallback, auto/manual store action, one-entry history/undo/redo/component RED를 구현 후 GREEN화했다.
3. `T`가 무동작이던 shell RED를 동일 store action, guard, Korean status로 GREEN화했다.
4. composer module missing RED를 `EffectComposer`/`BokehPass` lifecycle과 failure cleanup으로 GREEN화했다.
5. export factory missing RED를 shared offscreen pipeline, exact readback, resource/state restoration으로 GREEN화했다.
6. actual Canvas runtime diagnostic missing RED를 live pipeline에 연결하고 target/lens/resize/shot/frame/orbit-end E2E GREEN으로 만들었다.
7. three-plane pixel RED에서 calibrated aperture를 `50mm f/2.8 aperture 0.002` 기준으로 조정했다. target retention이 near/far보다 높고 85mm off-target retention이 18mm보다 낮다.
8. export target colorspace RED를 linear composer target과 deterministic readback으로 수정했다.
9. Gemini quality review가 camera commit마다 composer를 재할당하는 Important finding을 보고했다. `CinematicDepthOfField.test.tsx`에서 `2 allocations` RED를 재현하고 dedicated `update(parameters)` effect로 `1 allocation` GREEN 및 unmount disposal을 확인했다.
10. full preview에서 DOF가 IK controls와 reference motion guides를 blur/tone-map하는 실제 회귀 RED를 발견했다. scene-only Bokeh 뒤 crisp overlay 합성, background/layer restoration, authored sRGB restoration으로 depth, motion-guide, ordinary-production pointer tests를 GREEN화했다.
11. 5-worker WebGL full run의 GPU contention으로 performance/interaction false failures가 발생했다. skill contract에 따라 wall-clock/GPU suite를 serial preview로 재실행해 `74/74` GREEN 및 1080p export `2047ms`를 확인했다.

## 실제 Chromium/WebGL 및 픽셀 증거

Final serial preview E2E: **74/74 passed (4.9m)**.

DOF fixture는 동일한 x/y geometry와 focal-distance scaling으로 18/85mm의 framing을 일치시켰다. DOF-disabled 18/85 comparison mismatch는 `0`이다.

- 50mm sharpness retention: near `0.0425770094`, target `0.1468932793`, far `0.0637411484`.
- live viewport enabled/disabled changed-pixel ratio: `0.0138547588`.
- off-target retention: 18mm `1.0380791310`, 85mm `0.0718951239`.
- 85mm가 18mm보다 명확히 얕고, 50mm target이 near/far보다 선명하다.
- clean/reference PNG는 `1280×720` exact dimensions이며 reference guide delta가 non-zero다.
- motion-guide authored cyan/orange pixels, IK pointer handles, Cube/Plane surface grids, selected/deselected helper exclusion이 전체 E2E에서 통과했다.

주요 artifact 경로:

- `test-results/depth-of-field-actual-view-87f21--DOF-with-negative-controls-chromium/viewport-50mm-dof.png`
- `test-results/depth-of-field-actual-view-87f21--DOF-with-negative-controls-chromium/viewport-50mm-disabled.png`
- `test-results/depth-of-field-actual-view-87f21--DOF-with-negative-controls-chromium/clean-50mm-dof.png`
- `test-results/depth-of-field-actual-view-87f21--DOF-with-negative-controls-chromium/clean-50mm-disabled.png`
- `test-results/depth-of-field-actual-view-87f21--DOF-with-negative-controls-chromium/reference-50mm-dof.png`
- `test-results/depth-of-field-actual-view-87f21--DOF-with-negative-controls-chromium/clean-18mm-auto-dof.png`
- `test-results/depth-of-field-actual-view-87f21--DOF-with-negative-controls-chromium/clean-85mm-auto-dof.png`
- `test-results/depth-of-field-actual-view-87f21--DOF-with-negative-controls-chromium/clean-85mm-disabled.png`

## 독립 Gemini 3.6 Flash High 리뷰

- 최초 immutable review bundle SHA-256: `dca7d11a798f03b1e41f3c3bb7534e3f2480d3a0c2264c2d405e5e2d965e72bc`.
- 최초 spec compliance: `APPROVED: no Important/Critical spec findings`.
- 최초 quality/security: camera commit 시 composer 재할당 Important 1건. 위 RED → GREEN ledger 9로 수정했다.
- final closure spec/quality reviews는 이 handoff를 포함한 immutable candidate bundle을 대상으로 실행한다. handoff의 자기변경으로 reviewer snapshot을 무효화하지 않기 위해 최종 immutable verdict와 bundle hash는 parent session 완료 보고에 기록한다.

## Verification ledger

- Focused optics baseline: `3/3 passed`.
- Focused lifecycle/export/runtime units: `27/27 passed`.
- Full unit: `npm test -- --run`, exit `0`; **19 files, 234/234 passed**.
- Typecheck: `npm run typecheck`, exit `0`.
- Lint: `npm run lint`, exit `0`.
- Format: `npm run format:check`, exit `0`.
- Focused camera/DOF/export modal Chromium: **5/5 passed**.
- Focused post-review DOF Chromium: **2/2 passed**.
- Final serial instrumented preview: build `700 modules`; **74/74 passed (4.9m)**.
- Serial performance: 50 primitives / 52 scene objects, orbit `895ms`, 1080p export `2047ms` (`≤3000ms`, PASS).
- Final ordinary production build: Vite `8.1.5`, `700 modules`, exit `0`; production diagnostics exclusion PASS.
- Preview port `127.0.0.1:4173`: final preview 종료 후 available.

## 범위와 안전

- 정확한 외부 worktree만 수정했다.
- primary `/Users/js/Documents/3d-scene-helper`와 sibling worktree를 읽거나 수정하거나 stash/commit/process-stop하지 않았다.
- commit은 아직 만들지 않았으며 시작 HEAD 이후 commit count는 `0`이다.
- credentials, tokens, API keys, secrets는 저장하지 않았다.
- Bokeh/EffectComposer는 Three.js bundled dependency만 사용하며 새 package/lockfile 변경은 없다.
- final commit 직전 expected task-owned manifest, diff check, branch/HEAD, clean port를 다시 검증한다.
