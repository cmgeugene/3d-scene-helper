# I2V 3D Scene Helper

I2V 시작 프레임을 빠르게 구성하는 로컬 우선 React/TypeScript/Vite 3D 편집기입니다. 기본 바닥·1.7m 마네킹·OutputCamera가 있는 starter scene에서 primitive, 카메라/조명 preset, 구도·motion guide를 설정하고 clean/reference PNG 또는 scene JSON을 내보낼 수 있습니다.

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

## 3분 starter scene 흐름

1. 데스크톱 Chromium에서 앱을 열고 기본 scene의 바닥과 마네킹을 확인합니다.
2. 필요하면 cube, sphere, cylinder, plane 또는 mannequin을 추가하고 inspector나 transform gizmo로 배치합니다.
3. toolbar에서 `9:16`을 선택하고 thirds/safe-area/motion guide를 필요한 만큼 켭니다.
4. `카메라`에서 lens와 shot preset, `조명`에서 background/lighting preset을 선택합니다.
5. `로컬 저장`으로 현재 scene을 저장합니다. 자동 저장과 최근 장면 열기도 같은 validated scene document를 사용합니다.
6. `PNG 내보내기`에서 `세로 Full HD (1080×1920)`과 `깨끗한 프레임`을 선택해 start frame을 내려받습니다. Clean PNG에는 grid, axes, selection, gizmo, composition/motion guide가 포함되지 않습니다.

Scene JSON 가져오기는 schema/version을 검증합니다. malformed/unsupported 파일은 현재 scene과 기존 autosave를 변경하지 않고 오류를 상태 표시줄에 알립니다.

## 지원 범위와 제한

- Google Chrome/Chromium 계열의 WebGL 지원 데스크톱 브라우저를 기준으로 검증합니다.
- 기본 편집 화면은 최소 `1280×720`을 요구합니다. 그보다 작은 화면에는 데스크톱 화면 안내를 표시합니다.
- 모바일 touch 편집, cloud 저장/협업, arbitrary 3D asset import, animation timeline, physics 및 AI 생성 API는 MVP 범위가 아닙니다.
- WebGL을 사용할 수 없거나 context가 손실되면 serialized scene과 JSON/local persistence는 보존하지만 3D preview와 PNG export는 사용할 수 없습니다. 안내에 따라 페이지를 새로고침해 WebGL을 복구하세요.

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

앱은 DOM에 임시 `canvas`를 만들고 WebGL2, WebGL 순으로 컨텍스트 생성을 시도합니다. 성공하면 lazy-loaded React Three Fiber viewport와 editor를 표시합니다. 실패나 예외가 발생하면 명시적인 fallback 안내를 표시하고 probe 자원을 정리합니다. Viewport render error와 `webglcontextlost`는 편집기 shell 및 serialized scene을 유지한 채 복구 안내를 표시하며, 손실 상태에서는 PNG export를 비활성화합니다. JSON export와 로컬 scene 데이터는 계속 사용할 수 있습니다.

일반 `npm run dev`와 `npm run preview`는 브라우저의 기본 설정을 따르므로 보통 하드웨어 WebGL을 사용합니다. 반면 unit test의 jsdom 환경은 canvas context를 `null`로 고정해 fallback UI 경로를 재현합니다. 로컬과 CI의 Playwright Chromium project는 동일한 `--use-angle=swiftshader`, `--use-gl=angle`, `--enable-webgl`, `--enable-unsafe-swiftshader` 플래그를 사용해 하드웨어 GPU 대신 SwiftShader 경로를 재현 가능하게 검사합니다. Smoke/golden-path tests는 configured Chromium에서 반드시 `available` 상태와 성공 문구를 요구하고, viewport/context-loss tests는 serialized scene 보존과 명시적인 fallback UI를 검증합니다.

`npm run typecheck`는 root project reference를 통해 앱 소스뿐 아니라 `vite.config.ts`, `playwright.config.ts`, `e2e/**/*.ts`도 함께 검사합니다.
