# S20 — P0 키프레임 작업 공간

## 결과

프로젝트에 저장된 generation 전체를 탐색하고 선택한 결과와 생성 당시 3D 레이아웃 렌더를 비교한 뒤, 그 generation을 부모로 보정에 진입하는 P0 작업 공간을 완성했다.

- 상단 `3D 씬 / 키프레임` 작업 모드 전환과 마지막 모드 복원
- 프로젝트 전체 generation의 상태, 버전, fresh/edit, 부모·자식 관계 탐색
- 선택 generation의 결과, 원 지시, 수정 프롬프트, 피드백, 레퍼런스 스냅샷, `LayoutSpec` 상세
- 선택 결과 이미지와 생성 당시 레이아웃 렌더의 나란히 비교
- 선택 generation ID와 버전을 명시한 보정 진입
- 키프레임 모드에서 숨은 3D 씬 도구와 전역 편집 단축키 비활성화
- 마지막 선택 generation의 localStorage 복원
- `sceneSnapshot`이 없는 구형 기록의 이미지 비교 가능 / 3D 장면 복원 불가 안내
- 저장된 레이아웃 렌더를 읽는 인증된 `GET /api/scene-renders/:id/content`

기존 최신 결과 카드의 보정 버튼은 제거했다. 최신 결과 카드는 상태 확인 용도로 유지하되, 보정 원본은 키프레임 작업 공간에서 사용자가 선택한 완료 generation만 사용한다.

## 주요 구현

- `companion/generationStore.ts`
  - scene render artifact를 프로젝트 루트 안에서 안전하게 해석하고 PNG 콘텐츠를 읽는 API 추가
  - 새 `GenerationStore` 인스턴스에서도 manifest와 렌더 콘텐츠가 복원되는 테스트 추가
- `companion/server.ts`
  - 기존 bearer 인증과 CORS 경계 안에 scene render 콘텐츠 route 추가
  - `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` 적용
- `src/assistant/companionClient.ts`
  - 인증 헤더를 사용하는 `loadSceneRenderBlob` 추가
- `src/assistant/KeyframeWorkspace.tsx`
  - 목록/선택/상세/비교/복원 제한 UI와 SSE generation 갱신 연결
  - result/layout object URL의 generation별 race 방지와 정리
  - 이미지 로드 실패를 loading과 구분하고 다른 generation 선택의 오류와 격리
- `src/editor/components/EditorShell.tsx`
  - 전체 폭 키프레임 모드와 저장된 작업 모드 복원
  - 선택 완료 generation을 Scene Assistant의 controlled refinement source로 전달
- `src/assistant/SceneAssistantPanel.tsx`
  - 보정 원본을 외부 선택으로 제어하고 원본 generation ID/버전을 표시
  - 최신 결과 카드에서 직접 보정하던 진입점 제거
- `e2e/keyframe-workspace.spec.ts`
  - 인증된 실제 HTTP mock Companion을 통해 목록, 이미지 콘텐츠, 선택, 비교, 구형 제한, 새로고침 복원, 선택 보정 흐름 검증

## 검증한 사용자 흐름

1. Companion 연결 상태에서 `키프레임` 모드로 전환한다.
2. 전체 generation 목록과 선택 결과/레이아웃 이미지를 확인한다.
3. 다른 generation을 선택하고 생성 당시 지시와 상세를 확인한다.
4. 스냅샷 없는 기록에서 복원 제한 안내를 확인한다.
5. 새로고침 뒤 키프레임 모드와 선택 generation이 유지되는지 확인한다.
6. 완료 generation을 선택해 `선택 결과로 보정`을 누른다.
7. 3D 씬으로 돌아오며 보정 원본 generation ID와 버전이 정확히 표시되는지 확인한다.

Playwright 흐름은 브라우저 `pageerror`와 console warning/error가 없고 가로 overflow가 없음을 함께 검증한다.

## 검증

- focused Vitest: 46/46 통과
- `npm test -- --run`: 33 files, 274 tests 통과
- `npm run typecheck`: 통과
- `npm run lint`: 통과
- `npm run build`: 통과; 기존 500 kB 초과 chunk 경고 유지
- focused Playwright keyframe flow: 1/1 통과
- `git diff --check`: 통과
- 변경 파일만 대상으로 한 Prettier check: 통과

전체 `npm run format:check`에는 이번 변경과 무관하고 시작 시점부터 있던 다음 세 파일의 기존 경고가 남아 있다.

- `src/app/App.test.tsx`
- `docs/architecture.md`
- `docs/product-brief.md`

## 의도적으로 남긴 범위

- P1의 `sceneSnapshot` 읽기 전용 미리보기와 현재 3D 편집기에 적용하는 기능
- autosave/덮어쓰기 경고/취소/undo를 포함한 과거 씬 적용 흐름
- P2 이후 Semantic Scene Spec, `specPatch`, 충돌 검사

## 다음 단계

`docs/roadmap.md`의 P1부터 진행한다. 먼저 선택 generation의 `sceneSnapshot`을 읽기 전용으로 미리 보고 현재 씬과 차이를 확인하는 수직 슬라이스를 설계한다. 현재 편집기에 적용하는 기능은 복구 경로와 함께 구현하며, P2로 넘어가지 않는다.
