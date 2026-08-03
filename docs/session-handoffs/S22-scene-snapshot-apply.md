# S22 — sceneSnapshot 안전 적용

## 세션

- session_id: `20260803_234357_60d837`
- 브랜치: `codex/conversational-scene-assistant`
- 작업 트리: `/Users/js/Documents/3d-scene-helper/.worktrees/codex-conversational-scene-assistant`
- 시작 HEAD: `92b43a27a0d74514d2d6a450755186869305020a`
- 시작 divergence: `origin/codex/conversational-scene-assistant`보다 2 commits ahead
- 범위: P1의 generation `sceneSnapshot` 적용, fail-closed 저장·확인, undo·durable recovery, provenance와 fresh/edit 계보 계약

## 구현 요약

### 명시적 적용과 fail-closed 확인

- valid `sceneSnapshot`을 가진 generation에만 `현재 씬으로 불러오기`를 활성화한다.
- 확인 dialog는 generation ID·버전과 현재 씬 대비 주요 차이를 표시하고, 취소를 초기 focus로 둔다.
- Escape 취소와 두 action 사이의 Tab/Shift+Tab focus trap을 제공한다.
- dialog를 연 뒤 선택 generation ID나 record가 바뀌거나, snapshot schema/scene integrity 재검증이 실패하면 적용을 거부한다.
- apply in-flight guard가 중복 click을 막고, 단일 `apply-generation-snapshot` editor action만 기록한다.

### pre-apply 저장, undo와 durable recovery

- 확인 시 live state를 변경하기 전에 현재 SceneDocument와 selection을 별도 `pre-apply-recovery` key에 저장하고 현재 SceneDocument autosave도 동기 저장한다.
- recovery write 또는 autosave write가 실패하면 가능한 저장 변경을 rollback하고 live SceneDocument, selection, history, dirty state를 변경하지 않는다.
- 일반 autosave key와 recovery key를 분리해 적용 후 autosave가 recovery 증거를 덮어쓰지 않는다.
- apply history entry에 직전 selection을 함께 기록해 한 번의 undo가 직전 SceneDocument와 selection을 정확히 복원한다.
- `적용 전 씬 복구` UI는 새로고침과 Companion 재시작 뒤에도 별도 recovery record에서 직전 SceneDocument와 selection을 복원한다.

### provenance와 fresh/edit 계약

- 적용된 SceneDocument의 optional `generationSource`에 선택 generation ID와 버전을 보존하고 3D viewport에 표시한다.
- 이 3D 레이아웃에서 새 이미지를 만들면 `generationMode: fresh`, `parentGenerationId: null`, `sourceGenerationId: <적용 generation>`이다. 기존 결과 이미지는 입력에 포함하지 않는다.
- 기존 generation 결과 이미지 기반 보정만 `generationMode: edit`, `parentGenerationId: <원본>`, `sourceGenerationId: null`이다.
- browser client, Companion request schema, GenerationStore record와 history UI가 `sourceGenerationId`를 보존·표시한다.
- server와 GenerationStore 양쪽에서 fresh-parent 및 edit-source 혼합을 거부한다. 구형 record는 `sourceGenerationId: null`로 복원한다.

## TDD 기록

### RED

1. `editorStore.test.ts` — `applyGenerationSnapshot`이 없어 단일 history action과 selection undo 테스트 실패.
2. `sceneRecovery.test.ts` — recovery module이 없어 저장 성공·두 번째 write 실패 rollback 테스트 실패.
3. `KeyframeWorkspace.test.tsx` — apply dialog/cancel action이 없어 취소 비변경 테스트 실패.
4. `KeyframeWorkspace.test.tsx` — dialog 중 선택 변경을 거부하지 않아 stale selection 테스트 실패.
5. `KeyframeWorkspace.test.tsx` — 같은 ID generation의 SSE integrity 변경을 확인 시 재검증하지 않아 실패.
6. `EditorShell.test.tsx` — pre-apply storage 실패를 abort하는 연결이 없어 fail-closed 테스트 실패.
7. `EditorShell.test.tsx` — apply provenance, 단일 undo와 reload-safe recovery UI가 없어 복원 테스트 실패.
8. `SceneAssistantPanel.test.tsx` — 적용 generation을 fresh source로 보내지 않고 edit와 분리 표시하지 않아 lineage 테스트 실패.
9. `generationStore.test.ts`, `server.test.ts` — Companion record/API에 `sourceGenerationId`가 없어 fresh source 추적 테스트 실패.
10. `generationStore.test.ts` — lower-level store가 fresh-parent 조합을 허용해 lineage invariant 테스트 실패.
11. Chromium E2E — live canvas object diagnostic이 read-only preview에만 있어 apply 후 object runtime assertion 실패.

### GREEN

- focused unit/integration: 7 files, 85 tests passed (후속 lineage invariant 추가 전 기준)
- focused GenerationStore lineage invariant: passed
- focused Chromium apply flow: 1 passed, 1280×720
- 실제 적용 runtime camera: position `(2, 2.4, -7)`, `35mm`
- 실제 적용 runtime object: `starter-mannequin` position `(-1.25, 0.85, 1.5)`, snapshot-only `cube-snapshot` 포함

## 실제 Chromium 증거

1280×720 Chromium에서 다음을 검증했다.

1. dialog open 전 live SceneDocument/history/selection/dirty/autosave를 캡처했다.
2. dialog에서 generation ID·버전과 주요 object 차이를 확인하고, cancel initial focus, Tab 순환, Escape 취소 뒤 모든 live evidence가 byte-equivalent임을 확인했다.
3. Storage quota 실패를 주입해 recovery write를 실패시킨 뒤 alert와 live evidence 완전 비변경을 확인했다.
4. dialog가 열린 동안 same-ID generation을 SSE mismatch record로 바꾸고 confirm 시 integrity 재검증으로 거부되는지 확인했다.
5. 복원된 valid generation에 confirm button double-click을 수행하고 history가 정확히 한 entry만 증가하는지 확인했다.
6. 3D 씬 모드 전환, provenance banner, 실제 live Canvas camera/object diagnostic을 확인했다.
7. 한 번의 UI undo가 직전 SceneDocument와 selection을 복원했다.
8. redo와 autosave 후 mock Companion을 같은 port에서 종료·재시작하고 페이지를 새로고침했다. provenance와 recovery UI가 남아 있는지 확인했다.
9. durable recovery가 직전 SceneDocument와 selection을 복원하고 recovery key를 제거하며 autosave를 완료하는지 확인했다.
10. console/page error와 1280px horizontal overflow가 없음을 확인했다.

## 검증 게이트

- focused tests: passed
- `npm test -- --run`: 35 files, 289 tests passed
- `npm run typecheck`: passed
- `npm run lint`: 최초 E2E fixture의 `let` 1건을 검출해 `const`로 수정 후 passed
- `npm run build`: passed; production E2E diagnostics absent assertion passed, 기존 500kB chunk warning만 존재
- `npm run test:e2e:preview`: 68 passed
- changed-file Prettier: passed
- `npm run format:check`: 기존 warning 3개(`src/app/App.test.tsx`, `docs/architecture.md`, `docs/product-brief.md`)만 남고 S22 신규 warning 없음
- `git diff --check`: passed

## 독립 리뷰

S22에서는 원래 Grok spec + Gemini quality/security 교차 모델 구성을 시도했다. Grok OAuth가 만료되어 실행되지 않았고, 사용자가 이 S22에 한해 `gemini-3.6-flash-high`로 대체하라고 명시 승인했다. 따라서 아래 두 리뷰는 역할과 프롬프트를 분리한 동일 Gemini 모델 리뷰이며, 교차 모델 리뷰라고 주장하지 않는다.

### Gemini quality/security initial — PASS

- provider/model: Antigravity CLI `1.1.9`, `google/gemini-3.6-flash-high`
- authoritative command:
  `agy -p "$(< /tmp/s22-gemini-initial-full.md)" --model gemini-3.6-flash-high --print-timeout 20m --dangerously-skip-permissions`
- input: S22 명세와 `git diff --cached` 결과를 `/tmp/s22-gemini-initial-full.md`에 그대로 내장; reviewer에게 tool 호출과 파일 수정을 금지
- result: PASS; Critical 0, Important 0, Minor 0, security PASS, scope PASS
- 첫 시도는 headless command permission이 없어 output이 없었고, 두 번째 시도는 reviewer sandbox가 repo가 아닌 cwd에서 빈 staged diff를 읽어 무효화했다. 위 embedded-diff command만 유효한 review 증거다.

### Grok spec compliance initial — BLOCKED, 미실행

- local CLI: `grok 0.2.14 (e0d895dcdf7)`, configured model ID `grok-build`
- auth probe: `grok models` → `You are not authenticated.`
- attempted command:
  `grok -p 'Reply exactly MODEL_OK' -m grok-build --max-turns 1 --output-format plain --permission-mode plan`
- result: xAI OAuth login URL을 출력한 뒤 120초 timeout; review prompt는 전송되지 않았다.
- Hermes `xai-oauth` pool의 3 credentials도 `invalid_grant`/`Invalid or unknown refresh token`이었고, review prompt는 Grok에 전송되지 않았다.

### Gemini spec compliance 대체 리뷰 — PASS

- 사용자 승인: Grok 인증 blocker에 대해 `gemini-3.6-flash-high` 대체 리뷰를 명시 요청
- runtime/model: Antigravity CLI `1.1.10`, `google/gemini-3.6-flash-high`
- smoke test: `agy -p 'Reply exactly: READY' --model gemini-3.6-flash-high --print-timeout 2m` → `READY`
- input: authoritative S22 contract와 실행 시점의 exact `git diff --cached --no-ext-diff`를 Python subprocess argument로 직접 내장; tool 호출·파일 읽기/수정·명령 실행 금지
- evidence: `/tmp/s22-gemini-spec-review-input.md`, `/tmp/s22-gemini-spec-review-output.md`
- result: PASS; Critical 0, Important 0, Minor 0, contract 10/10 PASS, scope fully compliant

### Closure와 완료 상태

- 두 Gemini 리뷰 모두 blocking finding이 없으므로 수정·closure 재검토는 필요하지 않았다.
- Grok은 실제 실행되지 않았으며 S22를 cross-model-reviewed라고 표시하지 않는다.
- 사용자 승인 대체 게이트에 따라 S22 독립 리뷰 게이트는 완료됐다. 향후 리뷰의 기본 선호는 별도 변경 지시가 없는 한 Grok + Gemini 3.6 Flash High를 유지한다.

## 변경 파일

- `companion/generationStore.test.ts`
- `companion/generationStore.ts`
- `companion/server.test.ts`
- `companion/server.ts`
- `docs/roadmap.md`
- `docs/session-handoffs/S22-scene-snapshot-apply.md`
- `e2e/keyframe-workspace.spec.ts`
- `src/app/App.css`
- `src/assistant/KeyframeWorkspace.test.tsx`
- `src/assistant/KeyframeWorkspace.tsx`
- `src/assistant/SceneAssistantPanel.test.tsx`
- `src/assistant/SceneAssistantPanel.tsx`
- `src/assistant/companionClient.ts`
- `src/editor/components/EditorShell.test.tsx`
- `src/editor/components/EditorShell.tsx`
- `src/editor/persistence/sceneRecovery.test.ts`
- `src/editor/persistence/sceneRecovery.ts`
- `src/editor/persistence/sceneSchema.ts`
- `src/editor/scene/SceneViewport.tsx`
- `src/editor/state/editorStore.test.ts`
- `src/editor/state/editorStore.ts`
- `src/editor/state/history.ts`

## 의도적으로 제외한 항목

- P2 Semantic Scene Spec
- P3 `specPatch`와 충돌 검사
- P4의 광범위한 idempotency·retry 정책
- main 병합과 push

## 다음 단계

S22 구현·자동 검증·사용자 승인 Gemini 대체 독립 리뷰가 완료됐다. 로컬 commit과 clean-state 확인 후 P1을 종료한다. 후속 P2 Semantic Scene Spec은 별도 fresh project-bound session에서 시작하며, 이 S22 세션 범위에는 포함하지 않는다.
