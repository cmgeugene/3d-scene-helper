# S34 Companion 실행·재연결 수명주기

## 구현

- 프로젝트 루트의 `.i2v-companion.lock`을 원자적으로 획득해 같은 프로젝트의 중복 Companion을
  막고, 종료된 PID와 손상된 lock을 stale 상태로 복구한다. lock 소유자는 nonce로 확인하며 인증
  토큰은 저장하지 않는다.
- 지정 포트가 `EADDRINUSE`이면 임의의 빈 포트로 한 번 전환한다. `--strict-port`는 fallback을
  끄고, `--no-open`은 준비된 편집기 URL의 기본 브라우저 실행을 끈다.
- `SIGINT`와 `SIGTERM`에서 HTTP 서버, Codex App Server와 프로젝트 lock을 정리한다.
- Scene Assistant는 SSE 또는 런타임 조회 실패 뒤 0.5초, 1초, 2초 간격으로 최대 3회 상태를
  재조회한다. 재연결 중 대화 metadata까지 복구되기 전에는 입력을 막고 수동 즉시 재시도를
  제공한다.
- 자동 복구는 turn 시작·재개 요청을 재전송하지 않는다. 같은 저장 thread는 복구 뒤 다음 사용자
  동작에서만 재개한다.

## 검증

- instance lock, 브라우저 명령, 포트 fallback, CLI 옵션과 React 재연결 상태를 단위 테스트한다.
- 실제 Companion HTTP 서버를 닫고 같은 포트에서 다시 시작하는 Chromium E2E로 자동 재연결,
  무중복 turn, 다음 사용자 입력의 동일 thread 재개를 확인한다.
- `npm test -- --run`: 48 files, 369 tests passed.
- `npm run typecheck`, `npm run lint`, `npm run build`: passed. Production build의 E2E bridge 제외
  검사도 통과했고 500 kB 초과 chunk 경고만 남았다.
- `npm run test:e2e:preview`: Chromium 76 tests passed. 실제 Companion 서버를 같은 포트에서
  재시작하는 S34 시나리오를 포함한다.
- S34 변경 파일의 Prettier 검사와 `git diff --check`: passed. 저장소 전체 `format:check`는 이번
  작업 전부터 포맷이 다른 `docs/architecture.md`, `docs/product-brief.md`만 보고한다.

## 제외 범위와 다음 단계

- 운영체제 로그인 시 자동 실행, 백그라운드 서비스 등록과 강제 종료 시 App Server의 외부 정리는
  포함하지 않는다.
- S35에서는 기존 브라우저 실행기와 Electron/Tauri 등의 배포 형태를 설치, 업데이트, 서명,
  프로젝트 선택과 런타임 수명주기 기준으로 비교하고 최소 배포 프로토타입을 결정한다.
