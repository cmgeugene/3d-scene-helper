# Local Companion 배포 결정

> 결정일: 2026-08-04 · 구현 기준: S35

## 결정

초기 내부 배포는 **platform별 Codex 포함 브라우저 bundle**을 사용한다. production React
편집기, bundle된 Companion runner와 현재 platform용 Codex package를 한 디렉터리에 넣고 지원
Node.js에서 `node launch.mjs --project-root <absolute-path>`로 실행한다. Electron/Tauri desktop
shell은 지금 도입하지 않는다.

이 결정은 영구 배제가 아니다. 외부 사용자 설치, native project picker, 코드 서명 installer와
자동 업데이트가 출시 조건이 되면 아래 전환 기준으로 desktop shell을 다시 선택한다.

## S35 측정 기준선

2026-08-04의 macOS arm64 artifact 측정값은 다음과 같다. 값은
`.artifacts/browser-distribution/darwin-arm64/distribution-manifest.json`에서 생성했으며 build
artifact 자체는 Git에 저장하지 않는다.

| payload           | bytes       | 설명                                      |
| ----------------- | ----------- | ----------------------------------------- |
| production editor | 1,483,478   | HTML, CSS와 Vite JavaScript chunks        |
| Companion runner  | 89,948      | minified Node.js ESM bundle               |
| Codex packages    | 324,585,127 | wrapper와 macOS arm64 native 실행 파일    |
| 합계              | 326,158,553 | Node runtime과 installer container는 제외 |

현재 크기의 거의 전부는 어느 shell에서도 필요한 Codex native payload다. 브라우저 bundle은 Chromium을
추가로 포함하지 않는다.

## 후보 비교

| 기준                | 브라우저 bundle — 채택                             | Electron                                     | Tauri                                           |
| ------------------- | -------------------------------------------------- | -------------------------------------------- | ----------------------------------------------- |
| 렌더링              | 사용자의 Chromium, 현재 E2E 기준과 동일            | Chromium을 내장해 platform 간 엔진이 일정    | OS WebView를 사용해 작지만 엔진 차이 검증 필요  |
| 추가 runtime        | 지원 Node.js 필요, Codex를 artifact에 포함         | Chromium과 Node.js를 app에 포함              | Rust native shell과 OS WebView, Codex 연결 필요 |
| project 선택        | 명시적 `--project-root`; 내부 사용자에게 충분      | native dialog 구현 가능                      | dialog plugin 구현 가능                         |
| App Server 수명주기 | 검증된 Companion이 직접 소유                       | main/utility process로 이관 작업 필요        | Rust command 또는 sidecar 재설계 필요           |
| 업데이트            | versioned artifact 교체; 자동 업데이트 없음        | macOS/Windows updater 제공, Linux 별도 경로  | 서명된 updater plugin과 endpoint 구성 가능      |
| 코드 서명           | 현재 없음; 외부 배포 전 archive/launcher 서명 필요 | Windows/macOS 배포에 서명·macOS notarization | 대부분 platform에서 bundle 서명 필요            |
| 현재 도입 비용      | 정적 호스팅·bundle build만 추가                    | 새 main/preload 보안 경계와 Forge pipeline   | Rust toolchain, 권한 설정과 WebGL 회귀 검증     |

Electron은 Chromium과 Node.js를 함께 제공하고 배포에는 Electron Forge 같은 별도 packaging 도구가
권장된다. macOS/Windows의 일반 배포는 코드 서명이 중요하고 macOS 자동 업데이트는 서명된 앱을
요구한다. Linux는 Electron 내장 auto updater 대상이 아니다.

- <https://www.electronjs.org/docs/latest/tutorial/tutorial-prerequisites>
- <https://www.electronjs.org/docs/latest/tutorial/application-distribution>
- <https://www.electronjs.org/docs/latest/tutorial/code-signing>
- <https://www.electronjs.org/docs/latest/api/auto-updater/>

Tauri는 system WebView를 재사용해 최소 bundle이 작지만 Rust와 platform build dependency가
필요하다. Windows는 WebView2, Linux는 WebKitGTK 계열을 사용하므로 현재 Chromium E2E만으로는
동일한 WebGL 동작을 보장할 수 없다. updater는 signature가 포함된 metadata를 요구한다.

- <https://v2.tauri.app/start/>
- <https://v2.tauri.app/start/prerequisites/>
- <https://v2.tauri.app/distribute/>
- <https://v2.tauri.app/plugin/updater/>

Node single executable은 Node가 없는 환경의 후보지만 현재 공식 문서에서 active development
상태이고 지원 platform 제약이 있다. 또한 Codex native package와 편집기 asset을 함께 다루는 서명
pipeline은 별도로 필요하므로 S35 artifact에는 적용하지 않는다.

- <https://nodejs.org/api/single-executable-applications.html>

## 구현된 배포 경계

- `npm run build:browser-distribution`은 production build 뒤 현재 platform용 artifact를
  `.artifacts/browser-distribution/<platform>-<arch>/`에 만든다.
- artifact의 `launch.mjs`는 포함된 `editor/`를 자동 선택하고 Companion은 정적 편집기와 인증 API를
  같은 `127.0.0.1` origin에서 제공한다.
- HTML은 `no-store`, hashed asset은 immutable cache를 사용한다. CSP, MIME `nosniff`, frame 차단과
  referrer 차단 header를 적용한다.
- 정적 파일 resolver는 배포 루트 밖 경로와 바깥을 가리키는 symlink를 제공하지 않는다. API는
  기존 Bearer session token을 계속 요구하고 외부 Origin을 거부한다.
- artifact는 해당 platform의 Codex package, 지원 Node range와 payload별 byte 크기를 version 1
  manifest에 기록한다.

## desktop shell 재평가 조건

다음 중 하나가 제품 요구사항이 되면 별도 ADR과 prototype으로 다시 평가한다.

1. 비개발 사용자가 terminal이나 Node 설치 없이 서명된 installer로 설치해야 한다.
2. native project picker, recent-project launcher, file association이 필수다.
3. 자동 업데이트와 rollback이 필수다.
4. 지원 브라우저 차이로 WebGL·다운로드 기능의 재현성이 유지되지 않는다.
5. OS sandbox, app store 또는 enterprise 배포 정책이 browser bundle을 허용하지 않는다.

동일 Chromium 재현성이 최우선이면 Electron을 먼저 검증한다. installer 크기와 OS 통합이 더
중요하고 WebKit/WebView2 회귀 테스트를 운영할 수 있으면 Tauri를 먼저 검증한다.
