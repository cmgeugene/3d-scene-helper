# S29 — Generation Version Comparison

## 세션

- 브랜치: `codex/conversational-scene-assistant`
- 작업 트리: `/Users/js/Documents/3d-scene-helper/.worktrees/codex-conversational-scene-assistant`
- 시작 HEAD: `497bb064ddfa3ab8d3729bfdb7e67eb3a3420156`
- 선행 uncommitted 범위: S24–S28 수직 슬라이스
- 범위: P4의 부모·형제 generation 결과와 생성 계약 비교, 비교 선택 복원

## 구현 요약

### 계보 제한 비교 선택

- 선택 generation의 부모를 첫 비교 대상으로 사용하고 같은 `parentGenerationId`를 가진 형제를
  추가 선택지로 제공한다.
- 루트 generation이나 비교 가능한 계보가 없는 기록은 빈 상태를 명시한다.
- 선택 generation과 비교 generation ID를 독립된 localStorage 키에 저장한다.
- 저장된 비교 ID가 계보 밖이거나 사라졌으면 부모, 이후 첫 형제 순으로 fail-closed 복원한다.

### 결과와 생성 계약의 동일 대상 비교

- 선택 결과와 부모·형제 결과 이미지를 별도의 인증된 콘텐츠 요청으로 나란히 표시한다.
- 두 generation의 version, mode, status, parent와 source를 같은 비교 카드에 표시한다.
- 두 `RefinementDirective`의 preserve/change 목록과 계약 변경 여부를 표시한다.
- `SceneDocument`는 장면 ID, scene/spec revision, 카메라, 출력, 조명·배경, Semantic Scene Spec,
  오브젝트 추가·제거·변경, 메모와 모션 차이를 계산한다.
- `LayoutSpec`은 장면 ID, 프레임, 카메라, 생성 권위, 화면 배치 오브젝트와 가림 분석 차이를
  계산한다.
- 구형 null snapshot과 scene ID mismatch를 동일한 결과로 축약하지 않고 별도 상태로 표시한다.

### blob URL 수명주기 보강

- 실제 보정→키프레임 전환 회귀에서 이전 선택 결과와 Assistant 미리보기 blob이 아직 로드 중인
  첫 프레임에 해제되는 `ERR_FILE_NOT_FOUND` 경쟁을 발견했다.
- 교체·effect cleanup URL은 DOM 제거와 다음 paint가 끝난 뒤 해제하도록 두 render frame을
  기다린다. 실제 unmount의 최종 정리는 계속 모든 남은 URL을 해제한다.
- 선택 generation 메타데이터를 이름 있는 region으로 만들어 비교 카드의 같은 directive 문구와
  접근 가능한 범위를 구분했다.

## 실제 Chromium 증거

신규 `e2e/generation-version-comparison.spec.ts`가 1280×720 authenticated mock Companion에서
다음을 검증한다.

1. edit child를 선택하면 부모가 기본 비교 대상으로 연결된다.
2. 선택 결과와 부모 결과 이미지가 함께 표시된다.
3. version·mode·두 directive와 SceneDocument·LayoutSpec의 실제 차이가 표시된다.
4. 비교 대상을 형제로 바꾸면 이미지와 생성 계약이 같은 형제 ID로 전환된다.
5. 선택과 비교 대상이 localStorage에 저장되고 reload 뒤 그대로 복원된다.
6. 계보 선택지는 부모·형제 두 개로 제한되고 1280px horizontal overflow와 page/console error가 없다.

## 검증 게이트

- focused comparison model/workspace tests: 2 files, 13 tests passed
- focused 1280×720 generation comparison Chromium E2E: passed
- focused refinement + comparison Chromium E2E: 2 passed
- `npm test -- --run`: 41 files, 334 tests passed
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run build`: passed; production E2E diagnostics absent assertion passed
- `npm run test:e2e:preview`: 72 passed
- changed-file Prettier와 `git diff --check`: passed
- 전체 `npm run format:check`에는 이번 범위 밖 기존 `docs/architecture.md`,
  `docs/product-brief.md` formatting warning 2건이 남아 있다.
- 실제 imagegen 사용량은 소모하지 않았다.

## 의도적으로 제외한 항목

- generation 요청 idempotency key와 중복 클릭 방지
- Companion 재시작 중 in-progress generation 복구와 재시도 상태 머신
- 이미지 픽셀 diff나 자동 후보 점수화
- 루트 generation 사이의 임의 비교
- 실제 imagegen 사용량 소비
- commit, main 병합, push와 원격 변경

## 다음 단계

S30은 generation 요청 idempotency와 중복 클릭 방지를 구현하고 취소·실패·재시도 상태를
새로고침과 Companion 재시작 뒤 일관되게 복구한다.
