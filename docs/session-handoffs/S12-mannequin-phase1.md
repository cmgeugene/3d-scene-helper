# Session S12 Handoff — Poseable articulated mannequin phase 1

- Hermes project session: `20260731_144317_cb8a53`
- 범위: S12 마네킹 1차
- 브랜치: `feat/mannequin-phase1`
- 시작 HEAD: `8706a429c2d931f9210ac2763dfe7664b683e1e9`
- 최종 커밋 메시지: `feat: add poseable articulated mannequin`
- 최종 커밋 SHA: 이 handoff 자체가 동일 commit tree에 포함되므로 self-reference가 불가능하다. immutable SHA는 commit 직후 최종 session 완료 보고에 기록한다.
- 기준 시각: 2026-07-31 KST

## 완료 목표

외부 GLB나 skeleton/skinning 없이 기존 독립 primitive 마네킹을 절차형 관절 계층으로 교체했다. 마네킹 local `-Z`를 전방으로 통일하고, JSON-safe pose와 양손 2-bone IK를 scene document v2에 통합했다. 카메라 shot/lens와 분리된 6개 방향 view, 4개 pose preset, pose-aware bounds, runtime-only IK preview와 정확히 한 번의 history commit을 제공한다. 얼굴판·코·가슴·후면·발끝 단서는 scene layer 0의 영구 geometry이며 clean/reference PNG에서 실제 픽셀로 앞뒤를 구분한다. IK target은 editor layer 1로 제한되어 모든 PNG에서 제외된다.

## 변경 파일

### 생성

- `.hermes/plans/S12-mannequin-phase1.md`
- `src/editor/mannequin/mannequinRig.ts`
- `src/editor/mannequin/mannequinRig.test.ts`
- `src/editor/scene/ArticulatedMannequin.tsx`
- `src/editor/scene/MannequinIKControls.tsx`
- `e2e/mannequin.spec.ts`
- `e2e/production-mannequin.spec.ts`
- `docs/session-handoffs/S12-mannequin-phase1.md`

### 삭제

- `src/editor/scene/Mannequin.tsx` — 독립 absolute primitive 구현

### 수정

- `src/editor/constants.ts`
- `src/editor/persistence/sceneSchema.ts`
- `src/editor/persistence/sceneSchema.test.ts`
- `src/editor/persistence/sceneCodec.ts`
- `src/editor/persistence/sceneCodec.test.ts`
- `src/editor/presets/cameras.ts`
- `src/editor/scene/cameraMath.ts`
- `src/editor/scene/cameraMath.test.ts`
- `src/editor/scene/sceneObjectModel.ts`
- `src/editor/scene/sceneObjectModel.test.ts`
- `src/editor/scene/SceneObject.tsx`
- `src/editor/scene/SceneViewport.tsx`
- `src/editor/scene/SelectionTransformControls.tsx`
- `src/editor/scene/EditorNavigation.tsx`
- `src/editor/scene/OutputCamera.tsx`
- `src/editor/state/editorStore.ts`
- `src/editor/state/editorStore.test.ts`
- `src/editor/components/Inspector.tsx`
- `src/editor/components/Inspector.test.tsx`
- `scripts/assert-production-bridge-absent.mjs`
- `e2e/editor.spec.ts`
- `e2e/export.spec.ts`
- `e2e/manipulation.spec.ts`
- `e2e/motion-guides.spec.ts`
- `e2e/persistence.spec.ts`

## 구현 계약

### 절차형 rig와 전방 규칙

- root → pelvis/torso/head, shoulder → upper arm → forearm → hand, hip → thigh → shin → foot 계층이다.
- 마네킹 local `-Z`가 정면이다.
- standing, A, T, walk-ready pose와 custom pose가 동일 JSON-safe schema를 사용한다.
- arm chain, 2-bone IK, joint rotations, anatomical dimensions와 posed local bounds를 `mannequinRig.ts`에서 공유한다.
- IK target은 reach clamp와 pole fallback을 사용하고 result에 Three.js runtime 객체를 포함하지 않는다.

### 영구적인 앞뒤 형상 단서

- 얼굴판, 코, 전면 가슴 표식, 후면 표식, 발끝 단서는 layer 0 geometry다.
- 안정적인 PNG 판독이 필요한 cue는 unlit material을 사용한다.
- layer 0 cue는 clean/reference export 모두에 남고, layer 1 IK sphere는 둘 다 제외된다.

### Scene document v2와 migration

- scene document version은 `2`다.
- v2 localStorage key를 우선 사용하고 legacy v1 key를 fallback으로 읽는다.
- v1 mannequin에는 default standing pose를 주입한다.
- migrated v1 camera composition은 보존하고, 새 v2 starter camera는 `{ x: 0, y: 1.6, z: -5 }`를 사용한다.
- save/load, JSON import/export, duplicate, undo/redo는 pose를 JSON data로 보존한다.

### 방향 view, pose와 bounds

- 방향 view는 정면, 후면, 좌측, 우측, 3/4 정면, 3/4 후면이며 기존 shot/lens와 별도 Inspector group이다.
- 방향 view는 selected subject의 root-local 축을 따르며 active target, distance, focal length와 roll을 보존한다.
- 4개 pose control은 선택된 mannequin에만 표시한다.
- selection, root TransformControls, duplicate/delete, shadow, export를 articulated child 전체에 대해 유지한다.
- frame/look-at-selected는 fixed mannequin dimensions가 아니라 posed articulated bounds를 사용한다.

### 양손 IK transaction과 controls arbitration

- `MannequinTool = 'object' | 'ik'`로 root transform과 hand IK를 명시적으로 분리한다.
- 실제 Canvas pointer-down/move 동안 runtime pose override만 갱신한다.
- drag 중 document와 history는 불변이다.
- pointer-up 또는 pointer-cancel에서 final pose를 `commit-mannequin-pose`로 정확히 한 번 저장한다.
- Escape/tool unmount는 진행 중 transaction을 취소한다.
- IK drag 중 OrbitControls와 root TransformControls를 비활성화한다.
- root gizmo hover부터 OrbitControls를 선제 잠가 동일 pointer-down이 camera orbit에도 전달되는 충돌을 막는다.

## Strict RED → GREEN 및 회귀 수정

1. camera direction preset symbol/action/UI가 없는 focused RED에서 시작해 6 views를 각각 unit/store/component GREEN으로 만들었다.
2. v2 starter pose, v1 migration, legacy storage fallback, pose history의 missing-schema/action RED를 구현 후 GREEN으로 만들었다.
3. rig serialization, 2-bone IK, degenerate pole, reach clamp, custom pose bounds와 asymmetric posed root bounds RED를 pure tests로 GREEN화했다.
4. articulated runtime이 없는 actual Canvas pixel RED를 확인하고 hierarchy geometry를 연결해 pose silhouette GREEN을 만들었다.
5. portal IK handle이 R3F raycast에 도달하지 않는 실제 RED를 확인했다. handles를 SceneObject root child로 옮기고 Canvas pointer/raycaster 경로를 사용해 좌우 actual drag GREEN을 만들었다.
6. clean/reference PNG의 front/rear cue와 IK helper exclusion RED 후 permanent unlit cues와 editor layer 처리로 decoded PNG GREEN을 만들었다.
7. anatomical child root selection과 T-pose frame-selected actual Canvas RED를 pose-aware root integration으로 GREEN화했다.
8. 전체 preview E2E의 v1 key/version 기대값, camera Euler roll diagnostic, hard-coded gizmo axis offset, motion-guide pixel threshold 회귀를 실제 실패에서 수정했다.
9. root gizmo pointer-down 한 프레임이 OrbitControls에도 전달되는 actual E2E 회귀를 gizmo-hover interaction lock으로 막고 manipulation drag/Escape focused GREEN을 확인했다.
10. pointer-cancel이 pose를 취소하던 spec 차이를 final-pose one-commit으로 수정하고 actual mouse drag + pointer-cancel + duplicate cancel event E2E를 `1 passed`로 확인했다.
11. 독립 리뷰에서 production IK projection이 test-bridge guard 뒤에 있음을 발견했다. 모든 runtime에서 실제 handle mesh를 project하고 diagnostic publication만 test mode로 제한했으며, 일반 production artifact의 visible handle을 PNG 픽셀로 찾아 실제 pointer drag하는 테스트를 RED → GREEN으로 만들었다.
12. 겹치는 profile handle이 항상 left를 선택하던 문제를 screen distance와 depth tie-break로 수정하고 좌/우 profile actual pointer 테스트를 GREEN으로 만들었다.
13. direction view가 shot distance/target/roll을 덮어쓰고 world 축을 사용하던 문제를 active composition 보존 및 subject root-local rotation으로 수정했다. rotated-root front cue의 실제 WebGL 픽셀 테스트를 추가했다.
14. torso/head/wrist rotation과 실제 hand envelope가 FK/IK/bounds에서 누락되던 문제를 torso-aware arm FK, inverse-torso IK solve와 oriented part corners로 수정했다. custom rotation의 실제 runtime bounds와 IK anchor 정렬도 WebGL에서 확인했다.
15. closure quality review에서 minimum reach의 부동소수점 elbow 값이 schema 상한 `150`을 미세하게 넘고 commit 예외 시 transient drag/orbit 상태가 남는 문제를 발견했다. solver 반환값을 명시적 min/max 경계로 clamp하고 `finishDrag`를 cancellation 포함 `try/catch/finally`로 정리했으며, exact schema boundary, store commit, actual pointer commit-failure cleanup RED → GREEN을 추가했다.

## 실제 Chromium/WebGL 수동 검사

### Baseline

- macOS `26.5.2`, arm64
- Google Chrome `150.0.7871.187`
- Node `v25.8.1`
- npm `11.11.0`
- 실제 Chrome window `1440×845`, web area `1440×758`

### Named manual flow: articulated front/rear/T-pose/IK

실제 별도 Chrome profile과 Vite dev server에서 UI를 직접 조작했다.

1. starter mannequin을 선택하고 WebGL available 및 articulated standing silhouette, floor shadow, root gizmo/bounds를 확인했다.
2. Inspector에서 T 포즈를 선택해 양 shoulder/elbow/hand 계층이 수평으로 전개되고 posed bounds가 전체 팔 길이를 포함하는 것을 확인했다.
3. Camera의 후면 view를 선택해 얼굴/가슴 전면 cue가 사라지고 후면 cue가 노출되는 것을 확인했다.
4. Scene의 손 IK tool로 전환해 root gizmo가 사라지고 magenta/cyan 양손 handle이 표시되는 것을 확인했다.
5. 실제 foreground pointer drag로 한쪽 handle을 위·안쪽으로 이동해 upper arm과 forearm이 관절을 따라 굽고 반대팔과 root/camera가 고정되는 것을 확인했다.
6. floor shadow가 posed silhouette에 맞게 남고 WebGL 상태가 available인 것을 확인했다.
7. 독립 리뷰 수정 후 일반 production artifact를 새 Chrome profile에서 다시 열어 T pose의 전체 hand bounds와 양손 IK handle을 확인하고, magenta handle을 실제 foreground pointer로 drag해 팔 계층과 posed bounds가 함께 갱신되는 것을 확인했다.
8. 검사 전용 Chrome process와 Vite server는 종료했다.

결과: **PASS**. 화면 clipping, WebGL fallback, 비인간형 detached limb, root camera drift는 관찰되지 않았다.

## 독립 리뷰

- Initial review batches: `deleg_29722c68`, `deleg_0e128022`
- Spec-compliance와 quality/correctness를 서로 독립된 read-only worker에 병렬 요청했다.
- initial review의 Critical 1건과 Important 4건을 위 RED → GREEN 항목 11–14로 모두 수정했다.
- Closure review batch `deleg_4b3913a4`: spec worker는 timeout, quality worker는 minimum-reach/schema/transient cleanup Important 1건을 보고했다.
- 해당 Important를 위 RED → GREEN 항목 15로 수정했다.
- Final closure re-review batch `deleg_d5b82a45`: spec과 quality worker 모두 **APPROVED — Important/Critical 0건**. spec은 targeted unit/component 112/112와 Chromium 12/12, quality는 focused unit 81/81, Chromium/WebGL 8/8, ordinary production pointer IK 1/1 및 production diagnostics exclusion을 독립 재확인했다.

## Verification ledger

### 최신 확인 완료

- Unit: `npm run test -- --run`, exit `0`; **14 files, 168/168 passed**.
- Lint: `npm run lint`, exit `0`.
- Typecheck: `npm run typecheck`, exit `0`.
- Pointer-cancel focused Chromium: `1 passed (6.1s)`.
- Focused camera/export/mannequin Chromium: **23/23 passed (55.4s)**.
- Ordinary production artifact IK pointer test: **1/1 passed (5.3s)**.
- Production-preview E2E: `npm run test:e2e:preview`, exit `0`; **53/53 passed (56.4s)**.
- Final production build: Vite `8.1.5`, **683 modules**, exit `0`; production diagnostics assertion PASS.
- Production-preview performance observation: primitives `50`, scene objects `52`, orbit `1290ms`, 1080p export `1763ms` (export budget `≤3000ms`, PASS).

### Final closeout ledger

- `npm run test -- --run`: exit `0`, 14 files, 168/168 passed.
- `npm run lint`: exit `0`.
- `npm run typecheck`: exit `0`.
- `npm run format:check`: exit `0`.
- `npm run test:e2e:preview`: exit `0`, 53/53 passed.
- `npm run build`: exit `0`, production diagnostics absent.
- normal production artifact + actual pointer IK: exit `0`, 1/1 passed.

## 범위 준수

- 포함: articulated procedural mannequin, 4 poses, 6 views, v2 persistence/migration, left/right hand IK, posed bounds, existing editor/export integration.
- 제외: external GLB, skeleton/skinning, foot IK, head look-at, animation/timeline, skin/clothing, arbitrary character assets.
- 자격증명, API key, secret, 외부 네트워크 write를 추가하지 않았다.
