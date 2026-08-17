# S32 — Project Conversation Persistence

## 세션

- 브랜치: `codex/conversational-scene-assistant`
- worktree: `.worktrees/codex-conversational-scene-assistant`
- 시작 HEAD: `497bb06`
- S24–S31 변경을 포함한 미커밋 작업 트리에서 이어서 구현했다.
- 범위: 프로젝트별 Codex task metadata 영속화, 명시적 재개·새 task 선택, 재시작 복구.

## 구현 요약

### Versioned 프로젝트 원본

- 프로젝트 루트의 `conversations.json`을 version 1 manifest로 추가했다.
- 활성 task와 보관 task에 thread ID, turn 수·종류·상태, revision과 시각을 저장한다.
- 최근 사용자 요청은 500자, assistant 요약은 1,000자로 제한하며 전체 prompt와 transcript는 저장하지 않는다.
- mutation queue와 임시 파일 교체로 동시 갱신을 직렬화하고 원자적으로 기록한다.
- Companion 재시작 시 활성 task의 미완료 turn을 `interrupted`로 복구한다.

### Companion API와 turn 수명주기

- `GET /api/conversation-session`으로 프로젝트 대화 상태를 조회한다.
- `POST /api/threads`가 `new`·`resume` mode를 처리하며 기존 요청 형식도 호환한다.
- 일반 대화, spec patch와 generation 시작을 동일한 metadata 수명주기에 기록한다.
- App Server의 agent message와 turn completion 알림으로 요약과 최종 상태를 갱신한다.
- 구형 Companion이나 mock의 조회 404는 빈 세션으로 처리해 기존 UI 계약을 유지한다.
- SSE client 정리는 요청 객체가 아니라 실제 응답 스트림의 `close`에 연결해 장시간 turn 중 조기 종료를 막는다.

### 명시적 복구 UX

- 저장 task가 있으면 thread ID, 최근 요청·응답, turn 상태와 revision을 요약 카드로 보여 준다.
- 사용자가 `저장된 task 재개` 또는 `새 task 시작`을 선택하기 전에는 새 turn을 보내지 않는다.
- 재개 실패 시 선택 카드를 유지하고 오류를 보여 주며 새 task로 복구할 수 있다.
- 새 task는 이전 활성 task를 보관하고 프로젝트의 새 활성 thread로 기록한다.

## 자동 검증

- Vitest 전체: 43 files, 350 tests 통과.
- TypeScript typecheck 통과.
- ESLint 통과.
- Chromium 집중 E2E: S30 생성 복구와 S32 프로젝트 대화 복구 2개 통과.
- S32 Chromium 병렬 반복: 5/5 통과.
- Chromium 전체 E2E: 74/74 통과.
- production build와 E2E preview build 통과.
- S32 변경 파일 format과 `git diff --check` 통과. 전체 format check는 기존 문서 `docs/architecture.md`, `docs/product-brief.md` 두 파일만 경고한다.

## 제외 범위

- 전체 transcript 저장과 보관 task 탐색 UI
- AI 기반 장문 대화 요약
- 승인·사용자 입력 요청 UI
- Companion 자동 시작·데스크톱 패키징
- 실제 imagegen 사용량을 소모하는 수동 검증
- 커밋과 push

## 다음 단계

S33에서 App Server 승인·사용자 입력 요청을 인증된 Companion 경계로 전달하고, 브라우저에서
요청 출처와 영향을 확인한 뒤 승인·거부·답변할 수 있는 복구 가능한 수명주기를 구현한다.
