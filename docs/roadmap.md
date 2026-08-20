# AI Scene Assistant 구현 로드맵

> 기준일: 2026-08-20
>
> 현재 기준: S23 Semantic Scene Spec과 P2 완료; S24–S27 P3 완료; S28–S31 P4 완료; S32–S35 P5 완료; S36 P6 완료; S37 P7 완료; S38 P8 완료; S39 P9 완료
>
> 이 문서는 앞으로의 구현 순서와 완료 기준을 관리하는 단일 로드맵이다. 세부 설계는
> `ai-scene-assistant.md`, 완료된 작업의 검증 기록은 `session-handoffs/`를 따른다.

## 1. 현재 제품 기준선

다음 기능은 현재 브랜치에 구현되어 있다.

| 영역           | 완료된 기능                                                                 | 기록    |
| -------------- | --------------------------------------------------------------------------- | ------- |
| Codex 연결     | Local Companion, 인증된 loopback API, App Server 연결, 대화 시작·재개·중단  | S13     |
| 이미지 생성    | OutputCamera 캡처, 레퍼런스 첨부, 내장 imagegen 실행, 결과 프로젝트 편입    | S14     |
| 3D 변환 계약   | 카메라·화면 점유율·깊이·포즈·잠재 가림을 포함한 `LayoutSpec`                | S15     |
| 오브젝트 의미  | 이름, 실제 의미, 생성 메모의 저장·JSON 왕복·prompt 전달                     | S16     |
| Assistant UI   | 가변 폭·접기 가능한 우측 도크, 대화/변환 계약 탭                            | S17     |
| 생성 원본 보존 | 생성 당시 SceneDocument·레퍼런스·LayoutSpec 불변 스냅샷과 버전 계보         | S18     |
| 키프레임 보정  | 기존 결과 + 현재 3D 레이아웃을 사용하는 단일 단계 `edit` 생성               | S19     |
| 키프레임 작업  | 전체 generation 이력과 sceneSnapshot 읽기 전용 3D 미리보기·차이·무결성 표시 | S20–S21 |
| 스냅샷 적용    | generation sceneSnapshot의 fail-closed 적용·undo·durable recovery·출처 보존 | S22     |
| 장면 전체 명세 | versioned Semantic Scene Spec 저장·편집·snapshot·prompt와 권위 경계         | S23     |
| 대화형 변경    | specPatch와 object ID 명령의 이중 검증·원자 적용·generation 전달 증거       | S24–S27 |
| 생성 사전검사  | 참조·LayoutSpec 무결성 차단과 충돌 경고의 브라우저·Companion 재검증         | S26     |
| 보정 지시 계약 | versioned 유지·변경 지시의 UI·prompt·generation 저장과 이중 검증            | S28     |
| 버전 결과 비교 | 부모·형제 결과 이미지와 mode·directive·SceneDocument·LayoutSpec 비교·복원   | S29     |
| 생성 실행 복구 | request ID idempotency·중복 방지·응답 유실 재전송·재시작 상태 복구          | S30     |
| 실행 재현 증거 | 입력 스냅샷·원본·레퍼런스 해시, 실제 첨부 순서와 prompt 근거 재검증         | S31     |
| 프로젝트 대화  | versioned task metadata, 명시적 재개·새 task 선택, 재시작 중단 상태 복구    | S32     |
| 런타임 요청    | 명령·파일 승인과 사용자 질문의 인증 응답, 비밀 비저장, 재시작 만료 복구     | S33     |
| 실행 수명주기  | 프로젝트 lock, 포트 fallback, 브라우저 자동 실행, 제한된 무중복 재연결      | S34     |
| 브라우저 배포  | 동일-origin 정적 편집기, platform Codex bundle, 크기 manifest와 배포 결정   | S35     |
| 수동 웹 생성   | GPT 웹용 동일 의미 프롬프트, 첨부 순서 안내, 모달 복사와 무부작용 fallback  | S36     |
| 생성 자원 수명 | 불변 원본·hash-bound thumbnail, bounded URL/Canvas와 restart 복구           | S37     |
| 레이아웃 권위  | Image 1 고정, attachment contract v2와 역할·권위 binding fail-closed 검증   | S38     |
| 장면 v4·잠금   | v1~v3 additive migration, authoring 기반과 viewport click-through 선택 잠금 | S39     |

현재 기본 생성은 `Image 1 현재 3D 레이아웃 + 레퍼런스 최대 4장`, 보정 생성은
`Image 1 현재 3D 레이아웃 + Image 2 원본 키프레임 + 레퍼런스 최대 3장`을 사용한다.
보정을 반복할 때는 직전 결과를 연쇄 편집하지 않고 사용자가 처음 선택한 원본에서 형제
버전을 만든다.

## 2. 다음 구현 순서

### P0. 키프레임 작업 공간과 생성 이력 — 완료 (S20)

목표는 생성 결과에 피드백이 들어왔을 때 결과와 당시 3D 근거를 잃지 않고 다시 작업하는
것이다.

- [x] `3D 씬`과 `키프레임` 작업 모드 제공
- [x] 전체 generation 목록과 상태, 버전, fresh/edit, 부모·자식 관계 표시
- [x] 선택한 결과 이미지와 생성 당시 레이아웃 렌더 나란히 보기
- [x] 생성 당시 지시, 피드백, 레퍼런스와 `LayoutSpec` 상세 보기
- [x] 결과 이미지뿐 아니라 저장된 레이아웃 렌더를 읽는 인증된 Companion 콘텐츠 API
- [x] 기존 보정 진입점을 최신 결과 카드 하나가 아니라 선택한 완료 generation에 연결
- [x] 작업 모드와 선택 generation을 로컬에 복원하고 스냅샷 없는 구형 기록의 제한 표시

완료 기준:

1. 앱을 새로 열어도 프로젝트의 모든 generation을 선택할 수 있다.
2. 각 generation에서 결과와 생성 당시 레이아웃을 혼동 없이 비교할 수 있다.
3. 선택한 과거 generation을 기준으로 보정해도 올바른 부모 ID와 버전이 기록된다.
4. 스냅샷이 없는 구형 기록은 복원 제한을 명확히 표시하고 앱을 깨뜨리지 않는다.

### P1. 생성 당시 3D 씬 불러오기 — 완료 (S22)

목표는 과거 키프레임의 구도를 수정해 새로운 생성 분기를 만들 수 있게 하는 것이다.

- [x] generation의 `sceneSnapshot`을 격리된 store의 읽기 전용 3D 미리보기로 열기
- [x] 현재 씬과 스냅샷의 카메라·출력·오브젝트·의미 등 주요 차이 표시
- [x] snapshot, `LayoutSpec`, 저장된 layout render scene ID를 Companion과 브라우저에서 검증
- [x] 명시적인 `현재 씬으로 불러오기` 동작 제공
- [x] 불러오기 전에 현재 씬을 autosave하고 덮어쓰기 경고 제공
- [x] 불러온 씬에서 만든 결과는 선택 generation을 출처로 기록하되 `fresh`와 `edit`의 의미를
      구분

완료 기준:

1. [x] 결과 카드에서 생성 당시 카메라와 오브젝트 배치를 재현할 수 있다.
2. [x] 취소하면 현재 편집 중인 씬이 바뀌지 않는다.
3. [x] 적용 후 단일 undo와 별도 durable pre-apply autosave 복구 경로가 존재한다.
4. [x] 스냅샷 scene ID, layout scene ID와 렌더 scene ID의 무결성을 서버와 브라우저에서
       검증한다.

### P2. 장면 전체 Semantic Scene Spec — 완료 (S23)

현재 구현된 오브젝트별 `semantic.meaning`과 `generationNotes`를 장면 전체 연출 명세로
확장한다.

- [x] 장면의 장소, 시간대, 분위기와 화풍 의도
- [x] 생성 전용 소품과 음식처럼 3D로 만들지 않은 요소
- [x] 배경 손님 등 엑스트라의 수, 위치 범위와 중요도
- [x] 인물 간 시선, 행동과 관계
- [x] 유지해야 할 요소와 변경 가능한 요소
- [x] 프로젝트 파일 저장, JSON import/export와 generation snapshot 포함

완료 기준:

1. [x] 사용자가 `배경 오른쪽에 손님 5~8명` 같은 지시를 구조화해 저장할 수 있다.
2. [x] 새 대화나 새로고침 후에도 명세가 프로젝트에서 복원된다.
3. [x] prompt는 채팅 기록이 아니라 저장된 명세를 기준으로 재생성할 수 있다.

### P3. 대화형 변경 계약과 충돌 검사 — 완료 (S27)

목표는 Codex가 대화 내용을 바로 씬에 덮어쓰지 않고 검증 가능한 변경안으로 제시하게 하는
것이다.

- [x] 허용된 경로만 수정하는 구조화된 `specPatch`
- [x] 변경 전/후 미리보기와 적용·취소
- [x] 3D 변형은 object ID 기반 도메인 명령으로 분리
- [x] 삭제된 오브젝트와 레퍼런스 연결의 참조 무결성 검사 — S26
- [x] 주인공 가림, 레퍼런스 충돌, 포즈 권위 충돌과 이미지 입력 예산 경고 — S26

완료 기준:

1. [x] 자연어 지시가 검증 가능한 변경 카드로 표시된다.
2. [x] 적용 전에는 SceneDocument와 Scene Spec이 바뀌지 않는다.
3. [x] 잘못된 ID, 허용되지 않은 경로와 충돌하는 지시는 서버와 브라우저 양쪽에서 거부된다.
4. [x] 적용된 변경은 generation snapshot과 prompt에서 동일하게 확인된다.

### P4. 생성 이력과 보정 정책 고도화 — 완료 (S31)

- [x] 원본 기반 `edit`와 3D 변경 후 `fresh` 재생성을 UI에서 명확히 구분
- [x] 피드백에서 유지·변경 제약을 구조화하고 generation에 저장 — S28
- [x] 버전 계보 탐색과 결과 비교 — S29
- [x] 생성 요청 idempotency, 중복 클릭 방지, 취소·실패·재시도 상태 정리 — S30
- [x] 동일 입력 재생성 시 어떤 스냅샷과 레퍼런스를 사용했는지 재현 가능한 실행 요약 제공 — S31

완료 기준:

1. [x] 사용자는 디테일 보정과 구도 재생성 중 적합한 경로를 선택할 수 있다.
2. [x] 모든 결과에서 원본, 입력 이미지 순서, 피드백과 생성 방식을 추적할 수 있다.
3. [x] 새로고침과 Companion 재시작 뒤에도 진행·실패 상태가 모순 없이 복구된다.

### P5. 프로젝트 대화 영속성과 런타임 제품화 — 완료 (S35)

- [x] 프로젝트별 Codex task ID와 대화 요약 metadata 저장 — S32
- [x] 프로젝트를 다시 열었을 때 task 재개 또는 새 task 시작을 명시적으로 선택 — S32
- [x] App Server의 승인·사용자 입력 요청 처리 UI — S33
- [x] Companion 자동 시작과 종료, 포트 충돌 및 재연결 UX — S34
- [x] 배포 형태 결정과 Electron/Tauri 등 데스크톱 패키징 평가 — S35

Codex task는 대화 연속성을 위한 보조 상태다. SceneDocument, Semantic Scene Spec,
레퍼런스 manifest와 generation record가 프로젝트의 영구 원본이라는 원칙은 유지한다.

### P6. GPT 웹용 수동 생성 fallback — 완료 (S36)

- [x] fresh/edit 생성과 같은 장면 의미·LayoutSpec·레퍼런스 매니페스트로 웹용 prompt 생성
- [x] Codex 전용 `$imagegen` 명령을 제거하고 fresh 생성의 현재 사용자 지시 포함
- [x] 모달에서 레이아웃·보정 원본·역할별 레퍼런스의 첨부 순서와 preflight 경고 표시
- [x] 클립보드 복사, Escape 닫기와 imagegen capability 비의존 동작
- [x] 수동 결과가 프로젝트 generation 이력에 자동 등록되지 않음을 명시

### P7. Generation asset 수명주기 — 완료 (S37)

프로젝트에 생성 원본은 불변으로 보존하면서 장시간 사용하는 generation 이력의 브라우저·GPU
자원 소유권을 제한한다.

- [x] Companion이 원본 해시에 결합된 제한 크기 thumbnail을 원자적으로 생성·복구
- [x] generation 목록은 thumbnail만 요청하고 선택·비교 항목만 전체 해상도 원본을 지연 로드
- [x] 선택 해제·교체·unmount에서 blob URL과 decoded image 자원을 정확히 한 번 해제
- [x] 읽기 전용 sceneSnapshot preview 종료 시 격리된 Canvas/WebGL 자원을 해제하고 live editor에 무부작용
- [x] 원본/thumbnail 해시·실제 decode 크기·경로 무결성과 legacy/restart 복구를 fail-closed로 검증
- [x] 많은 generation에서도 전체 해상도 URL, preview Canvas와 표시 행 수가 제한되는 Chromium/WebGL 증거

완료 기준:

1. 원본 bytes와 해시는 thumbnail 생성·복구 전후 동일하며 thumbnail은 320×320 경계 안의 WebP다.
2. 목록 행은 원본 content route를 호출하지 않고 현재 표시 범위의 thumbnail만 decode한다.
3. 선택/비교 교체와 preview 반복 open/close 뒤 전체 해상도 URL은 최대 3개, preview Canvas는 최대 1개다.
4. reload/Companion 재시작에서 정상 legacy thumbnail은 안전하게 복구되고 malformed metadata, 경로 탈출,
   원본/thumbnail 해시 불일치는 manifest와 원본을 변경하지 않은 채 차단된다.
5. e2e 전용 자원 진단은 일반 production build에 존재하지 않는다.

### P8. 3D 레이아웃 첨부와 공간 권위 고정 — 완료 (S38)

- [x] fresh/edit 모두 현재 OutputCamera 레이아웃을 Image 1로 고정
- [x] edit source generation을 Image 2의 외형 권위로 제한
- [x] canonical image descriptor와 역할별 허용/금지 권위 계약
- [x] imagegen compiler의 구조화 binding과 readable prompt 역할을 이중 검증
- [x] 역할 재분류, 권위 약화와 text/binding 모순을 provider 호출 전에 차단
- [x] generation record와 키프레임 실행 상세에 contract version과 binding 저장
- [x] Codex/OAuth/웹 내보내기의 순서와 보정 권위 문구 통일

완료 기준:

1. fresh/edit의 실제 provider 입력과 저장 attachment에서 layout이 항상 첫 번째다.
2. source generation, reference와 conversation intent는 layout의 공간 권위를 덮어쓸 수 없다.
3. compiler가 canonical index, role 또는 authority를 바꾸면 생성이 fail-closed 된다.
4. legacy generation은 기존 attachment 순서와 필드 누락 상태로 계속 읽을 수 있다.

### P9. SceneDocument v4 기반과 뷰포트 선택 잠금 — 완료 (S39)

- [x] v1~v3 장면과 generation snapshot의 불변 v4 migration
- [x] 오브젝트별 selection lock, visualization과 appearance intent 기본값
- [x] 빈 group/spatial relation 컬렉션과 참조·중복·cycle·mirror schema 검증
- [x] 삭제 시 group과 containment/reflection dangling reference 원자 정리
- [x] Outliner 행 선택과 잠금 토글 클릭 영역·접근성 분리
- [x] 잠긴 전경을 통과하는 뷰포트 hit propagation
- [x] 잠긴 오브젝트의 Outliner 선택, Inspector와 transform gizmo 유지
- [x] 잠금 mutation의 undo/redo·autosave·JSON·snapshot 보존

완료 기준:

1. v1~v3 입력은 원본을 수정하지 않고 결정적인 v4 기본값으로 복원된다.
2. 잠긴 오브젝트는 뷰포트 선택 대상이 아니지만 Outliner 편집 대상이다.
3. 잠긴 전경 뒤의 잠기지 않은 오브젝트를 실제 Chromium에서 선택할 수 있다.
4. 잠금 변경은 독립 history mutation이며 저장·새로고침과 generation record를 왕복한다.
5. 이후 그룹·containment·mirror 단계가 dangling reference를 만들 수 없는 schema 기반을 갖는다.

## 3. 장기 보류

다음 항목은 위 단계가 안정화된 뒤 검토한다.

- GPU ID pass 또는 mesh-level visibility 기반 정밀 가림 분석
- 캐릭터 시트 자동 크롭과 영역 마스킹
- 여러 생성 공급자와 모델별 입력 예산 설정 UI
- 배치 생성과 자동 후보 비교
- 임의 3D 에셋 import, animation timeline과 physics
- cloud 저장과 협업
- 원격 Codex App Server 운영

## 4. 로드맵 운영 규칙

- 새 기능을 시작할 때 이 문서의 해당 단계와 완료 기준을 먼저 갱신한다.
- 완료된 작업은 별도 `docs/session-handoffs/SNN-*.md`에 구현 내용과 검증 결과를 기록한다.
- handoff의 `다음 단계`는 당시 제안으로 보며, 최신 우선순위는 항상 이 문서를 따른다.
- 단계가 완료되면 `현재 제품 기준선`으로 이동하고 다음 단계의 범위를 다시 확인한다.
- 실제 imagegen 수동 검증과 사용량을 소모하지 않는 자동 테스트를 구분해 기록한다.

## 5. 바로 다음 작업

S40에서는 v4 `groups`를 사용하는 translate-only 그룹화를 구현한다. Outliner 다중 선택과 그룹
생성·해제, 그룹 선택 상태를 도입하고, 그룹 이동은 모든 멤버에 같은 월드 delta를 적용하는 하나의
history mutation이어야 한다. 회전·스케일·중첩 그룹·그룹 복제는 이번 단계에서 제외한다.
