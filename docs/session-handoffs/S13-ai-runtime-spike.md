# Session S13 Handoff — Local Companion runtime spike

## 완료한 목표

수정된 `docs/ai-scene-assistant.md`의 단계 0을 기준으로 Local Companion의 첫 수직 슬라이스를 구현했다.

- 프로젝트에 고정된 공식 `@openai/codex` 런타임 추가
- Codex App Server stdio 실행, 초기화와 정상 종료
- `account/read` 기반 ChatGPT 로그인 상태 확인
- thread 시작·재개와 turn 시작·취소 프로토콜
- 텍스트와 프로젝트 내부 `localImage` 입력 전달
- App Server notification과 server request 이벤트 전달
- 세션 토큰과 Origin 검사를 사용하는 loopback HTTP API
- SSE 이벤트 스트림
- `assets/` 밖의 경로와 symlink/junction 탈출 차단
- 실제 Codex 런타임과 loopback API를 함께 확인하는 smoke 명령
- URL fragment 기반의 브라우저 연결 handoff와 `sessionStorage` 보관
- Bearer 인증을 사용하는 브라우저 API 및 fetch 기반 SSE 클라이언트
- Scene Assistant 연결·계정·오류·재시도 상태 UI
- 현재 SceneDocument를 포함하는 대화 prompt 조립
- Codex thread 시작·탭 단위 재개와 새 대화 전환
- agent message delta 스트리밍, turn 완료·오류·중단 UI
- 프로젝트 소유 `references.json` manifest와 `assets/references/` 원본 저장소
- Layout, Background, Character, Style 이미지 가져오기 API
- PNG/JPEG/WebP 시그니처·크기·25MB 제한 검증과 SHA-256 기록
- 썸네일·메타데이터·선택 상태를 제공하는 하단 References 트레이
- 캐릭터 레퍼런스와 장면 마네킹 연결, 사용·제외 범위 편집
- 생성 포함 상태와 연결 메타데이터의 manifest 영속화
- 선택 레퍼런스의 역할별 첨부 순서 정규화와 Codex turn 전달
- prompt에 첨부 순서·역할·연결 대상·사용 범위 요약 포함

## 변경 파일

### 생성

- `companion/appServerClient.ts`
- `companion/cli.ts`
- `companion/index.ts`
- `companion/jsonRpcPeer.ts`
- `companion/projectArtifacts.ts`
- `companion/referenceStore.ts`
- `companion/server.ts`
- `companion/smoke.ts`
- companion 단위 테스트 3개
- `companion/launchUrl.ts`
- `src/assistant/companionConnection.ts`
- `src/assistant/companionClient.ts`
- `src/assistant/SceneAssistantPanel.tsx`
- `src/assistant/ReferenceManager.tsx`
- `src/assistant/conversationEvents.ts`
- `src/assistant/conversationSession.ts`
- `src/assistant/sceneAssistantPrompt.ts`
- Companion handoff, 브라우저 연결과 Reference Manager 단위 테스트
- `docs/session-handoffs/S13-ai-runtime-spike.md`

### 수정

- `package.json`, `package-lock.json`
- `tsconfig.node.json`, `vite.config.ts`
- `src/test/setup.ts`
- `src/app/App.tsx`, `src/app/App.css`
- `src/editor/components/EditorShell.tsx`
- `README.md`

## 실제 프로토콜 확인

설치된 Codex 0.146.0 App Server 스키마를 생성해 다음 계약을 확인했다.

- `initialize` / `initialized`
- `account/read`
- `thread/start`, `thread/resume`
- `turn/start`, `turn/interrupt`
- `localImage` 사용자 입력
- `imageGeneration` thread item의 `savedPath`

실제 imagegen 호출은 사용자의 이미지 생성 사용량을 소비하므로 이번 스파이크에서는 실행하지 않았다. 대신 동일한 App Server와 로그인 세션을 사용해 초기화, 계정 확인과 인증된 loopback API까지 실제로 실행했다.

## 검증 결과

```text
npm run typecheck             PASS
npm run lint                  PASS
npm test -- --run             PASS — 28 files, 242 tests
npm run build                 PASS
npm run companion:smoke       PASS — ChatGPT account, App Server and loopback API
npx playwright test e2e/smoke.spec.ts
                              PASS — Chromium 3 tests
```

별도 Companion과 Chromium 1280×720 브라우저를 연결해 URL fragment 제거, ChatGPT 계정 표시, 대화 입력 활성화, 실제 캐릭터 이미지 가져오기, 마네킹 연결, 새로고침 후 설정 복원, Scene Assistant 첨부 개수 표시와 가로 overflow 부재를 수동 확인했다. 브라우저 검증용 프로젝트와 복사된 이미지는 확인 후 삭제했다. 실제 turn 전송은 계정 사용량을 임의로 소비하지 않도록 자동 검증에서 제외하고 브라우저 클라이언트·이벤트 정규화·React 대화 흐름을 가짜 런타임으로 검증했다.

`npm run format:check`는 이번 변경과 무관한 기존 파일 다수가 현재 Prettier 3.9.6 출력과 일치하지 않아 저장소 전체 기준으로 실패한다. 이번에 추가하거나 수정한 파일은 개별적으로 Prettier를 적용했다. 전체 저장소의 기계적 포맷 변경은 기능 diff와 섞지 않았다.

## 보안과 데이터 경계

- Companion은 `127.0.0.1`에만 바인딩한다.
- `/healthz` 외의 API는 Bearer 세션 토큰을 요구한다.
- 브라우저 Origin allowlist를 검사한다.
- JSON 요청 본문은 1MB, 레퍼런스 바이너리는 25MB로 제한한다.
- 확장자나 브라우저 MIME만 신뢰하지 않고 PNG/JPEG/WebP 파일 시그니처를 검사한다.
- 레퍼런스 원본은 임의 절대 경로를 저장하지 않고 `assets/references/`에 복사한다.
- 이미지 첨부는 프로젝트 `assets/` 하위 상대 경로만 허용한다.
- canonical path를 재검사해 symlink 또는 junction을 통한 탈출도 거부한다.
- Codex 인증 파일이나 OAuth 토큰은 읽지 않는다.
- Codex thread는 read-only sandbox와 `approvalPolicy: never`로 시작한다.
- 브라우저 handoff 토큰은 query string이 아닌 URL fragment로 전달하고 history에서 즉시 제거한다.
- 브라우저는 연결 정보를 영구 저장소가 아닌 현재 탭의 `sessionStorage`에만 보관한다.
- Codex thread ID도 프로젝트 영속화 전까지 현재 탭의 `sessionStorage`에만 보관한다.
- 원격 호스트를 가리키는 handoff URL은 브라우저가 거부한다.

## 남은 단계 0 작업

- 서버 요청에 대한 승인·사용자 입력 응답 경로
- `imageGeneration.savedPath` 결과를 프로젝트 `assets/generations/`로 안전하게 편입
- 생성 작업 상태 머신과 중복 요청 방지
- 프로젝트 session metadata와 thread 재개 영속성
- 레이아웃 렌더 및 레퍼런스가 포함된 실제 imagegen 수동 검증

다음 구현은 현재 3D 뷰포트의 레이아웃 PNG를 생성 요청 시 자동 렌더해 첨부하고, imagegen 결과를 `assets/generations/`와 generation record에 안전하게 편입하는 흐름이 적절하다.
