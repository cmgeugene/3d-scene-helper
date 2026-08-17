# Lens DOF photographic-stop slider handoff

- Hermes session: `20260817_145102_fe0f58`
- worktree: `/Users/js/Documents/3d-scene-helper-worktrees/lens-dof-slider`
- branch: `feat/lens-dof-slider`
- 시작 HEAD: `747615c1da23e3a303ad9dec8fd3a8df5a23d806`
- 최종 커밋 메시지: `feat: add depth-of-field slider`
- 최종 커밋 SHA: 이 문서가 동일 commit tree에 포함되므로 self-reference가 불가능하다. immutable SHA는 commit 직후 완료 보고에 기록한다.
- 범위: 기존 cinematic DOF의 수동 f-stop 입력을 photographic-stop slider로 교체하는 한 UX phase

## 제품 결정과 실제 의미

모든 `18/24/35/50/85mm` 렌즈에 동일한 가시 범위 `f/1.4–f/22`를 유지한다. f-stop은 렌즈와 별개로 공유되는 물리적 조리개/심도 제어이며, 렌즈별 blur 차이는 기존 runtime/export optics가 focal length, f-stop, focus distance를 함께 소비해 만든다. 따라서 렌즈 변경 시 slider endpoint나 stop label이 움직이지 않는다.

Slider는 임의의 선형 소수가 아니라 다음 25개 index stop을 사용한다.

`1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22`

기존 자동 preset은 정확히 유지한다.

- `18mm f/8`
- `24mm f/5.6`
- `35mm f/4`
- `50mm f/2.8`
- `85mm f/2`

## UX와 history 경계

- Camera inspector의 old free-form `조리개 F값` textbox를 제거했다.
- 새 range control label은 `조리개/심도`이며 현재 값을 `f/<value>`와 `aria-valuetext`로 노출한다.
- 저 f-stop 쪽은 `얕은 심도·강한 아웃포커스`, 고 f-stop 쪽은 `깊은 심도·약한 아웃포커스`로 설명한다.
- 선택한 단순 UX: Auto에서는 slider가 disabled이고, 사용자가 `수동 조리개`를 선택한 뒤 조정한다.
- Pointer drag 중에는 local index draft만 바뀐다. `pointerup`/blur commit boundary에서 document/history를 한 번만 갱신한다.
- Arrow key는 photographic stop 한 칸을 하나의 discrete camera/history mutation으로 commit한다. Home/End도 endpoint 한 번 commit으로 처리한다.
- Slider가 focus된 동안 기존 input shortcut guard가 Delete 및 scene shortcut을 격리한다.
- Auto lens change는 slider thumb를 lens preset으로 이동한다. Manual lens change는 현재 f-stop/thumb를 보존한다.

## 호환성과 runtime 범위

- scene JSON schema/version/migration은 변경하지 않았다.
- 기존 `depthOfField.fStop` number field를 그대로 사용하므로 저장된 유효 수동 값은 가장 가까운 visible photographic stop에 thumb를 표시하고, 첫 slider 조정부터 stop scale 값을 저장한다.
- viewport와 PNG의 core DOF pipeline/formula는 수정하지 않았다. Slider가 선택한 기존 f-stop 값만 같은 serialized camera 경로로 전달된다.
- runtime diagnostic과 exact PNG는 기존 shared optics 경로를 계속 사용한다.

## Strict RED → GREEN 증거

1. Pure stop-scale/index test를 먼저 추가해 missing export/function RED를 확인했다. Ordered 25-stop scale, endpoints, exact lens presets, nearest mapping, index clamping, NaN/infinity rejection 구현 후 `5/5` GREEN.
2. Inspector test를 old textbox 상태에서 실행해 `조리개/심도` slider missing RED를 확인했다. Stable `min=0/max=24`, Auto thumb movement, Manual preservation, accessible value text, old textbox absence, endpoint guidance와 one-boundary history 구현 후 focused component GREEN.
3. Pointer draft에 3개 intermediate change를 보내도 document는 pointerup 전까지 보존되고 history는 pointerup에서 정확히 `+1`임을 unit component test로 확인했다. ArrowRight는 stop 한 칸과 history `+1`을 만든다.
4. 기존 schema-compatible non-stop manual `f/2.7` fixture에서 thumb는 nearest stop index를 쓰되 visible/accessible current value가 `f/2.8`로 왜곡되던 RED를 확인했다. committed 값은 정확히 `f/2.7`로 표시하고 첫 사용자 조정부터 stop scale을 저장하도록 GREEN화했다.
5. Actual Chromium E2E에서 CSS endpoint layout missing RED를 확인한 뒤 slider heading/guidance layout을 추가했다.
6. Actual Chromium/WebGL에서 Auto `18→85`가 runtime `f/8→f/2`로 이동하고, Manual pointer `f/22`, ArrowLeft `f/20`, lens `85→24` preservation, pointer/keyboard 각각 history `+1`을 확인했다.
7. 같은 85mm three-plane fixture에서 Auto `f/2` PNG와 slider Manual `f/20` PNG의 actual decoded changed-pixel ratio가 `0.015810546875`로 non-zero이며 threshold `>0.002`를 통과했다.
8. Gemini quality review가 pointer와 무관한 range `change`가 local draft를 남길 수 있는 stale-state 위험을 Important로 보고했다. Focused test에서 pointerdown 없는 change가 thumb를 index `24`에 고정하는 RED를 재현한 뒤, pointer-active change만 draft로 받고 keyboard commit에서 draft/ref를 명시적으로 비우도록 수정했다. Focused component `2/2`와 actual Chromium Auto resync `1/1` GREEN을 확인했다.

## 변경 파일

- `src/editor/scene/lensDepthOfField.ts`
- `src/editor/scene/lensDepthOfField.test.ts`
- `src/editor/components/Inspector.tsx`
- `src/editor/components/Inspector.test.tsx`
- `src/app/App.css`
- `e2e/depth-of-field.spec.ts`
- `docs/session-handoffs/lens-dof-slider.md`

## 현재 검증 증거

- Focused pure/component/store: `3 files, 55/55 passed`.
- Focused slider component after shortcut coverage: `1/1 passed`.
- Typecheck: `npm run typecheck`, exit `0`.
- Focused actual Chromium slider/diagnostic/history/PNG: `1/1 passed`; changed-pixel ratio `0.015810546875`.

최종 full unit/type/lint/format/build, relevant camera/DOF/export E2E, serial preview E2E, ordinary production build, Gemini spec/quality verdict, exact commit SHA, clean status와 port cleanup은 immutable candidate에 대해 parent session이 직접 검증하고 완료 보고에 기록한다.

## 범위 준수

- 지정된 clean external worktree만 읽고 수정했다.
- primary/sibling worktree와 그 process는 읽거나 수정하거나 중지하거나 commit하지 않았다.
- 사용자 소유 가능성이 있는 `127.0.0.1:5173` server는 건드리지 않았다.
- core DOF 구현, scene schema/version/migration, 다음 phase는 변경하지 않았다.
