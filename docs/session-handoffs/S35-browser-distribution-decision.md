# S35 브라우저 배포 실행기와 패키징 결정

## 구현

- production 편집기 정적 파일을 Companion API와 같은 임의 loopback origin에서 제공한다.
- 정적 파일은 MIME, cache, CSP와 clickjacking/referrer 방어 header를 적용하고 path traversal 및
  배포 루트 밖 symlink를 거부한다.
- `--editor-root`, `--help` CLI와 `npm run start:browser`를 추가했다. bundled-static 모드는 별도
  Vite 서버 없이 자체 URL을 열고 API의 same-origin 요청을 허용한다.
- `npm run build:browser-distribution`은 minified Companion runner, production editor와 현재
  platform용 Codex package를 `.artifacts/browser-distribution/<platform>-<arch>/`에 만든다.
  생성 artifact는 Node.js만 요구하며 `launch.mjs`와 versioned 크기 manifest를 포함한다.
- Electron/Tauri/Node SEA의 설치, WebView, 서명과 업데이트 조건을 공식 문서로 비교해 초기에는
  브라우저 bundle을 채택했다. 전환 조건은 `docs/distribution-decision.md`에 기록했다.

## 검증

- 정적 편집기 제공, HEAD/cache/CSP/MIME header, same-origin API, 외부 Origin, symlink 탈출과 잘못된
  editor root를 Node 통합 테스트로 검증한다.
- CLI, 기존 instance lock과 port fallback 집중 테스트를 함께 실행한다.
- macOS arm64 artifact를 실제 생성하고 `node launch.mjs --help`를 실행했다. 측정 payload는 editor
  1,483,478 bytes, runner 89,948 bytes, Codex 324,585,127 bytes, 합계 326,158,553 bytes다.
- `npm run smoke:browser-distribution`: 실제 artifact에서 Codex App Server 0.146.0, bundled-static
  편집기, 인증 API를 확인하고 headless Chromium이 CSP 아래 `연결됨`까지 도달하는지 검증했다. 종료
  후 project lock을 확인하며 session token은 출력하지 않는다.
- `npm test -- --run`: 49 files, 373 tests passed.
- `npm run typecheck`, `npm run lint`, `npm run build:browser-distribution`: passed. Production build의
  E2E bridge 제외 검사도 통과했고 500 kB 초과 chunk 경고만 남았다.
- `npm run test:e2e:preview`: Chromium 76 tests passed.
- S35 변경 파일의 Prettier 검사와 `git diff --check`: passed. 저장소 전체 `format:check`는 이번 작업
  전부터 포맷이 다른 `docs/architecture.md`, `docs/product-brief.md`만 보고한다.

## 다음 단계

- S36에서 generation thumbnail과 전체 해상도 이미지·읽기 전용 3D preview의 브라우저/GPU 자원
  수명주기를 구현하고 많은 generation에서의 메모리 상한을 검증한다.
