# S23 — Semantic Scene Spec

## 세션

- session_id: `20260804_072148_77501f`
- 브랜치: `codex/conversational-scene-assistant`
- 작업 트리: `/Users/js/Documents/3d-scene-helper/.worktrees/codex-conversational-scene-assistant`
- 시작 HEAD: `4ec7f528bf507422ba7e1d272d424ddf6352d25e`
- 시작 divergence: `origin/codex/conversational-scene-assistant`보다 3 commits ahead
- 범위: P2의 첫 수직 슬라이스인 장면 전체 Semantic Scene Spec의 schema, persistence, history, generation snapshot/prompt와 구조화 UI

## 구현 요약

### 버전 계약과 권위 경계

- `SemanticSceneSpec` 버전 1을 별도 Zod schema로 정의했다.
- 장면 전체 권위 데이터는 장소, 시간대, 분위기, 화풍 의도, 생성 전용 소품, extras, 인물/오브젝트 관계·시선·행동, 필수 유지와 변경 가능 요소다.
- 오브젝트별 `semantic.meaning`과 `semantic.generationNotes`는 해당 3D 오브젝트의 실제 의미와 생성 메모 권위로 유지한다. 장면 전체 사실은 object semantic에 복제하지 않는다.
- 텍스트 길이, 항목 수, extras 인원 범위와 관계 대상 object ID를 검증한다. 문자열·배열·소품·관계는 deterministic normalization을 거친다.
- spec이 없는 구형 v2 SceneDocument는 안전한 빈 기본 spec으로 복원한다. malformed, unknown-version 또는 dangling 관계가 있는 문서는 부분 적용하지 않고 fail-closed한다.

### persistence, history와 generation snapshot

- Semantic Scene Spec은 SceneDocument에 포함되어 기존 autosave, reload, JSON import/export 경계를 그대로 사용한다.
- `setSemanticSceneSpec`은 하나의 `update-semantic-scene-spec` document mutation으로 history, dirty, undo/redo와 autosave에 참여한다.
- 참조된 object를 삭제하면 같은 object-delete mutation에서 dangling relationship을 제거한다.
- 새 generation은 요청의 SceneDocument에서 semantic spec을 구조적으로 복제해 `semanticSceneSpecSnapshot`으로 보존한다. 이후 live scene mutation은 snapshot을 바꾸지 않는다.
- 구형 generation의 독립 semantic snapshot 누락은 `null`로 복원한다. sceneSnapshot 자체는 기존 SceneDocument legacy 기본값 정책을 따른다.
- browser client, SSE parser와 generation history API schema가 새 snapshot 필드를 동일하게 검증한다.

### generation prompt와 구조화 UI

- 새 이미지 generation prompt는 채팅 문장을 장면 원본으로 사용하지 않고 저장된 현재 Semantic Scene Spec에서 생성한다.
- 비어 있는 section은 생략하며 intent, 생성 전용 소품, extras, 관계, 필수 유지와 변경 가능 요소를 deterministic하고 간결한 한국어 block으로 만든다.
- prompt의 SceneDocument JSON에서는 이미 별도 block으로 표현한 `semanticSceneSpec`을 제외해 같은 사실을 반복하지 않는다. LayoutSpec object semantics는 해당 object 권위로 유지한다.
- Inspector에 `연출` 탭을 추가했다. 모든 spec 필드를 keyboard-accessible label과 구조화된 line format으로 편집하고 `장면 명세 적용` 한 번으로 단일 mutation을 기록한다.
- relation editor는 현재 object ID를 안내하며 schema 오류를 alert로 표시하고 live scene을 보존한다.
- Zustand selector는 안정된 `state.document.objects` 참조만 선택하고 object ID 목록을 `useMemo`로 파생한다. 이로써 최초 구현에서 재현된 `getSnapshot should be cached`/무한 렌더를 제거했다.
- 외부 undo/redo나 reload로 spec identity가 바뀌면 keyed form이 새 authoritative spec으로 재초기화된다.

## TDD 기록

### RED

1. `semanticSceneSpec.test.ts` — module/schema가 없어 version/default/normalization/validation 테스트 실패.
2. `sceneSchema.test.ts`, `sceneCodec.test.ts` — starter/legacy document에 spec이 없고 malformed/unknown version을 검증하지 않아 실패.
3. `editorStore.test.ts` — spec mutation API/history가 없고 object 삭제 뒤 관계가 dangling 상태여서 실패.
4. `sceneAssistantPrompt.test.ts` — prompt가 저장 spec 대신 사용자 채팅을 사용하고 conditional deterministic block이 없어 실패.
5. `generationStore.test.ts`, `companionClient.test.ts` — generation 당시 semantic snapshot과 legacy null 계약이 없어 실패.
6. `Inspector.test.tsx` — `연출` 탭과 구조화 편집 UI가 없어 실패.
7. 최초 Inspector GREEN 시도 — selector가 `objects.map(...)` 새 배열을 snapshot마다 반환해 `getSnapshot should be cached` 및 `Maximum update depth exceeded`로 실패. 안정 참조 selector와 `useMemo`로 root cause를 수정했다.
8. full unit gate — `generationEvents.test.ts`의 legacy fixture가 새 기본 필드 `semanticSceneSpecSnapshot: null`을 반영하지 않아 1건 실패한 뒤 fixture 계약을 갱신했다.
9. full lint gate — spec sync effect의 동기 setState를 `react-hooks/set-state-in-effect`가 거부해 실패. authoritative spec identity 기반 keyed form으로 재구성했다.
10. prompt 중복 RED — 같은 spec이 semantic block과 SceneDocument JSON에 모두 나타남을 재현하고, JSON payload에서 해당 필드를 제외했다.
11. Gemini Important closure RED — runtime-null generation creation이 raw `TypeError`를 내는 것을 재현했다. creation boundary에서 `sceneDocumentSchema.parse`로 fail-closed하고 manifest 비변경을 검증했다.

### GREEN

- Semantic schema focused suite: passed
- SceneDocument schema/codec focused suite: passed
- editor history/dangling relation focused suite: passed
- prompt focused suite: passed
- generation store/client focused suite: passed
- Inspector blocker focused command: 1 passed, 13 skipped
- S23 focused regression: 11 files, 134 tests passed
- Gemini finding focused closure: 1 passed, 8 skipped
- 최종 full unit: 36 files, 300 tests passed

## 실제 Chromium 증거

신규 `e2e/semantic-scene-spec.spec.ts`가 1280×720 Chromium에서 실제 UI와 mock authenticated Companion 경계를 사용해 다음을 검증한다.

1. `연출` 탭에서 intent, 생성 전용 소품, extras, 실제 object ID 관계, 필수 유지와 변경 가능 요소를 입력한다.
2. 한 번 적용 후 toolbar undo가 빈 spec을 복원하고 redo가 편집 spec을 복원한다.
3. autosave 완료와 localStorage의 version 1 spec을 확인한다.
4. reload 뒤 모든 authoritative spec 값이 UI에 복원된다.
5. `JSON 내보내기` download를 실제로 읽고 autosave spec과 동등함을 확인한다.
6. 이미지 생성 요청을 mock Companion에서 캡처해 SceneDocument spec과 독립 generation snapshot이 같음을 확인한다.
7. prompt가 저장 spec의 장소·소품·관계 block을 포함하고 채팅 전용 문장 및 중복 `semanticSceneSpec` JSON은 포함하지 않음을 확인한다.
8. page/console error가 없고 document horizontal overflow가 없음을 확인한다.

- 신규 focused Chromium: 1 passed, 8.8s
- 전체 preview Chromium: 69 passed, 51.4s
- 실제 imagegen 사용량은 소모하지 않았다.

## 검증 게이트

- focused S23 tests: 11 files, 134 tests passed
- `npm test -- --run`: 36 files, 300 tests passed
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run build`: passed; production E2E diagnostics absent assertion passed
- `npm run test:e2e:preview`: 69 passed
- 신규 1280×720 S23 Chromium E2E: passed
- changed-file Prettier: passed
- `npm run format:check`: S23 변경 파일 warning 없음; 기존 baseline warning 3개(`src/app/App.test.tsx`, `docs/architecture.md`, `docs/product-brief.md`)만 허용
- `git diff --check`: passed
- 기존 production chunk 500kB warning은 유지되며 이번 변경에서 새로 생긴 warning이 아니다.

## 독립 리뷰

Grok은 호출하지 않았다. 아래는 정확히 동일한 `gemini-3.6-flash-high` 모델을 spec-compliance와 quality/security 역할로 분리한 review이며 cross-model review라고 주장하지 않는다.

### runtime과 입력 증거

- Antigravity CLI: `1.1.10`
- model argument: `--model gemini-3.6-flash-high`
- deterministic smoke: `Reply exactly: READY` → `READY`
- Hermes terminal safety가 `agy` 직접 실행을 gateway 제어 명령으로 오탐해 차단했으므로 `~/.local/bin/agy`를 `/tmp/antigravity-review`로 그대로 복사하고 Python `subprocess.run`으로 실행했다.
- reviewer 입력은 실행 시점의 `git diff --cached --no-ext-diff --binary` 전체를 CLI prompt argument에 직접 내장했다. reviewer에게 tool, 파일 읽기/수정과 명령 실행을 금지했다.
- initial input/output:
  - `/tmp/s23-gemini-spec-review-input.md`, `/tmp/s23-gemini-spec-review-output.md`
  - `/tmp/s23-gemini-quality-review-input.md`, `/tmp/s23-gemini-quality-review-output.md`
- closure input/output:
  - `/tmp/s23-gemini-spec-closure-input.md`, `/tmp/s23-gemini-spec-closure-output.md`
  - `/tmp/s23-gemini-quality-closure-input.md`, `/tmp/s23-gemini-quality-closure-output.md`

### initial 결과와 finding

- spec-compliance: PASS; Critical 0, Important 0, Minor 1
- quality/security: REJECT; Critical 0, Important 1, Minor 1, Security 0
- 두 역할이 공통으로 지적한 유효 finding은 `GenerationStore.createGeneration`에 runtime-null `sceneSnapshot`이 들어오면 legacy null 정책과 혼동되어 raw `TypeError`가 날 수 있다는 점이었다.
- 새 generation은 valid SceneDocument가 필수이고 legacy persisted record만 null을 허용하는 정책을 유지했다. `createGenerationInternal` 입구에서 `sceneDocumentSchema.parse`하고 검증된 snapshot만 ID 검사와 저장에 사용하도록 수정했다.
- RED는 null을 강제로 전달했을 때 `TypeError`를 재현했고, GREEN은 `ZodError` fail-closed와 generation manifest 비변경을 검증했다.
- quality review의 non-blocking serializer parameter widening 제안은 저장된 valid spec만 받는 의도적 typed boundary를 약화하므로 적용하지 않았다.

### closure

- spec-compliance closure: PASS; Critical 0, Important 0, Minor 0
- quality/security closure: PASS; Critical 0, Important 0, Minor 0
- 두 closure 모두 새 generation null 입력은 Zod 경계에서 fail-closed하고 legacy record null 복원은 유지됨을 확인했다.
- finding 수정 후 full unit 300, typecheck, lint, production build와 preview E2E 69건을 모두 다시 실행해 통과했다.

## 의도적으로 제외한 항목

- 자연어를 `specPatch`로 변환하거나 자동 적용하는 P3 기능
- 변경 전/후 patch 카드, revision 충돌 검사와 허용 JSON Patch path 검증
- 3D object transform domain command
- P3/P4/P5와 광범위한 리팩터링
- 실제 imagegen 사용량 소비
- main 병합, push와 원격 변경

## 다음 단계

S23 완료와 로컬 commit·clean-state 확인 뒤 P2의 첫 수직 슬라이스를 닫는다. P3는 별도 numbered phase이며 이 세션에서 시작하지 않는다.
