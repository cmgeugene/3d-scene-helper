# I2V 3D Scene Helper

I2V 시작 프레임을 빠르게 구성하는 로컬 우선 React/TypeScript/Vite 3D 편집기입니다. 기본 바닥·1.7m 마네킹·OutputCamera가 있는 starter scene에서 primitive와 천장·앞·오른쪽이 열린 코너형 방 세트, 카메라/조명 preset, 구도·motion guide를 설정하고 clean/reference PNG 또는 scene JSON을 내보낼 수 있습니다.

AI Scene Assistant의 현재 구현 상태와 앞으로의 우선순위는
[`docs/roadmap.md`](docs/roadmap.md)에서 관리합니다. 전체 설계 배경과 데이터 계약은
[`docs/ai-scene-assistant.md`](docs/ai-scene-assistant.md), 완료된 세션별 검증 기록은
[`docs/session-handoffs/`](docs/session-handoffs/)를 참고하세요.

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

### Local Companion 기술 스파이크

AI Scene Assistant의 첫 단계로, 공식 Codex 런타임을 stdio App Server로 실행하는 로컬 Companion과 브라우저 연결 상태 패널이 포함되어 있습니다.

로그인 상태와 App Server 초기화를 실제 환경에서 확인하려면 다음을 실행합니다.

```bash
npm run companion:smoke
```

인증된 loopback API와 이벤트 스트림을 포함한 Companion을 실행하려면 다음을 사용합니다.

```bash
npm run dev
```

별도 터미널에서 다음을 실행합니다.

```bash
npm run dev:companion -- --project-root .
```

준비 메시지의 `launchUrl`을 브라우저에서 열면 연결 정보가 앱으로 한 번 전달되고 우측 Scene Assistant 패널에 Codex 계정과 연결 상태가 표시됩니다. Vite 주소가 기본값인 `http://127.0.0.1:5173`과 다르면 `--editor-url http://127.0.0.1:<port>`를 함께 지정합니다. 연결 정보는 URL fragment에서 즉시 제거되고 현재 탭의 `sessionStorage`에만 보관됩니다.

연결 후 Scene Assistant 입력창에 장면 설명이나 질문을 보내면 현재 `SceneDocument` 스냅샷을 함께 전달해 새 Codex task를 시작합니다. 응답은 이벤트 스트림으로 표시되며 진행 중에는 중단할 수 있습니다. 같은 탭을 새로고침하면 보관된 thread ID를 다음 메시지에서 재개하고, `새 대화`를 누르면 새 task를 시작합니다. 대화 요약과 thread ID를 프로젝트 파일에 영구 저장하는 기능은 후속 단계입니다.

화면 아래 References 트레이에서는 PNG, JPEG, WebP 이미지를 `Layout`, `Background`, `Character`, `Style` 역할로 가져올 수 있습니다. 파일은 25MB 이하만 허용하며 실제 이미지 시그니처를 검사합니다. 원본은 프로젝트의 `assets/references/`에 복사되고, 안정적인 ID·SHA-256 해시·크기·역할은 프로젝트 루트의 `references.json`에 기록됩니다. 트레이에는 썸네일과 메타데이터가 표시되며 생성에 사용할 레퍼런스를 선택할 수 있습니다. 각 카드의 `설정`에서 캐릭터 레퍼런스를 장면의 마네킹에 연결하고, 쉼표로 구분한 사용 범위와 제외 범위를 저장할 수 있습니다.

선택 상태와 매핑도 manifest에 영속화됩니다. Scene Assistant에 메시지를 보낼 때 선택된 레퍼런스의 역할·사용 범위·연결 대상이 prompt에 포함되고, 이미지는 `Layout → Background → Character → Style` 순서로 Codex turn에 첨부됩니다.

WebGL 뷰포트가 준비된 상태에서는 Scene Assistant에 연출 지시를 입력하고 `이미지 생성`을 누를 수 있습니다. 앱이 현재 OutputCamera를 reference PNG로 캡처해 첫 번째 첨부로 고정하고, 선택한 레퍼런스를 역할 순서대로 뒤에 붙여 Codex의 내장 `$imagegen`을 실행합니다. 진행 상태와 완료 이미지는 패널에 표시됩니다. 구도 캡처는 `assets/scene-renders/`, 생성 결과는 `assets/generations/`에 복사되며 요청·첨부·해시·상태는 `generations.json`에 기록됩니다. 실제 생성은 Codex 사용량을 소비하므로 자동 테스트에서는 모의 App Server 이벤트만 사용합니다.

새 generation record에는 생성 당시의 전체 SceneDocument와 서버가 확인한 레퍼런스 메타데이터가 불변 스냅샷으로 저장됩니다. 부모 generation ID, 계보상의 버전 번호, 피드백과 `fresh/edit` 생성 방식도 함께 기록합니다. 기본 생성은 3D 레이아웃 1장과 레퍼런스 최대 4장을 사용합니다. 완료 결과에서 `이 결과를 기반으로 보정`을 선택하면 기존 키프레임, 현재 3D 레이아웃과 레퍼런스 최대 3장을 입력으로 사용하는 `edit` 자식 generation을 만듭니다. 같은 보정 모드에서 다시 생성하면 직전 파생본이 아니라 선택한 원본 generation에서 형제 버전을 만듭니다. 스냅샷 필드가 없던 기존 기록은 계속 열 수 있지만 `sceneSnapshot: null`로 표시되어 향후 3D 복원이 제한됩니다.

생성 전에 앱은 현재 장면에서 `LayoutSpec`을 결정적으로 계산합니다. 이 명세에는 출력 카메라, 각 오브젝트의 정규화 화면 바운드와 점유율, 카메라 깊이, 전경·중경·배경 분류, 마네킹 포즈와 카메라 상대 방향, 연결된 외형 레퍼런스와 잠재 가림 관계가 포함됩니다. Scene Assistant의 `3D → 키프레임 변환 계약`에서 요약을 확인할 수 있습니다. 생성 prompt는 3D 레이아웃이 카메라·크롭·배치·포즈·깊이·가림의 기준이고 프록시 색·재질·외형은 역할별 레퍼런스와 사용자 설명으로 교체된다는 규칙을 명시합니다. 사용된 전체 LayoutSpec은 해당 generation record에 함께 저장됩니다.

씬 목록에서 오브젝트를 선택하면 우측 `씬` 속성에서 이름을 바꾸고 `이미지 생성 의미`를 입력할 수 있습니다. 이름은 아웃라이너와 캐릭터 레퍼런스 연결 대상에 즉시 반영됩니다. `실제 의미`에는 `빨간 원형 포차 테이블`, `아웃포커스된 전봇대`처럼 최종 이미지의 사물명을, `생성 메모`에는 재질·초점·교체 규칙처럼 해당 오브젝트에만 적용할 지시를 적습니다. 이 값은 SceneDocument에 저장되고 생성 시 LayoutSpec의 `semanticMeaning`, `generationNotes`로 전달되며 프리미티브 이름과 가이드 색보다 우선합니다.

우측 속성·Scene Assistant 도크는 경계선을 드래그해 `320px`부터 화면 너비의 `45%`까지 조절할 수 있습니다. 경계선에 키보드 포커스를 두고 좌우 화살표로도 조절할 수 있으며 `넓게`, `접기` 버튼을 제공합니다. 마지막 폭과 접힘 상태는 브라우저에 저장됩니다. Companion 연결 후 Scene Assistant는 `대화`와 `변환 계약` 탭으로 분리되며, 계약 상세는 기본적으로 접혀 있고 대화 입력창은 패널 아래쪽에 고정됩니다. 입력창에서는 `Enter`로 전송하고 `Shift+Enter`로 줄을 바꿉니다.

Companion은 `127.0.0.1`에만 바인딩하고 실행 시 세션 토큰을 생성합니다. 일반 Codex 설치 경로나 로그인 캐시를 직접 읽지 않으며, 프로젝트의 `assets/` 내부 상대 경로만 이미지 입력으로 전달합니다. 현재 API는 런타임 상태와 imagegen capability, thread 시작·재개, turn 시작·취소, 레퍼런스 가져오기·목록·설정 갱신·콘텐츠 조회, 구도 렌더 업로드, 생성 시작·목록·결과 조회와 SSE 이벤트를 제공합니다.

## 3분 starter scene 흐름

1. 데스크톱 Chromium에서 앱을 열고 기본 scene의 바닥과 마네킹을 확인합니다.
2. 필요하면 cube, sphere, cylinder, plane, mannequin 또는 코너형 방 세트를 추가하고 inspector나 transform gizmo로 배치합니다. 방 세트는 바닥·뒤쪽 벽·왼쪽 벽으로 구성되어 천장과 카메라 쪽 두 면이 열려 있습니다.
3. 씬 목록에서 프록시를 선택하고 의미 있는 이름, 최종 이미지의 `실제 의미`, 필요한 `생성 메모`를 입력합니다.
4. toolbar에서 `9:16`을 선택하고 thirds/safe-area/motion guide를 필요한 만큼 켭니다.
5. `카메라`에서 lens와 shot preset, `조명`에서 background/lighting preset을 선택합니다.
6. `로컬 저장`으로 현재 scene을 저장합니다. 자동 저장과 최근 장면 열기도 같은 validated scene document를 사용합니다.
7. `PNG 내보내기`에서 `세로 Full HD (1080×1920)`과 `깨끗한 프레임`을 선택해 start frame을 내려받습니다. Clean PNG에는 grid, axes, selection, gizmo, composition/motion guide가 포함되지 않습니다.

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
