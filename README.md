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

개발 편집기와 AI Scene Assistant용 Local Companion을 한 번에 시작하려면 다음을 사용합니다.

```bash
npm run dev:all
```

기본 프로젝트 루트는 명령을 실행한 현재 디렉터리입니다. Companion이 준비되면
`http://127.0.0.1:5173`을 연 탭이 자동으로 연결됩니다. 기본 브라우저도 열리지만
그 탭의 launchUrl을 쓰지 않아도 됩니다. 다른 프로젝트를 사용하거나 브라우저 자동
실행을 끄려면 Companion 옵션을 그대로 전달합니다.

```bash
npm run dev:all -- --project-root /absolute/path/to/project --no-open
```

5173 포트를 다른 개발 서버가 사용 중이면 `--editor-port <port>`로 `dev:all`의 Vite 포트를
바꿀 수 있습니다.

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

Companion은 준비가 끝나면 개발 편집기가 같은 컴퓨터에서 자동으로 찾을 수 있게 루프백 세션을
남기고, 기본 브라우저로 편집기를 엽니다. Vite 주소가 기본값인 `http://127.0.0.1:5173`과
다르면 `--editor-url http://127.0.0.1:<port>`를 함께 지정합니다. 브라우저를 열지 않으려면
`--no-open`을 사용하고 그 주소만 직접 열면 됩니다. 지정 포트가 이미 사용 중이면 임의의 빈
포트로 한 번 전환하며, 고정 포트가 반드시 필요하면 `--strict-port`를 추가합니다. 연결 정보는
탭의 `sessionStorage`에 보관됩니다.

이미지 생성 기본 경로는 내장 `openai-oauth` 프록시입니다. Companion이 Codex 로그인
상태를 사용하는 로컬 프록시를 켠 뒤, Assistant에서 Responses 모델과 image quality를 고를 수
있습니다. OAuth 생성 전에 Codex App Server가 격리된 planning-only turn에서 실제 설치된
`$imagegen` 스킬과 prompt-shaping 참조를 로드합니다. 이 turn은 현재
SceneDocument·OutputCamera·LayoutSpec·레퍼런스 역할과 마지막으로 완료된 Companion 대화 의도로
이미지 도구에 보낼 최종 영어 prompt를 작성할 뿐 이미지를 생성하지 않습니다. compiler thread는
ephemeral·read-only·approval-never로 열고 passive item만 허용합니다. 다른 tool item이나 server
request가 나타나면 turn 중단까지 기다린 뒤 fail-closed 처리합니다. 그 스킬 산출물 전체와 이미지
입력을 선택한 Responses 모델의 `image_generation` 호출에 그대로 전달합니다.
새 generation은 이 prompt와 함께 `promptCompiler: codex-imagegen-skill` provenance를 저장합니다.
호환 필드 `generationSpec`만 있고 discriminator가 없는 기존 기록은 실제 installed-skill 출력으로
간주하지 않고 UI에서 출처 미확인 구형 spec으로 표시합니다.
Codex가 이미지까지 직접 생성하게 하려면 `--image-provider codex`를 씁니다.
`openai-oauth`는 비공식 AGPL 패키지이며 ChatGPT/Codex 쿼터를 사용합니다.

프로젝트마다 하나의 Companion만 실행할 수 있습니다. 실행 중인 프로젝트를 다시 시작하면 중복 실행을 거부하고, 비정상 종료로 남은 lock은 자동 복구합니다. `SIGINT`나 `SIGTERM`으로 종료하면 HTTP 서버, App Server와 lock을 함께 정리합니다.

개발 서버 없이 production 편집기와 Companion을 같은 loopback origin에서 실행하려면 다음을
사용합니다.

```bash
npm run build
npm run start:browser -- --project-root /absolute/path/to/project
```

현재 운영체제·CPU용 Codex 실행 파일까지 포함한 내부 배포 artifact는 다음 명령으로 만듭니다.

```bash
npm run build:browser-distribution
node .artifacts/browser-distribution/<platform>-<arch>/launch.mjs \
  --project-root /absolute/path/to/project
```

artifact는 Node.js를 요구하지만 별도 Vite 개발 서버나 `npm install`은 요구하지 않습니다. 현재
platform 전용으로 생성되며 `distribution-manifest.json`에 편집기, runner와 Codex payload 크기를
기록합니다. 외부 사용자용 installer, 코드 서명과 자동 업데이트는 아직 포함하지 않습니다.

연결 후 Scene Assistant 입력창에 장면 설명이나 질문을 보내면 현재 `SceneDocument` 스냅샷을 함께 전달해 Codex task를 시작하거나 저장된 task를 재개합니다. 응답은 이벤트 스트림으로 표시되며 진행 중에는 중단할 수 있습니다. task ID와 제한된 대화 요약은 프로젝트의 `conversations.json`에 저장되고, 프로젝트를 다시 열면 저장 task 재개 또는 새 task 시작을 명시적으로 선택합니다. 연결이 끊기면 0.5초, 1초, 2초 간격으로 최대 3회 상태를 다시 조회합니다. 이 과정에서 turn을 자동 재전송하지 않으며, 복구 후 다음 사용자 동작이 저장 thread를 이어 갑니다.

화면 아래 References 트레이에서는 PNG, JPEG, WebP 이미지를 `Layout`, `Background`, `Character`, `Style` 역할로 가져올 수 있습니다. 파일은 25MB 이하만 허용하며 실제 이미지 시그니처를 검사합니다. 원본은 프로젝트의 `assets/references/`에 복사되고, 안정적인 ID·SHA-256 해시·크기·역할은 프로젝트 루트의 `references.json`에 기록됩니다. 트레이에는 썸네일과 메타데이터가 표시되며 생성에 사용할 레퍼런스를 선택할 수 있습니다. 각 카드의 `설정`에서 캐릭터 레퍼런스를 장면의 마네킹에 연결하고, 쉼표로 구분한 사용 범위와 제외 범위를 저장할 수 있습니다.

선택 상태와 매핑도 manifest에 영속화됩니다. Scene Assistant에 메시지를 보낼 때 선택된 레퍼런스의 역할·사용 범위·연결 대상이 prompt에 포함되고, 이미지는 `Layout → Background → Character → Style` 순서로 Codex turn에 첨부됩니다.

WebGL 뷰포트가 준비된 상태에서는 Scene Assistant에 연출 지시를 입력하고 `이미지 생성`을 누를 수 있습니다. 앱이 현재 OutputCamera를 reference PNG로 캡처해 첫 번째 첨부로 고정하고, 선택한 레퍼런스를 역할 순서대로 뒤에 붙입니다. 기본 OAuth 경로에서는 실제 Codex `$imagegen` 스킬이 이미지 역할·권위, primary request, style/integration과 strict invariants를 포함한 최종 전달 prompt를 먼저 작성합니다. 선택한 Responses 모델은 그 prompt 자체와 같은 이미지 입력을 받아 선택한 quality로 `image_generation`을 실행합니다. prompt compiler는 모든 ordered `Image 1…N` 역할 바인딩을 검증하며, passive item 외의 도구나 승인 요청을 시도하면 중단 완료를 확인하고 생성 요청을 실패 처리합니다. 마지막으로 정상 완료된 Companion 대화 교환은 revision이 있는 generation intent로 자동 승격되며, 실패·중단 turn이나 원시 transcript 전체는 전달하지 않습니다. 진행 상태와 완료 이미지는 패널에 표시됩니다. 구도 캡처는 `assets/scene-renders/`, 생성 결과는 `assets/generations/`에 복사되며 요청·첨부·해시·provider·모델·quality·reasoning·원본 prompt·imagegen 스킬 최종 전달 prompt(`generationSpec`, 호환 필드명)·도구 revised prompt·반영된 대화 의도는 `generations.json`에 구분해 기록됩니다. 실제 생성은 ChatGPT/Codex 사용량을 소비하므로 자동 테스트에서는 모의 OAuth/Responses 또는 App Server 이벤트만 사용합니다.

Codex 이미지 생성이 오래 걸리거나 현재 런타임에서 지원되지 않으면 같은 입력창의 `웹으로 내보내기`를 사용할 수 있습니다. 모달은 현재 장면·LayoutSpec·Semantic Scene Spec·선택 레퍼런스와 보정 지시를 GPT 웹용 프롬프트로 조립하고, 사용자가 맞춰야 할 이미지 첨부 순서를 함께 보여 줍니다. `프롬프트 복사` 후 GPT 웹에 직접 붙여 넣어 생성하며, 이 수동 결과는 프로젝트의 `generations.json`이나 생성 이력에 자동 등록되지 않습니다.

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
