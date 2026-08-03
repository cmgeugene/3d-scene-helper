# S21 — sceneSnapshot 읽기 전용 미리보기

## 세션

- session_id: `20260803_224426_9f20e2`
- 브랜치: `codex/conversational-scene-assistant`
- 작업 트리: `/Users/js/Documents/3d-scene-helper/.worktrees/codex-conversational-scene-assistant`
- 시작 HEAD: `c1ad27084af209ea292db42c1aae0bd46a75ac3d`
- 시작 divergence: `origin/codex/conversational-scene-assistant`보다 1 commit ahead
- 범위: P1 첫 수직 슬라이스인 generation `sceneSnapshot` 읽기 전용 미리보기·현재 씬 비교·scene ID 무결성 표시만 수행

## 구현 요약

### 격리된 읽기 전용 3D 미리보기

- `SceneSnapshotPreview`가 선택 generation의 `sceneSnapshot`을 `structuredClone`한 별도 editor store로 만든다.
- `SceneViewport`의 `readOnly` 경계는 editor navigation, object selection, transform controls, mannequin IK, facing helper와 editor helper를 렌더하지 않는다.
- preview surface는 pointer event를 차단하며 live editor store를 참조하거나 교체하지 않는다.
- WebGL이 비활성화되거나 context가 손실되면 snapshot의 focal length와 object 수를 포함한 안전한 fallback을 표시한다.
- viewport chunk는 lazy import로 유지해 기존 WebGL fallback code-splitting 계약을 보존한다.

### 현재 SceneDocument와 차이

- snapshot → 현재 씬 방향으로 다음 변경을 사용자 문구로 표시한다.
  - scene ID
  - OutputCamera 위치·focal length와 기타 camera 값
  - 출력 화면비·해상도·mode
  - 조명·배경
  - object 추가·삭제
  - transform·dimensions
  - semantic meaning/generation notes
  - 이름·색상·가시성·exportable
  - mannequin pose
  - scene notes와 motion guide metadata
- 차이가 없으면 현재 씬과 동일함을 표시한다.
- preview를 열어도 live SceneDocument, selection, history, dirty state와 autosave를 건드리지 않는다.

### scene ID 무결성

- Companion은 manifest의 generation `sceneSnapshot.id`, `layoutSpec.sceneId`와 실제 `sceneRenders` record의 `sceneId`를 매번 비교해 public generation에 `sceneIntegrity`를 붙인다.
- 새 generation 생성 시 기존의 3-way ID 불일치 거부 계약을 유지한다.
- 브라우저는 server status를 그대로 신뢰하지 않고 response의 snapshot/LayoutSpec ID와 server가 제공한 layout render ID를 다시 비교한다.
- 누락 또는 mismatch면 세 ID를 오류 카드에 표시하고 preview/비교를 비활성화한다.
- `sceneSnapshot`이 없는 구형 기록은 `legacy`로 유지해 기존 “3D 장면 복원 제한” 안내와 비활성 preview를 제공한다.

## TDD 기록

### RED

1. `npm test -- --run companion/generationStore.test.ts -t '저장된 snapshot'`
   - 실패 이유: list/restart 경로에 `sceneIntegrity`가 없어서 3-way mismatch를 보고하지 못함.
2. `npm test -- --run src/assistant/KeyframeWorkspace.test.tsx -t 'snapshot을 별도|browser가 scene ID mismatch|프로젝트 전체 계보'`
   - 실패 이유: preview/차이 UI와 browser-side integrity guard가 없음.
3. `npm test -- --run src/editor/components/EditorShell.test.tsx -t '3D 씬과 키프레임'`
   - 실패 이유: preview renderer가 EditorShell에 연결되지 않아 읽기 전용 preview가 없음.
4. `npx playwright test e2e/keyframe-workspace.spec.ts --project=chromium`
   - 최종 의도된 RED: preview surface 안에 실제 Canvas가 없음.
5. `npm test -- --run src/assistant/sceneSnapshotComparison.test.ts`
   - 독립 리뷰의 blocking finding을 재현해 scene name, object kind, camera target/roll,
     rotation/scale/dimensions와 generation notes 설명 누락으로 3 tests가 실패함.

### GREEN

- focused unit/integration: `28 passed`
- focused EditorShell + KeyframeWorkspace after lint fix: `21 passed`
- focused scene comparison closure: `3 passed`
- focused Chromium E2E: `1 passed`
- 실제 preview runtime camera: position `(2, 2.4, -7)`, `35mm`, target `(0.5, 1.2, 0)`, roll `3°`
- 실제 preview runtime object: `starter-mannequin` position `(-1.25, 0.85, 1.5)`, snapshot-only cube 포함

## 브라우저 불변성 증거

1280×720 Chromium 사용자 흐름에서 다음을 확인했다.

1. live scene에 별도 cube를 추가하고 mannequin을 선택한 뒤 autosave 완료 상태를 기준으로 SceneDocument, history, selection, dirty state와 autosave를 캡처했다.
2. Keyframe Workspace 진입, generation 선택, preview 열기/닫기, mismatch 선택, legacy 선택과 valid generation 재선택 뒤 다섯 상태가 byte-equivalent임을 확인했다.
3. mock Companion을 같은 포트에서 실제로 종료·재시작한 뒤에도 다섯 상태가 동일함을 확인했다.
4. 페이지 새로고침 뒤 live SceneDocument와 autosave가 snapshot으로 교체되지 않고 기존 autosave에서 복원됨을 확인했다. 새로고침 후 baseline에서도 preview가 document/history/selection/dirty/autosave를 변경하지 않았다.
5. preview Canvas의 runtime camera/object diagnostic으로 과거 카메라와 object 배치를 확인했다.
6. 1280px viewport에서 document horizontal overflow가 없음을 확인했다.

브라우저 새로고침 자체의 기존 editor lifecycle은 in-memory selection/history를 영속화하지 않는다. S21은 이 정책을 변경하지 않았으며, 새로고침 뒤 복원된 baseline을 preview가 변경하지 않는지 별도로 검증했다.

## 검증 게이트

- `npm test -- --run`: 34 files, 280 tests passed
- `npm run typecheck`: passed
- `npm run lint`: 처음에는 effect 내 synchronous state와 hook-derived Canvas mutation 2건을 정확히 검출; generation-bound preview state와 diagnostic helper로 수정 후 passed
- `npm run build`: passed; production E2E diagnostics absent assertion passed; 기존 500kB chunk warning만 존재
- `npm run test:e2e:preview`: 67 passed
- changed-file Prettier: passed
- `npm run format:check`: 기존 warning 3개(`src/app/App.test.tsx`, `docs/architecture.md`, `docs/product-brief.md`)만 남고 S21 신규 warning 없음
- `git diff --check`: passed

## 독립 리뷰

- initial spec review: FAIL — scene name과 same-ID object kind가 비교되지 않아 false-identical이
  가능하다는 Important finding 2건
- initial quality/security review: FAIL — 동일 logic finding 1건; security/static scan finding 없음
- 수정: 누락 필드를 비교하고, 실제로 바뀐 camera/transform/semantic/appearance 값만 설명하도록
  비교 출력을 구체화했으며 dedicated regression 3건을 RED→GREEN으로 추가
- closure spec review: PASS — 원래의 scene name 누락과 same-ID object kind 누락을 모두 CLOSED로 확인했으며 신규 blocking spec regression 없음
- closure quality/security review: PASS — 원래 logic blocker CLOSED, security finding·신규 blocking logic finding 없음

## 변경 파일

- `companion/generationStore.ts`
- `companion/generationStore.test.ts`
- `src/assistant/companionClient.ts`
- `src/assistant/sceneSnapshotComparison.ts`
- `src/assistant/sceneSnapshotComparison.test.ts`
- `src/assistant/SceneSnapshotPreview.tsx`
- `src/assistant/KeyframeWorkspace.tsx`
- `src/assistant/KeyframeWorkspace.test.tsx`
- `src/editor/components/EditorShell.tsx`
- `src/editor/components/EditorShell.test.tsx`
- `src/editor/scene/SceneViewport.tsx`
- `src/app/App.css`
- `e2e/keyframe-workspace.spec.ts`
- `docs/roadmap.md`
- `docs/session-handoffs/S21-scene-snapshot-preview.md`

## 의도적으로 제외한 항목

- `현재 씬으로 불러오기`
- overwrite warning과 취소/undo/autosave 복구 적용 흐름
- fresh/edit 생성 정책 변경
- P2 Semantic Scene Spec, `specPatch`, 충돌 검사
- main 병합 또는 push

## 다음 단계

P1 적용 슬라이스만 이어서 수행한다.

1. 현재 SceneDocument의 명시적 pre-apply autosave
2. 덮어쓰기 경고와 취소
3. 선택 snapshot을 현재 씬에 적용하는 단일 명시적 action
4. undo 또는 autosave 복구
5. 선택 generation 출처와 fresh/edit 계보 계약 검증

P2로 넘어가지 않는다.
