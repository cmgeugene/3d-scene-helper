# S31 — Reproducible Generation Execution Summary

## 세션

- 브랜치: `codex/conversational-scene-assistant`
- 작업 트리: `/Users/js/Documents/3d-scene-helper/.worktrees/codex-conversational-scene-assistant`
- 시작 HEAD: `497bb064ddfa3ab8d3729bfdb7e67eb3a3420156`
- 선행 uncommitted 범위: S24–S30 수직 슬라이스
- 범위: P4 generation 입력 해시, 실제 첨부 순서, prompt 근거 재검증과 키프레임 상세

## 구현 요약

### Versioned 실행 요약

- `generationExecutionSummarySchema` version 1을 브라우저와 Companion의 공유 경계로 추가했다.
- 신규 generation은 prompt, SceneDocument, Semantic Scene Spec, LayoutSpec의 SHA-256을 저장한다.
- 레이아웃 렌더, 원본 키프레임과 레퍼런스는 ID·역할·콘텐츠 해시를 저장한다.
- Codex turn에 전달한 이미지 배열을 1-based attachment index로 보존한다. `edit`은 원본 → 레이아웃
  → 레퍼런스, `fresh`는 레이아웃 → 레퍼런스 순서다. 3D snapshot 출처 generation은 첨부 원본과
  구분해 `sceneSnapshotSource`로 기록한다.
- 실행 요약이 없는 이전 manifest는 nullable 기본값으로 읽어 `legacy` 상태를 유지한다.

### Companion 재검증

- generation을 공개할 때 저장 manifest에서 실행 요약을 다시 계산하며 저장 요약과 항목별로
  비교한다.
- SceneDocument 안의 Semantic Scene Spec과 별도 snapshot의 동일성을 검사한다.
- 실제 attachment 배열이 generation mode와 정렬된 reference snapshot 순서를 따르는지 검사한다.
- prompt의 SceneDocument, Semantic Scene Spec, LayoutSpec과 레퍼런스 첨부 매니페스트 블록을 같은
  저장 snapshot에서 다시 직렬화해 대조한다.
- 누락된 원본 결과 해시와 해시를 해석할 수 없는 첨부도 mismatch 사유로 반환한다.
- request fingerprint는 계속 서버 내부에만 두고, 공개 record에는 실행 요약과
  `valid`/`legacy`/`mismatch` 상태·오류 목록을 제공한다.

### 키프레임 상세

- 선택 generation에 `재현 가능한 실행 요약`을 추가했다.
- 입력 무결성 상태, prompt·SceneDocument·Semantic Scene Spec·LayoutSpec·렌더의 전체 해시,
  원본 키프레임과 레퍼런스, 실제 첨부 순서를 표시한다.
- mismatch는 구체적인 재검증 사유를 alert로 표시하고, 구형 기록은 실행 요약이 없음을 명시한다.
- Chromium 왕복에서 요약과 첨부 순서가 표시되고 reload 뒤에도 동일하게 복원되는지 검증한다.

## 자동 검증

- `npm test -- --run`: 42 files, 343 tests passed
- `npm run typecheck`: passed
- `npm run lint`: passed
- focused Chromium E2E (`e2e/keyframe-workspace.spec.ts`): 2 passed
- `npm run test:e2e:preview`: 73 passed
- `npm run build`: passed; production E2E diagnostics absent assertion passed
- 변경 코드 Prettier와 `git diff --check`: passed
- 전체 `npm run format:check`에는 이번 범위 밖 기존 `docs/architecture.md`,
  `docs/product-brief.md` formatting warning 2건이 남아 있다.
- 실제 imagegen 사용량은 소모하지 않았다.

## 의도적으로 제외한 항목

- 저장 artifact 파일 전체를 generation 목록 조회 때마다 다시 읽는 디스크 scrub
- 모델명·모델 버전·provider-side seed처럼 현재 App Server 결과가 제공하지 않는 값
- content-addressed artifact deduplication
- 프로젝트별 Codex task와 대화 요약 metadata 영속화
- 실제 imagegen 사용량 소비
- commit, main 병합, push와 원격 변경

## 다음 단계

S32는 프로젝트별 Codex task ID와 versioned 대화 요약 metadata를 저장한다. 프로젝트 재진입 시
저장 task 재개와 새 task 시작을 명시적으로 선택하게 하고, 대화는 보조 상태이며 SceneDocument,
Semantic Scene Spec, reference manifest와 generation record가 영구 원본이라는 경계를 유지한다.
