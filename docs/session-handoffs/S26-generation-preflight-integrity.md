# S26 — Generation Preflight Integrity

## 세션

- 브랜치: `codex/conversational-scene-assistant`
- 작업 트리: `/Users/js/Documents/3d-scene-helper/.worktrees/codex-conversational-scene-assistant`
- 시작 HEAD: `497bb064ddfa3ab8d3729bfdb7e67eb3a3420156`
- 시작 divergence: `origin/codex/conversational-scene-assistant`보다 4 commits ahead
- 선행 uncommitted 범위: S24 structured specPatch와 S25 sceneCommands 수직 슬라이스
- 범위: P3의 reference·SceneDocument·LayoutSpec 무결성 검사, 생성 전 충돌 경고, 브라우저 확인과 Companion 재검증

## 구현 요약

### 공유 generation preflight evaluator

- 브라우저와 Companion이 같은 `evaluateGenerationPreflight`를 사용한다.
- 이미지 입력 예산 초과, 중복 또는 비활성 reference, scene/layout ID 불일치, LayoutSpec object 누락·중복·추가, 존재하지 않는 가림 object, 삭제된 target과 LayoutSpec에서 빠진 target은 blocking issue다.
- character reference의 pose 사용과 3D 포즈 권위 충돌, use/exclude 동일 범위, 여러 subject에 연결 대상이 없는 character reference, 25% 이상 주인공 가림은 warning issue다.
- 모든 issue는 재현 가능한 ID를 가지며 scene revision, spec revision, LayoutSpec과 reference metadata를 포함한 fingerprint로 확인 대상의 변경을 감지한다.

### Fail-closed 생성 흐름

- 브라우저는 레이아웃 캡처와 업로드 전에 live SceneDocument와 새 LayoutSpec을 검사한다. blocker가 있으면 draft를 보존하고 캡처도 시작하지 않는다.
- warning은 컴포저 안의 접근 가능한 카드에 표시하며 사용자가 명시적으로 확인해야 생성한다. 확인 사이에 scene이나 reference가 바뀌면 fingerprint가 달라져 다시 확인해야 한다.
- 생성 요청은 확인한 warning ID를 Companion으로 보내며 Companion은 저장소에서 다시 해석한 reference와 요청 스냅샷을 공유 evaluator로 재검증한다.
- UI 우회 요청도 blocker 또는 미확인 warning이 있으면 400으로 거부하고 imagegen turn을 시작하지 않는다.

### 끊어진 reference 복구 UI

- 삭제된 object를 가리키는 reference card에 무결성 경고를 표시한다.
- metadata 편집 select는 기존의 삭제된 target ID를 표시해 원인을 숨기지 않으며, 사용자는 `장면 전체 / 연결 안 함`을 선택해 연결을 복구할 수 있다.

## 실제 Chromium 증거

`e2e/semantic-scene-spec.spec.ts`의 1280×720 mock authenticated Companion 흐름을 확장했다.

1. 선택된 character reference가 실제 `starter-mannequin`에 연결된 상태로 로드된다.
2. editor store에서 마네킹을 삭제하면 reference card 경고와 생성 전 blocker가 표시되고 generation 요청과 레이아웃 캡처가 시작되지 않는다.
3. toolbar undo로 object를 복구하면 dangling 경고가 사라진다.
4. pose 권위 충돌은 warning card로 표시되고 확인 전에는 generation 요청이 없다.
5. 명시적 확인 뒤 요청에 안정적인 `pose-authority-conflict` ID가 포함된다.
6. 생성 snapshot과 prompt의 기존 Semantic Scene Spec 왕복 증거, 1280px overflow와 console/page error 검사를 유지한다.

## 검증 게이트

- focused preflight/reference/panel/client/server tests: 5 files, 42 tests passed
- `npm test -- --run`: 39 files, 325 tests passed
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run build`: passed; production E2E diagnostics absent assertion passed
- `npm run test:e2e:preview`: 70 passed
- 신규 reference delete·undo·warning acknowledge 1280×720 Chromium E2E: passed
- changed-file Prettier와 `git diff --check`: passed
- 전체 `npm run format:check`에는 이번 범위 밖 기존 `docs/architecture.md`, `docs/product-brief.md` formatting warning 2건이 남아 있다.
- 실제 imagegen 사용량은 소모하지 않았다.

## 의도적으로 제외한 항목

- reference target의 object 삭제 transaction 연동 또는 자동 해제 정책
- GPU ID pass나 mesh visibility 기반 정밀 가림 분석
- pose/가림 warning threshold 설정 UI와 모델별 입력 예산 설정
- object 생성·삭제·pose·camera를 바꾸는 추가 scene command
- 적용된 proposal에서 generation snapshot과 prompt까지 이어지는 P3 종료용 Chromium 증거
- 실제 imagegen 사용량 소비
- commit, main 병합, push와 원격 변경

## 다음 단계

S27은 적용된 specPatch와 sceneCommands가 직후 generation의 SceneDocument snapshot, LayoutSpec과 prompt에 동일하게 남는 실제 Chromium 왕복을 추가해 P3 완료 기준 4를 닫는다.
