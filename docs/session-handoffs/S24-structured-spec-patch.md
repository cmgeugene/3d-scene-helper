# S24 — Structured Semantic Scene Spec Patch

## 세션

- 브랜치: `codex/conversational-scene-assistant`
- 작업 트리: `/Users/js/Documents/3d-scene-helper/.worktrees/codex-conversational-scene-assistant`
- 시작 HEAD: `497bb064ddfa3ab8d3729bfdb7e67eb3a3420156`
- 시작 divergence: `origin/codex/conversational-scene-assistant`보다 4 commits ahead
- 범위: P3의 첫 수직 슬라이스인 자연어 기반 versioned `specPatch`, 이중 검증, revision 충돌 거부, 변경 카드와 명시적 적용·취소

## 구현 요약

### Versioned patch 계약과 이중 검증

- `SpecPatchProposal` version 1과 동일한 Codex App Server `outputSchema`를 정의했다.
- `add`, `remove`, `replace`만 허용하고 Semantic Scene Spec의 승인된 leaf 또는 collection 경로만 수정한다. 배열 index, 임의 object path, prototype path와 3D transform path는 schema에서 거부한다.
- 각 경로의 값 schema, patch 수, 사용자 메시지와 warning 길이를 제한한다.
- patch는 live state가 아닌 clone에 전부 적용하고 완성된 Semantic Scene Spec과 SceneDocument를 다시 검증한다. 한 operation이라도 실패하면 부분 적용하지 않는다.
- Companion은 Codex의 structured 응답을 schema, request metadata, base revision과 현재 요청 SceneDocument에 대해 검증한 뒤 전용 SSE event로만 전달한다.
- 브라우저는 수신 event를 같은 schema로 다시 검증하고 현재 live SceneDocument에 대해 다시 평가한다. 서버를 우회한 malformed event도 fail-closed한다.

### Monotonic revision과 원자 적용

- SceneDocument에 legacy-safe 기본값 0인 `sceneRevision`과 `specRevision`을 추가했다.
- 모든 document mutation, undo/redo, reset/import/snapshot replacement는 `sceneRevision`을 단조 증가시킨다. Semantic Scene Spec 내용이 바뀐 mutation만 `specRevision`도 증가시킨다.
- undo/redo가 과거 revision으로 되돌아가지 않도록 복원한 내용에 새 revision을 부여한다.
- 내용이 persisted baseline과 같아 dirty가 false가 되더라도 새 monotonic revision은 autosave한다.
- proposal의 두 base revision 중 하나라도 live state와 다르면 적용 직전 다시 거부한다.
- 적용은 단일 `apply-spec-patch-proposal` history mutation이며 double click도 한 번만 처리한다.

### 변경 카드와 대화 흐름

- 대화 입력에 `변경안 제안` action을 추가해 일반 대화와 structured proposal turn을 분리했다.
- 카드는 검증된 field별 경로, 변경 전 값, 변경 후 값과 warning을 표시한다.
- 적용 전과 취소 뒤에는 SceneDocument, history와 dirty state가 바뀌지 않는다.
- 명시적 적용은 undo/redo와 autosave에 참여하며, stale proposal과 malformed payload 오류는 접근 가능한 alert로 표시한다.
- structured proposal turn의 agent delta는 일반 채팅 event로 중복 노출하지 않는다.
- turn 완료 event가 proposal start 응답보다 먼저 도착하는 race도 pending 상태로 남지 않도록 추적한다.

## 실제 Chromium 증거

신규 `e2e/spec-patch-change-card.spec.ts`가 1280×720 Chromium과 mock authenticated Companion을 사용해 다음을 검증한다.

1. keyboard로 자연어 변경안을 요청하고 허용 경로의 전/후 값과 warning 카드를 확인한다.
2. 카드 표시와 취소 전후의 SceneDocument, history, dirty state가 동일함을 확인한다.
3. apply double click이 한 번의 mutation만 기록하는지 확인한다.
4. undo/redo 뒤 revision, Semantic Scene Spec과 autosave가 일치하는지 확인한다.
5. reload 뒤 적용된 spec과 monotonic revision이 복원되는지 확인한다.
6. 카드 표시 후 3D scene mutation을 만들고 stale apply가 live spec을 보존하는지 확인한다.
7. schema 밖의 prototype path event를 브라우저가 거부하는지 확인한다.
8. 1280px horizontal overflow와 page/console error가 없는지 확인한다.

## 검증 게이트

- focused proposal tests: 7 files, 81 tests passed
- `npm test -- --run`: 38 files, 315 tests passed
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run build`: passed; production E2E diagnostics absent assertion passed
- `npm run test:e2e:preview`: 70 passed
- 신규 1280×720 change-card Chromium E2E: passed
- changed-file Prettier: passed
- `git diff --check`: passed
- 기존 production chunk 500kB warning은 유지되며 이번 변경에서 새로 생긴 warning이 아니다.
- 실제 imagegen 사용량은 소모하지 않았다.

## 의도적으로 제외한 항목

- object ID 기반 `sceneCommands`와 spec patch의 단일 project transaction
- object 삭제·복제와 관계·레퍼런스 연결의 전체 참조 무결성 정책
- 주인공 가림, 포즈 권위, reference 충돌과 image input budget 경고
- 적용된 proposal에서 generation snapshot과 prompt까지 이어지는 별도 P3 Chromium 증거
- 실제 imagegen 사용량 소비
- commit, main 병합, push와 원격 변경

## 다음 단계

P3의 다음 수직 슬라이스는 object ID 기반 3D domain command를 proposal 계약에 추가한다. spec patch와 scene command를 같은 base revision에서 함께 검증하고 단일 undo 가능한 transaction으로 적용한 뒤, object·관계·reference 무결성과 생성 전 충돌 경고를 확장한다.
