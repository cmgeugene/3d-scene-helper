# S27 — Proposal to Generation Roundtrip

## 세션

- 브랜치: `codex/conversational-scene-assistant`
- 작업 트리: `/Users/js/Documents/3d-scene-helper/.worktrees/codex-conversational-scene-assistant`
- 시작 HEAD: `497bb064ddfa3ab8d3729bfdb7e67eb3a3420156`
- 시작 divergence: `origin/codex/conversational-scene-assistant`보다 4 commits ahead
- 선행 uncommitted 범위: S24 structured specPatch, S25 sceneCommands, S26 generation preflight 수직 슬라이스
- 범위: 적용된 proposal의 Semantic Scene Spec과 object transform이 generation snapshot, LayoutSpec과 prompt까지 동일하게 이어지는 P3 종료 증거

## 구현 요약

### 실제 generation 경계 확장

- 기존 `e2e/spec-patch-change-card.spec.ts` mock Companion에 scene render와 generation API를 추가했다.
- mock generation record는 브라우저가 보낸 `sceneSnapshot`, `semanticSceneSpecSnapshot`, `LayoutSpec`, prompt와 attachment를 그대로 반환하고 Codex turn 완료 이벤트까지 전달한다.
- 한 테스트에서 여러 generation을 순차 실행해 각 요청 완료 뒤 동일한 editor와 대화 상태로 다음 revision을 검증한다.

### 네 revision의 단일 원본 검증

- 변경 카드가 표시됐지만 적용하지 않은 상태의 generation은 scene/spec revision 0, 빈 location, 기존 mannequin transform을 사용한다.
- mixed proposal 적용 직후 generation은 revision 1, `골목 치킨집`, x=1.25와 yaw=20 transform을 사용한다.
- 단일 undo 뒤 generation은 revision 2와 적용 전 내용, redo 뒤 generation은 revision 3과 적용된 내용을 사용한다.
- 각 요청에서 SceneDocument snapshot의 exact transform, LayoutSpec의 파생 world bounds와 yaw를 검증한다.
- prompt의 JSON LayoutSpec block은 요청 LayoutSpec과 완전히 같고, Semantic Scene Spec을 제외한 SceneDocument block은 요청 snapshot과 완전히 같다.
- Semantic Scene Spec의 location은 prompt의 구조화된 한국어 block에서 같은 값으로 확인하며, 생성 버튼을 누를 때의 자유 텍스트 draft는 prompt에 섞이지 않는다.

## 실제 Chromium 증거

1280×720 authenticated mock Companion 흐름 하나에서 다음 순서를 모두 왕복한다.

1. proposal 표시 중 pre-apply generation과 live document 불변성 확인
2. proposal 취소 뒤 document/history/dirty 불변성 확인
3. mixed specPatch + sceneCommands 단일 적용과 generation 입력 확인
4. undo generation과 redo generation의 monotonic scene/spec revision 및 내용 확인
5. autosave/reload, stale proposal, 삭제된 object ID, malformed payload 거부 회귀 유지
6. horizontal overflow와 page/console error 없음 확인

## 검증 게이트

- focused 1280×720 proposal-to-generation Chromium E2E: passed
- `npm test -- --run`: 39 files, 325 tests passed
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run build`: passed; production E2E diagnostics absent assertion passed
- `npm run test:e2e:preview`: 70 passed
- changed-file Prettier와 `git diff --check`: passed
- 전체 `npm run format:check`에는 이번 범위 밖 기존 `docs/architecture.md`, `docs/product-brief.md` formatting warning 2건이 남아 있다.
- 실제 imagegen 사용량은 소모하지 않았다.

## 의도적으로 제외한 항목

- refinement feedback의 유지·변경 구조화와 generation schema 확장
- generation request idempotency key와 Companion 재시작 복구
- generation 후보 간 이미지 diff와 계보 시각화 고도화
- 실제 imagegen 사용량 소비
- commit, main 병합, push와 원격 변경

## 다음 단계

S28은 보정 피드백의 유지·변경 제약을 versioned 구조로 만들고 generation snapshot, prompt와 UI에서 동일한 계약으로 보존한다.
