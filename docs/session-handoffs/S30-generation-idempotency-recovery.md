# S30 — Generation Idempotency and Recovery

## 세션

- 브랜치: `codex/conversational-scene-assistant`
- 작업 트리: `/Users/js/Documents/3d-scene-helper/.worktrees/codex-conversational-scene-assistant`
- 시작 HEAD: `497bb064ddfa3ab8d3729bfdb7e67eb3a3420156`
- 선행 uncommitted 범위: S24–S29 수직 슬라이스
- 범위: P4 generation request idempotency, 중복 실행 방지, 응답 유실·reload·Companion 재시작 복구

## 구현 요약

### Durable idempotency 계약

- 현재 브라우저의 모든 generation POST는 고유 `requestId`를 포함한다.
- Companion은 Zod 정규화 요청 전체의 SHA-256 fingerprint를 계산해 request ID와 함께 generation
  manifest에 저장한다.
- 같은 ID·fingerprint의 동시 POST는 request별 직렬화 경계에서 하나의 App Server turn과
  generation record로 합친다. 이후 재전송은 상태와 관계없이 기존 record를 `reused: true`로
  반환한다.
- 같은 ID에 다른 입력을 보내면 runtime side effect 전에 `409 Conflict`로 거부한다.
- fingerprint는 서버 내부 검증값으로 유지하고 public generation에는 request ID만 노출한다.
- request ID가 없던 구형 클라이언트는 요청마다 호환용 ID를 받으며 기존 API 흐름을 깨뜨리지
  않는다.

### 브라우저 중복 방지와 응답 유실 복구

- React state가 반영되기 전의 빠른 double click도 `generationLaunchInFlightRef`에서 차단한다.
- 캡처·render upload 뒤 정규화한 exact POST payload를 localStorage 복구 슬롯에 먼저 저장한다.
- 정상 응답이나 같은 request ID의 SSE/list record를 확인하면 복구 슬롯을 지운다.
- 응답 유실 또는 reload에서 서버 record를 찾지 못하면 접근 가능한 복구 카드가 같은 payload와
  request ID를 명시적으로 재전송한다. 레이아웃을 다시 캡처하거나 새 ID를 만들지 않는다.
- 손상된 복구 JSON은 schema 경계에서 제거하고 재전송하지 않는다.

### 취소·실패·재시작 상태

- reload에서 최신 `inProgress` generation의 thread/turn ID와 busy 상태를 복원해 동일 turn에
  interrupt를 보낸다.
- `failed`와 `interrupted`의 저장 오류 이유와 terminal 상태를 Assistant에 표시하고 다음 사용자
  시도는 새 request ID로 시작한다.
- Companion 시작 시 이전 manifest의 남은 `inProgress`를 `interrupted`로 원자 저장해 영구 진행
  상태를 제거한다.
- 재시작 뒤 같은 request ID는 interrupted record를 반환하고 imagegen을 자동 재실행하지 않는다.
- 키프레임 상세에서 request ID와 durable generation 상태를 확인할 수 있다.

## 실제 Chromium 증거

신규 `e2e/generation-idempotency-recovery.spec.ts`는 실제 Companion server와 fake App Server
runtime을 사용해 다음을 검증한다.

1. 첫 generation POST는 서버가 처리한 뒤 브라우저 응답만 의도적으로 유실한다.
2. double click과 같은 request ID 재확인 뒤에도 App Server turn은 정확히 하나다.
3. localStorage 복구 payload는 기존 record 확인 뒤 제거된다.
4. reload는 같은 in-progress turn을 복원하고 interrupt한다.
5. 두 번째 in-progress generation 중 Companion을 같은 port·project로 재시작한다.
6. reload 뒤 해당 record가 interrupted 이유와 함께 복원되고 새 runtime은 turn을 시작하지 않는다.
7. 1280px horizontal overflow와 예상 밖 page/console error가 없다.

## 검증 게이트

- focused store/server/client/recovery/panel tests: 5 files, 48 tests passed
- `npm test -- --run`: 42 files, 341 tests passed
- `npm run typecheck`: passed
- `npm run lint`: passed
- focused S28–S30 Chromium E2E: 3 passed
- `npm run build`: passed; production E2E diagnostics absent assertion passed
- `npm run test:e2e:preview`: 73 passed
- changed-file Prettier와 `git diff --check`: passed
- 전체 `npm run format:check`에는 이번 범위 밖 기존 `docs/architecture.md`,
  `docs/product-brief.md` formatting warning 2건이 남아 있다.
- 실제 imagegen 사용량은 소모하지 않았다.

## 의도적으로 제외한 항목

- 동일 입력의 실행 요약과 첨부 콘텐츠 해시 UI
- terminal generation의 자동 재시작 또는 무인 retry
- App Server 자체가 제공하는 turn 조회·resume API가 없는 상태에서의 live turn 재연결
- scene render upload 자체의 content-addressed deduplication
- 여러 Companion 프로세스가 같은 project manifest를 동시에 쓰는 분산 lock
- 실제 imagegen 사용량 소비
- commit, main 병합, push와 원격 변경

## 다음 단계

S31은 generation에 사용된 SceneDocument·Semantic Scene Spec·LayoutSpec·레이아웃 렌더·원본
키프레임·레퍼런스와 실제 첨부 순서를 콘텐츠 해시까지 포함한 재현 가능한 실행 요약으로 제공한다.
