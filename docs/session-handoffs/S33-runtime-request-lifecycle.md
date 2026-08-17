# S33 — Runtime Request Lifecycle

## 세션

- 브랜치: `codex/conversational-scene-assistant`
- worktree: `.worktrees/codex-conversational-scene-assistant`
- 시작 HEAD: `497bb06`
- S24–S32 변경을 포함한 미커밋 작업 트리에서 이어서 구현했다.
- 범위: App Server 승인·사용자 입력 요청의 인증 전달, 명시적 UI 응답과 재시작 복구.

## 구현 요약

### Protocol 고정과 fail-closed 경계

- 설치된 Codex App Server 0.146.0의 생성 TypeScript schema로 server request 계약을 확인했다.
- `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/tool/requestUserInput` 세 종류만 지원한다.
- thread는 read-only sandbox와 `on-request` 승인 정책으로 시작·재개한다.
- App Server 응답은 runtime의 JSON-RPC peer가 소유하며 브라우저에는 임의 method·result 전달 API를 노출하지 않는다.
- 지원하지 않거나 잘못된 요청은 JSON-RPC protocol error로 종료한다.

### Versioned 요청 수명주기

- 프로젝트 루트에 `runtime-requests.json` version 1 manifest를 추가했다.
- 최근 50개 요청의 종류, 출처 thread/turn/item, 제한된 이유·영향·경로, 질문과 상태만 원자 저장한다.
- 사용자 답변과 secret 값은 App Server에 한 번 전달할 뿐 프로젝트 파일, SSE와 로그에 저장하지 않는다.
- 같은 요청의 동시·중복 응답은 409로 차단한다.
- 외부 auto-resolution은 `serverRequest/resolved` 알림으로 닫고 Companion 재시작 시 pending 요청은 `expired`로 복구한다.

### 브라우저 UX

- 승인 카드가 요청 출처, 이유, 실제 command 또는 파일 영향과 경로를 표시한다.
- 사용자는 이번 요청만 승인하거나 거부할 수 있으며 세션 전체 승인은 제공하지 않는다.
- 사용자 입력 카드는 선택지, 직접 입력과 password 형태 secret 답변을 지원한다.
- 만료 요청은 실행 버튼 없이 재시작 복구 안내를 표시한다.

## 자동 검증

- 집중 Vitest: 5 files, 52 tests 통과.
- 전체 Vitest: 44 files, 359 tests 통과.
- TypeScript typecheck와 ESLint 통과.
- production build와 E2E preview build 통과.
- Chromium 집중 E2E: S32 대화 복구와 S33 runtime request 수명주기 2/2 통과.
- Chromium 전체 E2E: 75/75 통과.
- S33 변경 파일 format과 `git diff --check` 통과. 전체 format check는 기존 `docs/architecture.md`, `docs/product-brief.md`만 경고한다.

## 제외 범위

- permission profile, MCP elicitation과 dynamic tool call server request
- 세션 전체 승인과 정책 amendment UI
- secret 답변 저장·복원
- Companion 자동 시작·종료와 자동 재연결
- 실제 Codex 명령·파일 변경 승인 사용량을 소모하는 수동 검증
- 커밋과 push

## 다음 단계

S34에서 Local Companion 자동 시작·종료, 포트 충돌 처리와 SSE/App Server 재연결 UX를 구현한다.
재연결은 서버 상태를 다시 조회하되 완료 여부가 불명확한 turn을 자동 중복 실행하지 않아야 한다.
