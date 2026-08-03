# Session S14 Handoff — 3D layout 기반 이미지 생성

## 완료한 목표

현재 3D 장면과 Reference Manager 선택을 Codex 내장 imagegen에 전달하고 결과를 프로젝트에 보관하는 첫 수직 슬라이스를 구현했다.

- 현재 OutputCamera를 reference mode PNG로 자동 캡처
- 캡처 이미지를 항상 첫 첨부로 고정
- 선택 레퍼런스를 `Layout → Background → Character → Style` 순으로 첨부
- `$imagegen`과 첨부 역할 매니페스트를 포함하는 생성 전용 prompt
- Codex 모델 공급자의 image generation capability 확인
- 렌더 업로드, 생성 시작, 기록 목록, 결과 조회 loopback API
- App Server의 `item/completed` imageGeneration과 `turn/completed` 이벤트 처리
- 생성 결과의 이미지 시그니처·50MB 제한 검증
- 구도 렌더를 `assets/scene-renders/`, 결과를 `assets/generations/`에 복사
- `generations.json`에 요청, 첨부, 해시, 상태와 결과 메타데이터 기록
- 생성 진행 상태와 결과 미리보기 UI
- 기록 생성 실패 시 시작된 Codex turn 중단

## 데이터 경계

- 브라우저는 인증된 API에 PNG Blob과 안정적인 reference ID만 전달한다.
- Companion이 프로젝트 내부 artifact 경로를 해석해 Codex `localImage` 입력으로 변환한다.
- Codex가 반환한 `savedPath`는 실제 파일과 이미지 시그니처를 검사한 뒤 프로젝트에 복사한다.
- 공개 API와 브라우저 상태에는 내부 `assetPath`를 노출하지 않는다.
- 실제 imagegen은 Codex 사용량을 소비하므로 자동 테스트에서는 가짜 App Server 이벤트만 사용했다.

## 검증 결과

```text
npm run typecheck             PASS
npm run lint                  PASS
npm test -- --run             PASS — 30 files, 251 tests
npm run build                 PASS
npm run companion:smoke       PASS — ChatGPT account, App Server and loopback API
npx playwright test e2e/smoke.spec.ts --reporter=line --workers=1
                              PASS — Chromium 3 tests
```

Generation Store, loopback API, 브라우저 클라이언트, SSE 정규화, prompt 조립과 React 생성 흐름은 27개의 집중 테스트로 다시 확인했다. 전체 `editor.spec.ts`는 기존 PNG download timeout 두 건과 숫자 입력 기대값 한 건으로 실패했으며 이번 생성 경로와 직접 관련된 실패는 아니었다. 저장소 전체 `format:check`도 기존 77개 파일의 포맷 불일치로 실패하지만 이번 변경 파일은 개별 Prettier 검사에 통과한다.

## 수동 확인 방법

1. Companion을 재시작한다.
2. Vite 앱을 Companion의 새 `launchUrl`로 연다.
3. References에서 사용할 이미지를 선택하고 캐릭터는 마네킹에 연결한다.
4. Scene Assistant에 연출 지시를 입력한다.
5. `이미지 생성`을 누른다.
6. 진행 상태와 결과 미리보기를 확인한다.
7. 프로젝트의 `generations.json`, `assets/scene-renders/`, `assets/generations/`를 확인한다.

## 다음 단계

- 생성 요청 idempotency와 중복 클릭 방지 강화
- 생성 기록 목록 및 이전 결과 선택 UI
- 결과를 기준으로 하는 revision turn과 부모/자식 generation 관계
- Scene Graph 분석 스냅샷과 Semantic Scene Spec 영속화
- 승인·사용자 입력을 요구하는 App Server request 처리 UI
- 실제 레퍼런스로 imagegen 한 번을 수동 검증하고 모델 결과에 맞춰 prompt 어댑터 조정
