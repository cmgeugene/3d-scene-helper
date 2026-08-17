# S25 — Object Transform Scene Commands

## 세션

- 브랜치: `codex/conversational-scene-assistant`
- 작업 트리: `/Users/js/Documents/3d-scene-helper/.worktrees/codex-conversational-scene-assistant`
- 시작 HEAD: `497bb064ddfa3ab8d3729bfdb7e67eb3a3420156`
- 시작 divergence: `origin/codex/conversational-scene-assistant`보다 4 commits ahead
- 선행 uncommitted 범위: S24 structured specPatch 수직 슬라이스
- 범위: P3의 object ID 기반 `setObjectTransform`, spec patch와 scene command의 단일 transaction, 서버·브라우저 ID/명령 충돌 거부와 변경 카드

## 구현 요약

### Version 2 scene change proposal

- ephemeral structured proposal 계약을 version 2로 올리고 필수 `sceneCommands` 배열을 추가했다. proposal은 프로젝트에 저장되지 않으므로 persisted migration은 필요하지 않다.
- 현재 허용하는 유일한 3D domain command는 `setObjectTransform`이다. 명령은 정확한 `objectId`와 position, rotationDeg, 양수 scale 전체를 포함한다.
- 3D transform은 JSON Patch object path로 수정하지 않는다. `specPatch`는 Semantic Scene Spec의 승인 경로만, `sceneCommands`는 object ID 기반 transform만 담당한다.
- 한 proposal에서 같은 object ID를 두 번 대상으로 삼는 명령을 schema 충돌로 거부한다.
- schema 밖 command type, 누락·추가 필드, 0 이하 scale, 존재하지 않는 object ID를 거부한다.
- Codex App Server `outputSchema`, Companion Zod schema와 브라우저 event schema가 같은 version 2 계약을 사용한다.

### 이중 평가와 원자 적용

- Companion은 structured output metadata를 요청과 대조하고 요청 당시 SceneDocument clone에 spec patch와 scene command를 함께 평가한다.
- 브라우저는 SSE payload를 다시 parse한 뒤 현재 live SceneDocument와 base scene/spec revision을 재검증한다.
- evaluator는 live document를 수정하지 않고 완성된 candidate SceneDocument를 만든다. 모든 spec patch와 scene command가 성공한 경우에만 전/후 diff와 candidate를 반환한다.
- editor store는 candidate를 단일 `apply-scene-change-proposal` mutation으로 기록한다. mixed proposal도 history entry가 하나이며 spec/transform이 함께 undo/redo된다.
- transform-only proposal은 scene revision만 증가시키고 spec revision은 보존한다.
- spec과 command 양쪽에 실제 변경이 없는 no-op proposal은 history를 만들지 않고 거부한다.

### Companion prompt와 변경 카드

- proposal prompt는 의미 변경에는 `specPatch`, 위치·회전·크기에는 `setObjectTransform`을 사용하도록 권위 경계를 명시한다.
- 명령은 현재 SceneDocument에 존재하는 object ID와 transform 전체를 사용하고, object 생성·삭제·포즈 변경은 제안하지 않도록 제한한다.
- 변경 카드는 Semantic Spec field diff와 함께 object 이름·ID, 3D transform 전/후값을 표시한다.
- 적용 버튼은 spec 또는 scene command 중 하나라도 유효한 실제 변경이 있을 때만 활성화된다.

## 실제 Chromium 증거

`e2e/spec-patch-change-card.spec.ts`의 1280×720 mock authenticated Companion 흐름을 version 2 mixed transaction으로 확장했다.

1. 자연어 요청 뒤 location spec diff와 `starter-mannequin` transform diff가 한 카드에 나타난다.
2. 카드 표시와 취소 전후 SceneDocument, history와 dirty state가 변하지 않는다.
3. double click apply가 location과 transform을 하나의 history entry로 적용한다.
4. 한 번의 undo가 spec과 transform을 함께 복원하고 redo가 둘을 함께 재적용한다.
5. autosave와 reload 뒤 Semantic Scene Spec, transform과 monotonic revision이 모두 보존된다.
6. 카드 표시 뒤 live scene race가 생기면 stale transaction 전체를 거부한다.
7. schema에는 맞지만 삭제된 object ID를 대상으로 한 command를 브라우저 evaluator가 거부한다.
8. schema 밖 prototype path payload를 브라우저 event 경계가 거부한다.
9. 1280px horizontal overflow와 page/console error가 없다.

## 검증 게이트

- focused proposal/store/server/panel/event tests: 5 files, 65 tests passed
- `npm test -- --run`: 38 files, 317 tests passed
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run build`: passed; production E2E diagnostics absent assertion passed
- `npm run test:e2e:preview`: 70 passed
- 신규 mixed transaction 1280×720 Chromium E2E: passed
- 기존 production chunk 500kB warning은 유지되며 이번 변경에서 새로 생긴 warning이 아니다.
- 실제 imagegen 사용량은 소모하지 않았다.

## 의도적으로 제외한 항목

- object 생성·삭제, mannequin pose와 camera를 바꾸는 추가 domain command
- 삭제·복제된 object와 Semantic relationship·reference 연결의 전체 참조 무결성 transaction
- 주인공 가림, reference/pose authority 충돌과 image input budget 경고
- 적용된 proposal에서 generation snapshot과 prompt까지 이어지는 별도 P3 Chromium 증거
- 실제 imagegen 사용량 소비
- commit, main 병합, push와 원격 변경

## 다음 단계

P3의 다음 수직 슬라이스는 object·relationship·reference의 참조 무결성 정책과 생성 전 충돌 경고를 추가한다. 그 뒤 적용된 spec/scene 변경이 generation snapshot과 prompt에 동일하게 남는 실제 Chromium 증거를 추가해 P3을 종료한다.
