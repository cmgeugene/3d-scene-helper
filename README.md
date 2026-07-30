# I2V 3D Scene Helper

브라우저가 I2V 3D Scene Helper를 실행할 수 있는지 확인하는 최소 React/TypeScript/Vite 앱입니다. 현재 S01은 앱 셸과 품질 게이트만 제공하며, 3D 장면 상태나 편집 기능은 구현하지 않습니다.

## 요구 환경

- Node.js: `^22.13.0 || ^24.0.0 || >=25.8.1 <26`
- npm: `>=10`

직접·전이 개발 의존성까지 공통으로 만족하는 Node 22.13+와 24 LTS 계열을 지원하며, 현재 개발 머신의 Node 25.8.1 이상도 26 미만에서 검증합니다. 지원하지 않은 미래 Node를 무제한으로 가정하지 않도록 26 미만으로 상한을 둡니다. 재현 가능한 설치에는 커밋된 `package-lock.json`과 `npm ci`를 사용하세요.

## 설치와 실행

```bash
npm install
npm run dev
```

잠금 파일 그대로 다시 설치하려면 다음을 사용합니다.

```bash
npm ci
```

## 검증 명령

```bash
npm run typecheck
npm run lint
npm run test -- --run
npm run test:watch
npm run build
npm run test:e2e
npm run test:e2e:preview
npm run format:check
```

- `npm run test:e2e`는 Playwright 설정이 고정 포트 `127.0.0.1:4173`에 Vite 개발 서버를 직접 띄우고 Chromium smoke test를 실행합니다. 이미 떠 있는 서버는 재사용하지 않습니다.
- `npm run test:e2e:preview`는 먼저 고정 포트가 비어 있는지 검사하고 production build를 만든 뒤 `start-server-and-test`가 소유한 Vite production preview만 대상으로 별도 external-server Playwright 실행을 시작합니다. preview 응답의 `X-I2V-Preview: production` marker도 검증하며, 기존 dev/stale 서버가 있으면 nonzero로 실패합니다. 성공 또는 실패 후 소유한 preview 서버를 정리합니다.
- Chromium이 설치되지 않았다면 `npx playwright install chromium`을 한 번 실행하세요.

## WebGL 전략

앱은 DOM에 임시 `canvas`를 만들고 WebGL2, WebGL 순으로 컨텍스트 생성을 시도합니다. 성공하면 `WebGL을 사용할 수 있습니다.`를, 실패나 예외가 발생하면 명시적인 fallback 안내를 상태 영역에 표시하고 probe 자원을 정리합니다. 실제 R3F Canvas나 3D 편집기는 만들지 않습니다.

일반 `npm run dev`와 `npm run preview`는 브라우저의 기본 설정을 따르므로 보통 하드웨어 WebGL을 사용합니다. 반면 unit test의 jsdom 환경은 canvas context를 `null`로 고정해 fallback UI 경로를 재현합니다. 로컬과 CI의 Playwright Chromium project는 동일한 `--use-angle=swiftshader`, `--use-gl=angle`, `--enable-webgl`, `--enable-unsafe-swiftshader` 플래그를 사용해 하드웨어 GPU 대신 SwiftShader 경로를 재현 가능하게 검사합니다. smoke test는 configured Chromium에서 반드시 `available` 상태와 성공 문구를 요구합니다. `fallback`, `checking`, 누락되거나 알 수 없는 상태는 상태·문구·launch strategy를 포함한 진단 오류로 실패합니다.

`npm run typecheck`는 root project reference를 통해 앱 소스뿐 아니라 `vite.config.ts`, `playwright.config.ts`, `e2e/**/*.ts`도 함께 검사합니다.
