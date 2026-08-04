# S28 — Structured Refinement Directive

## 세션

- 브랜치: `codex/conversational-scene-assistant`
- 작업 트리: `/Users/js/Documents/3d-scene-helper/.worktrees/codex-conversational-scene-assistant`
- 시작 HEAD: `497bb064ddfa3ab8d3729bfdb7e67eb3a3420156`
- 시작 divergence: `origin/codex/conversational-scene-assistant`보다 4 commits ahead
- 선행 uncommitted 범위: S24–S27 P3 수직 슬라이스
- 범위: P4의 versioned 유지·변경 보정 지시, browser·Companion·store 검증, prompt와 generation history 왕복

## 구현 요약

### RefinementDirective version 1

- 공유 strict schema에 `version: 1`, `preserve`, `change`를 정의했다.
- `change`는 1–16개, `preserve`는 0–16개이며 각 항목은 trim한 1–240자 문자열이다.
- 대소문자와 공백을 정규화해 목록 내부 중복과 같은 항목의 유지·변경 동시 지정을 거부한다.
- 브라우저는 multiline 입력을 줄 단위 배열로 변환하고 schema 오류가 있으면 3D 캡처나 generation 요청 전에 중단한다.

### UI와 prompt 권위 계약

- 보정 모드 컴포저에 `유지할 요소` 입력과 구조화 규칙 안내를 추가했다. 기존 보정 textarea는 `change` 원본이다.
- 보정 prompt는 자유 텍스트 block 대신 directive JSON을 전달한다.
- `preserve`는 기존 완성 키프레임이 권위 원본이고 `change`만 다시 생성하며 미지정 요소도 보존한다는 규칙을 명시했다.
- generation history는 유지·변경 목록을 분리해 표시하고 directive가 없는 구형 기록은 기존 feedback을 표시한다.

### Companion과 영속성

- generation request, 브라우저 public schema, Companion request schema와 generation manifest에 nullable `refinementDirective`를 추가했다.
- 새 `edit` 요청은 directive가 필수이고 `fresh` 요청에 directive가 있으면 브라우저를 우회해도 거부한다.
- generation store도 같은 mode 조합을 재검증하고 directive clone을 manifest와 public generation record에 보존한다.
- 기존 generation manifest는 default `null` migration으로 계속 읽는다.

### 미리보기 blob URL 수명주기 수정

- 실제 Chromium 보정 흐름에서 이전 generation 미리보기 URL을 React가 이미지를 제거하기 전에 해제해 발생하던 `ERR_FILE_NOT_FOUND`를 발견했다.
- 미리보기 교체·제거 시 URL 해제를 다음 render frame으로 미뤄 DOM과 blob 수명주기를 맞췄다. unmount cleanup은 기존처럼 유지한다.

## 실제 Chromium 증거

신규 `e2e/refinement-directive.spec.ts`가 1280×720 authenticated mock Companion에서 다음을 검증한다.

1. 완료 키프레임을 선택해 `edit` 보정 모드로 진입한다.
2. 같은 항목을 preserve와 change에 넣으면 접근 가능한 오류를 표시하고 generation 요청을 보내지 않는다.
3. 유효한 두 multiline 목록을 version 1 directive로 보내며 parent generation과 edit mode를 보존한다.
4. prompt가 요청 directive JSON과 미지정 요소 보존 권위 규칙을 포함한다.
5. 완료 generation을 history에서 다시 선택하면 저장된 유지·변경 목록을 분리해 표시한다.
6. 1280px horizontal overflow와 page/console error가 없다.

## 검증 게이트

- focused schema/prompt/panel/workspace/client/store/server tests: 7 files, 57 tests passed
- `npm test -- --run`: 40 files, 329 tests passed
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run build`: passed; production E2E diagnostics absent assertion passed
- 신규 refinement directive 1280×720 Chromium E2E: passed
- `npm run test:e2e:preview`: 71 passed
- changed-file Prettier와 `git diff --check`: passed
- 전체 `npm run format:check`에는 이번 범위 밖 기존 `docs/architecture.md`, `docs/product-brief.md` formatting warning 2건이 남아 있다.
- 실제 imagegen 사용량은 소모하지 않았다.

## 의도적으로 제외한 항목

- parent·sibling generation 결과 이미지의 나란히 비교
- generation request idempotency key와 Companion 재시작 복구
- directive 자동 추출 또는 자연어 분류 모델 호출
- 실제 imagegen 사용량 소비
- commit, main 병합, push와 원격 변경

## 다음 단계

S29는 선택 generation과 부모 또는 형제 generation을 이미지·RefinementDirective·SceneDocument·LayoutSpec 기준으로 나란히 비교하고 비교 대상을 복원한다.
